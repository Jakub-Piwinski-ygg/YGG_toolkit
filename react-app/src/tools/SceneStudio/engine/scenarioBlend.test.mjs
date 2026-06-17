// Crossfade pose blend tests.
// Run: node --test src/tools/SceneStudio/engine/scenarioBlend.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayerTransform, blendTransforms, buildBlendedScene } from './scenarioBlend.js';

const layer = {
  id: 'L1',
  transforms: {
    landscape: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 0, g: 0, b: 0 } }
  }
};

// A timeline that animates L1's tint to white over 1s.
const whiteTrack = [{
  layerId: 'L1',
  clips: [{
    start: 0, duration: 1, channels: {
      tint: { keys: [{ t: 0, v: { r: 1, g: 1, b: 1 } }, { t: 1, v: { r: 1, g: 1, b: 1 } }] }
    }
  }]
}];

test('resolveLayerTransform falls back to base pose with no channels', () => {
  const t = resolveLayerTransform([], layer, 0, 'landscape');
  assert.deepEqual(t.tint, { r: 0, g: 0, b: 0 });
  assert.equal(t.x, 100);
});

test('resolveLayerTransform applies channel overrides', () => {
  const t = resolveLayerTransform(whiteTrack, layer, 0.5, 'landscape');
  assert.deepEqual(t.tint, { r: 1, g: 1, b: 1 });
});

test('blendTransforms lerps opted-in tint, snaps non-opted', () => {
  const A = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 0, g: 0, b: 0 } };
  const B = { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 1, g: 1, b: 1 } };
  const mid = blendTransforms(A, B, 0.5, { tint: true, position: false });
  assert.deepEqual(mid.tint, { r: 0.5, g: 0.5, b: 0.5 }, 'tint blended (black→grey)');
  assert.equal(mid.x, 10, 'position snapped to incoming (not opted-in)');
});

test('buildBlendedScene bakes a mid-crossfade tint into the active orientation pose', () => {
  const sceneData = { stage: { activeOrientation: 'landscape' }, layers: [layer], assets: undefined };
  // out timeline = black (base), in timeline = white; blend at f=0.5 with tint opted-in
  const scene = buildBlendedScene(sceneData, [], [], 0, whiteTrack, 0.5, 0.5, { tint: true });
  const baked = scene.layers[0].transforms.landscape.tint;
  assert.deepEqual(baked, { r: 0.5, g: 0.5, b: 0.5 }, 'black→white halfway = grey');
  assert.equal(scene.flow.tracks.length, 0, 'baked scene has an empty flow');
});
