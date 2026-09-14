/**
 * Snapshot profiles make the capture contract explicit.  A basic profile is
 * deliberately small enough to gate the first semantic diff; a full profile
 * can tighten the same capture once the advanced EasyEDA getters have been
 * proven on non-empty fixtures.
 */
export const PROFILE_SCHEMA_VERSION = '0.1.0';

const PCB_BASIC_REQUIRED = [
  'pcb_components',
  'pcb_pads',
  'pcb_lines',
  'pcb_polylines',
  'pcb_vias',
  'pcb_nets',
  'bom',
];

const PCB_BASIC_OPTIONAL = [
  'pcb_component_pads',
  'pcb_arcs',
  'pcb_pours',
  'pcb_regions',
  'pcb_fills',
  'pcb_attributes',
  'pcb_rules',
  'pcb_layers',
  'pcb_drc',
];

const SCHEMATIC_BASIC_REQUIRED = [
  'schematic_components',
  'schematic_pins',
  'schematic_wires',
  'manufacture_nets',
  'bom',
];

const SCHEMATIC_BASIC_OPTIONAL = [
  'schematic_nets',
  'schematic_drc',
];

const PCB_FULL_REQUIRED = [
  ...PCB_BASIC_REQUIRED,
  'pcb_arcs',
  'pcb_pours',
  'pcb_regions',
  'pcb_fills',
  'pcb_rules',
  'pcb_layers',
  'pcb_drc',
];

const SCHEMATIC_FULL_REQUIRED = [
  ...SCHEMATIC_BASIC_REQUIRED,
  'schematic_nets',
  'schematic_drc',
];

// Hash facets are the stable design content used for the profile snapshot
// hash.  Optional advanced facets remain visible in the canonical snapshot,
// but do not make a basic hash unstable when an editor version exposes them
// inconsistently.  The semantic diff can still inspect those fields directly.
const BASIC_HASH_FACETS = ['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom'];
const FULL_HASH_FACETS = [...BASIC_HASH_FACETS, 'rules', 'layers'];

export const SNAPSHOT_PROFILES = Object.freeze({
  'pcb-basic-v1': Object.freeze({
    name: 'pcb-basic-v1',
    domain: 'pcb',
    schema_version: PROFILE_SCHEMA_VERSION,
    required: Object.freeze([...PCB_BASIC_REQUIRED]),
    optional: Object.freeze([...PCB_BASIC_OPTIONAL]),
    hash_facets: Object.freeze([...BASIC_HASH_FACETS]),
    advanced_non_blocking: true,
  }),
  'schematic-basic-v1': Object.freeze({
    name: 'schematic-basic-v1',
    domain: 'schematic',
    schema_version: PROFILE_SCHEMA_VERSION,
    required: Object.freeze([...SCHEMATIC_BASIC_REQUIRED]),
    optional: Object.freeze([...SCHEMATIC_BASIC_OPTIONAL]),
    hash_facets: Object.freeze([...BASIC_HASH_FACETS.filter((name) => name !== 'vias')]),
    advanced_non_blocking: true,
  }),
  'pcb-full-v1': Object.freeze({
    name: 'pcb-full-v1',
    domain: 'pcb',
    schema_version: PROFILE_SCHEMA_VERSION,
    required: Object.freeze([...PCB_FULL_REQUIRED]),
    optional: Object.freeze(['pcb_attributes']),
    hash_facets: Object.freeze([...FULL_HASH_FACETS]),
    advanced_non_blocking: false,
  }),
  'schematic-full-v1': Object.freeze({
    name: 'schematic-full-v1',
    domain: 'schematic',
    schema_version: PROFILE_SCHEMA_VERSION,
    required: Object.freeze([...SCHEMATIC_FULL_REQUIRED]),
    optional: Object.freeze([]),
    hash_facets: Object.freeze([...FULL_HASH_FACETS.filter((name) => name !== 'vias' && name !== 'rules' && name !== 'layers')]),
    advanced_non_blocking: false,
  }),
});

export function getSnapshotProfile(name) {
  const profile = SNAPSHOT_PROFILES[name];
  if (!profile) throw new Error(`Unknown snapshot profile: ${name}`);
  return profile;
}

export function profileForDocumentType(documentType) {
  if (documentType === 'pcb') return SNAPSHOT_PROFILES['pcb-basic-v1'];
  if (documentType === 'schematic') return SNAPSHOT_PROFILES['schematic-basic-v1'];
  return null;
}

/** Resolve an explicit profile or the domain-specific basic profile. */
export function resolveSnapshotProfile(requested = 'auto', documentType = 'unknown') {
  if (!requested || requested === 'auto') {
    const profile = profileForDocumentType(documentType);
    if (!profile) return null;
    return profile;
  }
  const profile = getSnapshotProfile(requested);
  if (documentType !== 'unknown' && profile.domain !== documentType) {
    throw new Error(`Snapshot profile ${requested} does not match document type ${documentType}.`);
  }
  return profile;
}

export function profileSummary(profile) {
  if (!profile) return null;
  return {
    name: profile.name,
    domain: profile.domain,
    schema_version: profile.schema_version,
    required_facets: [...profile.required],
    optional_facets: [...profile.optional],
    hash_facets: [...profile.hash_facets],
    advanced_non_blocking: profile.advanced_non_blocking,
  };
}
