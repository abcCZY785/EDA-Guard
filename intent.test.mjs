import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashObject, stableStringify } from '../src/hash.mjs';
import { semanticDiff } from '../src/diff.mjs';
import {
  INTENT_RESULT_SCHEMA,
  INTENT_SCHEMA,
  compileIntent,
  renderIntentResult,
  verifyIntent,
} from '../src/intent.mjs';

const FACETS = ['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom', 'rules', 'layers'];
const PROFILE = { name: 'pcb-basic-v1', domain: 'pcb', schema_version: '0.1.0' };

function component({ key, unique_id, primitive_id, designator, value, x_nm, y_nm, rotation_microdegree = 0 }) {
  return {
    identity: { key, unique_id, primitive_id, designator, confidence: 'high' },
    name: '={Value}', value, x_nm, y_nm, rotation_microdegree,
    mirror: null, layer: 1, footprint_uuid: `fp-${key}`, footprint_name: '0603',
    manufacturer_id: `M-${key}`, supplier: 'LCSC', supplier_id: `S-${key}`,
    other_property: { Description: designator, Device: 'C', Package: '0603' },
    is_business_component: true,
  };
}

function baseSnapshot() {
  return {
    identity: { project_uuid: 'project-fixture', document_uuid: 'pcb-fixture', document_type: 'pcb' },
    components: [
      component({ key: 'c12', unique_id: 'u-c12', primitive_id: 'p-c12', designator: 'C12', value: '0.1uF', x_nm: 21_300_000, y_nm: 14_700_000 }),
      component({ key: 'r7', unique_id: 'u-r7', primitive_id: 'p-r7', designator: 'R7', value: '10K', x_nm: 26_300_000, y_nm: 14_700_000 }),
      component({ key: 'u1', unique_id: 'u-u1', primitive_id: 'p-u1', designator: 'U1', value: 'MCU', x_nm: 30_000_000, y_nm: 20_000_000, rotation_microdegree: 90_000_000 }),
    ],
    pads: [
      { component_primitive_id: 'p-c12', pad_number: '1', x_nm: 21_300_000, y_nm: 14_700_000, net: 'NET1' },
      { component_primitive_id: 'p-r7', pad_number: '1', x_nm: 26_300_000, y_nm: 14_700_000, net: 'NET1' },
      { component_primitive_id: 'p-u1', pad_number: '1', x_nm: 30_000_000, y_nm: 20_000_000, net: 'NET1' },
    ],
    connectivity: {
      preferred_source: 'manufacture_netlist',
      manufacture_nets: [{ name: 'NET1', members: [
        { component_identity: 'u-c12', pin: '1', pin_name: '1' },
        { component_identity: 'u-r7', pin: '1', pin_name: '1' },
      ] }],
      pcb_nets: [], direct_nets: [],
    },
    geometry: { lines: [], arcs: [], polylines: [], regions: [], pours: [], fills: [], board_outline: [] },
    vias: [],
    bom: [
      { unique_id: 'u-c12', designator: 'C12', value: '0.1uF', footprint_uuid: 'fp-c12', supplier: 'LCSC', supplier_id: 'S-c12', manufacturer_id: 'M-c12' },
      { unique_id: 'u-r7', designator: 'R7', value: '10K', footprint_uuid: 'fp-r7', supplier: 'LCSC', supplier_id: 'S-r7', manufacturer_id: 'M-r7' },
      { unique_id: 'u-u1', designator: 'U1', value: 'MCU', footprint_uuid: 'fp-u1', supplier: 'LCSC', supplier_id: 'S-u1', manufacturer_id: 'M-u1' },
    ],
    rules: { minimum_clearance_nm: 200_000 },
    layers: { layers: [{ id: 1, name: 'Top Layer', type: 'SIGNAL', layerStatus: 1, transparency: 0 }] },
  };
}

function refresh(snapshot) {
  const result = structuredClone(snapshot);
  const values = Object.fromEntries(FACETS.map((name) => [name, result[name]]));
  result.facet_hashes = Object.fromEntries(FACETS.map((name) => [name, hashObject(values[name])]));
  result.snapshot_hash = hashObject({ identity: result.identity, ...values });
  return result;
}

function envelope(snapshot) {
  return {
    artifact_type: 'edaguard.capture',
    profile: PROFILE,
    snapshot,
    validity: { valid_snapshot: true, fail_closed: true },
  };
}

function pair(mutator = () => {}) {
  const before = refresh(baseSnapshot());
  const after = structuredClone(before);
  mutator(after);
  return { before: envelope(before), after: envelope(refresh(after)) };
}

function compile(source, baseline) {
  const result = compileIntent({ schema: INTENT_SCHEMA, ...source }, baseline);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

function verify(source, mutation) {
  const { before, after } = pair(mutation);
  const intent = compile(source, before);
  return { before, after, diff: semanticDiff(before, after), result: verifyIntent(intent, before, after) };
}

test('I0 no changes with no required changes passes', () => {
  const { result } = verify({ description: 'No-op' });
  assert.equal(result.passed, true);
  assert.deepEqual(result.summary, { allowed: 0, denied: 0, unexpected: 0, missing_required: 0, total_events: 0 });
});

test('I1 required C12 move passes', () => {
  const { result, diff } = verify({ required: [{ event: 'component_moved', component: 'C12' }] }, (snapshot) => { snapshot.components[0].x_nm += 1_000_000; });
  assert.equal(diff.changes[0].event_id, 'EVT-001');
  assert.equal(result.passed, true);
  assert.equal(result.required_results[0].status, 'PASS');
});

test('I2 missing required C12 move fails', () => {
  const { result } = verify({ required: [{ event: 'component_moved', component: 'C12' }] });
  assert.equal(result.passed, false);
  assert.equal(result.summary.missing_required, 1);
  assert.equal(result.missing_required[0].rule_id, 'REQ-001');
});

test('I3 unrelated R7 move is default-denied', () => {
  const { result } = verify({ required: [{ event: 'component_moved', component: 'C12' }] }, (snapshot) => {
    snapshot.components[0].x_nm += 1_000_000;
    snapshot.components[1].x_nm += 1_000_000;
  });
  assert.equal(result.passed, false);
  assert.equal(result.summary.allowed, 1);
  assert.equal(result.summary.unexpected, 1);
  assert.equal(result.decisions.find((item) => item.entity === 'R7').reason, 'DEFAULT_DENY');
});

test('I4 explicitly allowed property change passes', () => {
  const { result } = verify({ allowed: [{ event: 'property_changed', component: 'C12', field: 'value' }] }, (snapshot) => { snapshot.components[0].value = '1uF'; });
  assert.equal(result.passed, true);
  assert.equal(result.summary.allowed, 1);
});

test('I5 forbidden footprint change fails', () => {
  const { result } = verify({ forbidden: [{ field: 'footprint' }] }, (snapshot) => { snapshot.components[2].footprint_name = 'QFN'; });
  assert.equal(result.passed, false);
  assert.equal(result.summary.denied, 1);
  assert.equal(result.violations[0].reason, 'FORBIDDEN_RULE');
});

test('I6 forbidden BOM change fails', () => {
  const { result } = verify({ forbidden: [{ category: 'bom' }] }, (snapshot) => { snapshot.bom[0].supplier_id = null; });
  assert.equal(result.passed, false);
  assert.equal(result.summary.denied, 1);
});

test('I7 forbidden connectivity change fails', () => {
  const { result } = verify({ forbidden: [{ category: 'connectivity' }] }, (snapshot) => { snapshot.connectivity.manufacture_nets[0].members.pop(); });
  assert.equal(result.passed, false);
  assert.equal(result.summary.denied, 1);
});

test('I8 pin reassignment is denied', () => {
  const { result } = verify({}, (snapshot) => {
    snapshot.connectivity.manufacture_nets[0].members = [{ component_identity: 'u-c12', pin: '1', pin_name: '1' }];
    snapshot.connectivity.manufacture_nets.push({ name: 'NET2', members: [{ component_identity: 'u-r7', pin: '1', pin_name: '1' }] });
  });
  assert.equal(result.passed, false);
  assert.ok(result.summary.unexpected >= 1);
  assert.ok(result.decisions.some((item) => item.type === 'pin_reassigned' && item.reason === 'DEFAULT_DENY'));
});

test('I9 explicit allow overrides default deny', () => {
  const { result } = verify({ allowed: [{ event: 'component_moved', component: 'C12' }] }, (snapshot) => { snapshot.components[0].x_nm += 1_000_000; });
  assert.equal(result.passed, true);
  assert.equal(result.decisions[0].matched_rule_id, 'ALLOW-001');
});

test('I10 allow and forbid conflict is invalid policy', () => {
  const { before } = pair();
  const intent = compileIntent({
    description: 'conflict',
    allowed: [{ event: 'component_moved', component: 'C12' }],
    forbidden: [{ event: 'component_moved', component: 'C12' }],
  }, before);
  assert.equal(intent.valid, false);
  assert.ok(intent.errors.some((error) => error.code === 'POLICY_CONFLICT'));
  const result = verifyIntent(intent, before, before);
  assert.equal(result.status, 'INVALID_POLICY');
});

test('I11 wrong baseline hash fails closed', () => {
  const { before, after } = pair((snapshot) => { snapshot.components[0].x_nm += 1_000_000; });
  const intent = compile({ allowed: [{ event: 'component_moved', component: 'C12' }] }, before);
  const diff = semanticDiff(before, after);
  diff.before_hash = 'wrong-baseline-hash';
  const result = verifyIntent(intent, diff);
  assert.equal(result.status, 'BASELINE_MISMATCH');
  assert.equal(result.valid, false);
  assert.equal(result.baseline_match, false);
  assert.match(renderIntentResult(result), /INTENT BASELINE MISMATCH/);
});

test('I12 wrong project or document identity fails closed', () => {
  const { before, after } = pair((snapshot) => { snapshot.identity.project_uuid = 'other-project'; });
  const intent = compile({ allowed: [{ event: 'component_moved', component: 'C12' }] }, before);
  const result = verifyIntent(intent, before, after);
  assert.equal(result.status, 'INVALID_DIFF');
  assert.equal(result.valid, false);
});

test('I13 unknown component selector fails compilation', () => {
  const { before } = pair();
  const intent = compileIntent({ allowed: [{ event: 'component_moved', component: 'ZZ9' }] }, before);
  assert.equal(intent.valid, false);
  assert.ok(intent.errors.some((error) => error.code === 'UNKNOWN_COMPONENT_SELECTOR'));
});

test('I14 ambiguous selector fails compilation', () => {
  const snapshot = refresh({ ...baseSnapshot(), components: [
    { identity: { designator: 'X1' }, value: 'A' },
    { identity: { designator: 'X1' }, value: 'B' },
  ] });
  const intent = compileIntent({ allowed: [{ event: 'component_moved', component: 'X1' }] }, envelope(snapshot));
  assert.equal(intent.valid, false);
  assert.ok(intent.errors.some((error) => error.code === 'AMBIGUOUS_COMPONENT_SELECTOR'));
});

test('I15 designator change still matches the compiled canonical identity', () => {
  const { before, after, result, diff } = verify({ required: [{ event: 'property_changed', component: 'C12', field: 'designator' }] }, (snapshot) => {
    snapshot.components[0].identity.designator = 'C13';
  });
  const event = diff.changes.find((item) => item.type === 'property_changed');
  assert.equal(event.entity, 'C13');
  assert.equal(event.match_key, 'u-c12');
  assert.equal(result.passed, true);
});

test('I16 multiple explicitly allowed changes pass', () => {
  const { result } = verify({ allowed: [
    { event: 'component_moved', component: 'C12' },
    { event: 'component_rotated', component: 'U1' },
  ] }, (snapshot) => {
    snapshot.components[0].x_nm += 1_000_000;
    snapshot.components[2].rotation_microdegree += 45_000_000;
  });
  assert.equal(result.passed, true);
  assert.equal(result.summary.allowed, 2);
});

test('I17 one allowed and one unexpected change fails', () => {
  const { result } = verify({ allowed: [{ event: 'component_moved', component: 'C12' }] }, (snapshot) => {
    snapshot.components[0].x_nm += 1_000_000;
    snapshot.components[1].x_nm += 1_000_000;
  });
  assert.equal(result.passed, false);
  assert.equal(result.summary.allowed, 1);
  assert.equal(result.summary.unexpected, 1);
});

test('I18 identical replay is byte-stable', () => {
  const { before, after } = pair((snapshot) => { snapshot.components[0].x_nm += 1_000_000; });
  const intent = compile({ allowed: [{ event: 'component_moved', component: 'C12' }] }, before);
  const first = verifyIntent(intent, before, after);
  const second = verifyIntent(intent, before, after);
  assert.equal(first.schema, INTENT_RESULT_SCHEMA);
  assert.equal(stableStringify(first), stableStringify(second));
});

test('intent schemas are versioned and expose required contracts', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/intent.schema.json', import.meta.url), 'utf8'));
  const resultSchema = JSON.parse(await readFile(new URL('../schemas/intent-result.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schema.const, INTENT_SCHEMA);
  assert.equal(resultSchema.properties.schema.const, INTENT_RESULT_SCHEMA);
  for (const key of ['schema', 'description', 'default_action', 'required', 'allowed', 'forbidden']) assert.ok(schema.required.includes(key), key);
  for (const key of ['schema', 'intent_id', 'passed', 'summary', 'violations', 'decisions']) assert.ok(resultSchema.required.includes(key), key);
});
