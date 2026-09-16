import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';

import {
  assertAcceptableWebExit,
  assertSuccessfulApiCleanup,
  fetchWithTimeout,
  p11LocalApiSpawnOptions,
  requireLocalAdminUrl,
  waitForLauncherReady,
} from './support/p11-local-operable-runtime-lifecycle.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
}

describe('P11 local launcher lifecycle', () => {
  it('rejects a missing PostgreSQL administrator URL before spawning children', () => {
    expect(() => requireLocalAdminUrl(undefined)).toThrow('P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED');
    expect(() => requireLocalAdminUrl('   ')).toThrow('P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED');
  });

  it('times out when the API never publishes its readiness line', async () => {
    const child = new FakeChild() as unknown as ChildProcess;

    await expect(waitForLauncherReady(child, () => false, 10)).rejects.toThrow('P11_LOCAL_API_READY_TIMEOUT');
  });

  it('stops waiting for readiness when shutdown begins', async () => {
    const child = new FakeChild() as unknown as ChildProcess;

    await expect(waitForLauncherReady(child, () => true, 1_000)).rejects.toThrow('P11_LOCAL_RUNTIME_STOPPED');
  });

  it('accepts a signal-stopped web child only during launcher shutdown', () => {
    expect(() => assertAcceptableWebExit({ code: null, signal: 'SIGTERM' }, true)).not.toThrow();
    expect(() => assertAcceptableWebExit({ code: null, signal: 'SIGTERM' }, false)).toThrow('P11_LOCAL_WEB_EXIT_SIGNAL_SIGTERM');
  });

  it('propagates API cleanup failure and signal exit', () => {
    expect(() => assertSuccessfulApiCleanup({ code: 1, signal: null })).toThrow('P11_LOCAL_API_CLEANUP_EXIT_1');
    expect(() => assertSuccessfulApiCleanup({ code: null, signal: 'SIGTERM' })).toThrow('P11_LOCAL_API_CLEANUP_EXIT_SIGNAL_SIGTERM');
    expect(() => assertSuccessfulApiCleanup({ code: 0, signal: null })).not.toThrow();
  });

  it('isolates only the Windows API child from console Ctrl+C delivery', () => {
    expect(p11LocalApiSpawnOptions('win32')).toEqual({ detached: true, windowsHide: true });
    expect(p11LocalApiSpawnOptions('linux')).toEqual({});
  });

  it('aborts an unresponsive loopback fetch at its per-request deadline', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })) as typeof fetch;

    await expect(fetchWithTimeout(fetcher, 'http://127.0.0.1:3100/never', {}, 10))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal?.aborted).toBe(true);
  });
});
