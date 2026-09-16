import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertAcceptableWebExit,
  assertSuccessfulApiCleanup,
  fetchWithTimeout,
  p11LocalApiSpawnOptions,
  requireLocalAdminUrl,
  waitForChildExit,
  waitForChildExitWithin,
  waitForLauncherReady,
  type ChildExit,
} from '../apps/api/test/support/p11-local-operable-runtime-lifecycle.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webDirectory = join(root, 'apps', 'web');
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const apiScript = join(root, 'apps', 'api', 'test', 'p11-local-operable-runtime-server.ts');
const apiTsconfig = join(root, 'apps', 'api', 'tsconfig.json');
const adminUrl = process.env.P11_LOCAL_POSTGRES_ADMIN_URL ?? process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'P11_LOCAL_RUNTIME_FAILED'}\n`);
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const verifiedAdminUrl = requireLocalAdminUrl(adminUrl);
  if (!existsSync(tsxCli) || !existsSync(viteCli) || !existsSync(apiScript) || !existsSync(apiTsconfig)) throw new Error('P11_LOCAL_RUNTIME_TOOLS_MISSING');

  const apiPort = parsePort(process.env.P11_LOCAL_API_PORT ?? '3100');
  const webPort = parsePort(process.env.P11_LOCAL_WEB_PORT ?? '5175');
  const childEnvironment = {
    ...process.env,
    P11_LOCAL_POSTGRES_ADMIN_URL: verifiedAdminUrl,
    P11_LOCAL_API_PORT: String(apiPort),
  };
  const api = spawn(process.execPath, [tsxCli, '--tsconfig', apiTsconfig, apiScript], {
    cwd: root,
    env: childEnvironment,
    stdio: ['pipe', 'pipe', 'inherit'],
    ...p11LocalApiSpawnOptions(),
  });
  let web: ChildProcess | undefined;
  let shuttingDown = false;
  let operatorShutdown = false;
  let webExit: ChildExit = { code: 0, signal: null };
  const apiFailure = { error: undefined as Error | undefined };
  api.once('exit', (code) => {
    if (!shuttingDown) {
      apiFailure.error = new Error(`P11_LOCAL_API_EXIT_${code ?? 'SIGNAL'}`);
      web?.kill('SIGTERM');
    }
  });
  const stopChildren = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    operatorShutdown = true;
    if (web && web.exitCode === null) web.kill('SIGTERM');
    void requestApiShutdown(`http://127.0.0.1:${apiPort}`);
    if (api.exitCode === null) api.stdin?.end();
  };
  process.once('SIGINT', stopChildren);
  process.once('SIGTERM', stopChildren);

  try {
    await waitForLauncherReady(api, () => shuttingDown, 15_000, (line) => process.stdout.write(`${line}\n`));
    web = spawn(process.execPath, [viteCli, '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(webPort), '--mode', 'test'], {
      cwd: webDirectory,
      env: {
        ...childEnvironment,
        VITE_P11_LOCAL_RUNTIME: 'true',
      },
      stdio: 'inherit',
    });
    await waitForHttp(`http://127.0.0.1:${webPort}/h5/p11-local`, web, () => shuttingDown);
    if (apiFailure.error) throw apiFailure.error;
    process.stdout.write(`P11_LOCAL_WEB_READY http://127.0.0.1:${webPort}/h5/p11-local\n`);

    webExit = await waitForChildExit(web);
    if (apiFailure.error) throw apiFailure.error;
  } finally {
    shuttingDown = true;
    process.off('SIGINT', stopChildren);
    process.off('SIGTERM', stopChildren);
    const cleanup = await Promise.allSettled([
      stopChild(web),
      stopApiChild(api, `http://127.0.0.1:${apiPort}`),
    ]);
    const cleanupErrors = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'P11_LOCAL_LAUNCHER_CLEANUP_FAILED');
  }

  assertAcceptableWebExit(webExit, operatorShutdown);
}

async function waitForHttp(url: string, child: ChildProcess, isShuttingDown: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (isShuttingDown()) throw new Error('P11_LOCAL_RUNTIME_STOPPED');
    if (child.exitCode !== null) throw new Error(`P11_LOCAL_WEB_EXIT_${child.exitCode}`);
    try {
      const response = await fetchWithTimeout(fetch, url, {}, Math.max(1, Math.min(1000, deadline - Date.now())));
      if (response.ok) return;
    } catch {
      // Vite may need a short interval to bind its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('P11_LOCAL_WEB_READY_TIMEOUT');
}

async function stopChild(child: ChildProcess | undefined, gracefulInput = false): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (gracefulInput) child.stdin?.end();
  else child.kill('SIGTERM');
  let result = await waitForChildExitWithin(child, 5000);
  if (!result) {
    child.kill('SIGTERM');
    result = await waitForChildExitWithin(child, 2000);
  }
  if (!result) throw new Error('P11_LOCAL_WEB_STOP_TIMEOUT');
}

async function stopApiChild(child: ChildProcess, baseUrl: string): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    await requestApiShutdown(baseUrl);
    child.stdin?.end();
  }
  let result = await waitForChildExitWithin(child, 5000);
  if (!result) {
    child.kill('SIGTERM');
    result = await waitForChildExitWithin(child, 2000);
  }
  if (!result) throw new Error('P11_LOCAL_API_STOP_TIMEOUT');
  assertSuccessfulApiCleanup(result);
}

async function requestApiShutdown(baseUrl: string): Promise<void> {
  try {
    await fetchWithTimeout(fetch, `${baseUrl}/p11-local/shutdown`, { method: 'POST' }, 1000);
  } catch {
    // The API may have exited before the control request reached it.
  }
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('P11_LOCAL_PORT_INVALID');
  return port;
}
