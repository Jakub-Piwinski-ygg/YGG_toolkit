// Scene Studio — "Direct" mode scenario model.
//
// A Scenario is a node-graph that sequences the timelines authored in *animate*
// mode into an ordered (optionally branching) flow: a green `start` node hands
// off pin→pin through `timeline` nodes to a red `end` node. See
// react-app/SCENE_STUDIO_DIRECT.md for the design.
//
// PROJECT-LEVEL (open question §13.5 resolved): scenarios live on the PROJECT
// (project.scenarios[]), so a single scenario may sequence timelines authored
// in different scenes. Every `timeline` node is, however, STRONGLY BOUND to the
// scene that authored its timeline — it carries both `sceneId` and `timelineId`
// — so a timeline always travels with its origin scene and a node can never
// point at a timeline that no scene owns.
//
// This module is pure data (no React, no Pixi). Node/edge operations take a
// scenario and return a NEW scenario; project operations take a project and
// return a NEW project. Nothing is mutated in place.

import { uid } from './sceneModel.js';
import { SPIN_OUTCOMES, normalizeSpinnerConfig, classifySymbols } from './spinner/spinnerModel.js';
import { timelineColorKind, winGlowStrength, isBigWinTier } from './objectColors.js';

export { SPIN_OUTCOMES };

export const SCENARIO_NODE_TYPES = ['start', 'end', 'timeline'];

// Transition (edge hand-off) — §9. Per-channel mixing in v1 (Q4 resolved: yes).
export const TRANSITION_MODES = ['cut', 'crossfade', 'hold'];
export const TRANSITION_CHANNELS = ['position', 'scale', 'rotation', 'alpha', 'tint'];

/**
 * Fallback transition for an edge with no `transition` payload at all — a
 * LEGACY read path only (pre-hold-default serialized scenarios). Newly
 * created edges never rely on this: `connect()` stamps an explicit `hold`
 * transition at creation time, so old scenes that depended on the historic
 * cut-by-default behavior keep it, while every new edge starts as a hold.
 */
export function transitionDefaults() {
  return { mode: 'cut', mixDuration: 0.3, channels: allChannels(true) };
}

/** Transition stamped on a freshly-created edge — hold, so pose carry (§ engine/scenarioTimeline.js) applies out of the box. */
function newEdgeTransition() {
  return normalizeTransition({ mode: 'hold', mixDuration: 0.3, channels: allChannels(true) });
}
function allChannels(v) {
  const o = {};
  for (const c of TRANSITION_CHANNELS) o[c] = v;
  return o;
}

/** Default per-node entry options. */
export function entryDefaults() {
  // spinOutcomeReroll (T12): bumped by the node inspector's "re-roll result"
  // action — folds into the outcome board's seed so re-rolling within the
  // same threshold produces a different board (spinnerModel.targetBoardForClip).
  return { speed: 1, startOffset: 0, waitForClick: false, spinOutcome: 'default', spinOutcomeReroll: 0 };
}

/** Normalize a transition payload (or null → defaults-on-read). */
export function normalizeTransition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = TRANSITION_MODES.includes(raw.mode) ? raw.mode : 'cut';
  const md = Number(raw.mixDuration);
  const mixDuration = Number.isFinite(md) && md >= 0 ? md : 0.3;
  // channels: `true`/absent = all; an object maps channelName→bool.
  let channels;
  if (raw.channels === true || raw.channels == null) channels = allChannels(true);
  else if (typeof raw.channels === 'object') {
    channels = {};
    for (const c of TRANSITION_CHANNELS) channels[c] = raw.channels[c] !== false;
  } else channels = allChannels(true);
  return { mode, mixDuration, channels };
}

/** Normalize per-node entry options (or null → defaults-on-read). */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sp = Number(raw.speed);
  const so = Number(raw.startOffset);
  const rr = Number(raw.spinOutcomeReroll);
  return {
    speed: Number.isFinite(sp) && sp > 0 ? sp : 1,
    startOffset: Number.isFinite(so) && so >= 0 ? so : 0,
    waitForClick: raw.waitForClick === true,
    spinOutcome: SPIN_OUTCOMES.includes(raw.spinOutcome) ? raw.spinOutcome : 'default',
    spinOutcomeReroll: Number.isFinite(rr) && rr >= 0 ? rr : 0
  };
}

/** Read a node's entry options merged over defaults. */
export function nodeEntry(node) {
  return { ...entryDefaults(), ...(node?.entry || {}) };
}

/** Read an edge's transition merged over defaults. */
export function edgeTransition(edge) {
  return { ...transitionDefaults(), ...(normalizeTransition(edge?.transition) || {}) };
}

/** Default canvas placement for the auto-created start / end nodes. */
const START_POS = { x: 80, y: 220 };
const END_POS = { x: 900, y: 220 };

// Node geometry (graph units) — single source shared with the graph panel so
// model-side placement and panel-side rendering can't drift.
export const SCENARIO_TL_W = 168;   // timeline node width
export const SCENARIO_SE_W = 90;    // start / end node width
export const SCENARIO_NODE_H = 44;
export const SCENARIO_NODE_GAP_X = 56;

/**
 * @typedef {Object} ScenarioNode
 * @property {string} id
 * @property {'start'|'end'|'timeline'} type
 * @property {number} x
 * @property {number} y
 * @property {string} [sceneId]      timeline node only — origin scene id
 * @property {string} [timelineId]   timeline node only — timeline id within that scene
 * @property {string[]} [outputs]    timeline node only — 1+ output pin ids (branches)
 * @property {boolean} [collapsed]   timeline node only
 * @property {string|null} [label]   timeline node only — optional name override
 */

/**
 * @typedef {Object} ScenarioEdge
 * @property {string} id
 * @property {{node:string, pin:string}} from   an OUTPUT pin (source)
 * @property {{node:string, pin:string}} to     an INPUT pin (target)
 * @property {boolean} active
 * @property {object|null} transition            §9 key-mixing (future)
 */

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} name
 * @property {ScenarioNode[]} nodes
 * @property {ScenarioEdge[]} edges
 * @property {{panX:number, panY:number, zoom:number}} view
 */

/** Pin ids for the fixed pins on start / end / timeline nodes. */
export const START_PIN = 'out';
export const END_PIN = 'in';
export const TIMELINE_IN_PIN = 'in';

// ── Pin helpers ────────────────────────────────────────────────────────────

/** Ids of a node's OUTPUT pins (right side). */
export function nodeOutputPins(node) {
  if (!node) return [];
  if (node.type === 'start') return [START_PIN];
  if (node.type === 'timeline') return Array.isArray(node.outputs) && node.outputs.length ? node.outputs : [];
  return []; // end has no output
}

/** Ids of a node's INPUT pins (left side). */
export function nodeInputPins(node) {
  if (!node) return [];
  if (node.type === 'end') return [END_PIN];
  if (node.type === 'timeline') return [TIMELINE_IN_PIN];
  return []; // start has no input
}

function findNode(sc, nodeId) {
  return (sc?.nodes || []).find((n) => n.id === nodeId) || null;
}

// ── Scenario construction / normalization ────────────────────────────────────

/** A fresh scenario with auto-placed start + end nodes and no timelines. */
export function createScenario(name = 'Scenario 1') {
  return {
    id: uid('SC'),
    name,
    nodes: [
      { id: uid('n'), type: 'start', x: START_POS.x, y: START_POS.y },
      { id: uid('n'), type: 'end', x: END_POS.x, y: END_POS.y }
    ],
    edges: [],
    view: { panX: 0, panY: 0, zoom: 1 }
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize a single node. Returns null when the type is unusable. */
function normalizeNode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = SCENARIO_NODE_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const base = { id: raw.id || uid('n'), type, x: num(raw.x, 0), y: num(raw.y, 0) };
  if (type !== 'timeline') return base;
  // timeline node — bound to its origin scene + timeline.
  let outputs = Array.isArray(raw.outputs) ? raw.outputs.filter((p) => typeof p === 'string' && p) : [];
  if (!outputs.length) outputs = [uid('o')];
  return {
    ...base,
    sceneId: typeof raw.sceneId === 'string' ? raw.sceneId : null,
    timelineId: typeof raw.timelineId === 'string' ? raw.timelineId : null,
    outputs,
    collapsed: raw.collapsed === true,
    label: typeof raw.label === 'string' && raw.label ? raw.label : null,
    entry: normalizeEntry(raw.entry)
  };
}

/**
 * Normalize a scenario: coerce nodes/edges/view, guarantee exactly one start +
 * one end (create the missing one), drop edges whose endpoints don't resolve to
 * a real pin, enforce one-edge-per-output-pin, and enforce per-source active
 * exclusivity. Dangling timeline nodes (sceneId/timelineId no longer present in
 * the project) are KEPT — the graph renders them with a "missing" badge and the
 * walk resolver reports them; normalization never silently deletes user work.
 */
export function normalizeScenario(raw) {
  if (!raw || typeof raw !== 'object') return createScenario();
  let nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map(normalizeNode).filter(Boolean);

  // Guarantee a single start + single end.
  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  if (starts.length === 0) nodes.unshift({ id: uid('n'), type: 'start', x: START_POS.x, y: START_POS.y });
  else if (starts.length > 1) {
    const keep = starts[0];
    nodes = nodes.filter((n) => n.type !== 'start' || n === keep);
  }
  if (ends.length === 0) nodes.push({ id: uid('n'), type: 'end', x: END_POS.x, y: END_POS.y });
  else if (ends.length > 1) {
    const keep = ends[0];
    nodes = nodes.filter((n) => n.type !== 'end' || n === keep);
  }

  const sc = {
    id: raw.id || uid('SC'),
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Scenario',
    nodes,
    edges: [],
    view: {
      panX: num(raw.view?.panX, 0),
      panY: num(raw.view?.panY, 0),
      zoom: Math.max(0.2, Math.min(4, num(raw.view?.zoom, 1)))
    }
  };

  // Validate + dedupe edges against the (now well-formed) node set.
  const usedOutputs = new Set();        // `${node}::${pin}` already claimed by an edge
  const activeBySource = new Set();     // source nodes that already have an active edge
  for (const rawEdge of Array.isArray(raw.edges) ? raw.edges : []) {
    const edge = normalizeEdgeShape(rawEdge);
    if (!edge) continue;
    const fromNode = findNode(sc, edge.from.node);
    const toNode = findNode(sc, edge.to.node);
    if (!fromNode || !toNode) continue;
    if (fromNode.id === toNode.id) continue; // no self-loops
    if (!nodeOutputPins(fromNode).includes(edge.from.pin)) continue;
    if (!nodeInputPins(toNode).includes(edge.to.pin)) continue;
    const outKey = `${edge.from.node}::${edge.from.pin}`;
    if (usedOutputs.has(outKey)) continue; // one edge per output pin
    usedOutputs.add(outKey);
    // Per-source active exclusivity: only the first active edge from a source survives.
    let active = edge.active === true;
    if (active) {
      if (activeBySource.has(edge.from.node)) active = false;
      else activeBySource.add(edge.from.node);
    }
    sc.edges.push({ id: edge.id, from: edge.from, to: edge.to, active, transition: edge.transition ?? null });
  }
  return ensureTrailingPins(sc);
}

function normalizeEdgeShape(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fromNode = raw.from?.node;
  const fromPin = raw.from?.pin;
  const toNode = raw.to?.node;
  const toPin = raw.to?.pin;
  if (!fromNode || !fromPin || !toNode || !toPin) return null;
  return {
    id: raw.id || uid('e'),
    from: { node: String(fromNode), pin: String(fromPin) },
    to: { node: String(toNode), pin: String(toPin) },
    active: raw.active === true,
    transition: normalizeTransition(raw.transition)
  };
}

/** Normalize a list of scenarios (called from validateProject). */
export function validateScenarios(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(normalizeScenario);
}

// ── Project-level CRUD ───────────────────────────────────────────────────────

/** Replace one scenario in the project by id with the result of `updater`. */
export function updateScenario(project, scenarioId, updater) {
  const scenarios = (project.scenarios || []).map((sc) =>
    (sc.id === scenarioId ? updater(sc) : sc));
  return { ...project, scenarios };
}

/** The active scenario object (or the first, or null). */
export function activeScenario(project) {
  const list = project?.scenarios || [];
  return list.find((sc) => sc.id === project.activeScenarioId) || list[0] || null;
}

/** Add a fresh scenario and make it active. Returns { project, scenarioId }. */
export function addScenario(project, name) {
  const sc = createScenario(name || `Scenario ${(project.scenarios?.length || 0) + 1}`);
  return {
    project: { ...project, scenarios: [...(project.scenarios || []), sc], activeScenarioId: sc.id },
    scenarioId: sc.id
  };
}

/** Remove a scenario by id. Active id falls back to the first remaining (or null). */
export function removeScenario(project, scenarioId) {
  const scenarios = (project.scenarios || []).filter((sc) => sc.id !== scenarioId);
  const activeScenarioId = project.activeScenarioId === scenarioId
    ? (scenarios[0]?.id || null)
    : project.activeScenarioId;
  return { ...project, scenarios, activeScenarioId };
}

/** Rename a scenario by id. */
export function renameScenario(project, scenarioId, name) {
  return updateScenario(project, scenarioId, (sc) => ({ ...sc, name: name || sc.name }));
}

/** Switch the active scenario by id. */
export function setActiveScenario(project, scenarioId) {
  if (!(project.scenarios || []).some((sc) => sc.id === scenarioId)) return project;
  return { ...project, activeScenarioId: scenarioId };
}

/** Deep-copy a scenario with fresh ids (nodes/edges/pins remapped). Makes it active. */
export function duplicateScenario(project, scenarioId, name) {
  const src = (project.scenarios || []).find((sc) => sc.id === scenarioId) || activeScenario(project);
  if (!src) return { project, scenarioId: null };
  const nodeIdMap = new Map();
  const pinIdMap = new Map();
  const nodes = src.nodes.map((n) => {
    const id = uid('n');
    nodeIdMap.set(n.id, id);
    if (n.type !== 'timeline') return { ...n, id };
    const outputs = (n.outputs || []).map((p) => {
      const np = uid('o');
      pinIdMap.set(`${n.id}::${p}`, np);
      return np;
    });
    return { ...n, id, outputs };
  });
  const edges = src.edges.map((e) => ({
    id: uid('e'),
    from: { node: nodeIdMap.get(e.from.node), pin: pinIdMap.get(`${e.from.node}::${e.from.pin}`) || e.from.pin },
    to: { node: nodeIdMap.get(e.to.node), pin: e.to.pin },
    active: e.active === true,
    transition: e.transition ?? null
  })).filter((e) => e.from.node && e.to.node);
  const dup = {
    id: uid('SC'),
    name: name || `${src.name} copy`,
    nodes,
    edges,
    view: { ...src.view }
  };
  return {
    project: { ...project, scenarios: [...(project.scenarios || []), dup], activeScenarioId: dup.id },
    scenarioId: dup.id
  };
}

// ── Node / edge operations (scenario in → scenario out) ──────────────────────

/** Add a timeline node bound to {sceneId, timelineId} at canvas (x, y). */
export function addTimelineNode(sc, sceneId, timelineId, x, y, id = uid('n')) {
  const node = {
    id,
    type: 'timeline',
    sceneId,
    timelineId,
    x: num(x, 320),
    y: num(y, 160),
    outputs: [uid('o')],
    collapsed: false,
    label: null
  };
  return { ...sc, nodes: [...sc.nodes, node] };
}

/**
 * Add a timeline node CHAINED to the right of an anchor, so repeated "+ add"
 * clicks build a left-to-right flow: the anchor is `afterNodeId` (the node the
 * caller last spawned), else the rightmost timeline node, else Start. The new
 * node sits one gap to the anchor's right, top-aligned with it (input/output
 * pins share the same y-offset on every node type).
 */
export function addTimelineNodeChained(sc, sceneId, timelineId, afterNodeId = null, id = uid('n')) {
  const start = startNode(sc);
  let anchor = afterNodeId ? findNode(sc, afterNodeId) : null;
  if (!anchor || anchor.type === 'end') {
    const tls = (sc.nodes || []).filter((n) => n.type === 'timeline');
    anchor = tls.length ? tls.reduce((a, b) => (b.x > a.x ? b : a)) : start;
  }
  const w = anchor?.type === 'timeline' ? SCENARIO_TL_W : SCENARIO_SE_W;
  const x = (anchor?.x ?? START_POS.x) + w + SCENARIO_NODE_GAP_X;
  const y = anchor?.y ?? START_POS.y;
  return addTimelineNode(sc, sceneId, timelineId, x, y, id);
}

/** Remove a node (and any edges touching it). start / end are protected. */
export function removeNode(sc, nodeId) {
  const node = findNode(sc, nodeId);
  if (!node || node.type === 'start' || node.type === 'end') return sc;
  return {
    ...sc,
    nodes: sc.nodes.filter((n) => n.id !== nodeId),
    edges: sc.edges.filter((e) => e.from.node !== nodeId && e.to.node !== nodeId)
  };
}

/** Add an output (branch) pin to a timeline node. */
export function addOutputPin(sc, nodeId) {
  return {
    ...sc,
    nodes: sc.nodes.map((n) => (n.id === nodeId && n.type === 'timeline'
      ? { ...n, outputs: [...(n.outputs || []), uid('o')] }
      : n))
  };
}

/** Remove an output pin (and its edge). A timeline node always keeps ≥1 pin. */
export function removeOutputPin(sc, nodeId, pinId) {
  const node = findNode(sc, nodeId);
  if (!node || node.type !== 'timeline') return sc;
  if ((node.outputs || []).length <= 1) return sc; // keep at least one
  return {
    ...sc,
    nodes: sc.nodes.map((n) => (n.id === nodeId
      ? { ...n, outputs: n.outputs.filter((p) => p !== pinId) }
      : n)),
    edges: sc.edges.filter((e) => !(e.from.node === nodeId && e.from.pin === pinId))
  };
}

/**
 * Connect an output pin (`from`) to an input pin (`to`). Enforces:
 *  - from must be an output pin, to must be an input pin
 *  - no self-loops
 *  - exactly one edge per output pin (replaces any existing edge on that pin)
 * The new edge becomes active iff the source node has no other active edge.
 * Returns the scenario unchanged when the connection is invalid.
 */
export function connect(sc, from, to) {
  if (!from || !to) return sc;
  const fromNode = findNode(sc, from.node);
  const toNode = findNode(sc, to.node);
  if (!fromNode || !toNode) return sc;
  if (fromNode.id === toNode.id) return sc;
  if (!nodeOutputPins(fromNode).includes(from.pin)) return sc;
  if (!nodeInputPins(toNode).includes(to.pin)) return sc;
  // Drop any existing edge leaving this exact output pin.
  const edges = sc.edges.filter((e) => !(e.from.node === from.node && e.from.pin === from.pin));
  const sourceHasActive = edges.some((e) => e.from.node === from.node && e.active);
  edges.push({
    id: uid('e'),
    from: { node: from.node, pin: from.pin },
    to: { node: to.node, pin: to.pin },
    active: !sourceHasActive,
    transition: newEdgeTransition()
  });
  // Keep one free trailing pin so there's always a fresh branch to drag from.
  return ensureTrailingPins({ ...sc, edges });
}

/**
 * Guarantee every timeline node has exactly one UNCONNECTED ("free") output pin
 * at the end of its column — so the UI always shows one empty dot to start a new
 * branch from, and a new dot appears the moment the current free one is wired.
 * Only adds pins; never removes (pruning happens in disconnectAndPrunePin).
 */
export function ensureTrailingPins(sc) {
  const used = new Set(sc.edges.map((e) => `${e.from.node}::${e.from.pin}`));
  let changed = false;
  const nodes = sc.nodes.map((n) => {
    if (n.type !== 'timeline') return n;
    const outputs = n.outputs || [];
    const hasFree = outputs.some((p) => !used.has(`${n.id}::${p}`));
    if (!hasFree) { changed = true; return { ...n, outputs: [...outputs, uid('o')] }; }
    return n;
  });
  return changed ? { ...sc, nodes } : sc;
}

/** Remove an edge by id. */
export function disconnect(sc, edgeId) {
  return { ...sc, edges: sc.edges.filter((e) => e.id !== edgeId) };
}

/**
 * Remove an edge AND the source output pin it left from (so deleting a branch
 * compacts the source node's pin column), then re-establish the one trailing
 * free pin. The TARGET node is untouched. The source node always keeps ≥1 pin.
 * Used by right-click-on-edge and Delete-on-selected-edge.
 */
export function disconnectAndPrunePin(sc, edgeId) {
  const edge = sc.edges.find((e) => e.id === edgeId);
  if (!edge) return sc;
  let next = disconnect(sc, edgeId);
  const src = findNode(next, edge.from.node);
  if (src && src.type === 'timeline' && (src.outputs || []).length > 1) {
    next = {
      ...next,
      nodes: next.nodes.map((n) => (n.id === src.id
        ? { ...n, outputs: n.outputs.filter((p) => p !== edge.from.pin) }
        : n))
    };
  }
  return ensureTrailingPins(next);
}

/**
 * Mark an edge active. Per-source exclusivity: every OTHER edge leaving the same
 * source node is cleared, so "select a path → the previous one deselects."
 */
export function setActiveEdge(sc, edgeId) {
  const target = sc.edges.find((e) => e.id === edgeId);
  if (!target) return sc;
  return {
    ...sc,
    edges: sc.edges.map((e) => {
      if (e.from.node !== target.from.node) return e;
      return { ...e, active: e.id === edgeId };
    })
  };
}

/** Move a node to (x, y) in canvas space. */
export function moveNode(sc, nodeId, x, y) {
  return { ...sc, nodes: sc.nodes.map((n) => (n.id === nodeId ? { ...n, x: num(x, n.x), y: num(y, n.y) } : n)) };
}

/** Set a timeline node's display label override (null clears it). */
export function setNodeLabel(sc, nodeId, label) {
  return {
    ...sc,
    nodes: sc.nodes.map((n) => (n.id === nodeId
      ? { ...n, label: typeof label === 'string' && label ? label : null }
      : n))
  };
}

/** Merge a partial entry-options patch onto a timeline node. */
export function setNodeEntry(sc, nodeId, patch) {
  return {
    ...sc,
    nodes: sc.nodes.map((n) => (n.id === nodeId && n.type === 'timeline'
      ? { ...n, entry: normalizeEntry({ ...nodeEntry(n), ...(patch || {}) }) }
      : n))
  };
}

/** Merge a partial transition patch onto an edge (normalized). */
export function setEdgeTransition(sc, edgeId, patch) {
  return {
    ...sc,
    edges: sc.edges.map((e) => (e.id === edgeId
      ? { ...e, transition: normalizeTransition({ ...edgeTransition(e), ...(patch || {}) }) }
      : e))
  };
}

/** Patch the canvas camera (pan / zoom). */
export function setView(sc, view) {
  return { ...sc, view: { ...sc.view, ...view } };
}

// ── Walk resolution ──────────────────────────────────────────────────────────

/** The start node of a scenario (there is exactly one after normalization). */
export function startNode(sc) {
  return (sc?.nodes || []).find((n) => n.type === 'start') || null;
}

/** The single active edge leaving a node, or null. */
export function activeEdgeFrom(sc, nodeId) {
  return (sc?.edges || []).find((e) => e.from.node === nodeId && e.active) || null;
}

/**
 * Resolve the active-edge walk from `start`.
 * @returns {{ order: string[], ok: boolean, reason: string|null, loop: boolean }}
 *   order — node ids in play order (excludes start, includes traversed
 *           timelines and the terminal end if reached);
 *   ok    — true when the walk reaches at least one timeline node;
 *   reason— short human string when not ok (for the validity chip / tooltip);
 *   loop  — true when a cycle was detected and the walk was cut short.
 */
export function resolveWalk(sc) {
  const start = startNode(sc);
  if (!start) return { order: [], ok: false, reason: 'no start node', loop: false };
  const order = [];
  const visited = new Set();
  let timelineCount = 0;
  let loop = false;
  let edge = activeEdgeFrom(sc, start.id);
  if (!edge) return { order: [], ok: false, reason: 'connect Start → a timeline', loop: false };
  let cursorId = edge.to.node;
  while (cursorId) {
    if (visited.has(cursorId)) { loop = true; break; }
    visited.add(cursorId);
    const node = findNode(sc, cursorId);
    if (!node) break;
    order.push(cursorId);
    if (node.type === 'end') break;
    if (node.type === 'timeline') timelineCount++;
    const next = activeEdgeFrom(sc, cursorId);
    if (!next) break;
    cursorId = next.to.node;
  }
  const ok = timelineCount > 0;
  let reason = null;
  if (!ok) reason = 'connect Start → a timeline';
  else if (loop) reason = 'loop detected — add an end';
  return { order, ok, reason, loop };
}

// ── Cross-project timeline catalogue ─────────────────────────────────────────

/**
 * List every timeline across all scenes in the project, scoped to its origin
 * scene. This is the source for the left ScenarioTimelineList and for resolving
 * a node's display name / duration. Each entry is strongly bound to its scene.
 *
 * @returns {Array<{ sceneId, sceneName, timelineId, timelineName, trackCount, clipCount, duration }>}
 */
export function listProjectTimelines(project) {
  const out = [];
  const iconFor = (tl) => {
    const src = tl?.generatedMeta?.source;
    if (src === 'sceneSetup') return '🎬';
    if (src === 'spinner') return '🎰';
    if (src === 'winseq') return '🏆';
    return null;
  };
  for (const s of project?.scenes || []) {
    const data = s.data;
    if (!data) continue;
    for (const tl of data.timelines || []) {
      const icon = iconFor(tl);
      const { kind: colorKind, winTier } = timelineColorKind(tl);
      out.push({
        sceneId: s.id,
        sceneName: s.name || data.name || 'Scene',
        timelineId: tl.id,
        timelineName: tl.name || 'Timeline',
        icon,
        timelineDisplayName: icon ? `${icon} ${tl.name || 'Timeline'}` : (tl.name || 'Timeline'),
        trackCount: (tl.tracks || []).length,
        clipCount: (tl.tracks || []).reduce((sum, t) => sum + (t.clips?.length || 0), 0),
        duration: timelineDuration(tl),
        // Type-colour metadata for the direct-mode UI (list rows + graph nodes).
        colorKind,
        winTier,
        winGlow: colorKind === 'win' ? winGlowStrength(winTier) : 0,
        bigWin: colorKind === 'win' && isBigWinTier(winTier)
      });
    }
  }
  return out;
}

/** Content-end duration of a timeline = max(clip.start + clip.duration). */
export function timelineDuration(tl) {
  let end = 0;
  for (const t of tl?.tracks || []) {
    for (const c of t.clips || []) {
      const e = (Number(c.start) || 0) + (Number(c.duration) || 0);
      if (e > end) end = e;
    }
  }
  return end;
}

/** Look up a timeline entry by {sceneId, timelineId}, or null if missing. */
export function resolveTimelineRef(project, sceneId, timelineId) {
  return listProjectTimelines(project).find(
    (t) => t.sceneId === sceneId && t.timelineId === timelineId
  ) || null;
}

/**
 * Does a {sceneId, timelineId} ref land a spin (any stopSpin clip on a spinner
 * layer), and does that spinner have a name-designated wild symbol? Drives the
 * node inspector's "Spin outcome" selector (hidden without a stop; wildWin
 * disabled without a wild).
 */
export function spinnerStopInfo(project, sceneId, timelineId) {
  const data = (project?.scenes || []).find((s) => s.id === sceneId)?.data;
  const tl = (data?.timelines || []).find((t) => t.id === timelineId);
  if (!data || !tl) return { hasSpinnerStop: false, hasWild: false };
  const assetsById = new Map((project.assets || []).map((a) => [a.id, a]));
  const layersById = new Map((data.layers || []).map((l) => [l.id, l]));
  let hasSpinnerStop = false;
  let hasWild = false;
  for (const track of tl.tracks || []) {
    const layer = layersById.get(track.layerId);
    const asset = layer && assetsById.get(layer.assetId);
    if (asset?.type !== 'spinner') continue;
    if (!(track.clips || []).some((c) => c.action === 'stopSpin')) continue;
    hasSpinnerStop = true;
    const config = normalizeSpinnerConfig(asset.spinner);
    if (config && classifySymbols(config).wildId) hasWild = true;
  }
  return { hasSpinnerStop, hasWild };
}
