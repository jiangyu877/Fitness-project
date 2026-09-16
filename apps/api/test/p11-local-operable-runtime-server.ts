import { startP11LocalOperableRuntime } from './support/p11-local-operable-runtime.js';

const adminUrl = process.env.P11_LOCAL_POSTGRES_ADMIN_URL ?? process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;
if (!adminUrl?.trim()) {
  throw new Error('P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED');
}

const port = parsePort(process.env.P11_LOCAL_API_PORT ?? '3100');
const runtime = await startP11LocalOperableRuntime({ adminUrl, port });
let closing: Promise<void> | undefined;

process.stdout.write(`P11_LOCAL_RUNTIME_READY ${runtime.baseUrl}\n`);

async function shutdown(): Promise<void> {
  closing ??= runtime.close();
  await closing;
}

process.once('SIGINT', () => { void finishShutdown(); });
process.once('SIGTERM', () => { void finishShutdown(); });
process.stdin.resume();
process.stdin.once('end', () => { void finishShutdown(); });

async function finishShutdown(): Promise<void> {
  try {
    await shutdown();
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'P11_LOCAL_RUNTIME_CLEANUP_FAILED'}\n`);
    process.exit(1);
  }
}

await new Promise<void>(() => undefined);

function parsePort(value: string): number {
  const portValue = Number(value);
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535) {
    throw new Error('P11_LOCAL_PORT_INVALID');
  }
  return portValue;
}
