import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatModelProgress, gpuWithCpuFallback } from '../src/inference.ts';

test('GPU success never invokes CPU or fallback cleanup', async () => {
  assert.equal(await gpuWithCpuFallback(async () => 'gpu', async () => { throw Error('CPU must not run'); }, async () => { throw Error('cleanup must not run'); }), 'gpu');
});
for (const reason of ['No GPU adapter', 'Model initialization failed', 'GPU lost during inference']) {
  test(`CPU recovers after ${reason}`, async () => {
    const events: string[] = [];
    const result = await gpuWithCpuFallback(async () => { throw Error(reason); }, async () => { events.push('cpu'); return 'cpu-result'; }, async error => { assert.equal((error as Error).message, reason); events.push('cleanup'); });
    assert.equal(result, 'cpu-result'); assert.deepEqual(events, ['cleanup', 'cpu']);
  });
}
test('CPU failure is surfaced without repeated retries', async () => {
  await assert.rejects(gpuWithCpuFallback(async () => { throw Error('GPU failure'); }, async () => { throw Error('CPU failure'); }, async () => {}), /CPU failure/);
});

test('model progress reports bytes instead of inventing zero percent for unknown totals', () => {
  const message = formatModelProgress({status:'progress',file:'onnx/model.onnx',loaded:2_000_000,total:0,progress:0},'GPU');
  assert.match(message!, /2.0 MB received/);
  assert.doesNotMatch(message!, /0%/);
  assert.match(formatModelProgress({status:'progress',file:'onnx/model.onnx'},'GPU')!, /waiting for transfer details/);
});

test('small download advances are visible and metadata cannot reset weight progress', () => {
  assert.match(formatModelProgress({status:'progress',file:'onnx/model.onnx',loaded:100_000,total:100_000_000},'GPU')!, /<1% · 100.0 KB \/ 100.0 MB/);
  assert.equal(formatModelProgress({status:'done',file:'config.json'},'GPU'),null);
  assert.equal(formatModelProgress({status:'progress_total',loaded:1,total:2},'GPU'),null);
  assert.match(formatModelProgress({status:'done',file:'onnx/model.onnx'},'GPU')!, /weights loaded · preparing runtime/);
});
