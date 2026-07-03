// Scene Studio — Direct-mode flattened scenario timeline.
//
// Flattens the scenario's active-edge walk into a linear, scrubbable timeline:
// a list of segments laid end-to-end (one per played timeline node), with
// crossfade hand-offs modelled as OVERLAP windows where the outgoing and
// incoming segments coexist. This is the source for the scenario scrubber and
// for driving the preview from a single global time `T`.
//
// Pure data — recompute it whenever the scenario or project changes and the
// scrubber/preview follow automatically.

import {
  resolveWalk,
  startNode,
  activeEdgeFrom,
  resolveTimelineRef,
  nodeEntry,
  edgeTransition
} from './scenarioModel.js';
import { normalizeSpinnerConfig } from './spinner/spinnerModel.js';
import { resolveSpinnerTrack, spinnerVisibleBoard, pickSpinnerActionTrack } from './spinner/spinnerEval.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @returns {{ segments: Segment[], total: number, ok: boolean, reason: string|null }}
 * Segment = { nodeId, sceneId, timelineId, label, refDur, startOffset, speed,
 *             playDur, t0, t1, mode, mixDuration, channels, overlapIn, missing }
 */
export function buildScenarioTimeline(scenario, project) {
  if (!scenario) return { segments: [], total: 0, ok: false, reason: 'no scenario' };
  const walk = resolveWalk(scenario);
  const start = startNode(scenario);
  const byId = new Map(scenario.nodes.map((n) => [n.id, n]));
  const segments = [];
  let prevNodeId = start?.id || null;
  let prev = null;

  for (const nid of walk.order) {
    const node = byId.get(nid);
    if (!node) break;
    if (node.type === 'end') break;
    if (node.type !== 'timeline') { prevNodeId = nid; continue; }

    const ref = resolveTimelineRef(project, node.sceneId, node.timelineId);
    const entry = nodeEntry(node);
    const refDur = ref ? Math.max(0.001, ref.duration) : 0.001;
    const startOffset = clamp(entry.startOffset, 0, Math.max(0, refDur - 0.001));
    const speed = entry.speed > 0 ? entry.speed : 1;
    const playDur = Math.max(0.05, (refDur - startOffset) / speed);

    // Hand-off INTO this segment = the active edge leaving the previous walked
    // node. Crossfade overlaps only when the previous node is itself a timeline.
    const inEdge = prevNodeId ? activeEdgeFrom(scenario, prevNodeId) : null;
    const trans = inEdge ? edgeTransition(inEdge) : { mode: 'cut', mixDuration: 0, channels: {} };
    const canOverlap = prev && trans.mode === 'crossfade';
    const overlapIn = canOverlap ? clamp(trans.mixDuration, 0, Math.min(prev.playDur, playDur)) : 0;
    const t0 = prev ? prev.t1 - overlapIn : 0;
    const t1 = t0 + playDur;

    const seg = {
      nodeId: node.id,
      sceneId: node.sceneId,
      timelineId: node.timelineId,
      label: node.label || ref?.timelineName || 'timeline',
      missing: !ref,
      refDur,
      startOffset,
      speed,
      playDur,
      t0,
      t1,
      mode: trans.mode,
      mixDuration: trans.mixDuration,
      channels: trans.channels,
      overlapIn
    };
    segments.push(seg);
    prev = seg;
    prevNodeId = nid;
  }

  return {
    segments,
    total: prev ? prev.t1 : 0,
    ok: walk.ok,
    reason: walk.reason
  };
}

/** Local time within a segment for a global time T. */
function localTimeOf(seg, T) {
  return clamp(seg.startOffset + (T - seg.t0) * seg.speed, 0, seg.refDur);
}

/**
 * Sample the flattened timeline at global time `T`.
 * @returns null | { kind:'single', sceneId, timelineId, localTime, segment }
 *               | { kind:'blend', sceneId, out:{timelineId,localTime},
 *                   in:{timelineId,localTime}, f, channels, segment }
 * In a same-scene crossfade overlap the result is a `blend`; cross-scene
 * overlaps degrade to a cut at the midpoint (`single`). `segment` is always the
 * incoming-most covering segment (drives the scrubber's "current" highlight).
 */
export function sampleScenario(tl, T) {
  const { segments, total } = tl;
  if (!segments.length) return null;
  const time = clamp(T, 0, total);
  const covering = segments.filter((s) => time >= s.t0 && time < s.t1);
  if (!covering.length) {
    // At/after the end → hold the last segment's final frame.
    const last = segments[segments.length - 1];
    return { kind: 'single', sceneId: last.sceneId, timelineId: last.timelineId, localTime: localTimeOf(last, last.t1), segment: last };
  }
  if (covering.length === 1) {
    const s = covering[0];
    return { kind: 'single', sceneId: s.sceneId, timelineId: s.timelineId, localTime: localTimeOf(s, time), segment: s };
  }
  // Overlap: two segments coexist (outgoing tail + incoming head).
  covering.sort((a, b) => a.t0 - b.t0);
  const out = covering[0];
  const inc = covering[covering.length - 1];
  const overlapStart = inc.t0;
  const overlapEnd = out.t1;
  const span = Math.max(1e-4, overlapEnd - overlapStart);
  const f = clamp((time - overlapStart) / span, 0, 1);
  if (out.sceneId === inc.sceneId) {
    return {
      kind: 'blend',
      sceneId: out.sceneId,
      out: { timelineId: out.timelineId, localTime: localTimeOf(out, time) },
      in: { timelineId: inc.timelineId, localTime: localTimeOf(inc, time) },
      f,
      channels: inc.channels,
      segment: inc
    };
  }
  // Cross-scene crossfade can't blend in one viewport — cut at the midpoint.
  const s = f < 0.5 ? out : inc;
  return { kind: 'single', sceneId: s.sceneId, timelineId: s.timelineId, localTime: localTimeOf(s, time), segment: s };
}

/** The segment whose play-window contains `T` (incoming-most), for fx. */
export function segmentAt(tl, T) {
  const s = sampleScenario(tl, T);
  return s ? s.segment : null;
}

/**
 * Per-node spinner carry-in boards for a flattened scenario. A spinner object
 * is stateless — its board is a pure function of one timeline's spin clips — so
 * across a direct-mode timeline hand-off it would snap back to config.initialBoard.
 * To make the reels HOLD the symbols they landed on, we fold across the walk:
 * for each segment we record the board each spinner layer ENTERS on (the board
 * the previous segment ended on), then compute the board it LANDS on at that
 * segment's end and carry it to the next segment.
 *
 * @returns {Map<string, Object<string, board>>} nodeId → { [layerId]: board }
 *          (board = symbolId[reels][rows]; a null entry means "use initialBoard")
 */
export function spinnerCarryByNode(flat, project) {
  const byNode = new Map();
  if (!flat?.segments?.length || !project) return byNode;
  const scenesById = new Map((project.scenes || []).map((s) => [s.id, s]));
  const assetsById = new Map((project.assets || []).map((a) => [a.id, a]));
  const configCache = new Map(); // assetId → normalized spinner config | null
  const configFor = (assetId) => {
    if (configCache.has(assetId)) return configCache.get(assetId);
    const c = normalizeSpinnerConfig(assetsById.get(assetId)?.spinner);
    configCache.set(assetId, c);
    return c;
  };
  // Running landed board, keyed `${sceneId}::${layerId}`.
  const carry = new Map();

  for (const seg of flat.segments) {
    const data = scenesById.get(seg.sceneId)?.data;
    if (!data) continue;
    const spinnerLayers = (data.layers || []).filter(
      (l) => assetsById.get(l.assetId)?.type === 'spinner'
    );
    if (!spinnerLayers.length) continue;

    const tl = (data.timelines || []).find((t) => t.id === seg.timelineId);
    const nodeCarry = {};
    for (const layer of spinnerLayers) {
      const config = configFor(layer.assetId);
      if (!config) continue;
      const ckey = `${seg.sceneId}::${layer.id}`;
      const entryBoard = carry.get(ckey) || null;
      nodeCarry[layer.id] = entryBoard; // null → resolves to config.initialBoard
      const tracks = (tl?.tracks || []).filter((tr) => tr.layerId === layer.id);
      const track = pickSpinnerActionTrack(tracks);
      const resolved = resolveSpinnerTrack(config, track, entryBoard);
      // Board visible at the end of this segment's played window (settled).
      carry.set(ckey, spinnerVisibleBoard(config, resolved, seg.refDur));
    }
    if (Object.keys(nodeCarry).length) byNode.set(seg.nodeId, nodeCarry);
  }
  return byNode;
}
