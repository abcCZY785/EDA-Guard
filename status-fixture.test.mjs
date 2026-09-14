import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isEvidenceLevel, isStatus, statusForValue } from '../src/constants.mjs';

test('empty, unsupported, and error are distinct states', () => {
  assert.equal(statusForValue([]), 'verified_empty');
  assert.equal(statusForValue(null), 'verified_empty');
  assert.equal(isStatus('unsupported'), true);
  assert.equal(isStatus('error'), true);
  assert.equal(isStatus('empty'), false);
  assert.equal(isEvidenceLevel('CROSS_VALIDATED'), true);
  assert.equal(isEvidenceLevel('PROBABLE'), false);
});

test('fixture matrix contains the Gate A/Gate B boundary', async () => {
  const matrix = JSON.parse(await readFile(new URL('../fixtures/fixture-matrix.json', import.meta.url), 'utf8'));
  const ids = new Set(matrix.fixtures.map((fixture) => fixture.id));
  for (const id of ['F0-empty-pcb', 'F1-basic-populated', 'F2-board-outline-lines-arcs-polylines', 'F3-copper-pours-regions-fills', 'F6-A-window-isolation', 'F6-B-document-switching', 'F6-C-restart-stability']) assert.equal(ids.has(id), true, id);
});
