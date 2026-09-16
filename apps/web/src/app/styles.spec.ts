import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('H5 fixed navigation safety space', () => {
  it('reserves enough bottom space for the fixed navigation at high zoom', () => {
    expect(styles).toMatch(/\.h5-main\s*\{[^}]*padding-bottom:\s*calc\(112px\s*\+\s*env\(safe-area-inset-bottom\)\)/s);
  });

  it('does not force a wider layout than a narrow high-zoom viewport', () => {
    expect(styles).not.toMatch(/body\s*\{[^}]*min-width:\s*320px/s);
  });
});
