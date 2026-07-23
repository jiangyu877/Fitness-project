import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PGlite } from '@electric-sql/pglite';
import {
  generateSessionCredential,
  hashPassword,
  verifyPassword,
  type AuthSecurityPolicy,
} from '@lianban/domain';
import { createHash, randomUUID } from 'node:crypto';

import type { Environment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';
import { MFA_VERIFIER, type MfaVerifier } from './mfa-verifier.js';

export const AUTH_POLICY = Symbol('AUTH_POLICY');

type StaffRole =
  | 'OPERATIONS'
  | 'NUTRITION_REVIEWER'
  | 'TRAINING_REVIEWER'
  | 'SYSTEM_ADMIN'
  | 'AUDIT_VIEWER';
type ActorRole = StaffRole | 'USER' | 'SYSTEM';
type RequestMeta = { requestId: string; idempotencyKey: string };
type Sql = Pick<PGlite, 'query'>;
type RoleGrant = { code: StaffRole; qualifiedAt: Date | null };
type Principal = {
  accountId: string;
  accountType: 'USER' | 'STAFF';
  roles: RoleGrant[];
  activeRole: ActorRole | null;
};
type AccountRow = {
  id: string;
  password_hash: string;
  account_type: 'USER' | 'STAFF';
  status: 'INVITED' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  initial_password_change_required: boolean;
};
type IdempotencyRow = {
  operation: string;
  principal_scope: string;
  request_fingerprint: string;
  result: unknown;
};

@Injectable()
export class IdentityOnboardingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(AUTH_POLICY) private readonly policy: AuthSecurityPolicy | null,
    @Inject(MFA_VERIFIER) private readonly mfaVerifier: MfaVerifier | null,
  ) {}

  async invite(
    token: string | null,
    input: {
      accountId: string;
      loginIdentifier: string;
      accountType: 'USER' | 'STAFF';
      roles: StaffRole[];
      initialPassword: string;
    },
    meta: RequestMeta,
  ) {
    this.requirePolicy();
    if (!token) {
      await this.appendRejectedAudit({
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'ACCOUNT_INVITATION_REJECTED',
        subjectType: 'ACCOUNT',
        subjectId: input.accountId,
        requestId: meta.requestId,
        errorCode: 'SESSION_INVALID',
      });
      throw new UnauthorizedException(this.error(meta, 'SESSION_INVALID', ['LOGIN']));
    }
    const principal = await this.requireSession(token, 'STAFF', meta);
    let actorRole: 'OPERATIONS' | 'SYSTEM_ADMIN';
    try {
      actorRole = this.invitationRole(principal, input);
    } catch (error) {
      await this.auditAuthenticatedRejection(
        principal,
        'ACCOUNT_INVITATION_REJECTED',
        'ACCOUNT',
        input.accountId,
        meta,
        error,
      );
      throw error;
    }
    const passwordHash = await hashPassword(input.initialPassword, this.policy!);
    return this.write({
      meta,
      operation: 'IDENTITY_INVITE',
      principal,
      actorRole,
      fingerprintPayload: {
        accountId: input.accountId,
        loginIdentifier: input.loginIdentifier,
        accountType: input.accountType,
        roles: input.roles,
      },
      action: 'ACCOUNT_INVITED',
      subjectType: 'ACCOUNT',
      subjectId: input.accountId,
      execute: async (tx) => {
        await tx.query(
          `INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
           VALUES ($1, $2, $3, $4)`,
          [input.accountId, input.loginIdentifier, passwordHash, input.accountType],
        );
        for (const role of input.roles) {
          await tx.query(
            `INSERT INTO iam.account_role (account_id, role_code) VALUES ($1, $2)`,
            [input.accountId, role],
          );
        }
        return {
          businessStatus: 'ACCOUNT_INVITED',
          requestId: meta.requestId,
          accountId: input.accountId,
          version: 1,
        };
      },
    });
  }

  async changePassword(
    input: {
      accountId: string;
      currentPassword: string;
      newPassword: string;
      expectedVersion: number;
      actingRole?: StaffRole | undefined;
    },
    meta: RequestMeta,
  ) {
    this.requirePolicy();
    const account = await this.accountById(input.accountId);
    if (!account) {
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    const principal = await this.principalForAccount(account);
    const actorRole = this.resolveCredentialRole(principal, input.actingRole);
    const operation = 'IDENTITY_INITIAL_PASSWORD_CHANGE';
    const principalScope = this.principalScope(principal, actorRole);
    const fingerprintPayload = {
      accountId: input.accountId,
      expectedVersion: input.expectedVersion,
      actingRole: actorRole,
    };
    const replay = await this.readCompletedReplay(
      meta,
      operation,
      principalScope,
      this.fingerprint(fingerprintPayload),
    );
    if (replay) return replay;
    if (!await verifyPassword(input.currentPassword, account.password_hash)) {
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    if (account.status !== 'INVITED' || !account.initial_password_change_required) {
      await this.appendRejectedAudit({
        actorId: account.id,
        actorRole,
        action: 'PASSWORD_CHANGE_REJECTED',
        subjectType: 'ACCOUNT',
        subjectId: account.id,
        requestId: meta.requestId,
        errorCode: 'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
      });
      throw new ConflictException(this.error(meta, 'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED'));
    }
    const passwordHash = await hashPassword(input.newPassword, this.policy!);
    try {
      return await this.write({
        meta,
        operation,
        principal,
        actorRole,
        fingerprintPayload,
        action: 'PASSWORD_CHANGED',
        subjectType: 'ACCOUNT',
        subjectId: account.id,
        execute: async (tx) => {
          const result = await tx.query<{ version: number }>(
            `UPDATE iam.account
             SET password_hash=$1, initial_password_change_required=false,
                 status='ACTIVE', password_changed_at=now(), version=version+1
             WHERE id=$2 AND version=$3 AND status='INVITED'
               AND initial_password_change_required=true
             RETURNING version`,
            [passwordHash, account.id, input.expectedVersion],
          );
          if (!result.rows[0]) {
            throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
          }
          return {
            businessStatus: 'PASSWORD_CHANGED',
            requestId: meta.requestId,
            version: result.rows[0].version,
          };
        },
      });
    } catch (error) {
      if (this.errorCodeFrom(error) === 'VERSION_CONFLICT') {
        await this.auditAuthenticatedRejection(
          { ...principal, activeRole: actorRole },
          'PASSWORD_CHANGE_REJECTED',
          'ACCOUNT',
          account.id,
          meta,
          error,
        );
      }
      throw error;
    }
  }

  async login(
    input: {
      loginIdentifier: string;
      password: string;
      sessionKind: 'USER' | 'STAFF';
      mfaChallengeId?: string | undefined;
      actingRole?: StaffRole | undefined;
    },
    meta: RequestMeta,
  ) {
    this.requirePolicy();
    const account = await this.accountByLogin(input.loginIdentifier);
    if (!account || account.status !== 'ACTIVE' || account.initial_password_change_required) {
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    if (!await verifyPassword(input.password, account.password_hash)) {
      await this.recordFailedLogin(account.id, meta);
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    const expectedKind = account.account_type === 'USER' ? 'USER' : 'STAFF';
    if (input.sessionKind !== expectedKind) {
      throw new ForbiddenException(this.error(meta, 'SESSION_KIND_MISMATCH'));
    }

    const principal = await this.principalForAccount(account);
    const actorRole = this.resolveCredentialRole(principal, input.actingRole);
    principal.activeRole = actorRole;
    let mfaVerified: boolean;
    try {
      mfaVerified = await this.verifyMfa(principal, input.mfaChallengeId);
    } catch (error) {
      await this.auditAuthenticatedRejection(
        principal,
        'SESSION_CREATION_REJECTED',
        'ACCOUNT',
        account.id,
        meta,
        error,
      );
      throw error;
    }
    return this.createSession(principal, actorRole, input, mfaVerified, meta);
  }

  async acceptConsent(token: string, consentVersion: string, meta: RequestMeta) {
    const principal = await this.requireSession(token, 'USER', meta);
    const consentId = randomUUID();
    return this.write({
      meta,
      operation: 'ONBOARDING_CONSENT_ACCEPT',
      principal,
      actorRole: 'USER',
      fingerprintPayload: { consentVersion },
      action: 'CONSENT_ACCEPTED',
      subjectType: 'CONSENT',
      subjectId: consentId,
      execute: async (tx) => {
        await tx.query(
          `INSERT INTO care.consent_record (id, user_id, consent_version, accepted_at)
           VALUES ($1, $2, $3, now())`,
          [consentId, principal.accountId, consentVersion],
        );
        return {
          businessStatus: 'CONSENT_ACCEPTED',
          requestId: meta.requestId,
          consentId,
          consentVersion,
          version: 1,
        };
      },
    });
  }

  async withdrawConsent(token: string, consentId: string, expectedVersion: number, meta: RequestMeta) {
    const principal = await this.requireSession(token, 'USER', meta);
    return this.write({
      meta,
      operation: 'ONBOARDING_CONSENT_WITHDRAW',
      principal,
      actorRole: 'USER',
      fingerprintPayload: { consentId, expectedVersion },
      action: 'CONSENT_WITHDRAWN',
      subjectType: 'CONSENT',
      subjectId: consentId,
      execute: async (tx) => {
        const result = await tx.query<{ record_version: number }>(
          `UPDATE care.consent_record
           SET withdrawn_at=now(), record_version=record_version+1
           WHERE id=$1 AND user_id=$2 AND record_version=$3 AND withdrawn_at IS NULL
           RETURNING record_version`,
          [consentId, principal.accountId, expectedVersion],
        );
        if (!result.rows[0]) {
          throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
        }
        return {
          businessStatus: 'CONSENT_WITHDRAWN',
          requestId: meta.requestId,
          consentId,
          version: result.rows[0].record_version,
        };
      },
    });
  }

  async setAccountStatus(
    token: string,
    accountId: string,
    status: 'LOCKED' | 'DISABLED',
    expectedVersion: number,
    meta: RequestMeta,
  ) {
    const principal = await this.requireSession(token, 'STAFF', meta);
    this.requireRole(principal, 'SYSTEM_ADMIN');
    return this.write({
      meta,
      operation: 'IDENTITY_ACCOUNT_STATUS',
      principal,
      actorRole: 'SYSTEM_ADMIN',
      fingerprintPayload: { accountId, status, expectedVersion },
      action: 'ACCOUNT_STATUS_CHANGED',
      subjectType: 'ACCOUNT',
      subjectId: accountId,
      execute: async (tx) => {
        const result = await tx.query<{ version: number }>(
          `UPDATE iam.account
           SET status=$1,
               locked_at=CASE WHEN $1='LOCKED' THEN now() ELSE locked_at END,
               disabled_at=CASE WHEN $1='DISABLED' THEN now() ELSE disabled_at END,
               version=version+1
           WHERE id=$2 AND version=$3
           RETURNING version`,
          [status, accountId, expectedVersion],
        );
        if (!result.rows[0]) {
          throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
        }
        await tx.query(
          `UPDATE iam.session SET revoked_at=now()
           WHERE account_id=$1 AND revoked_at IS NULL`,
          [accountId],
        );
        return {
          businessStatus: 'ACCOUNT_STATUS_CHANGED',
          requestId: meta.requestId,
          status,
          version: result.rows[0].version,
        };
      },
    });
  }

  async saveProfile(
    token: string,
    step: string,
    expectedVersion: number,
    data: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    const principal = await this.requireSession(token, 'USER', meta);
    return this.write({
      meta,
      operation: 'ONBOARDING_PROFILE_STEP_SAVE',
      principal,
      actorRole: 'USER',
      fingerprintPayload: { step, expectedVersion, data },
      action: 'PROFILE_DRAFT_SAVED',
      subjectType: 'PROFILE',
      subjectId: principal.accountId,
      execute: async (tx) => this.saveProfileStep(tx, principal.accountId, step, expectedVersion, data, meta),
    });
  }

  async recordScreening(
    token: string,
    input: {
      userId: string;
      conclusion: 'PASS' | 'HUMAN_REVIEW' | 'EXCLUDED';
      source: 'PROFESSIONAL_RULE' | 'MANUAL_REVIEW';
      ruleVersion: string | null;
    },
    meta: RequestMeta,
  ) {
    const principal = await this.requireSession(token, 'STAFF', meta);
    let actorRole: 'NUTRITION_REVIEWER' | 'TRAINING_REVIEWER';
    try {
      actorRole = this.qualifiedReviewerRole(principal);
    } catch (error) {
      await this.auditAuthenticatedRejection(
        principal,
        'SCREENING_RECORD_REJECTED',
        'SCREENING',
        input.userId,
        meta,
        error,
      );
      throw error;
    }
    return this.write({
      meta,
      operation: 'ONBOARDING_SCREENING_RECORD',
      principal,
      actorRole,
      fingerprintPayload: input,
      action: 'SCREENING_RECORDED',
      subjectType: 'SCREENING',
      subjectId: input.userId,
      execute: async (tx) => {
        await tx.query(
          `INSERT INTO care.screening_result
             (id, user_id, conclusion, source, rule_version, recorded_by, actor_role)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), input.userId, input.conclusion, input.source, input.ruleVersion, principal.accountId, actorRole],
        );
        return {
          businessStatus: 'SCREENING_RECORDED',
          requestId: meta.requestId,
          conclusion: input.conclusion,
        };
      },
    });
  }

  private async createSession(
    principal: Principal,
    actorRole: ActorRole,
    input: { loginIdentifier: string; password: string; sessionKind: 'USER' | 'STAFF'; mfaChallengeId?: string | undefined; actingRole?: StaffRole | undefined },
    mfaVerified: boolean,
    meta: RequestMeta,
  ) {
    const operation = 'IDENTITY_SESSION_CREATE';
    const principalScope = this.principalScope(principal, actorRole);
    const fingerprint = this.fingerprint({
      loginIdentifier: input.loginIdentifier,
      sessionKind: input.sessionKind,
      actingRole: actorRole,
    });
    const credential = generateSessionCredential();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.policy!.sessionTtlSeconds * 1000);

    const created = await this.db.database.transaction(async (tx) => {
      const claim = await this.claimIdempotency(tx, meta, operation, principalScope, fingerprint);
      if (!claim) {
        throw new ConflictException(this.error(
          meta,
          'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION',
          ['LOGIN_WITH_NEW_IDEMPOTENCY_KEY'],
        ));
      }
      await tx.query(`UPDATE iam.account SET failed_attempts=0 WHERE id=$1`, [principal.accountId]);
      await tx.query(
        `INSERT INTO iam.session
           (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, principal.accountId, input.sessionKind, credential.tokenHash, mfaVerified, expiresAt, actorRole],
      );
      const projection = {
        businessStatus: 'SESSION_CREATED',
        requestId: meta.requestId,
        sessionId,
        expiresAt: expiresAt.toISOString(),
      };
      await this.completeIdempotency(tx, meta.idempotencyKey, projection);
      await this.appendAudit(tx, {
        actorId: principal.accountId,
        actorRole,
        action: 'SESSION_CREATED',
        subjectType: 'ACCOUNT',
        subjectId: principal.accountId,
        requestId: meta.requestId,
        outcome: 'SUCCEEDED',
      });
      return projection;
    });
    return { ...created, sessionToken: credential.token };
  }

  private async write<T extends Record<string, unknown>>(input: {
    meta: RequestMeta;
    operation: string;
    principal: Principal;
    actorRole: ActorRole;
    fingerprintPayload: unknown;
    action: string;
    subjectType: string;
    subjectId: string;
    execute: (tx: Sql) => Promise<T>;
  }): Promise<T> {
    const principalScope = this.principalScope(input.principal, input.actorRole);
    const fingerprint = this.fingerprint(input.fingerprintPayload);
    return this.db.database.transaction(async (tx) => {
      const claim = await this.claimIdempotency(
        tx,
        input.meta,
        input.operation,
        principalScope,
        fingerprint,
      );
      if (!claim) {
        const existing = await this.readIdempotency(tx, input.meta.idempotencyKey);
        this.assertIdempotencyScope(existing, input.operation, principalScope, fingerprint, input.meta);
        return this.parseJson(existing.result) as T;
      }
      const output = await input.execute(tx);
      await this.completeIdempotency(tx, input.meta.idempotencyKey, output);
      await this.appendAudit(tx, {
        actorId: input.principal.accountId,
        actorRole: input.actorRole,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        requestId: input.meta.requestId,
        outcome: 'SUCCEEDED',
        beforeVersionId: this.outputVersion(input.fingerprintPayload, 'expectedVersion'),
        afterVersionId: this.outputVersion(output, 'version'),
      });
      return output;
    });
  }

  private async claimIdempotency(
    tx: Sql,
    meta: RequestMeta,
    operation: string,
    principalScope: string,
    fingerprint: string,
  ): Promise<boolean> {
    const inserted = await tx.query(
      `INSERT INTO audit.idempotency_key
         (key, result_id, result, operation, principal_scope, request_fingerprint)
       VALUES ($1, $2, '{}'::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [meta.idempotencyKey, randomUUID(), operation, principalScope, fingerprint],
    );
    if (inserted.rows[0]) return true;
    const existing = await this.readIdempotency(tx, meta.idempotencyKey);
    this.assertIdempotencyScope(existing, operation, principalScope, fingerprint, meta);
    return false;
  }

  private async readIdempotency(tx: Sql, key: string): Promise<IdempotencyRow> {
    const result = await tx.query<IdempotencyRow>(
      `SELECT operation, principal_scope, request_fingerprint, result
       FROM audit.idempotency_key WHERE key=$1`,
      [key],
    );
    if (!result.rows[0]) throw new Error('IDEMPOTENCY_RECORD_NOT_FOUND');
    return result.rows[0];
  }

  private assertIdempotencyScope(
    existing: IdempotencyRow,
    operation: string,
    principalScope: string,
    fingerprint: string,
    meta: RequestMeta,
  ) {
    if (
      existing.operation !== operation
      || existing.principal_scope !== principalScope
      || existing.request_fingerprint !== fingerprint
    ) {
      throw new ConflictException(this.error(meta, 'IDEMPOTENCY_KEY_REUSED', ['USE_NEW_IDEMPOTENCY_KEY']));
    }
  }

  private async completeIdempotency(tx: Sql, key: string, output: unknown) {
    await tx.query(
      `UPDATE audit.idempotency_key SET result=$1::jsonb WHERE key=$2`,
      [JSON.stringify(output), key],
    );
  }

  private async appendAudit(tx: Sql, input: {
    actorId: string | null;
    actorRole: ActorRole;
    action: string;
    subjectType: string;
    subjectId: string;
    requestId: string;
    outcome?: 'SUCCEEDED' | 'REJECTED';
    errorCode?: string | null;
    beforeVersionId?: string | null;
    afterVersionId?: string | null;
  }) {
    await tx.query(
      `INSERT INTO audit.audit_event
         (id, actor_id, actor_role, action, subject_type, subject_id, request_id,
          outcome, error_code, before_version_id, after_version_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(), input.actorId, input.actorRole, input.action, input.subjectType,
        input.subjectId, input.requestId, input.outcome ?? 'SUCCEEDED', input.errorCode ?? null,
        input.beforeVersionId ?? null, input.afterVersionId ?? null,
      ],
    );
  }

  private async appendRejectedAudit(input: {
    actorId: string | null;
    actorRole: ActorRole;
    action: string;
    subjectType: string;
    subjectId: string;
    requestId: string;
    errorCode: string;
  }) {
    await this.db.database.transaction((tx) => this.appendAudit(tx, {
      ...input,
      outcome: 'REJECTED',
    }));
  }

  private async auditAuthenticatedRejection(
    principal: Principal,
    action: string,
    subjectType: string,
    subjectId: string,
    meta: RequestMeta,
    error: unknown,
  ) {
    await this.appendRejectedAudit({
      actorId: principal.accountId,
      actorRole: principal.activeRole ?? 'SYSTEM',
      action,
      subjectType,
      subjectId,
      requestId: meta.requestId,
      errorCode: this.errorCodeFrom(error),
    });
  }

  private errorCodeFrom(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (response && typeof response === 'object') {
        const code = (response as Record<string, unknown>).errorCode;
        if (typeof code === 'string') return code;
      }
    }
    return 'WRITE_REJECTED';
  }

  private async readCompletedReplay<T>(
    meta: RequestMeta,
    operation: string,
    principalScope: string,
    fingerprint: string,
  ): Promise<T | null> {
    const found = await this.db.database.query<IdempotencyRow>(
      `SELECT operation, principal_scope, request_fingerprint, result
       FROM audit.idempotency_key WHERE key=$1`,
      [meta.idempotencyKey],
    );
    const existing = found.rows[0];
    if (!existing) return null;
    this.assertIdempotencyScope(existing, operation, principalScope, fingerprint, meta);
    return this.parseJson(existing.result) as T;
  }

  private async recordFailedLogin(accountId: string, meta: RequestMeta) {
    await this.db.database.transaction(async (tx) => {
      const updated = await tx.query<{ failed_attempts: number }>(
        `UPDATE iam.account SET failed_attempts=failed_attempts+1
         WHERE id=$1 AND status='ACTIVE' RETURNING failed_attempts`,
        [accountId],
      );
      const locked = (updated.rows[0]?.failed_attempts ?? 0) >= this.policy!.maxFailedAttempts;
      if (locked) {
        await tx.query(
          `UPDATE iam.account SET status='LOCKED', locked_at=now(), version=version+1 WHERE id=$1`,
          [accountId],
        );
        await tx.query(
          `UPDATE iam.session SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`,
          [accountId],
        );
      }
      await this.appendAudit(tx, {
        actorId: null,
        actorRole: 'SYSTEM',
        action: locked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        subjectType: 'ACCOUNT',
        subjectId: accountId,
        requestId: meta.requestId,
        outcome: 'REJECTED',
        errorCode: locked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
      });
    });
  }

  private async saveProfileStep(
    tx: Sql,
    userId: string,
    step: string,
    expectedVersion: number,
    data: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    const existing = await tx.query<{
      version: number;
      profile_data: Record<string, unknown>;
      completed_steps: string[];
    }>(
      `SELECT version, profile_data, completed_steps
       FROM care.user_profile WHERE user_id=$1`,
      [userId],
    );
    if (!existing.rows[0]) {
      if (expectedVersion !== 0) {
        throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
      }
      await tx.query(
        `INSERT INTO care.user_profile
           (id, user_id, profile_data, completed_steps, version)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, 1)`,
        [randomUUID(), userId, JSON.stringify({ [step]: data }), JSON.stringify([step])],
      );
      return { businessStatus: 'PROFILE_DRAFT_SAVED', requestId: meta.requestId, version: 1 };
    }
    const row = existing.rows[0];
    if (row.version !== expectedVersion) {
      throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
    }
    const profile = { ...row.profile_data, [step]: data };
    const steps = Array.from(new Set([...row.completed_steps, step]));
    const saved = await tx.query<{ version: number }>(
      `UPDATE care.user_profile
       SET profile_data=$1::jsonb, completed_steps=$2::jsonb,
           version=version+1, updated_at=now()
       WHERE user_id=$3 AND version=$4 RETURNING version`,
      [JSON.stringify(profile), JSON.stringify(steps), userId, expectedVersion],
    );
    if (!saved.rows[0]) {
      throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
    }
    return {
      businessStatus: 'PROFILE_DRAFT_SAVED',
      requestId: meta.requestId,
      version: saved.rows[0].version,
    };
  }

  private invitationRole(
    principal: Principal,
    input: { accountType: 'USER' | 'STAFF'; roles: StaffRole[] },
  ): 'OPERATIONS' | 'SYSTEM_ADMIN' {
    if (principal.activeRole === 'OPERATIONS') {
      if (input.accountType === 'USER' && input.roles.length === 0) return 'OPERATIONS';
    }
    if (principal.activeRole === 'SYSTEM_ADMIN' && input.accountType === 'STAFF') {
      return 'SYSTEM_ADMIN';
    }
    throw new ForbiddenException({
      businessStatus: 'WRITE_REJECTED',
      errorCode: 'ROLE_NOT_AUTHORIZED',
      recoverableActions: [],
    });
  }

  private qualifiedReviewerRole(principal: Principal): 'NUTRITION_REVIEWER' | 'TRAINING_REVIEWER' {
    if (principal.activeRole !== 'NUTRITION_REVIEWER' && principal.activeRole !== 'TRAINING_REVIEWER') {
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'ROLE_NOT_AUTHORIZED',
        recoverableActions: [],
      });
    }
    const grant = principal.roles.find((candidate) => candidate.code === principal.activeRole);
    if (grant?.qualifiedAt) return principal.activeRole;
    throw new ForbiddenException({
      businessStatus: 'WRITE_REJECTED',
      errorCode: 'PROFESSIONAL_QUALIFICATION_REQUIRED',
      recoverableActions: [],
    });
  }

  private requireRole(principal: Principal, role: StaffRole) {
    if (principal.activeRole !== role || !this.hasRole(principal, role)) {
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'ROLE_NOT_AUTHORIZED',
        recoverableActions: [],
      });
    }
  }

  private hasRole(principal: Principal, role: StaffRole): boolean {
    return principal.roles.some((grant) => grant.code === role);
  }

  private resolveCredentialRole(principal: Principal, actingRole?: StaffRole): ActorRole {
    if (principal.accountType === 'USER') {
      if (!actingRole) return 'USER';
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'ROLE_NOT_AUTHORIZED',
        recoverableActions: [],
      });
    }
    if (!actingRole || !this.hasRole(principal, actingRole)) {
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'ROLE_NOT_AUTHORIZED',
        recoverableActions: [],
      });
    }
    return actingRole;
  }

  private async verifyMfa(principal: Principal, challengeId?: string): Promise<boolean> {
    if (principal.accountType !== 'STAFF' || !this.policy!.mfaRequiredForStaff) return false;
    if (!this.mfaVerifier) {
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'MFA_VERIFIER_UNAVAILABLE',
        recoverableActions: [],
      });
    }
    if (!challengeId || !await this.mfaVerifier.verify({ accountId: principal.accountId, challengeId })) {
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'MFA_REQUIRED',
        recoverableActions: ['COMPLETE_MFA'],
      });
    }
    return true;
  }

  private async requireSession(
    token: string,
    kind: 'USER' | 'STAFF',
    meta: RequestMeta,
  ): Promise<Principal> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.db.database.query<{ id: string; account_id: string; session_kind: string; active_role: ActorRole | null }>(
      `SELECT s.id, s.account_id, s.session_kind, s.active_role
       FROM iam.session s
       JOIN iam.account a ON a.id=s.account_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
         AND a.status='ACTIVE'`,
      [tokenHash],
    );
    const session = result.rows[0];
    if (!session || session.session_kind !== kind || !session.active_role) {
      throw new UnauthorizedException({
        businessStatus: 'SESSION_INVALID',
        errorCode: 'SESSION_INVALID',
        recoverableActions: ['LOGIN'],
      });
    }
    const account = await this.accountById(session.account_id);
    if (!account) throw new UnauthorizedException({ errorCode: 'SESSION_INVALID' });
    const principal = await this.principalForAccount(account, session.active_role);
    if (kind === 'STAFF' && !this.hasRole(principal, session.active_role as StaffRole)) {
      await this.db.database.transaction(async (tx) => {
        await tx.query(`UPDATE iam.session SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, [session.id]);
        await this.appendAudit(tx, {
          actorId: session.account_id,
          actorRole: session.active_role as StaffRole,
          action: 'SESSION_ROLE_REVOKED',
          subjectType: 'SESSION',
          subjectId: session.id,
          requestId: meta.requestId,
          outcome: 'REJECTED',
          errorCode: 'SESSION_INVALID',
        });
      });
      throw new UnauthorizedException({
        businessStatus: 'SESSION_INVALID',
        errorCode: 'SESSION_INVALID',
        recoverableActions: ['LOGIN'],
      });
    }
    return principal;
  }

  private async principalForAccount(account: AccountRow, activeRole: ActorRole | null = null): Promise<Principal> {
    const roles = account.account_type === 'STAFF'
      ? await this.db.database.query<{ code: StaffRole; qualifiedAt: Date | null }>(
          `SELECT role_code AS code, qualified_at AS "qualifiedAt"
           FROM iam.account_role WHERE account_id=$1 ORDER BY role_code`,
          [account.id],
        )
      : { rows: [] as RoleGrant[] };
    return { accountId: account.id, accountType: account.account_type, roles: roles.rows, activeRole };
  }

  private async accountById(id: string): Promise<AccountRow | undefined> {
    return (await this.db.database.query<AccountRow>(`SELECT * FROM iam.account WHERE id=$1`, [id])).rows[0];
  }

  private async accountByLogin(loginIdentifier: string): Promise<AccountRow | undefined> {
    return (await this.db.database.query<AccountRow>(
      `SELECT * FROM iam.account WHERE login_identifier=$1`,
      [loginIdentifier],
    )).rows[0];
  }

  private principalScope(principal: Principal, actorRole: ActorRole): string {
    return `${principal.accountId}:${actorRole}`;
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private parseJson(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value;
  }

  private outputVersion(value: unknown, field: string): string | null {
    if (!value || typeof value !== 'object') return null;
    const version = (value as Record<string, unknown>)[field];
    return typeof version === 'number' || typeof version === 'string' ? String(version) : null;
  }

  private requirePolicy() {
    if (!this.environment.authSecurityPolicyApproved || !this.policy?.approved) {
      throw new ServiceUnavailableException({
        businessStatus: 'IDENTITY_BLOCKED',
        errorCode: 'AUTH_SECURITY_POLICY_UNAPPROVED',
        recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      });
    }
  }

  private error(meta: RequestMeta, errorCode: string, recoverableActions: string[] = []) {
    return {
      businessStatus: 'WRITE_REJECTED',
      errorCode,
      recoverableActions,
      requestId: meta.requestId,
    };
  }
}
