import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient, BridgeError } from '../src/bridge-client.mjs';

test('bridge client sends explicit window id and rejects implicit routing', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async text() { return JSON.stringify({ success: true, result: { ok: true } }); } };
  };
  const client = new BridgeClient('http://bridge', { fetchImpl: fakeFetch });
  const result = await client.execute('1+1', 'window-1');
  assert.deepEqual(result, { ok: true });
  assert.equal(JSON.parse(calls[0].options.body).windowId, 'window-1');
  await assert.rejects(() => client.execute('1+1'), BridgeError);
});
