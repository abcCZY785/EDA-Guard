import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanRepository } from '../scripts/public-release-audit.mjs';
import { runDemoSmoke } from '../scripts/example-smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.mjs', '.js']);

async function walk(current, relative = '') {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child, childRelative));
    else files.push({ absolute: child, relative: childRelative.replaceAll('\\', '/') });
  }
  return files;
}

test('public release sanitization has no findings on publishable files', async () => {
  const report = await scanRepository({ root: ROOT });
  assert.equal(report.status, 'PASS', JSON.stringify(report.findings, null, 2));
  assert.deepEqual(report.findings, []);
  assert.equal(report.repository_root, '<repository>');
  assert.ok(report.excluded_local_files.every((item) => !path.isAbsolute(item.path)));
});

test('offline public example is useful and deterministic', async () => {
  const result = await runDemoSmoke();
  assert.equal(result.ok, true, JSON.stringify({ diff: result.diff, intent: result.intentResult, assertions: result.assertionResult }, null, 2));
  assert.equal(result.intentResult.passed, false);
  assert.equal(result.assertionResult.passed, false);
  assert.equal(result.assertionResult.summary.fail, 3);
});

test('all local Markdown links resolve inside the public tree', async () => {
  const files = (await walk(ROOT)).filter((file) => path.extname(file.relative).toLowerCase() === '.md');
  const missing = [];
  for (const file of files) {
    const source = await readFile(file.absolute, 'utf8');
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1].trim().split('#')[0];
      if (!link || link.startsWith('http://') || link.startsWith('https://') || link.startsWith('mailto:')) continue;
      const target = path.resolve(path.dirname(file.absolute), link);
      try { await stat(target); } catch { missing.push(`${file.relative} -> ${link}`); }
    }
  }
  assert.deepEqual(missing, []);
});

test('package metadata is publish-ready and points to the confirmed repository', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'edaguard');
  assert.equal(pkg.version, '0.1.0-alpha.1');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin.edaguard, 'src/cli.mjs');
  assert.deepEqual(pkg.repository, {
    type: 'git',
    url: 'git+https://github.com/abcCZY785/EDA-Guard.git',
  });
  assert.deepEqual(pkg.bugs, { url: 'https://github.com/abcCZY785/EDA-Guard/issues' });
  assert.equal(pkg.homepage, 'https://github.com/abcCZY785/EDA-Guard#readme');
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('examples'));
  for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'ROADMAP.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(pkg.files.includes(required), `${required} is not in package.files`);
  }
});

test('public Alpha gate report is explicit about what was and was not published', async () => {
  const gate = JSON.parse(await readFile(path.join(ROOT, 'reports', 'public-alpha-release-gate.json'), 'utf8'));
  assert.equal(gate.status, 'PASS');
  assert.equal(gate.result, 'PUBLIC ALPHA RELEASE CANDIDATE: PASS');
  assert.equal(gate.package.reports_included, false);
  assert.equal(gate.package.private_project_files_included, false);
  assert.equal(gate.release_checks.github_actions, 'PASS');
  assert.equal(gate.naming.owner_confirmation_required, false);
  assert.equal(gate.not_run.github_repository_creation, 'PASS');
  assert.equal(gate.not_run.git_push, 'PASS');
  assert.equal(gate.not_run.npm_publish, 'NOT_RUN');
});

test('all JSON schemas parse and CLI help exits successfully', async () => {
  const files = (await walk(path.join(ROOT, 'schemas'))).filter((file) => file.relative.endsWith('.json'));
  for (const file of files) await assert.doesNotReject(() => readFile(file.absolute, 'utf8').then((text) => JSON.parse(text)), file.relative);
  const cli = path.join(ROOT, 'src', 'cli.mjs');
  for (const command of ['diff', 'intent', 'assert', 'test']) {
    const result = spawnSync(process.execPath, [cli, command, '--help'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /Usage: edaguard/);
  }
});

test('npm pack dry-run includes only the declared public surface', () => {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --dry-run --json'] : ['pack', '--dry-run', '--json'];
  let output;
  try { output = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }); }
  catch (error) { assert.fail(error.stderr || error.message); }
  const payload = JSON.parse(output);
  const files = payload.flatMap((item) => item.files || []).map((item) => item.path);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.every((file) => !file.startsWith('reports/')));
  assert.ok(files.every((file) => !file.endsWith('.eprj2')));
});
