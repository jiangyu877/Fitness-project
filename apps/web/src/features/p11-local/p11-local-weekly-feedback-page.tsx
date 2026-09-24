import { useCallback, useEffect, useState } from 'react';

import { prototypeDisclaimer } from '../../mocks/personas.js';
import { parseWeeklyFeedbackView, type WeeklyFeedbackView } from '../weekly-feedback-real/weekly-feedback-view.js';
import { WeeklyFeedbackPage } from '../weekly-feedback-real/weekly-feedback-page.js';
import { parseManifest, type P11LocalFixture } from './p11-local-runtime-page.js';

type Fetcher = typeof fetch;

type Props = {
  fetcher?: Fetcher;
};

type WeeklyEntry = Readonly<{ fixtureId: P11LocalFixture['fixtureId']; view: WeeklyFeedbackView }>;

const expectedFixtureIds = ['persona_fat_loss', 'persona_muscle_gain'] as const;

function invalid(): never {
  throw new Error('P11_LOCAL_WEEKLY_FEEDBACK_INVALID');
}

function parseWeeklyEnvelope(value: unknown): readonly WeeklyEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const envelope = value as Record<string, unknown>;
  const keys = Object.keys(envelope);
  if (keys.length !== 2 || !keys.includes('testOnly') || !keys.includes('fixtures')
    || envelope.testOnly !== true) invalid();
  if (!Array.isArray(envelope.fixtures) || envelope.fixtures.length !== expectedFixtureIds.length) invalid();
  const entries: WeeklyEntry[] = [];
  for (const entry of envelope.fixtures) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid();
    const record = entry as Record<string, unknown>;
    const entryKeys = Object.keys(record);
    if (entryKeys.length !== 2 || !entryKeys.includes('fixtureId') || !entryKeys.includes('view')) invalid();
    const fixtureId = record.fixtureId;
    if (typeof fixtureId !== 'string'
      || !(expectedFixtureIds as readonly string[]).includes(fixtureId)) invalid();
    let view: WeeklyFeedbackView;
    try {
      view = parseWeeklyFeedbackView(record.view);
    } catch {
      invalid();
    }
    entries.push({ fixtureId: fixtureId as P11LocalFixture['fixtureId'], view });
  }
  if (new Set(entries.map((entry) => entry.fixtureId)).size !== expectedFixtureIds.length) invalid();
  return entries;
}

export function P11LocalWeeklyFeedbackPage({ fetcher = fetch }: Props) {
  const [state, setState] = useState<{ fixtures: readonly P11LocalFixture[]; entries: readonly WeeklyEntry[] }>();
  const [error, setError] = useState<string>();

  const load = useCallback(async (): Promise<void> => {
    const [manifestResponse, feedbackResponse] = await Promise.all([
      fetcher('/p11-local/fixtures', { headers: { Accept: 'application/json' } }),
      fetcher('/p11-local/weekly-feedback', { headers: { Accept: 'application/json' } }),
    ]);
    if (!manifestResponse.ok || !feedbackResponse.ok) throw new Error('P11_LOCAL_RUNTIME_UNAVAILABLE');
    const fixtures = parseManifest(await manifestResponse.json());
    const entries = parseWeeklyEnvelope(await feedbackResponse.json());
    setState({ fixtures, entries });
  }, [fetcher]);

  useEffect(() => {
    let active = true;
    void load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error && cause.message === 'P11_LOCAL_RUNTIME_UNAVAILABLE'
        ? cause.message
        : 'P11_LOCAL_WEEKLY_FEEDBACK_INVALID');
    });
    return () => { active = false; };
  }, [load]);

  async function submit(fixtureId: string, requestedOutcome: string): Promise<void> {
    try {
      const response = await fetcher('/p11-local/weekly-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ fixtureId, requestedOutcome }),
      });
      if (!response.ok) throw new Error('P11_LOCAL_RUNTIME_UNAVAILABLE');
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.message === 'P11_LOCAL_RUNTIME_UNAVAILABLE'
        ? cause.message
        : 'P11_LOCAL_WEEKLY_FEEDBACK_INVALID');
    }
  }

  if (error) {
    return <div className="generic-page generic-page--h5" data-testid="p11-local-weekly-error" role="alert">
      <h1>周反馈</h1>
      <output data-testid="p11-local-weekly-error-code">{error}</output>
    </div>;
  }

  if (!state) {
    return <div className="generic-page generic-page--h5" data-testid="p11-local-weekly-loading" role="status">P11_LOCAL_RUNTIME_LOADING</div>;
  }

  return <div className="generic-page generic-page--h5" data-testid="p11-local-weekly">
    <div className="demo-notice" role="note">{prototypeDisclaimer}</div>
    <h1>周反馈</h1>
    <p>提交执行与恢复反馈（本地测试运行时，仅结构字段）。</p>
    {state.fixtures.map((fixture) => {
      const entry = state.entries.find((candidate) => candidate.fixtureId === fixture.fixtureId);
      if (!entry) return null;
      return <div className="state-panel" key={fixture.fixtureId} aria-label={`${fixture.goalType === 'FAT_LOSS' ? '减脂' : '增肌'}周反馈`}>
        <h2>{fixture.goalType === 'FAT_LOSS' ? '减脂测试路径' : '增肌测试路径'}</h2>
        <WeeklyFeedbackPage
          view={entry.view}
          onSubmit={(outcome) => void submit(fixture.fixtureId, outcome)}
        />
      </div>;
    })}
  </div>;
}
