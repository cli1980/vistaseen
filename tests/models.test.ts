import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthModels, getDepthModel } from '../src/models.ts';
test('each selectable model resolves to its own checkpoint', () => {
  assert.equal(new Set(depthModels.map(model => model.id)).size, 3);
  for (const size of ['small', 'base', 'large']) {
    const id = `onnx-community/depth-anything-v2-${size}`;
    assert.equal(getDepthModel(id).id, id);
  }
  assert.throws(() => getDepthModel('arbitrary-repository'), /Unknown depth model/);
});
