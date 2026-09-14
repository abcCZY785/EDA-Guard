import { hashObject } from './hash.mjs';

export const MANIFEST_SCHEMA_VERSION = '0.1.0';

function facetCount(facet) {
  if (!facet) return null;
  if (Number.isInteger(facet.count)) return facet.count;
  if (Array.isArray(facet.items)) return facet.items.length;
  if (facet.items === null || facet.items === undefined) return facet.status === 'verified_empty' ? 0 : null;
  return 1;
}

export function facetRecord(name, facet, { capturedAt, sourceVersions = {}, canonicalHash = null } = {}) {
  const itemHash = facet?.items === null || facet?.items === undefined ? null : hashObject(facet.items);
  return {
    facet: name,
    source: facet?.source ?? 'unknown',
    status: facet?.status ?? 'error',
    evidence: facet?.evidence ?? 'UNKNOWN',
    count: facetCount(facet),
    hash: canonicalHash || itemHash,
    raw_hash: itemHash,
    captured_at: capturedAt,
    versions: sourceVersions,
    error: facet?.error ?? null,
  };
}

export function buildManifest({
  captureId,
  capturedAt,
  bridgeUrl,
  windowId,
  raw,
  snapshot,
  validity,
  profile = null,
  sourceVersions = {},
  crossValidation = null,
}) {
  const facets = {};
  const identityComplete = Boolean(raw?.identity?.project_uuid && raw?.identity?.document_uuid && raw?.identity?.document_type && raw.identity.document_type !== 'unknown');
  facets.identity = {
    facet: 'identity',
    source: 'official-api:dmt_Project/dmt_SelectControl/sys_Environment',
    status: identityComplete && validity?.identity_stable ? 'ok' : 'error',
    evidence: validity?.identity_stable && (validity?.repeated_reads ?? 1) > 1 ? 'REPEATED' : 'READ',
    count: identityComplete ? 1 : null,
    hash: identityComplete ? hashObject({ project_uuid: raw.identity.project_uuid, document_uuid: raw.identity.document_uuid, document_type: raw.identity.document_type }) : null,
    captured_at: capturedAt,
    versions: sourceVersions,
    error: identityComplete && validity?.identity_stable ? null : 'Project/document identity is incomplete or changed during capture.',
  };
  const canonicalAlias = {
    pcb_components: 'components', schematic_components: 'components',
    pcb_pads: 'pads', pcb_component_pads: 'pads', schematic_pins: 'pads',
    pcb_lines: 'geometry', pcb_arcs: 'geometry', pcb_polylines: 'geometry', schematic_wires: 'geometry',
    pcb_pours: 'geometry', pcb_regions: 'geometry', pcb_fills: 'geometry',
    pcb_vias: 'vias', pcb_nets: 'connectivity', schematic_nets: 'connectivity', manufacture_nets: 'connectivity',
    pcb_rules: 'rules', pcb_layers: 'layers', bom: 'bom',
  };
  for (const [name, facet] of Object.entries(raw?.facets || {})) {
    facets[name] = facetRecord(name, facet, {
      capturedAt,
      sourceVersions,
      canonicalHash: snapshot?.facet_hashes?.[canonicalAlias[name]] || null,
    });
  }
  return {
    manifest_schema_version: MANIFEST_SCHEMA_VERSION,
    artifact_type: 'edaguard.capture-manifest',
    capture_id: captureId,
    captured_at: capturedAt,
    bridge: { url: bridgeUrl, window_id: windowId },
    // Explicitly separate stable design identity from the runtime that read
    // it.  Runtime fields are audit metadata and never feed snapshot_hash.
    design_identity: {
      project_uuid: snapshot?.identity?.project_uuid ?? raw?.identity?.project_uuid ?? null,
      document_uuid: snapshot?.identity?.document_uuid ?? raw?.identity?.document_uuid ?? null,
      document_type: snapshot?.identity?.document_type ?? raw?.identity?.document_type ?? 'unknown',
    },
    runtime: {
      bridge_url: bridgeUrl,
      window_id: windowId,
      captured_at: capturedAt,
      source_versions: sourceVersions,
    },
    profile,
    identity: {
      project_uuid: raw?.identity?.project_uuid ?? null,
      project_name: raw?.identity?.project_name ?? null,
      document_uuid: raw?.identity?.document_uuid ?? null,
      document_type: raw?.identity?.document_type ?? 'unknown',
      editor_version: raw?.identity?.editor_version ?? null,
    },
    source_versions: sourceVersions,
    validity,
    cross_validation: crossValidation,
    facets,
    canonical_snapshot_hash: snapshot?.snapshot_hash ?? null,
  };
}
