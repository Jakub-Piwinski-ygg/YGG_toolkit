// Phase 4: per-timeline Unity bake + descriptor shape.
// Run: node --test src/tools/SceneStudio/unity/perTimeline.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelinesOf, sceneForTimeline, bakeTimelineForCanvas } from './exportUnityPackage.js';
import { guidFor } from './guid.js';
import { validateScene, addTimeline, setActiveTimeline, syncFlowToActiveTimeline } from '../engine/sceneModel.js';

// A scene with a layer animated on Timeline 1 (position) and a second, empty
// timeline. Built through validateScene so it carries the v2 timelines shape.
function twoTimelineScene() {
  const v1 = {
    $schema: 'ygg-scene/1',
    version: 1,
    name: 'TL Scene',
    stage: { fps: 60, duration: 2, orientations: { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 2160 } }, activeOrientation: 'landscape' },
    assets: [{ id: 'a1', type: 'png', src: 'art/x.png' }],
    layers: [{ id: 'L1', name: 'x', assetId: 'a1', visible: true, blend: 'normal', transforms: { landscape: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5] }, portrait: null } }],
    flow: {
      tracks: [{ id: 'T1', layerId: 'L1', clips: [{ id: 'C1', start: 0, duration: 2, channels: { position: { keys: [{ t: 0, v: { x: 0, y: 0 }, out: 'linear' }, { t: 2, v: { x: 500, y: 0 }, out: 'linear' }] } } }] }],
      markers: []
    }
  };
  let scene = validateScene(v1);
  scene = addTimeline(scene, 'Timeline 2'); // empty, becomes active
  scene = setActiveTimeline(scene, scene.timelines[0].id); // back to first (live edits restored)
  return syncFlowToActiveTimeline(scene);
}

const flatInfosFor = (scene) => [{
  layer: scene.layers[0],
  isRoot: true,
  path: 'x',
  info: { kind: 'png' }
}];

const bakeOpts = (scene) => ({
  orientation: 'landscape',
  bakeFps: 30,
  ui: true,
  stage: scene.stage.orientations.landscape,
  settings: { pixelsPerUnit: 100, spineGraphicGuid: 'g' },
  warnings: []
});

test('timelinesOf returns the v2 timelines array', () => {
  const scene = twoTimelineScene();
  const tls = timelinesOf(scene);
  assert.equal(tls.length, 2);
  assert.equal(tls[0].name, 'Timeline 1');
  assert.equal(tls[1].name, 'Timeline 2');
});

test('each timeline bakes independently (animated vs empty)', () => {
  const scene = twoTimelineScene();
  const tls = timelinesOf(scene);
  const flat = flatInfosFor(scene);

  const a = bakeTimelineForCanvas(sceneForTimeline(scene, tls[0]), flat, bakeOpts(scene));
  const b = bakeTimelineForCanvas(sceneForTimeline(scene, tls[1]), flat, bakeOpts(scene));

  // Timeline 1 animates anchored position; Timeline 2 is empty.
  assert.ok(a.animTracks.length >= 1, 'timeline 1 has anim tracks');
  assert.ok(a.animTracks[0].floats.some((f) => f.attribute === 'm_AnchoredPosition.x'));
  assert.equal(b.animTracks.length, 0, 'timeline 2 bakes nothing');
});

test('clip GUID seed is per-timeline: stable + distinct (merge vs add)', async () => {
  const scene = twoTimelineScene();
  const tls = timelinesOf(scene);
  const seed = (tlId) => `Pkg:Assets/Pkg/Scenes/S/Canvas_${tlId}_Bake.anim`;

  const g0a = await guidFor(seed(tls[0].id));
  const g0b = await guidFor(seed(tls[0].id));
  const g1 = await guidFor(seed(tls[1].id));

  assert.equal(g0a, g0b, 'same timeline id → same GUID (re-export merges)');
  assert.notEqual(g0a, g1, 'different timeline id → different GUID (new clip added)');

  // Adding a 3rd timeline must not change the first two seeds/GUIDs.
  const withThird = addTimeline(scene, 'Timeline 3');
  const tls3 = timelinesOf(withThird);
  assert.equal(await guidFor(seed(tls3[0].id)), g0a, 'first timeline GUID unchanged');
  assert.equal(await guidFor(seed(tls3[1].id)), g1, 'second timeline GUID unchanged');
});
