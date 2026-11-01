import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crop, sourcePoint, normalizeDepth, renderPixels, type Settings } from '../src/geometry.ts';
const s: Settings = { source: 24, target: 50, panX: .5, panY: .5, anchorX: .5, anchorY: .5, strength: .3 };
test('24 to 50 mm crop preserves 23.04% area and stays in frame at either pan limit', () => {
  assert.equal(crop(s).size ** 2, .2304);
  assert.equal(crop({...s, panX: 0}).x, 0);
  assert.equal(crop({...s, panX: 1}).x + crop(s).size, 1);
});
test('zero strength is byte-identical to crop; near regions remain anchored', () => {
  const depth = { width: 2, height: 2, data: new Float32Array([0, 1, .5, 1]) };
  const image = {width: 2, height: 2, data: new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])} as ImageData;
  assert.deepEqual(renderPixels(image, depth, {...s, strength: 0}, 8, 8), renderPixels(image, null, s, 8, 8));
  assert.deepEqual(sourcePoint(.9,.3,{width:1,height:1,data:new Float32Array([1])},s), [.9,.3]);
});
test('far field enlarges around anchor by requested factor and keeps anchor fixed', () => {
  const depth = { width: 1, height: 1, data: new Float32Array([0]) };
  const [u] = sourcePoint(.8,.5,depth,s);
  assert.ok(Math.abs(u-(.5+.3/1.3))<1e-12);
  assert.deepEqual(sourcePoint(.5,.5,depth,s), [.5,.5]);
});
test('normalization handles flat depth conservatively and rejects invalid inference', () => {
  assert.deepEqual(normalizeDepth(new Float32Array([4,4])),new Float32Array([1,1]));
  assert.throws(() => normalizeDepth(new Float32Array([NaN])));
  const d = normalizeDepth(new Float32Array([0,1,2,3])); assert.equal(d[0],0); assert.equal(d[3],1);
});
