#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { BridgeClient } from './bridge-client.mjs';
import { buildCaptureScript, buildIdentityScript } from './easyeda-capture.mjs';
import { captureAtomic } from './validation.mjs';
import { renderSemanticDiff, semanticDiff } from './diff.mjs';
import { compileIntent, renderIntentCompile, renderIntentResult, verifyIntent } from './intent.mjs';
import { compileAssertions, renderAssertionCompile, renderAssertionResult, runAssertions } from './assertions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argsToObject(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const equal = token.indexOf('=');
    if (equal > 2) { out[token.slice(2, equal)] = token.slice(equal + 1); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function jsonPrint(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function bridgeUrl(options) {
  return options.bridge || process.env.EASYEDA_BRIDGE_URL || 'http://127.0.0.1:49620';
}

async function packageVersion(candidates) {
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8'));
      if (parsed.version) return { version: parsed.version, path: candidate };
    } catch { /* optional local package */ }
  }
  return { version: null, path: null };
}

async function sourceVersions(identity) {
  const api = await packageVersion([
    path.resolve(ROOT, '..', '.agents', 'skills', 'easyeda-api', 'package.json'),
    path.resolve(ROOT, '..', 'tools', 'easyeda-api-skill-main', 'package.json'),
  ]);
  const mcp = await packageVersion([
    path.resolve(ROOT, '..', 'tools', 'copilot-runtime', 'node_modules', 'easyeda-copilot-mcp', 'package.json'),
  ]);
  return {
    easyeda_editor: identity?.editor_version ?? null,
    easyeda_api_skill: api.version,
    easyeda_api_skill_path: api.path,
    easyeda_copilot_mcp: mcp.version,
    easyeda_copilot_mcp_path: mcp.path,
  };
}

async function chooseWindow(client, requested) {
  const listing = await client.windows();
  const windows = Array.isArray(listing?.windows) ? listing.windows.filter((item) => item.connected !== false) : [];
  const chosen = requested || (windows.find((item) => item.active)?.windowId) || listing?.activeWindowId || windows[0]?.windowId;
  if (!chosen) throw new Error('No connected EasyEDA window. Start EasyEDA and the official bridge first.');
  if (requested && !windows.some((item) => item.windowId === requested)) throw new Error(`Requested windowId is not connected: ${requested}`);
  return { windowId: chosen, windows, listing };
}

async function runDoctor(options) {
  const client = new BridgeClient(bridgeUrl(options), { timeoutMs: 20_000 });
  const result = { command: 'doctor', bridge_url: client.baseUrl, ok: false, checks: {}, timestamp: new Date().toISOString() };
  try {
    result.health = await client.health();
    result.checks.bridge = result.health?.service === 'easyeda-bridge' && result.health?.status === 'ok';
    const selected = await chooseWindow(client, options['window-id']);
    result.window = { selected: selected.windowId, connected_count: selected.windows.length, windows: selected.windows };
    result.checks.explicit_window_binding = Boolean(selected.windowId);
    const identity = await client.execute(buildIdentityScript(), selected.windowId, { timeoutMs: 15_000 });
    result.identity = identity;
    result.checks.project_uuid = Boolean(identity?.project_uuid);
    result.checks.document_uuid = Boolean(identity?.document_uuid);
    result.checks.document_type = ['pcb', 'schematic'].includes(identity?.document_type);
    result.versions = await sourceVersions(identity);
    try {
      const probe = await client.execute(buildCaptureScript({ includeDrc: false }), selected.windowId, { timeoutMs: 35_000 });
      result.capability_presence = probe?.capability_presence || {};
      result.checks.read_probe = Boolean(probe?.read_only === true && probe?.facets);
    } catch (error) {
      result.checks.read_probe = false;
      result.probe_error = String(error?.message || error);
    }
    result.ok = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.error = String(error?.message || error);
  }
  if (options.json) jsonPrint(result);
  else {
    process.stdout.write(`EDA-Guard doctor: ${result.ok ? 'OK' : 'FAIL'}\n`);
    process.stdout.write(`Bridge: ${result.bridge_url}\n`);
    if (result.window) process.stdout.write(`Window: ${result.window.selected} (${result.window.connected_count} connected)\n`);
    if (result.identity) process.stdout.write(`Identity: ${result.identity.project_uuid || 'missing'} / ${result.identity.document_uuid || 'missing'} / ${result.identity.document_type}\n`);
    if (result.error) process.stdout.write(`Error: ${result.error}\n`);
  }
  return result.ok ? 0 : 1;
}

async function loadJson(file) {
  if (!file) return null;
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

function parseSimpleYaml(text) {
  // The MVP accepts the common, deliberately boring rule-pack subset. JSON is
  // also valid YAML, so JSON remains the canonical interchange format.
  const root = {};
  let list = null;
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const valueLine = line.trim();
    if (valueLine.startsWith('- ')) {
      if (!list) throw new Error('Unsupported YAML: list item without a preceding map key.');
      current = {};
      list.push(current);
      const pair = valueLine.slice(2).match(/^([^:]+):\s*(.*)$/);
      if (pair) current[pair[1].trim()] = parseYamlScalar(pair[2]);
      continue;
    }
    const pair = valueLine.match(/^([^:]+):(?:\s*(.*))?$/);
    if (!pair) throw new Error(`Unsupported YAML line: ${valueLine}`);
    const key = pair[1].trim();
    const rawValue = pair[2] ?? '';
    if (!rawValue) {
      if (indent > 0 && current) {
        current[key] = [];
        list = current[key];
      } else {
        root[key] = [];
        list = root[key];
        current = null;
      }
    } else if (indent > 0 && current) {
      current[key] = parseYamlScalar(rawValue);
    } else {
      root[key] = parseYamlScalar(rawValue);
      list = null;
      current = null;
    }
  }
  return root;
}

function parseYamlScalar(value) {
  const textValue = String(value).trim();
  if (!textValue) return null;
  if (['true', 'false', 'null'].includes(textValue)) return JSON.parse(textValue);
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(textValue)) return Number(textValue);
  if ((textValue.startsWith('"') && textValue.endsWith('"')) || (textValue.startsWith("'") && textValue.endsWith("'"))) return textValue.slice(1, -1);
  if (textValue.startsWith('[') || textValue.startsWith('{')) {
    try { return JSON.parse(textValue); } catch { /* leave as a string for a clear compile error */ }
  }
  return textValue;
}

async function loadAssertionsSource(file) {
  if (!file) return null;
  const sourceText = await readFile(path.resolve(file), 'utf8');
  try { return JSON.parse(sourceText); } catch { return parseSimpleYaml(sourceText); }
}

async function runDiff(options) {
  const beforePath = options._[1];
  const afterPath = options._[2];
  if (!beforePath || !afterPath) throw new Error('diff requires <before.json> and <after.json>.');
  const before = await loadJson(beforePath);
  const after = await loadJson(afterPath);
  const diff = semanticDiff(before, after);
  if (options.json) jsonPrint(diff);
  else process.stdout.write(`${renderSemanticDiff(diff)}\n`);
  return diff.valid ? 0 : 2;
}

async function runIntentCompile(options) {
  const intentPath = options._[2];
  const baselinePath = options._[3];
  if (!intentPath || !baselinePath) throw new Error('intent compile requires <intent.json> and <before.json>.');
  const input = await loadJson(intentPath);
  const baseline = await loadJson(baselinePath);
  const compiled = compileIntent(input, baseline);
  const output = path.resolve(options.out || 'compiled-intent.json');
  await writeFile(output, JSON.stringify(compiled, null, 2), 'utf8');
  if (options.json) jsonPrint(compiled);
  else process.stdout.write(`${renderIntentCompile(compiled, output)}\n`);
  return compiled.valid ? 0 : 2;
}

async function runIntentVerify(options) {
  const compiledPath = options._[2];
  const beforeOrDiffPath = options._[3];
  const afterPath = options._[4];
  if (!compiledPath || !beforeOrDiffPath) throw new Error('intent verify requires <compiled-intent.json> <diff.json> or <before.json> <after.json>.');
  const compiled = await loadJson(compiledPath);
  const beforeOrDiff = await loadJson(beforeOrDiffPath);
  const result = afterPath
    ? verifyIntent(compiled, beforeOrDiff, await loadJson(afterPath))
    : verifyIntent(compiled, beforeOrDiff);
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await writeFile(output, JSON.stringify(result, null, 2), 'utf8');
  if (options.json) jsonPrint(result);
  else {
    process.stdout.write(`${renderIntentResult(result)}\n`);
    if (output) process.stdout.write(`Wrote: ${output}\n`);
  }
  return result.passed ? 0 : 2;
}

async function runIntent(options) {
  const action = options._[1];
  if (action === 'compile') return runIntentCompile(options);
  if (action === 'verify') return runIntentVerify(options);
  throw new Error('intent requires compile or verify.');
}

async function runAssertionCompile(options) {
  const rulesPath = options._[2];
  const snapshotPath = options._[3];
  if (!rulesPath || !snapshotPath) throw new Error('assert compile requires <rules.yaml|json> <snapshot.json>.');
  const source = await loadAssertionsSource(rulesPath);
  const target = await loadJson(snapshotPath);
  const compiled = compileAssertions(source, target);
  const output = path.resolve(options.out || 'compiled-assertions.json');
  await writeFile(output, JSON.stringify(compiled, null, 2), 'utf8');
  if (options.json) jsonPrint(compiled);
  else process.stdout.write(`${renderAssertionCompile(compiled, output)}\n`);
  return compiled.valid ? 0 : 2;
}

async function runAssertionRun(options) {
  const compiledPath = options._[2];
  const snapshotPath = options._[3];
  if (!compiledPath || !snapshotPath) throw new Error('assert run requires <compiled-assertions.json> <snapshot.json>.');
  const compiled = await loadJson(compiledPath);
  const target = await loadJson(snapshotPath);
  const result = runAssertions(compiled, target);
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await writeFile(output, JSON.stringify(result, null, 2), 'utf8');
  if (options.json) jsonPrint(result);
  else {
    process.stdout.write(`${renderAssertionResult(result)}\n`);
    if (output) process.stdout.write(`Wrote: ${output}\n`);
  }
  return result.passed ? 0 : 2;
}

async function runAssertionShortcut(options) {
  const rulesPath = options._[1];
  const snapshotPath = options._[2];
  if (!rulesPath || !snapshotPath) throw new Error('test requires <rules.yaml|json> <snapshot.json>.');
  const target = await loadJson(snapshotPath);
  const compiled = compileAssertions(await loadAssertionsSource(rulesPath), target);
  if (!compiled.valid) {
    if (options.json) jsonPrint(compiled);
    else process.stdout.write(`${renderAssertionCompile(compiled)}\n`);
    return 2;
  }
  const result = runAssertions(compiled, target);
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await writeFile(output, JSON.stringify(result, null, 2), 'utf8');
  if (options.json) jsonPrint(result);
  else process.stdout.write(`${renderAssertionResult(result)}\n`);
  return result.passed ? 0 : 2;
}

async function runAssertionsCommand(options) {
  const action = options._[1];
  if (action === 'compile') return runAssertionCompile(options);
  if (action === 'run') return runAssertionRun(options);
  throw new Error('assert requires compile or run.');
}

async function runCapture(options) {
  const client = new BridgeClient(bridgeUrl(options), { timeoutMs: 40_000 });
  const selected = await chooseWindow(client, options['window-id']);
  const mcpData = options['mcp-json'] ? await loadJson(options['mcp-json']) : null;
  const preliminaryIdentity = await client.execute(buildIdentityScript(), selected.windowId, { timeoutMs: 15_000 });
  const versions = await sourceVersions(preliminaryIdentity);
  const capture = await captureAtomic({
    bridge: client,
    windowId: selected.windowId,
    repeat: Math.max(1, Number(options.repeat || 2)),
    includeDrc: options['no-drc'] !== true,
    profile: options.profile || 'auto',
    sourceVersions: versions,
    mcpData,
  });
  capture.command = 'capture';
  capture.bridge_windows = selected.windows;
  capture.source_versions = versions;
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await writeFile(output, JSON.stringify(capture, null, 2), 'utf8');
  const manifestOutput = options['manifest-out'] ? path.resolve(options['manifest-out']) : null;
  if (manifestOutput) await writeFile(manifestOutput, JSON.stringify(capture.manifest, null, 2), 'utf8');
  if (options.json) jsonPrint(capture);
  else {
    const valid = capture.validity?.valid_snapshot;
    process.stdout.write(`EDA-Guard capture: ${valid ? 'VALID' : 'INVALID'}\n`);
    process.stdout.write(`Profile: ${capture.profile?.name || 'unresolved'}\n`);
    process.stdout.write(`Document: ${capture.snapshot?.identity?.document_type} ${capture.snapshot?.identity?.document_uuid || 'missing'}\n`);
    process.stdout.write(`Snapshot hash: ${capture.snapshot?.snapshot_hash || 'missing'}\n`);
    process.stdout.write(`Repeat: ${capture.repeat?.performed || 0}/${capture.repeat?.requested || 0} (${capture.repeat?.equal ? 'equal' : 'different'})\n`);
    if (output) process.stdout.write(`Wrote: ${output}\n`);
    if (manifestOutput) process.stdout.write(`Manifest: ${manifestOutput}\n`);
    for (const reason of capture.validity?.reasons || []) process.stdout.write(`- ${reason}\n`);
  }
  return capture.validity?.valid_snapshot ? 0 : 2;
}

async function runGate(options) {
  const reportPath = path.resolve(options.report || path.join(ROOT, 'reports', 'capture-reliability-gate.json'));
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (options.json) jsonPrint(report);
  else {
    process.stdout.write(`EDA-Guard reliability gate: ${report.gate || 'UNKNOWN'}\n`);
    if (report.status) process.stdout.write(`Status: ${report.status}\n`);
    if (report.basic_snapshot_reliability_gate) {
      process.stdout.write(`Gate A (basic snapshot reliability): ${report.basic_snapshot_reliability_gate.status || 'UNKNOWN'}\n`);
    }
    if (report.full_capture_coverage_gate) {
      process.stdout.write(`Gate B (full capture coverage): ${report.full_capture_coverage_gate.status || 'UNKNOWN'} (non-blocking for basic Diff)\n`);
    }
    for (const item of report.criteria || []) process.stdout.write(`${item.status === 'PASS' ? 'PASS' : item.status === 'BLOCKED' ? 'BLOCKED' : 'NOT_RUN'} ${item.id}: ${item.summary}\n`);
  }
  const passed = report.basic_snapshot_reliability_gate?.status === 'PASS'
    || report.status === 'PASS'
    || report.gate === 'PASS'
    || String(report.result || '').endsWith(': PASS');
  return passed ? 0 : 2;
}

function help() {
  process.stdout.write('Usage: edaguard <doctor|capture|diff|intent|assert|test|gate> [options]\n');
  process.stdout.write('  doctor  --window-id <id> --bridge <url> [--json]\n');
  process.stdout.write('  capture --window-id <id> --bridge <url> --profile auto|pcb-basic-v1|schematic-basic-v1|pcb-full-v1|schematic-full-v1 --repeat 2 --out <file> [--manifest-out <file>] [--mcp-json <file>] [--no-drc]\n');
  process.stdout.write('  diff    <before.json> <after.json> [--json]\n');
  process.stdout.write('  intent compile <intent.json> <before.json> [--out <compiled-intent.json>] [--json]\n');
  process.stdout.write('  intent verify <compiled-intent.json> <diff.json> [--out <result.json>] [--json]\n');
  process.stdout.write('  intent verify <compiled-intent.json> <before.json> <after.json> [--out <result.json>] [--json]\n');
  process.stdout.write('  assert compile <rules.yaml|json> <snapshot.json> [--out <compiled-assertions.json>] [--json]\n');
  process.stdout.write('  assert run <compiled-assertions.json> <snapshot.json> [--out <result.json>] [--json]\n');
  process.stdout.write('  test    <rules.yaml|json> <snapshot.json> [--out <result.json>] [--json]\n');
  process.stdout.write('  gate    [--report <file>] [--json]\n');
}

const options = argsToObject(process.argv.slice(2));
const command = options._[0] || 'help';
let exitCode = 0;
try {
  if (options.help) {
    help();
    exitCode = 0;
  } else if (command === 'doctor') exitCode = await runDoctor(options);
  else if (command === 'capture') exitCode = await runCapture(options);
  else if (command === 'diff') exitCode = await runDiff(options);
  else if (command === 'intent') exitCode = await runIntent(options);
  else if (command === 'assert') exitCode = await runAssertionsCommand(options);
  else if (command === 'test') exitCode = await runAssertionShortcut(options);
  else if (command === 'gate') exitCode = await runGate(options);
  else { help(); exitCode = command === 'help' ? 0 : 1; }
} catch (error) {
  if (options.json) jsonPrint({ command, ok: false, error: String(error?.message || error) });
  else process.stderr.write(`EDA-Guard ${command} failed: ${error?.message || error}\n`);
  exitCode = 1;
}
process.exitCode = exitCode;
