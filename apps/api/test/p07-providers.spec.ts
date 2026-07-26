import { describe, expect, it } from 'vitest';

import { validConsent, validProfileSchema } from '../src/identity/p07-providers.js';

describe('P07 provider validation', () => {
  it.each([
    ['blank version', { version: '   ', steps: [{ id: 'basics', fields: [{ name: 'label', type: 'STRING' }] }] }],
    ['blank step id', { version: 'v1', steps: [{ id: ' ', fields: [{ name: 'label', type: 'STRING' }] }] }],
    ['duplicate steps', { version: 'v1', steps: [{ id: 'basics', fields: [{ name: 'label', type: 'STRING' }] }, { id: 'basics', fields: [{ name: 'flag', type: 'BOOLEAN' }] }] }],
    ['empty fields', { version: 'v1', steps: [{ id: 'basics', fields: [] }] }],
    ['blank field name', { version: 'v1', steps: [{ id: 'basics', fields: [{ name: ' ', type: 'STRING' }] }] }],
    ['duplicate fields', { version: 'v1', steps: [{ id: 'basics', fields: [{ name: 'label', type: 'STRING' }, { name: 'label', type: 'STRING' }] }] }],
    ['invalid required', { version: 'v1', steps: [{ id: 'basics', fields: [{ name: 'label', type: 'STRING', required: 'yes' }] }] }],
  ])('rejects %s', (_case, schema) => {
    expect(validProfileSchema(schema)).toBe(false);
  });
});

describe('P07 consent validation', () => {
  it.each([
    { version: ' ', content: { format: 'PLAIN_TEXT', text: 'text' } },
    { version: 'v1', content: { format: 'PLAIN_TEXT', text: '   ' } },
  ])('rejects trimmed-empty consent fields', (consent) => {
    expect(validConsent(consent)).toBe(false);
  });
});
