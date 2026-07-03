// Flattened scenario timeline tests.
// Run: node --test src/tools/SceneStudio/engine/scenarioTimeline.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScenario,
  addTimelineNode,
  connect,
  setNodeEntry,
  setEdgeTransition,
  START_PIN,
  TIMELINE_IN_PIN,
  END_PIN
} from './scenarioModel.js';
import { buildScenarioTimeline, sampleScenario, layerPoseCarryByNode } from './scenarioTimeline.js';

function fakeProject() {
  return {
    scenes: [{
      id: 'S1', name: 'Base',
      data: { timelines: [
        { id: 'TL_a', name: 'A', tracks: [{ clips: [{ start: 0, duration: 1 }] }] },  // 1s
        { id: 'TL_b', name: 'B', tracks: [{ clips: [{ start: 0, duration: 2 }] }] }   // 2s
      ] }
    }, {
      id: 'S2', name: 'Free',
      data: { timelines: [{ id: 'TL_c', name: 'C', tracks: [{ clips: [{ start: 0, duration: 1 }] }] }] }
    }]
  };
}

function chain(specs, project) {
  // specs: [{scene,timeline}] wired start→…→end, all active
  let sc = createScenario('Flow');
  const ids = [];
  for (const s of specs) { sc = addTimelineNode(sc, s.scene, s.timeline, 0, 0); }
  const tlNodes = sc.nodes.filter((n) => n.type === 'timeline');
  const start = sc.nodes.find((n) => n.type === 'start');
  const end = sc.nodes.find((n) => n.type === 'end');
  let prev = start; let prevPin = START_PIN;
  for (const n of tlNodes) {
    sc = connect(sc, { node: prev.id, pin: prevPin }, { node: n.id, pin: TIMELINE_IN_PIN });
    prev = sc.nodes.find((x) => x.id === n.id);
    prevPin = prev.outputs[0];
    ids.push(prev.id);
  }
  sc = connect(sc, { node: prev.id, pin: prevPin }, { node: end.id, pin: END_PIN });
  return { sc, ids };
}

test('linear chain lays segments end-to-end', () => {
  const project = fakeProject();
  const { sc } = chain([{ scene: 'S1', timeline: 'TL_a' }, { scene: 'S1', timeline: 'TL_b' }], project);
  const tl = buildScenarioTimeline(sc, project);
  assert.equal(tl.segments.length, 2);
  assert.equal(tl.segments[0].t0, 0);
  assert.equal(tl.segments[0].t1, 1);
  assert.equal(tl.segments[1].t0, 1);
  assert.equal(tl.segments[1].t1, 3);
  assert.equal(tl.total, 3);
});

test('sampleScenario maps global time to the right timeline + local time', () => {
  const project = fakeProject();
  const { sc } = chain([{ scene: 'S1', timeline: 'TL_a' }, { scene: 'S1', timeline: 'TL_b' }], project);
  const tl = buildScenarioTimeline(sc, project);
  let s = sampleScenario(tl, 0.5);
  assert.equal(s.kind, 'single');
  assert.equal(s.timelineId, 'TL_a');
  assert.ok(Math.abs(s.localTime - 0.5) < 1e-6);
  s = sampleScenario(tl, 2); // 1s into B
  assert.equal(s.timelineId, 'TL_b');
  assert.ok(Math.abs(s.localTime - 1) < 1e-6);
  // clamps past the end to the final frame
  s = sampleScenario(tl, 99);
  assert.equal(s.timelineId, 'TL_b');
});

test('speed shrinks a segment play-window', () => {
  const project = fakeProject();
  let { sc, ids } = chain([{ scene: 'S1', timeline: 'TL_a' }], project);
  sc = setNodeEntry(sc, ids[0], { speed: 2 }); // 1s @2× = 0.5s wall-clock
  const tl = buildScenarioTimeline(sc, project);
  assert.ok(Math.abs(tl.total - 0.5) < 1e-6);
  const s = sampleScenario(tl, 0.25); // halfway in wall-clock → 0.5 local
  assert.ok(Math.abs(s.localTime - 0.5) < 1e-6);
});

test('same-scene crossfade creates an overlap + blend sample', () => {
  const project = fakeProject();
  const { sc, ids } = chain([{ scene: 'S1', timeline: 'TL_a' }, { scene: 'S1', timeline: 'TL_b' }], project);
  // set the edge A→B to crossfade 0.4s
  const edgeAB = sc.edges.find((e) => e.to.node === ids[1]);
  const scx = setEdgeTransition(sc, edgeAB.id, { mode: 'crossfade', mixDuration: 0.4 });
  const tl = buildScenarioTimeline(scx, project);
  // B now starts 0.4s before A ends → total = 1 + 2 - 0.4 = 2.6
  assert.ok(Math.abs(tl.total - 2.6) < 1e-6);
  assert.ok(Math.abs(tl.segments[1].t0 - 0.6) < 1e-6, 'B overlaps into A');
  // sample inside the overlap window (0.6 .. 1.0) → blend
  const s = sampleScenario(tl, 0.8);
  assert.equal(s.kind, 'blend');
  assert.equal(s.sceneId, 'S1');
  assert.equal(s.out.timelineId, 'TL_a');
  assert.equal(s.in.timelineId, 'TL_b');
  assert.ok(s.f > 0 && s.f < 1, 'blend factor mid-overlap');
});

test('cross-scene crossfade degrades to a cut (no blend)', () => {
  const project = fakeProject();
  const { sc, ids } = chain([{ scene: 'S1', timeline: 'TL_a' }, { scene: 'S2', timeline: 'TL_c' }], project);
  const edge = sc.edges.find((e) => e.to.node === ids[1]);
  const scx = setEdgeTransition(sc, edge.id, { mode: 'crossfade', mixDuration: 0.4 });
  const tl = buildScenarioTimeline(scx, project);
  const s = sampleScenario(tl, 0.8); // inside the overlap
  assert.equal(s.kind, 'single', 'cross-scene → cut, never blend');
});

// ── layerPoseCarryByNode ─────────────────────────────────────────────────────

// Scene with two layers; TL_move keys L1's position to (100,50), TL_fade keys
// L1's alpha to 0.5, TL_spin keys L2's rotation to 1.5, TL_none keys nothing.
function poseProject() {
  const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, tint: { r: 1, g: 1, b: 1 } };
  return {
    scenes: [{
      id: 'S1', name: 'Base',
      data: {
        stage: { activeOrientation: 'landscape' },
        layers: [
          { id: 'L1', transforms: { landscape: { ...base } } },
          { id: 'L2', transforms: { landscape: { ...base } } }
        ],
        timelines: [
          { id: 'TL_move', tracks: [{ layerId: 'L1', clips: [{ start: 0, duration: 1, channels: {
            position: { keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 1, v: { x: 100, y: 50 } }] }
          } }] }] },
          { id: 'TL_fade', tracks: [{ layerId: 'L1', clips: [{ start: 0, duration: 1, channels: {
            alpha: { keys: [{ t: 0, v: 1 }, { t: 1, v: 0.5 }] }
          } }] }] },
          { id: 'TL_spin', tracks: [{ layerId: 'L2', clips: [{ start: 0, duration: 1, channels: {
            rotation: { keys: [{ t: 0, v: 0 }, { t: 1, v: 1.5 }] }
          } }] }] },
          { id: 'TL_none', tracks: [{ clips: [{ start: 0, duration: 1 }] }] }
        ]
      }
    }]
  };
}

function withEdgeMode(sc, toNodeId, mode) {
  const edge = sc.edges.find((e) => e.to.node === toNodeId);
  return setEdgeTransition(sc, edge.id, { mode, mixDuration: 0.3 });
}

test('hold hand-off carries the outgoing pose to the next node', () => {
  const project = poseProject();
  let { sc, ids } = chain([{ scene: 'S1', timeline: 'TL_move' }, { scene: 'S1', timeline: 'TL_none' }], project);
  sc = withEdgeMode(sc, ids[1], 'hold');
  const carry = layerPoseCarryByNode(buildScenarioTimeline(sc, project), project);
  const entering = carry.get(ids[1]);
  assert.ok(entering, 'hold segment gets an entering pose map');
  assert.equal(entering.L1.x, 100);
  assert.equal(entering.L1.y, 50);
  assert.equal(entering.L2, undefined, 'unkeyed layer is not carried');
});

test('cut hand-off drops carried poses (snap to authored state)', () => {
  const project = poseProject();
  const { sc, ids } = chain([{ scene: 'S1', timeline: 'TL_move' }, { scene: 'S1', timeline: 'TL_none' }], project);
  // default edge transition is a cut
  const carry = layerPoseCarryByNode(buildScenarioTimeline(sc, project), project);
  assert.equal(carry.get(ids[1]), undefined, 'cut segment enters with no carried poses');
});

test('crossfade hand-off also carries the outgoing pose', () => {
  const project = poseProject();
  let { sc, ids } = chain([{ scene: 'S1', timeline: 'TL_move' }, { scene: 'S1', timeline: 'TL_none' }], project);
  sc = withEdgeMode(sc, ids[1], 'crossfade');
  const carry = layerPoseCarryByNode(buildScenarioTimeline(sc, project), project);
  assert.equal(carry.get(ids[1])?.L1.x, 100);
});

test('carry chains across 3+ segments and merges per-layer poses', () => {
  const project = poseProject();
  let { sc, ids } = chain([
    { scene: 'S1', timeline: 'TL_move' },   // keys L1
    { scene: 'S1', timeline: 'TL_spin' },   // keys L2
    { scene: 'S1', timeline: 'TL_none' }    // keys nothing
  ], project);
  sc = withEdgeMode(sc, ids[1], 'hold');
  sc = withEdgeMode(sc, ids[2], 'hold');
  const carry = layerPoseCarryByNode(buildScenarioTimeline(sc, project), project);
  const entering = carry.get(ids[2]);
  assert.equal(entering.L1.x, 100, 'L1 pose from segment 1 survives segment 2');
  assert.ok(Math.abs(entering.L2.rotation - 1.5) < 1e-6, 'L2 pose from segment 2');
});

test('a later timeline resolves unkeyed channels over the CARRIED base', () => {
  const project = poseProject();
  let { sc, ids } = chain([
    { scene: 'S1', timeline: 'TL_move' },   // keys L1 position → (100,50)
    { scene: 'S1', timeline: 'TL_fade' },   // keys only L1 alpha → 0.5
    { scene: 'S1', timeline: 'TL_none' }
  ], project);
  sc = withEdgeMode(sc, ids[1], 'hold');
  sc = withEdgeMode(sc, ids[2], 'hold');
  const carry = layerPoseCarryByNode(buildScenarioTimeline(sc, project), project);
  const entering = carry.get(ids[2]);
  assert.equal(entering.L1.x, 100, 'position chained through the fade timeline');
  assert.ok(Math.abs(entering.L1.alpha - 0.5) < 1e-6, 'alpha from the fade timeline');
});

test('a cut mid-chain resets the carry for everything after it', () => {
  const project = poseProject();
  let { sc, ids } = chain([
    { scene: 'S1', timeline: 'TL_move' },
    { scene: 'S1', timeline: 'TL_none' },   // cut (default) — drops L1 pose
    { scene: 'S1', timeline: 'TL_none' }
  ], project);
  sc = withEdgeMode(sc, ids[2], 'hold');
  const carry = layerPoseCarryByNode(buildScenarioTimeline(sc, project), project);
  assert.equal(carry.get(ids[2]), undefined, 'nothing to carry after the cut reset');
});

test('empty / unwired scenario has no segments', () => {
  const project = fakeProject();
  let sc = createScenario('Empty');
  sc = addTimelineNode(sc, 'S1', 'TL_a', 0, 0); // not wired
  const tl = buildScenarioTimeline(sc, project);
  assert.equal(tl.segments.length, 0);
  assert.equal(tl.total, 0);
  assert.equal(sampleScenario(tl, 0.5), null);
});
