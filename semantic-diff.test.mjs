import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashObject, stableStringify } from '../src/hash.mjs';
import { renderSemanticDiff, semanticDiff, SEMANTIC_DIFF_SCHEMA } from '../src/diff.mjs';

const FACETS = ['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom', 'rules', 'layers'];

function baseSnapshot() {
  return {
    identity: { project_uuid: 'project-fixture', document_uuid: 'pcb-fixture', document_type: 'pcb' },
    components: [
      {
        identity: { key: 'c12', unique_id: 'u-c12', primitive_id: 'p-c12', designator: 'C12', confidence: 'high' },
        name: '={Value}', value: '0.1uF', x_nm: 21_300_000, y_nm: 14_700_000, rotation_microdegree: 0,
        mirror: null, layer: 1, footprint_uuid: 'fp-c0603', footprint_name: 'C0603',
        manufacturer_id: 'M-C12', supplier: 'LCSC', supplier_id: 'C1525',
        other_property: { Description: 'Decoupling', Device: 'C', MPN: 'MPN-C12', Package: '0603', Library: 'lib-cap' },
        is_business_component: true,
      },
      {
        identity: { key: 'u1', unique_id: 'u-u1', primitive_id: 'p-u1', designator: 'U1', confidence: 'high' },
        name: '={Value}', value: 'MCU', x_nm: 30_000_000, y_nm: 20_000_000, rotation_microdegree: 90_000_000,
        mirror: null, layer: 1, footprint_uuid: 'fp-lqfp48', footprint_name: 'LQFP48',
        manufacturer_id: 'M-MCU', supplier: 'LCSC', supplier_id: 'C9999',
        other_property: { Description: 'Controller', Device: 'MCU', MPN: 'MPN-MCU', Package: 'LQFP48', Library: 'lib-mcu' },
        is_business_component: true,
      },
      {
        identity: { key: 'j1', unique_id: 'u-j1', primitive_id: 'p-j1', designator: 'J1', confidence: 'high' },
        name: '={Value}', value: 'USB-C', x_nm: 40_000_000, y_nm: 20_000_000, rotation_microdegree: 0,
        mirror: null, layer: 1, footprint_uuid: 'fp-usbc', footprint_name: 'USB-C-16P',
        manufacturer_id: 'M-USBC', supplier: 'LCSC', supplier_id: 'C165948',
        other_property: { Description: 'USB connector', Device: 'Conn', MPN: 'MPN-USBC', Package: 'USB-C', Library: 'lib-conn' },
        is_business_component: true,
      },
      {
        identity: { key: 'c17', unique_id: 'u-c17', primitive_id: 'p-c17', designator: 'C17', confidence: 'high' },
        name: '={Value}', value: '1uF', x_nm: 25_000_000, y_nm: 16_000_000, rotation_microdegree: 0,
        mirror: null, layer: 1, footprint_uuid: 'fp-c0603', footprint_name: 'C0603',
        manufacturer_id: 'M-C17', supplier: 'LCSC', supplier_id: 'C1525',
        other_property: { Description: 'Bulk decoupling', Device: 'C', MPN: 'MPN-C17', Package: '0603', Library: 'lib-cap' },
        is_business_component: true,
      },
    ],
    pads: [
      { component_primitive_id: 'p-c12', pad_number: '1', x_nm: 21_300_000, y_nm: 14_700_000 },
      { component_primitive_id: 'p-u1', pad_number: '32', x_nm: 30_000_000, y_nm: 20_000_000 },
      { component_primitive_id: 'p-j1', pad_number: 'A6', x_nm: 40_000_000, y_nm: 20_000_000 },
      { component_primitive_id: 'p-c17', pad_number: '1', x_nm: 25_000_000, y_nm: 16_000_000 },
    ],
    connectivity: {
      preferred_source: 'manufacture_netlist',
      manufacture_nets: [
        { name: 'NET_USB_DP', members: [
          { component_identity: 'u-u1', pin: '32', pin_name: 'USB_DP' },
          { component_identity: 'j1', pin: 'A6', pin_name: 'D+' },
        ] },
        { name: 'NET_USB_DM', members: [
          { component_identity: 'u-u1', pin: '31', pin_name: 'USB_DM' },
          { component_identity: 'j1', pin: 'A7', pin_name: 'D-' },
        ] },
      ],
      pcb_nets: [],
      direct_nets: [],
    },
    geometry: {
      lines: [
        { kind: 'line', primitive_id: 'track-a', layer: 1, net: 'NET_USB_DP', line_width_nm: 150_000, start: { x_nm: 30_000_000, y_nm: 20_000_000 }, end: { x_nm: 40_000_000, y_nm: 20_000_000 } },
        { kind: 'line', primitive_id: 'track-b', layer: 2, net: 'NET_USB_DM', line_width_nm: 150_000, start: { x_nm: 30_000_000, y_nm: 20_500_000 }, end: { x_nm: 40_000_000, y_nm: 20_500_000 } },
      ],
      arcs: [], polylines: [], regions: [], pours: [], fills: [],
      board_outline: [{ kind: 'polyline', primitive_id: 'outline-runtime-id', layer: 11, closed: true, rectangle: { x_nm: 10_000_000, y_nm: 10_000_000, width_nm: 50_000_000, height_nm: 30_000_000 } }],
    },
    board_bounds: { min_x_nm: 10_000_000, min_y_nm: 10_000_000, max_x_nm: 60_000_000, max_y_nm: 40_000_000 },
    vias: [{ primitive_id: 'via-a', net: 'NET_USB_DP', x_nm: 35_000_000, y_nm: 20_000_000, diameter_nm: 600_000, hole_nm: 300_000, layers: [1, 2] }],
    bom: [
      { unique_id: 'u-c12', designator: 'C12', value: '0.1uF', footprint_uuid: 'fp-c0603', supplier: 'LCSC', supplier_id: 'C1525', manufacturer_id: 'M-C12' },
      { unique_id: 'u-u1', designator: 'U1', value: 'MCU', footprint_uuid: 'fp-lqfp48', footprint_name: 'LQFP48', supplier: 'LCSC', supplier_id: 'C9999', manufacturer_id: 'M-MCU' },
      { unique_id: 'u-j1', designator: 'J1', value: 'USB-C', footprint_uuid: 'fp-usbc', footprint_name: 'USB-C-16P', supplier: 'LCSC', supplier_id: 'C165948', manufacturer_id: 'M-USBC' },
      { unique_id: 'u-c17', designator: 'C17', value: '1uF', footprint_uuid: 'fp-c0603', footprint_name: 'C0603', supplier: 'LCSC', supplier_id: 'C1525', manufacturer_id: 'M-C17' },
    ],
    rules: { minimum_clearance_nm: 200_000, default_line_width_nm: 150_000, via_size_nm: { diameter_nm: 600_000, hole_nm: 300_000 } },
    layers: { layers: [{ id: 1, name: 'Top Layer', type: 'SIGNAL', layerStatus: 1, locked: false, transparency: 0 }, { id: 2, name: 'Bottom Layer', type: 'SIGNAL', layerStatus: 1, locked: false, transparency: 0 }] },
  };
}

function refresh(snapshot) {
  const result = structuredClone(snapshot);
  const values = {
    components: result.components,
    pads: result.pads,
    connectivity: result.connectivity,
    geometry: result.geometry,
    vias: result.vias,
    bom: result.bom,
    rules: result.rules,
    layers: result.layers,
  };
  result.facet_hashes = Object.fromEntries(FACETS.map((name) => [name, hashObject(values[name])]));
  result.snapshot_hash = hashObject({ identity: result.identity, ...values });
  return result;
}

function pair(mutator = () => {}) {
  const before = refresh(baseSnapshot());
  const after = structuredClone(before);
  mutator(after);
  return { before, after: refresh(after) };
}

function types(diff) { return diff.changes.map((change) => change.type); }

test('D0 identical snapshots produce a zero diff and stable facet comparison', () => {
  const before = refresh(baseSnapshot());
  const diff = semanticDiff(before, structuredClone(before));
  assert.equal(diff.schema, SEMANTIC_DIFF_SCHEMA);
  assert.equal(diff.valid, true);
  assert.equal(diff.zero_diff, true);
  assert.equal(diff.before_hash, diff.after_hash);
  assert.equal(diff.facet_hashes.equal, true);
  assert.equal(diff.summary.total_changes, 0);
  assert.deepEqual(diff.changes, []);
  assert.equal(renderSemanticDiff(diff), 'EDA-GUARD SEMANTIC DIFF\n\nNO DESIGN CHANGES');
});

test('D1 move one component reports integer-unit delta', () => {
  const { before, after } = pair((snapshot) => { snapshot.components[0].x_nm += 4_500_000; });
  const diff = semanticDiff(before, after);
  const change = diff.changes.find((item) => item.type === 'component_moved');
  assert.ok(change);
  assert.deepEqual(change.delta, { x_nm: 4_500_000, y_nm: 0 });
  assert.equal(change.severity, 'NOTICE');
  assert.match(renderSemanticDiff(diff), /25\.800 mm, 14\.700 mm/);
});

test('D2 rotation is a distinct deterministic event', () => {
  const { before, after } = pair((snapshot) => { snapshot.components[1].rotation_microdegree += 45_000_000; });
  const diff = semanticDiff(before, after);
  assert.deepEqual(types(diff), ['component_rotated']);
  assert.equal(diff.changes[0].delta_microdegree, 45_000_000);
});

test('D3 footprint change is semantic and WARNING', () => {
  const { before, after } = pair((snapshot) => {
    snapshot.components[1].footprint_name = 'LQFP64';
    snapshot.components[1].footprint_uuid = 'fp-lqfp64';
  });
  const diff = semanticDiff(before, after);
  const change = diff.changes.find((item) => item.type === 'property_changed' && item.property === 'footprint');
  assert.ok(change);
  assert.equal(change.property_class, 'semantic');
  assert.equal(change.severity, 'WARNING');
});

test('D4 value change is semantic and NOTICE', () => {
  const { before, after } = pair((snapshot) => { snapshot.components[0].value = '1uF'; });
  const diff = semanticDiff(before, after);
  const change = diff.changes.find((item) => item.type === 'property_changed' && item.property === 'value');
  assert.ok(change);
  assert.equal(change.severity, 'NOTICE');
});

test('D5 clearing an LCSC supplier id is reported in both property and BOM views', () => {
  const { before, after } = pair((snapshot) => {
    snapshot.components[3].supplier_id = null;
    snapshot.bom[3].supplier_id = null;
  });
  const diff = semanticDiff(before, after);
  assert.ok(diff.changes.some((item) => item.type === 'property_changed' && item.property === 'supplierId'));
  const bom = diff.changes.find((item) => item.type === 'bom_supplier_id_changed');
  assert.ok(bom);
  assert.equal(bom.before, 'C1525');
  assert.equal(bom.after, null);
  assert.equal(bom.severity, 'WARNING');
});

test('D6 and D7 component/BOM additions and removals are supported', () => {
  const added = pair((snapshot) => {
    const component = structuredClone(snapshot.components[0]);
    component.identity = { ...component.identity, key: 'c99', unique_id: 'u-c99', primitive_id: 'p-c99', designator: 'C99' };
    snapshot.components.push(component);
    snapshot.bom.push({ unique_id: 'u-c99', designator: 'C99', value: component.value, footprint_uuid: component.footprint_uuid, footprint_name: component.footprint_name, supplier: 'LCSC', supplier_id: 'C99', manufacturer_id: 'M-C99' });
  });
  const addedDiff = semanticDiff(added.before, added.after);
  assert.ok(types(addedDiff).includes('component_added'));
  assert.ok(types(addedDiff).includes('bom_item_added'));

  const removed = pair((snapshot) => {
    snapshot.components = snapshot.components.filter((component) => component.identity.designator !== 'C17');
    snapshot.bom = snapshot.bom.filter((item) => item.designator !== 'C17');
  });
  const removedDiff = semanticDiff(removed.before, removed.after);
  assert.ok(types(removedDiff).includes('component_removed'));
  assert.ok(types(removedDiff).includes('bom_item_removed'));
});

test('D8 and D9 connectivity member add/remove use the preferred source', () => {
  const removed = pair((snapshot) => {
    snapshot.connectivity.manufacture_nets[0].members = snapshot.connectivity.manufacture_nets[0].members.filter((member) => member.pin !== 'A6');
  });
  const removedDiff = semanticDiff(removed.before, removed.after);
  const removedEvent = removedDiff.changes.find((item) => item.type === 'connectivity_member_removed');
  assert.ok(removedEvent);
  assert.equal(removedEvent.net, 'NET_USB_DP');
  assert.equal(removedEvent.severity, 'CRITICAL');

  const added = pair((snapshot) => {
    snapshot.connectivity.manufacture_nets[0].members.push({ component_identity: 'c12', pin: '1', pin_name: '1' });
  });
  const addedDiff = semanticDiff(added.before, added.after);
  const addedEvent = addedDiff.changes.find((item) => item.type === 'connectivity_member_added');
  assert.ok(addedEvent);
  assert.equal(addedEvent.net, 'NET_USB_DP');
  assert.equal(addedEvent.severity, 'NOTICE');
  assert.equal(addedDiff.connectivity.before.nets.find((net) => net.net_name === 'NET_USB_DM')?.net_name, 'NET_USB_DM');

  const permutedBefore = structuredClone(removed.before);
  permutedBefore.connectivity.manufacture_nets.reverse();
  const permutedDiff = semanticDiff(permutedBefore, removed.after);
  assert.deepEqual(permutedDiff.connectivity.before.nets.map((net) => net.net_name), ['NET_USB_DM', 'NET_USB_DP']);
});

test('PCB net-name snapshots can derive conservative members from canonical pads', () => {
  const makePcb = (net) => refresh({
    ...baseSnapshot(),
    connectivity: { preferred_source: 'pcb_api', manufacture_nets: [], direct_nets: [], pcb_nets: [{ name: 'NET_USB_DP', pins: [] }] },
    components: [structuredClone(baseSnapshot().components[2])],
    pads: [{ primitive_id: 'p-j1-a6', component_primitive_id: 'p-j1', number: 'A6', name: 'D+', net }],
    bom: [],
  });
  const before = makePcb('NET_USB_DP');
  const after = makePcb('');
  const diff = semanticDiff(before, after);
  const event = diff.changes.find((item) => item.type === 'connectivity_member_removed');
  assert.ok(event);
  assert.equal(event.net, 'NET_USB_DP');
  assert.equal(event.member.pin, 'A6');
});

test('D10 pin movement is aggregated as PIN REASSIGNED with raw events retained', () => {
  const { before, after } = pair((snapshot) => {
    snapshot.connectivity.manufacture_nets[0].members = snapshot.connectivity.manufacture_nets[0].members.filter((member) => member.pin !== 'A6');
    snapshot.connectivity.manufacture_nets[1].members.push({ component_identity: 'j1', pin: 'A6', pin_name: 'D+' });
  });
  const diff = semanticDiff(before, after);
  const event = diff.changes.find((item) => item.type === 'pin_reassigned');
  assert.ok(event);
  assert.equal(event.from_net, 'NET_USB_DP');
  assert.equal(event.to_net, 'NET_USB_DM');
  assert.equal(event.severity, 'CRITICAL');
  assert.equal(diff.raw_connectivity_events.filter((item) => item.aggregated_into === 'pin_reassigned').length, 2);
  assert.match(renderSemanticDiff(diff), /PIN REASSIGNED/);
});

test('D11 board bounds and D12 rules report only observed changes', () => {
  const bounds = pair((snapshot) => { snapshot.board_bounds.max_x_nm += 5_000_000; });
  const boundsDiff = semanticDiff(bounds.before, bounds.after);
  assert.deepEqual(types(boundsDiff), ['board_bounds_changed']);
  assert.equal(boundsDiff.changes[0].before_source, 'explicit');

  const rules = pair((snapshot) => { snapshot.rules.minimum_clearance_nm = 100_000; });
  const rulesDiff = semanticDiff(rules.before, rules.after);
  const rule = rulesDiff.changes.find((item) => item.type === 'rule_changed' && item.property === 'minimum_clearance_nm');
  assert.ok(rule);
  assert.equal(rule.before, 200_000);
  assert.equal(rule.after, 100_000);

  const layer = pair((snapshot) => { snapshot.layers.layers[0].color = '#123456'; });
  const layerDiff = semanticDiff(layer.before, layer.after);
  const layerChange = layerDiff.changes.find((item) => item.type === 'layer_changed');
  assert.ok(layerChange);
});

test('D13 routing emits aggregate segment/via/length/layer summary', () => {
  const { before, after } = pair((snapshot) => {
    snapshot.geometry.lines.push({ kind: 'line', primitive_id: 'track-c', layer: 1, net: 'NET_USB_DP', line_width_nm: 150_000, start: { x_nm: 40_000_000, y_nm: 20_000_000 }, end: { x_nm: 45_000_000, y_nm: 20_000_000 } });
    snapshot.vias.push({ primitive_id: 'via-b', net: 'NET_USB_DP', x_nm: 42_000_000, y_nm: 20_000_000, diameter_nm: 600_000, hole_nm: 300_000, layers: [1, 2] });
  });
  const diff = semanticDiff(before, after);
  const event = diff.changes.find((item) => item.type === 'routing_changed' && item.entity === 'NET_USB_DP');
  assert.ok(event);
  assert.equal(event.routing_changed, true);
  assert.equal(event.before.segment_count, 1);
  assert.equal(event.after.segment_count, 2);
  assert.equal(event.before.via_count, 1);
  assert.equal(event.after.via_count, 2);
  assert.deepEqual(event.after.layer_set, ['1', '2']);
  assert.equal(event.after.length_nm, 15_000_000);

  const unknownNet = pair((snapshot) => {
    snapshot.geometry.lines.push({ kind: 'line', layer: 1, start: { x_nm: 50_000_000, y_nm: 20_000_000 }, end: { x_nm: 55_000_000, y_nm: 20_000_000 } });
  });
  const unknownDiff = semanticDiff(unknownNet.before, unknownNet.after);
  const fallback = unknownDiff.changes.find((item) => item.type === 'routing_changed');
  assert.ok(fallback);
  assert.equal(fallback.entity, 'UNKNOWN_NET');
  assert.equal(fallback.fallback, true);
});

test('D14 multiple changes remain deterministic and ordered', () => {
  const { before, after } = pair((snapshot) => {
    snapshot.components[0].x_nm += 1_000_000;
    snapshot.components[1].value = 'MCU-NEW';
    snapshot.bom[3].supplier_id = null;
    snapshot.connectivity.manufacture_nets[0].members = [];
    snapshot.rules.minimum_clearance_nm = 100_000;
  });
  const first = semanticDiff(before, after);
  const second = semanticDiff(before, after);
  assert.equal(stableStringify(first), stableStringify(second));
  assert.ok(first.changes.findIndex((item) => item.category === 'connectivity') < first.changes.findIndex((item) => item.category === 'properties'));
  assert.ok(first.changes.findIndex((item) => item.category === 'properties') < first.changes.findIndex((item) => item.category === 'bom'));
  assert.ok(first.changes.findIndex((item) => item.category === 'bom') < first.changes.findIndex((item) => item.category === 'board_rules'));
});

test('D15 ambiguous identity never falls back to designator matching', () => {
  const before = refresh({ ...baseSnapshot(), components: [
    { identity: { designator: 'X1' }, value: 'A' },
    { identity: { designator: 'X1' }, value: 'B' },
  ], bom: [], connectivity: { preferred_source: 'manufacture_netlist', manufacture_nets: [], pcb_nets: [], direct_nets: [] } });
  const after = refresh(structuredClone(before));
  const diff = semanticDiff(before, after);
  const ambiguous = diff.changes.find((item) => item.code === 'AMBIGUOUS_MATCH');
  assert.ok(ambiguous);
  assert.equal(ambiguous.type, 'ambiguous_match');
  assert.equal(ambiguous.identity_field, 'designator');
  assert.equal(diff.changes.some((item) => item.type === 'component_moved'), false);
});

test('invalid Gate-A envelope fails closed and runtime metadata does not create a design diff', () => {
  const before = refresh(baseSnapshot());
  const after = structuredClone(before);
  after.window_id = 'new-window';
  after.captured_at = 'later';
  const runtimeOnly = semanticDiff({ snapshot: before, validity: { valid_snapshot: true }, runtime: { window_id: 'a' } }, { snapshot: after, validity: { valid_snapshot: true }, runtime: { window_id: 'b' } });
  assert.equal(runtimeOnly.valid, true);
  assert.equal(runtimeOnly.zero_diff, true);
  const invalid = semanticDiff({ snapshot: before, validity: { valid_snapshot: false } }, { snapshot: after, validity: { valid_snapshot: true } });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /valid_snapshot/);
  const missingAttestation = semanticDiff({ snapshot: before }, { snapshot: after });
  assert.equal(missingAttestation.valid, false);
  assert.match(missingAttestation.errors.join('\n'), /valid_snapshot/);
});

test('schema and renderer contracts are present', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/semantic-diff.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schema.const, SEMANTIC_DIFF_SCHEMA);
  for (const key of ['schema', 'before_hash', 'after_hash', 'valid', 'identity', 'facet_hashes', 'summary', 'changes']) assert.ok(schema.required.includes(key), key);
  const { before, after } = pair((snapshot) => { snapshot.components[0].x_nm += 1_000_000; });
  const rendered = renderSemanticDiff(semanticDiff(before, after));
  assert.match(rendered, /EDA-GUARD SEMANTIC DIFF/);
  assert.match(rendered, /COMPONENTS/);
  assert.match(rendered, /MOVED/);
});
