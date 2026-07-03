// Direct-mode scenario model tests.
// Run: node --test src/tools/SceneStudio/engine/scenarioModel.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScenario,
  normalizeScenario,
  validateScenarios,
  addScenario,
  removeScenario,
  renameScenario,
  setActiveScenario,
  duplicateScenario,
  activeScenario,
  addTimelineNode,
  addTimelineNodeChained,
  removeNode,
  addOutputPin,
  removeOutputPin,
  connect,
  disconnect,
  disconnectAndPrunePin,
  ensureTrailingPins,
  setActiveEdge,
  moveNode,
  resolveWalk,
  startNode,
  activeEdgeFrom,
  nodeOutputPins,
  nodeInputPins,
  listProjectTimelines,
  resolveTimelineRef,
  timelineDuration,
  setNodeEntry,
  setEdgeTransition,
  nodeEntry,
  edgeTransition,
  normalizeTransition,
  transitionDefaults,
  normalizeEntry,
  START_PIN,
  END_PIN,
  TIMELINE_IN_PIN
} from './scenarioModel.js';

function fakeProject() {
  return {
    scenarios: [],
    activeScenarioId: null,
    scenes: [
      {
        id: 'S1', name: 'Base game',
        data: { timelines: [
          { id: 'TL_a', name: 'Intro', tracks: [{ clips: [{ start: 0, duration: 2 }] }] },
          { id: 'TL_b', name: 'Win', tracks: [{ clips: [{ start: 0, duration: 1 }, { start: 1, duration: 2.5 }] }] }
        ] }
      },
      {
        id: 'S2', name: 'Free spins',
        data: { timelines: [{ id: 'TL_c', name: 'FS Intro', tracks: [] }] }
      }
    ]
  };
}

test('createScenario seeds one start + one end and no edges', () => {
  const sc = createScenario('Test');
  assert.equal(sc.name, 'Test');
  assert.equal(sc.nodes.filter((n) => n.type === 'start').length, 1);
  assert.equal(sc.nodes.filter((n) => n.type === 'end').length, 1);
  assert.equal(sc.edges.length, 0);
  assert.equal(startNode(sc).type, 'start');
});

test('pin helpers reflect node roles', () => {
  const sc = createScenario();
  const s = sc.nodes.find((n) => n.type === 'start');
  const e = sc.nodes.find((n) => n.type === 'end');
  assert.deepEqual(nodeOutputPins(s), [START_PIN]);
  assert.deepEqual(nodeInputPins(s), []);
  assert.deepEqual(nodeOutputPins(e), []);
  assert.deepEqual(nodeInputPins(e), [END_PIN]);
});

test('addTimelineNode binds to {sceneId, timelineId} and gets one output pin', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 320, 160);
  const node = sc.nodes.find((n) => n.type === 'timeline');
  assert.equal(node.sceneId, 'S1');
  assert.equal(node.timelineId, 'TL_a');
  assert.equal(node.outputs.length, 1);
  assert.deepEqual(nodeInputPins(node), [TIMELINE_IN_PIN]);
});

test('connect enforces output→input, no self-loops, one edge per output pin', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 320, 160);
  const start = sc.nodes.find((n) => n.type === 'start');
  const tl = sc.nodes.find((n) => n.type === 'timeline');
  const end = sc.nodes.find((n) => n.type === 'end');

  // start.out → tl.in
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: tl.id, pin: TIMELINE_IN_PIN });
  assert.equal(sc.edges.length, 1);
  assert.equal(sc.edges[0].active, true, 'first edge from a source is active');

  // self-loop rejected
  const before = sc.edges.length;
  sc = connect(sc, { node: tl.id, pin: tl.outputs[0] }, { node: tl.id, pin: TIMELINE_IN_PIN });
  assert.equal(sc.edges.length, before, 'self-loop rejected');

  // input→output (wrong direction) rejected
  sc = connect(sc, { node: end.id, pin: END_PIN }, { node: tl.id, pin: TIMELINE_IN_PIN });
  assert.equal(sc.edges.length, before, 'connecting from an input pin rejected');

  // tl.out → end.in
  sc = connect(sc, { node: tl.id, pin: tl.outputs[0] }, { node: end.id, pin: END_PIN });
  assert.equal(sc.edges.length, 2);

  // re-connecting the same output pin replaces the edge (still 2 total)
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: end.id, pin: END_PIN });
  assert.equal(sc.edges.length, 2, 'one edge per output pin — replaced not added');
  assert.equal(sc.edges.find((e) => e.from.node === start.id).to.node, end.id);
});

test('setActiveEdge enforces per-source exclusivity', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  sc = addTimelineNode(sc, 'S1', 'TL_b', 300, 300);
  const start = sc.nodes.find((n) => n.type === 'start');
  const [a, b] = sc.nodes.filter((n) => n.type === 'timeline');
  // start has one pin but we add a 2nd output to a node to branch — branch from start
  // start only has one output pin, so branch from `a` instead.
  sc = addOutputPin(sc, a.id);
  const a2 = sc.nodes.find((n) => n.id === a.id);
  assert.equal(a2.outputs.length, 2);

  sc = connect(sc, { node: a.id, pin: a2.outputs[0] }, { node: b.id, pin: TIMELINE_IN_PIN });
  sc = connect(sc, { node: a.id, pin: a2.outputs[1] }, { node: sc.nodes.find((n) => n.type === 'end').id, pin: END_PIN });
  const e0 = sc.edges.find((e) => e.from.pin === a2.outputs[0]);
  const e1 = sc.edges.find((e) => e.from.pin === a2.outputs[1]);
  assert.equal(e0.active, true, 'first edge from source active');
  assert.equal(e1.active, false, 'second edge from same source inactive');

  sc = setActiveEdge(sc, e1.id);
  const after0 = sc.edges.find((e) => e.id === e0.id);
  const after1 = sc.edges.find((e) => e.id === e1.id);
  assert.equal(after1.active, true);
  assert.equal(after0.active, false, 'activating a sibling deselects the previous');
});

test('addTimelineNodeChained builds a left-to-right chain from Start', () => {
  let sc = createScenario();
  const start = sc.nodes.find((n) => n.type === 'start');
  sc = addTimelineNodeChained(sc, 'S1', 'TL_a', null, 'n_a');
  sc = addTimelineNodeChained(sc, 'S1', 'TL_b', 'n_a', 'n_b');
  const a = sc.nodes.find((n) => n.id === 'n_a');
  const b = sc.nodes.find((n) => n.id === 'n_b');
  assert.ok(a.x > start.x, 'first node placed right of Start');
  assert.equal(a.y, start.y, 'first node top-aligned with Start');
  assert.ok(b.x > a.x, 'second node chained right of the first');
  assert.equal(b.y, a.y, 'chain stays on one row');
});

test('addTimelineNodeChained falls back to the rightmost node without an anchor', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 500, 40, 'n_far');
  sc = addTimelineNodeChained(sc, 'S1', 'TL_b', null, 'n_next');
  const next = sc.nodes.find((n) => n.id === 'n_next');
  assert.ok(next.x > 500, 'chained after the rightmost timeline node');
  assert.equal(next.y, 40);
});

test('connecting an output pin auto-grows one new free pin below', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  sc = addTimelineNode(sc, 'S1', 'TL_b', 600, 100);
  const a = sc.nodes.find((n) => n.timelineId === 'TL_a');
  const b = sc.nodes.find((n) => n.timelineId === 'TL_b');
  assert.equal(a.outputs.length, 1, 'starts with one free pin');
  // wire a's only (free) pin → b.in
  sc = connect(sc, { node: a.id, pin: a.outputs[0] }, { node: b.id, pin: TIMELINE_IN_PIN });
  const a2 = sc.nodes.find((n) => n.id === a.id);
  assert.equal(a2.outputs.length, 2, 'a new free pin appeared after wiring the free one');
  // the original pin is now used, the new one is free
  const used = new Set(sc.edges.map((e) => `${e.from.node}::${e.from.pin}`));
  assert.equal(used.has(`${a.id}::${a2.outputs[0]}`), true);
  assert.equal(used.has(`${a.id}::${a2.outputs[1]}`), false, 'trailing pin is free');
});

test('disconnectAndPrunePin deletes the edge + its source pin, keeps target intact', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  sc = addTimelineNode(sc, 'S1', 'TL_b', 600, 100);
  sc = addTimelineNode(sc, 'S1', 'TL_c', 600, 300);
  const a = sc.nodes.find((n) => n.timelineId === 'TL_a');
  const b = sc.nodes.find((n) => n.timelineId === 'TL_b');
  const c = sc.nodes.find((n) => n.timelineId === 'TL_c');
  sc = connect(sc, { node: a.id, pin: a.outputs[0] }, { node: b.id, pin: TIMELINE_IN_PIN });
  // a now has [used, free]; wire the free one to c → a has [used, used, free]
  let aNow = sc.nodes.find((n) => n.id === a.id);
  sc = connect(sc, { node: a.id, pin: aNow.outputs[1] }, { node: c.id, pin: TIMELINE_IN_PIN });
  aNow = sc.nodes.find((n) => n.id === a.id);
  assert.equal(aNow.outputs.length, 3, 'two branches + one trailing free pin');
  const cInputEdges = sc.edges.filter((e) => e.to.node === c.id).length;
  assert.equal(cInputEdges, 1);

  // delete the FIRST branch (a→b) by edge id → its source pin is pruned
  const edgeAB = sc.edges.find((e) => e.to.node === b.id);
  sc = disconnectAndPrunePin(sc, edgeAB.id);
  aNow = sc.nodes.find((n) => n.id === a.id);
  assert.equal(sc.edges.some((e) => e.id === edgeAB.id), false, 'edge gone');
  assert.equal(aNow.outputs.includes(edgeAB.from.pin), false, 'source pin pruned');
  assert.equal(aNow.outputs.length, 2, 'one branch left + one trailing free pin');
  // target node c is untouched — its incoming edge still there
  assert.equal(sc.edges.filter((e) => e.to.node === c.id).length, 1, 'target node unaffected');
});

test('ensureTrailingPins is idempotent and only touches timeline nodes', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const once = ensureTrailingPins(sc);
  const twice = ensureTrailingPins(once);
  assert.equal(twice, once, 'no change when a free pin already exists (same reference)');
  assert.deepEqual(once.nodes.find((n) => n.id === start.id), start, 'start node untouched');
});

test('removeOutputPin keeps at least one and drops its edge', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  const a = sc.nodes.find((n) => n.type === 'timeline');
  sc = addOutputPin(sc, a.id);
  const a2 = sc.nodes.find((n) => n.id === a.id);
  const end = sc.nodes.find((n) => n.type === 'end');
  sc = connect(sc, { node: a.id, pin: a2.outputs[1] }, { node: end.id, pin: END_PIN });
  assert.equal(sc.edges.length, 1);
  sc = removeOutputPin(sc, a.id, a2.outputs[1]);
  assert.equal(sc.nodes.find((n) => n.id === a.id).outputs.length, 1);
  assert.equal(sc.edges.length, 0, 'edge on removed pin dropped');
  // cannot remove the last pin
  const last = sc.nodes.find((n) => n.id === a.id).outputs[0];
  sc = removeOutputPin(sc, a.id, last);
  assert.equal(sc.nodes.find((n) => n.id === a.id).outputs.length, 1, 'always keeps ≥1 pin');
});

test('removeNode protects start/end and removes touching edges', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const tl = sc.nodes.find((n) => n.type === 'timeline');
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: tl.id, pin: TIMELINE_IN_PIN });
  const before = sc.nodes.length;
  sc = removeNode(sc, start.id);
  assert.equal(sc.nodes.length, before, 'start protected');
  sc = removeNode(sc, tl.id);
  assert.equal(sc.nodes.find((n) => n.id === tl.id), undefined);
  assert.equal(sc.edges.length, 0, 'edges touching the removed node dropped');
});

test('resolveWalk follows active edges start → timelines → end', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  sc = addTimelineNode(sc, 'S1', 'TL_b', 500, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const [a, b] = sc.nodes.filter((n) => n.type === 'timeline');
  const end = sc.nodes.find((n) => n.type === 'end');

  // no edges yet → not playable
  assert.equal(resolveWalk(sc).ok, false);

  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: a.id, pin: TIMELINE_IN_PIN });
  sc = connect(sc, { node: a.id, pin: a.outputs[0] }, { node: b.id, pin: TIMELINE_IN_PIN });
  sc = connect(sc, { node: b.id, pin: b.outputs[0] }, { node: end.id, pin: END_PIN });

  const walk = resolveWalk(sc);
  assert.equal(walk.ok, true);
  assert.deepEqual(walk.order, [a.id, b.id, end.id]);
  assert.equal(walk.loop, false);
});

test('resolveWalk detects cycles', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  sc = addTimelineNode(sc, 'S1', 'TL_b', 500, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const [a, b] = sc.nodes.filter((n) => n.type === 'timeline');
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: a.id, pin: TIMELINE_IN_PIN });
  sc = connect(sc, { node: a.id, pin: a.outputs[0] }, { node: b.id, pin: TIMELINE_IN_PIN });
  sc = connect(sc, { node: b.id, pin: b.outputs[0] }, { node: a.id, pin: TIMELINE_IN_PIN });
  const walk = resolveWalk(sc);
  assert.equal(walk.loop, true);
  assert.equal(walk.ok, true, 'still reached timelines before the loop');
});

test('project CRUD: add / rename / setActive / remove / duplicate', () => {
  let project = fakeProject();
  let r = addScenario(project, 'First');
  project = r.project;
  assert.equal(project.scenarios.length, 1);
  assert.equal(project.activeScenarioId, r.scenarioId);
  assert.equal(activeScenario(project).name, 'First');

  project = renameScenario(project, r.scenarioId, 'Renamed');
  assert.equal(activeScenario(project).name, 'Renamed');

  const r2 = addScenario(project, 'Second');
  project = r2.project;
  project = setActiveScenario(project, r.scenarioId);
  assert.equal(project.activeScenarioId, r.scenarioId);

  // duplicate deep-copies with fresh ids
  const dup = duplicateScenario(project, r.scenarioId, 'Copy');
  project = dup.project;
  assert.equal(project.scenarios.length, 3);
  assert.notEqual(dup.scenarioId, r.scenarioId);

  project = removeScenario(project, r.scenarioId);
  assert.equal(project.scenarios.length, 2);
  assert.equal(project.scenarios.some((sc) => sc.id === r.scenarioId), false);
});

test('duplicateScenario remaps node + edge + pin ids', () => {
  let project = fakeProject();
  let { project: p, scenarioId } = addScenario(project, 'Src');
  p = { ...p, scenarios: p.scenarios.map((sc) => {
    if (sc.id !== scenarioId) return sc;
    let next = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
    const start = next.nodes.find((n) => n.type === 'start');
    const tl = next.nodes.find((n) => n.type === 'timeline');
    next = connect(next, { node: start.id, pin: START_PIN }, { node: tl.id, pin: TIMELINE_IN_PIN });
    return next;
  }) };
  const dup = duplicateScenario(p, scenarioId, 'Dup');
  const src = dup.project.scenarios.find((sc) => sc.id === scenarioId);
  const copy = dup.project.scenarios.find((sc) => sc.id === dup.scenarioId);
  const srcIds = new Set(src.nodes.map((n) => n.id));
  for (const n of copy.nodes) assert.equal(srcIds.has(n.id), false, 'node ids remapped');
  // copied edge still resolves to copied nodes
  assert.equal(copy.edges.length, 1);
  assert.ok(copy.nodes.some((n) => n.id === copy.edges[0].from.node));
  assert.ok(copy.nodes.some((n) => n.id === copy.edges[0].to.node));
});

test('listProjectTimelines spans all scenes, scoped to origin scene', () => {
  const project = fakeProject();
  const list = listProjectTimelines(project);
  assert.equal(list.length, 3);
  const a = list.find((t) => t.timelineId === 'TL_a');
  assert.equal(a.sceneId, 'S1');
  assert.equal(a.sceneName, 'Base game');
  assert.equal(a.duration, 2);
  const b = list.find((t) => t.timelineId === 'TL_b');
  assert.equal(b.duration, 3.5, 'duration = max(start+duration)');
  assert.equal(b.clipCount, 2);
  const c = list.find((t) => t.timelineId === 'TL_c');
  assert.equal(c.sceneId, 'S2');
});

test('resolveTimelineRef finds a bound timeline or null', () => {
  const project = fakeProject();
  assert.ok(resolveTimelineRef(project, 'S1', 'TL_a'));
  assert.equal(resolveTimelineRef(project, 'S1', 'TL_c'), null, 'TL_c belongs to S2 not S1');
  assert.equal(resolveTimelineRef(project, 'Sx', 'TL_a'), null);
});

test('normalizeScenario repairs missing start/end and prunes bad edges', () => {
  const raw = {
    id: 'SC1', name: 'Raw',
    nodes: [
      { id: 'n_tl', type: 'timeline', sceneId: 'S1', timelineId: 'TL_a', x: 1, y: 2, outputs: ['o1'] }
    ],
    edges: [
      { id: 'e_bad', from: { node: 'ghost', pin: 'out' }, to: { node: 'n_tl', pin: 'in' } },
      { id: 'e_ok', from: { node: 'n_tl', pin: 'o1' }, to: { node: 'n_tl', pin: 'in' } } // self-loop → drop
    ]
  };
  const sc = normalizeScenario(raw);
  assert.equal(sc.nodes.filter((n) => n.type === 'start').length, 1, 'start created');
  assert.equal(sc.nodes.filter((n) => n.type === 'end').length, 1, 'end created');
  assert.equal(sc.edges.length, 0, 'ghost-endpoint + self-loop edges pruned');
});

test('normalizeScenario keeps dangling timeline nodes (rendered as missing, not deleted)', () => {
  const raw = {
    nodes: [
      { type: 'start', x: 0, y: 0 },
      { type: 'end', x: 100, y: 0 },
      { id: 'n_dead', type: 'timeline', sceneId: 'Sx', timelineId: 'TLx', outputs: ['o1'], x: 50, y: 0 }
    ],
    edges: []
  };
  const sc = normalizeScenario(raw);
  assert.ok(sc.nodes.find((n) => n.id === 'n_dead'), 'dangling timeline node preserved');
});

test('normalizeScenario collapses multiple active edges per source to one', () => {
  const raw = {
    nodes: [
      { id: 'n_s', type: 'start', x: 0, y: 0 },
      { id: 'n_a', type: 'timeline', sceneId: 'S1', timelineId: 'TL_a', outputs: ['o1', 'o2'], x: 100, y: 0 },
      { id: 'n_b', type: 'timeline', sceneId: 'S1', timelineId: 'TL_b', outputs: ['o3'], x: 200, y: 0 },
      { id: 'n_e', type: 'end', x: 300, y: 0 }
    ],
    edges: [
      { id: 'e1', from: { node: 'n_a', pin: 'o1' }, to: { node: 'n_b', pin: 'in' }, active: true },
      { id: 'e2', from: { node: 'n_a', pin: 'o2' }, to: { node: 'n_e', pin: 'in' }, active: true }
    ]
  };
  const sc = normalizeScenario(raw);
  const activeFromA = sc.edges.filter((e) => e.from.node === 'n_a' && e.active);
  assert.equal(activeFromA.length, 1, 'only one active edge per source survives');
});

test('validateScenarios maps a list', () => {
  const list = validateScenarios([createScenario('A'), { name: 'B', nodes: [], edges: [] }]);
  assert.equal(list.length, 2);
  assert.equal(list[1].nodes.filter((n) => n.type === 'start').length, 1);
});

test('moveNode + disconnect + activeEdgeFrom helpers', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 300, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const tl = sc.nodes.find((n) => n.type === 'timeline');
  sc = moveNode(sc, tl.id, 999, 888);
  assert.equal(sc.nodes.find((n) => n.id === tl.id).x, 999);
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: tl.id, pin: TIMELINE_IN_PIN });
  assert.ok(activeEdgeFrom(sc, start.id));
  sc = disconnect(sc, sc.edges[0].id);
  assert.equal(sc.edges.length, 0);
  assert.equal(activeEdgeFrom(sc, start.id), null);
});

test('timelineDuration handles empty timelines', () => {
  assert.equal(timelineDuration({ tracks: [] }), 0);
  assert.equal(timelineDuration(null), 0);
});

test('setNodeEntry merges + normalizes per-node entry options', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 200, 100);
  const a = sc.nodes.find((n) => n.type === 'timeline');
  // defaults on read
  assert.deepEqual(nodeEntry(a), { speed: 1, startOffset: 0, waitForClick: false, spinOutcome: 'default' });
  sc = setNodeEntry(sc, a.id, { speed: 2, waitForClick: true });
  const a2 = sc.nodes.find((n) => n.id === a.id);
  assert.equal(nodeEntry(a2).speed, 2);
  assert.equal(nodeEntry(a2).waitForClick, true);
  assert.equal(nodeEntry(a2).startOffset, 0, 'untouched field keeps default');
  // invalid speed clamps back to 1
  sc = setNodeEntry(sc, a.id, { speed: -5 });
  assert.equal(nodeEntry(sc.nodes.find((n) => n.id === a.id)).speed, 1);
});

test('setEdgeTransition merges + normalizes the hand-off', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 200, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const a = sc.nodes.find((n) => n.type === 'timeline');
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: a.id, pin: TIMELINE_IN_PIN });
  const edge = sc.edges[0];
  assert.equal(edgeTransition(edge).mode, 'hold', 'freshly-connected edges default to hold (T1)');
  sc = setEdgeTransition(sc, edge.id, { mode: 'crossfade', mixDuration: 0.5, channels: { rotation: false } });
  const t = edgeTransition(sc.edges[0]);
  assert.equal(t.mode, 'crossfade');
  assert.equal(t.mixDuration, 0.5);
  assert.equal(t.channels.rotation, false);
  assert.equal(t.channels.alpha, true, 'other channels stay on');
});

test('T1: connect() stamps hold on new edges; legacy null-transition edges still read as cut', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 200, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const a = sc.nodes.find((n) => n.type === 'timeline');
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: a.id, pin: TIMELINE_IN_PIN });
  assert.equal(sc.edges[0].transition.mode, 'hold', 'connect() writes an explicit hold transition');
  // A legacy edge (no transition payload — pre-T1 serialized scenario) must
  // keep behaving as a cut: transitionDefaults() itself is untouched.
  assert.equal(transitionDefaults().mode, 'cut', 'the read-fallback for edge.transition == null stays cut');
  assert.equal(edgeTransition({ transition: null }).mode, 'cut', 'a legacy null-transition edge still cuts');
});

test('normalizeTransition coerces channels:true to all-on and bad mode to cut', () => {
  const t = normalizeTransition({ mode: 'nope', channels: true });
  assert.equal(t.mode, 'cut');
  assert.equal(t.channels.position, true);
  assert.equal(normalizeEntry({ speed: 0 }).speed, 1);
  assert.equal(normalizeEntry(null), null);
});

test('transition + entry survive normalizeScenario round-trip', () => {
  let sc = createScenario();
  sc = addTimelineNode(sc, 'S1', 'TL_a', 200, 100);
  const start = sc.nodes.find((n) => n.type === 'start');
  const a = sc.nodes.find((n) => n.type === 'timeline');
  sc = connect(sc, { node: start.id, pin: START_PIN }, { node: a.id, pin: TIMELINE_IN_PIN });
  sc = setNodeEntry(sc, a.id, { speed: 1.5 });
  sc = setEdgeTransition(sc, sc.edges[0].id, { mode: 'hold' });
  const round = normalizeScenario(JSON.parse(JSON.stringify(sc)));
  assert.equal(nodeEntry(round.nodes.find((n) => n.type === 'timeline')).speed, 1.5);
  assert.equal(edgeTransition(round.edges[0]).mode, 'hold');
});
