import { Inject, Injectable, ServiceUnavailableException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { generateSessionCredential, hashPassword, verifyPassword, type AuthSecurityPolicy } from '@lianban/domain';
import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import type { Environment } from '../config/environment.js';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';
import { DatabaseService } from '../database/database.service.js';

export const AUTH_POLICY = Symbol('AUTH_POLICY');
type ActorRole = 'OPERATIONS'|'NUTRITION_REVIEWER'|'TRAINING_REVIEWER'|'SYSTEM_ADMIN'|'AUDIT_VIEWER'|'USER';
type WriteMeta = { requestId: string; idempotencyKey: string; actorId: string; actorRole: ActorRole };
type Sql = Pick<PGlite, 'query'>;

@Injectable()
export class IdentityOnboardingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(AUTH_POLICY) private readonly policy: AuthSecurityPolicy | null,
  ) {}

  async invite(input: { accountId:string; loginIdentifier:string; accountType:'USER'|'STAFF'; roles:string[]; initialPassword:string }, meta: WriteMeta) {
    this.requirePolicy();
    const passwordHash = await hashPassword(input.initialPassword, this.policy!);
    return this.write(meta, 'ACCOUNT_INVITED', 'ACCOUNT', input.accountId, async (tx) => {
      await tx.query(`INSERT INTO iam.account (id,login_identifier,password_hash,account_type) VALUES ($1,$2,$3,$4)`, [input.accountId,input.loginIdentifier,passwordHash,input.accountType]);
      for (const role of input.roles) await tx.query(`INSERT INTO iam.account_role (account_id,role_code) VALUES ($1,$2)`, [input.accountId,role]);
      return { businessStatus:'ACCOUNT_INVITED', requestId:meta.requestId, accountId:input.accountId, version:1 };
    });
  }

  async changePassword(input:{accountId:string;currentPassword:string;newPassword:string;expectedVersion:number}, meta:WriteMeta) {
    this.requirePolicy();
    const account = await this.accountById(input.accountId);
    if (!account || !await verifyPassword(input.currentPassword, account.password_hash)) throw new UnauthorizedException(this.error(meta,'INVALID_CREDENTIALS'));
    const passwordHash = await hashPassword(input.newPassword,this.policy!);
    return this.write(meta,'PASSWORD_CHANGED','ACCOUNT',input.accountId,async tx => {
      const result = await tx.query(`UPDATE iam.account SET password_hash=$1,initial_password_change_required=false,status='ACTIVE',password_changed_at=now(),version=version+1 WHERE id=$2 AND version=$3 RETURNING version`,[passwordHash,input.accountId,input.expectedVersion]);
      if (!result.rows[0]) throw new ConflictException(this.error(meta,'VERSION_CONFLICT',['REFRESH']));
      return {businessStatus:'PASSWORD_CHANGED',requestId:meta.requestId,version:(result.rows[0] as {version:number}).version};
    });
  }

  async login(input:{loginIdentifier:string;password:string;sessionKind:'USER'|'STAFF';mfaVerified:boolean},meta:WriteMeta){
    this.requirePolicy();
    const result=await this.db.database.query<any>(`SELECT * FROM iam.account WHERE login_identifier=$1`,[input.loginIdentifier]); const account=result.rows[0];
    if(!account||account.status!=='ACTIVE'||account.initial_password_change_required) throw new UnauthorizedException(this.error(meta,'INVALID_CREDENTIALS'));
    if (!await verifyPassword(input.password, account.password_hash)) {
      await this.recordFailedLogin(account.id, meta);
      throw new UnauthorizedException(this.error(meta,'INVALID_CREDENTIALS'));
    }
    const expectedKind=account.account_type==='USER'?'USER':'STAFF'; if(input.sessionKind!==expectedKind) throw new ForbiddenException(this.error(meta,'SESSION_KIND_MISMATCH'));
    if(input.sessionKind==='STAFF'&&this.policy!.mfaRequiredForStaff&&!input.mfaVerified) throw new ForbiddenException(this.error(meta,'MFA_REQUIRED'));
    const credential=generateSessionCredential(); const expiresAt=new Date(Date.now()+this.policy!.sessionTtlSeconds*1000);
    return this.write(meta,'SESSION_CREATED','ACCOUNT',account.id,async tx=>{await tx.query(`UPDATE iam.account SET failed_attempts=0 WHERE id=$1`,[account.id]);await tx.query(`INSERT INTO iam.session (id,account_id,session_kind,token_hash,mfa_verified,expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,[randomUUID(),account.id,input.sessionKind,credential.tokenHash,input.mfaVerified,expiresAt]);return {businessStatus:'SESSION_CREATED',requestId:meta.requestId,sessionToken:credential.token,expiresAt:expiresAt.toISOString()};});
  }

  async acceptConsent(token:string, consentVersion:string, meta:WriteMeta){const session=await this.session(token,'USER');this.assertActor(session,meta,['USER']);const consentId=randomUUID();return this.write(meta,'CONSENT_ACCEPTED','CONSENT',consentId,async tx=>{await tx.query(`INSERT INTO care.consent_record (id,user_id,consent_version,accepted_at) VALUES ($1,$2,$3,now())`,[consentId,session.accountId,consentVersion]);return {businessStatus:'CONSENT_ACCEPTED',requestId:meta.requestId,consentId,consentVersion,version:1};});}

  async withdrawConsent(token:string,consentId:string,expectedVersion:number,meta:WriteMeta){const session=await this.session(token,'USER');this.assertActor(session,meta,['USER']);return this.write(meta,'CONSENT_WITHDRAWN','CONSENT',consentId,async tx=>{const result=await tx.query<any>(`UPDATE care.consent_record SET withdrawn_at=now(),record_version=record_version+1 WHERE id=$1 AND user_id=$2 AND record_version=$3 AND withdrawn_at IS NULL RETURNING record_version`,[consentId,session.accountId,expectedVersion]);if(!result.rows[0])throw new ConflictException(this.error(meta,'VERSION_CONFLICT',['REFRESH']));return{businessStatus:'CONSENT_WITHDRAWN',requestId:meta.requestId,consentId,version:result.rows[0].record_version};});}

  async setAccountStatus(token:string,accountId:string,status:'LOCKED'|'DISABLED',expectedVersion:number,meta:WriteMeta){const session=await this.session(token,'STAFF');this.assertActor(session,meta,['SYSTEM_ADMIN']);return this.write(meta,'ACCOUNT_STATUS_CHANGED','ACCOUNT',accountId,async tx=>{const result=await tx.query<any>(`UPDATE iam.account SET status=$1,locked_at=CASE WHEN $1='LOCKED' THEN now() ELSE locked_at END,disabled_at=CASE WHEN $1='DISABLED' THEN now() ELSE disabled_at END,version=version+1 WHERE id=$2 AND version=$3 RETURNING version`,[status,accountId,expectedVersion]);if(!result.rows[0])throw new ConflictException(this.error(meta,'VERSION_CONFLICT',['REFRESH']));await tx.query(`UPDATE iam.session SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`,[accountId]);return{businessStatus:'ACCOUNT_STATUS_CHANGED',requestId:meta.requestId,status,version:result.rows[0].version};});}

  async saveProfile(token:string,step:string,expectedVersion:number,data:Record<string,unknown>,meta:WriteMeta){const session=await this.session(token,'USER');this.assertActor(session,meta,['USER']);return this.write(meta,'PROFILE_DRAFT_SAVED','PROFILE',session.accountId,async tx=>{const existing=await tx.query<any>(`SELECT id,version,profile_data,completed_steps FROM care.user_profile WHERE user_id=$1`,[session.accountId]);if(!existing.rows[0]){if(expectedVersion!==0)throw new ConflictException(this.error(meta,'VERSION_CONFLICT',['REFRESH']));await tx.query(`INSERT INTO care.user_profile (id,user_id,profile_data,completed_steps,version) VALUES ($1,$2,$3::jsonb,$4::jsonb,1)`,[randomUUID(),session.accountId,JSON.stringify({[step]:data}),JSON.stringify([step])]);return {businessStatus:'PROFILE_DRAFT_SAVED',requestId:meta.requestId,version:1};}const row=existing.rows[0];if(row.version!==expectedVersion)throw new ConflictException(this.error(meta,'VERSION_CONFLICT',['REFRESH']));const profile={...(row.profile_data as object),[step]:data};const steps=Array.from(new Set([...(row.completed_steps as string[]),step]));const saved=await tx.query<any>(`UPDATE care.user_profile SET profile_data=$1::jsonb,completed_steps=$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$3 AND version=$4 RETURNING version`,[JSON.stringify(profile),JSON.stringify(steps),session.accountId,expectedVersion]);if(!saved.rows[0])throw new ConflictException(this.error(meta,'VERSION_CONFLICT',['REFRESH']));return {businessStatus:'PROFILE_DRAFT_SAVED',requestId:meta.requestId,version:saved.rows[0].version};});}

  async recordScreening(token:string,input:{userId:string;conclusion:'PASS'|'HUMAN_REVIEW'|'EXCLUDED';source:'PROFESSIONAL_RULE'|'MANUAL_REVIEW';ruleVersion:string|null},meta:WriteMeta){const session=await this.session(token,'STAFF');this.assertActor(session,meta,['NUTRITION_REVIEWER','TRAINING_REVIEWER']);return this.write(meta,'SCREENING_RECORDED','SCREENING',input.userId,async tx=>{await tx.query(`INSERT INTO care.screening_result (id,user_id,conclusion,source,rule_version,recorded_by,actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),input.userId,input.conclusion,input.source,input.ruleVersion,session.accountId,meta.actorRole]);return {businessStatus:'SCREENING_RECORDED',requestId:meta.requestId,conclusion:input.conclusion};});}

  private requirePolicy(){if(!this.environment.authSecurityPolicyApproved||!this.policy?.approved)throw new ServiceUnavailableException({businessStatus:'IDENTITY_BLOCKED',errorCode:'AUTH_SECURITY_POLICY_UNAPPROVED',recoverableActions:['WAIT_FOR_SECURITY_APPROVAL']});}
  private async accountById(id:string){return (await this.db.database.query<any>(`SELECT * FROM iam.account WHERE id=$1`,[id])).rows[0];}
  private async session(token:string,kind:'USER'|'STAFF'){const hash=createHash('sha256').update(token).digest('hex');const result=await this.db.database.query<any>(`SELECT s.account_id AS "accountId",s.session_kind,a.status,array_remove(array_agg(ar.role_code),NULL) roles FROM iam.session s JOIN iam.account a ON a.id=s.account_id LEFT JOIN iam.account_role ar ON ar.account_id=a.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() GROUP BY s.account_id,s.session_kind,a.status`,[hash]);const row=result.rows[0];if(!row||row.status!=='ACTIVE'||row.session_kind!==kind)throw new UnauthorizedException({businessStatus:'SESSION_INVALID',errorCode:'SESSION_INVALID',recoverableActions:['LOGIN']});return row as {accountId:string;roles:string[]};}
  private error(meta:WriteMeta,errorCode:string,recoverableActions:string[]=[]){return{businessStatus:'WRITE_REJECTED',errorCode,recoverableActions,requestId:meta.requestId};}
  private assertActor(session:{accountId:string;roles:string[]},meta:WriteMeta,allowed:ActorRole[]){
    const roleMatches=meta.actorRole==='USER'||session.roles.includes(meta.actorRole);
    if(session.accountId!==meta.actorId||!allowed.includes(meta.actorRole)||!roleMatches)throw new ForbiddenException(this.error(meta,'ROLE_NOT_AUTHORIZED'));
  }
  private async recordFailedLogin(accountId:string,meta:WriteMeta){
    await this.db.database.transaction(async tx=>{
      const existing=await tx.query<any>(`SELECT result FROM audit.idempotency_key WHERE key=$1`,[meta.idempotencyKey]);
      if(existing.rows[0])return;
      const updated=await tx.query<any>(`UPDATE iam.account SET failed_attempts=failed_attempts+1 WHERE id=$1 AND status='ACTIVE' RETURNING failed_attempts`,[accountId]);
      const locked=(updated.rows[0]?.failed_attempts??0)>=this.policy!.maxFailedAttempts;
      if(locked){
        await tx.query(`UPDATE iam.account SET status='LOCKED',locked_at=now(),version=version+1 WHERE id=$1`,[accountId]);
        await tx.query(`UPDATE iam.session SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`,[accountId]);
      }
      const output={businessStatus:locked?'ACCOUNT_LOCKED':'LOGIN_FAILED',requestId:meta.requestId};
      await tx.query(`INSERT INTO audit.idempotency_key (key,result_id,result) VALUES ($1,$2,$3::jsonb)`,[meta.idempotencyKey,meta.requestId,JSON.stringify(output)]);
      await tx.query(`INSERT INTO audit.audit_event (id,actor_id,actor_role,action,subject_type,subject_id,request_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[meta.requestId,meta.actorId,meta.actorRole,locked?'ACCOUNT_LOCKED':'LOGIN_FAILED','ACCOUNT',accountId,meta.requestId]);
    });
  }
  private async write<T extends Record<string,unknown>>(meta:WriteMeta,action:string,subjectType:string,subjectId:string,operation:(tx:Sql)=>Promise<T>):Promise<T>{return this.db.database.transaction(async tx=>{const existing=await tx.query<any>(`SELECT result FROM audit.idempotency_key WHERE key=$1`,[meta.idempotencyKey]);if(existing.rows[0])return existing.rows[0].result as T;const output=await operation(tx);await tx.query(`INSERT INTO audit.idempotency_key (key,result_id,result) VALUES ($1,$2,$3::jsonb)`,[meta.idempotencyKey,meta.requestId,JSON.stringify(output)]);await tx.query(`INSERT INTO audit.audit_event (id,actor_id,actor_role,action,subject_type,subject_id,request_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[meta.requestId,meta.actorId,meta.actorRole,action,subjectType,subjectId,meta.requestId]);return output;});}
}
