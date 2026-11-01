import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuWithCpuFallback } from '../src/inference.ts';

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
