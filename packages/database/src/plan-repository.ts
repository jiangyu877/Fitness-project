import type { PGlite } from '@electric-sql/pglite';

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

export type RepositoryActorRole =
  | 'OPERATIONS'
  | 'NUTRITION_REVIEWER'
  | 'TRAINING_REVIEWER'
  | 'SYSTEM_ADMIN'
  | 'AUDIT_VIEWER'
  | 'USER';

export class PGlitePlanRepository {
  constructor(private readonly database: PGlite) {}

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
        [input.requestId, input.actorId, input.actorRole, input.action, input.subjectId, input.requestId],
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
}
