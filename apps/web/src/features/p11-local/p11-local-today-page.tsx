import { useEffect, useState } from 'react';

import { prototypeDisclaimer } from '../../mocks/personas.js';
import { parseManifest, type P11LocalFixture } from './p11-local-runtime-page.js';

type Fetcher = typeof fetch;

type Props = {
  fetcher?: Fetcher;
  onOpen: (fixture: P11LocalFixture) => void;
};

type TaskState = 'OPEN' | 'CLOSED' | 'UNKNOWN';
type RiskState = 'CLEAR' | 'BLOCKED' | 'UNKNOWN';

type P11LocalTask = Readonly<{
  taskId: string;
  businessDate: string;
  taskState: TaskState;
  dateState: TaskState;
  riskState: RiskState;
}>;

const expectedFixtureIds = ['persona_fat_loss', 'persona_muscle_gain'] as const;

function invalid(): never {
  throw new Error('P11_LOCAL_TASK_SURFACE_INVALID');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stateValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}

function parseTask(value: unknown): P11LocalTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const task = value as Record<string, unknown>;
  const expectedKeys = ['taskId', 'businessDate', 'taskState', 'dateState', 'riskState'];
  const keys = Object.keys(task);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) invalid();
  if (!nonEmptyString(task.taskId) || !nonEmptyString(task.businessDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(task.businessDate)) invalid();
  return {
    taskId: task.taskId,
    businessDate: task.businessDate,
    taskState: stateValue(task.taskState, ['OPEN', 'CLOSED', 'UNKNOWN'] as const),
    dateState: stateValue(task.dateState, ['OPEN', 'CLOSED', 'UNKNOWN'] as const),
    riskState: stateValue(task.riskState, ['CLEAR', 'BLOCKED', 'UNKNOWN'] as const),
  };
}

function parseTaskSurface(
  value: unknown,
  fixtures: readonly P11LocalFixture[],
): ReadonlyMap<string, readonly P11LocalTask[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const surface = value as Record<string, unknown>;
  const keys = Object.keys(surface);
  if (keys.length !== 2 || !keys.includes('testOnly') || !keys.includes('fixtures')
    || surface.testOnly !== true) invalid();
  if (!Array.isArray(surface.fixtures) || surface.fixtures.length !== expectedFixtureIds.length) invalid();
  const byFixture = new Map<string, readonly P11LocalTask[]>();
  for (const entry of surface.fixtures) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid();
    const record = entry as Record<string, unknown>;
    const entryKeys = Object.keys(record);
    if (entryKeys.length !== 2 || !entryKeys.includes('fixtureId') || !entryKeys.includes('tasks')) invalid();
    const fixtureId = stateValue(record.fixtureId, expectedFixtureIds);
    if (byFixture.has(fixtureId)) invalid();
    if (!Array.isArray(record.tasks) || record.tasks.length === 0) invalid();
    const tasks = record.tasks.map(parseTask);
    if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) invalid();
    byFixture.set(fixtureId, tasks);
  }
  for (const fixtureId of expectedFixtureIds) {
    if (!byFixture.has(fixtureId)) invalid();
  }
  for (const fixture of fixtures) {
    const tasks = byFixture.get(fixture.fixtureId);
    if (!tasks || !tasks.some((task) => task.taskId === fixture.taskId)) invalid();
  }
  return byFixture;
}

export function P11LocalTodayPage({ fetcher = fetch, onOpen }: Props) {
  const [state, setState] = useState<{
    fixtures: readonly P11LocalFixture[];
    tasks: ReadonlyMap<string, readonly P11LocalTask[]>;
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetcher('/p11-local/fixtures', { headers: { Accept: 'application/json' } }),
      fetcher('/p11-local/tasks', { headers: { Accept: 'application/json' } }),
    ]).then(async ([manifestResponse, tasksResponse]) => {
      if (!manifestResponse.ok || !tasksResponse.ok) throw new Error('P11_LOCAL_RUNTIME_UNAVAILABLE');
      const fixtures = parseManifest(await manifestResponse.json());
      const tasks = parseTaskSurface(await tasksResponse.json(), fixtures);
      return { fixtures, tasks };
    }).then((next) => {
      if (active) setState(next);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error && cause.message === 'P11_LOCAL_RUNTIME_UNAVAILABLE'
        ? cause.message
        : 'P11_LOCAL_TASK_SURFACE_INVALID');
    });
    return () => { active = false; };
  }, [fetcher]);

  if (error) {
    return <div className="generic-page generic-page--h5" data-testid="p11-local-today-error" role="alert">
      <h1>今日任务</h1>
      <output data-testid="p11-local-today-error-code">{error}</output>
    </div>;
  }

  if (!state) {
    return <div className="generic-page generic-page--h5" data-testid="p11-local-today-loading" role="status">P11_LOCAL_RUNTIME_LOADING</div>;
  }

  return <div className="generic-page generic-page--h5" data-testid="p11-local-today">
    <div className="demo-notice" role="note">{prototypeDisclaimer}</div>
    <h1>今日任务</h1>
    <p>打开今日可执行任务（本地测试运行时，仅结构任务）。</p>
    {state.fixtures.map((fixture) => <div
      className="state-panel"
      key={fixture.fixtureId}
      aria-label={`${fixture.goalType === 'FAT_LOSS' ? '减脂' : '增肌'}任务列表`}
    >
      <h2>{fixture.goalType === 'FAT_LOSS' ? '减脂测试路径' : '增肌测试路径'}</h2>
      {(state.tasks.get(fixture.fixtureId) ?? []).map((task) => <button
        className="button"
        data-business-date={task.businessDate}
        data-fixture-id={fixture.fixtureId}
        data-testid="p11-local-today-task"
        key={task.taskId}
        type="button"
        onClick={() => onOpen({ ...fixture, taskId: task.taskId })}
      >
        {task.businessDate}
      </button>)}
    </div>)}
  </div>;
}
