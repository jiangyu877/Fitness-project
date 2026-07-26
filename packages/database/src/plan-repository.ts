import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';

export type PlanRepositoryRecord = {
  id: string;
  planId: string;
  userId: string;
  versionNumber: number;
  status: string;
  confirmationDeadlineAt: Date;
  effectiveAt: Date;
  effectiveTo: Date | null;
  payload: Record<string, unknown>;
  recordVersion: number;
};

export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor(readonly latestRecordVersion: number) {
    super('VERSION_CONFLICT');
  }
}

export type WriteRecord = {
  id: string;
  result: Record<string, unknown>;
  replayed: boolean;
};

export type PlanWriteMetadata = {
  idempotencyKey: string;
  requestId: string;
  requestFingerprint: string;
  actorId: string;
  actorRole: RepositoryActorRole;
  operation: string;
  action: string;
  subjectId: string;
  occurredAt?: Date;
};

export type RepositoryActorRole =
  | 'OPERATIONS'
  | 'NUTRITION_REVIEWER'
  | 'TRAINING_REVIEWER'
  | 'SYSTEM_ADMIN'
  | 'AUDIT_VIEWER'
  | 'USER';

export type PlanTransitionDecision = {
  patch: Partial<Pick<PlanRepositoryRecord, 'status' | 'payload' | 'effectiveTo' | 'effectiveAt'>>;
  action?: string;
  supersedeActive?: boolean;
  terminalError?: string;
};
export type PlanTransaction = Pick<PGlite, 'query'>;

export class PGlitePlanRepository {
  constructor(
    private readonly database: PGlite,
    private readonly transactionClock?: { now(): Date },
  ) {}

  async findWrite(metadata: PlanWriteMetadata): Promise<PlanRepositoryRecord | null> {
    const scope = `${metadata.actorId}:${metadata.actorRole}:${metadata.subjectId}`;
    const existing = await this.database.query<{
      operation: string; principalScope: string; requestFingerprint: string; result: unknown;
    }>(
      `SELECT operation, principal_scope AS "principalScope", request_fingerprint AS "requestFingerprint", result
       FROM audit.idempotency_key WHERE key=$1`, [metadata.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) return null;
    if (row.operation !== metadata.operation || row.principalScope !== scope
      || row.requestFingerprint !== metadata.requestFingerprint) {
      throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    return this.recordFromResult(this.parseJson(row.result));
  }

  async create(input: Omit<PlanRepositoryRecord, 'recordVersion'>): Promise<PlanRepositoryRecord> {
    await this.database.query(
      `INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, confirmation_deadline_at,
        effective_at, effective_to, payload, record_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)`,
      [
        input.id,
        input.planId,
        input.userId,
        input.versionNumber,
        input.status,
        input.confirmationDeadlineAt,
        input.effectiveAt,
        input.effectiveTo,
        JSON.stringify(input.payload),
      ],
    );
    return { ...input, recordVersion: 1 };
  }

  async createWithWrite(
    input: Omit<PlanRepositoryRecord, 'recordVersion'>,
    metadata: PlanWriteMetadata,
  ): Promise<{ record: PlanRepositoryRecord; replayed: boolean }> {
    return this.database.transaction(async (transaction) => {
      const replay = await this.claimWrite(transaction, metadata, input.payload);
      if (replay) return { record: this.recordFromResult(replay), replayed: true };

      await transaction.query(
        `INSERT INTO planning.plan (id, user_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [input.planId, input.userId],
      );
      await transaction.query(`SELECT id FROM planning.plan WHERE id=$1 FOR UPDATE`, [input.planId]);
      const nextVersion = await transaction.query<{ versionNumber: number }>(
        `SELECT COALESCE(max(version_number), 0)::integer + 1 AS "versionNumber"
         FROM planning.plan_version WHERE plan_id=$1`, [input.planId],
      );
      const created = await transaction.query<PlanRepositoryRecord & { payload: unknown }>(
        `INSERT INTO planning.plan_version (
           id, plan_id, user_id, version_number, status, confirmation_deadline_at,
           confirmation_timed_out_at, effective_at, effective_to, published_at,
           rejection_reason_code, professional_rules_approved, demo_only, payload, record_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,1)
         RETURNING id, plan_id AS "planId", user_id AS "userId", version_number AS "versionNumber",
           status, confirmation_deadline_at AS "confirmationDeadlineAt", effective_at AS "effectiveAt",
           effective_to AS "effectiveTo", payload, record_version AS "recordVersion"`,
        [
          input.id, input.planId, input.userId, nextVersion.rows[0]!.versionNumber, input.status,
          input.confirmationDeadlineAt, this.payloadDate(input.payload, 'confirmationTimedOutAt'),
          input.effectiveAt, input.effectiveTo, this.payloadDate(input.payload, 'publishedAt'),
          this.payloadString(input.payload, 'rejectionReasonCode'),
          input.payload.contentMode === 'REVIEWED', input.payload.contentMode === 'DEMO_UNREVIEWED',
          JSON.stringify(input.payload),
        ],
      );
      const record = this.hydrate(created.rows[0]!);
      await this.finishWrite(transaction, metadata, record);
      return { record, replayed: false };
    });
  }

  async get(id: string): Promise<PlanRepositoryRecord | null> {
    const result = await this.database.query<PlanRepositoryRecord & { payload: string }>(
      `SELECT id, plan_id AS "planId", user_id AS "userId", version_number AS "versionNumber",
        status, confirmation_deadline_at AS "confirmationDeadlineAt", effective_at AS "effectiveAt",
        effective_to AS "effectiveTo", payload, record_version AS "recordVersion"
       FROM planning.plan_version WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      payload: typeof row.payload === 'string'
        ? JSON.parse(row.payload) as Record<string, unknown>
        : row.payload as unknown as Record<string, unknown>,
    };
  }

  async save(
    id: string,
    expectedRecordVersion: number,
    patch: Partial<Pick<PlanRepositoryRecord, 'status' | 'payload' | 'effectiveTo' | 'effectiveAt'>>,
  ): Promise<PlanRepositoryRecord> {
    const result = await this.database.query<PlanRepositoryRecord & { payload: string }>(
      `UPDATE planning.plan_version
       SET status=CASE WHEN $1 THEN $2 ELSE status END,
           payload=CASE WHEN $3 THEN $4::jsonb ELSE payload END,
           effective_to=CASE WHEN $5 THEN $6 ELSE effective_to END,
           effective_at=CASE WHEN $7 THEN $8 ELSE effective_at END,
           record_version=record_version + 1
       WHERE id=$9 AND record_version=$10
       RETURNING id, plan_id AS "planId", user_id AS "userId",
         version_number AS "versionNumber", status,
         confirmation_deadline_at AS "confirmationDeadlineAt",
         effective_at AS "effectiveAt", effective_to AS "effectiveTo",
         payload, record_version AS "recordVersion"`,
      [
        patch.status !== undefined,
        patch.status ?? null,
        patch.payload !== undefined,
        JSON.stringify(patch.payload ?? {}),
        Object.hasOwn(patch, 'effectiveTo'),
        patch.effectiveTo ?? null,
        patch.effectiveAt !== undefined,
        patch.effectiveAt ?? null,
        id,
        expectedRecordVersion,
      ],
    );
    const updated = result.rows[0];
    if (updated) return this.hydrate(updated);

    const latest = await this.get(id);
    if (!latest) throw new Error('PLAN_VERSION_NOT_FOUND');
    throw new VersionConflictError(latest.recordVersion);
  }

  async saveWithWrite(
    id: string,
    expectedRecordVersion: number,
    patch: Partial<Pick<PlanRepositoryRecord, 'status' | 'payload' | 'effectiveTo' | 'effectiveAt'>>,
    metadata: PlanWriteMetadata,
    supersede?: { userId: string; occurredAt: Date },
  ): Promise<{ record: PlanRepositoryRecord; replayed: boolean }> {
    return this.database.transaction(async (transaction) => {
      const replay = await this.claimWrite(transaction, metadata, patch.payload ?? {});
      if (replay) return { record: this.recordFromResult(replay), replayed: true };
      if (supersede) {
        const target = await transaction.query<{ planId: string }>(
          `SELECT plan_id AS "planId" FROM planning.plan_version WHERE id=$1`,
          [id],
        );
        if (!target.rows[0]) throw new Error('PLAN_VERSION_NOT_FOUND');
        await transaction.query(`SELECT id FROM planning.plan WHERE id=$1 FOR UPDATE`, [target.rows[0].planId]);
        const overlapping = await transaction.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM planning.plan_version
           WHERE user_id=$1 AND status='ACTIVE' AND id<>$2
             AND effective_at <= $3 AND $3 < effective_to`,
          [supersede.userId, id, supersede.occurredAt],
        );
        if (Number(overlapping.rows[0]?.count ?? 0) > 1) {
          throw new Error('MULTIPLE_ACTIVE_PLAN_VERSIONS');
        }
        await transaction.query(
          `UPDATE planning.plan_version
           SET status='SUPERSEDED', effective_to=LEAST(effective_to, $1),
               payload=jsonb_set(
                 jsonb_set(payload, '{plan,status}', '"SUPERSEDED"'::jsonb),
                 '{plan,effectiveTo}', to_jsonb(LEAST(effective_to, $1)::timestamptz)
               ),
               record_version=record_version + 1
           WHERE user_id=$2 AND status='ACTIVE' AND id<>$3`,
          [supersede.occurredAt, supersede.userId, id],
        );
      }
      const updated = await transaction.query<PlanRepositoryRecord & { payload: unknown }>(
        `UPDATE planning.plan_version
         SET status=CASE WHEN $1 THEN $2 ELSE status END,
             payload=CASE WHEN $3 THEN $4::jsonb ELSE payload END,
             effective_to=CASE WHEN $5 THEN $6 ELSE effective_to END,
             effective_at=CASE WHEN $7 THEN $8 ELSE effective_at END,
             published_at=CASE WHEN $3 THEN $9 ELSE published_at END,
             confirmation_timed_out_at=CASE WHEN $3 THEN $10 ELSE confirmation_timed_out_at END,
             rejection_reason_code=CASE WHEN $3 THEN $11 ELSE rejection_reason_code END,
             record_version=record_version + 1
         WHERE id=$12 AND record_version=$13
         RETURNING id, plan_id AS "planId", user_id AS "userId", version_number AS "versionNumber",
           status, confirmation_deadline_at AS "confirmationDeadlineAt", effective_at AS "effectiveAt",
           effective_to AS "effectiveTo", payload, record_version AS "recordVersion"`,
        [
          patch.status !== undefined, patch.status ?? null, patch.payload !== undefined,
          JSON.stringify(patch.payload ?? {}), Object.hasOwn(patch, 'effectiveTo'), patch.effectiveTo ?? null,
          patch.effectiveAt !== undefined, patch.effectiveAt ?? null,
          this.payloadDate(patch.payload, 'publishedAt'), this.payloadDate(patch.payload, 'confirmationTimedOutAt'),
          this.payloadString(patch.payload, 'rejectionReasonCode'), id, expectedRecordVersion,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        const latest = await transaction.query<{ recordVersion: number }>(
          `SELECT record_version AS "recordVersion" FROM planning.plan_version WHERE id=$1`, [id],
        );
        if (!latest.rows[0]) throw new Error('PLAN_VERSION_NOT_FOUND');
        throw new VersionConflictError(latest.rows[0].recordVersion);
      }
      const record = this.hydrate(row);
      await this.finishWrite(transaction, metadata, record);
      return { record, replayed: false };
    });
  }

  async transitionWithWrite(
    id: string,
    metadata: PlanWriteMetadata,
    decide: (record: PlanRepositoryRecord, trustedNow: Date) => PlanTransitionDecision,
    options: {
      enforceSinglePending?: boolean;
      serializeOnAccountId?: string;
      beforeClaim?: (transaction: PlanTransaction, record: PlanRepositoryRecord) => Promise<void>;
    } = {},
  ): Promise<{ record: PlanRepositoryRecord; replayed: boolean; terminalError?: string }> {
    return this.database.transaction(async (transaction) => {
      if (options.serializeOnAccountId) {
        await transaction.query(`SELECT id FROM iam.account WHERE id=$1 FOR UPDATE`, [options.serializeOnAccountId]);
      }
      const target = await transaction.query<{ planId: string }>(
        `SELECT plan_id AS "planId" FROM planning.plan_version WHERE id=$1`,
        [id],
      );
      if (!target.rows[0]) throw new Error('PLAN_VERSION_NOT_FOUND');
      await transaction.query(`SELECT id FROM planning.plan WHERE id=$1 FOR UPDATE`, [target.rows[0].planId]);
      const locked = await transaction.query<PlanRepositoryRecord & { payload: unknown }>(
        `SELECT id, plan_id AS "planId", user_id AS "userId", version_number AS "versionNumber",
           status, confirmation_deadline_at AS "confirmationDeadlineAt", effective_at AS "effectiveAt",
           effective_to AS "effectiveTo", payload, record_version AS "recordVersion"
         FROM planning.plan_version WHERE id=$1 FOR UPDATE`,
        [id],
      );
      const record = locked.rows[0] ? this.hydrate(locked.rows[0]) : null;
      if (!record) throw new Error('PLAN_VERSION_NOT_FOUND');
      if (options.serializeOnAccountId && record.userId !== options.serializeOnAccountId) {
        throw new Error('PLAN_VERSION_ACCOUNT_MISMATCH');
      }
      await options.beforeClaim?.(transaction, record);
      const replay = await this.claimWrite(transaction, metadata, record.payload);
      if (replay) return { record: this.recordFromResult(replay), replayed: true };
      const trustedNow = await this.trustedTransactionTime(transaction);
      if (options.enforceSinglePending) {
        const pending = await transaction.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM planning.plan_version
           WHERE user_id=$1 AND id<>$2 AND status IN ('PENDING_CONFIRMATION','SCHEDULED')`,
          [record.userId, id],
        );
        if (Number(pending.rows[0]?.count ?? 0) > 0) throw new Error('SINGLE_PENDING_VERSION_REQUIRED');
      }
      const decision = decide(record, trustedNow);
      if (decision.supersedeActive) {
        const overlapping = await transaction.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM planning.plan_version
           WHERE user_id=$1 AND status='ACTIVE' AND id<>$2
             AND effective_at <= $3 AND $3 < effective_to`,
          [record.userId, id, trustedNow],
        );
        if (Number(overlapping.rows[0]?.count ?? 0) > 1) throw new Error('MULTIPLE_ACTIVE_PLAN_VERSIONS');
        await transaction.query(
          `UPDATE planning.plan_version
           SET status='SUPERSEDED', effective_to=LEAST(effective_to, $1),
               payload=jsonb_set(
                 jsonb_set(payload, '{plan,status}', '"SUPERSEDED"'::jsonb),
                 '{plan,effectiveTo}', to_jsonb(LEAST(effective_to, $1)::timestamptz)
               ), record_version=record_version + 1
           WHERE user_id=$2 AND status='ACTIVE' AND id<>$3`,
          [trustedNow, record.userId, id],
        );
      }
      const patch = decision.patch;
      const updated = await transaction.query<PlanRepositoryRecord & { payload: unknown }>(
        `UPDATE planning.plan_version
         SET status=CASE WHEN $1 THEN $2 ELSE status END,
             payload=CASE WHEN $3 THEN $4::jsonb ELSE payload END,
             effective_to=CASE WHEN $5 THEN $6 ELSE effective_to END,
             effective_at=CASE WHEN $7 THEN $8 ELSE effective_at END,
             published_at=CASE WHEN $3 THEN $9 ELSE published_at END,
             confirmation_timed_out_at=CASE WHEN $3 THEN $10 ELSE confirmation_timed_out_at END,
             rejection_reason_code=CASE WHEN $3 THEN $11 ELSE rejection_reason_code END,
             record_version=record_version + 1
         WHERE id=$12 AND record_version=$13
         RETURNING id, plan_id AS "planId", user_id AS "userId", version_number AS "versionNumber",
           status, confirmation_deadline_at AS "confirmationDeadlineAt", effective_at AS "effectiveAt",
           effective_to AS "effectiveTo", payload, record_version AS "recordVersion"`,
        [
          patch.status !== undefined, patch.status ?? null, patch.payload !== undefined,
          JSON.stringify(patch.payload ?? {}), Object.hasOwn(patch, 'effectiveTo'), patch.effectiveTo ?? null,
          patch.effectiveAt !== undefined, patch.effectiveAt ?? null,
          this.payloadDate(patch.payload, 'publishedAt'), this.payloadDate(patch.payload, 'confirmationTimedOutAt'),
          this.payloadString(patch.payload, 'rejectionReasonCode'), id, record.recordVersion,
        ],
      );
      const persisted = this.hydrate(updated.rows[0]!);
      await this.finishWrite(transaction, {
        ...metadata,
        action: decision.action ?? metadata.action,
        occurredAt: trustedNow,
      }, persisted);
      return { record: persisted, replayed: false, ...(decision.terminalError ? { terminalError: decision.terminalError } : {}) };
    });
  }

  async listByUser(userId: string): Promise<PlanRepositoryRecord[]> {
    const result = await this.database.query<PlanRepositoryRecord & { payload: unknown }>(
      `SELECT id, plan_id AS "planId", user_id AS "userId", version_number AS "versionNumber",
         status, confirmation_deadline_at AS "confirmationDeadlineAt", effective_at AS "effectiveAt",
         effective_to AS "effectiveTo", payload, record_version AS "recordVersion"
       FROM planning.plan_version WHERE user_id=$1 ORDER BY created_at DESC, id DESC`, [userId],
    );
    return result.rows.map((row) => this.hydrate(row));
  }

  async currentTrustedTime(): Promise<Date> {
    if (this.transactionClock) return this.transactionClock.now();
    const result = await this.database.query<{ trustedNow: Date }>(
      `SELECT clock_timestamp() AS "trustedNow"`,
    );
    return new Date(result.rows[0]!.trustedNow);
  }

  async recordWrite(input: {
    idempotencyKey: string;
    requestId: string;
    actorId: string;
    actorRole: RepositoryActorRole;
    action: string;
    subjectId: string;
    result: Record<string, unknown>;
  }): Promise<WriteRecord> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction.query<{ result_id: string; result: unknown }>(
        `INSERT INTO audit.idempotency_key (key, result_id, result)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (key) DO NOTHING
         RETURNING result_id, result`,
        [input.idempotencyKey, input.requestId, JSON.stringify(input.result)],
      );
      if (!inserted.rows[0]) {
        const existing = await transaction.query<{ result_id: string; result: unknown }>(
          `SELECT result_id, result FROM audit.idempotency_key WHERE key = $1`,
          [input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (!row) throw new Error('IDEMPOTENCY_RECORD_NOT_FOUND');
        return { id: row.result_id, result: this.parseJson(row.result), replayed: true };
      }

      await transaction.query(
        `INSERT INTO audit.audit_event (id, actor_id, actor_role, action, subject_type, subject_id, request_id)
         VALUES ($1,$2,$3,$4,'PLAN_VERSION',$5,$6)`,
        [randomUUID(), input.actorId, input.actorRole, input.action, input.subjectId, input.requestId],
      );
      return { id: input.requestId, result: input.result, replayed: false };
    });
  }

  async listAudit(subjectId: string) {
    const result = await this.database.query(
      `SELECT request_id AS "requestId", action, actor_id AS "actorId", actor_role AS "actorRole"
       FROM audit.audit_event WHERE subject_id = $1 ORDER BY occurred_at`,
      [subjectId],
    );
    return result.rows;
  }

  private hydrate(row: PlanRepositoryRecord & { payload: unknown }): PlanRepositoryRecord {
    return { ...row, payload: this.parseJson(row.payload) };
  }

  private parseJson(value: unknown): Record<string, unknown> {
    return typeof value === 'string'
      ? JSON.parse(value) as Record<string, unknown>
      : value as Record<string, unknown>;
  }

  private async claimWrite(
    transaction: Pick<PGlite, 'query'>,
    metadata: PlanWriteMetadata,
    provisionalResult: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const scope = `${metadata.actorId}:${metadata.actorRole}:${metadata.subjectId}`;
    const inserted = await transaction.query(
      `INSERT INTO audit.idempotency_key
         (key, result_id, result, operation, principal_scope, request_fingerprint)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [metadata.idempotencyKey, metadata.requestId, JSON.stringify(provisionalResult), metadata.operation, scope, metadata.requestFingerprint],
    );
    if (inserted.rows[0]) return null;
    const existing = await transaction.query<{
      operation: string; principalScope: string; requestFingerprint: string; result: unknown;
    }>(
      `SELECT operation, principal_scope AS "principalScope", request_fingerprint AS "requestFingerprint", result
       FROM audit.idempotency_key WHERE key=$1`, [metadata.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.operation !== metadata.operation || row.principalScope !== scope
      || row.requestFingerprint !== metadata.requestFingerprint) {
      throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    return this.parseJson(row.result);
  }

  private async finishWrite(
    transaction: Pick<PGlite, 'query'>,
    metadata: PlanWriteMetadata,
    record: PlanRepositoryRecord,
  ): Promise<void> {
    await transaction.query(`UPDATE audit.idempotency_key SET result=$1::jsonb WHERE key=$2`, [JSON.stringify(record), metadata.idempotencyKey]);
    await transaction.query(
      `INSERT INTO audit.audit_event
         (id, actor_id, actor_role, action, subject_type, subject_id, request_id, outcome, occurred_at)
       VALUES ($1,$2,$3,$4,'PLAN_VERSION',$5,$6,'SUCCEEDED',COALESCE($7, clock_timestamp()))`,
      [randomUUID(), metadata.actorId, metadata.actorRole, metadata.action, metadata.subjectId, metadata.requestId, metadata.occurredAt ?? null],
    );
  }

  private async trustedTransactionTime(transaction: Pick<PGlite, 'query'>): Promise<Date> {
    if (this.transactionClock) return this.transactionClock.now();
    const result = await transaction.query<{ trustedNow: Date }>(
      `SELECT clock_timestamp() AS "trustedNow"`,
    );
    return new Date(result.rows[0]!.trustedNow);
  }

  private recordFromResult(result: Record<string, unknown>): PlanRepositoryRecord {
    return this.hydrate(result as unknown as PlanRepositoryRecord & { payload: unknown });
  }

  private payloadDate(payload: Record<string, unknown> | undefined, key: string): Date | null {
    const value = payload?.plan && typeof payload.plan === 'object'
      ? (payload.plan as Record<string, unknown>)[key]
      : undefined;
    return typeof value === 'string' || value instanceof Date ? new Date(value) : null;
  }

  private payloadString(payload: Record<string, unknown> | undefined, key: string): string | null {
    const value = payload?.plan && typeof payload.plan === 'object'
      ? (payload.plan as Record<string, unknown>)[key]
      : undefined;
    return typeof value === 'string' ? value : null;
  }
}
