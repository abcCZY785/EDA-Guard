import test from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshotProfile, profileForDocumentType, resolveSnapshotProfile } from '../src/profiles.mjs';

test('basic profiles cover the semantic-diff substrate without advanced blockers', () => {
  const pcb = getSnapshotProfile('pcb-basic-v1');
  assert.deepEqual(pcb.required, [
    'pcb_components', 'pcb_pads', 'pcb_lines', 'pcb_polylines', 'pcb_vias', 'pcb_nets', 'bom',
  ]);
  assert.equal(pcb.optional.includes('pcb_pours'), true);
  assert.equal(pcb.optional.includes('pcb_arcs'), true);
  assert.equal(pcb.required.includes('pcb_rules'), false);
  assert.equal(pcb.advanced_non_blocking, true);
});

test('full profile can tighten advanced capture independently', () => {
  const full = getSnapshotProfile('pcb-full-v1');
  for (const facet of ['pcb_arcs', 'pcb_pours', 'pcb_regions', 'pcb_fills', 'pcb_rules', 'pcb_layers', 'pcb_drc']) {
    assert.equal(full.required.includes(facet), true, facet);
  }
  assert.equal(full.advanced_non_blocking, false);
});

test('auto profile follows the current document domain', () => {
  assert.equal(resolveSnapshotProfile('auto', 'pcb').name, 'pcb-basic-v1');
  assert.equal(resolveSnapshotProfile('auto', 'schematic').name, 'schematic-basic-v1');
  assert.equal(profileForDocumentType('unknown'), null);
  assert.throws(() => resolveSnapshotProfile('schematic-basic-v1', 'pcb'), /does not match/);
});
