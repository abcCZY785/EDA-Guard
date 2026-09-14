import test from 'node:test';
import assert from 'node:assert/strict';
import { angleToMicrodegree, canonicalizeCapture, milToNm, schematicUnitToNm } from '../src/canonical.mjs';
import { hashObject, stableStringify } from '../src/hash.mjs';

test('stable stringify sorts object keys but preserves array order', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  assert.equal(hashObject({ a: 1, b: 2 }), hashObject({ b: 2, a: 1 }));
});

test('canonical units are deterministic integers', () => {
  assert.equal(milToNm(1), 25400);
  assert.equal(milToNm(40), 1_016_000);
  assert.equal(schematicUnitToNm(1), 254000);
  assert.equal(angleToMicrodegree(-90), 270_000_000);
  assert.equal(angleToMicrodegree(450), 90_000_000);
});

test('canonical snapshot sorts identities and closes a polyline outline', () => {
  const raw = {
    identity: { project_uuid: 'p', document_uuid: 'd', document_type: 'pcb', editor_version: '3.2' },
    facets: {
      pcb_components: { items: [
        { primitive_id: '2', unique_id: 'u2', designator: 'R2', x: 20, y: 0, rotation: 0 },
        { primitive_id: '1', unique_id: 'u1', designator: 'R1', x: 10, y: 0, rotation: 360 },
      ] },
      pcb_pads: { items: [{ primitive_id: 'pad1', component_primitive_id: '1', pad_number: '1', x: 10, y: 0, hole: 0.5 }] },
      pcb_lines: { items: [{ primitive_id: 'line1', layer: 11, start: { x: 0, y: 0 }, end: { x: 40, y: 0 } }] },
      pcb_polylines: { items: [{ primitive_id: 'outline', layer: 11, points: [[0, 0], [40, 0], [40, 30], [0, 0]] }] },
      pcb_arcs: { items: [] },
      pcb_vias: { items: [] },
      pcb_nets: { items: [{ name: 'GND' }] },
      pcb_rules: { items: {} },
      pcb_layers: { items: { layers: [] } },
    },
  };
  const snapshot = canonicalizeCapture(raw);
  assert.deepEqual(snapshot.components.map((c) => c.identity.designator), ['R1', 'R2']);
  assert.equal(snapshot.components[0].rotation_microdegree, 0);
  assert.equal(snapshot.geometry.board_outline.length, 2);
  assert.equal(snapshot.geometry.polylines[0].closed, true);
  assert.match(snapshot.snapshot_hash, /^[a-f0-9]{64}$/);
});

test('design hash excludes runtime and editor metadata', () => {
  const base = {
    identity: { project_uuid: 'p', project_name: 'fixture', document_uuid: 'd', document_type: 'pcb', editor_version: '3.2.149' },
    window_id: 'window-a',
    captured_at: '2026-09-13T10:00:00.000Z',
    bridge: { url: 'http://127.0.0.1:49620', window_id: 'window-a' },
    facets: {
      pcb_components: { items: [{ primitive_id: 'c1', unique_id: 'u1', designator: 'R1', x: 1, y: 2 }] },
      pcb_pads: { items: [] },
      pcb_lines: { items: [] },
      pcb_polylines: { items: [] },
      pcb_vias: { items: [] },
      pcb_nets: { items: [{ name: 'GND' }] },
    },
  };
  const changedRuntime = structuredClone(base);
  changedRuntime.identity.project_name = 'renamed-runtime-copy';
  changedRuntime.identity.editor_version = '3.2.150';
  changedRuntime.window_id = 'window-b';
  changedRuntime.captured_at = '2026-09-13T11:00:00.000Z';
  changedRuntime.bridge = { url: 'http://127.0.0.1:49621', window_id: 'window-b' };
  const first = canonicalizeCapture(base, { hashFacets: ['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom'] });
  const second = canonicalizeCapture(changedRuntime, { hashFacets: ['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom'] });
  assert.deepEqual(first.identity, { project_uuid: 'p', document_uuid: 'd', document_type: 'pcb' });
  assert.deepEqual(second.identity, first.identity);
  assert.equal(second.snapshot_hash, first.snapshot_hash);
});
