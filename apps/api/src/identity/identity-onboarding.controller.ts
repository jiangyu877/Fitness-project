import {
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';

import { IdentityOnboardingService } from './identity-onboarding.service.js';

const staffRoles = [
  'OPERATIONS',
  'NUTRITION_REVIEWER',
  'TRAINING_REVIEWER',
  'SYSTEM_ADMIN',
  'AUDIT_VIEWER',
] as const;
const objectSchema = (required: string[], properties: Record<string, unknown>): any => ({
  type: 'object',
  required,
  properties,
  additionalProperties: false,
});
const versionSchema = objectSchema(['expectedVersion'], {
  expectedVersion: { type: 'integer', minimum: 1 },
});
const invitationSchema = objectSchema(
  ['accountId', 'loginIdentifier', 'accountType', 'roles', 'initialPassword'],
  {
    accountId: { type: 'string' },
    loginIdentifier: { type: 'string' },
    accountType: { type: 'string', enum: ['USER', 'STAFF'] },
    roles: { type: 'array', items: { type: 'string', enum: [...staffRoles] } },
    initialPassword: { type: 'string', format: 'password' },
  },
);
const passwordChangeSchema = objectSchema(
  ['newPassword', 'expectedVersion'],
  {
    newPassword: { type: 'string', format: 'password' },
    expectedVersion: { type: 'integer', minimum: 1 },
  },
);
const sessionSchema = objectSchema(
  ['loginIdentifier', 'password', 'sessionKind'],
  {
    loginIdentifier: { type: 'string' },
    password: { type: 'string', format: 'password' },
    sessionKind: { type: 'string', enum: ['USER', 'STAFF'] },
    mfaChallengeId: { type: 'string' },
    actingRole: { type: 'string', enum: [...staffRoles], description: 'Required for STAFF login and bound to the created session' },
  },
);
const screeningSchema = objectSchema(
  ['userId', 'conclusion', 'source', 'ruleVersion'],
  {
    userId: { type: 'string' },
    conclusion: { type: 'string', enum: ['PASS', 'HUMAN_REVIEW', 'EXCLUDED'] },
    source: { type: 'string', enum: ['PROFESSIONAL_RULE', 'MANUAL_REVIEW'] },
    ruleVersion: { type: 'string', nullable: true },
  },
);
const securityErrorSchema = objectSchema(
  ['businessStatus', 'errorCode', 'recoverableActions', 'requestId'],
  {
    businessStatus: { type: 'string', enum: ['WRITE_REJECTED', 'IDENTITY_BLOCKED'] },
    errorCode: {
      type: 'string',
      enum: [
        'IDEMPOTENCY_KEY_REUSED',
        'IDEMPOTENCY_FINGERPRINT_KEY_UNAVAILABLE',
        'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION',
        'MFA_VERIFIER_UNAVAILABLE',
        'MFA_REQUIRED',
        'PROFESSIONAL_QUALIFICATION_REQUIRED',
        'ROLE_NOT_AUTHORIZED',
        'INVALID_CREDENTIALS',
        'SESSION_INVALID',
        'SESSION_KIND_MISMATCH',
        'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
        'PASSWORD_CHANGE_TOKEN_INVALID',
        'PASSWORD_CHANGE_TTL_POLICY_INVALID',
        'ACCOUNT_LOCKED',
        'ACCOUNT_DISABLED',
        'CURRENT_CONSENT_VERSION_REQUIRED',
        'CURRENT_CONSENT_VERSION_UNAVAILABLE',
        'AUTH_SECURITY_POLICY_UNAPPROVED',
        'AUTH_SECURITY_POLICY_INVALID',
        'SCREENING_TARGET_USER_REQUIRED',
        'ROUTE_ACCESS_NOT_APPROVED',
        'VERSION_CONFLICT',
      ],
    },
    recoverableActions: { type: 'array', items: { type: 'string' } },
    requestId: { type: 'string' },
  },
);

@ApiTags('identity-onboarding')
@ApiHeader({ name: 'x-request-id', required: true })
@ApiConflictResponse({ description: 'Scoped idempotency or version conflict', schema: securityErrorSchema })
@ApiForbiddenResponse({ description: 'Authorization, MFA, or qualification rejected', schema: securityErrorSchema })
@ApiUnauthorizedResponse({ description: 'Credentials or session rejected', schema: securityErrorSchema })
@ApiServiceUnavailableResponse({ description: 'Approved provider or policy unavailable', schema: securityErrorSchema })
@Controller('api/v1')
export class IdentityOnboardingController {
  constructor(
    @Inject(IdentityOnboardingService) private readonly service: IdentityOnboardingService,
  ) {}

  @Post('identity/invitations')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: invitationSchema })
  @ApiCreatedResponse({ schema: objectSchema(['businessStatus', 'requestId', 'accountId', 'version'], {
    businessStatus: { type: 'string', enum: ['ACCOUNT_INVITED'] }, requestId: { type: 'string' },
    accountId: { type: 'string' }, version: { type: 'integer' },
  }) })
  invite(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({
      accountId: z.string(),
      loginIdentifier: z.string(),
      accountType: z.enum(['USER', 'STAFF']),
      roles: z.array(z.enum(staffRoles)),
      initialPassword: z.string(),
    }).parse(body);
    return this.service.invite(optionalBearerToken(headers), input, requestMeta(headers));
  }

  @Post('identity/password/change')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: passwordChangeSchema })
  @HttpCode(200)
  @ApiOkResponse({ schema: objectSchema(['businessStatus', 'requestId', 'sessionToken', 'expiresAt', 'nextAction', 'version'], {
    businessStatus: { type: 'string', enum: ['SESSION_CREATED'] }, requestId: { type: 'string' },
    sessionToken: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' },
    nextAction: { type: 'string', enum: ['ACCEPT_CURRENT_CONSENT'] }, version: { type: 'integer' },
  }) })
  changePassword(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({
      newPassword: z.string(),
      expectedVersion: z.number().int(),
    }).parse(body);
    return this.service.changePassword(bearerToken(headers), input, requestMeta(headers));
  }

  @Post('identity/sessions')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBody({ schema: sessionSchema })
  @ApiCreatedResponse({ schema: { discriminator: { propertyName: 'sessionType' }, oneOf: [
    objectSchema(['sessionType', 'businessStatus', 'requestId', 'passwordChangeToken', 'expectedVersion', 'expiresAt', 'nextAction'], {
      sessionType: { type: 'string', enum: ['PASSWORD_CHANGE'] },
      businessStatus: { type: 'string', enum: ['PASSWORD_CHANGE_REQUIRED'] }, requestId: { type: 'string' },
      passwordChangeToken: { type: 'string' }, expectedVersion: { type: 'integer' }, expiresAt: { type: 'string', format: 'date-time' },
      nextAction: { type: 'string', enum: ['CHANGE_INITIAL_PASSWORD'] },
    }),
    objectSchema(['sessionType', 'businessStatus', 'requestId', 'sessionId', 'sessionToken', 'expiresAt', 'nextAction'], {
      sessionType: { type: 'string', enum: ['USER'] },
      businessStatus: { type: 'string', enum: ['SESSION_CREATED'] }, requestId: { type: 'string' }, sessionId: { type: 'string' },
      sessionToken: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' },
      nextAction: { type: 'string', enum: ['ACCEPT_CURRENT_CONSENT', 'WAIT_FOR_SCREENING_RULES', 'CONTACT_OPERATIONS'] },
    }),
    objectSchema(['sessionType', 'businessStatus', 'requestId', 'sessionId', 'sessionToken', 'expiresAt'], {
      sessionType: { type: 'string', enum: ['STAFF'] },
      businessStatus: { type: 'string', enum: ['SESSION_CREATED'] }, requestId: { type: 'string' }, sessionId: { type: 'string' },
      sessionToken: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' },
    }),
  ] } })
  login(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({
      loginIdentifier: z.string(),
      password: z.string(),
      sessionKind: z.enum(['USER', 'STAFF']),
      mfaChallengeId: z.string().optional(),
      actingRole: z.enum(staffRoles).optional(),
    }).parse(body);
    return this.service.login(input, requestMeta(headers));
  }

  @Get('identity/session')
  @ApiBearerAuth()
  @ApiHeader({ name: 'idempotency-key', required: false })
  @ApiOkResponse({ schema: objectSchema(['accountId', 'accountType', 'activeRole', 'expiresAt', 'businessStatus', 'nextAction'], {
    accountId: { type: 'string' }, accountType: { type: 'string', enum: ['USER'] }, activeRole: { type: 'string', enum: ['USER'] },
    expiresAt: { type: 'string', format: 'date-time' }, businessStatus: { type: 'string', enum: ['SESSION_ACTIVE'] },
    nextAction: { type: 'string', enum: ['ACCEPT_CURRENT_CONSENT', 'WAIT_FOR_SCREENING_RULES', 'CONTACT_OPERATIONS'] },
  }) })
  session(@Headers() headers: Record<string, string>) {
    return this.service.getSession(bearerToken(headers), readRequestMeta(headers));
  }

  @Post('identity/session/logout')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOkResponse({ schema: objectSchema(['businessStatus', 'requestId'], {
    businessStatus: { type: 'string', enum: ['SESSION_ENDED'] }, requestId: { type: 'string' },
  }) })
  logout(@Headers() headers: Record<string, string>) {
    return this.service.logout(bearerToken(headers), requestMeta(headers));
  }

  @Post('onboarding/consents')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: objectSchema(['consentVersion'], { consentVersion: { type: 'string' } }) })
  @ApiCreatedResponse({ schema: objectSchema(['businessStatus', 'requestId', 'consentId', 'consentVersion', 'version'], {
    businessStatus: { type: 'string', enum: ['CONSENT_ACCEPTED'] }, requestId: { type: 'string' },
    consentId: { type: 'string' }, consentVersion: { type: 'string' }, version: { type: 'integer' },
  }) })
  acceptConsent(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({ consentVersion: z.string() }).parse(body);
    return this.service.acceptConsent(bearerToken(headers), input.consentVersion, requestMeta(headers));
  }

  @Post('onboarding/consents/:id/withdraw')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: versionSchema })
  @HttpCode(200)
  @ApiOkResponse({ schema: objectSchema(['businessStatus', 'requestId', 'consentId', 'version'], {
    businessStatus: { type: 'string', enum: ['CONSENT_WITHDRAWN'] }, requestId: { type: 'string' },
    consentId: { type: 'string' }, version: { type: 'integer' },
  }) })
  withdrawConsent(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    const input = z.object({ expectedVersion: z.number().int().positive() }).parse(body);
    return this.service.withdrawConsent(bearerToken(headers), id, input.expectedVersion, requestMeta(headers));
  }

  @Post('identity/accounts/:id/status')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: objectSchema(['status', 'expectedVersion'], {
    status: { type: 'string', enum: ['LOCKED', 'DISABLED'] },
    expectedVersion: { type: 'integer', minimum: 1 },
  }) })
  @HttpCode(200)
  @ApiOkResponse({ schema: objectSchema(['businessStatus', 'requestId', 'status', 'version'], {
    businessStatus: { type: 'string', enum: ['ACCOUNT_STATUS_CHANGED'] }, requestId: { type: 'string' },
    status: { type: 'string', enum: ['LOCKED', 'DISABLED'] }, version: { type: 'integer' },
  }) })
  setAccountStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    const input = z.object({
      status: z.enum(['LOCKED', 'DISABLED']),
      expectedVersion: z.number().int().positive(),
    }).parse(body);
    return this.service.setAccountStatus(
      bearerToken(headers),
      id,
      input.status,
      input.expectedVersion,
      requestMeta(headers),
    );
  }

  @Put('onboarding/profile/steps/:step')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: objectSchema(['expectedVersion', 'data'], {
    expectedVersion: { type: 'integer', minimum: 0 },
    data: { type: 'object', additionalProperties: true },
  }) })
  @ApiOkResponse({ schema: objectSchema(['businessStatus', 'requestId', 'version'], {
    businessStatus: { type: 'string', enum: ['PROFILE_DRAFT_SAVED'] }, requestId: { type: 'string' }, version: { type: 'integer' },
  }) })
  saveProfile(
    @Param('step') step: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    const input = z.object({
      expectedVersion: z.number().int().nonnegative(),
      data: z.record(z.string(), z.unknown()),
    }).parse(body);
    return this.service.saveProfile(
      bearerToken(headers),
      step,
      input.expectedVersion,
      input.data,
      requestMeta(headers),
    );
  }

  @Post('onboarding/screening-results')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBearerAuth()
  @ApiBody({ schema: screeningSchema })
  @ApiCreatedResponse({ schema: objectSchema(['businessStatus', 'requestId'], {
    businessStatus: { type: 'string', enum: ['SCREENING_RECORDED'] }, requestId: { type: 'string' },
  }) })
  recordScreening(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({
      userId: z.string(),
      conclusion: z.enum(['PASS', 'HUMAN_REVIEW', 'EXCLUDED']),
      source: z.enum(['PROFESSIONAL_RULE', 'MANUAL_REVIEW']),
      ruleVersion: z.string().nullable(),
    }).parse(body);
    return this.service.recordScreening(bearerToken(headers), input, requestMeta(headers));
  }
}

function requestMeta(headers: Record<string, string>) {
  return {
    requestId: z.string().min(1).parse(headers['x-request-id']),
    idempotencyKey: z.string().min(1).parse(headers['idempotency-key']),
  };
}

function readRequestMeta(headers: Record<string, string>) {
  return {
    requestId: z.string().min(1).parse(headers['x-request-id']),
    idempotencyKey: 'read-identity-session',
  };
}

function bearerToken(headers: Record<string, string>): string | null {
  const parsed = z.string().regex(/^Bearer /).safeParse(headers.authorization);
  return parsed.success ? parsed.data.slice(7) : null;
}

function optionalBearerToken(headers: Record<string, string>): string | null {
  const parsed = z.string().regex(/^Bearer /).safeParse(headers.authorization);
  return parsed.success ? parsed.data.slice(7) : null;
}
