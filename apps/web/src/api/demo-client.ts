import { prototypeDisclaimer, type DemoPersona } from '../mocks/personas.js';

export type FixtureId = DemoPersona['id'];
export type GoalType = 'FAT_LOSS' | 'MUSCLE_GAIN';
export type ReadinessBlocker = 'PROFESSIONAL_RULES_UNAPPROVED';

export interface DemoFixtureResponse {
  fixtureId: FixtureId;
  goalType: GoalType;
  demoOnly: true;
  reviewStatus: 'DEMO_UNREVIEWED';
  publishable: false;
  disclaimer: typeof prototypeDisclaimer;
}

export interface ReadinessResponse {
  readyForRealUsers: boolean;
  blockers: ReadinessBlocker[];
}

export interface DemoContext {
  source: 'api' | 'fallback';
  fixture: DemoFixtureResponse;
  readiness: ReadinessResponse;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const fallbackReadiness: ReadinessResponse = {
  readyForRealUsers: false,
  blockers: ['PROFESSIONAL_RULES_UNAPPROVED'],
};

function createFallbackFixture(fixtureId: FixtureId): DemoFixtureResponse {
  return {
    fixtureId,
    goalType: fixtureId === 'persona_fat_loss' ? 'FAT_LOSS' : 'MUSCLE_GAIN',
    demoOnly: true,
    reviewStatus: 'DEMO_UNREVIEWED',
    publishable: false,
    disclaimer: prototypeDisclaimer,
  };
}

function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.readyForRealUsers === 'boolean'
    && Array.isArray(candidate.blockers)
    && candidate.blockers.every((blocker) => blocker === 'PROFESSIONAL_RULES_UNAPPROVED');
}

function isSafeDemoFixture(value: unknown, fixtureId: FixtureId): value is DemoFixtureResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const expectedGoal = fixtureId === 'persona_fat_loss' ? 'FAT_LOSS' : 'MUSCLE_GAIN';
  return candidate.fixtureId === fixtureId
    && candidate.goalType === expectedGoal
    && candidate.demoOnly === true
    && candidate.reviewStatus === 'DEMO_UNREVIEWED'
    && candidate.publishable === false
    && candidate.disclaimer === prototypeDisclaimer;
}

export async function loadDemoContext(
  fixtureId: FixtureId,
  fetcher: FetchLike = fetch,
): Promise<DemoContext> {
  try {
    const [readinessResponse, fixtureResponse] = await Promise.all([
      fetcher('/api/v1/readiness'),
      fetcher(`/api/v1/demo/personas/${fixtureId}`),
    ]);
    if (!readinessResponse.ok || !fixtureResponse.ok) throw new Error('Demo API unavailable');

    const [readiness, fixture] = await Promise.all([
      readinessResponse.json() as Promise<unknown>,
      fixtureResponse.json() as Promise<unknown>,
    ]);
    if (!isReadinessResponse(readiness) || !isSafeDemoFixture(fixture, fixtureId)) {
      throw new Error('Demo API safety contract mismatch');
    }

    return { source: 'api', readiness, fixture };
  } catch {
    return {
      source: 'fallback',
      readiness: fallbackReadiness,
      fixture: createFallbackFixture(fixtureId),
    };
  }
}
