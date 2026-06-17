// Migration + project-model tests.
// Run: node --test src/tools/SceneStudio/engine/projectModel.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScene,
  activeTimeline,
  setActiveTimeline,
  addTimeline,
  syncFlowToActiveTimeline,
  SCHEMA,
  VERSION
} from './sceneModel.js';
import {
  validateProject,
  projectFromScene,
  deriveWorkingScene,
  foldSceneIntoProject,
  duplicateSceneAsVariant,
  addScene,
  PROJECT_SCHEMA
} from './projectModel.js';

// A legacy v1 scene with an inline `flow` + inline assets.
function legacyV1Scene() {
  return {
    $schema: 'ygg-scene/1',
    version: 1,
    name: 'Legacy',
    stage: { fps: 60, duration: 5, orientations: { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 2160 } }, activeOrientation: 'landscape' },
    assets: [{ id: 'a1', type: 'png', src: 'art/x.png' }],
    layers: [{ id: 'L1', name: 'x', assetId: 'a1', visible: true, blend: 'normal', transforms: { landscape: { x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0 }, portrait: null } }],
    flow: {
      tracks: [{ id: 'T1', layerId: 'L1', clips: [{ id: 'C1', start: 0, duration: 1, channels: { position: { keys: [{ t: 0, v: { x: 0, y: 0 }, out: 'linear' }] } } }] }],
      markers: []
    }
  };
}

test('v1 scene flow migrates into timelines[0]', () => {
  const scene = validateScene(legacyV1Scene());
  assert.equal(scene.$schema, SCHEMA);
  assert.equal(scene.version, VERSION);
  assert.ok(Array.isArray(scene.timelines), 'has timelines[]');
  assert.equal(scene.timelines.length, 1);
  assert.equal(scene.timelines[0].name, 'Timeline 1');
  assert.equal(scene.activeTimelineId, scene.timelines[0].id);
  // The legacy flow's track survived into timelines[0] AND the live flow mirror.
  assert.equal(scene.timelines[0].tracks.length, 1);
  assert.equal(scene.timelines[0].tracks[0].layerId, 'L1');
  assert.equal(scene.flow.tracks.length, 1);
  assert.equal(scene.flow.tracks[0].clips[0].id, 'C1');
});

test('activeTimeline + sync round-trips live flow edits', () => {
  const scene = validateScene(legacyV1Scene());
  // Simulate a live edit on flow (the editor mutates flow, not timelines).
  const edited = { ...scene, flow: { ...scene.flow, tracks: [] } };
  const synced = syncFlowToActiveTimeline(edited);
  assert.equal(activeTimeline(synced).tracks.length, 0, 'flow committed into active timeline');
});

test('add + switch timelines keeps each timeline isolated', () => {
  let scene = validateScene(legacyV1Scene());
  const firstId = scene.activeTimelineId;
  scene = addTimeline(scene, 'Timeline 2');
  assert.equal(scene.timelines.length, 2);
  assert.notEqual(scene.activeTimelineId, firstId);
  assert.equal(scene.flow.tracks.length, 0, 'new timeline starts empty');
  // Switch back to the first — its track is restored.
  scene = setActiveTimeline(scene, firstId);
  assert.equal(scene.activeTimelineId, firstId);
  assert.equal(scene.flow.tracks.length, 1);
});

test('legacy scene loads as a 1-scene project', () => {
  const project = validateProject(legacyV1Scene());
  assert.equal(project.$schema, PROJECT_SCHEMA);
  assert.equal(project.scenes.length, 1);
  // Inline assets folded into the shared pool.
  assert.equal(project.assets.length, 1);
  assert.equal(project.assets[0].id, 'a1');
  const working = deriveWorkingScene(project);
  assert.equal(working.layers.length, 1);
  assert.equal(working.assets.length, 1, 'working scene gets the shared pool');
});

test('project round-trips through validateProject', () => {
  const base = projectFromScene(validateScene(legacyV1Scene()));
  const { project } = addScene(base, 'Scene 2');
  const json = JSON.parse(JSON.stringify({
    $schema: PROJECT_SCHEMA,
    version: 1,
    name: project.name,
    assets: project.assets,
    scenes: project.scenes.map((s) => ({ id: s.id, name: s.name, variantOf: s.variantOf, data: s.data })),
    activeSceneId: project.activeSceneId
  }));
  const reloaded = validateProject(json);
  assert.equal(reloaded.scenes.length, 2);
  assert.equal(reloaded.assets.length, 1);
});

test('project-level scenarios round-trip through validateProject', () => {
  const base = projectFromScene(validateScene(legacyV1Scene()));
  const withScenario = {
    ...base,
    scenarios: [{
      id: 'SC1', name: 'Flow',
      nodes: [
        { id: 'n_s', type: 'start', x: 0, y: 0 },
        { id: 'n_a', type: 'timeline', sceneId: base.activeSceneId, timelineId: 'TLx', outputs: ['o1'], x: 100, y: 0 },
        { id: 'n_e', type: 'end', x: 200, y: 0 }
      ],
      edges: [{ id: 'e1', from: { node: 'n_s', pin: 'out' }, to: { node: 'n_a', pin: 'in' }, active: true }],
      view: { panX: 0, panY: 0, zoom: 1 }
    }],
    activeScenarioId: 'SC1'
  };
  const json = JSON.parse(JSON.stringify({
    $schema: PROJECT_SCHEMA, version: 2, name: withScenario.name,
    assets: withScenario.assets,
    scenes: withScenario.scenes.map((s) => ({ id: s.id, name: s.name, variantOf: s.variantOf, data: s.data })),
    activeSceneId: withScenario.activeSceneId,
    scenarios: withScenario.scenarios,
    activeScenarioId: withScenario.activeScenarioId
  }));
  const reloaded = validateProject(json);
  assert.equal(reloaded.scenarios.length, 1);
  assert.equal(reloaded.activeScenarioId, 'SC1');
  assert.equal(reloaded.scenarios[0].nodes.length, 3);
  assert.equal(reloaded.scenarios[0].edges.length, 1);
  assert.equal(reloaded.scenarios[0].edges[0].active, true);
});

test('absent scenarios default to [] (back-compat with ygg-project/1)', () => {
  const base = projectFromScene(validateScene(legacyV1Scene()));
  const json = JSON.parse(JSON.stringify({
    $schema: 'ygg-project/1', version: 1, name: 'old',
    assets: base.assets,
    scenes: base.scenes.map((s) => ({ id: s.id, name: s.name, data: s.data })),
    activeSceneId: base.activeSceneId
  }));
  const reloaded = validateProject(json);
  assert.deepEqual(reloaded.scenarios, []);
  assert.equal(reloaded.activeScenarioId, null);
});

test('duplicateSceneAsVariant records variantOf + fresh scene id', () => {
  const base = projectFromScene(validateScene(legacyV1Scene()));
  const srcId = base.activeSceneId;
  const { project, sceneId } = duplicateSceneAsVariant(base, srcId, 'Legacy variant');
  assert.notEqual(sceneId, srcId);
  const variant = project.scenes.find((s) => s.id === sceneId);
  assert.equal(variant.variantOf, srcId);
  assert.equal(variant.name, 'Legacy variant');
  assert.equal(project.activeSceneId, sceneId);
  // Deep copy — editing the variant must not mutate the source data.
  assert.notEqual(variant.data, base.scenes[0].data);
});

test('foldSceneIntoProject writes assets back to the shared pool', () => {
  const project = projectFromScene(validateScene(legacyV1Scene()));
  const working = deriveWorkingScene(project);
  const edited = { ...working, assets: [...working.assets, { id: 'a2', type: 'png', src: 'art/y.png' }] };
  const next = foldSceneIntoProject(project, edited);
  assert.equal(next.assets.length, 2);
  // The per-scene data must NOT carry the shared assets.
  assert.equal(next.scenes[0].data.assets, undefined);
});
