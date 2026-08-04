import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import { createHash } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import type { Environment } from '../src/config/environment.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { RouteAccessSnapshot } from '../src/readiness/route-access.js';
import { P11_RECORD_REPOSITORY } from '../src/records/p11-record-repository.token.js';
import type {
  P11RecordPersistenceInput,
  P11RecordPortSchema,
  P11RecordRepositoryOutcome,
  P11RecordRepositoryPort,
} from '../src/records/p11-record-repository.port.js';
import { buildApplication } from './build-test-application.js';

const environment: Environment = {
  nodeEnv: 'test', port: 3000, databasePath: 'memory://', demoMode: false,
  professionalRulesApproved: false, authSecurityPolicyApproved: true,
  privacyReviewApproved: false, dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false, operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};

const policy: AuthSecurityPolicy = {
  approved: true, passwordMinLength: 10, sessionTtlSeconds: 900,
  passwordChangeTtlSeconds: 300, maxFailedAttempts: 3,
  mfaRequiredForStaff: false, scryptCost: 16_384, scryptBlockSize: 8,
  scryptParallelization: 1, scryptKeyLength: 32,
};

const schema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{
    id: 'kind-1', fields: [{ id: 'field-1', valueType: 'STRING' }],
    allowedActions: ['UPSERT_RECORD'],
  }],
} as const satisfies P11RecordPortSchema;

const completeFieldSchema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{
    id: 'kind-1',
    fields: [
      { id: 'field-1', valueType: 'STRING', required: true },
      { id: 'field-2', valueType: 'BOOLEAN' },
    ],
    allowedActions: ['UPSERT_RECORD'],
  }],
} as const satisfies P11RecordPortSchema;

const emptyFieldSchema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{ id: 'kind-1', fields: [], allowedActions: ['UPSERT_RECORD'] }],
} as const satisfies P11RecordPortSchema;

const sparseFields = new Array<{ id: string; valueType: 'STRING' }>(2);
sparseFields[1] = { id: 'field-1', valueType: 'STRING' };
const sparseFieldSchema: P11RecordPortSchema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{ id: 'kind-1', fields: sparseFields, allowedActions: ['UPSERT_RECORD'] }],
};

const successBody = {
  businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 37,
  schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT',
  recoverableActions: [],
};
const SUCCESS_KEYS = Object.keys(successBody).sort();
const ERROR_KEYS = [
  'businessStatus', 'clientStateDisposition', 'errorCode',
  'recoverableActions', 'requestId',
].sort();

type ScriptedStep =
  | P11RecordRepositoryOutcome
  | (() => Promise<P11RecordRepositoryOutcome>);

class ScriptedP11RecordRepositoryFake implements P11RecordRepositoryPort {
  readonly inputs: P11RecordPersistenceInput[] = [];
  readonly callOrder: number[] = [];
  private nextCall = 0;

  constructor(private readonly queue: readonly ScriptedStep[]) {}

  async upsert(input: P11RecordPersistenceInput): Promise<P11RecordRepositoryOutcome> {
    const call = this.nextCall++;
    this.callOrder.push(call + 1);
    this.inputs.push(deepFreeze(structuredClone(input)));
    const step = this.queue[call];
    if (!step) throw new Error(`Missing scripted P11 repository outcome for call ${call + 1}`);
    return typeof step === 'function' ? step() : step;
  }

  get callCount() { return this.inputs.length; }
}

type FutureFixture = Readonly<{
  intent: string;
  auth: 'USER' | 'NON_USER' | 'INVALID' | 'EXPIRED';
  route: 'ALLOW' | 'BLOCK';
  fake: ScriptedP11RecordRepositoryFake;
  recordSchema: P11RecordPortSchema;
}>;

function futureFixture(
  intent: string,
  fake: ScriptedP11RecordRepositoryFake,
  auth: FutureFixture['auth'] = 'USER',
  route: FutureFixture['route'] = 'ALLOW',
  recordSchema: P11RecordPortSchema = schema,
): FutureFixture {
  return { intent, auth, route, fake, recordSchema };
}

function success(recordVersion = 37): P11RecordRepositoryOutcome {
  return { ok: true, value: { recordId: 'internal-record-id', recordVersion, schemaVersion: 'schema-v1' } };
}

function failure(code: Extract<P11RecordRepositoryOutcome, { ok: false }>['error']['code']): P11RecordRepositoryOutcome {
  return { ok: false, error: { code } };
}

describe('P11 record persistence API pre-wiring behavioral RED', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it('maps a legal test-only USER write to the strict success response', async () => {
    const fixture = futureFixture('legal USER write reaches the repository port and derives version 37 from its outcome', new ScriptedP11RecordRepositoryFake([success(37)]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'legal-success');
    const response = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
    assertSuccess(response, sentinels);

    await app?.close();
    const productionFake = new ScriptedP11RecordRepositoryFake([success(91)]);
    const productionEnvironment: Environment = { ...environment, nodeEnv: 'production' };
    app = await buildApplication(productionEnvironment, {
      authPolicy: policy,
      recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
      recordRepository: productionFake,
      routeAccessSnapshot: routeSnapshot('ALLOW'),
    });
    expect(app.get(P11_RECORD_REPOSITORY)).toBeNull();
    const productionResponse = await request(app.getHttpServer())
      .post('/api/v1/record-tasks/task-1/commands')
      .set('Authorization', `Bearer ${sentinels.token}`)
      .set('x-request-id', 'production-null-request')
      .set('idempotency-key', 'production-null-idempotency')
      .send(validCommand('production-null-entry'));
    expect(productionResponse.status).toBe(503);
    expect(Object.keys(productionResponse.body).sort()).toEqual(ERROR_KEYS);
    expect(productionResponse.body).toEqual({
      businessStatus: 'IDENTITY_BLOCKED',
      errorCode: 'ROUTE_ACCESS_NOT_APPROVED',
      recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      clientStateDisposition: 'CLEAR_ALL',
      requestId: 'production-null-request',
    });
    expect(productionFake.callCount).toBe(0);

    const dynamicModule = AppModule.forEnvironment(
      productionEnvironment, null, null, null, null, null, {},
      null, null, null, null, productionFake,
    );
    const repositoryProvider = dynamicModule.providers?.find((provider) =>
      typeof provider === 'object' && provider !== null
      && 'provide' in provider && provider.provide === P11_RECORD_REPOSITORY,
    );
    expect(repositoryProvider).toMatchObject({ provide: P11_RECORD_REPOSITORY, useValue: null });
  });

  it('fails closed before the port for an empty selected-kind field set and empty entries', async () => {
    const fixture = futureFixture('empty frozen field set cannot authorize a write', new ScriptedP11RecordRepositoryFake([success()]), 'USER', 'ALLOW', emptyFieldSchema);
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'empty-fields');
    const response = await command(authorized, sentinels, { ...validCommand(sentinels.entryValue), entries: [] });
    assertError(response, 503, 'RECORD_SCHEMA_INVALID', 'CLEAR_ALL', ['CONTACT_OPERATIONS'], sentinels, [], { entry: false });
    expect(fixture.fake.callCount).toBe(0);
  });

  it('fails closed before the port for a sparse selected-kind field array', async () => {
    const fixture = futureFixture('sparse frozen field array cannot authorize a write', new ScriptedP11RecordRepositoryFake([success()]), 'USER', 'ALLOW', sparseFieldSchema);
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'sparse-fields');
    const response = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    assertError(response, 503, 'RECORD_SCHEMA_INVALID', 'CLEAR_ALL', ['CONTACT_OPERATIONS'], sentinels);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('rejects a request that omits the frozen required field before the port', async () => {
    const fixture = futureFixture('request includes only field-2 and omits required field-1', new ScriptedP11RecordRepositoryFake([success()]), 'USER', 'ALLOW', completeFieldSchema);
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'missing-required');
    const response = await command(authorized, sentinels, {
      ...validCommand(sentinels.entryValue), entries: [{ fieldId: 'field-2', value: true }],
    });
    assertError(response, 400, 'RECORD_REQUEST_INVALID', 'CLEAR_ALL', [], sentinels, [], { entry: false });
    expect(fixture.fake.callCount).toBe(0);
  });

  it('rejects any incomplete frozen field set before the port', async () => {
    const fixture = futureFixture('request includes field-1 but omits frozen field-2', new ScriptedP11RecordRepositoryFake([success()]), 'USER', 'ALLOW', completeFieldSchema);
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'incomplete-fields');
    const response = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    assertError(response, 400, 'RECORD_REQUEST_INVALID', 'CLEAR_ALL', [], sentinels);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('fails closed with the endpoint envelope when a test repository is null', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy,
      recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
      routeAccessSnapshot: routeSnapshot('ALLOW'),
    });
    const token = 'test-issued-null-repository-token';
    await seedFixtureIdentity(app, 'USER', 'null-repository', token);
    const agent = request(app.getHttpServer());
    const sentinels = createSentinels('null-repository', token);
    const response = await command({ agent, token }, sentinels, validCommand(sentinels.entryValue));
    assertError(response, 503, 'ROUTE_ACCESS_NOT_APPROVED', 'CLEAR_ALL', ['WAIT_FOR_SECURITY_APPROVAL'], sentinels);
  });

  it('maps an exact replay through the real controller to the same strict response', async () => {
    const fixture = futureFixture('first success followed by exact replay success', new ScriptedP11RecordRepositoryFake([success(), success()]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'exact-replay');
    const first = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    const replay = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    assertSuccess(first, sentinels);
    assertSuccess(replay, sentinels);
    expect(replay.body).toEqual(first.body);
    expect(fixture.fake.callCount).toBe(2);
    expect(fixture.fake.callOrder).toEqual([1, 2]);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
    assertMappedInput(fixture.fake.inputs[1], sentinels);
    expect(fixture.fake.inputs[1]).toEqual(fixture.fake.inputs[0]);
  });

  it('maps same-key changed intent after a strict first success', async () => {
    const fixture = futureFixture('first success then same raw key with changed scalar intent', new ScriptedP11RecordRepositoryFake([success(), failure('IDEMPOTENCY_KEY_REUSED')]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'changed-intent');
    const first = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    const changedValue = `${sentinels.entryValue}-changed`;
    const changed = await command(authorized, sentinels, validCommand(changedValue));
    assertSuccess(first, sentinels);
    assertError(changed, 409, 'IDEMPOTENCY_KEY_REUSED', 'CLEAR_ALL', ['USE_NEW_IDEMPOTENCY_KEY'], sentinels, [
      changedValue,
      createHash('sha256').update(sentinels.token).digest('hex'),
    ]);
    expect(fixture.fake.callCount).toBe(2);
    expect(fixture.fake.callOrder).toEqual([1, 2]);
    assertMappedInput(fixture.fake.inputs[0], sentinels, sentinels.entryValue);
    assertMappedInput(fixture.fake.inputs[1], sentinels, changedValue);
    expect(normalizeScalarValue(fixture.fake.inputs[0]!))
      .toEqual(normalizeScalarValue(fixture.fake.inputs[1]!));
    expect(fixture.fake.inputs[0]!.command.entries[0]!.value).toBe(sentinels.entryValue);
    expect(fixture.fake.inputs[1]!.command.entries[0]!.value).toBe(changedValue);
  });

  it('maps a same-subject same-target stale record version conflict', async () => {
    const fixture = futureFixture('existing newer record for the same verified subject and task', new ScriptedP11RecordRepositoryFake([failure('RECORD_VERSION_CONFLICT')]));
    const { response, sentinels } = await futureRequest(fixture, 'version-conflict', { ...validCommand('version-entry'), expectedRecordVersion: 1 });
    assertError(response, 409, 'RECORD_VERSION_CONFLICT', 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT', ['REFRESH'], sentinels, [
      'version-entry',
      createHash('sha256').update(sentinels.token).digest('hex'),
    ]);
    expect(fixture.fake.callCount).toBe(1);
    expect(fixture.fake.callOrder).toEqual([1]);
    assertMappedInput(fixture.fake.inputs[0], sentinels, 'version-entry', 1);
  });

  it('maps a task pinned to a newer schema version conflict', async () => {
    const fixture = futureFixture('owned task pinned to schema-v2 while request uses schema-v0', new ScriptedP11RecordRepositoryFake([failure('RECORD_SCHEMA_VERSION_CONFLICT')]));
    const { response, sentinels } = await futureRequest(fixture, 'schema-conflict', { ...validCommand('schema-entry'), schemaVersion: 'schema-v0' });
    assertError(response, 409, 'RECORD_SCHEMA_VERSION_CONFLICT', 'CLEAR_ALL', ['REFRESH'], sentinels, ['schema-v0']);
    expect(fixture.fake.callCount).toBe(1);
    expect(fixture.fake.inputs[0]?.command.schemaVersion).toBe('schema-v0');
  });

  it('maps an existing same-key different-intent idempotency state', async () => {
    const fixture = futureFixture('completed same-key digest already belongs to a different intent', new ScriptedP11RecordRepositoryFake([failure('IDEMPOTENCY_KEY_REUSED')]));
    const { response, sentinels } = await futureRequest(fixture, 'existing-idem-conflict');
    assertError(response, 409, 'IDEMPOTENCY_KEY_REUSED', 'CLEAR_ALL', ['USE_NEW_IDEMPOTENCY_KEY'], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    expect(fixture.fake.inputs[0]?.idempotencyKey).toBe(sentinels.rawKey);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('maps RECORD_PLAN_NOT_ACTIVE from an independent fake queue', async () => {
    const fixture = futureFixture('owned task has no ACTIVE plan version for its date', new ScriptedP11RecordRepositoryFake([failure('RECORD_PLAN_NOT_ACTIVE')]));
    const { response, sentinels } = await futureRequest(fixture, 'plan-not-active');
    assertError(response, 409, 'RECORD_PLAN_NOT_ACTIVE', 'CLEAR_ALL', [], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('maps RECORD_STATE_BLOCKED from an independent fake queue', async () => {
    const fixture = futureFixture('authoritative state blocks the owned task', new ScriptedP11RecordRepositoryFake([failure('RECORD_STATE_BLOCKED')]));
    const { response, sentinels } = await futureRequest(fixture, 'state-blocked');
    assertError(response, 409, 'RECORD_STATE_BLOCKED', 'DISABLE_EDITOR', [], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('maps RECORD_SCHEMA_UNAVAILABLE from an independent fake queue', async () => {
    const fixture = futureFixture('strict test-only provider is unavailable', new ScriptedP11RecordRepositoryFake([failure('RECORD_SCHEMA_UNAVAILABLE')]));
    const { response, sentinels } = await futureRequest(fixture, 'schema-unavailable');
    assertError(response, 503, 'RECORD_SCHEMA_UNAVAILABLE', 'CLEAR_ALL', ['CONTACT_OPERATIONS'], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('maps RECORD_SCHEMA_INVALID from an independent fake queue', async () => {
    const fixture = futureFixture('provider returns an invalid strict snapshot', new ScriptedP11RecordRepositoryFake([failure('RECORD_SCHEMA_INVALID')]));
    const { response, sentinels } = await futureRequest(fixture, 'schema-invalid');
    assertError(response, 503, 'RECORD_SCHEMA_INVALID', 'CLEAR_ALL', ['CONTACT_OPERATIONS'], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('maps repository RECORD_REQUEST_INVALID from an independent fake queue', async () => {
    const fixture = futureFixture('repository rejects a boundary-valid request fail closed', new ScriptedP11RecordRepositoryFake([failure('RECORD_REQUEST_INVALID')]));
    const { response, sentinels } = await futureRequest(fixture, 'repository-request-invalid');
    assertError(response, 400, 'RECORD_REQUEST_INVALID', 'CLEAR_ALL', [], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('maps repository ROUTE_ACCESS_NOT_APPROVED from an independent fake queue', async () => {
    const fixture = futureFixture('route was allowed early but repository revalidation rejects', new ScriptedP11RecordRepositoryFake([failure('ROUTE_ACCESS_NOT_APPROVED')]));
    const { response, sentinels } = await futureRequest(fixture, 'repository-route-blocked');
    assertError(response, 503, 'ROUTE_ACCESS_NOT_APPROVED', 'CLEAR_ALL', ['WAIT_FOR_SECURITY_APPROVAL'], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
  });

  it('keeps HMAC_KEY_UNAVAILABLE internal at the real controller boundary', async () => {
    const fixture = futureFixture('repository reports internal HMAC key failure', new ScriptedP11RecordRepositoryFake([failure('HMAC_KEY_UNAVAILABLE')]));
    const { response, sentinels } = await futureRequest(fixture, 'hmac-unavailable');
    assertError(response, 503, 'ROUTE_ACCESS_NOT_APPROVED', 'CLEAR_ALL', ['WAIT_FOR_SECURITY_APPROVAL'], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels);
    expect(JSON.stringify(response.body)).not.toContain('HMAC_KEY_UNAVAILABLE');
  });

  it('keeps trusted non-USER rejection ahead of the fake', async () => {
    const fixture = futureFixture('trusted non-USER identity fixture', new ScriptedP11RecordRepositoryFake([success()]), 'NON_USER');
    const { response, sentinels } = await futureRequest(fixture, 'non-user-role');
    assertError(response, 403, 'ROLE_NOT_AUTHORIZED', 'CLEAR_ALL', [], sentinels);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('rejects a missing idempotency-key before the fake', async () => {
    const fixture = futureFixture('valid USER request omits only idempotency-key', new ScriptedP11RecordRepositoryFake([success()]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'missing-idem');
    const response = await rawCommand(authorized, validCommand(sentinels.entryValue)).set('x-request-id', sentinels.requestId);
    assertError(response, 400, 'RECORD_REQUEST_INVALID', 'CLEAR_ALL', [], sentinels, [], { rawKey: false });
    expect(fixture.fake.callCount).toBe(0);
  });

  it('rejects a blank idempotency-key before the fake', async () => {
    const rawBlankKey = '   ';
    const fixture = futureFixture('valid USER request sends only a blank idempotency-key', new ScriptedP11RecordRepositoryFake([success()]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'blank-idem');
    const response = await rawCommand(authorized, validCommand(sentinels.entryValue)).set('x-request-id', sentinels.requestId).set('idempotency-key', rawBlankKey);
    assertError(response, 400, 'RECORD_REQUEST_INVALID', 'CLEAR_ALL', [], sentinels, [rawBlankKey], { rawKey: false });
    expect(JSON.stringify(response.body)).not.toContain(rawBlankKey);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('uses a safe fallback for a missing x-request-id', async () => {
    const fixture = futureFixture('valid USER request omits only x-request-id', new ScriptedP11RecordRepositoryFake([success()]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'missing-request-id');
    const body = validCommand(sentinels.entryValue);
    const response = await rawCommand(authorized, body).set('idempotency-key', sentinels.rawKey);
    assertFallbackError(response, 400, 'RECORD_REQUEST_INVALID', sentinels, ['task-1', body.schemaVersion, String(body.expectedRecordVersion)]);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('uses a safe fallback for a blank x-request-id', async () => {
    const fixture = futureFixture('valid USER request sends whitespace x-request-id', new ScriptedP11RecordRepositoryFake([success()]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'blank-request-id');
    const body = validCommand(sentinels.entryValue);
    const attackerCorrelation = '   ';
    const response = await rawCommand(authorized, body).set('x-request-id', attackerCorrelation).set('idempotency-key', sentinels.rawKey);
    assertFallbackError(response, 400, 'RECORD_REQUEST_INVALID', sentinels, ['task-1', body.schemaVersion, String(body.expectedRecordVersion), attackerCorrelation]);
    expect(response.body.requestId).not.toBe(attackerCorrelation);
    expect(response.body.requestId).not.toContain(attackerCorrelation);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('sends an invalid command to the real controller validator', async () => {
    const fixture = futureFixture('valid USER and headers with malformed DELETE payload', new ScriptedP11RecordRepositoryFake([success()]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'invalid-command');
    const body = { operation: 'DELETE_RECORD', schemaVersion: 'stale-schema', expectedRecordVersion: -1, entries: 'invalid-entries' };
    const response = await command(authorized, sentinels, body);
    assertError(response, 400, 'RECORD_REQUEST_INVALID', 'CLEAR_ALL', [], sentinels, ['stale-schema', '-1', 'invalid-entries'], { entry: false });
    expect(fixture.fake.callCount).toBe(0);
  });

  it('returns the non-enumerating 404 for a missing task', async () => {
    const fixture = futureFixture('opaque task has no row', new ScriptedP11RecordRepositoryFake([failure('RECORD_TASK_NOT_FOUND')]));
    const { response, sentinels } = await futureRequest(fixture, 'missing-task', undefined, 'missing-opaque-task');
    assertError(response, 404, 'RECORD_TASK_NOT_FOUND', 'CLEAR_ALL', [], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels, sentinels.entryValue, null, 'missing-opaque-task');
  });

  it('returns the same non-enumerating 404 for a cross-user task', async () => {
    const fixture = futureFixture('task exists for another account', new ScriptedP11RecordRepositoryFake([failure('RECORD_TASK_NOT_FOUND')]));
    const { response, sentinels } = await futureRequest(fixture, 'cross-user-task', undefined, 'other-user-task');
    assertError(response, 404, 'RECORD_TASK_NOT_FOUND', 'CLEAR_ALL', [], sentinels);
    expect(fixture.fake.callCount).toBe(1);
    assertMappedInput(fixture.fake.inputs[0], sentinels, sentinels.entryValue, null, 'other-user-task');
    expect(JSON.stringify(response.body)).not.toContain('other-user-task');
  });

  it('keeps invalid and expired session priority ahead of malformed inputs', async () => {
    for (const auth of ['INVALID', 'EXPIRED'] as const) {
      const fixture = futureFixture(`${auth} session with all downstream inputs malformed`, new ScriptedP11RecordRepositoryFake([success()]), auth, 'ALLOW');
      const { authorized, sentinels } = await buildFixtureApplication(fixture, `session-priority-${auth.toLowerCase()}`);
      const body = { operation: 'DELETE_RECORD', schemaVersion: 'stale-schema', expectedRecordVersion: -1, entries: 'invalid-entries' };
      const response = await rawCommand(authorized, body, 'invalid-task')
        .set('x-request-id', '   ').set('idempotency-key', '   ');
      assertFallbackError(response, 401, 'SESSION_INVALID', sentinels, ['invalid-task', 'stale-schema', '-1', 'invalid-entries', '   ']);
      expect(JSON.stringify(response.body)).not.toContain('   ');
      expect(fixture.fake.callCount).toBe(0);
    }
  });

  it('keeps global blocked route ahead of invalid session malformed command and missing idempotency', async () => {
    const fixture = futureFixture('global BLOCK plus invalid session, malformed command, and missing idempotency', new ScriptedP11RecordRepositoryFake([success()]), 'INVALID', 'BLOCK');
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'global-route-priority');
    const body = { operation: 'DELETE_RECORD', schemaVersion: 'stale-schema', expectedRecordVersion: -1, entries: 'invalid-entries' };
    const response = await rawCommand(authorized, body, 'invalid-task').set('x-request-id', sentinels.requestId);
    assertGlobalRouteError(response, sentinels, ['invalid-task', 'stale-schema', '-1', 'invalid-entries']);
    expect(fixture.fake.callCount).toBe(0);
  });

  it('maps unexpected fake rejection without exposing injected details', async () => {
    const provisional = createSentinels('repository-rejection', 'fixture-token-pending');
    const internal = `canonical=${provisional.internalCanonical};session=${provisional.internalSessionHash};secret=${provisional.internalSecret}`;
    const rejected = new Error(internal);
    const fixture = futureFixture('repository Promise rejects with hostile internal detail', new ScriptedP11RecordRepositoryFake([() => Promise.reject(rejected)]));
    const { authorized, sentinels } = await buildFixtureApplication(fixture, 'repository-rejection');
    const response = await command(authorized, sentinels, validCommand(sentinels.entryValue));
    assertError(response, 503, 'ROUTE_ACCESS_NOT_APPROVED', 'CLEAR_ALL', ['WAIT_FOR_SECURITY_APPROVAL'], sentinels, [internal, rejected.stack ?? '', sentinels.internalCanonical, sentinels.internalSessionHash, sentinels.internalSecret]);
    expect(fixture.fake.callCount).toBe(1);
  });

  async function buildFixtureApplication(fixture: FutureFixture, label: string) {
    app = await buildApplication(environment, {
      authPolicy: policy,
      recordSchemaProvider: { getApprovedRecordSchema: async () => fixture.recordSchema },
      routeAccessSnapshot: routeSnapshot(fixture.route),
      recordRepository: fixture.fake,
    });
    const agent = request(app.getHttpServer());
    const token = `test-issued-${label}-token`;
    await seedFixtureIdentity(app, fixture.auth, label, token);
    const authorized = { agent, token };
    return { app, fixture, authorized, sentinels: createSentinels(label, token) };
  }

  async function futureRequest(fixture: FutureFixture, label: string, body?: object, taskId = 'task-1') {
    expect(fixture.intent.trim().length).toBeGreaterThan(0);
    const { authorized, sentinels } = await buildFixtureApplication(fixture, label);
    const response = await command(authorized, sentinels, body ?? validCommand(sentinels.entryValue), taskId);
    return { response, sentinels };
  }

});

function createSentinels(label: string, token: string) {
  const rawKey = `idem-sensitive-${label}-7f29`;
  const requestId = `request-correlation-${label}-3a81`;
  expect(rawKey).not.toContain(requestId);
  expect(requestId).not.toContain(rawKey);
  return {
    rawKey, requestId, token,
    entryValue: `entry-sensitive-${label}-91c4`,
    internalCanonical: `canonical-${label}-0d52`,
    internalSessionHash: `session-hash-${label}-c83e`,
    internalSecret: `hmac-secret-${label}-e247`,
  } as const;
}

type Sentinels = ReturnType<typeof createSentinels>;

function validCommand(value: string) {
  return {
    operation: 'UPSERT_RECORD' as const, recordKindId: 'kind-1',
    schemaVersion: 'schema-v1', expectedRecordVersion: null,
    entries: [{ fieldId: 'field-1', value }],
  };
}

function rawCommand(authorized: { agent: ReturnType<typeof request>; token: string }, body: object, taskId = 'task-1') {
  return authorized.agent.post(`/api/v1/record-tasks/${taskId}/commands`)
    .set('Authorization', `Bearer ${authorized.token}`).send(body);
}

function command(authorized: Parameters<typeof rawCommand>[0], sentinels: Sentinels, body: object, taskId = 'task-1') {
  return rawCommand(authorized, body, taskId)
    .set('x-request-id', sentinels.requestId)
    .set('idempotency-key', sentinels.rawKey);
}

function assertSuccess(response: Response, sentinels: Sentinels) {
  expect(response.status).toBe(200);
  expect(Object.keys(response.body).sort()).toEqual(SUCCESS_KEYS);
  expect(response.body).toEqual(successBody);
  expect(response.body).not.toHaveProperty('recordId');
  expectNoSensitiveEcho(response, sentinels);
}

type Exposure = Readonly<{ rawKey?: boolean; entry?: boolean; token?: boolean }>;

function assertError(
  response: Response,
  status: number,
  errorCode: string,
  disposition: string,
  recoverableActions: readonly string[],
  sentinels: Sentinels,
  additionalForbidden: readonly string[] = [],
  exposure: Exposure = {},
) {
  expect(response.status).toBe(status);
  expect(Object.keys(response.body).sort()).toEqual(ERROR_KEYS);
  expect(response.body).toEqual({
    businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode, recoverableActions,
    clientStateDisposition: disposition, requestId: sentinels.requestId,
  });
  expect(response.body.requestId.trim().length).toBeGreaterThan(0);
  expectNoSensitiveEcho(response, sentinels, additionalForbidden, exposure);
}

function assertFallbackError(
  response: Response,
  status: number,
  errorCode: 'SESSION_INVALID' | 'RECORD_REQUEST_INVALID',
  sentinels: Sentinels,
  attackerInputs: readonly string[],
) {
  expect(response.status).toBe(status);
  expect(Object.keys(response.body).sort()).toEqual(ERROR_KEYS);
  expect(response.body).toMatchObject({
    businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode,
    clientStateDisposition: 'CLEAR_ALL', recoverableActions: [],
  });
  expect(typeof response.body.requestId).toBe('string');
  expect(response.body.requestId.trim().length).toBeGreaterThan(0);
  expect(response.body.requestId).not.toBe(sentinels.requestId);
  for (const forbidden of [sentinels.rawKey, sentinels.token, sentinels.entryValue, ...attackerInputs]) {
    if (forbidden.trim()) expect(response.body.requestId).not.toContain(forbidden);
  }
  expectNoSensitiveEcho(response, sentinels, attackerInputs);
}

function assertGlobalRouteError(response: Response, sentinels: Sentinels, attackerInputs: readonly string[] = []) {
  expect(response.status).toBe(503);
  expect(Object.keys(response.body).sort()).toEqual(ERROR_KEYS);
  expect(response.body).toEqual({
    businessStatus: 'IDENTITY_BLOCKED',
    errorCode: 'ROUTE_ACCESS_NOT_APPROVED',
    recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
    clientStateDisposition: 'CLEAR_ALL',
    requestId: sentinels.requestId,
  });
  expectNoSensitiveEcho(response, sentinels, attackerInputs, { rawKey: false, entry: false });
}

function expectNoSensitiveEcho(response: Response, sentinels: Sentinels, additional: readonly string[] = [], exposure: Exposure = {}) {
  const serialized = JSON.stringify(response.body);
  const forbidden = [
    exposure.rawKey === false ? undefined : sentinels.rawKey,
    exposure.entry === false ? undefined : sentinels.entryValue,
    exposure.token === false ? undefined : sentinels.token,
    ...additional,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
  for (const value of forbidden) expect(serialized).not.toContain(value);
}

function assertMappedInput(
  input: P11RecordPersistenceInput | undefined,
  sentinels: Sentinels,
  entryValue: string = sentinels.entryValue,
  expectedRecordVersion: number | null = null,
  taskId = 'task-1',
) {
  expect(input).toEqual({
    sessionTokenHash: createHash('sha256').update(sentinels.token).digest('hex'),
    taskId,
    idempotencyKey: sentinels.rawKey,
    requestId: sentinels.requestId,
    nodeEnv: 'test',
    schema,
    command: {
      operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
      expectedRecordVersion,
      entries: [{ fieldId: 'field-1', valueType: 'STRING', value: entryValue }],
    },
  });
  expect(input?.sessionTokenHash).toBe(createHash('sha256').update(sentinels.token).digest('hex'));
}

function normalizeScalarValue(input: P11RecordPersistenceInput) {
  return {
    ...input,
    command: {
      ...input.command,
      entries: input.command.entries.map((entry) => ({ ...entry, value: '<scalar-value>' })),
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function routeSnapshot(route: FutureFixture['route']): RouteAccessSnapshot {
  return Object.freeze({
    audience: 'TEST',
    blockers: Object.freeze(route === 'BLOCK' ? ['TEST_FIXTURE_ROUTE_BLOCKED'] : []),
    allowProtectedRoutes: route === 'ALLOW',
  });
}

async function seedFixtureIdentity(
  app: INestApplication,
  auth: FutureFixture['auth'],
  label: string,
  token: string,
) {
  if (auth === 'INVALID') return;
  const accountId = `pre-wire-${label}`;
  const passwordHash = await hashPassword('seed-password-1', policy);
  const database = app.get(DatabaseService).database;
  const staff = auth === 'NON_USER';
  await database.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ($1,$1,$2,$3,'ACTIVE',false)`, [accountId, passwordHash, staff ? 'STAFF' : 'USER']);
  if (staff) {
    await database.query(
      `INSERT INTO iam.account_role (account_id, role_code) VALUES ($1,'OPERATIONS')`,
      [accountId],
    );
  }
  await database.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
    VALUES ($1,$2,$3,$4,false,
      CASE WHEN $5 THEN now() - interval '1 second' ELSE now() + interval '15 minutes' END,
      $6,'FULL')`, [
    `session-${label}`,
    accountId,
    staff ? 'STAFF' : 'USER',
    createHash('sha256').update(token).digest('hex'),
    auth === 'EXPIRED',
    staff ? 'OPERATIONS' : 'USER',
  ]);
}
