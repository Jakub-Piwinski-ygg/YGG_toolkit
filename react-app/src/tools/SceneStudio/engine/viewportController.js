// Pan / zoom / select / move / resize controller for the Scene Studio viewport.
//
// Owns the transform of a Pixi Container that wraps the stage contents.
// Mouse handling:
//   - middle mouse drag       → pan
//   - wheel                   → zoom around cursor
//   - left click on sprite    → select (via hit-test)
//   - left click empty area   → deselect
//   - left drag on selected sprite body → move it
//   - left drag on a handle   → resize (edge = 1 axis, corner = both)
//
// The controller is framework-agnostic. It calls back into React for state
// mutations via the callbacks supplied to attachViewportController.

import {
  HANDLE_NAMES,
  contentToParentLocal,
  getHandlePositions,
  getObjectMetrics,
  localToContent,
  pointInsideObject
} from './pixiApp.js';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.1;
const HANDLE_HIT_PX = 15; // screen-pixel radius for handle hit-test
const ROTATE_HIT_PX = 30; // screen-pixel ring just outside a corner = rotate zone
const SNAP_PX = 7;
const ROTATE_SNAP = Math.PI / 12; // 15° increments when Shift is held

const HANDLE_CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize'
};

// Custom curved-arrow cursor for the rotate zone (falls back to grab). The SVG
// is a white arc + arrowhead with a dark outline so it reads on any backdrop.
const ROTATE_CURSOR = 'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCIgdmlld0JveD0iMCAwIDI4IDI4Ij48ZyBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMC41IDkuNSBBOCA4IDAgMSAwIDIyIDE0IiBzdHJva2U9IiMxYTFkMjQiIHN0cm9rZS13aWR0aD0iNCIvPjxwYXRoIGQ9Ik0yMC41IDQuNSBMMjAuNSA5LjUgTDE1LjUgOS41IiBzdHJva2U9IiMxYTFkMjQiIHN0cm9rZS13aWR0aD0iNCIvPjxwYXRoIGQ9Ik0yMC41IDkuNSBBOCA4IDAgMSAwIDIyIDE0IiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjxwYXRoIGQ9Ik0yMC41IDQuNSBMMjAuNSA5LjUgTDE1LjUgOS41IiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4K") 14 14, grab';

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {import('pixi.js').Container} opts.viewport
 * @param {import('pixi.js').Container} opts.content
 * @param {() => string|null} opts.getSelectedLayerId
 * @param {(id: string|null) => void} opts.onSelect
 * @param {(id: string, patch: object) => void} opts.onTransformLayer  commit drag/resize result
 * @param {() => Map<string, import('pixi.js').Container>} opts.getHandles
 * @param {() => import('./sceneModel.js').Scene} opts.getScene
 * @param {(guides: Array<{x1:number,y1:number,x2:number,y2:number}>) => void} opts.setInteractionGuides
 * @param {() => void} opts.requestRender
 * @param {() => Array<{x:number,y:number,absT:number}>} [opts.getMotionKeyDots]
 * @param {(t:number) => void} [opts.onSeekToKey]
 */
export function attachViewportController(opts) {
  const {
    canvas,
    viewport,
    content,
    getSelectedLayerId,
    onSelect,
    onTransformLayer,
    getHandles,
    getScene,
    setInteractionGuides,
    requestRender,
    getMotionKeyDots,
    onSeekToKey,
    getPathHandles,
    onPathEdit,
    onInteractingChange,
    onDiag,
    getGizmoEnabled
  } = opts;

  // When the gizmo is hidden, its handles/rotate ring aren't drawn — so they
  // must not be grabbable either (no invisible hit zones). Select + body-drag
  // stay available.
  const gizmoOn = () => (getGizmoEnabled ? getGizmoEnabled() !== false : true);

  // Notify React when a direct manipulation (drag / resize / rotate / path
  // edit) starts or ends, so playback's per-frame syncTransforms can stand
  // down and stop stomping the in-progress gesture (see PLAN_2026-07 B3).
  const setInteracting = (v) => { try { onInteractingChange?.(v); } catch { /* ignore */ } };

  let panning = false;
  let panStart = { x: 0, y: 0 };
  let viewportStart = { x: 0, y: 0 };

  let dragging = false;
  let dragLayerId = null;
  let dragOffset = { x: 0, y: 0 }; // parent-local offset
  let dragStart = null;            // obj parent-local pos at drag start (Shift axis-lock)
  let dragSnapTargets = null;

  let pathDragging = false;
  let pathDrag = null;              // { kind:'point'|'in'|'out', index }

  let resizing = false;
  let resizeHandle = null;          // 'nw' | 'n' | ... | 'w'
  let resizeAnchorOpposite = null;  // world point of opposite handle (default pin)
  let resizeAnchorCenter = null;    // world point of bbox center (Alt = from center)
  let resizeStart = null;           // snapshot of sprite at mousedown
  let resizeLayerId = null;

  let rotating = false;
  let rotateLayerId = null;
  let rotatePivot = null;           // bbox center in world space (stays fixed)
  let rotateStartAngle = 0;         // pointer→pivot angle at mousedown
  let rotateStartRotation = 0;      // obj.rotation at mousedown
  let rotateCenterLocal = null;     // bbox center in obj-local (unscaled) coords

  let rafId = 0;

  const screenToWorld = (sx, sy) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (sx - rect.left) * (canvas.width / rect.width) / (window.devicePixelRatio || 1);
    const cy = (sy - rect.top) * (canvas.height / rect.height) / (window.devicePixelRatio || 1);
    return {
      x: (cx - viewport.x) / viewport.scale.x,
      y: (cy - viewport.y) / viewport.scale.y
    };
  };

  const worldDistPerScreenPx = () => 1 / viewport.scale.x;

  const hitTestHandle = (world) => {
    if (!gizmoOn()) return null;
    const id = getSelectedLayerId();
    if (!id) return null;
    const obj = getHandles().get(id);
    const h = getHandlePositions(obj, content);
    if (!h) return null;
    const r = HANDLE_HIT_PX * worldDistPerScreenPx();
    for (const name of HANDLE_NAMES) {
      const p = h[name];
      if (Math.abs(world.x - p.x) <= r && Math.abs(world.y - p.y) <= r) return name;
    }
    return null;
  };

  // Effective visibility: an object hidden by an ANCESTOR (e.g. a disabled
  // Scene-Setup mode group) still has its own `.visible === true`, so we must
  // walk up to the content root. Prevents selecting invisible / proxy-hidden
  // objects by clicking where they'd be.
  const isEffectivelyVisible = (obj) => {
    let cur = obj;
    while (cur && cur !== content) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  };

  const hitTestSprite = (world) => {
    const handles = getHandles();
    const entries = Array.from(handles.entries());
    // Iterate in reverse insertion order so the topmost (last-drawn) layer
    // is preferred when overlapping.
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, obj] = entries[i];
      if (!isEffectivelyVisible(obj)) continue;
      const hp = getHandlePositions(obj, content);
      if (!hp) continue;
      const { left, top, right, bottom } = hp.bounds;
      if (world.x >= left && world.x <= right && world.y >= top && world.y <= bottom) {
        if (pointInsideObject(obj, world.x, world.y, content)) return id;
      }
    }
    return null;
  };

  // Rotate zone: a ring just outside a corner, where the pointer is NOT inside
  // the object body and NOT on a resize handle. Returns the corner name or null.
  const hitTestRotate = (world) => {
    if (!gizmoOn()) return null;
    const id = getSelectedLayerId();
    if (!id) return null;
    const obj = getHandles().get(id);
    const h = getHandlePositions(obj, content);
    if (!h) return null;
    if (pointInsideObject(obj, world.x, world.y, content)) return null;
    if (hitTestHandle(world)) return null;
    const r = ROTATE_HIT_PX * worldDistPerScreenPx();
    let best = null;
    let bestD = Infinity;
    for (const name of ['nw', 'ne', 'se', 'sw']) {
      const p = h[name];
      const d = Math.hypot(world.x - p.x, world.y - p.y);
      if (d <= r && d < bestD) { best = name; bestD = d; }
    }
    return best;
  };

  const asGuideX = (x, y1 = -1e6, y2 = 1e6) => ({ x1: x, y1, x2: x, y2 });
  const asGuideY = (y, x1 = -1e6, x2 = 1e6) => ({ x1, y1: y, x2, y2: y });

  const worldDeltaToParentDelta = (obj, dxWorld, dyWorld) => {
    const parent = obj.parent;
    if (!parent || parent === content) return { dx: dxWorld, dy: dyWorld };
    const p0 = contentToParentLocal(parent, 0, 0, content);
    const p1 = contentToParentLocal(parent, dxWorld, dyWorld, content);
    return { dx: p1.x - p0.x, dy: p1.y - p0.y };
  };

  const addTargetFromHandles = (targets, h) => {
    if (!h) return;
    for (const p of [h.nw, h.n, h.ne, h.e, h.se, h.s, h.sw, h.w]) {
      targets.x.push({ value: p.x, guide: asGuideX(p.x) });
      targets.y.push({ value: p.y, guide: asGuideY(p.y) });
    }
    targets.points.push(h.nw, h.ne, h.se, h.sw);
    targets.x.push({ value: h.bounds.left, guide: asGuideX(h.bounds.left, h.bounds.top, h.bounds.bottom) });
    targets.x.push({ value: h.bounds.right, guide: asGuideX(h.bounds.right, h.bounds.top, h.bounds.bottom) });
    targets.y.push({ value: h.bounds.top, guide: asGuideY(h.bounds.top, h.bounds.left, h.bounds.right) });
    targets.y.push({ value: h.bounds.bottom, guide: asGuideY(h.bounds.bottom, h.bounds.left, h.bounds.right) });
  };

  const collectSnapTargets = (selectedId) => {
    const targets = { x: [], y: [], points: [] };
    const scene = getScene?.();
    if (!scene) return targets;
    const stage = scene.stage.orientations[scene.stage.activeOrientation];
    const sx0 = 0, sx1 = stage.w, sy0 = 0, sy1 = stage.h;
    const scx = stage.w / 2, scy = stage.h / 2;
    targets.x.push({ value: sx0, guide: asGuideX(sx0, sy0, sy1) });
    targets.x.push({ value: sx1, guide: asGuideX(sx1, sy0, sy1) });
    targets.x.push({ value: scx, guide: asGuideX(scx, sy0, sy1) });
    targets.y.push({ value: sy0, guide: asGuideY(sy0, sx0, sx1) });
    targets.y.push({ value: sy1, guide: asGuideY(sy1, sx0, sx1) });
    targets.y.push({ value: scy, guide: asGuideY(scy, sx0, sx1) });
    targets.points.push({ x: sx0, y: sy0 }, { x: sx1, y: sy0 }, { x: sx1, y: sy1 }, { x: sx0, y: sy1 }, { x: scx, y: scy });

    const handles = getHandles();
    const selectedLayer = scene.layers.find((l) => l.id === selectedId);
    const parentObj = selectedLayer?.parentId ? handles.get(selectedLayer.parentId) : null;
    const parentHandles = getHandlePositions(parentObj, content);
    addTargetFromHandles(targets, parentHandles);
    if (parentObj && !parentHandles) {
      const p0 = localToContent(parentObj, 0, 0, content);
      targets.x.push({ value: p0.x, guide: asGuideX(p0.x, p0.y - 80, p0.y + 80) });
      targets.y.push({ value: p0.y, guide: asGuideY(p0.y, p0.x - 80, p0.x + 80) });
      targets.points.push(p0);
    }

    for (const [id, obj] of handles.entries()) {
      if (id === selectedId || !obj?.visible) continue;
      addTargetFromHandles(targets, getHandlePositions(obj, content));
    }
    return targets;
  };

  const computeSnap = (obj, targets, altDisable = false) => {
    if (altDisable) return { dxWorld: 0, dyWorld: 0, guides: [] };
    const h = getHandlePositions(obj, content);
    if (!h) return { dxWorld: 0, dyWorld: 0, guides: [] };
    const sources = [h.nw, h.n, h.ne, h.e, h.se, h.s, h.sw, h.w, localToContent(obj, 0, 0, content)];
    if (!targets) return { dxWorld: 0, dyWorld: 0, guides: [] };
    const threshold = SNAP_PX * worldDistPerScreenPx();

    let bestX = null;
    let bestY = null;

    const takeBest = (best, next) => {
      if (!best) return next;
      return Math.abs(next.delta) < Math.abs(best.delta) ? next : best;
    };

    for (const s of sources) {
      for (const tx of targets.x) {
        const d = tx.value - s.x;
        if (Math.abs(d) <= threshold) bestX = takeBest(bestX, { delta: d, guide: tx.guide });
      }
      for (const ty of targets.y) {
        const d = ty.value - s.y;
        if (Math.abs(d) <= threshold) bestY = takeBest(bestY, { delta: d, guide: ty.guide });
      }
      for (const p of targets.points) {
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        if (Math.abs(dx) <= threshold) bestX = takeBest(bestX, { delta: dx, guide: asGuideX(p.x, p.y - 80, p.y + 80) });
        if (Math.abs(dy) <= threshold) bestY = takeBest(bestY, { delta: dy, guide: asGuideY(p.y, p.x - 80, p.x + 80) });
      }
    }

    return {
      dxWorld: bestX?.delta || 0,
      dyWorld: bestY?.delta || 0,
      guides: [bestX?.guide, bestY?.guide].filter(Boolean)
    };
  };

  const cursorForHover = (world) => {
    const handle = hitTestHandle(world);
    if (handle) return HANDLE_CURSORS[handle];
    if (hitTestRotate(world)) return ROTATE_CURSOR;
    if (hitTestSprite(world)) return 'move';
    return 'default';
  };

  const startRaf = () => {
    if (rafId) return;
    const tick = () => {
      if (!(panning || dragging || resizing || rotating || pathDragging)) {
        rafId = 0;
        return;
      }
      requestRender();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  const stopRaf = () => {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const onMouseDown = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      panning = true;
      panStart = { x: e.clientX, y: e.clientY };
      viewportStart = { x: viewport.x, y: viewport.y };
      canvas.style.cursor = 'grabbing';
      startRaf();
      return;
    }
    if (e.button !== 0) return;

    const world = screenToWorld(e.clientX, e.clientY);

    // ?debug=1 diagnostics: report exactly what a click resolves to so the
    // "can move but not scale/rotate" case becomes nameable — selection id,
    // Pixi zoom, whether the handle / rotate / sprite tests matched, and the
    // nearest handle distance vs the hit threshold (all in world units).
    if (onDiag) {
      const selId = getSelectedLayerId();
      const selObj = selId ? getHandles().get(selId) : null;
      const hp = selObj ? getHandlePositions(selObj, content) : null;
      let nearest = 'no-handles';
      if (hp) {
        let bd = Infinity, bn = '';
        for (const n of HANDLE_NAMES) {
          const p = hp[n];
          const d = Math.hypot(world.x - p.x, world.y - p.y);
          if (d < bd) { bd = d; bn = n; }
        }
        nearest = `${bn}@${bd.toFixed(1)} r=${(HANDLE_HIT_PX * worldDistPerScreenPx()).toFixed(1)}`;
      }
      onDiag(`gizmo: sel=${selId || '—'} zoom=${viewport.scale.x.toFixed(2)} handle=${!!hitTestHandle(world)} rotate=${!!hitTestRotate(world)} sprite=${hitTestSprite(world) || '—'} nearest=${nearest}`);
    }

    // First check for a handle of the currently selected sprite
    const handleName = hitTestHandle(world);
    if (handleName) {
      const id = getSelectedLayerId();
      const obj = getHandles().get(id);
      const m = getObjectMetrics(obj);
      const positions = getHandlePositions(obj, content);
      if (!m || !positions) return;
      const opposite = oppositeHandle(handleName);
      // Unscaled local rect → geometric center (Alt = scale from center).
      const left0 = -m.baseW * m.ax;
      const top0 = -m.baseH * m.ay;
      const cx = left0 + m.baseW / 2;
      const cy = top0 + m.baseH / 2;
      resizing = true;
      resizeHandle = handleName;
      resizeLayerId = id;
      resizeAnchorOpposite = { ...positions[opposite] };
      resizeAnchorCenter = localToContent(obj, cx, cy, content);
      resizeStart = {
        baseW: m.baseW,
        baseH: m.baseH,
        ax: m.ax,
        ay: m.ay,
        startScaleX: obj.scale.x,
        startScaleY: obj.scale.y
      };
      canvas.style.cursor = HANDLE_CURSORS[handleName];
      setInteracting(true);
      startRaf();
      return;
    }

    // Rotate zone — just outside a corner of the selected object.
    const rotCorner = hitTestRotate(world);
    if (rotCorner) {
      const id = getSelectedLayerId();
      const obj = getHandles().get(id);
      const m = getObjectMetrics(obj);
      if (!obj || !m) return;
      // Rotate around the object's ORIGIN (local 0,0 = the anchor / displayed
      // pivot cross), not the bbox geometric centre. For anchor-0.5 sprites they
      // coincide, but Spine / win-sequence bounds aren't centred on the origin,
      // so the bbox centre drifted away from the shown pivot.
      rotateCenterLocal = { x: 0, y: 0 };
      rotatePivot = localToContent(obj, 0, 0, content);
      rotateStartAngle = Math.atan2(world.y - rotatePivot.y, world.x - rotatePivot.x);
      rotateStartRotation = obj.rotation || 0;
      rotating = true;
      rotateLayerId = id;
      canvas.style.cursor = ROTATE_CURSOR;
      setInteracting(true);
      startRaf();
      return;
    }

    // Path-mode dials: grab a control point or tangent handle to drag.
    if (getPathHandles && onPathEdit) {
      const r = 10 * worldDistPerScreenPx();
      let best = null;
      let bestD = Infinity;
      for (const h of (getPathHandles() || [])) {
        const d = Math.hypot(world.x - h.x, world.y - h.y);
        // Bias toward tangent handles slightly so they win ties over the point.
        const score = d - (h.kind === 'point' ? 0 : 2 * worldDistPerScreenPx());
        if (d <= r && score < bestD) { best = h; bestD = score; }
      }
      if (best) {
        pathDragging = true;
        pathDrag = { kind: best.kind, index: best.index };
        canvas.style.cursor = 'grabbing';
        setInteracting(true);
        startRaf();
        return;
      }
    }

    // Click on a motion-path key dot → seek playhead to that key's time.
    if (getMotionKeyDots && onSeekToKey) {
      const r = 10 * worldDistPerScreenPx();
      for (const dot of (getMotionKeyDots() || [])) {
        if (Math.abs(world.x - dot.x) <= r && Math.abs(world.y - dot.y) <= r) {
          onSeekToKey(dot.absT);
          return;
        }
      }
    }

    // Otherwise hit-test the sprite body for select / drag.
    // Sticky selection: if a layer is already selected and the click lands
    // inside its rect, drag THAT layer — don't re-pick an object stacked on
    // top. Only clicks outside the selected rect re-select / deselect.
    const selectedId = getSelectedLayerId();
    const selectedObj = selectedId ? getHandles().get(selectedId) : null;
    let hit;
    if (selectedObj && isEffectivelyVisible(selectedObj) && pointInsideObject(selectedObj, world.x, world.y, content)) {
      hit = selectedId;
    } else {
      hit = hitTestSprite(world);
      onSelect(hit);
    }
    if (hit) {
      dragging = true;
      dragLayerId = hit;
      dragSnapTargets = collectSnapTargets(hit);
      const obj = getHandles().get(hit);
      const parent = obj?.parent || content;
      const p = contentToParentLocal(parent, world.x, world.y, content);
      dragOffset = { x: (obj?.x ?? 0) - p.x, y: (obj?.y ?? 0) - p.y };
      dragStart = { x: obj?.x ?? 0, y: obj?.y ?? 0 };
      canvas.style.cursor = 'move';
      setInteracting(true);
      startRaf();
    }
  };

  const onMouseMove = (e) => {
    if (panning) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - panStart.x) * (canvas.width / rect.width) / dpr;
      const dy = (e.clientY - panStart.y) * (canvas.height / rect.height) / dpr;
      viewport.x = viewportStart.x + dx;
      viewport.y = viewportStart.y + dy;
      return;
    }
    if (pathDragging && pathDrag) {
      const world = screenToWorld(e.clientX, e.clientY);
      // Path points live in the selected layer's parent-local space; convert
      // so nested layers (rotated/scaled parents) edit correctly.
      const id = getSelectedLayerId();
      const obj = getHandles().get(id);
      const parent = obj?.parent || content;
      const local = contentToParentLocal(parent, world.x, world.y, content);
      onPathEdit?.({ kind: pathDrag.kind, index: pathDrag.index, x: local.x, y: local.y, alt: e.altKey });
      return;
    }
    if (rotating && rotateLayerId) {
      const world = screenToWorld(e.clientX, e.clientY);
      const obj = getHandles().get(rotateLayerId);
      if (!obj) return;
      const cur = Math.atan2(world.y - rotatePivot.y, world.x - rotatePivot.x);
      let next = rotateStartRotation + (cur - rotateStartAngle);
      if (e.shiftKey) next = Math.round(next / ROTATE_SNAP) * ROTATE_SNAP;
      applyRotation(obj, next, rotatePivot, rotateCenterLocal, content);
      setInteractionGuides?.([]);
      return;
    }
    if (resizing && resizeLayerId) {
      const world = screenToWorld(e.clientX, e.clientY);
      const obj = getHandles().get(resizeLayerId);
      if (!obj) return;
      applyResize(obj, resizeHandle, world, resizeStart, content, {
        keepAspect: !e.shiftKey,
        fromCenter: e.altKey,
        anchorOpposite: resizeAnchorOpposite,
        anchorCenter: resizeAnchorCenter
      });
      setInteractionGuides?.([]);
      return;
    }
    if (dragging && dragLayerId) {
      const world = screenToWorld(e.clientX, e.clientY);
      const obj = getHandles().get(dragLayerId);
      if (obj) {
        const parent = obj.parent || content;
        const p = contentToParentLocal(parent, world.x, world.y, content);
        let nx = p.x + dragOffset.x;
        let ny = p.y + dragOffset.y;
        // Shift = constrain to the dominant axis from the drag origin, like
        // Photoshop. The axis with the larger displacement wins; the other is
        // pinned to its start value (re-pinned after snapping so it holds).
        let lockAxis = null;
        if (e.shiftKey && dragStart) {
          if (Math.abs(nx - dragStart.x) >= Math.abs(ny - dragStart.y)) { ny = dragStart.y; lockAxis = 'x'; }
          else { nx = dragStart.x; lockAxis = 'y'; }
        }
        obj.x = nx;
        obj.y = ny;
        const snap = computeSnap(obj, dragSnapTargets, e.altKey);
        if (snap.dxWorld || snap.dyWorld) {
          const dLocal = worldDeltaToParentDelta(obj, snap.dxWorld, snap.dyWorld);
          obj.x += dLocal.dx;
          obj.y += dLocal.dy;
        }
        if (lockAxis === 'x') obj.y = dragStart.y;
        else if (lockAxis === 'y') obj.x = dragStart.x;
        setInteractionGuides?.(snap.guides);
      }
      return;
    }
    // Idle hover: update cursor based on what's under the pointer
    const world = screenToWorld(e.clientX, e.clientY);
    const c = cursorForHover(world);
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  };

  const onMouseUp = (e) => {
    if (panning && e.button === 1) {
      panning = false;
      canvas.style.cursor = '';
      stopRaf();
    }
    if (pathDragging && e.button === 0) {
      pathDragging = false;
      pathDrag = null;
      canvas.style.cursor = '';
      setInteracting(false);
      stopRaf();
    }
    if (rotating && e.button === 0) {
      const obj = getHandles().get(rotateLayerId);
      if (obj && onTransformLayer) {
        onTransformLayer(rotateLayerId, { rotation: obj.rotation, x: obj.x, y: obj.y });
      }
      rotating = false;
      rotateLayerId = null;
      rotatePivot = null;
      rotateCenterLocal = null;
      setInteractionGuides?.([]);
      canvas.style.cursor = '';
      setInteracting(false);
      stopRaf();
    }
    if (resizing && e.button === 0) {
      const obj = getHandles().get(resizeLayerId);
      if (obj && onTransformLayer) {
        onTransformLayer(resizeLayerId, {
          x: obj.x, y: obj.y,
          scaleX: obj.scale.x, scaleY: obj.scale.y
        });
      }
      resizing = false;
      resizeHandle = null;
      resizeLayerId = null;
      resizeAnchorOpposite = null;
      resizeAnchorCenter = null;
      resizeStart = null;
      setInteractionGuides?.([]);
      canvas.style.cursor = '';
      setInteracting(false);
      stopRaf();
    }
    if (dragging && e.button === 0) {
      const obj = getHandles().get(dragLayerId);
      if (obj && onTransformLayer) onTransformLayer(dragLayerId, { x: obj.x, y: obj.y });
      dragging = false;
      dragLayerId = null;
      dragStart = null;
      dragSnapTargets = null;
      setInteractionGuides?.([]);
      canvas.style.cursor = '';
      setInteracting(false);
      stopRaf();
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale.x * factor));
    if (newScale === viewport.scale.x) return;
    const world = screenToWorld(e.clientX, e.clientY);
    viewport.scale.set(newScale);
    const after = screenToWorld(e.clientX, e.clientY);
    viewport.x += (after.x - world.x) * newScale;
    viewport.y += (after.y - world.y) * newScale;
    requestRender();
  };

  const onContextMenu = (e) => e.preventDefault();

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return function detach() {
    stopRaf();
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}

/** Fit a stage rectangle into the canvas with a small margin. */
export function fitViewportToStage(viewport, canvasW, canvasH, stageW, stageH, margin = 0.92) {
  const s = Math.min((canvasW * margin) / stageW, (canvasH * margin) / stageH);
  viewport.scale.set(s);
  viewport.x = (canvasW - stageW * s) / 2;
  viewport.y = (canvasH - stageH * s) / 2;
}

// ── helpers ─────────────────────────────────────────────────────────

function oppositeHandle(name) {
  return ({
    nw: 'se', n: 's', ne: 'sw', e: 'w',
    se: 'nw', s: 'n', sw: 'ne', w: 'e'
  })[name];
}

/**
 * Resize an object by moving one handle while keeping a fixed anchor pinned in
 * world space. Works for rotated and nested objects.
 *
 *   opts.fromCenter  — pin the bbox CENTER (Alt) instead of the opposite handle.
 *   opts.keepAspect  — constrain to the START aspect ratio (default; Shift frees).
 *   opts.anchorOpposite / opts.anchorCenter — world points captured at mousedown.
 */
function applyResize(obj, handle, mouseWorld, startInfo, contentRoot, opts = {}) {
  const { baseW, baseH, ax, ay, startScaleX, startScaleY } = startInfo;
  const { keepAspect = true, fromCenter = false, anchorOpposite, anchorCenter } = opts;
  const left0 = -baseW * ax;
  const right0 = left0 + baseW;
  const top0 = -baseH * ay;
  const bottom0 = top0 + baseH;

  // Unscaled local-frame positions of the dragged handle and the pinned anchor
  // (opposite handle, or the rect center for Alt). These never change mid-drag.
  const opposite = oppositeHandle(handle);
  const dragLocal = handleLocalPoint(handle, left0, right0, top0, bottom0);
  const anchorLocal = fromCenter
    ? { x: (left0 + right0) / 2, y: (top0 + bottom0) / 2 }
    : handleLocalPoint(opposite, left0, right0, top0, bottom0);
  const anchorWorld = fromCenter ? anchorCenter : anchorOpposite;

  // Work entirely in the object's PARENT-local space and against the pinned
  // anchor. Crucially we never reverse-map through obj's own (live, mid-drag)
  // scale — doing so created a feedback loop where shrinking the object
  // inflated the inverse-mapped pointer, so the rect oscillated ("sprang")
  // instead of settling under the cursor.
  const parent = obj.parent || contentRoot;
  const parentAnchor = contentToParentLocal(parent, anchorWorld.x, anchorWorld.y, contentRoot);
  const parentMouse = contentToParentLocal(parent, mouseWorld.x, mouseWorld.y, contentRoot);

  // Un-rotate the anchor→pointer vector into the object's local axes.
  const c = Math.cos(obj.rotation || 0);
  const s = Math.sin(obj.rotation || 0);
  const vx = parentMouse.x - parentAnchor.x;
  const vy = parentMouse.y - parentAnchor.y;
  const dx = vx * c + vy * s;
  const dy = -vx * s + vy * c;

  // Derive each axis scale directly: scale = projected pointer offset / base
  // span. The perpendicular axis of an edge handle (zero span) keeps its
  // current scale, so free-mode edge drags don't reset the other dimension.
  const spanX = dragLocal.x - anchorLocal.x;
  const spanY = dragLocal.y - anchorLocal.y;
  const minScale = 1e-3;
  let scaleX = obj.scale.x;
  let scaleY = obj.scale.y;
  const hasX = Math.abs(spanX) > 1e-6;
  const hasY = Math.abs(spanY) > 1e-6;
  if (hasX) scaleX = dx / spanX;
  if (hasY) scaleY = dy / spanY;

  if (keepAspect) {
    // Collapse to a single signed factor that preserves the START aspect ratio.
    // The dominant axis (largest |ratio|) drives both, so a corner follows the
    // cursor and an edge handle (one live span) scales the whole object.
    const sSX = startScaleX || scaleX || 1;
    const sSY = startScaleY || scaleY || 1;
    const ratioX = hasX ? scaleX / sSX : null;
    const ratioY = hasY ? scaleY / sSY : null;
    let k = ratioX != null && ratioY != null
      ? (Math.abs(ratioX) >= Math.abs(ratioY) ? ratioX : ratioY)
      : (ratioX != null ? ratioX : ratioY);
    if (k == null || !isFinite(k)) k = 1;
    scaleX = sSX * k;
    scaleY = sSY * k;
  }

  if (Math.abs(scaleX) < minScale) scaleX = Math.sign(scaleX || 1) * minScale;
  if (Math.abs(scaleY) < minScale) scaleY = Math.sign(scaleY || 1) * minScale;
  obj.scale.set(scaleX, scaleY);

  // Re-pin the anchor exactly where it was in world space.
  const sxAx = anchorLocal.x * scaleX;
  const syAy = anchorLocal.y * scaleY;
  const rx = sxAx * c - syAy * s;
  const ry = sxAx * s + syAy * c;
  obj.x = parentAnchor.x - rx;
  obj.y = parentAnchor.y - ry;
}

/**
 * Rotate an object to `rotation` (radians) while keeping its bounding-box
 * center pinned at `pivotWorld`. Pixi rotates about the object origin (anchor),
 * so we re-derive obj.x/obj.y so the center offset lands back on the pivot.
 * Honours scale and nested parents.
 */
function applyRotation(obj, rotation, pivotWorld, centerLocal, contentRoot) {
  const parent = obj.parent || contentRoot;
  const parentPivot = contentToParentLocal(parent, pivotWorld.x, pivotWorld.y, contentRoot);
  obj.rotation = rotation;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const lx = centerLocal.x * (obj.scale?.x ?? 1);
  const ly = centerLocal.y * (obj.scale?.y ?? 1);
  const rx = lx * c - ly * s;
  const ry = lx * s + ly * c;
  obj.x = parentPivot.x - rx;
  obj.y = parentPivot.y - ry;
}

function handleLocalPoint(name, left, right, top, bottom) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return ({
    nw: { x: left, y: top },
    n: { x: cx, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: cy },
    se: { x: right, y: bottom },
    s: { x: cx, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: cy }
  })[name];
}
