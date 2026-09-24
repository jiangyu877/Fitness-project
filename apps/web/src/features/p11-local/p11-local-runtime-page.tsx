import { useEffect, useState } from 'react';

import { prototypeDisclaimer } from '../../mocks/personas.js';

export type P11LocalFixture = Readonly<{
  fixtureId: 'persona_fat_loss' | 'persona_muscle_gain';
  goalType: 'FAT_LOSS' | 'MUSCLE_GAIN';
  accountId: string;
  taskId: string;
  sessionToken: string;
  expiresAt: string;
}>;

type Fetcher = typeof fetch;

type Props = {
  fetcher?: Fetcher;
  onOpen: (fixture: P11LocalFixture) => void;
};

const expectedFixtures = new Map<P11LocalFixture['fixtureId'], P11LocalFixture['goalType']>([
  ['persona_fat_loss', 'FAT_LOSS'],
  ['persona_muscle_gain', 'MUSCLE_GAIN'],
]);

function invalid(): never {
  throw new Error('P11_LOCAL_FIXTURE_MANIFEST_INVALID');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseFixture(value: unknown): P11LocalFixture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const fixture = value as Record<string, unknown>;
  const keys = Object.keys(fixture);
  const expectedKeys = ['fixtureId', 'goalType', 'accountId', 'taskId', 'sessionToken', 'expiresAt'];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) invalid();
  if (!nonEmptyString(fixture.fixtureId) || !expectedFixtures.has(fixture.fixtureId as P11LocalFixture['fixtureId'])) invalid();
  const fixtureId = fixture.fixtureId as P11LocalFixture['fixtureId'];
  if (fixture.goalType !== expectedFixtures.get(fixtureId)
    || !nonEmptyString(fixture.accountId)
    || !nonEmptyString(fixture.taskId)
    || !nonEmptyString(fixture.sessionToken)
    || !nonEmptyString(fixture.expiresAt)) invalid();
  return {
    fixtureId,
    goalType: fixture.goalType as P11LocalFixture['goalType'],
    accountId: fixture.accountId,
    taskId: fixture.taskId,
    sessionToken: fixture.sessionToken,
    expiresAt: fixture.expiresAt,
  };
}

export function parseManifest(value: unknown): readonly P11LocalFixture[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const manifest = value as Record<string, unknown>;
  const keys = Object.keys(manifest);
  if (keys.length !== 2 || !keys.includes('testOnly') || !keys.includes('fixtures') || manifest.testOnly !== true) invalid();
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== expectedFixtures.size) invalid();
  const fixtures = manifest.fixtures.map(parseFixture);
  if (new Set(fixtures.map((fixture) => fixture.fixtureId)).size !== expectedFixtures.size) invalid();
  if (new Set(fixtures.map((fixture) => fixture.accountId)).size !== expectedFixtures.size) invalid();
  if (new Set(fixtures.map((fixture) => fixture.taskId)).size !== expectedFixtures.size) invalid();
  if (new Set(fixtures.map((fixture) => fixture.sessionToken)).size !== expectedFixtures.size) invalid();
  for (const fixtureId of expectedFixtures.keys()) {
    if (!fixtures.some((fixture) => fixture.fixtureId === fixtureId)) invalid();
  }
  return fixtures;
}

export function P11LocalRuntimePage({ fetcher = fetch, onOpen }: Props) {
  const [fixtures, setFixtures] = useState<readonly P11LocalFixture[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void fetcher('/p11-local/fixtures', { headers: { Accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error('P11_LOCAL_RUNTIME_UNAVAILABLE');
      return parseManifest(await response.json());
    }).then((nextFixtures) => {
      if (active) setFixtures(nextFixtures);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error && cause.message === 'P11_LOCAL_RUNTIME_UNAVAILABLE'
        ? cause.message
        : 'P11_LOCAL_FIXTURE_MANIFEST_INVALID');
    });
    return () => { active = false; };
  }, [fetcher]);

  if (error) {
    return <div className="generic-page generic-page--h5" data-testid="p11-local-runtime-error" role="alert">
      <h1>P11 本地测试运行时</h1>
      <output>{error}</output>
    </div>;
  }

  if (!fixtures) {
    return <div className="generic-page generic-page--h5" data-testid="p11-local-runtime-loading" role="status">P11_LOCAL_RUNTIME_LOADING</div>;
  }

  return <div className="generic-page generic-page--h5" data-testid="p11-local-runtime">
    <div className="demo-notice" role="note">{prototypeDisclaimer}</div>
    <h1>P11 双路线本地测试</h1>
    <p>选择一条虚构测试路径开始记录结构验收。</p>
    <div className="state-panel" aria-label="测试路径选择">
      {fixtures.map((fixture) => <button
        className="button"
        key={fixture.fixtureId}
        type="button"
        onClick={() => onOpen(fixture)}
      >
        {fixture.goalType === 'FAT_LOSS' ? '打开减脂测试路径' : '打开增肌测试路径'}
      </button>)}
    </div>
  </div>;
}
