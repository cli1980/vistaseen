import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crop, rotationFrame, rotatedSourcePoint, sourcePoint, normalizeDepth, renderPixels, type Settings } from '../src/geometry.ts';
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

test('centered rotation is identical to crop and ignores depth enhancement', () => {
  const image = { width: 16, height: 12, data: Uint8ClampedArray.from({length: 16*12*4}, (_, i) => i % 251) } as ImageData;
  const d = { width: 1, height: 1, data: new Float32Array([0]) };
  assert.deepEqual(renderPixels(image, d, s, 31, 23, true, 'rotation'), renderPixels(image, null, s, 31, 23));
  const f = rotationFrame(s, 1600, 1200);
  assert.deepEqual(f.center, [.5, .5]);
  assert.equal(f.yaw, 0);
  assert.deepEqual(f.corners, [[.26,.26],[.74,.26],[.74,.74],[.26,.74]]);
});

test('off-axis rotation follows pinhole camera yaw, keeping the selected ray at output center', () => {
  const settings = { ...s, panX: .65 };
  const f = rotationFrame(settings, 1600, 1200);
  assert.equal(f.limited, false);
  const sensorWidth = Math.hypot(36, 24) * .8;
  const angle = Math.atan((crop(settings).x + .24 - .5) * sensorWidth / 24);
  const rayAngle = Math.atan(.5 * sensorWidth / 50);
  assert.ok(Math.abs(f.map(1,.5)[0] - (.5 + 24 / sensorWidth * Math.tan(angle + rayAngle))) < 1e-12);
  assert.ok(Math.abs(f.map(.5,.5)[0] - f.center[0]) < 1e-12);
  assert.notEqual(f.map(1,.5)[0], crop(settings).x + crop(settings).size);
  // A source straight line remains straight under a homography.
  const a = f.map(.2,0), b = f.map(.2,.4), c = f.map(.2,1);
  assert.ok(Math.abs((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])) < 1e-12);
});

test('rotation bounds hold over landscape, portrait, wide-angle, telephoto, and full-frame inputs', () => {
  for (const [width,height] of [[1600,1200],[1200,1600],[1600,500]]) {
    for (const [source,target] of [[8,50],[24,24],[24,25],[24,50],[24,300],[200,300]]) {
      for (const panX of [0,.2,.5,.8,1]) for (const panY of [0,.2,.5,.8,1]) {
        const f = rotationFrame({...s,source,target,panX,panY},width,height);
        assert.ok(f.valid);
        for (let y=0;y<=10;y++) for (let x=0;x<=10;x++) {
          for (const coordinate of f.map(x/10,y/10)) assert.ok(Number.isFinite(coordinate) && coordinate >= -1e-10 && coordinate <= 1+1e-10);
        }
        const fitted = rotationFrame(f.settings,width,height);
        assert.ok(Math.abs(fitted.center[0]-f.center[0]) < 1e-10);
        assert.ok(Math.abs(fitted.center[1]-f.center[1]) < 1e-10);
        const baseline = crop(f.settings);
        assert.ok(baseline.x >= 0 && baseline.x + baseline.size <= 1);
        if (source === target) assert.deepEqual(f.center,[.5,.5]);
      }
    }
  }
});

test('combined mode equals rotation with zero strength, no depth, or entirely near depth', () => {
  const image = { width: 16, height: 12, data: Uint8ClampedArray.from({length: 16*12*4}, (_, i) => i % 251) } as ImageData;
  const settings = {...s, panX: .9, panY: .1};
  const baseline = renderPixels(image,null,settings,31,23,false,'rotation');
  for (const [depth,strength] of [[null,.4],[{width:1,height:1,data:new Float32Array([0])},0],[{width:1,height:1,data:new Float32Array([1])},.4]] as const) {
    assert.deepEqual(renderPixels(image,depth,{...settings,strength},31,23,false,'rotation-depth'),baseline);
  }
  assert.notDeepEqual(renderPixels(image,{width:1,height:1,data:new Float32Array([0])},settings,31,23,false,'rotation-depth'),baseline);
});

test('combined enhancement acts in rotated coordinates and samples aligned depth', () => {
  const settings = {...s, panX: .9, panY: .2, strength: .4};
  const frame = rotationFrame(settings,1600,1200);
  const far = {width:1,height:1,data:new Float32Array([0])};
  assert.deepEqual(rotatedSourcePoint(.5,.5,frame,far,settings),frame.map(.5,.5));
  const expected = frame.map(.5 + .4/1.4,.5 + .2/1.4);
  const actual = rotatedSourcePoint(.9,.7,frame,far,settings);
  actual.forEach((v,i) => assert.ok(Math.abs(v-expected[i])<1e-12));
  // The target's left side still maps to the source's near right-hand region.
  // Looking up depth at output UV instead would mistakenly enlarge that region.
  const edge = {width:100,height:1,data:Float32Array.from({length:100},(_,x)=>x>=30?1:0)};
  assert.ok(frame.map(.1,.5)[0]>.3);
  assert.deepEqual(rotatedSourcePoint(.1,.5,frame,edge,settings),frame.map(.1,.5));
});

test('combined sampling stays inside the source at all frame and anchor extremes', () => {
  const depth = {width:2,height:2,data:new Float32Array([0,.3,.6,1])};
  for (const panX of [0,1]) for (const panY of [0,1]) for (const anchorX of [0,1]) for (const anchorY of [0,1]) {
    const settings = {...s,panX,panY,anchorX,anchorY,strength:.4};
    const frame = rotationFrame(settings,1200,1600);
    for(let y=0;y<=20;y++) for(let x=0;x<=20;x++) {
      for(const coordinate of rotatedSourcePoint(x/20,y/20,frame,depth,settings)) assert.ok(coordinate>=-1e-10 && coordinate<=1+1e-10);
    }
  }
});
