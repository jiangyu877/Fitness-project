import { describe, expect, it } from 'vitest';
import {
  orchestrateP11DualFixtureEvidence,
  type P11DualFixtureEvidenceManifest,
} from './p11-dual-fixture-evidence-orchestrator.js';

const layers = ['API_FAKE', 'PG18_REPOSITORY', 'CROSS_LAYER_E2E', 'UI_STATE', 'BROWSER'] as const;
const fixtures = ['persona_fat_loss', 'persona_muscle_gain'] as const;

function completeManifest(): P11DualFixtureEvidenceManifest {
  return {
    entries: layers.flatMap((layer) => fixtures.map((fixtureId) => ({
      layer,
      fixtureId,
      source: `evidence/${layer.toLowerCase()}/${fixtureId}`,
      executionStatus: 'EXECUTED' as const,
      scope: 'named fixture scenario only',
      limitations: 'test-only evidence; no production authorization',
    }))),
  };
}

describe('P11-DUAL-FIXTURE-EVIDENCE-ORCHESTRATOR', () => {
  it('orchestrates a complete isolated dual-fixture manifest into a capped layered report', () => {
    const report = orchestrateP11DualFixtureEvidence(completeManifest());
    expect(report.status).toBe('COMPLETE');
    expect(report.overallStatus).toBe('G2_PREPARATION');
    expect(report.g2Authorized).toBe(false);
    expect(report.g3Authorized).toBe(false);
    expect(report.readyForRealUsers).toBe(false);
    expect(report.layers).toHaveLength(5);
    expect(report.layers.every((layer) => layer.evidenceByFixture.length === 2)).toBe(true);
    expect(report.layers.flatMap((layer) => layer.evidenceByFixture.map((item) => item.fixtureId)).sort())
      .toEqual(fixtures.flatMap((fixtureId) => layers.map(() => fixtureId)).sort());
  });

  it('returns INCOMPLETE when PG18 and browser evidence are missing', () => {
    const manifest = completeManifest();
    const report = orchestrateP11DualFixtureEvidence({
      entries: manifest.entries.filter((entry) => entry.layer !== 'PG18_REPOSITORY' && entry.layer !== 'BROWSER'),
    });
    expect(report.status).toBe('INCOMPLETE');
    expect(report.overallStatus).toBe('INCOMPLETE');
    expect(report.issues).toContain('MISSING_FIXTURE_EVIDENCE');
  });

  it('fails closed for unknown layer, cross-subject input, and unexecuted evidence', () => {
    const manifest = completeManifest();
    const entries = [
      ...manifest.entries,
      { ...manifest.entries[0], layer: 'UNKNOWN_LAYER' },
      { ...manifest.entries[1], subjects: ['persona_fat_loss', 'persona_muscle_gain'] },
      { ...manifest.entries[2], executionStatus: 'NOT_EXECUTED' as const },
      { ...manifest.entries[3], subject: 'persona_unknown' },
    ] as unknown as P11DualFixtureEvidenceManifest['entries'];
    const report = orchestrateP11DualFixtureEvidence({ entries });
    expect(report.status).toBe('INCOMPLETE');
    expect(report.issues).toEqual(expect.arrayContaining([
      'UNKNOWN_LAYER', 'CROSS_SUBJECT_INPUT', 'UNKNOWN_SUBJECT', 'NOT_EXECUTED', 'CONFLICTING_EVIDENCE',
    ]));
  });

  it('does not project secret or private input fields into the report', () => {
    const manifest = completeManifest();
    const entries = manifest.entries.map((entry, index) => index === 0
      ? { ...entry, token: 'bearer-secret-value', rawIdempotencyKey: 'raw-key-value', entry: 'private-entry-value', privateField: 'private-field-value' }
      : entry);
    const serialized = JSON.stringify(orchestrateP11DualFixtureEvidence({ entries }));
    expect(serialized).not.toContain('bearer-secret-value');
    expect(serialized).not.toContain('raw-key-value');
    expect(serialized).not.toContain('private-entry-value');
    expect(serialized).not.toContain('private-field-value');
    expect(serialized).not.toContain('rawIdempotencyKey');
  });

  it('rejects object coercion and malformed subject collections at primitive boundaries', () => {
    const manifest = completeManifest();
    const spoof = (value: string) => ({ toString: () => value });
    const cases = [
      { layer: spoof('API_FAKE'), expected: 'UNKNOWN_LAYER' },
      { fixtureId: spoof('persona_fat_loss'), expected: 'UNKNOWN_FIXTURE' },
      { executionStatus: spoof('EXECUTED'), expected: 'UNKNOWN_EXECUTION_STATUS' },
      { subject: spoof('persona_fat_loss'), expected: 'UNKNOWN_SUBJECT' },
      { subjects: spoof('persona_fat_loss'), expected: 'INVALID_SUBJECTS' },
    ] as const;

    for (const override of cases) {
      const entries = manifest.entries.map((entry, index) => index === 0 ? { ...entry, ...override } : entry);
      const report = orchestrateP11DualFixtureEvidence({ entries } as unknown as P11DualFixtureEvidenceManifest);
      expect(report.status).toBe('INCOMPLETE');
      expect(report.issues).toContain(override.expected);
    }
  });

  it('rejects sensitive metadata and keeps its values out of the report', () => {
    const manifest = completeManifest();
    const entries = manifest.entries.map((entry, index) => index === 0
      ? {
        ...entry,
        source: 'Bearer top-secret-token',
        scope: 'rawIdempotencyKey=raw-key-value',
        limitations: 'private secret entry value',
      }
      : entry);
    const report = orchestrateP11DualFixtureEvidence({ entries });
    const serialized = JSON.stringify(report);
    expect(report.status).toBe('INCOMPLETE');
    expect(report.issues).toContain('UNSAFE_METADATA');
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('raw-key-value');
    expect(serialized).not.toContain('private secret entry value');
  });
});
