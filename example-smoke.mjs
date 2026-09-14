#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semanticDiff } from '../src/diff.mjs';
import { compileIntent, verifyIntent } from '../src/intent.mjs';
import { compileAssertions, runAssertions } from '../src/assertions.mjs';
import { stableStringify } from '../src/hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'examples', 'demo');

async function load(name) { return JSON.parse(await readFile(path.join(DEMO, name), 'utf8')); }

export async function runDemoSmoke() {
  const before = await load('before.snapshot.json');
  const after = await load('after.snapshot.json');
  const intent = await load('intent.json');
  const checkedInCompiledIntent = await load('compiled-intent.json');
  const rulesText = await readFile(path.join(DEMO, 'hardware-contract.yaml'), 'utf8');
  const rules = {
    schema: 'edaguard.assertions.v1',
    name: 'Demo hardware contract',
    description: 'The small contract that the requested move must preserve',
    strict: true,
    rules: [
      { id: 'DEMO-C12-EXISTS', type: 'component_exists', description: 'C12 must still exist', severity: 'ERROR', component: 'C12' },
      { id: 'DEMO-U1-FOOTPRINT', type: 'property_equals', description: 'U1 footprint must remain QFN-32', severity: 'ERROR', component: 'U1', property: 'footprint', expected: 'QFN-32' },
      { id: 'DEMO-C17-LCSC', type: 'valid_lcsc_id', description: 'C17 must retain a valid LCSC ID', severity: 'ERROR', component: 'C17' },
      { id: 'DEMO-C12-VDD', type: 'net_contains', description: 'C12.2 must remain on +3V3', severity: 'CRITICAL', net: '+3V3', member: 'C12.2' },
      { id: 'DEMO-C12-U1-DISTANCE', type: 'component_distance', description: 'C12 and U1 centers must remain within 10 mm', severity: 'WARNING', component_a: 'C12', component_b: 'U1', max_mm: 10 },
    ],
  };
  // Keep the fixture itself as the user-facing YAML; this object mirrors the
  // deliberately small supported YAML subset without adding a parser dependency.
  if (!rulesText.includes('schema: edaguard.assertions.v1')) throw new Error('Demo rule pack header is missing.');
  const cliEvaluation = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.mjs'), 'test', path.join(DEMO, 'hardware-contract.yaml'), path.join(DEMO, 'after.snapshot.json'), '--json'], { cwd: ROOT, encoding: 'utf8' });
  let cliEvaluationJson = null;
  try { cliEvaluationJson = JSON.parse(cliEvaluation.stdout); } catch { /* status assertion below reports the useful failure */ }
  const diff = semanticDiff(before, after);
  const compiledIntent = compileIntent(intent, before);
  const intentResult = verifyIntent(compiledIntent, before, after);
  const compiledAssertions = compileAssertions(rules, after);
  const assertionResult = runAssertions(compiledAssertions, after);
  const replay = runAssertions(compiledAssertions, after);
  const diffTypes = diff.changes.map((item) => item.type);
  const expectedDiffTypes = ['component_moved', 'property_changed', 'property_changed', 'bom_supplier_id_changed', 'connectivity_member_removed'];
  const ok = diff.valid
    && !diff.zero_diff
    && diffTypes.includes('component_moved')
    && diffTypes.includes('connectivity_member_removed')
    && compiledIntent.valid
    && stableStringify(checkedInCompiledIntent) === stableStringify(compiledIntent)
    && intentResult.passed === false
    && assertionResult.valid
    && assertionResult.passed === false
    && assertionResult.summary.fail === 3
    && cliEvaluation.status === 2
    && cliEvaluationJson?.status === 'FAIL'
    && cliEvaluationJson?.summary?.fail === 3
    && stableStringify(assertionResult) === stableStringify(replay)
    && expectedDiffTypes.every((type) => diffTypes.includes(type));
  return {
    ok,
    diff,
    compiledIntent,
    intentResult,
    compiledAssertions,
    assertionResult,
    cliEvaluation: cliEvaluationJson,
    expected: {
      requested: 'Move C12 closer to U1',
      observed: ['C12 moved', 'U1 footprint changed', 'C17 LCSC ID removed', 'C12.2 disconnected'],
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runDemoSmoke();
  if (!result.ok) {
    process.stderr.write('PUBLIC EXAMPLE SMOKE: FAIL\n');
    process.stderr.write(`Diff events: ${result.diff.changes.map((item) => item.type).join(', ')}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write('PUBLIC EXAMPLE SMOKE: PASS\n');
    process.stdout.write('Requested: Move C12 closer to U1\n');
    process.stdout.write('Observed: C12 moved; U1 footprint changed; C17 LCSC ID removed; C12.2 disconnected\n');
    process.stdout.write(`Diff events: ${result.diff.changes.length}\n`);
    process.stdout.write(`Intent: ${result.intentResult.passed ? 'PASS' : 'FAIL (expected)'}\n`);
    process.stdout.write(`Hardware assertions: ${result.assertionResult.passed ? 'PASS' : 'FAIL (expected)'}\n`);
  }
}
