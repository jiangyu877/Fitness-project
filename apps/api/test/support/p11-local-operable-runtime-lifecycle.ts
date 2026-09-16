import type { ChildProcess, SpawnOptions } from 'node:child_process';

export type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export function requireLocalAdminUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED');
  return value.trim();
}

export function p11LocalApiSpawnOptions(platform = process.platform): Pick<SpawnOptions, 'detached' | 'windowsHide'> {
  return platform === 'win32' ? { detached: true, windowsHide: true } : {};
}

export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function waitForLauncherReady(
  child: ChildProcess,
  isShuttingDown: () => boolean,
  timeoutMs = 15_000,
  onReady?: (line: string) => void,
): Promise<void> {
  if (isShuttingDown()) return Promise.reject(new Error('P11_LOCAL_RUNTIME_STOPPED'));
  return new Promise((resolveReady, rejectReady) => {
    let output = '';
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(shutdownCheck);
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      outcome();
    };
    const onData = (chunk: Buffer | string) => {
      output += String(chunk);
      const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith('P11_LOCAL_RUNTIME_READY '));
      if (line) finish(() => { onReady?.(line); resolveReady(); });
    };
    const onError = (error: Error) => finish(() => rejectReady(error));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(() => {
      if (isShuttingDown()) rejectReady(new Error('P11_LOCAL_RUNTIME_STOPPED'));
      else rejectReady(new Error(`P11_LOCAL_API_EXIT_${exitLabel({ code, signal })}`));
    });
    const timeout = setTimeout(
      () => finish(() => rejectReady(new Error('P11_LOCAL_API_READY_TIMEOUT'))),
      timeoutMs,
    );
    const shutdownCheck = setInterval(() => {
      if (isShuttingDown()) finish(() => rejectReady(new Error('P11_LOCAL_RUNTIME_STOPPED')));
    }, Math.min(100, timeoutMs));
    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export function waitForChildExit(child: ChildProcess): Promise<ChildExit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
}

export async function waitForChildExitWithin(child: ChildProcess, timeoutMs: number): Promise<ChildExit | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    waitForChildExit(child),
    new Promise<null>((resolveTimeout) => { timeout = setTimeout(() => resolveTimeout(null), timeoutMs); }),
  ]);
  if (timeout) clearTimeout(timeout);
  return result;
}

export function assertAcceptableWebExit(exit: ChildExit, shuttingDown: boolean): void {
  if (shuttingDown || exit.code === 0) return;
  throw new Error(`P11_LOCAL_WEB_EXIT_${exitLabel(exit)}`);
}

export function assertSuccessfulApiCleanup(exit: ChildExit): void {
  if (exit.code === 0 && exit.signal === null) return;
  throw new Error(`P11_LOCAL_API_CLEANUP_EXIT_${exitLabel(exit)}`);
}

function exitLabel(exit: ChildExit): string {
  return exit.code === null ? `SIGNAL_${exit.signal ?? 'UNKNOWN'}` : String(exit.code);
}
