import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const webDirectory = join(import.meta.dirname, '..');
const outputDirectory = join(webDirectory, '.production-bundle-check');
const viteCli = join(webDirectory, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js');
const prohibitedTerms = [
  '切换演示用户',
  'development-persona-switcher',
  '林晓雨',
  '周屿',
  '.persona',
  '.persona__copy',
  '.persona--compact',
];

function collectTextFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectTextFiles(path) : [path];
  });
}

rmSync(outputDirectory, { recursive: true, force: true });

try {
  const build = spawnSync(process.execPath, [viteCli, 'build', '--config', 'vite.config.ts', '--outDir', outputDirectory, '--emptyOutDir'], {
    cwd: webDirectory,
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(build.stderr || build.stdout || 'Fresh production build failed');

  const bundleText = collectTextFiles(outputDirectory)
    .filter((path) => /\.(css|html|js|json|map|txt)$/i.test(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  for (const term of prohibitedTerms) {
    if (bundleText.includes(term)) {
      throw new Error(`Fresh production bundle contains development-only code: ${term}`);
    }
  }
} finally {
  if (existsSync(outputDirectory)) rmSync(outputDirectory, { recursive: true, force: true });
}
