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
  replayed?: boolean;
};

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
    const current = await this.get(id);
    if (!current) throw new Error('PLAN_VERSION_NOT_FOUND');
    if (current.recordVersion !== expectedRecordVersion) {
      throw new VersionConflictError(current.recordVersion);
    }
    const next = { ...current, ...patch, recordVersion: expectedRecordVersion + 1 };
    await this.database.query(
      `UPDATE planning.plan_version
       SET status=$1, payload=$2::jsonb, effective_to=$3, effective_at=$4, record_version=$5
       WHERE id=$6 AND record_version=$7`,
      [
        next.status,
        JSON.stringify(next.payload),
        next.effectiveTo,
        next.effectiveAt,
        next.recordVersion,
        id,
        expectedRecordVersion,
      ],
    );
    return next;
  }

  async recordWrite(input: {
    idempotencyKey: string;
    requestId: string;
    actorId: string;
    action: string;
    subjectId: string;
    result: Record<string, unknown>;
  }): Promise<WriteRecord> {
    const existing = await this.database.query<{ result_id: string }>(
      `SELECT result_id FROM audit.idempotency_key WHERE key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) return { id: existing.rows[0].result_id, replayed: true };
    await this.database.query(
      `INSERT INTO audit.idempotency_key (key, result_id) VALUES ($1, $2)`,
      [input.idempotencyKey, input.requestId],
    );
    await this.database.query(
      `INSERT INTO audit.audit_event (id, actor_id, actor_role, action, subject_type, subject_id, request_id)
       VALUES ($1,$2,'SYSTEM',$3,'PLAN_VERSION',$4,$5)`,
      [input.requestId, input.actorId, input.action, input.subjectId, input.requestId],
    );
    return { id: input.requestId };
  }

  async listAudit(subjectId: string) {
    const result = await this.database.query(
      `SELECT request_id AS "requestId", action, actor_id AS "actorId"
       FROM audit.audit_event WHERE subject_id = $1 ORDER BY occurred_at`,
      [subjectId],
    );
    return result.rows;
  }
}
