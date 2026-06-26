// Scene Studio — `scene.json` shape, defaults, helpers.
//
// The JSDoc types below are the source of truth for the file format.
// Keep them in sync with SCENE_STUDIO.md §4.

import { SPINNER_ACTIONS, normalizeSpinnerClipPayload } from './spinner/spinnerModel.js';
import { normalizeWinSeqClipPayload } from './winseq/winseqModel.js';

/**
 * @typedef {'png' | 'spine' | 'video' | 'pngSequence' | 'spinner' | 'winseq' | 'winnumber'} AssetType
 *
 * A `winseq` asset is a Spine skeleton (win_sequence.json + atlas + texture)
 * carrying a `winseq: WinSeqConfig` payload (see engine/winseq/winseqModel.js)
 * that maps the skeleton's animations to win tiers and derives escalation
 * flows. Win-sequence clips use `clip.winseq = { sequenceId, hangOnLastIdle }`
 * to pick which flow plays (mirrors how a spine clip picks `clip.anim`).
 * @typedef {'landscape' | 'portrait'} Orientation
 * @typedef {'normal' | 'additive' | 'screen' | 'multiply'} BlendMode
 *
 * A `spinner` asset carries a `spinner: SpinnerConfig` payload (see
 * engine/spinner/spinnerModel.js and SPINNER.md §3) and references its
 * symbol art as ordinary `png` assets by id. Spinner timeline clips use
 * `clip.action` + `clip.spinner` instead of `anim`/`channels`.
 */

/**
 * @typedef {Object} StageOrientation
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {Object} Stage
 * @property {number} fps
 * @property {number} duration   seconds
 * @property {{landscape: StageOrientation, portrait: StageOrientation}} orientations
 * @property {Orientation} activeOrientation
 * @property {{type: 'checker'|'color', value?: string}} background
 */

/**
 * @typedef {Object} SceneAsset
 * @property {string} id
 * @property {AssetType} type
 * @property {string} src              relative path (scaffold) OR data: URL (quick)
 * @property {string} [atlas]          spine only — relative path or data url
 * @property {string} [texture]        spine only — relative path or data url
 * @property {string[]} [frames]       pngSequence only
 * @property {number} [fps]            pngSequence only
 * @property {{originalName?:string, size?:number}} [meta]
 */

/**
 * @typedef {Object} Transform
 * @property {number} x
 * @property {number} y
 * @property {number} scaleX
 * @property {number} scaleY
 * @property {number} rotation         radians
 * @property {[number, number]} [anchor]
 */

/**
 * @typedef {Object} SceneLayer
 * @property {string} id
 * @property {string} name
 * @property {string} assetId
 * @property {boolean} visible
 * @property {BlendMode} blend
 * @property {{landscape: Transform, portrait: (Transform|null)}} transforms
 * @property {{skin?:string, defaultAnimation?:string, loop?:boolean}} [spine]
 */

/**
 * @typedef {Object} SceneEffect
 * @property {string} id
 * @property {'blur'|'colorMatrix'|'outline'} type
 * @property {string} targetLayer
 * @property {boolean} enabled
 * @property {Object.<string, any>} params
 */

/**
 * @typedef {Object} Scene
 * @property {string} $schema
 * @property {number} version
 * @property {string} name
 * @property {string|null} projectRoot
 * @property {Stage} stage
 * @property {SceneAsset[]} assets
 * @property {SceneLayer[]} layers
 * @property {SceneEffect[]} effects
 * @property {Object} flow
 * @property {Object} exports
 * @property {Object} meta
 */

export const SCHEMA = 'ygg-scene/2';
export const VERSION = 2;

export const DEFAULT_STAGE = {
  fps: 60,
  duration: 5.0,
  orientations: {
    landscape: { w: 1920, h: 1080 },
    portrait: { w: 1080, h: 2160 }
  },
  activeOrientation: 'landscape',
  background: { type: 'checker' }
};

/** A fresh, empty timeline (the v2 replacement for the single `flow`). */
export function createTimeline(name = 'Timeline 1') {
  return { id: uid('TL'), name, tracks: [], markers: [], nodes: [], edges: [] };
}

/** @returns {Scene} */
export function createEmptyScene(name = 'Untitled scene') {
  const rootCanvasId = uid('canvas');
  const timeline = createTimeline('Timeline 1');
  return {
    $schema: SCHEMA,
    version: VERSION,
    name,
    projectRoot: null,
    stage: structuredClone(DEFAULT_STAGE),
    canvases: [{ id: rootCanvasId, name: 'Canvas', visible: true }],
    activeCanvasId: rootCanvasId,
    assets: [],
    layers: [],
    effects: [],
    // v2 multi-timeline store. `flow` is the LIVE working copy of the
    // active timeline (kept for backward compatibility with every consumer
    // that reads scene.flow.tracks). `timelines[]` is the canonical store;
    // call syncFlowToActiveTimeline() before persistence / timeline switch.
    timelines: [timeline],
    activeTimelineId: timeline.id,
    flow: deriveFlowGraph({ tracks: [], markers: [], nodes: [], edges: [] }),
    exports: {
      heroFrame: { landscape: 0, portrait: 0 },
      pngSequence: { padDigits: 4, renumber: true, destSubdir: 'Preview/' },
      webm: { fps: 30, bitrate: 5_000_000 }
    },
    meta: {
      createdAt: new Date().toISOString(),
      author: '',
      toolkitVersion: '0.0.0'
    }
  };
}

/** @returns {Transform} */
export function defaultTransformAt(stage) {
  const o = stage.orientations[stage.activeOrientation];
  return { x: o.w / 2, y: o.h / 2, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5] };
}

/**
 * Default transforms for BOTH orientations when adding a new layer.
 * If the user is in portrait mode at drop time, portrait gets its own
 * centered transform (not inherited from landscape), so toggling
 * orientations later doesn't move the layer unexpectedly.
 */
export function defaultTransformsForNewLayer(stage) {
  const land = stage.orientations.landscape;
  const port = stage.orientations.portrait;
  const landscape = {
    x: land.w / 2, y: land.h / 2,
    scaleX: 1, scaleY: 1,
    rotation: 0,
    anchor: [0.5, 0.5],
    alpha: 1,
    tint: { r: 1, g: 1, b: 1 }
  };
  const portrait = stage.activeOrientation === 'portrait'
    ? {
        x: port.w / 2, y: port.h / 2,
        scaleX: 1, scaleY: 1,
        rotation: 0,
        anchor: [0.5, 0.5],
        alpha: 1,
        tint: { r: 1, g: 1, b: 1 }
      }
    : null;
  return { landscape, portrait };
}

/** Normalise a transform, accepting the legacy { scale: number } form. */
export function normalizeTransform(t) {
  if (!t || typeof t !== 'object') {
    return {
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      anchor: [0.5, 0.5], alpha: 1, tint: { r: 1, g: 1, b: 1 }
    };
  }
  const out = { ...t };
  if (out.scaleX == null) out.scaleX = (typeof t.scale === 'number') ? t.scale : 1;
  if (out.scaleY == null) out.scaleY = (typeof t.scale === 'number') ? t.scale : 1;
  delete out.scale;
  if (out.rotation == null) out.rotation = 0;
  if (!Array.isArray(out.anchor)) out.anchor = [0.5, 0.5];
  // Alpha + tint default for layers that predate Round 4.
  if (typeof out.alpha !== 'number' || !Number.isFinite(out.alpha)) out.alpha = 1;
  if (!out.tint || typeof out.tint !== 'object') {
    out.tint = { r: 1, g: 1, b: 1 };
  } else {
    out.tint = {
      r: Number.isFinite(Number(out.tint.r)) ? Number(out.tint.r) : 1,
      g: Number.isFinite(Number(out.tint.g)) ? Number(out.tint.g) : 1,
      b: Number.isFinite(Number(out.tint.b)) ? Number(out.tint.b) : 1
    };
  }
  return out;
}

let _idSeq = 0;
const _idPrefix = Math.random().toString(36).slice(2, 6);
export function uid(prefix = 'id') {
  return `${prefix}_${_idPrefix}_${(_idSeq++).toString(36)}`;
}

/**
 * Validate a parsed JSON object as a Scene. Returns the scene with any
 * missing-but-defaultable fields filled in. Throws on hard violations.
 *
 * Intentionally permissive about extra fields so future formats opening
 * older files don't crash.
 *
 * @param {any} parsed
 * @returns {Scene}
 */
export function validateScene(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Scene file is not a JSON object.');
  }
  if (parsed.$schema && !String(parsed.$schema).startsWith('ygg-scene/')) {
    throw new Error(`Unknown schema: ${parsed.$schema}`);
  }
  const scene = createEmptyScene(parsed.name || 'Untitled scene');
  scene.projectRoot = parsed.projectRoot ?? null;
  scene.stage = { ...scene.stage, ...(parsed.stage || {}) };
  scene.stage.orientations = {
    landscape: { ...DEFAULT_STAGE.orientations.landscape, ...(parsed.stage?.orientations?.landscape || {}) },
    portrait: { ...DEFAULT_STAGE.orientations.portrait, ...(parsed.stage?.orientations?.portrait || {}) }
  };
  // Canvases: keep parsed ones or fall back to the auto-created default.
  if (Array.isArray(parsed.canvases) && parsed.canvases.length) {
    scene.canvases = parsed.canvases.map((c) => ({
      id: c.id || uid('canvas'),
      name: c.name || 'Canvas',
      visible: c.visible !== false
    }));
    scene.activeCanvasId = parsed.activeCanvasId || scene.canvases[0].id;
  }
  const defaultCanvasId = scene.canvases[0].id;
  scene.assets = Array.isArray(parsed.assets) ? parsed.assets : [];
  scene.layers = Array.isArray(parsed.layers)
    ? parsed.layers.map((l) => normalizeLayer(l, defaultCanvasId)).filter(Boolean)
    : [];
  scene.effects = Array.isArray(parsed.effects) ? parsed.effects : [];
  // Timelines (v2). Prefer parsed.timelines; otherwise migrate the legacy
  // single `flow` into "Timeline 1". Tolerates a v1 file with no timelines.
  let timelines;
  if (Array.isArray(parsed.timelines) && parsed.timelines.length) {
    timelines = parsed.timelines.map(normalizeTimeline).filter(Boolean);
  } else {
    const flow = parsed.flow && typeof parsed.flow === 'object' ? parsed.flow : { tracks: [], markers: [] };
    timelines = [normalizeTimeline({ id: uid('TL'), name: 'Timeline 1', tracks: flow.tracks, markers: flow.markers })];
  }
  if (!timelines.length) timelines = [createTimeline('Timeline 1')];
  const activeTimelineId = parsed.activeTimelineId && timelines.some((t) => t.id === parsed.activeTimelineId)
    ? parsed.activeTimelineId
    : timelines[0].id;
  scene.timelines = timelines;
  scene.activeTimelineId = activeTimelineId;
  const active = timelines.find((t) => t.id === activeTimelineId) || timelines[0];
  scene.flow = deriveFlowGraph({ tracks: active.tracks, markers: active.markers, nodes: [], edges: [] });
  scene.exports = { ...scene.exports, ...(parsed.exports || {}) };
  scene.meta = { ...scene.meta, ...(parsed.meta || {}) };
  return scene;
}

/** Normalize one timeline entry (same internal shape as the legacy flow). */
export function normalizeTimeline(tl) {
  if (!tl || typeof tl !== 'object') return null;
  const tracks = Array.isArray(tl.tracks) ? tl.tracks.map(normalizeTrack).filter(Boolean) : [];
  const markers = Array.isArray(tl.markers) ? tl.markers : [];
  const derived = deriveFlowGraph({ tracks, markers, nodes: [], edges: [] });
  return {
    id: tl.id || uid('TL'),
    name: typeof tl.name === 'string' && tl.name ? tl.name : 'Timeline',
    tracks: derived.tracks,
    markers: derived.markers,
    nodes: derived.nodes,
    edges: derived.edges
  };
}

/** The currently-active timeline object (canonical store, may be stale vs flow). */
export function activeTimeline(scene) {
  const list = scene?.timelines || [];
  return list.find((t) => t.id === scene.activeTimelineId) || list[0] || null;
}

/**
 * Write the live `flow` back into the active timeline entry. Call this before
 * saving, switching timelines, or exporting so `timelines[]` is current.
 */
export function syncFlowToActiveTimeline(scene) {
  if (!scene?.timelines?.length) return scene;
  const flow = scene.flow || { tracks: [], markers: [] };
  const activeId = scene.activeTimelineId || scene.timelines[0].id;
  const timelines = scene.timelines.map((t) => (t.id === activeId
    ? { ...t, tracks: flow.tracks || [], markers: flow.markers || [], nodes: flow.nodes || [], edges: flow.edges || [] }
    : t));
  return { ...scene, timelines };
}

/** Switch the active timeline: commit current flow, load the target into flow. */
export function setActiveTimeline(scene, timelineId) {
  const synced = syncFlowToActiveTimeline(scene);
  const target = (synced.timelines || []).find((t) => t.id === timelineId);
  if (!target) return synced;
  return {
    ...synced,
    activeTimelineId: timelineId,
    flow: deriveFlowGraph({ tracks: target.tracks, markers: target.markers, nodes: [], edges: [] })
  };
}

/** Add a new empty timeline and make it active. */
export function addTimeline(scene, name) {
  const synced = syncFlowToActiveTimeline(scene);
  const tl = createTimeline(name || `Timeline ${(synced.timelines?.length || 0) + 1}`);
  return {
    ...synced,
    timelines: [...(synced.timelines || []), tl],
    activeTimelineId: tl.id,
    flow: deriveFlowGraph({ tracks: [], markers: [], nodes: [], edges: [] })
  };
}

/** Rename a timeline by id. */
export function renameTimeline(scene, timelineId, name) {
  return {
    ...scene,
    timelines: (scene.timelines || []).map((t) => (t.id === timelineId ? { ...t, name: name || t.name } : t))
  };
}

/** Remove a timeline. Never leaves a scene with zero timelines. */
export function removeTimeline(scene, timelineId) {
  const synced = syncFlowToActiveTimeline(scene);
  let timelines = (synced.timelines || []).filter((t) => t.id !== timelineId);
  if (!timelines.length) timelines = [createTimeline('Timeline 1')];
  const activeId = synced.activeTimelineId === timelineId ? timelines[0].id : synced.activeTimelineId;
  const active = timelines.find((t) => t.id === activeId) || timelines[0];
  return {
    ...synced,
    timelines,
    activeTimelineId: activeId,
    flow: deriveFlowGraph({ tracks: active.tracks, markers: active.markers, nodes: [], edges: [] })
  };
}

function normalizeLayer(layer, defaultCanvasId) {
  if (!layer || typeof layer !== 'object') return null;
  return {
    id: layer.id || uid('L'),
    name: layer.name || 'unnamed',
    canvasId: layer.canvasId || defaultCanvasId,
    parentId: layer.parentId ?? null,
    assetId: layer.assetId,
    visible: layer.visible !== false,
    // Locked layers (e.g. a win-number child of a win-sequence) can't be
    // reparented or deleted on their own — they only move/go with their parent.
    locked: layer.locked === true,
    blend: layer.blend || 'normal',
    transforms: {
      landscape: normalizeTransform(layer.transforms?.landscape),
      portrait: layer.transforms?.portrait == null ? null : normalizeTransform(layer.transforms.portrait)
    },
    spine: layer.spine || undefined,
    video: layer.video || undefined
  };
}

/** Mode of storage for an asset src field. */
export function assetStorageMode(src) {
  if (typeof src !== 'string') return 'unknown';
  if (src.startsWith('data:')) return 'embedded';
  return 'relative';
}

/**
 * Build a tree of layers grouped by their canvas + parent relationships.
 * Returns: Map<canvasId, Array<treeNode>>, where each treeNode has
 *   { layer, depth, children: treeNode[] }
 *
 * Array order within siblings = scene.layers order (top of array = first
 * drawn = behind in Unity-canvas-style draw order).
 *
 * Orphans (layers whose parentId points to a missing layer) are promoted
 * to root of their canvas to keep the tree well-formed.
 */
export function buildLayerTree(scene) {
  const byParent = new Map(); // key = parentId or `__canvas:${canvasId}`
  const allIds = new Set(scene.layers.map((l) => l.id));
  for (const l of scene.layers) {
    const key = l.parentId && allIds.has(l.parentId)
      ? l.parentId
      : `__canvas:${l.canvasId}`;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(l);
  }

  const result = new Map();
  for (const c of scene.canvases || []) {
    const walk = (parentKey, depth) => {
      const arr = byParent.get(parentKey) || [];
      return arr.map((layer) => ({
        layer,
        depth,
        children: walk(layer.id, depth + 1)
      }));
    };
    result.set(c.id, walk(`__canvas:${c.id}`, 0));
  }
  return result;
}

/**
 * Flatten a layer tree to its display order (depth-first, sibling array
 * order). Used for both rendering loops and panel display.
 */
export function flattenTree(treeNodes) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(treeNodes);
  return out;
}

/**
 * Return the list of ancestors (parentId chain) for a given layer id.
 * Used to prevent making a layer a descendant of itself.
 */
export function getAncestors(scene, layerId) {
  const out = [];
  let cursor = scene.layers.find((l) => l.id === layerId);
  while (cursor?.parentId) {
    const parent = scene.layers.find((l) => l.id === cursor.parentId);
    if (!parent) break;
    out.push(parent.id);
    cursor = parent;
  }
  return out;
}

/**
 * Compute the world (= top-level) position of a layer by walking its
 * parent chain and summing local positions. Approximate — only honours
 * translation. Rotation and non-uniform scale of intermediate parents
 * are ignored, which is fine for the typical Scene Studio use case where
 * group parents are at identity.
 *
 * Returns { x, y } in world (stage / viewport-local) space.
 */
export function getWorldPosition(scene, layerId, orientation) {
  const layer = scene.layers.find((l) => l.id === layerId);
  if (!layer) return { x: 0, y: 0 };
  const t = orientation === 'portrait'
    ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
    : layer.transforms?.landscape;
  if (!layer.parentId) return { x: t?.x ?? 0, y: t?.y ?? 0 };
  const parentWorld = getWorldPosition(scene, layer.parentId, orientation);
  return { x: parentWorld.x + (t?.x ?? 0), y: parentWorld.y + (t?.y ?? 0) };
}

/** True if `descendantId` is the same as or a descendant of `ancestorId`. */
export function isDescendantOf(scene, ancestorId, descendantId) {
  if (ancestorId === descendantId) return true;
  const queue = scene.layers.filter((l) => l.parentId === ancestorId);
  while (queue.length) {
    const next = queue.pop();
    if (next.id === descendantId) return true;
    for (const child of scene.layers.filter((l) => l.parentId === next.id)) queue.push(child);
  }
  return false;
}

/**
 * Properties that can be tweened on a PNG layer by a clip's `tween` payload.
 * Order matters only for diagnostics — interpreter applies last-wins per
 * property when multiple tracks tween the same key.
 */
export const TWEEN_PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];

export const CURVE_PRESETS = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'smoothstep',
  'backIn',
  'backOut',
  'overshoot',
  'stepStart',
  'stepEnd'
];

function normalizeTweenEndpoint(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of TWEEN_PROPS) {
    if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k];
  }
  return Object.keys(out).length ? out : null;
}

function normalizeCustomCurvePoints(points) {
  if (!Array.isArray(points)) return null;
  const out = [];
  for (const p of points) {
    if (!p || typeof p !== 'object') continue;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x: Math.max(0, Math.min(1, x)), y });
  }
  if (out.length < 2) return null;
  out.sort((a, b) => a.x - b.x);
  const dedup = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = dedup[dedup.length - 1];
    if (Math.abs(out[i].x - prev.x) < 0.0001) dedup[dedup.length - 1] = out[i];
    else dedup.push(out[i]);
  }
  if (dedup[0].x > 0) dedup.unshift({ x: 0, y: dedup[0].y });
  if (dedup[dedup.length - 1].x < 1) dedup.push({ x: 1, y: dedup[dedup.length - 1].y });
  dedup[0] = { ...dedup[0], x: 0 };
  dedup[dedup.length - 1] = { ...dedup[dedup.length - 1], x: 1 };
  return dedup;
}

/** Normalize curve representation: preset string or custom points object. */
export function normalizeCurve(curve, fallback = 'linear') {
  if (typeof curve === 'string') {
    return CURVE_PRESETS.includes(curve) ? curve : fallback;
  }
  if (curve && typeof curve === 'object') {
    const type = String(curve.type || '').toLowerCase();
    if (type === 'custom') {
      const points = normalizeCustomCurvePoints(curve.points);
      if (points) return { type: 'custom', points };
    }
  }
  return fallback;
}

/**
 * Normalize a clip.tween payload. A tween is dropped (returns null) when
 * neither endpoint provides any animated property — that way a clip with
 * a defaulted empty tween doesn't override the base pose silently.
 */
export function normalizeTween(t) {
  if (!t || typeof t !== 'object') return null;
  const from = normalizeTweenEndpoint(t.from);
  const to = normalizeTweenEndpoint(t.to);
  if (!from && !to) return null;
  const curves = {};
  if (t.curves && typeof t.curves === 'object') {
    for (const k of TWEEN_PROPS) {
      if (t.curves[k] != null) curves[k] = normalizeCurve(t.curves[k], 'linear');
    }
  }
  return { from: from || {}, to: to || {}, curves };
}

/**
 * Logical channel layouts mirror `engine/animation/keyframes.js`:
 *   - `position` → vec2 { x, y }
 *   - `scale`    → vec2 { x, y }
 *   - `rotation` → scalar
 */
const CHANNEL_LAYOUTS = {
  position: 'vec2',
  scale:    'vec2',
  rotation: 'scalar',
  alpha:    'scalar',
  tint:     'rgb'
};

function normalizeKeyCurve(out, fallbackOut = 'linear') {
  if (typeof out === 'string') {
    return CURVE_PRESETS.includes(out) ? out : fallbackOut;
  }
  if (out && typeof out === 'object') {
    if (Array.isArray(out.bezier) && out.bezier.length === 4 && out.bezier.every((n) => Number.isFinite(Number(n)))) {
      return { bezier: out.bezier.map(Number) };
    }
    if (String(out.type || '').toLowerCase() === 'custom') {
      return normalizeCurve(out, fallbackOut);
    }
  }
  return fallbackOut;
}

/**
 * Normalize one keyframe-channel key. `layout` is `'vec2'` or `'scalar'`.
 * Returns null when t or v can't be parsed.
 */
const TANGENT_MODES = ['auto', 'flat', 'linear', 'free', 'broken'];

/** Validate a tangent slope to the channel layout's value shape, or null. */
function normalizeTangentSlope(s, layout) {
  if (s == null) return null;
  if (layout === 'vec2') {
    if (!s || typeof s !== 'object') return null;
    const x = Number(s.x);
    const y = Number(s.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }
  if (layout === 'rgb') {
    if (!s || typeof s !== 'object') return null;
    const r = Number(s.r);
    const g = Number(s.g);
    const b = Number(s.b);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return { r, g, b };
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeChannelKey(k, layout = 'scalar', fallbackOut = 'linear') {
  if (!k || typeof k !== 'object') return null;
  const t = Number(k.t);
  if (!Number.isFinite(t)) return null;
  let v;
  if (layout === 'vec2') {
    if (!k.v || typeof k.v !== 'object') return null;
    const vx = Number(k.v.x);
    const vy = Number(k.v.y);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
    v = { x: vx, y: vy };
  } else if (layout === 'rgb') {
    if (!k.v || typeof k.v !== 'object') return null;
    const vr = Number(k.v.r);
    const vg = Number(k.v.g);
    const vb = Number(k.v.b);
    if (!Number.isFinite(vr) || !Number.isFinite(vg) || !Number.isFinite(vb)) return null;
    v = { r: vr, g: vg, b: vb };
  } else {
    const num = Number(k.v);
    if (!Number.isFinite(num)) return null;
    v = num;
  }
  const out = { t: Math.max(0, t), v, out: normalizeKeyCurve(k.out, fallbackOut) };
  // Per-key tangents (P4) — preserved alongside legacy `out` for backward
  // compat. Only kept when the mode is recognised. 'free'/'broken' carry
  // explicit slopes; 'auto'/'flat'/'linear' compute them on the fly.
  if (typeof k.tm === 'string' && TANGENT_MODES.includes(k.tm)) {
    out.tm = k.tm;
    if (k.tm === 'free' || k.tm === 'broken') {
      const to = normalizeTangentSlope(k.to, layout);
      if (to != null) out.to = to;
      if (k.tm === 'broken') {
        const ti = normalizeTangentSlope(k.ti, layout);
        if (ti != null) out.ti = ti;
      }
    }
  }
  return out;
}

/** Normalize a scalar key list — sorted, deduped on near-identical `t`. */
function normalizeScalarKeys(raw) {
  if (!Array.isArray(raw)) return [];
  const keys = [];
  for (const k of raw) {
    const norm = normalizeChannelKey(k, 'scalar');
    if (norm) keys.push(norm);
  }
  keys.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const k of keys) {
    if (deduped.length && Math.abs(deduped[deduped.length - 1].t - k.t) < 1e-4) {
      deduped[deduped.length - 1] = k;
    } else {
      deduped.push(k);
    }
  }
  return deduped;
}

/**
 * Normalize a channel. Two shapes accepted:
 *   - Linked (default): `{ keys: [{ t, v, out }] }` — sorted, deduped.
 *   - Split: `{ split: true, perComp: { x: {keys}, y: {keys}, ... } }` —
 *     each per-comp key list is a scalar list independently sorted.
 */
export function normalizeChannel(ch, layout = 'scalar') {
  if (!ch || typeof ch !== 'object') return null;
  // Split shape — only meaningful for vec2 / rgb layouts.
  if (ch.split && ch.perComp && typeof ch.perComp === 'object'
      && (layout === 'vec2' || layout === 'rgb')) {
    const comps = layout === 'vec2' ? ['x', 'y'] : ['r', 'g', 'b'];
    const perComp = {};
    for (const c of comps) {
      const keys = normalizeScalarKeys(ch.perComp[c]?.keys);
      if (keys.length) perComp[c] = { keys };
    }
    if (!Object.keys(perComp).length) return null;
    return { split: true, perComp };
  }
  // Linked shape.
  const raw = Array.isArray(ch.keys) ? ch.keys : [];
  const keys = [];
  for (const k of raw) {
    const norm = normalizeChannelKey(k, layout);
    if (norm) keys.push(norm);
  }
  keys.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const k of keys) {
    if (deduped.length && Math.abs(deduped[deduped.length - 1].t - k.t) < 1e-4) {
      deduped[deduped.length - 1] = k;
    } else {
      deduped.push(k);
    }
  }
  if (!deduped.length) return null;
  return { keys: deduped };
}

const PATH_POINT_MODES = ['auto', 'linear', 'broken', 'free'];

/** Normalize one spatial path control point. */
function normalizePathPoint(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tm = typeof p.tm === 'string' && PATH_POINT_MODES.includes(p.tm) ? p.tm : 'auto';
  const out = { x, y, tm };
  if (tm === 'broken' || tm === 'free') {
    const to = normalizeTangentSlope(p.to, 'vec2');
    if (to) out.to = to;
    if (tm === 'broken') {
      const ti = normalizeTangentSlope(p.ti, 'vec2');
      if (ti) out.ti = ti;
    }
  }
  return out;
}

/**
 * Normalize a path-mode position channel (P5):
 *   { mode:'path', path:{ points:[{x,y,tm,ti,to}], progress:{keys}, bakeFps } }
 * Returns null when fewer than 2 valid points (not a usable path).
 */
function normalizePathChannel(ch) {
  if (!ch || ch.mode !== 'path' || !ch.path || typeof ch.path !== 'object') return null;
  const points = (Array.isArray(ch.path.points) ? ch.path.points : [])
    .map(normalizePathPoint)
    .filter(Boolean);
  if (points.length < 2) return null;
  let progress = normalizeChannel(ch.path.progress, 'scalar');
  if (progress?.keys?.length) {
    progress = { keys: progress.keys.map((k) => ({ ...k, v: Math.max(0, Math.min(1, k.v)) })) };
  } else {
    progress = { keys: [{ t: 0, v: 0, out: 'linear' }, { t: 1, v: 1, out: 'linear' }] };
  }
  const fps = Number(ch.path.bakeFps);
  return {
    mode: 'path',
    path: { points, progress, bakeFps: Number.isFinite(fps) && fps > 0 ? fps : 30 }
  };
}

/**
 * Normalize the per-clip `channels` map. Accepts both the new vec2 shape
 * (channels.position / channels.scale / channels.rotation) and the legacy
 * per-prop shape (channels.x / channels.y / channels.scaleX / …) — the
 * legacy shape is folded into the new one on load.
 */
export function normalizeChannels(channels) {
  if (!channels || typeof channels !== 'object') return null;
  const out = {};

  // Path-mode position (P5) takes precedence over key-based / legacy shapes.
  if (channels.position?.mode === 'path') {
    const pth = normalizePathChannel(channels.position);
    if (pth) out.position = pth;
  }

  // New vec2 shape: pass through with layout-aware key validation. Skip a
  // channel already claimed above (path-mode position carries redundant baked
  // `keys` for the engine that must NOT override its path source on reload).
  for (const name of Object.keys(CHANNEL_LAYOUTS)) {
    if (out[name]) continue;
    const norm = normalizeChannel(channels[name], CHANNEL_LAYOUTS[name]);
    if (norm) out[name] = norm;
  }

  // Legacy per-prop shape: zip x+y into position, scaleX+scaleY into scale.
  // Only fold props that didn't already get written to a logical channel
  // above — gives the new shape full precedence.
  const xCh = channels.x?.keys?.length ? channels.x : null;
  const yCh = channels.y?.keys?.length ? channels.y : null;
  if ((xCh || yCh) && !out.position) {
    out.position = mergeScalarPairToVec2(xCh, yCh);
  }
  const sxCh = channels.scaleX?.keys?.length ? channels.scaleX : null;
  const syCh = channels.scaleY?.keys?.length ? channels.scaleY : null;
  if ((sxCh || syCh) && !out.scale) {
    out.scale = mergeScalarPairToVec2(sxCh, syCh);
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Zip a pair of scalar channels (x, y) into a single vec2 channel. The
 * union of key times is used; missing values are evaluated at the
 * partner's curve. Out-curve is taken from x's key when present, else y's.
 */
function mergeScalarPairToVec2(chX, chY) {
  const keysX = chX?.keys || [];
  const keysY = chY?.keys || [];
  const ts = new Set();
  for (const k of keysX) ts.add(Number(k.t.toFixed(6)));
  for (const k of keysY) ts.add(Number(k.t.toFixed(6)));
  const sortedT = [...ts].sort((a, b) => a - b);
  const evalScalar = (ch, t) => {
    const ks = ch?.keys;
    if (!ks?.length) return 0;
    if (ks.length === 1) return ks[0].v;
    if (t <= ks[0].t) return ks[0].v;
    if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i];
      const b = ks[i + 1];
      if (t >= a.t && t < b.t) {
        const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return a.v + (b.v - a.v) * p;
      }
    }
    return ks[ks.length - 1].v;
  };
  const keys = sortedT.map((t) => {
    const xKey = keysX.find((k) => Math.abs(k.t - t) < 1e-5);
    const yKey = keysY.find((k) => Math.abs(k.t - t) < 1e-5);
    const xV = xKey ? xKey.v : evalScalar(chX, t);
    const yV = yKey ? yKey.v : evalScalar(chY, t);
    const out = normalizeKeyCurve(xKey?.out ?? yKey?.out ?? 'linear');
    return { t, v: { x: xV, y: yV }, out };
  });
  return { keys };
}

/**
 * Migrate the legacy `clip.tween = { from, to, curves }` shape directly
 * to the new vec2 channels form. Returns `null` when nothing is animated.
 */
export function migrateTweenToChannels(clip) {
  const tween = clip?.tween;
  if (!tween || typeof tween !== 'object') return null;
  const duration = Math.max(0.001, Number(clip.duration) || 1);
  const masterCurve = clip.curve || 'linear';
  const out = {};

  const hasN = (block, key) => typeof block?.[key] === 'number' && Number.isFinite(block[key]);

  // position
  if (hasN(tween.from, 'x') || hasN(tween.to, 'x') || hasN(tween.from, 'y') || hasN(tween.to, 'y')) {
    const fromX = hasN(tween.from, 'x') ? tween.from.x : (hasN(tween.to, 'x') ? tween.to.x : 0);
    const toX   = hasN(tween.to,   'x') ? tween.to.x   : fromX;
    const fromY = hasN(tween.from, 'y') ? tween.from.y : (hasN(tween.to, 'y') ? tween.to.y : 0);
    const toY   = hasN(tween.to,   'y') ? tween.to.y   : fromY;
    const segCurve = tween.curves?.x || tween.curves?.y || masterCurve;
    out.position = { keys: [
      { t: 0,        v: { x: fromX, y: fromY }, out: segCurve },
      { t: duration, v: { x: toX,   y: toY   }, out: 'linear' }
    ] };
  }

  // scale
  if (hasN(tween.from, 'scaleX') || hasN(tween.to, 'scaleX') || hasN(tween.from, 'scaleY') || hasN(tween.to, 'scaleY')) {
    const fromX = hasN(tween.from, 'scaleX') ? tween.from.scaleX : (hasN(tween.to, 'scaleX') ? tween.to.scaleX : 1);
    const toX   = hasN(tween.to,   'scaleX') ? tween.to.scaleX   : fromX;
    const fromY = hasN(tween.from, 'scaleY') ? tween.from.scaleY : (hasN(tween.to, 'scaleY') ? tween.to.scaleY : 1);
    const toY   = hasN(tween.to,   'scaleY') ? tween.to.scaleY   : fromY;
    const segCurve = tween.curves?.scaleX || tween.curves?.scaleY || masterCurve;
    out.scale = { keys: [
      { t: 0,        v: { x: fromX, y: fromY }, out: segCurve },
      { t: duration, v: { x: toX,   y: toY   }, out: 'linear' }
    ] };
  }

  // rotation
  if (hasN(tween.from, 'rotation') || hasN(tween.to, 'rotation')) {
    const from = hasN(tween.from, 'rotation') ? tween.from.rotation : tween.to.rotation;
    const to   = hasN(tween.to,   'rotation') ? tween.to.rotation   : from;
    const segCurve = tween.curves?.rotation || masterCurve;
    out.rotation = { keys: [
      { t: 0,        v: from, out: segCurve },
      { t: duration, v: to,   out: 'linear' }
    ] };
  }

  return Object.keys(out).length ? out : null;
}

/** Normalize a clip object. Returns null if the input is unusable. */
export function normalizeClip(c) {
  if (!c || typeof c !== 'object') return null;
  const start = Number(c.start);
  const duration = Number(c.duration);
  const speed = Number(c.speed);
  const hasMixDuration = c.mixDuration != null;
  const mixDuration = hasMixDuration ? Number(c.mixDuration) : null;

  // Channels take precedence; fall back to migrating legacy `tween` payload.
  // After migration `tween` is intentionally dropped from the persisted
  // shape — the new model expresses the same animation as `channels`.
  let channels = normalizeChannels(c.channels);
  if (!channels) {
    const migrated = migrateTweenToChannels(c);
    if (migrated) channels = migrated;
  }

  return {
    id: c.id || uid('C'),
    start: Number.isFinite(start) ? Math.max(0, start) : 0,
    duration: Number.isFinite(duration) ? Math.max(0.05, duration) : 1,
    loop: c.loop !== false,
    curve: normalizeCurve(c.curve, 'linear'),
    anim: typeof c.anim === 'string' ? c.anim : null,
    /** Playback rate. 1 = realtime, 2 = twice as fast, 0.5 = half speed. */
    speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
    /**
     * Crossfade duration in seconds when this clip starts on top of a
     * previous animation on the same Spine track. `null` = auto mix.
     * 0 = instant snap.
     * Per-clip semantics: this describes how WE blend in, not how
     * the previous one blends out.
     */
    mixDuration: !hasMixDuration
      ? null
      : (Number.isFinite(mixDuration) && mixDuration >= 0 ? mixDuration : 0),
    /**
     * Spine clip parity with Spine Animation State (Timeline) clips:
     * - holdPrevious: don't reset the mix — blend on top of whatever is playing.
     * - useBlendDuration: clip's mix follows the Timeline blend, not mixDuration.
     * - clipIn: start the animation this many seconds in (skips the head).
     * - alpha: track entry alpha (1 = full).
     */
    holdPrevious: c.holdPrevious === true,
    useBlendDuration: c.useBlendDuration === true,
    clipIn: Number.isFinite(Number(c.clipIn)) && Number(c.clipIn) >= 0 ? Number(c.clipIn) : 0,
    alpha: Number.isFinite(Number(c.alpha)) ? Math.min(1, Math.max(0, Number(c.alpha))) : 1,
    /**
     * Spine clip parity round 2 — remaining Spine Animation State Clip fields.
     * - easeIn/easeOut: Timeline clip blend in/out durations (seconds).
     * - defaultMixDuration: use the skeleton's setup-pose mix (overrides mix).
     * - dontPause: keep playing when the director pauses (Don't Pause with Director).
     * - dontEnd: don't end the animation when the clip ends (Don't End with Clip).
     * - clipEndMixOut: mix-out duration at the clip's end.
     * - event/attachment/drawOrder threshold: Spine track-entry thresholds.
     */
    easeIn: Number.isFinite(Number(c.easeIn)) && Number(c.easeIn) >= 0 ? Number(c.easeIn) : 0,
    easeOut: Number.isFinite(Number(c.easeOut)) && Number(c.easeOut) >= 0 ? Number(c.easeOut) : 0,
    defaultMixDuration: c.defaultMixDuration === true,
    dontPause: c.dontPause === true,
    dontEnd: c.dontEnd === true,
    clipEndMixOut: Number.isFinite(Number(c.clipEndMixOut)) && Number(c.clipEndMixOut) >= 0 ? Number(c.clipEndMixOut) : 0,
    eventThreshold: Number.isFinite(Number(c.eventThreshold)) ? Math.min(1, Math.max(0, Number(c.eventThreshold))) : 0,
    attachmentThreshold: Number.isFinite(Number(c.attachmentThreshold)) ? Math.min(1, Math.max(0, Number(c.attachmentThreshold))) : 0,
    drawOrderThreshold: Number.isFinite(Number(c.drawOrderThreshold)) ? Math.min(1, Math.max(0, Number(c.drawOrderThreshold))) : 0,
    /** Helper flag: auto-fit duration on first resolved animation. */
    autoFitDuration: c.autoFitDuration === true,
    channels,
    /**
     * Spinner clips (layers whose asset is a `spinner`): the action this
     * clip performs plus its action-specific payload. Null on every other
     * clip kind. See SPINNER.md §3.
     */
    action: SPINNER_ACTIONS.includes(c.action) ? c.action : null,
    spinner: SPINNER_ACTIONS.includes(c.action)
      ? normalizeSpinnerClipPayload(c.action, c.spinner)
      : null,
    /**
     * Win-sequence clips (layers whose asset is a `winseq`): which escalation
     * flow this clip plays + whether to hang on the final idle (drop `_end`).
     * Null on every other clip kind. See engine/winseq/winseqModel.js.
     */
    winseq: c.winseq && typeof c.winseq === 'object'
      ? normalizeWinSeqClipPayload(c.winseq)
      : null
  };
}

/** Normalize a track. Sorts clips by start time. Returns null if invalid. */
export function normalizeTrack(t) {
  if (!t || typeof t !== 'object' || !t.layerId) return null;
  const clips = Array.isArray(t.clips)
    ? t.clips.map(normalizeClip).filter(Boolean).sort((a, b) => a.start - b.start)
    : [];
  return {
    id: t.id || uid('T'),
    layerId: t.layerId,
    name: typeof t.name === 'string' && t.name ? t.name : null,
    clips
  };
}

/** Return all tracks (in array order) belonging to a layer. */
export function tracksForLayer(scene, layerId) {
  return (scene?.flow?.tracks || []).filter((t) => t.layerId === layerId);
}

/** Keep flow.nodes/edges in sync with timeline-style tracks+markers. */
// ── Stable keyframe ids (kid) ─────────────────────────────────────────
//
// Every keyframe carries a `kid` so the timeline selection can identify a key
// independently of its array index. Without this, sorting keys after a move /
// delete / paste shifts indices and the live selection points at the wrong
// key (the "re-click to unstick" glitch) and forced index-stability prevents a
// selected set being dragged past a neighbour. Stamping happens here in
// `deriveFlowGraph` (the choke point every flow mutation + load passes through)
// so it is idempotent and we never persist a key without one. New keys created
// through `insertOrUpdateKey` get a `kf…`-prefixed id; this pass only fills the
// gaps (loaded projects, legacy scenes) with `k…`-prefixed ids — distinct
// prefixes guarantee the two sources never collide inside one key list.
let _kidSeq = 0;
function nextKid() { return `k${(_kidSeq++).toString(36)}`; }

function stampKeyList(keys) {
  if (!Array.isArray(keys) || !keys.length) return keys;
  let changed = false;
  const out = keys.map((k) => {
    if (k && k.kid) return k;
    changed = true;
    return { ...k, kid: nextKid() };
  });
  return changed ? out : keys;
}

function stampChannelKids(ch) {
  if (!ch) return ch;
  if (ch.mode === 'path' && ch.path) {
    const prog = ch.path.progress;
    if (prog?.keys) {
      const nk = stampKeyList(prog.keys);
      if (nk !== prog.keys) return { ...ch, path: { ...ch.path, progress: { ...prog, keys: nk } } };
    }
    return ch;
  }
  if (ch.split && ch.perComp) {
    let changed = false;
    const perComp = {};
    for (const c of Object.keys(ch.perComp)) {
      const sub = ch.perComp[c];
      const nk = stampKeyList(sub?.keys);
      if (sub?.keys && nk !== sub.keys) { changed = true; perComp[c] = { ...sub, keys: nk }; }
      else perComp[c] = sub;
    }
    return changed ? { ...ch, perComp } : ch;
  }
  if (Array.isArray(ch.keys)) {
    const nk = stampKeyList(ch.keys);
    return nk !== ch.keys ? { ...ch, keys: nk } : ch;
  }
  return ch;
}

function stampClipKids(clip) {
  if (!clip?.channels) return clip;
  let changed = false;
  const channels = {};
  for (const name of Object.keys(clip.channels)) {
    const ch = clip.channels[name];
    const nc = stampChannelKids(ch);
    if (nc !== ch) changed = true;
    channels[name] = nc;
  }
  return changed ? { ...clip, channels } : clip;
}

/** Idempotently stamp a `kid` onto every keyframe across a track list. */
function stampTrackKids(tracks) {
  let changed = false;
  const out = tracks.map((t) => {
    if (!t.clips?.length) return t;
    let tChanged = false;
    const clips = t.clips.map((c) => {
      const nc = stampClipKids(c);
      if (nc !== c) tChanged = true;
      return nc;
    });
    if (tChanged) { changed = true; return { ...t, clips }; }
    return t;
  });
  return changed ? out : tracks;
}

export function deriveFlowGraph(flow) {
  const tracks = stampTrackKids(Array.isArray(flow?.tracks) ? flow.tracks : []);
  const markers = Array.isArray(flow?.markers) ? flow.markers : [];
  const nodes = [];
  const edges = [];
  const timeline = [];

  for (const t of tracks) {
    for (const c of t.clips || []) {
      const id = `clip:${c.id}`;
      nodes.push({ id, kind: 'clip', layerId: t.layerId, clipId: c.id, time: c.start, duration: c.duration });
      timeline.push({ id, time: c.start });
    }
  }
  for (const m of markers) {
    const id = `marker:${m.id}`;
    nodes.push({ id, kind: 'marker', markerType: m.type, markerId: m.id, time: m.time, duration: m.duration || 0, signal: m.signal || null });
    timeline.push({ id, time: m.time });
  }
  timeline.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  for (let i = 0; i < timeline.length - 1; i++) {
    edges.push({ from: `${timeline[i].id}.done`, to: `${timeline[i + 1].id}.start` });
  }
  return { ...(flow || {}), tracks, markers, nodes, edges };
}
