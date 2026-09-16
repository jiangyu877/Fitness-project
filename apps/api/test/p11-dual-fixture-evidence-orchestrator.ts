export const P11_EVIDENCE_LAYERS = [
  'API_FAKE',
  'PG18_REPOSITORY',
  'CROSS_LAYER_E2E',
  'UI_STATE',
  'BROWSER',
] as const;

export const P11_DUAL_FIXTURES = ['persona_fat_loss', 'persona_muscle_gain'] as const;

export type P11EvidenceLayer = (typeof P11_EVIDENCE_LAYERS)[number];
export type P11FixtureId = (typeof P11_DUAL_FIXTURES)[number];
export type P11ExecutionStatus = 'EXECUTED' | 'HISTORICAL' | 'NOT_EXECUTED';

export type P11DualFixtureEvidenceEntry = Readonly<{
  layer: P11EvidenceLayer;
  fixtureId: P11FixtureId;
  source: string;
  executionStatus: P11ExecutionStatus;
  scope: string;
  limitations: string;
  subject?: string;
  subjects?: readonly string[];
  [key: string]: unknown;
}>;

export type P11DualFixtureEvidenceManifest = Readonly<{
  entries: readonly P11DualFixtureEvidenceEntry[];
}>;

export type P11LayerEvidence = Readonly<{
  fixtureId: P11FixtureId;
  source: string;
  executionStatus: P11ExecutionStatus;
  scope: string;
  limitations: string;
}>;

export type P11LayerReport = Readonly<{
  layer: P11EvidenceLayer;
  evidenceByFixture: readonly P11LayerEvidence[];
}>;

export type P11DualFixtureEvidenceReport = Readonly<{
  status: 'COMPLETE' | 'INCOMPLETE';
  overallStatus: 'G2_PREPARATION' | 'INCOMPLETE';
  g2Authorized: false;
  g3Authorized: false;
  readyForRealUsers: false;
  layers: readonly P11LayerReport[];
  issues: readonly string[];
}>;

const knownLayers = new Set<string>(P11_EVIDENCE_LAYERS);
const knownFixtures = new Set<string>(P11_DUAL_FIXTURES);
const knownStatuses = new Set<string>(['EXECUTED', 'HISTORICAL', 'NOT_EXECUTED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isKnown(set: ReadonlySet<string>, value: unknown): value is string {
  return typeof value === 'string' && set.has(value);
}

function isSafeMetadata(value: unknown): value is string {
  return nonEmptyString(value)
    && !/(?:bearer|token|raw[_-]?idempotency[_-]?key|idempotency[_-]?key|private|secret|entry)/i.test(value);
}

export function orchestrateP11DualFixtureEvidence(
  manifest: P11DualFixtureEvidenceManifest,
): P11DualFixtureEvidenceReport {
  const issues = new Set<string>();
  const grouped = new Map<P11EvidenceLayer, Map<P11FixtureId, P11LayerEvidence>>();
  for (const layer of P11_EVIDENCE_LAYERS) grouped.set(layer, new Map());

  const entries = isRecord(manifest) && Array.isArray(manifest.entries) ? manifest.entries : [];
  if (entries.length === 0) issues.add('MISSING_ENTRIES');

  for (const candidate of entries) {
    if (!isRecord(candidate)) {
      issues.add('INVALID_ENTRY');
      continue;
    }
    const layer = candidate.layer;
    const fixtureId = candidate.fixtureId;
    const executionStatus = candidate.executionStatus;
    if (!isKnown(knownLayers, layer)) {
      issues.add('UNKNOWN_LAYER');
      continue;
    }
    if (!isKnown(knownFixtures, fixtureId)) {
      issues.add('UNKNOWN_FIXTURE');
      continue;
    }
    if (candidate.subject !== undefined) {
      if (!isKnown(knownFixtures, candidate.subject)) issues.add('UNKNOWN_SUBJECT');
      if (candidate.subject !== fixtureId) issues.add('CROSS_SUBJECT_INPUT');
    }
    if (candidate.subjects !== undefined) {
      if (!Array.isArray(candidate.subjects) || candidate.subjects.some((subject) => typeof subject !== 'string')) {
        issues.add('INVALID_SUBJECTS');
      } else if (candidate.subjects.length !== 1 || candidate.subjects[0] !== fixtureId) {
        issues.add('CROSS_SUBJECT_INPUT');
      }
    }
    if (!isKnown(knownStatuses, executionStatus)) {
      issues.add('UNKNOWN_EXECUTION_STATUS');
      continue;
    }
    const normalizedStatus = executionStatus as P11ExecutionStatus;
    if (normalizedStatus === 'NOT_EXECUTED') issues.add('NOT_EXECUTED');
    if (!nonEmptyString(candidate.source) || !nonEmptyString(candidate.scope) || !nonEmptyString(candidate.limitations)) {
      issues.add('INCOMPLETE_METADATA');
      continue;
    }
    if (!isSafeMetadata(candidate.source) || !isSafeMetadata(candidate.scope) || !isSafeMetadata(candidate.limitations)) {
      issues.add('UNSAFE_METADATA');
      continue;
    }

    const layerMap = grouped.get(layer as P11EvidenceLayer);
    if (!layerMap) {
      issues.add('UNKNOWN_LAYER');
      continue;
    }
    const key = fixtureId as P11FixtureId;
    if (layerMap.has(key)) {
      issues.add('CONFLICTING_EVIDENCE');
      continue;
    }
    layerMap.set(key, {
      fixtureId: key,
      source: candidate.source,
      executionStatus: normalizedStatus,
      scope: candidate.scope,
      limitations: candidate.limitations,
    });
  }

  const layers = P11_EVIDENCE_LAYERS.map((layer) => {
    const evidenceByFixture = P11_DUAL_FIXTURES
      .map((fixtureId) => grouped.get(layer)!.get(fixtureId))
      .filter((evidence): evidence is P11LayerEvidence => evidence !== undefined);
    if (evidenceByFixture.length !== P11_DUAL_FIXTURES.length) issues.add('MISSING_FIXTURE_EVIDENCE');
    return { layer, evidenceByFixture };
  });

  const complete = issues.size === 0;
  return {
    status: complete ? 'COMPLETE' : 'INCOMPLETE',
    overallStatus: complete ? 'G2_PREPARATION' : 'INCOMPLETE',
    g2Authorized: false,
    g3Authorized: false,
    readyForRealUsers: false,
    layers,
    issues: [...issues].sort(),
  };
}
