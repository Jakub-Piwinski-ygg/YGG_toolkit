import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTransform, patchTransform } from './orientationManager.js';

const stage = {
  orientations: {
    landscape: { w: 1920, h: 1080 },
    portrait: { w: 1080, h: 1920 }
  }
};

function layer(landscape, portrait = null) {
  return { id: 'L', transforms: { landscape, portrait } };
}

test('landscape resolves to its own transform unchanged', () => {
  const l = layer({ x: 100, y: 200, scaleX: 1, scaleY: 1, rotation: 0 });
  assert.deepEqual(resolveTransform(l, 'landscape', stage), l.transforms.landscape);
});

test('inherited portrait keeps the same pixel offset from centre', () => {
  // 400px right and 100px below the landscape centre (960,540).
  const l = layer({ x: 960 + 400, y: 540 + 100, scaleX: 2, scaleY: 2, rotation: 0.5 });
  const t = resolveTransform(l, 'portrait', stage);
  // Same offset from the portrait centre (540, 960).
  assert.equal(t.x, 540 + 400);
  assert.equal(t.y, 960 + 100);
  // Non-positional fields inherit verbatim.
  assert.equal(t.scaleX, 2);
  assert.equal(t.rotation, 0.5);
});

test('a centred landscape object stays centred in portrait', () => {
  const l = layer({ x: 960, y: 540, scaleX: 1, scaleY: 1, rotation: 0 });
  const t = resolveTransform(l, 'portrait', stage);
  assert.equal(t.x, 540);
  assert.equal(t.y, 960);
});

test('explicit portrait override wins over inheritance', () => {
  const l = layer({ x: 960, y: 540 }, { x: 10, y: 20 });
  assert.deepEqual(resolveTransform(l, 'portrait', stage), { x: 10, y: 20 });
});

test('without stage dims, inheritance falls back to the raw landscape transform', () => {
  const l = layer({ x: 960, y: 540 });
  assert.deepEqual(resolveTransform(l, 'portrait'), l.transforms.landscape);
});

test('child layer inherits portrait VERBATIM (parent-local coords, no centre remap)', () => {
  const child = { id: 'C', parentId: 'P', transforms: { landscape: { x: 0, y: 0, scaleX: 1 }, portrait: null } };
  // A child at (0,0) = parent origin must stay (0,0) in portrait, not shift by
  // the stage-centre delta.
  assert.deepEqual(resolveTransform(child, 'portrait', stage), { x: 0, y: 0, scaleX: 1 });
});

test('first portrait edit on a child copies the raw (not remapped) base', () => {
  const child = { id: 'C', parentId: 'P', transforms: { landscape: { x: 12, y: 34, scaleX: 1 }, portrait: null } };
  const next = patchTransform(child, 'portrait', { scaleX: 2 }, stage);
  assert.equal(next.transforms.portrait.x, 12);
  assert.equal(next.transforms.portrait.y, 34);
  assert.equal(next.transforms.portrait.scaleX, 2);
});

test('first portrait edit copies the centre-remapped base (no jump)', () => {
  const l = layer({ x: 960 + 400, y: 540, scaleX: 1, scaleY: 1, rotation: 0 });
  // Edit only scaleX in portrait; position must retain the remapped inherit.
  const next = patchTransform(l, 'portrait', { scaleX: 3 }, stage);
  assert.equal(next.transforms.portrait.x, 540 + 400);
  assert.equal(next.transforms.portrait.y, 960);
  assert.equal(next.transforms.portrait.scaleX, 3);
  // Landscape untouched.
  assert.equal(next.transforms.landscape.x, 960 + 400);
});
