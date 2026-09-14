export const STATUSES = Object.freeze(['ok', 'verified_empty', 'unsupported', 'error']);
export const EVIDENCE_LEVELS = Object.freeze([
  'UNKNOWN',
  'READ',
  'REPEATED',
  'CROSS_VALIDATED',
  'RESTART_VALIDATED',
]);

export function isStatus(value) { return STATUSES.includes(value); }
export function isEvidenceLevel(value) { return EVIDENCE_LEVELS.includes(value); }

export function statusForValue(value) {
  if (Array.isArray(value)) return value.length ? 'ok' : 'verified_empty';
  if (value === null || value === undefined) return 'verified_empty';
  if (typeof value === 'object' && Object.keys(value).length === 0) return 'verified_empty';
  return 'ok';
}

export function unsupportedFacet(name, source, reason) {
  return {
    facet: name,
    source,
    status: 'unsupported',
    evidence: 'UNKNOWN',
    count: null,
    items: null,
    hash: null,
    error: reason || 'Capability is not available in this environment.',
  };
}

export function errorFacet(name, source, error) {
  return {
    facet: name,
    source,
    status: 'error',
    evidence: 'READ',
    count: null,
    items: null,
    hash: null,
    error: String(error?.message || error),
  };
}
