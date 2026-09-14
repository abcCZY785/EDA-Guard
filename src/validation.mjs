import { randomUUID } from 'node:crypto';
import { BridgeError } from './bridge-client.mjs';
import { buildCaptureScript, buildIdentityScript, documentTypeFromValue } from './easyeda-capture.mjs';
import { canonicalizeCapture, criticalFacetHash } from './canonical.mjs';
import { hashObject, stableStringify } from './hash.mjs';
import { buildManifest } from './manifest.mjs';
import { profileSummary, resolveSnapshotProfile } from './profiles.mjs';

function identityComparable(identity) {
  return {
    project_uuid: identity?.project_uuid ?? null,
    document_uuid: identity?.document_uuid ?? null,
    document_type: documentTypeFromValue(identity?.document_type ?? identity?.document_type_value),
  };
}

function facetIsReadable(facet) {
  // Fail closed on missing or future statuses.  Only the two successful
  // contract states satisfy a profile required facet.
  return Boolean(facet && (facet.status === 'ok' || facet.status === 'verified_empty'));
}

function facetStatusSummary(facets) {
  return Object.fromEntries(Object.entries(facets || {}).map(([name, facet]) => [name, {
    status: facet?.status ?? 'error',
    evidence: facet?.evidence ?? 'UNKNOWN',
    count: facet?.count ?? (Array.isArray(facet?.items) ? facet.items.length : null),
  }]));
}

function compareIdentity(before, after) {
  const a = identityComparable(before);
  const b = identityComparable(after);
  return { equal: stableStringify(a) === stableStringify(b), before: a, after: b };
}

function compareCore(rawA, rawB, profile = null) {
  const snapshotA = canonicalizeCapture(rawA, { hashFacets: profile?.hash_facets });
  const snapshotB = canonicalizeCapture(rawB, { hashFacets: profile?.hash_facets });
  const hashA = criticalFacetHash(snapshotA, { profile });
  const hashB = criticalFacetHash(snapshotB, { profile });
  return { equal: hashA === hashB, hash_before: hashA, hash_after: hashB };
}

function markRepeated(raw) {
  for (const facet of Object.values(raw?.facets || {})) {
    if (facet?.status === 'ok' || facet?.status === 'verified_empty') facet.evidence = 'REPEATED';
  }
}

function crossValidateMcp(raw, mcpData) {
  if (!mcpData || typeof mcpData !== 'object') return null;
  const mcp = mcpData.data && typeof mcpData.data === 'object' ? mcpData.data : mcpData;
  const pcbComponents = raw?.facets?.pcb_components?.items;
  const pcbNets = raw?.facets?.pcb_nets?.items;
  const mcpComponents = mcp.components || mcp.board?.components || [];
  const mcpNets = mcp.nets || mcp.board?.nets || [];
  const apiCount = Array.isArray(pcbComponents) ? pcbComponents.length : null;
  const mcpCount = Array.isArray(mcpComponents) ? mcpComponents.length : null;
  const apiNames = Array.isArray(pcbNets) ? pcbNets.map((n) => String(n?.name ?? n)).sort() : [];
  const mcpNames = Array.isArray(mcpNets) ? mcpNets.map((n) => String(n?.name ?? n?.net ?? n)).sort() : [];
  const countEqual = apiCount !== null && mcpCount !== null && apiCount === mcpCount;
  const netsEqual = apiNames.length > 0 && stableStringify(apiNames) === stableStringify(mcpNames);
  if (countEqual && raw?.facets?.pcb_components) raw.facets.pcb_components.evidence = 'CROSS_VALIDATED';
  if (netsEqual && raw?.facets?.pcb_nets) raw.facets.pcb_nets.evidence = 'CROSS_VALIDATED';
  return {
    source: 'easyeda-copilot-mcp-json',
    component_count: { official_api: apiCount, mcp: mcpCount, equal: countEqual },
    net_names: { official_api: apiNames, mcp: mcpNames, equal: netsEqual },
    cross_validated: countEqual || netsEqual,
    input_hash: hashObject(mcpData),
  };
}

export async function captureAtomic({
  bridge,
  windowId,
  repeat = 2,
  includeDrc = true,
  profile = 'auto',
  sourceVersions = {},
  mcpData = null,
  captureId = randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  if (!bridge || !windowId) throw new BridgeError('captureAtomic requires a BridgeClient and explicit windowId.');
  const reasons = [];
  let identityBefore;
  let raw;
  const rawRepeats = [];
  let identityAfter;
  try {
    identityBefore = await bridge.execute(buildIdentityScript(), windowId, { timeoutMs: 15_000 });
    raw = await bridge.execute(buildCaptureScript({ includeDrc }), windowId, { timeoutMs: 35_000 });
    if (!raw?.identity || !raw?.facets) reasons.push('Capture returned no identity or facets.');
    if (repeat > 1 && raw?.facets) {
      for (let index = 1; index < repeat; index += 1) {
        rawRepeats.push(await bridge.execute(buildCaptureScript({ includeDrc }), windowId, { timeoutMs: 35_000 }));
      }
    }
    identityAfter = await bridge.execute(buildIdentityScript(), windowId, { timeoutMs: 15_000 });
  } catch (error) {
    reasons.push(String(error?.message || error));
    identityAfter = identityAfter || null;
    raw = raw || { identity: identityBefore || null, facets: {} };
  }
  raw = raw || { identity: identityBefore || null, facets: {} };
  raw.facets = raw.facets || {};
  const identityCheck = compareIdentity(identityBefore, identityAfter || raw?.identity);
  if (!identityCheck.equal) reasons.push('Identity changed during capture; snapshot is invalid.');
  let repeatProfile = null;
  try {
    repeatProfile = resolveSnapshotProfile(profile, identityComparable(identityBefore || raw?.identity).document_type);
  } catch { /* the final profile resolution below records the user-facing error */ }
  let repeatCheck = { equal: true, hash_before: null, hash_after: null };
  if (rawRepeats.length) {
    const checks = rawRepeats.map((read) => compareCore(raw, read, repeatProfile));
    repeatCheck = {
      equal: checks.every((check) => check.equal),
      hash_before: checks[0].hash_before,
      hash_after: checks[checks.length - 1].hash_after,
      hashes: [checks[0].hash_before, ...checks.map((check) => check.hash_after)],
    };
    if (!repeatCheck.equal) reasons.push('Critical facets differ across consecutive reads.');
    else markRepeated(raw);
  } else if (repeat > 1 && !reasons.length) {
    reasons.push('Requested repeated read did not complete.');
  }
  const effectiveIdentity = { ...(raw?.identity || {}), ...identityComparable(identityBefore || raw?.identity) };
  raw.identity = effectiveIdentity;
  if (raw?.read_only !== true) reasons.push('Capture did not attest that the EasyEDA script was read-only.');
  const documentType = documentTypeFromValue(effectiveIdentity.document_type ?? effectiveIdentity.document_type_value);
  effectiveIdentity.document_type = documentType;
  if (!effectiveIdentity.project_uuid || !effectiveIdentity.document_uuid || documentType === 'unknown') reasons.push('Project/document identity is incomplete or document type is unknown.');
  let profileSpec = null;
  try {
    profileSpec = resolveSnapshotProfile(profile, documentType);
    if (!profileSpec && documentType !== 'unknown') reasons.push(`No snapshot profile is available for document type ${documentType}.`);
  } catch (error) {
    reasons.push(String(error?.message || error));
  }
  const required = profileSpec?.required || [];
  const optional = profileSpec?.optional || [];
  const facets = raw?.facets || {};
  const directNetWarning = documentType === 'schematic' && facets.schematic_nets?.status === 'verified_empty' && (facets.manufacture_nets?.count || 0) > 0;
  // This is an explicit warning, not an invalid capture: the contract selects
  // the manufacture netlist when the direct schematic net API is empty.
  const crossValidation = crossValidateMcp(raw, mcpData);
  const snapshot = canonicalizeCapture(raw, { hashFacets: profileSpec?.hash_facets });
  raw.facets.bom = {
    facet: 'bom',
    source: 'canonical:components',
    status: snapshot.bom.length ? 'ok' : 'verified_empty',
    evidence: raw.facets[documentType === 'pcb' ? 'pcb_components' : 'schematic_components']?.evidence || 'READ',
    count: snapshot.bom.length,
    items: snapshot.bom,
    error: null,
  };
  for (const name of required) {
    if (!facetIsReadable(raw.facets[name])) reasons.push(`Required facet ${name} is not readable (${raw.facets[name]?.status || 'missing'}).`);
  }
  const profileOutput = profileSummary(profileSpec);
  const validity = {
    valid_snapshot: reasons.length === 0,
    fail_closed: true,
    reasons,
    identity_stable: identityCheck.equal,
    repeated_core_equal: repeatCheck.equal,
    repeated_reads: 1 + rawRepeats.length,
    current_document_type: documentType,
    profile: profileOutput,
    profile_name: profileSpec?.name ?? null,
    required_facets: required,
    optional_facets: optional,
    facet_status: facetStatusSummary(facets),
    warnings: directNetWarning ? ['direct_schematic_net_api_empty_but_manufacture_netlist_nonempty'] : [],
  };
  const manifest = buildManifest({ captureId, capturedAt: now, bridgeUrl: bridge.baseUrl, windowId, raw, snapshot, validity, profile: profileOutput, sourceVersions, crossValidation });
  return {
    artifact_type: 'edaguard.capture',
    capture_id: captureId,
    captured_at: now,
    profile: profileOutput,
    design_identity: snapshot.identity,
    runtime: {
      bridge_url: bridge.baseUrl,
      window_id: windowId,
      captured_at: now,
      source_versions: sourceVersions,
    },
    manifest,
    snapshot,
    raw: {
      identity_before: identityBefore || null,
      identity_after: identityAfter || null,
      identity_capture: raw?.identity || null,
      capability_presence: raw?.capability_presence || {},
      facets: raw?.facets || {},
      read_only: raw?.read_only === true,
    },
    repeat: { requested: repeat, performed: 1 + rawRepeats.length, ...repeatCheck },
    validity,
  };
}

export function validateFixtureCapture(capture) {
  const validity = capture?.validity;
  return Boolean(validity?.valid_snapshot && validity?.identity_stable && validity?.fail_closed && capture?.manifest?.canonical_snapshot_hash);
}
