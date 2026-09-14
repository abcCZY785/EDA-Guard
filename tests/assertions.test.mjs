import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashObject, stableStringify } from '../src/hash.mjs';
import {
  ASSERTION_RESULT_SCHEMA,
  ASSERTIONS_SCHEMA,
  compileAssertions,
  renderAssertionResult,
  runAssertions,
} from '../src/assertions.mjs';

const FACETS = ['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom', 'rules', 'layers'];
const PROFILE = {
  name: 'pcb-basic-v1',
  domain: 'pcb',
  schema_version: '0.1.0',
  required_facets: ['pcb_components', 'pcb_pads', 'pcb_lines', 'pcb_polylines', 'pcb_vias', 'pcb_nets', 'bom'],
};

function component({ key, unique_id, primitive_id, designator, value, x_nm, y_nm, supplier_id = 'C1000', footprint_name = '0603' }) {
  return {
    identity: { key, unique_id, primitive_id, designator, confidence: 'high' },
    name: value, value, x_nm, y_nm, rotation_microdegree: 0,
    mirror: null, layer: 1, footprint_uuid: `fp-${key}`, footprint_name,
    manufacturer_id: null, supplier_id,
    other_property: { Description: designator, Value: value },
    is_business_component: true,
  };
}

function baseSnapshot() {
  const c12 = component({ key: 'c12', unique_id: 'u-c12', primitive_id: 'p-c12', designator: 'C12', value: '0.1uF', x_nm: 1_000_000, y_nm: 1_000_000, supplier_id: 'C1234' });
  const u1 = component({ key: 'u1', unique_id: 'u-u1', primitive_id: 'p-u1', designator: 'U1', value: 'MCU', x_nm: 4_000_000, y_nm: 5_000_000, supplier_id: 'C9999', footprint_name: 'QFN-32' });
  const j1 = component({ key: 'j1', unique_id: 'u-j1', primitive_id: 'p-j1', designator: 'J1', value: 'HEADER', x_nm: 100_000, y_nm: 100_000, supplier_id: 'C5678', footprint_name: 'HDR-2P' });
  return {
    identity: { project_uuid: 'project-fixture', document_uuid: 'pcb-fixture', document_type: 'pcb' },
    components: [c12, u1, j1],
    pads: [
      { primitive_id: 'pad-c12-1', component_primitive_id: 'p-c12', number: '1', net: '+3V3', x_nm: 1_000_000, y_nm: 1_000_000 },
      { primitive_id: 'pad-u1-5', component_primitive_id: 'p-u1', number: '5', net: '+3V3', x_nm: 4_000_000, y_nm: 5_000_000 },
      { primitive_id: 'pad-u1-1', component_primitive_id: 'p-u1', number: '1', net: 'GND', x_nm: 4_000_000, y_nm: 5_000_000 },
    ],
    connectivity: {
      preferred_source: 'manufacture_netlist',
      manufacture_nets: [
        { name: '+3V3', members: [
          { component_identity: 'u-c12', pin: '1', pin_name: '1' },
          { component_identity: 'u-u1', pin: '5', pin_name: 'VDD' },
        ] },
        { name: 'GND', members: [
          { component_identity: 'u-u1', pin: '1', pin_name: 'GND' },
          { component_identity: 'u-j1', pin: '1', pin_name: '1' },
        ] },
      ],
      pcb_nets: [], direct_nets: [],
    },
    geometry: {
      lines: [], arcs: [], polylines: [], regions: [], pours: [], fills: [],
      board_outline: [{ kind: 'polyline', primitive_id: 'outline', layer: 11, closed: true, rectangle: { x_nm: 0, y_nm: 0, width_nm: 10_000_000, height_nm: 10_000_000 } }],
    },
    vias: [],
    bom: [
      { unique_id: 'u-c12', designator: 'C12', value: '0.1uF', footprint_uuid: 'fp-c12', supplier_id: 'C1234' },
      { unique_id: 'u-u1', designator: 'U1', value: 'MCU', footprint_uuid: 'fp-u1', supplier_id: 'C9999' },
      { unique_id: 'u-j1', designator: 'J1', value: 'HEADER', footprint_uuid: 'fp-j1', supplier_id: 'C5678' },
    ],
    rules: {},
    layers: [],
  };
}

function refresh(snapshot) {
  const result = structuredClone(snapshot);
  const values = Object.fromEntries(FACETS.map((name) => [name, result[name]]));
  result.facet_hashes = Object.fromEntries(FACETS.map((name) => [name, hashObject(values[name])]));
  result.snapshot_hash = hashObject({ identity: result.identity, ...values });
  return result;
}

function envelope(snapshot, validity = {}) {
  return {
    artifact_type: 'edaguard.capture',
    profile: PROFILE,
    snapshot,
    validity: { valid_snapshot: true, fail_closed: true, identity_stable: true, repeated_core_equal: true, ...validity },
  };
}

function compile(source, target = envelope(refresh(baseSnapshot()))) {
  const result = compileAssertions({ schema: ASSERTIONS_SCHEMA, ...source }, target);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

function run(source, target = envelope(refresh(baseSnapshot()))) {
  const compiled = compile(source);
  return runAssertions(compiled, target);
}

test('H0 empty suite passes', () => {
  const result = run({ name: 'empty', rules: [] });
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.summary, { pass: 0, fail: 0, unverifiable: 0, total: 0 });
});

test('H1 component exists passes', () => {
  const result = run({ rules: [{ id: 'H1', type: 'component_exists', component: 'C12', severity: 'ERROR', description: 'C12 exists' }] });
  assert.equal(result.results[0].result, 'PASS');
  assert.equal(result.passed, true);
});

test('H2 missing component existence fails', () => {
  const result = run({ rules: [{ id: 'H2', type: 'component_exists', component: 'R99', severity: 'ERROR', description: 'R99 exists' }] });
  assert.equal(result.results[0].result, 'FAIL');
  assert.equal(result.passed, false);
});

test('H3 property present passes and H4 missing property fails', () => {
  const pass = run({ rules: [{ id: 'H3', type: 'property_present', component: 'C12', property: 'footprint', severity: 'ERROR', description: 'footprint present' }] });
  const fail = run({ rules: [{ id: 'H4', type: 'property_present', component: 'C12', property: 'manufacturer', severity: 'ERROR', description: 'manufacturer present' }] });
  assert.equal(pass.results[0].result, 'PASS');
  assert.equal(fail.results[0].result, 'FAIL');
});

test('H5 property equals pass and fail', () => {
  const pass = run({ rules: [{ id: 'H5a', type: 'property_equals', component: 'C12', property: 'value', expected: '0.1uF', severity: 'ERROR', description: 'value' }] });
  const fail = run({ rules: [{ id: 'H5b', type: 'property_equals', component: 'C12', property: 'value', expected: '1uF', severity: 'ERROR', description: 'value' }] });
  assert.equal(pass.results[0].result, 'PASS');
  assert.equal(fail.results[0].result, 'FAIL');
});

test('H6 valid LCSC ID passes', () => {
  const result = run({ rules: [{ id: 'H6', type: 'valid_lcsc_id', component: 'U1', severity: 'ERROR', description: 'U1 has LCSC ID' }] });
  assert.equal(result.results[0].result, 'PASS');
});

test('H7 empty LCSC ID fails', () => {
  const target = refresh(baseSnapshot());
  target.components.find((item) => item.identity.designator === 'U1').supplier_id = '';
  target.bom.find((item) => item.designator === 'U1').supplier_id = '';
  const result = run({ rules: [{ id: 'H7', type: 'valid_lcsc_id', component: 'U1', severity: 'ERROR', description: 'U1 has LCSC ID' }] }, envelope(refresh(target)));
  assert.equal(result.results[0].result, 'FAIL');
});

test('H8 net exists passes and H9 missing net fails', () => {
  const pass = run({ rules: [{ id: 'H8', type: 'net_exists', net: '+3V3', severity: 'ERROR', description: '+3V3 exists' }] });
  const fail = run({ rules: [{ id: 'H9', type: 'net_exists', net: 'NO_SUCH_NET', severity: 'ERROR', description: 'missing net' }] });
  assert.equal(pass.results[0].result, 'PASS');
  assert.equal(fail.results[0].result, 'FAIL');
});

test('H10 net contains passes and H11 missing member fails', () => {
  const pass = run({ rules: [{ id: 'H10', type: 'net_contains', net: '+3V3', member: 'C12.1', severity: 'ERROR', description: 'C12.1 on +3V3' }] });
  const fail = run({ rules: [{ id: 'H11', type: 'net_contains', net: '+3V3', member: 'J1.1', severity: 'ERROR', description: 'J1.1 on +3V3' }] });
  assert.equal(pass.results[0].result, 'PASS');
  assert.equal(fail.results[0].result, 'FAIL');
});

test('H12 pins same net passes and H13 unexpectedly different pins fails', () => {
  const pass = run({ rules: [{ id: 'H12', type: 'pins_same_net', component_a: 'C12.1', component_b: 'U1.5', severity: 'ERROR', description: 'VDD pins same net' }] });
  const fail = run({ rules: [{ id: 'H13', type: 'pins_same_net', component_a: 'C12.1', component_b: 'U1.1', severity: 'ERROR', description: 'unexpected same net' }] });
  assert.equal(pass.results[0].result, 'PASS');
  assert.equal(fail.results[0].result, 'FAIL');
});

test('H14 distance within limit passes and H15 over limit fails', () => {
  const pass = run({ rules: [{ id: 'H14', type: 'component_distance', component_a: 'C12', component_b: 'U1', max_nm: 5_000_000, severity: 'ERROR', description: 'nearby parts' }] });
  const fail = run({ rules: [{ id: 'H15', type: 'component_distance', component_a: 'C12', component_b: 'U1', max_nm: 4_000_000, severity: 'ERROR', description: 'parts too far' }] });
  assert.equal(pass.results[0].result, 'PASS');
  assert.equal(fail.results[0].result, 'FAIL');
});

test('H16 board edge distance passes', () => {
  const result = run({ rules: [{ id: 'H16', type: 'component_near_board_edge', component: 'J1', max_nm: 200_000, severity: 'ERROR', description: 'J1 near edge' }] });
  assert.equal(result.results[0].result, 'PASS');
});

test('H17 missing board geometry capability is unverifiable', () => {
  const target = envelope(refresh(baseSnapshot()), { facet_status: { pcb_polylines: { status: 'unsupported', evidence: 'UNKNOWN' } } });
  const result = run({ rules: [{ id: 'H17', type: 'component_near_board_edge', component: 'J1', max_nm: 200_000, severity: 'ERROR', description: 'edge' }] }, target);
  assert.equal(result.results[0].result, 'UNVERIFIABLE');
  assert.equal(result.passed, false);
});

test('H18 invalid snapshot aborts before evaluating rules', () => {
  const compiled = compile({ rules: [{ id: 'H18', type: 'component_exists', component: 'C12', severity: 'ERROR', description: 'exists' }] });
  const invalid = envelope(refresh(baseSnapshot()), { valid_snapshot: false });
  const result = runAssertions(compiled, invalid);
  assert.equal(result.status, 'ABORTED');
  assert.equal(result.valid, false);
  assert.match(renderAssertionResult(result), /ASSERTION RUN ABORTED/);
});

test('H19 unsupported assertion type fails compilation', () => {
  const target = envelope(refresh(baseSnapshot()));
  const result = compileAssertions({ schema: ASSERTIONS_SCHEMA, name: 'bad', rules: [{ id: 'H19', type: 'impedance_check', severity: 'ERROR', description: 'unsupported' }] }, target);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'UNSUPPORTED_ASSERTION_TYPE'));
});

test('H20 ambiguous component identity is unverifiable at run time', () => {
  const snapshot = refresh({ ...baseSnapshot(), components: [
    component({ key: 'x1a', unique_id: 'u-x1a', primitive_id: 'p-x1a', designator: 'X1', value: 'A', x_nm: 1_000_000, y_nm: 1_000_000 }),
    component({ key: 'x1b', unique_id: 'u-x1b', primitive_id: 'p-x1b', designator: 'X1', value: 'B', x_nm: 2_000_000, y_nm: 2_000_000 }),
    ...baseSnapshot().components.filter((item) => item.identity.designator === 'U1'),
  ] });
  const target = envelope(snapshot);
  const compiled = compileAssertions({ schema: ASSERTIONS_SCHEMA, rules: [{ id: 'H20', type: 'component_distance', component_a: 'X1', component_b: 'U1', max_nm: 10_000_000, severity: 'ERROR', description: 'ambiguous' }] }, target);
  assert.equal(compiled.valid, true);
  const result = runAssertions(compiled, target);
  assert.equal(result.results[0].result, 'UNVERIFIABLE');
});

test('H21 replay is byte-stable', () => {
  const target = envelope(refresh(baseSnapshot()));
  const compiled = compileAssertions({ schema: ASSERTIONS_SCHEMA, rules: [
    { id: 'H21a', type: 'component_exists', component: 'C12', severity: 'ERROR', description: 'exists' },
    { id: 'H21b', type: 'net_exists', net: '+3V3', severity: 'ERROR', description: 'net' },
  ] }, target);
  assert.equal(stableStringify(runAssertions(compiled, target)), stableStringify(runAssertions(compiled, target)));
});

test('compiled canonical identity survives a designator change', () => {
  const baseline = envelope(refresh(baseSnapshot()));
  const compiled = compileAssertions({ schema: ASSERTIONS_SCHEMA, rules: [{ id: 'H21c', type: 'property_equals', component: 'C12', property: 'value', expected: '0.1uF', severity: 'ERROR', description: 'identity freeze' }] }, baseline);
  const after = refresh(baseSnapshot());
  after.components.find((item) => item.identity.unique_id === 'u-c12').identity.designator = 'C99';
  const result = runAssertions(compiled, envelope(after));
  assert.equal(result.results[0].result, 'PASS');
});

test('H22 strict mode blocks an unverifiable assertion, non-strict warns', () => {
  const target = envelope(refresh(baseSnapshot()), { facet_status: { pcb_polylines: { status: 'unsupported', evidence: 'UNKNOWN' } } });
  const strict = run({ rules: [{ id: 'H22a', type: 'component_near_board_edge', component: 'J1', max_nm: 200_000, severity: 'ERROR', description: 'edge' }] }, target);
  const relaxed = run({ strict: false, rules: [{ id: 'H22b', type: 'component_near_board_edge', component: 'J1', max_nm: 200_000, severity: 'ERROR', description: 'edge' }] }, target);
  assert.equal(strict.passed, false);
  assert.equal(relaxed.passed, true);
  assert.equal(relaxed.summary.unverifiable, 1);
  assert.equal(relaxed.warnings.length, 1);
});

test('schemas define versioned assertion and result contracts', async () => {
  const assertionsSchema = JSON.parse(await readFile(new URL('../schemas/assertions.schema.json', import.meta.url), 'utf8'));
  const resultSchema = JSON.parse(await readFile(new URL('../schemas/assertion-result.schema.json', import.meta.url), 'utf8'));
  assert.equal(assertionsSchema.properties.schema.const, ASSERTIONS_SCHEMA);
  assert.equal(resultSchema.properties.schema.const, ASSERTION_RESULT_SCHEMA);
});
