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
const HANDLE_HIT_PX = 12; // screen-pixel radius for handle hit-test
const SNAP_PX = 7;

const HANDLE_CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize'
};

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
    onSeekToKey
  } = opts;

  let panning = false;
  let panStart = { x: 0, y: 0 };
  let viewportStart = { x: 0, y: 0 };

  let dragging = false;
  let dragLayerId = null;
  let dragOffset = { x: 0, y: 0 }; // parent-local offset
  let dragSnapTargets = null;

  let resizing = false;
  let resizeHandle = null;          // 'nw' | 'n' | ... | 'w'
  let resizeAnchorWorld = null;     // the world point that stays fixed
  let resizeStart = null;           // snapshot of sprite at mousedown
  let resizeLayerId = null;
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

  const hitTestSprite = (world) => {
    const handles = getHandles();
    const entries = Array.from(handles.entries());
    // Iterate in reverse insertion order so the topmost (last-drawn) layer
    // is preferred when overlapping.
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, obj] = entries[i];
      if (!obj.visible) continue;
      const hp = getHandlePositions(obj, content);
      if (!hp) continue;
      const { left, top, right, bottom } = hp.bounds;
      if (world.x >= left && world.x <= right && world.y >= top && world.y <= bottom) {
        if (pointInsideObject(obj, world.x, world.y, content)) return id;
      }
    }
    return null;
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
    if (hitTestHandle(world)) return HANDLE_CURSORS[hitTestHandle(world)];
    if (hitTestSprite(world)) return 'move';
    return 'default';
  };

  const startRaf = () => {
    if (rafId) return;
    const tick = () => {
      if (!(panning || dragging || resizing)) {
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

    // First check for a handle of the currently selected sprite
    const handleName = hitTestHandle(world);
    if (handleName) {
      const id = getSelectedLayerId();
      const obj = getHandles().get(id);
      const m = getObjectMetrics(obj);
      const positions = getHandlePositions(obj, content);
      if (!m || !positions) return;
      const opposite = oppositeHandle(handleName);
      resizing = true;
      resizeHandle = handleName;
      resizeLayerId = id;
      resizeAnchorWorld = { ...positions[opposite] };
      resizeStart = {
        baseW: m.baseW,
        baseH: m.baseH,
        ax: m.ax,
        ay: m.ay
      };
      canvas.style.cursor = HANDLE_CURSORS[handleName];
      startRaf();
      return;
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

    // Otherwise hit-test the sprite body for select / drag
    const hit = hitTestSprite(world);
    onSelect(hit);
    if (hit) {
      dragging = true;
      dragLayerId = hit;
      dragSnapTargets = collectSnapTargets(hit);
      const obj = getHandles().get(hit);
      const parent = obj?.parent || content;
      const p = contentToParentLocal(parent, world.x, world.y, content);
      dragOffset = { x: (obj?.x ?? 0) - p.x, y: (obj?.y ?? 0) - p.y };
      canvas.style.cursor = 'move';
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
    if (resizing && resizeLayerId) {
      const world = screenToWorld(e.clientX, e.clientY);
      const obj = getHandles().get(resizeLayerId);
      if (!obj) return;
      applyResize(obj, resizeHandle, resizeAnchorWorld, world, resizeStart, content);
      setInteractionGuides?.([]);
      return;
    }
    if (dragging && dragLayerId) {
      const world = screenToWorld(e.clientX, e.clientY);
      const obj = getHandles().get(dragLayerId);
      if (obj) {
        const parent = obj.parent || content;
        const p = contentToParentLocal(parent, world.x, world.y, content);
        obj.x = p.x + dragOffset.x;
        obj.y = p.y + dragOffset.y;
        const snap = computeSnap(obj, dragSnapTargets, e.altKey);
        if (snap.dxWorld || snap.dyWorld) {
          const dLocal = worldDeltaToParentDelta(obj, snap.dxWorld, snap.dyWorld);
          obj.x += dLocal.dx;
          obj.y += dLocal.dy;
        }
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
      resizeAnchorWorld = null;
      resizeStart = null;
      setInteractionGuides?.([]);
      canvas.style.cursor = '';
      stopRaf();
    }
    if (dragging && e.button === 0) {
      const obj = getHandles().get(dragLayerId);
      if (obj && onTransformLayer) onTransformLayer(dragLayerId, { x: obj.x, y: obj.y });
      dragging = false;
      dragLayerId = null;
      dragSnapTargets = null;
      setInteractionGuides?.([]);
      canvas.style.cursor = '';
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
 * Resize an object by moving one handle while keeping the opposite handle
 * pinned in world space. Works for rotated and nested objects.
 */
function applyResize(obj, handle, anchorWorld, mouseWorld, startInfo, contentRoot) {
  const { baseW, baseH, ax, ay } = startInfo;
  const left0 = -baseW * ax;
  const right0 = left0 + baseW;
  const top0 = -baseH * ay;
  const bottom0 = top0 + baseH;

  const opposite = oppositeHandle(handle);
  const anchorLocal = handleLocalPoint(opposite, left0, right0, top0, bottom0);
  const mouseLocal = contentToParentLocal(obj, mouseWorld.x, mouseWorld.y, contentRoot);

  let left = left0;
  let right = right0;
  let top = top0;
  let bottom = bottom0;

  if (handle.includes('w')) left = mouseLocal.x;
  if (handle.includes('e')) right = mouseLocal.x;
  if (handle.includes('n')) top = mouseLocal.y;
  if (handle.includes('s')) bottom = mouseLocal.y;

  const minSize = 1;
  if (Math.abs(right - left) < minSize) {
    if (handle.includes('w')) left = right - minSize * Math.sign(right - left || 1);
    else right = left + minSize * Math.sign(right - left || 1);
  }
  if (Math.abs(bottom - top) < minSize) {
    if (handle.includes('n')) top = bottom - minSize * Math.sign(bottom - top || 1);
    else bottom = top + minSize * Math.sign(bottom - top || 1);
  }

  const scaleX = (right - left) / baseW;
  const scaleY = (bottom - top) / baseH;
  obj.scale.set(scaleX, scaleY);

  const parent = obj.parent || contentRoot;
  const parentAnchor = contentToParentLocal(parent, anchorWorld.x, anchorWorld.y, contentRoot);
  const c = Math.cos(obj.rotation || 0);
  const s = Math.sin(obj.rotation || 0);
  const sxAx = anchorLocal.x * scaleX;
  const syAy = anchorLocal.y * scaleY;
  const rx = sxAx * c - syAy * s;
  const ry = sxAx * s + syAy * c;
  obj.x = parentAnchor.x - rx;
  obj.y = parentAnchor.y - ry;
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
