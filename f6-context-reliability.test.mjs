import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAtomic } from '../src/validation.mjs';

function pcbContext({ project = 'project-pcb', document = 'pcb-a', editor = '3.2.149' } = {}) {
  const identity = {
    project_uuid: project,
    project_name: 'F6 fixture',
    document_uuid: document,
    document_type: 'pcb',
    document_type_value: 3,
    editor_version: editor,
  };
  return {
    identity,
    raw: {
      identity,
      read_only: true,
      facets: {
        pcb_components: { status: 'ok', evidence: 'READ', items: [{ primitive_id: 'c1', unique_id: 'u1', designator: 'R1', x: 1, y: 2 }] },
        pcb_pads: { status: 'verified_empty', evidence: 'READ', items: [] },
        pcb_lines: { status: 'verified_empty', evidence: 'READ', items: [] },
        pcb_polylines: { status: 'verified_empty', evidence: 'READ', items: [] },
        pcb_vias: { status: 'verified_empty', evidence: 'READ', items: [] },
        pcb_nets: { status: 'ok', evidence: 'READ', items: [{ name: 'GND' }] },
      },
    },
  };
}

function schematicContext({ project = 'project-sch', document = 'schematic-a' } = {}) {
  const identity = {
    project_uuid: project,
    project_name: 'F6 fixture',
    document_uuid: document,
    document_type: 'schematic',
    document_type_value: 1,
    editor_version: '3.2.149',
  };
  return {
    identity,
    raw: {
      identity,
      read_only: true,
      facets: {
        schematic_components: { status: 'ok', evidence: 'READ', items: [{ primitive_id: 'sc1', unique_id: 'su1', designator: 'R1', x: 1, y: 2 }] },
        schematic_pins: { status: 'verified_empty', evidence: 'READ', items: [] },
        schematic_wires: { status: 'verified_empty', evidence: 'READ', items: [] },
        schematic_nets: { status: 'verified_empty', evidence: 'READ', items: [] },
        manufacture_nets: { status: 'ok', evidence: 'READ', items: [{ nets: [{ name: 'GND', pins: [] }] }] },
      },
    },
  };
}

class ContextBridge {
  constructor(contexts, { sequence = null, baseUrl = 'fake://bridge' } = {}) {
    this.contexts = contexts;
    this.sequence = sequence;
    this.baseUrl = baseUrl;
    this.calls = 0;
  }

  async execute(code, windowId) {
    const item = this.sequence ? this.sequence[Math.min(this.calls, this.sequence.length - 1)] : { context: this.contexts[windowId] };
    this.calls += 1;
    if (!item?.context) throw new Error(`unknown fixture window ${windowId}`);
    return structuredClone(code.includes('read_only') ? item.context.raw : item.context.identity);
  }
}

test('F6-A explicit windows keep A/B identities and hashes isolated', async () => {
  const a = pcbContext({ project: 'project-a', document: 'pcb-a' });
  const b = pcbContext({ project: 'project-b', document: 'pcb-b' });
  const captureA = await captureAtomic({ bridge: new ContextBridge({ 'window-a': a, 'window-b': b }), windowId: 'window-a', repeat: 1, includeDrc: false });
  const captureB = await captureAtomic({ bridge: new ContextBridge({ 'window-a': a, 'window-b': b }), windowId: 'window-b', repeat: 1, includeDrc: false });
  assert.equal(captureA.validity.valid_snapshot, true);
  assert.equal(captureB.validity.valid_snapshot, true);
  assert.equal(captureA.design_identity.project_uuid, 'project-a');
  assert.equal(captureB.design_identity.project_uuid, 'project-b');
  assert.notEqual(captureA.snapshot.snapshot_hash, captureB.snapshot.snapshot_hash);
});

test('F6-A wrong window/document binding fails closed', async () => {
  const a = pcbContext({ project: 'project-a', document: 'pcb-a' });
  const b = pcbContext({ project: 'project-b', document: 'pcb-b' });
  const bridge = new ContextBridge({}, { sequence: [
    { context: a }, // identity_before
    { context: b }, // raw capture came from the wrong document
    { context: b }, // identity_after
  ] });
  const result = await captureAtomic({ bridge, windowId: 'window-a', repeat: 1, includeDrc: false });
  assert.equal(result.validity.valid_snapshot, false);
  assert.equal(result.validity.identity_stable, false);
  assert.match(result.validity.reasons.join('\n'), /Identity changed/);
});

test('F6-B document switching reports the current document identity', async () => {
  const pcb = await captureAtomic({ bridge: new ContextBridge({ 'window-1': pcbContext({ project: 'project-switch', document: 'pcb-1' }) }), windowId: 'window-1', repeat: 1, includeDrc: false });
  const schematic = await captureAtomic({ bridge: new ContextBridge({ 'window-1': schematicContext({ project: 'project-switch', document: 'sch-1' }) }), windowId: 'window-1', repeat: 1, includeDrc: false });
  assert.equal(pcb.validity.valid_snapshot, true);
  assert.equal(schematic.validity.valid_snapshot, true);
  assert.deepEqual(pcb.design_identity, { project_uuid: 'project-switch', document_uuid: 'pcb-1', document_type: 'pcb' });
  assert.deepEqual(schematic.design_identity, { project_uuid: 'project-switch', document_uuid: 'sch-1', document_type: 'schematic' });
  assert.equal(schematic.profile.name, 'schematic-basic-v1');
});

test('F6-C Bridge/EasyEDA restart runtime changes do not change design hash', async () => {
  const before = pcbContext({ project: 'project-restart', document: 'pcb-1', editor: '3.2.149' });
  const after = pcbContext({ project: 'project-restart', document: 'pcb-1', editor: '3.2.150' });
  const captureA = await captureAtomic({ bridge: new ContextBridge({ 'window-before': before }, { baseUrl: 'fake://bridge-before' }), windowId: 'window-before', repeat: 1, includeDrc: false, now: '2026-09-13T10:00:00.000Z', sourceVersions: { bridge: 'before', easyeda_editor: '3.2.149' } });
  const captureB = await captureAtomic({ bridge: new ContextBridge({ 'window-after': after }, { baseUrl: 'fake://bridge-after' }), windowId: 'window-after', repeat: 1, includeDrc: false, now: '2026-09-13T11:00:00.000Z', sourceVersions: { bridge: 'after', easyeda_editor: '3.2.150' } });
  assert.equal(captureA.validity.valid_snapshot, true);
  assert.equal(captureB.validity.valid_snapshot, true);
  assert.equal(captureA.snapshot.snapshot_hash, captureB.snapshot.snapshot_hash);
  assert.deepEqual(captureA.design_identity, captureB.design_identity);
  assert.notEqual(captureA.runtime.window_id, captureB.runtime.window_id);
  assert.notEqual(captureA.runtime.source_versions.easyeda_editor, captureB.runtime.source_versions.easyeda_editor);
});
