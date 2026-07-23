import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
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
  ['accountId', 'currentPassword', 'newPassword', 'expectedVersion'],
  {
    accountId: { type: 'string' },
    currentPassword: { type: 'string', format: 'password' },
    newPassword: { type: 'string', format: 'password' },
    expectedVersion: { type: 'integer', minimum: 1 },
    actingRole: { type: 'string', enum: [...staffRoles], description: 'Required for STAFF initial password change and verified against account roles' },
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
    businessStatus: { type: 'string', enum: ['WRITE_REJECTED'] },
    errorCode: {
      type: 'string',
      enum: [
        'IDEMPOTENCY_KEY_REUSED',
        'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION',
        'MFA_VERIFIER_UNAVAILABLE',
        'MFA_REQUIRED',
        'PROFESSIONAL_QUALIFICATION_REQUIRED',
        'ROLE_NOT_AUTHORIZED',
        'INVALID_CREDENTIALS',
        'SESSION_INVALID',
        'SESSION_KIND_MISMATCH',
        'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
        'VERSION_CONFLICT',
      ],
    },
    recoverableActions: { type: 'array', items: { type: 'string' } },
    requestId: { type: 'string' },
  },
);

@ApiTags('identity-onboarding')
@ApiHeader({ name: 'x-request-id', required: true })
@ApiHeader({ name: 'idempotency-key', required: true })
@ApiConflictResponse({ description: 'Scoped idempotency or version conflict', schema: securityErrorSchema })
@ApiForbiddenResponse({ description: 'Authorization, MFA, or qualification rejected', schema: securityErrorSchema })
@ApiUnauthorizedResponse({ description: 'Credentials or session rejected', schema: securityErrorSchema })
@Controller('api/v1')
export class IdentityOnboardingController {
  constructor(
    @Inject(IdentityOnboardingService) private readonly service: IdentityOnboardingService,
  ) {}

  @Post('identity/invitations')
  @ApiBearerAuth()
  @ApiBody({ schema: invitationSchema })
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
  @ApiBody({ schema: passwordChangeSchema })
  @HttpCode(200)
  changePassword(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({
      accountId: z.string(),
      currentPassword: z.string(),
      newPassword: z.string(),
      expectedVersion: z.number().int(),
      actingRole: z.enum(staffRoles).optional(),
    }).parse(body);
    return this.service.changePassword(input, requestMeta(headers));
  }

  @Post('identity/sessions')
  @ApiBody({ schema: sessionSchema })
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

  @Post('onboarding/consents')
  @ApiBearerAuth()
  @ApiBody({ schema: objectSchema(['consentVersion'], { consentVersion: { type: 'string' } }) })
  acceptConsent(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = z.object({ consentVersion: z.string() }).parse(body);
    return this.service.acceptConsent(bearerToken(headers), input.consentVersion, requestMeta(headers));
  }

  @Post('onboarding/consents/:id/withdraw')
  @ApiBearerAuth()
  @ApiBody({ schema: versionSchema })
  @HttpCode(200)
  withdrawConsent(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    const input = z.object({ expectedVersion: z.number().int().positive() }).parse(body);
    return this.service.withdrawConsent(bearerToken(headers), id, input.expectedVersion, requestMeta(headers));
  }

  @Post('identity/accounts/:id/status')
  @ApiBearerAuth()
  @ApiBody({ schema: objectSchema(['status', 'expectedVersion'], {
    status: { type: 'string', enum: ['LOCKED', 'DISABLED'] },
    expectedVersion: { type: 'integer', minimum: 1 },
  }) })
  @HttpCode(200)
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
  @ApiBearerAuth()
  @ApiBody({ schema: objectSchema(['expectedVersion', 'data'], {
    expectedVersion: { type: 'integer', minimum: 0 },
    data: { type: 'object', additionalProperties: true },
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
  @ApiBearerAuth()
  @ApiBody({ schema: screeningSchema })
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

function bearerToken(headers: Record<string, string>) {
  const parsed = z.string().regex(/^Bearer /).safeParse(headers.authorization);
  if (!parsed.success) {
    throw new UnauthorizedException({
      businessStatus: 'SESSION_INVALID',
      errorCode: 'SESSION_INVALID',
      recoverableActions: ['LOGIN'],
    });
  }
  return parsed.data.slice(7);
}

function optionalBearerToken(headers: Record<string, string>): string | null {
  const parsed = z.string().regex(/^Bearer /).safeParse(headers.authorization);
  return parsed.success ? parsed.data.slice(7) : null;
}
