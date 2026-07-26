import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const docsUiRoot = fileURLToPath(new URL('../../../../docs/ui/', import.meta.url));

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

describe('UI documentation review status', () => {
  it('keeps UI artifacts pending product review and outside acceptance evidence', () => {
    const content = markdownFiles(docsUiRoot).map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(content).not.toContain('产品规则符合性复核通过');
    expect(content).not.toContain('独立复核通过');
    expect(content).toContain('待产品部复核');
    expect(content).toContain('未作为验收证据');
  });
});
