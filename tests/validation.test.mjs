import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAtomic } from '../src/validation.mjs';

const identity = {
  project_uuid: 'project-1',
  project_name: 'fixture',
  document_uuid: 'pcb-1',
  document_name: 'Board',
  document_type: 'pcb',
  document_type_value: 3,
  editor_version: '3.2.149.88089769',
};

function rawCapture() {
  return {
    identity,
    capability_presence: {},
    read_only: true,
    facets: {
      pcb_components: { facet: 'pcb_components', source: 'official', status: 'ok', evidence: 'READ', count: 1, items: [{ primitive_id: 'c1', unique_id: 'u1', designator: 'R1', x: 1, y: 2 }] },
      pcb_pads: { facet: 'pcb_pads', source: 'official', status: 'ok', evidence: 'READ', count: 1, items: [{ primitive_id: 'p1', component_primitive_id: 'c1', pad_number: '1', x: 1, y: 2 }] },
      pcb_lines: { facet: 'pcb_lines', source: 'official', status: 'verified_empty', evidence: 'READ', count: 0, items: [] },
      pcb_polylines: { facet: 'pcb_polylines', source: 'official', status: 'verified_empty', evidence: 'READ', count: 0, items: [] },
      pcb_vias: { facet: 'pcb_vias', source: 'official', status: 'verified_empty', evidence: 'READ', count: 0, items: [] },
      pcb_nets: { facet: 'pcb_nets', source: 'official', status: 'ok', evidence: 'READ', count: 1, items: [{ name: 'GND' }] },
    },
  };
}

class FakeBridge {
  constructor({ mismatch = false } = {}) { this.baseUrl = 'fake://bridge'; this.mismatch = mismatch; this.identityCalls = 0; }
  async execute(code) {
    if (code.includes('read_only')) return structuredClone(rawCapture());
    this.identityCalls += 1;
    return this.mismatch && this.identityCalls > 1 ? { ...identity, document_uuid: 'other-document' } : identity;
  }
}

test('atomic capture accepts equal repeated core facets', async () => {
  const result = await captureAtomic({ bridge: new FakeBridge(), windowId: 'window-1', includeDrc: false, repeat: 3 });
  assert.equal(result.validity.valid_snapshot, true);
  assert.equal(result.validity.identity_stable, true);
  assert.equal(result.repeat.equal, true);
  assert.equal(result.repeat.performed, 3);
  assert.equal(result.profile.name, 'pcb-basic-v1');
  assert.deepEqual(result.design_identity, { project_uuid: 'project-1', document_uuid: 'pcb-1', document_type: 'pcb' });
  assert.equal(result.runtime.window_id, 'window-1');
  assert.equal(result.manifest.facets.pcb_components.evidence, 'REPEATED');
  assert.equal(result.manifest.profile.name, 'pcb-basic-v1');
});

test('identity change is fail-closed', async () => {
  const result = await captureAtomic({ bridge: new FakeBridge({ mismatch: true }), windowId: 'window-1', includeDrc: false, repeat: 1 });
  assert.equal(result.validity.valid_snapshot, false);
  assert.equal(result.validity.identity_stable, false);
  assert.match(result.validity.reasons.join('\n'), /Identity changed/);
});

test('optional MCP evidence only upgrades matching comparable fields', async () => {
  const result = await captureAtomic({
    bridge: new FakeBridge(),
    windowId: 'window-1',
    includeDrc: false,
    repeat: 1,
    mcpData: { components: [{}], nets: ['GND'] },
  });
  assert.equal(result.manifest.cross_validation.cross_validated, true);
  assert.equal(result.manifest.facets.pcb_components.evidence, 'CROSS_VALIDATED');
  assert.equal(result.manifest.facets.pcb_nets.evidence, 'CROSS_VALIDATED');
});

test('missing read-only attestation is invalid', async () => {
  const bridge = new FakeBridge();
  const original = bridge.execute.bind(bridge);
  bridge.execute = async (code, windowId, options) => {
    const value = await original(code, windowId, options);
    if (code.includes('read_only')) value.read_only = false;
    return value;
  };
  const result = await captureAtomic({ bridge, windowId: 'window-1', includeDrc: false, repeat: 1 });
  assert.equal(result.validity.valid_snapshot, false);
  assert.match(result.validity.reasons.join('\n'), /read-only/);
});

test('unsupported advanced facets do not invalidate the basic profile', async () => {
  const bridge = new FakeBridge();
  const original = bridge.execute.bind(bridge);
  bridge.execute = async (code, windowId, options) => {
    const value = await original(code, windowId, options);
    if (code.includes('read_only')) {
      value.facets.pcb_arcs = { facet: 'pcb_arcs', source: 'official', status: 'unsupported', evidence: 'UNKNOWN', count: null, items: null, error: 'fixture' };
      value.facets.pcb_pours = { facet: 'pcb_pours', source: 'official', status: 'unsupported', evidence: 'UNKNOWN', count: null, items: null, error: 'fixture' };
    }
    return value;
  };
  const result = await captureAtomic({ bridge, windowId: 'window-1', includeDrc: false, repeat: 1 });
  assert.equal(result.validity.valid_snapshot, true);
  assert.equal(result.validity.profile.advanced_non_blocking, true);
  assert.equal(result.manifest.facets.pcb_arcs.status, 'unsupported');
});

test('missing required facet status is fail-closed', async () => {
  const bridge = new FakeBridge();
  const original = bridge.execute.bind(bridge);
  bridge.execute = async (code, windowId, options) => {
    const value = await original(code, windowId, options);
    if (code.includes('read_only')) delete value.facets.pcb_vias.status;
    return value;
  };
  const result = await captureAtomic({ bridge, windowId: 'window-1', includeDrc: false, repeat: 1 });
  assert.equal(result.validity.valid_snapshot, false);
  assert.match(result.validity.reasons.join('\n'), /Required facet pcb_vias is not readable/);
});

test('changing optional advanced geometry does not fail a basic repeat', async () => {
  const bridge = new FakeBridge();
  let readCount = 0;
  const original = bridge.execute.bind(bridge);
  bridge.execute = async (code, windowId, options) => {
    const value = await original(code, windowId, options);
    if (code.includes('read_only')) {
      readCount += 1;
      value.facets.pcb_arcs = {
        facet: 'pcb_arcs', source: 'official', status: 'ok', evidence: 'READ', count: 1,
        items: [{ primitive_id: `arc-${readCount}`, layer: 11, start: { x: readCount, y: 0 }, end: { x: 0, y: readCount } }],
      };
    }
    return value;
  };
  const result = await captureAtomic({ bridge, windowId: 'window-1', includeDrc: false, repeat: 2 });
  assert.equal(result.validity.valid_snapshot, true);
  assert.equal(result.validity.repeated_core_equal, true);
});
