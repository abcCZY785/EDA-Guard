#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.json', '.js', '.md', '.mjs', '.ps1', '.sh', '.toml',
  '.txt', '.yaml', '.yml', '.xml',
]);

// These files are deliberately local evidence and are excluded from the
// publishable surface by .gitignore/package.files. Their relative names are
// recorded without reading their contents into the public report.
function isLocalOnly(relativePath) {
  const normal = relativePath.replaceAll('\\', '/');
  const base = path.posix.basename(normal);
  if (normal === '.git' || normal.startsWith('.git/')) return { reason: 'version-control-metadata' };
  if (normal === 'node_modules' || normal.startsWith('node_modules/')) return { reason: 'installed-dependencies' };
  if (base === '.DS_Store' || base.endsWith('.log') || base.endsWith('.tmp')) return { reason: 'local-temporary-file' };
  if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') return { reason: 'local-environment-file' };
  if (/^reports\/(?:live-capture|semantic-diff-live|intent-live|compiled-intent|assertion-live|compiled-assertions-live)/i.test(normal)) return { reason: 'raw-live-capture-or-runtime-report' };
  if (/^(?:compiled-intent|compiled-assertions).*\.json$/i.test(normal)) return { reason: 'local-compiled-runtime-artifact' };
  if (/\.(?:eprj2|kicad_pcb|kicad_sch|sch|brd)$/i.test(base)) return { reason: 'private-design-file' };
  return null;
}

async function walk(current, relative = '') {
  const entries = await readdir(current, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child, childRelative));
    else output.push({ absolute: child, relative: childRelative.replaceAll('\\', '/') });
  }
  return output;
}

function redactMatch(value) {
  const text = String(value ?? '');
  if (text.length <= 12) return '<redacted>';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function scanText(relativePath, text) {
  const findings = [];
  const add = (kind, match) => findings.push({ path: relativePath, kind, match: redactMatch(match) });
  const windowsPath = new RegExp(`${'D:'}\\\\(?:PCB_ws|Users|Temp)(?:\\\\|/)`, 'i');
  const usersPath = new RegExp(`${'C:'}\\\\Users\\\\`, 'i');
  const absoluteUnixPath = /(?:^|[\s("'])\/(?:Users|home|tmp|private)\/[A-Za-z0-9_.-]+/i;
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  const opaqueDesignId = /\b(?:project_uuid|document_uuid|primitive_id|unique_id|session_id)\s*[:=]\s*["'][0-9a-f]{16,}["']/i;
  const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i;
  const authorizationAssignment = /\bauthori[sz]ation\s*[:=]\s*["'][^"']{12,}["']/i;
  const credentialAssignment = /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{12,}["']/i;
  const cookieAssignment = /\bcookie\s*[:=]\s*["'][^"']{8,}["']/i;
  const privateProjectFile = /(?:^|[\\/])[^\\/\n]+\.(?:eprj2|kicad_pcb|kicad_sch|sch|brd)(?:$|[\\/])/i;
  const bareCredentialAssignment = /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token)\s*=\s*[A-Za-z0-9._~+/=-]{12,}/i;
  const checks = [
    ['absolute-windows-path', windowsPath],
    ['absolute-user-path', usersPath],
    ['absolute-unix-path', absoluteUnixPath],
    ['runtime-uuid', uuid],
    ['opaque-design-or-session-id', opaqueDesignId],
    ['credential', bearer],
    ['credential', authorizationAssignment],
    ['credential', credentialAssignment],
    ['credential', bareCredentialAssignment],
    ['credential', cookieAssignment],
    ['private-project-file-reference', privateProjectFile],
  ];
  for (const [kind, pattern] of checks) {
    const match = text.match(pattern);
    if (match) add(kind, match[0]);
  }
  return findings;
}

export async function scanRepository({ root = ROOT } = {}) {
  const files = await walk(root);
  const publishableFiles = [];
  const excludedLocalFiles = [];
  const findings = [];
  for (const file of files) {
    const relativePath = file.relative;
    const exclusion = isLocalOnly(relativePath);
    if (exclusion) {
      excludedLocalFiles.push({ path: relativePath, reason: exclusion.reason });
      continue;
    }
    publishableFiles.push(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    let info;
    try { info = await stat(file.absolute); } catch { continue; }
    if (info.size > 2_000_000) continue;
    let text;
    try { text = await readFile(file.absolute, 'utf8'); } catch { continue; }
    findings.push(...scanText(relativePath, text));
  }
  return {
    schema_version: '0.1.0',
    gate: 'PUBLIC RELEASE SANITIZATION',
    status: findings.length ? 'FAIL' : 'PASS',
    scan_scope: 'publishable repository files; local-only evidence is excluded by policy',
    repository_root: '<repository>',
    scanned_files: publishableFiles.length,
    excluded_local_files: excludedLocalFiles,
    findings,
    checks: {
      absolute_paths: findings.every((item) => !['absolute-windows-path', 'absolute-user-path', 'absolute-unix-path'].includes(item.kind)),
      credentials: findings.every((item) => item.kind !== 'credential'),
      runtime_ids: findings.every((item) => item.kind !== 'runtime-uuid'),
      private_project_files: findings.every((item) => item.kind !== 'private-project-file-reference'),
    },
    result: findings.length ? 'PUBLIC RELEASE SANITIZATION: FAIL' : 'PUBLIC RELEASE SANITIZATION: PASS',
  };
}

async function main() {
  const report = await scanRepository();
  const output = path.join(ROOT, 'reports', 'public-release-sanitization.json');
  await writeFile(output, `${JSON.stringify({ ...report, generated_at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${report.result}\n`);
  process.stdout.write(`Publishable files: ${report.scanned_files}\n`);
  process.stdout.write(`Excluded local artifacts: ${report.excluded_local_files.length}\n`);
  if (report.findings.length) {
    for (const finding of report.findings) process.stdout.write(`- ${finding.kind}: ${finding.path}\n`);
  }
  process.exitCode = report.status === 'PASS' ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
