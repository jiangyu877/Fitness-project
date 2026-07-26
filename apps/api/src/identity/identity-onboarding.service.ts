import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PGlite } from '@electric-sql/pglite';
import {
  generateSessionCredential,
  hashPassword,
  verifyPassword,
  type AuthSecurityPolicy,
} from '@lianban/domain';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { Environment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';
import { MFA_VERIFIER, type MfaVerifier } from './mfa-verifier.js';
import { CURRENT_CONSENT_VERSION, type CurrentConsentVersionProvider } from './current-consent-version.js';
import { CURRENT_CONSENT, PROFILE_SCHEMA, SCREENING_APPROVAL, type CurrentConsentProvider, type ProfileSchemaProvider, type ScreeningApprovalProvider, type ScreeningConclusion } from './p07-providers.js';

export const AUTH_POLICY = Symbol('AUTH_POLICY');
export const PROFILE_FINGERPRINT_SECRET = Symbol('PROFILE_FINGERPRINT_SECRET');

export type StaffRole =
  | 'OPERATIONS'
  | 'NUTRITION_REVIEWER'
  | 'TRAINING_REVIEWER'
  | 'SYSTEM_ADMIN'
  | 'AUDIT_VIEWER';
export type ActorRole = StaffRole | 'USER' | 'SYSTEM';
type RequestMeta = { requestId: string; idempotencyKey: string };
type Sql = Pick<PGlite, 'query'>;
type RoleGrant = { code: StaffRole; qualifiedAt: Date | null };
export type Principal = {
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
  version: number;
};
type PasswordChangeContext = {
  sessionId: string;
  account: AccountRow;
  expiresAt: Date;
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
    @Inject(PROFILE_FINGERPRINT_SECRET) private readonly profileFingerprintSecret: string | null,
    @Inject(CURRENT_CONSENT_VERSION) private readonly currentConsentVersion: CurrentConsentVersionProvider | null,
    @Inject(CURRENT_CONSENT) private readonly consentProvider: CurrentConsentProvider | null,
    @Inject(SCREENING_APPROVAL) private readonly screeningProvider: ScreeningApprovalProvider | null,
    @Inject(PROFILE_SCHEMA) private readonly profileSchemaProvider: ProfileSchemaProvider | null,
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
    this.requirePolicy(meta);
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
    token: string | null,
    input: { newPassword: string; expectedVersion: number },
    meta: RequestMeta,
  ) {
    this.requirePolicy(meta);
    const context = await this.requirePasswordChangeContext(token, meta);
    const passwordHash = await hashPassword(input.newPassword, this.policy!);
    const credential = generateSessionCredential();
    const fullSessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.policy!.sessionTtlSeconds * 1000);
    try {
      const output = await this.db.database.transaction(async (tx) => {
        const claimed = await this.claimIdempotency(
          tx,
          meta,
          'IDENTITY_PASSWORD_CHANGE',
          `${context.account.id}:PASSWORD_CHANGE:${context.sessionId}`,
          this.fingerprint({ expectedVersion: input.expectedVersion }),
        );
        if (!claimed) throw new UnauthorizedException(this.error(meta, 'PASSWORD_CHANGE_TOKEN_INVALID', ['LOGIN']));
        const consumed = await tx.query<{ id: string }>(
          `UPDATE iam.session SET revoked_at=now()
           WHERE id=$1 AND session_scope='PASSWORD_CHANGE' AND revoked_at IS NULL AND expires_at > now()
           RETURNING id`,
          [context.sessionId],
        );
        if (!consumed.rows[0]) throw new UnauthorizedException(this.error(meta, 'PASSWORD_CHANGE_TOKEN_INVALID', ['LOGIN']));
        const updated = await tx.query<{ version: number }>(
          `UPDATE iam.account
           SET password_hash=$1, initial_password_change_required=false,
               status='ACTIVE', password_changed_at=now(), version=version+1
           WHERE id=$2 AND version=$3 AND status='INVITED'
             AND initial_password_change_required=true
           RETURNING version`,
          [passwordHash, context.account.id, input.expectedVersion],
        );
        if (!updated.rows[0]) throw new ConflictException(this.error(meta, 'VERSION_CONFLICT', ['REFRESH']));
        await tx.query(
          `INSERT INTO iam.session
             (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
           VALUES ($1, $2, 'USER', $3, false, $4, 'USER', 'FULL')`,
          [fullSessionId, context.account.id, credential.tokenHash, expiresAt],
        );
        const projection = {
          businessStatus: 'SESSION_CREATED', requestId: meta.requestId,
          version: updated.rows[0].version, expiresAt: expiresAt.toISOString(),
          nextAction: 'ACCEPT_CURRENT_CONSENT',
        };
        await this.completeIdempotency(tx, meta.idempotencyKey, projection);
        await this.appendAudit(tx, {
          actorId: context.account.id, actorRole: 'USER', action: 'PASSWORD_CHANGED',
          subjectType: 'ACCOUNT', subjectId: context.account.id, requestId: meta.requestId,
          outcome: 'SUCCEEDED', beforeVersionId: String(input.expectedVersion),
          afterVersionId: String(updated.rows[0].version),
        });
        return projection;
      });
      return { ...output, sessionToken: credential.token };
    } catch (error) {
      if (this.errorCodeFrom(error) === 'VERSION_CONFLICT') {
        await this.auditAuthenticatedRejection(
          { accountId: context.account.id, accountType: 'USER', roles: [], activeRole: 'USER' },
          'PASSWORD_CHANGE_REJECTED', 'ACCOUNT', context.account.id, meta, error,
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
    this.requirePolicy(meta);
    const account = await this.accountByLogin(input.loginIdentifier);
    if (!account) {
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    if (!await verifyPassword(input.password, account.password_hash)) {
      await this.recordFailedLogin(account.id, meta, account.status === 'INVITED');
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    if (account.status === 'INVITED' && account.initial_password_change_required && account.account_type === 'USER') {
      if (input.sessionKind !== 'USER') {
        await this.appendRejectedAudit({
          actorId: account.id, actorRole: 'SYSTEM', action: 'SESSION_CREATION_REJECTED',
          subjectType: 'ACCOUNT', subjectId: account.id, requestId: meta.requestId,
          errorCode: 'SESSION_KIND_MISMATCH',
        });
        throw new ForbiddenException(this.error(meta, 'SESSION_KIND_MISMATCH'));
      }
      return this.createPasswordChangeContext(account, input, meta);
    }
    if (account.status !== 'ACTIVE' || account.initial_password_change_required) {
      if (account.status === 'LOCKED' || account.status === 'DISABLED') {
        await this.appendRejectedAudit({
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'SESSION_CREATION_REJECTED',
          subjectType: 'ACCOUNT',
          subjectId: account.id,
          requestId: meta.requestId,
          errorCode: account.status === 'LOCKED' ? 'ACCOUNT_LOCKED' : 'ACCOUNT_DISABLED',
        });
      }
      throw new UnauthorizedException(this.error(meta, 'INVALID_CREDENTIALS'));
    }
    const expectedKind = account.account_type === 'USER' ? 'USER' : 'STAFF';
    if (input.sessionKind !== expectedKind) {
      await this.appendRejectedAudit({
        actorId: account.id,
        actorRole: 'SYSTEM',
        action: 'SESSION_CREATION_REJECTED',
        subjectType: 'ACCOUNT',
        subjectId: account.id,
        requestId: meta.requestId,
        errorCode: 'SESSION_KIND_MISMATCH',
      });
      throw new ForbiddenException(this.error(meta, 'SESSION_KIND_MISMATCH'));
    }

    const principal = await this.principalForAccount(account);
    let actorRole: ActorRole;
    try {
      actorRole = this.resolveCredentialRole(principal, input.actingRole);
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

  async getSession(token: string | null, meta: RequestMeta) {
    const principal = await this.requireSession(token, 'USER', meta);
    const expiresAt = await this.sessionExpiry(token!);
    return {
      accountId: principal.accountId,
      accountType: principal.accountType,
      activeRole: principal.activeRole,
      expiresAt: expiresAt.toISOString(),
      businessStatus: 'SESSION_ACTIVE',
      nextAction: await this.userNextAction(principal.accountId),
    };
  }

  async getCurrentConsent(token: string | null, meta: RequestMeta) {
    await this.requireSession(token, 'USER', meta);
    if (!this.consentProvider) {
      throw new ServiceUnavailableException(this.error(meta, 'CURRENT_CONSENT_VERSION_UNAVAILABLE', ['WAIT_FOR_SECURITY_APPROVAL']));
    }
    const consent = await this.consentProvider.getCurrentConsent();
    return { businessStatus: 'CURRENT_CONSENT_AVAILABLE', consentVersion: consent.version, content: consent.content };
  }

  async getScreeningStatus(token: string | null, meta: RequestMeta) {
    const principal = await this.requireSession(token, 'USER', meta);
    const state = await this.screeningState(principal.accountId);
    return { businessStatus: 'SCREENING_STATUS_AVAILABLE', conclusion: state.conclusion, nextAction: state.nextAction };
  }

  async getProfile(token: string | null, meta: RequestMeta) {
    const principal = await this.requireSession(token, 'USER', meta);
    const schema = await this.requireProfileAccess(principal.accountId, meta);
    const result = await this.db.database.query<{ version: number; schema_version: string | null; profile_data: Record<string, unknown>; completed_steps: string[] }>(
      `SELECT version, schema_version, profile_data, completed_steps FROM care.user_profile WHERE user_id=$1`, [principal.accountId],
    );
    const row = result.rows[0];
    if (row && (!row.schema_version || row.schema_version !== schema.version)) {
      throw new ConflictException(this.error(meta, 'PROFILE_SCHEMA_VERSION_REQUIRED', ['REFRESH']));
    }
    const completedSteps = row?.completed_steps ?? [];
    return {
      businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion: schema.version,
      steps: schema.steps,
      recordVersion: row?.version ?? 0, completedSteps,
      currentStep: schema.steps.find((step) => !completedSteps.includes(step.id))?.id ?? null,
      drafts: row?.profile_data ?? {},
    };
  }

  async logout(token: string | null, meta: RequestMeta) {
    this.requirePolicy(meta);
    const tokenHash = token ? createHash('sha256').update(token).digest('hex') : null;
    const found = tokenHash ? await this.db.database.query<{ id: string; account_id: string; active_role: ActorRole | null; session_scope: string }>(
      `SELECT id, account_id, active_role, session_scope FROM iam.session
       WHERE token_hash=$1`,
      [tokenHash],
    ) : { rows: [] };
    const session = found.rows[0];
    if (!session || !session.active_role || session.session_scope !== 'FULL') {
      await this.appendRejectedAudit({
        actorId: session?.account_id ?? null,
        actorRole: session?.active_role ?? 'SYSTEM',
        action: 'SESSION_END_REJECTED',
        subjectType: 'SESSION',
        subjectId: session?.id ?? tokenHash ?? 'ANONYMOUS',
        requestId: meta.requestId,
        errorCode: 'SESSION_INVALID',
      });
      throw new UnauthorizedException(this.error(meta, 'SESSION_INVALID', ['LOGIN']));
    }
    const activeRole = session.active_role;
    await this.db.database.transaction(async (tx) => {
      const revoked = await tx.query<{ id: string }>(
        `UPDATE iam.session SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id`,
        [session.id],
      );
      if (revoked.rows[0]) {
        await this.appendAudit(tx, {
          actorId: session.account_id, actorRole: activeRole,
          action: 'SESSION_ENDED', subjectType: 'SESSION', subjectId: session.id,
          requestId: meta.requestId, outcome: 'SUCCEEDED',
        });
      }
    });
    return { businessStatus: 'SESSION_ENDED', requestId: meta.requestId };
  }

  async acceptConsent(token: string | null, consentVersion: string, meta: RequestMeta) {
    const principal = await this.requireSession(token, 'USER', meta);
    const currentVersion = await this.requireCurrentConsentVersion(meta);
    if (consentVersion !== currentVersion) {
      throw new ConflictException(this.error(meta, 'CURRENT_CONSENT_VERSION_REQUIRED', ['REFRESH']));
    }
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

  async withdrawConsent(token: string | null, consentId: string, expectedVersion: number, meta: RequestMeta) {
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
    token: string | null,
    accountId: string,
    status: 'LOCKED' | 'DISABLED',
    expectedVersion: number,
    meta: RequestMeta,
  ) {
    const principal = await this.requireSession(token, 'STAFF', meta);
    try {
      this.requireRole(principal, 'SYSTEM_ADMIN');
    } catch (error) {
      await this.auditAuthenticatedRejection(
        principal,
        'ACCOUNT_STATUS_CHANGE_REJECTED',
        'ACCOUNT',
        accountId,
        meta,
        error,
      );
      throw error;
    }
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
    token: string | null,
    step: string,
    schemaVersion: string | null,
    expectedVersion: number,
    data: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    const principal = await this.requireSession(token, 'USER', meta);
    const schema = await this.requireProfileAccess(principal.accountId, meta);
    if (schemaVersion !== schema.version) {
      throw new ConflictException(this.error(meta, 'PROFILE_SCHEMA_VERSION_REQUIRED', ['REFRESH']));
    }
    this.validateProfileData(schema, step, data, meta);
    return this.write({
      meta,
      operation: 'ONBOARDING_PROFILE_STEP_SAVE',
      principal,
      actorRole: 'USER',
      fingerprintPayload: this.profileFingerprintPayload(step, expectedVersion, data),
      action: 'PROFILE_DRAFT_SAVED',
      subjectType: 'PROFILE',
      subjectId: principal.accountId,
      execute: async (tx) => this.saveProfileStep(tx, principal.accountId, step, schema.version, expectedVersion, data, meta),
    });
  }

  async recordScreening(
    token: string | null,
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
      const target = await this.accountById(input.userId);
      if (!target || target.account_type !== 'USER') {
        throw new ForbiddenException({
          businessStatus: 'WRITE_REJECTED',
          errorCode: 'SCREENING_TARGET_USER_REQUIRED',
          recoverableActions: [],
          requestId: meta.requestId,
        });
      }
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
        await tx.query(`SELECT id FROM iam.account WHERE id=$1 FOR UPDATE`, [input.userId]);
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

  async authorizeSession(
    token: string | null,
    kind: 'USER' | 'STAFF',
    meta: RequestMeta,
  ): Promise<Principal> {
    return this.requireSession(token, kind, meta);
  }

  async authorizeAnySession(token: string | null, meta: RequestMeta): Promise<Principal> {
    return this.requireSession(token, null, meta);
  }

  async planReadiness(userId: string, sql: Sql = this.db.database): Promise<{ allowed: boolean; reason: string }> {
    if (!this.consentProvider || !this.screeningProvider || !this.profileSchemaProvider) {
      return { allowed: false, reason: 'ONBOARDING_PROVIDER_UNAVAILABLE' };
    }
    const current = await this.consentProvider.getCurrentConsent();
    const consent = await sql.query<{ accepted: boolean }>(
      `SELECT exists(SELECT 1 FROM care.consent_record WHERE user_id=$1 AND consent_version=$2 AND withdrawn_at IS NULL) AS accepted`,
      [userId, current.version],
    );
    if (!consent.rows[0]?.accepted) return { allowed: false, reason: 'CONSENT_REQUIRED' };
    const state = await this.screeningState(userId, sql);
    if (state.conclusion !== 'PASS') return { allowed: false, reason: state.nextAction };
    const schema = await this.profileSchemaProvider.getApprovedProfileSchema();
    const profile = await sql.query<{ completed_steps: string[]; schema_version: string | null }>(
      `SELECT completed_steps, schema_version FROM care.user_profile WHERE user_id=$1`, [userId],
    );
    const row = profile.rows[0];
    if (!row || row.schema_version !== schema.version || !schema.steps.every((step) => row.completed_steps.includes(step.id))) {
      return { allowed: false, reason: 'PROFILE_INCOMPLETE' };
    }
    return { allowed: true, reason: 'READY' };
  }

  async auditAuthorizationRejection(
    principal: Principal,
    action: string,
    subjectType: string,
    subjectId: string,
    meta: RequestMeta,
    errorCode: string,
  ): Promise<void> {
    await this.appendRejectedAudit({
      actorId: principal.accountId,
      actorRole: principal.activeRole ?? 'SYSTEM',
      action,
      subjectType,
      subjectId,
      requestId: meta.requestId,
      errorCode,
    });
  }

  private async createPasswordChangeContext(
    account: AccountRow,
    input: { loginIdentifier: string; password: string; sessionKind: 'USER' | 'STAFF' },
    meta: RequestMeta,
  ) {
    const credential = generateSessionCredential();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.passwordChangeTtlSeconds(meta) * 1000);
    const principalScope = `${account.id}:PASSWORD_CHANGE`;
    const fingerprint = this.fingerprint({ loginIdentifier: input.loginIdentifier, sessionKind: input.sessionKind });
    const projection = await this.db.database.transaction(async (tx) => {
      const claimed = await this.claimIdempotency(
        tx, meta, 'IDENTITY_PASSWORD_CHANGE_CONTEXT_CREATE', principalScope, fingerprint,
      );
      if (!claimed) {
        throw new ConflictException(this.error(
          meta, 'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION', ['LOGIN_WITH_NEW_IDEMPOTENCY_KEY'],
        ));
      }
      await tx.query(`UPDATE iam.account SET failed_attempts=0 WHERE id=$1`, [account.id]);
      await tx.query(
        `INSERT INTO iam.session
           (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
         VALUES ($1, $2, 'USER', $3, false, $4, 'USER', 'PASSWORD_CHANGE')`,
        [sessionId, account.id, credential.tokenHash, expiresAt],
      );
      const output = {
        businessStatus: 'PASSWORD_CHANGE_REQUIRED', requestId: meta.requestId,
        sessionType: 'PASSWORD_CHANGE',
        expiresAt: expiresAt.toISOString(), expectedVersion: account.version,
        nextAction: 'CHANGE_INITIAL_PASSWORD',
      };
      await this.completeIdempotency(tx, meta.idempotencyKey, output);
      await this.appendAudit(tx, {
        actorId: account.id, actorRole: 'USER', action: 'PASSWORD_CHANGE_CONTEXT_CREATED',
        subjectType: 'SESSION', subjectId: sessionId, requestId: meta.requestId, outcome: 'SUCCEEDED',
      });
      return output;
    });
    return { ...projection, passwordChangeToken: credential.token };
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
        sessionType: input.sessionKind,
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
    return {
      ...created,
      sessionToken: credential.token,
      ...(input.sessionKind === 'USER' ? { nextAction: await this.userNextAction(principal.accountId) } : {}),
    };
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

  private async recordFailedLogin(accountId: string, meta: RequestMeta, allowInvited = false) {
    await this.db.database.transaction(async (tx) => {
      const updated = await tx.query<{ failed_attempts: number }>(
        `UPDATE iam.account SET failed_attempts=failed_attempts+1
         WHERE id=$1 AND status = ANY($2::text[]) RETURNING failed_attempts`,
        [accountId, allowInvited ? ['ACTIVE', 'INVITED'] : ['ACTIVE']],
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
    schemaVersion: string,
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
           (id, user_id, profile_data, completed_steps, version, schema_version)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, 1, $5)`,
        [randomUUID(), userId, JSON.stringify({ [step]: data }), JSON.stringify([step]), schemaVersion],
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
       SET profile_data=$1::jsonb, completed_steps=$2::jsonb, schema_version=$5,
           version=version+1, updated_at=now()
       WHERE user_id=$3 AND version=$4 RETURNING version`,
      [JSON.stringify(profile), JSON.stringify(steps), userId, expectedVersion, schemaVersion],
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

  private async requirePasswordChangeContext(token: string | null, meta: RequestMeta): Promise<PasswordChangeContext> {
    if (!token) throw new UnauthorizedException(this.error(meta, 'PASSWORD_CHANGE_TOKEN_INVALID', ['LOGIN']));
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.db.database.query<{
      id: string; expires_at: Date; revoked_at: Date | null; account_id: string;
      status: AccountRow['status']; initial_password_change_required: boolean;
    }>(
      `SELECT s.id, s.expires_at, s.revoked_at, s.account_id, a.status, a.initial_password_change_required
       FROM iam.session s JOIN iam.account a ON a.id=s.account_id
       WHERE s.token_hash=$1 AND s.session_scope='PASSWORD_CHANGE'`,
      [tokenHash],
    );
    const session = result.rows[0];
    const account = session ? await this.accountById(session.account_id) : undefined;
    if (!session || !account || session.revoked_at || session.expires_at <= new Date()
      || session.status !== 'INVITED' || !session.initial_password_change_required) {
      await this.appendRejectedAudit({
        actorId: session?.account_id ?? null,
        actorRole: session ? 'USER' : 'SYSTEM',
        action: 'PASSWORD_CHANGE_REJECTED', subjectType: 'SESSION',
        subjectId: session?.id ?? tokenHash, requestId: meta.requestId,
        errorCode: 'PASSWORD_CHANGE_TOKEN_INVALID',
      });
      throw new UnauthorizedException(this.error(meta, 'PASSWORD_CHANGE_TOKEN_INVALID', ['LOGIN']));
    }
    return { sessionId: session.id, account, expiresAt: session.expires_at };
  }

  private async sessionExpiry(token: string): Promise<Date> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.db.database.query<{ expires_at: Date }>(
      `SELECT expires_at FROM iam.session
       WHERE token_hash=$1 AND session_scope='FULL' AND revoked_at IS NULL`,
      [tokenHash],
    );
    const expiresAt = result.rows[0]?.expires_at;
    if (!expiresAt) throw new UnauthorizedException({ errorCode: 'SESSION_INVALID' });
    return expiresAt;
  }

  private async userNextAction(accountId: string): Promise<
    'ACCEPT_CURRENT_CONSENT' | 'WAIT_FOR_SCREENING_RULES' | 'WAIT_FOR_HUMAN_REVIEW' | 'STOP_SERVICE_FLOW' | 'COMPLETE_PROFILE' | 'WAIT_FOR_PLAN' | 'CONTACT_OPERATIONS'
  > {
    if (!this.currentConsentVersion) return 'CONTACT_OPERATIONS';
    let currentVersion: string;
    try {
      currentVersion = await this.currentConsentVersion.getCurrentConsentVersion();
    } catch {
      return 'CONTACT_OPERATIONS';
    }
    const consent = await this.db.database.query<{ accepted: boolean }>(
      `SELECT exists(
         SELECT 1 FROM care.consent_record
         WHERE user_id=$1 AND consent_version=$2 AND withdrawn_at IS NULL
       ) AS accepted`,
      [accountId, currentVersion],
    );
    if (!consent.rows[0]?.accepted) return 'ACCEPT_CURRENT_CONSENT';
    if (!this.environment.professionalRulesApproved || !this.screeningProvider) return 'WAIT_FOR_SCREENING_RULES';
    const state = await this.screeningState(accountId);
    if (state.nextAction !== 'COMPLETE_PROFILE') return state.nextAction;
    if (!this.profileSchemaProvider) return 'CONTACT_OPERATIONS';
    const schema = await this.profileSchemaProvider.getApprovedProfileSchema();
    const profile = await this.db.database.query<{ completed_steps: string[]; schema_version: string | null }>(
      `SELECT completed_steps, schema_version FROM care.user_profile WHERE user_id=$1`, [accountId],
    );
    const row = profile.rows[0];
    if (row && (!row.schema_version || row.schema_version !== schema.version)) return 'CONTACT_OPERATIONS';
    return schema.steps.every((step) => row?.completed_steps.includes(step.id)) ? 'WAIT_FOR_PLAN' : 'COMPLETE_PROFILE';
  }

  private async screeningState(accountId: string, sql: Sql = this.db.database): Promise<{ conclusion: ScreeningConclusion | null; nextAction: 'WAIT_FOR_SCREENING_RULES' | 'WAIT_FOR_HUMAN_REVIEW' | 'STOP_SERVICE_FLOW' | 'COMPLETE_PROFILE' | 'CONTACT_OPERATIONS' }> {
    if (!this.environment.professionalRulesApproved || !this.screeningProvider) {
      return { conclusion: null, nextAction: 'WAIT_FOR_SCREENING_RULES' };
    }
    const result = await sql.query<{
      conclusion: ScreeningConclusion; source: string; rule_version: string | null;
      recorded_by: string; actor_role: string; account_type: string | null;
      recorder_status: string | null; qualified_at: Date | null;
    }>(
      `SELECT sr.conclusion, sr.source, sr.rule_version, sr.recorded_by, sr.actor_role,
              a.account_type, a.status AS recorder_status, ar.qualified_at
       FROM care.screening_result sr
       LEFT JOIN iam.account a ON a.id=sr.recorded_by
       LEFT JOIN iam.account_role ar ON ar.account_id=sr.recorded_by AND ar.role_code=sr.actor_role
       WHERE sr.user_id=$1 ORDER BY sr.created_at DESC, sr.id DESC LIMIT 1`, [accountId],
    );
    const row = result.rows[0];
    if (!row) return { conclusion: null, nextAction: 'WAIT_FOR_SCREENING_RULES' };
    if (row.account_type !== 'STAFF' || row.recorder_status !== 'ACTIVE' || !row.qualified_at
      || (row.actor_role !== 'NUTRITION_REVIEWER' && row.actor_role !== 'TRAINING_REVIEWER')) {
      return { conclusion: null, nextAction: 'CONTACT_OPERATIONS' };
    }
    try {
      const approved = await this.screeningProvider.isApprovedConclusion({
        source: row.source, ruleVersion: row.rule_version, conclusion: row.conclusion,
        recordedBy: row.recorded_by, actorRole: row.actor_role, qualifiedAt: row.qualified_at,
      });
      if (!approved) return { conclusion: null, nextAction: 'CONTACT_OPERATIONS' };
    } catch {
      return { conclusion: null, nextAction: 'CONTACT_OPERATIONS' };
    }
    if (row.conclusion === 'HUMAN_REVIEW') return { conclusion: row.conclusion, nextAction: 'WAIT_FOR_HUMAN_REVIEW' };
    if (row.conclusion === 'EXCLUDED') return { conclusion: row.conclusion, nextAction: 'STOP_SERVICE_FLOW' };
    return { conclusion: row.conclusion, nextAction: 'COMPLETE_PROFILE' };
  }

  private async requireProfileAccess(accountId: string, meta: RequestMeta) {
    const nextAction = await this.userNextAction(accountId);
    if (nextAction !== 'COMPLETE_PROFILE' && nextAction !== 'WAIT_FOR_PLAN') {
      throw new ServiceUnavailableException(this.error(meta, 'PROFILE_ACCESS_NOT_APPROVED', ['WAIT_FOR_SECURITY_APPROVAL']));
    }
    if (!this.profileSchemaProvider) {
      throw new ServiceUnavailableException(this.error(meta, 'PROFILE_SCHEMA_UNAVAILABLE', ['WAIT_FOR_SECURITY_APPROVAL']));
    }
    return this.profileSchemaProvider.getApprovedProfileSchema();
  }

  private validateProfileData(schema: Awaited<ReturnType<ProfileSchemaProvider['getApprovedProfileSchema']>>, stepId: string, data: Record<string, unknown>, meta: RequestMeta): void {
    try {
      const step = schema.steps.find((candidate) => candidate.id === stepId);
      const invalid = !step || Object.keys(data).some((key) => !step.fields.some((field) => field.name === key))
        || (!!step && step.fields.some((field) => field.required && !(field.name in data)))
        || (!!step && step.fields.some((field) => field.name in data && typeof data[field.name] !== field.type.toLowerCase()));
      if (invalid) throw new Error('PROFILE_SCHEMA_VALIDATION_FAILED');
    } catch {
      throw new UnprocessableEntityException(this.error(meta, 'PROFILE_SCHEMA_VALIDATION_FAILED', []));
    }
  }

  private async requireCurrentConsentVersion(meta: RequestMeta): Promise<string> {
    if (!this.currentConsentVersion) {
      throw new ServiceUnavailableException(this.error(meta, 'CURRENT_CONSENT_VERSION_UNAVAILABLE', ['WAIT_FOR_SECURITY_APPROVAL']));
    }
    try {
      const version = await this.currentConsentVersion.getCurrentConsentVersion();
      if (version) return version;
    } catch {
      // Provider failures are indistinguishable from an unavailable current version.
    }
    throw new ServiceUnavailableException(this.error(meta, 'CURRENT_CONSENT_VERSION_UNAVAILABLE', ['WAIT_FOR_SECURITY_APPROVAL']));
  }

  private async requireSession(
    token: string | null,
    kind: 'USER' | 'STAFF' | null,
    meta: RequestMeta,
  ): Promise<Principal> {
    this.requirePolicy(meta);
    if (!token) {
      await this.appendRejectedAudit({
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'SESSION_AUTHENTICATION_REJECTED',
        subjectType: 'SESSION',
        subjectId: 'ANONYMOUS',
        requestId: meta.requestId,
        errorCode: 'SESSION_INVALID',
      });
      throw new UnauthorizedException(this.error(meta, 'SESSION_INVALID', ['LOGIN']));
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.db.database.query<{ id: string; account_id: string; session_kind: string; session_scope: string; active_role: ActorRole | null; mfa_verified: boolean; revoked_at: Date | null; expires_at: Date; status: AccountRow['status'] }>(
      `SELECT s.id, s.account_id, s.session_kind, s.session_scope, s.active_role, s.mfa_verified, s.revoked_at, s.expires_at, a.status
       FROM iam.session s
       JOIN iam.account a ON a.id=s.account_id
       WHERE s.token_hash=$1`,
      [tokenHash],
    );
    const session = result.rows[0];
    if (!session || session.session_scope !== 'FULL' || session.revoked_at || session.expires_at <= new Date() || session.status !== 'ACTIVE' || (kind !== null && session.session_kind !== kind) || !session.active_role) {
      await this.appendRejectedAudit({
        actorId: session?.account_id ?? null,
        actorRole: session?.active_role ?? 'SYSTEM',
        action: 'SESSION_AUTHENTICATION_REJECTED',
        subjectType: 'SESSION',
        subjectId: session?.id ?? tokenHash,
        requestId: meta.requestId,
        errorCode: 'SESSION_INVALID',
      });
      throw new UnauthorizedException(this.error(meta, 'SESSION_INVALID', ['LOGIN']));
    }
    if (session.session_kind === 'STAFF' && this.policy!.mfaRequiredForStaff && !session.mfa_verified) {
      await this.db.database.transaction(async (tx) => {
        await tx.query(`UPDATE iam.session SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, [session.id]);
        await this.appendAudit(tx, {
          actorId: session.account_id,
          actorRole: session.active_role as StaffRole,
          action: 'SESSION_MFA_REQUIRED',
          subjectType: 'SESSION',
          subjectId: session.id,
          requestId: meta.requestId,
          outcome: 'REJECTED',
          errorCode: 'MFA_REQUIRED',
        });
      });
      throw new ForbiddenException(this.error(meta, 'MFA_REQUIRED', ['COMPLETE_MFA']));
    }
    const account = await this.accountById(session.account_id);
    if (!account) throw new UnauthorizedException(this.error(meta, 'SESSION_INVALID', ['LOGIN']));
    const principal = await this.principalForAccount(account, session.active_role);
    if (session.session_kind === 'STAFF' && !this.hasRole(principal, session.active_role as StaffRole)) {
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
      throw new UnauthorizedException(this.error(meta, 'SESSION_INVALID', ['LOGIN']));
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

  private profileFingerprintPayload(step: string, expectedVersion: number, data: Record<string, unknown>): { profileFingerprint: string } {
    if (!this.profileFingerprintSecret) {
      throw new ServiceUnavailableException({
        businessStatus: 'IDENTITY_BLOCKED',
        errorCode: 'IDEMPOTENCY_FINGERPRINT_KEY_UNAVAILABLE',
        recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      });
    }
    return {
      profileFingerprint: createHmac('sha256', this.profileFingerprintSecret)
        .update(stableJson({ step, expectedVersion, data }))
        .digest('hex'),
    };
  }

  private parseJson(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value;
  }

  private outputVersion(value: unknown, field: string): string | null {
    if (!value || typeof value !== 'object') return null;
    const version = (value as Record<string, unknown>)[field];
    return typeof version === 'number' || typeof version === 'string' ? String(version) : null;
  }

  private requirePolicy(meta?: RequestMeta) {
    if (!this.environment.authSecurityPolicyApproved || !this.policy?.approved) {
      throw new ServiceUnavailableException({
        businessStatus: 'IDENTITY_BLOCKED',
        errorCode: 'AUTH_SECURITY_POLICY_UNAPPROVED',
        recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
        ...(meta ? { requestId: meta.requestId } : {}),
      });
    }
  }

  private passwordChangeTtlSeconds(meta: RequestMeta): number {
    const ttl = this.policy?.passwordChangeTtlSeconds;
    if (!Number.isInteger(ttl) || !ttl || ttl > 600 || ttl >= this.policy!.sessionTtlSeconds) {
      throw new ServiceUnavailableException({
        businessStatus: 'IDENTITY_BLOCKED',
        errorCode: 'PASSWORD_CHANGE_TTL_POLICY_INVALID',
        recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
        requestId: meta.requestId,
      });
    }
    return ttl;
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
