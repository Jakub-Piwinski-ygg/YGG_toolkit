// Crossfade pose blend tests.
// Run: node --test src/tools/SceneStudio/engine/scenarioBlend.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayerTransform, blendTransforms, buildBlendedScene, bakeCarriedPoses } from './scenarioBlend.js';
import { resolveTransform } from './orientationManager.js';

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

test('blendTransforms lerps opted-in tint, holds outgoing (A) on non-opted channels', () => {
  const A = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 0, g: 0, b: 0 } };
  const B = { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 1, g: 1, b: 1 } };
  const mid = blendTransforms(A, B, 0.5, { tint: true, position: false });
  assert.deepEqual(mid.tint, { r: 0.5, g: 0.5, b: 0.5 }, 'tint blended (black→grey)');
  assert.equal(mid.x, 0, 'position holds the outgoing value (not opted-in) instead of snapping to incoming');
});

test('blendTransforms alpha-only mask changes nothing but alpha, even at f=0', () => {
  const A = { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0.2, alpha: 1, tint: { r: 1, g: 1, b: 1 } };
  const B = { x: 400, y: 300, scaleX: 2, scaleY: 2, rotation: 1.1, alpha: 0, tint: { r: 0, g: 0, b: 0 } };
  const atStart = blendTransforms(A, B, 0, { alpha: true });
  assert.equal(atStart.x, 100, 'position does not jump to the incoming pose the instant the overlap begins');
  assert.equal(atStart.y, 50);
  assert.equal(atStart.scaleX, 1);
  assert.equal(atStart.rotation, 0.2);
  assert.deepEqual(atStart.tint, { r: 1, g: 1, b: 1 });
  assert.equal(atStart.alpha, 1, 'alpha itself blends from A at f=0');
  const mid = blendTransforms(A, B, 0.5, { alpha: true });
  assert.equal(mid.x, 100, 'position still holds outgoing mid-overlap');
  assert.equal(mid.alpha, 0.5, 'only alpha moves');
});

test('resolveLayerTransform uses a carried base override over the authored pose', () => {
  const carried = { x: 400, y: 300, scaleX: 2, scaleY: 2, rotation: 0.5, alpha: 0.25, tint: { r: 1, g: 0, b: 0 } };
  const t = resolveLayerTransform([], layer, 0, 'landscape', carried);
  assert.equal(t.x, 400, 'carried position wins over authored base');
  assert.equal(t.alpha, 0.25);
  // channels still override the carried base
  const t2 = resolveLayerTransform(whiteTrack, layer, 0.5, 'landscape', carried);
  assert.deepEqual(t2.tint, { r: 1, g: 1, b: 1 }, 'keyed tint overrides the carried tint');
  assert.equal(t2.x, 400, 'unkeyed position keeps the carried value');
});

test('bakeCarriedPoses rewrites only carried layers for the given orientation', () => {
  const layers = [layer, { id: 'L2', transforms: { landscape: { x: 1, y: 2 } } }];
  const baked = bakeCarriedPoses(layers, { L1: { x: 999, y: 50 } }, 'landscape');
  assert.equal(baked[0].transforms.landscape.x, 999);
  assert.equal(baked[0].transforms.landscape.alpha, 1, 'unspecified fields keep the authored value');
  assert.equal(baked[1], layers[1], 'uncarried layer passes through by reference');
  assert.equal(bakeCarriedPoses(layers, null, 'landscape'), layers, 'no poses → same array');
});

test('buildBlendedScene blends from the carried pose when a side has no keys', () => {
  const sceneData = { stage: { activeOrientation: 'landscape' }, layers: [layer] };
  const carried = { x: 500, y: 50, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 0, g: 0, b: 0 } };
  // neither timeline keys position; f=0.5 with position opted-in → stays carried
  const scene = buildBlendedScene(sceneData, [], [], 0, [], 0, 0.5, { position: true }, { L1: carried });
  assert.equal(scene.layers[0].transforms.landscape.x, 500, 'carried pose holds through the blend');
});

// A stage with different landscape/portrait dims, and a layer with NO portrait
// override — exercises orientationManager's centre-relative inheritance.
const stage = { orientations: { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1920 } } };
const noPortraitLayer = {
  id: 'L1',
  transforms: {
    landscape: { x: 960, y: 540, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 1, g: 1, b: 1 } },
    portrait: null
  }
};

test('resolveLayerTransform in portrait matches the editor\'s centre-relative inherited pose, not raw landscape', () => {
  const t = resolveLayerTransform([], noPortraitLayer, 0, 'portrait', null, stage);
  const expected = resolveTransform(noPortraitLayer, 'portrait', stage);
  assert.equal(t.x, expected.x);
  assert.equal(t.y, expected.y);
  // stage centre in this fixture coincides with the layer's landscape position,
  // so the remap is a no-op here — assert the actual numeric pose too.
  assert.equal(t.x, 540, 'portrait centre (1080/2) since landscape pos was already centred');
  assert.equal(t.y, 960, 'portrait centre (1920/2)');
});

test('buildBlendedScene alpha-only crossfade in portrait changes nothing but alpha (no baseTransform/editor pose mismatch)', () => {
  const offCenterLayer = {
    id: 'L1',
    transforms: {
      landscape: { x: 1760, y: 980, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 1, g: 1, b: 1 } },
      portrait: null
    }
  };
  const sceneData = { stage: { ...stage, activeOrientation: 'portrait' }, layers: [offCenterLayer] };
  // Neither timeline keys position — only alpha is opted-in for the crossfade.
  const scene = buildBlendedScene(sceneData, [], [], 0, [], 0, 0.5, { alpha: true });
  const expected = resolveTransform(offCenterLayer, 'portrait', stage);
  assert.equal(scene.layers[0].transforms.portrait.x, expected.x, 'portrait x matches the editor\'s inherited pose, unmoved by the blend');
  assert.equal(scene.layers[0].transforms.portrait.y, expected.y);
});

test('buildBlendedScene bakes a mid-crossfade tint into the active orientation pose', () => {
  const sceneData = { stage: { activeOrientation: 'landscape' }, layers: [layer], assets: undefined };
  // out timeline = black (base), in timeline = white; blend at f=0.5 with tint opted-in
  const scene = buildBlendedScene(sceneData, [], [], 0, whiteTrack, 0.5, 0.5, { tint: true });
  const baked = scene.layers[0].transforms.landscape.tint;
  assert.deepEqual(baked, { r: 0.5, g: 0.5, b: 0.5 }, 'black→white halfway = grey');
  assert.equal(scene.flow.tracks.length, 0, 'baked scene has an empty flow');
  assert.equal(scene.__isBakedBlend, true, 'flagged so pixiApp\'s T4 driven-alpha gate exempts it (0 tracks ≠ undriven here)');
});
