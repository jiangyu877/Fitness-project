import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';
import { freezeRecordSchema, RECORD_SCHEMA, validRecordSchema, type RecordSchemaProvider } from '../src/records/p11-record-schema.provider.js';

const schema = () => ({
  version: 'test-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{ id: 'kind', fields: [{ id: 'field', valueType: 'STRING' as const }], allowedActions: ['UPSERT_RECORD' as const] }],
});

describe('P11 record schema provider boundary', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it.each([
    [{ ...schema(), extra: true }, 'schema root'],
    [{ ...schema(), recordKinds: [{ ...schema().recordKinds[0]!, extra: true }] }, 'record kind'],
    [{ ...schema(), recordKinds: [{ ...schema().recordKinds[0]!, fields: [{ ...schema().recordKinds[0]!.fields[0]!, extra: true }] }] }, 'field'],
  ] as const)('rejects unknown properties at the %s', (candidate, _level) => {
    expect(validRecordSchema(candidate)).toBe(false);
  });

  it.each([
    [null], [{ ...schema(), version: ' ' }], [{ ...schema(), testOnly: false }],
    [{ ...schema(), approvedForRealUsers: true }], [{ ...schema(), recordKinds: 'invalid' }],
  ])('rejects missing, malformed, or non-test-safe schema %#', (candidate) => {
    expect(validRecordSchema(candidate)).toBe(false);
  });

  it('deeply snapshots the schema against caller mutation', () => {
    const source = schema();
    const snapshot = freezeRecordSchema(source);
    source.version = 'mutated';
    source.recordKinds[0]!.id = 'mutated';
    source.recordKinds[0]!.fields[0]!.id = 'mutated';
    source.recordKinds[0]!.allowedActions.length = 0;
    expect(snapshot).toEqual(schema());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.recordKinds[0]!.fields[0])).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['throws', { getApprovedRecordSchema: async () => { throw new Error('provider down'); } }],
  ] as const)('fails closed when the provider is %s', async (_case, recordSchemaProvider) => {
    app = await buildApplication(testEnvironment, recordSchemaProvider ? { recordSchemaProvider } : {});
    expect(app.get<RecordSchemaProvider | null>(RECORD_SCHEMA)).toBeNull();
  });

  it('ignores record schema injection outside the test environment', async () => {
    let calls = 0;
    app = await buildApplication({ ...testEnvironment, nodeEnv: 'production' }, {
      recordSchemaProvider: { getApprovedRecordSchema: async () => { calls += 1; return schema(); } },
    });
    expect(calls).toBe(0);
    expect(app.get<RecordSchemaProvider | null>(RECORD_SCHEMA)).toBeNull();
  });

  it('pins a provider snapshot against later caller mutation', async () => {
    const source = schema();
    app = await buildApplication(testEnvironment, {
      recordSchemaProvider: { getApprovedRecordSchema: async () => source },
    });
    source.version = 'mutated';
    source.recordKinds[0]!.fields[0]!.id = 'mutated';
    const pinned = app.get<RecordSchemaProvider>(RECORD_SCHEMA);
    expect(await pinned.getApprovedRecordSchema()).toEqual(schema());
  });
});

const testEnvironment: Environment = {
  nodeEnv: 'test', port: 3000, databasePath: 'memory://', demoMode: false,
  professionalRulesApproved: false, authSecurityPolicyApproved: false,
  privacyReviewApproved: false, dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false, operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};
