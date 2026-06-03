// Pixi v8 lifecycle + per-frame rebuild of the scene graph from scene.json.
//
// Architecture: canvas fills the entire viewport wrap. The "page" (the
// 1920×1080 / 1080×2160 reference stage) is just a region inside a
// pan/zoom-able container. This lets the user navigate the workspace
// Blender/Unity-style and gives them a clear visual frame for the
// reference resolution.
//
//   app.stage
//     └─ viewportContainer (pan + zoom)
//          ├─ stageFrame   (outline of reference resolution)
//          ├─ contentLayer (all asset layers)
//          └─ selectionOverlay (outline around selected sprite)

import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { resolveTransform } from './orientationManager.js';
import { resolveAssetUrl } from './persist.js';
import { buildLayerTree, tracksForLayer } from './sceneModel.js';
import { clipAt, lastClipAt, remapClipTime } from './flowInterpreter.js';
import { CHANNEL_DEFS, CHANNEL_NAMES, clipLocalSeconds, evalChannel, isPathChannel } from './animation/keyframes.js';
import { resolvePointHandles } from './animation/pathSpline.js';
import { buildSpineFromUrls, applySpineState, describeSpine, snapshotSpineBounds } from './spineLoader.js';

async function loadTextureFromUrl(url) {
  // Use Pixi v8 Assets.load — it returns a Texture whose `source.orig` is
  // fully populated before resolve, avoiding the "Cannot read properties
  // of null (reading 'orig')" crash that happens when a sprite is added
  // to the scene graph while its texture source is still uninitialised.
  // Falls back to the legacy <img> + Texture.from path if Assets fails
  // (e.g. odd cross-origin / data:url cases).
  try {
    const tex = await Assets.load(url);
    if (tex && tex.source && tex.source.orig) return tex;
  } catch { /* fall through */ }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
  // Decode to be doubly sure the bitmap is fully ready before handing it
  // to Pixi (Texture.from is sync and can yield a not-yet-uploaded source
  // on some browsers).
  if (typeof img.decode === 'function') {
    try { await img.decode(); } catch { /* ignore */ }
  }
  return Texture.from(img);
}

/**
 * Create a Pixi Application that fills the given container.
 * @param {HTMLElement} container
 * @param {{w:number, h:number}} initialCanvasSize  display pixel size (not stage)
 * @returns {Promise<{app, viewport, content, stageFrame, selectionOverlay}>}
 */
export async function createPixiApp(container, initialCanvasSize) {
  const app = new Application();
  await app.init({
    width: initialCanvasSize.w,
    height: initialCanvasSize.h,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl'
  });
  container.appendChild(app.canvas);
  // Pixi v8 does NOT honor an `autoStart` constructor option (that was v7).
  // The ticker has to be started explicitly. Without this, the renderer
  // only repaints on manual `app.render()` calls — which we previously did
  // only on React state changes or while the pan/drag RAF was running.
  // Consequence: Spine animations froze at idle and only "ticked" while
  // the user held middle mouse to pan. Starting the ticker means we render
  // every frame and Spine's shared-ticker state advance is visible.
  app.start();
  // Canvas always fills its parent; pan/zoom lives in the viewport container.
  app.canvas.style.position = 'absolute';
  app.canvas.style.inset = '0';
  app.canvas.style.width = '100%';
  app.canvas.style.height = '100%';
  app.canvas.style.display = 'block';
  app.canvas.style.cursor = 'default';

  const viewport = new Container();
  viewport.label = 'viewport';
  app.stage.addChild(viewport);

  const stageFrame = new Graphics();
  stageFrame.label = 'stageFrame';
  viewport.addChild(stageFrame);

  const content = new Container();
  content.label = 'content';
  viewport.addChild(content);

  const selectionOverlay = new Graphics();
  selectionOverlay.label = 'selectionOverlay';
  viewport.addChild(selectionOverlay);

  return { app, viewport, content, stageFrame, selectionOverlay };
}

export function destroyPixiApp(app) {
  if (!app) return;
  try {
    app.destroy(true, { children: true, texture: false });
  } catch {
    /* ignore */
  }
}

/** Tear down all children of a container. */
function clearContainer(c) {
  while (c.children.length) {
    const ch = c.children.pop();
    ch.destroy({ children: true });
  }
}

/**
 * Draw the reference-resolution frame: outer rectangle at stage bounds
 * plus a subtle inner shadow so the user can see where the safe area is.
 * The stroke width is divided by `viewportScale` so the outline stays
 * visually constant regardless of zoom level.
 */
/**
 * @param {'behind'|'above'} overlayMode  When 'above', skip the dark fill so
 *   the interior is transparent (the frame floats on top of content).
 */
export function drawStageFrame(frame, stageW, stageH, viewportScale = 1, overlayMode = 'behind') {
  frame.clear();
  if (overlayMode !== 'above') {
    // Stage background — slightly darker than the surrounding checker
    frame.rect(0, 0, stageW, stageH).fill({ color: 0x0d0e11, alpha: 0.85 });
  }
  // Outer border — 2px constant on screen
  frame.rect(0, 0, stageW, stageH).stroke({ color: 0x4f9eff, width: 2 / viewportScale, alpha: 0.95 });
  // Center crosshair
  const cx = stageW / 2, cy = stageH / 2;
  const r = 20 / viewportScale;
  frame.moveTo(cx - r, cy).lineTo(cx + r, cy).stroke({ color: 0x4f9eff, width: 1 / viewportScale, alpha: 0.45 });
  frame.moveTo(cx, cy - r).lineTo(cx, cy + r).stroke({ color: 0x4f9eff, width: 1 / viewportScale, alpha: 0.45 });
}

/**
 * Reorder the stageFrame within the viewport container so it renders either
 * behind content ('behind') or in front of it ('above').  The selectionOverlay
 * always stays topmost — we only swap stageFrame relative to content.
 */
export function setStageFrameZOrder(viewport, stageFrame, content, overlayMode) {
  if (!viewport || !stageFrame || !content) return;
  const children = viewport.children;
  const frameIdx = children.indexOf(stageFrame);
  const contentIdx = children.indexOf(content);
  if (frameIdx === -1 || contentIdx === -1) return;
  if (overlayMode === 'above' && frameIdx < contentIdx) {
    viewport.removeChild(stageFrame);
    // content index shifts down by 1 after removal; insert right after it
    viewport.addChildAt(stageFrame, children.indexOf(content) + 1);
  } else if (overlayMode !== 'above' && frameIdx > contentIdx) {
    viewport.removeChild(stageFrame);
    // Insert before content
    viewport.addChildAt(stageFrame, children.indexOf(content));
  }
}

/**
 * Build (or rebuild) the content container from a Scene JSON model.
 * @param {Application} app
 * @param {Container} content
 * @param {Container|null} selectionOverlay
 * @param {import('./sceneModel.js').Scene} scene
 * @param {string|null} selectedLayerId
 * @param {FileSystemDirectoryHandle|null} rootHandle
 * @returns {Promise<Map<string, Sprite>>}
 */
export async function rebuildScene(app, content, selectionOverlay, scene, selectedLayerId, rootHandle, onAssetReady) {
  clearContainer(content);
  const handles = new Map();
  const orientation = scene.stage.activeOrientation;

  // Build per-canvas trees and walk depth-first; each layer's Pixi object
  // is added as a child of its parent layer's object (or directly to the
  // content root for top-level layers under the active canvas).
  const trees = buildLayerTree(scene);
  const activeCanvasId = scene.activeCanvasId || scene.canvases?.[0]?.id;

  const buildNode = async (node, pixiParent) => {
    const { layer, children } = node;
    if (!layer.visible) return;
    const asset = scene.assets.find((a) => a.id === layer.assetId);
    if (!asset) return;
    const obj = await buildLayerObject(asset, layer, rootHandle, scene.projectRoot || null);
    if (!obj) return;

    if (asset.type === 'spine' && onAssetReady) {
      try { onAssetReady(asset.id, describeSpine(obj)); }
      catch (e) { console.warn('[SceneStudio] describeSpine failed', e); }
    }

    const t = resolveTransform(layer, orientation);
    obj.label = layer.name;
    obj.x = t.x;
    obj.y = t.y;
    obj.scale.set(t.scaleX ?? 1, t.scaleY ?? 1);
    obj.rotation = t.rotation;
    if (obj.anchor) obj.anchor.set(t.anchor?.[0] ?? 0.5, t.anchor?.[1] ?? 0.5);

    pixiParent.addChild(obj);
    handles.set(layer.id, obj);

    for (const child of children) await buildNode(child, obj);
  };

  // Walk every canvas, but only show the active one for now (multi-canvas
  // visibility-as-overlay is a future feature). Top-level nodes' Pixi
  // parent = the content root, which already has the viewport transform.
  for (const canvas of scene.canvases || []) {
    if (canvas.id !== activeCanvasId) continue;
    if (canvas.visible === false) continue;
    const roots = trees.get(canvas.id) || [];
    for (const root of roots) await buildNode(root, content);
  }

  if (selectionOverlay) {
    const vScale = selectionOverlay.parent?.scale?.x ?? 1;
    drawSelection(selectionOverlay, handles.get(selectedLayerId), vScale, content);
  }
  if (app?.renderer) app.render();
  return handles;
}

async function buildLayerObject(asset, layer, rootHandle, sceneBasePath = null) {
  try {
    if (asset.type === 'png') {
      const resolved = await resolveAssetUrl(asset.src, rootHandle, sceneBasePath);
      if (!resolved) return null;
      const texture = await loadTextureFromUrl(resolved.url);
      return new Sprite(texture);
    }
    if (asset.type === 'spine') {
      const skelR = await resolveAssetUrl(asset.src, rootHandle, sceneBasePath);
      const atlasR = await resolveAssetUrl(asset.atlas, rootHandle, sceneBasePath);
      const texR = await resolveAssetUrl(asset.texture, rootHandle, sceneBasePath);
      if (!skelR || !atlasR || !texR) return null;
      const spine = await buildSpineFromUrls(skelR.url, atlasR.url, texR.url);
      applySpineState(spine, {
        animation: layer.spine?.defaultAnimation ?? null,
        loop:      layer.spine?.loop ?? true,
        skin:      layer.spine?.skin ?? null
      });
      // Cache base bounds so selection outline doesn't jitter during anim.
      snapshotSpineBounds(spine);
      // Spine doesn't have an anchor like Sprite — give it a no-op stub so
      // the shared transform code paths don't error.
      if (!spine.anchor) spine.anchor = { x: 0, y: 0, set() {} };
      // Mark so PixiViewport's drive RAF can find it. We turn off the
      // shared-ticker auto-update so we don't double-tick: the drive RAF
      // explicitly calls `spine.update(dt)` instead. This makes the
      // live-preview toggle authoritative — turning it off freezes spines
      // at the current frame instead of drifting because the shared ticker
      // kept running.
      spine.__isSpine = true;
      try { spine.autoUpdate = false; } catch { /* readonly in some builds */ }
      return spine;
    }
    if (asset.type === 'video') {
      const resolved = await resolveAssetUrl(asset.src, rootHandle, sceneBasePath);
      if (!resolved) return null;
      const vid = document.createElement('video');
      vid.src = resolved.url;
      vid.crossOrigin = 'anonymous';
      vid.muted = layer.video?.muted !== false;
      vid.loop = layer.video?.loop !== false;
      vid.playsInline = true;
      // Best-effort autoplay — browser may block until first user gesture.
      try { await vid.play(); } catch { /* user-gesture required */ }
      const texture = Texture.from(vid);
      return new Sprite(texture);
    }
  } catch (e) {
    console.warn('[SceneStudio] failed to build layer', asset?.type, e);
  }
  return null;
}

// Handle layout: 4 corners + 4 edge midpoints. Names indicate compass position.
// Each handle holds the world-space x,y where its marker is drawn.
export const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Unified metrics for any selectable object — Sprite (texture-based) or
 * Spine (bounds-based). Returns null if the object has no measurable
 * geometry.
 *   baseW/baseH = width/height at unit scale (in local space)
 *   ax/ay       = effective anchor (origin fraction within bounds)
 */
export function getObjectMetrics(obj) {
  if (!obj) return null;
  if (obj.texture && obj.texture.width != null) {
    return {
      baseW: obj.texture.width,
      baseH: obj.texture.height,
      ax: obj.anchor?.x ?? 0.5,
      ay: obj.anchor?.y ?? 0.5
    };
  }
  // Spine — use cached base bounds captured at build time so selection
  // doesn't jitter as the animation progresses.
  if (obj.__baseBounds) {
    const b = obj.__baseBounds;
    return {
      baseW: b.width,
      baseH: b.height,
      ax: b.width > 0 ? -b.x / b.width : 0.5,
      ay: b.height > 0 ? -b.y / b.height : 0.5
    };
  }
  try {
    const lb = obj.getLocalBounds?.();
    if (!lb || lb.width === 0 || lb.height === 0) return null;
    return {
      baseW: lb.width,
      baseH: lb.height,
      ax: lb.width > 0 ? -lb.x / lb.width : 0.5,
      ay: lb.height > 0 ? -lb.y / lb.height : 0.5
    };
  } catch { return null; }
}

/**
 * Convert a point from an object's local space all the way up to the
 * content root's coordinate system (= our "world"). Honours translation,
 * scale AND rotation at every parent level. Pixi v8 maintains accurate
 * `worldTransform` matrices but those go all the way to stage root
 * (including viewport's pan/zoom). We want viewport-local, so we walk
 * the chain manually and stop at `contentRoot`.
 */
export function localToContent(obj, localX, localY, contentRoot) {
  let x = localX, y = localY;
  let cur = obj;
  while (cur && cur !== contentRoot) {
    const c = Math.cos(cur.rotation || 0);
    const s = Math.sin(cur.rotation || 0);
    const sx = cur.scale?.x ?? 1;
    const sy = cur.scale?.y ?? 1;
    // Apply scale → rotation → translation (Pixi's matrix order)
    const sxX = x * sx;
    const syY = y * sy;
    const rx = sxX * c - syY * s;
    const ry = sxX * s + syY * c;
    x = rx + cur.x;
    y = ry + cur.y;
    cur = cur.parent;
  }
  return { x, y };
}

/**
 * Inverse of localToContent: given a content-space point, find the
 * corresponding local point inside the given parent's coord system.
 * Used by drag math to move a nested child correctly.
 */
export function contentToParentLocal(parent, contentX, contentY, contentRoot) {
  // Walk the chain UP from parent to content, collecting ancestor frames.
  const chain = [];
  let cur = parent;
  while (cur && cur !== contentRoot) { chain.push(cur); cur = cur.parent; }
  // Apply inverse of each frame from outermost to innermost.
  let x = contentX, y = contentY;
  for (let i = chain.length - 1; i >= 0; i--) {
    const fr = chain[i];
    const c = Math.cos(fr.rotation || 0);
    const s = Math.sin(fr.rotation || 0);
    const sx = fr.scale?.x ?? 1;
    const sy = fr.scale?.y ?? 1;
    // Inverse: translate, then rotate by -theta, then scale by 1/scale
    const tx = x - fr.x;
    const ty = y - fr.y;
    const rx = tx * c + ty * s;
    const ry = -tx * s + ty * c;
    x = rx / (sx || 1);
    y = ry / (sy || 1);
  }
  return { x, y };
}

/**
 * Compute the four oriented corners of an object's local bounds in
 * content (world) space. Result preserves rotation — corners are NOT
 * axis-aligned when the object is rotated.
 *
 * Returns:
 *   { corners: [nw, ne, se, sw], handles: { nw, n, ne, e, se, s, sw, w },
 *     bounds: { left, top, right, bottom } // AABB of the rotated quad
 *   }
 *
 * The eight handle positions sit on the actual rotated rectangle edges
 * (edge midpoints + corners), so they track the visual outline.
 */
export function getHandlePositions(obj, contentRoot = null) {
  const m = getObjectMetrics(obj);
  if (!m) return null;
  const baseW = m.baseW;
  const baseH = m.baseH;
  // Local rect corners (before obj.scale, before obj.rotation)
  const lx = -baseW * m.ax;
  const ly = -baseH * m.ay;
  const localCorners = {
    nw: { x: lx,            y: ly },
    ne: { x: lx + baseW,    y: ly },
    se: { x: lx + baseW,    y: ly + baseH },
    sw: { x: lx,            y: ly + baseH }
  };
  // Transform each to content space (this applies obj.scale + rotation + position + ancestors)
  const c = {};
  for (const k of ['nw', 'ne', 'se', 'sw']) c[k] = localToContent(obj, localCorners[k].x, localCorners[k].y, contentRoot);
  // Edge midpoints
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const handles = {
    nw: c.nw, ne: c.ne, se: c.se, sw: c.sw,
    n: mid(c.nw, c.ne), e: mid(c.ne, c.se), s: mid(c.sw, c.se), w: mid(c.nw, c.sw)
  };
  // AABB of the rotated quad — used for hit-test fast-reject and snapping
  const xs = [c.nw.x, c.ne.x, c.se.x, c.sw.x];
  const ys = [c.nw.y, c.ne.y, c.se.y, c.sw.y];
  const left = Math.min(...xs), right = Math.max(...xs);
  const top  = Math.min(...ys), bottom = Math.max(...ys);
  return {
    ...handles,
    corners: [c.nw, c.ne, c.se, c.sw],
    bounds: { left, top, right, bottom, w: right - left, h: bottom - top, baseW, baseH, ax: m.ax, ay: m.ay }
  };
}

/**
 * Test whether a content-space point falls inside the oriented bounds
 * of `obj`. Returns true if the point is inside the rotated rectangle.
 */
export function pointInsideObject(obj, contentX, contentY, contentRoot = null) {
  if (!obj || !obj.parent) return false;
  // Convert content point into obj's LOCAL space, then test against local rect
  const local = contentToParentLocal(obj, contentX, contentY, contentRoot);
  const m = getObjectMetrics(obj);
  if (!m) return false;
  const lx = -m.baseW * m.ax;
  const ly = -m.baseH * m.ay;
  return local.x >= lx && local.x <= lx + m.baseW && local.y >= ly && local.y <= ly + m.baseH;
}

/**
 * Sample a clip's `position` channel finely and trace its motion path
 * into `overlay`. Stroke colour modulated by sampled tint; stroke alpha
 * modulated by sampled alpha; stroke width hints at sampled scale.
 * Returns true if anything was drawn (the caller skips this step
 * otherwise to avoid empty redraws).
 */
function channelKeyTimes(ch) {
  if (!ch) return [];
  if (ch.split && ch.perComp) {
    const set = new Set();
    for (const c of Object.values(ch.perComp)) {
      for (const k of c?.keys || []) set.add(Number(k.t.toFixed(6)));
    }
    return [...set].sort((a, b) => a - b);
  }
  return (ch.keys || []).map((k) => k.t);
}

function drawMotionPath(overlay, clip, viewportScale = 1, baseT = null, obj = null, contentRoot = null) {
  const posCh = clip?.channels?.position;
  if (!posCh) return { drawn: false, keyDots: [], pathHandles: [] };
  // Path mode draws unconditionally (it's a spatial spline, not key-timed).
  // Otherwise position is animated when it has ≥2 linked keys OR any split
  // sub-list pushes the union of key times to ≥2 distinct moments.
  const pathMode = isPathChannel(posCh);
  const keyTimes = pathMode ? [] : channelKeyTimes(posCh);
  if (!pathMode && keyTimes.length < 2) return { drawn: false, keyDots: [], pathHandles: [] };
  const scaleCh = clip.channels.scale;
  const alphaCh = clip.channels.alpha;
  const tintCh = clip.channels.tint;

  // Position channel values are in obj's parent-local space (= content space
  // for top-level layers). For nested layers the parent may have its own
  // scale/rotation, so we transform each sample through the parent chain to
  // get content/world-space coordinates that line up with the sprite on screen.
  const hasParent = obj?.parent && contentRoot && obj.parent !== contentRoot;
  const toWorld = hasParent
    ? (p) => localToContent(obj.parent, p.x, p.y, contentRoot)
    : (p) => p;

  const duration = Math.max(0.001, Number(clip.duration) || 1);
  // ~80 samples — enough for smooth visualisation, cheap to draw.
  const samples = Math.max(40, Math.min(160, Math.round(duration * 80)));
  const baseStrokeBase = 2 / viewportScale;

  // Collect sample positions (world-space) for the direction-arrow pass below.
  const posSamples = [];
  let prev = null;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * duration;
    const pos = evalChannel(posCh, t, 'position');
    if (!pos) { posSamples.push(null); continue; }
    const wp = toWorld(pos);
    posSamples.push(wp);
    const alpha = alphaCh ? Math.max(0.1, Math.min(1, evalChannel(alphaCh, t, 'alpha'))) : 0.85;
    const tint = tintCh ? evalChannel(tintCh, t, 'tint') : (baseT?.tint || { r: 1, g: 0.82, b: 0.4 });
    const scaleV = scaleCh ? evalChannel(scaleCh, t, 'scale') : { x: 1, y: 1 };
    const scaleMag = scaleV ? (Math.abs(scaleV.x) + Math.abs(scaleV.y)) * 0.5 : 1;

    const r = Math.max(0, Math.min(255, Math.round((tint?.r ?? 1) * 255)));
    const g = Math.max(0, Math.min(255, Math.round((tint?.g ?? 1) * 255)));
    const b = Math.max(0, Math.min(255, Math.round((tint?.b ?? 1) * 255)));
    const color = (r << 16) | (g << 8) | b;
    const width = baseStrokeBase * (0.7 + 0.6 * Math.min(2, Math.max(0.25, scaleMag)));

    if (prev) {
      overlay
        .moveTo(prev.x, prev.y)
        .lineTo(wp.x, wp.y)
        .stroke({ color, width, alpha });
    }
    prev = wp;
  }

  // Direction arrows — small filled triangles every ~12% of samples.
  const arrowStep = Math.max(4, Math.round(samples / 8));
  const arrowSize = 10 / viewportScale;
  for (let i = arrowStep; i <= samples; i += arrowStep) {
    const cur = posSamples[i];
    const bk = posSamples[Math.max(0, i - 1)];
    if (!cur || !bk) continue;
    const dx = cur.x - bk.x;
    const dy = cur.y - bk.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;
    const nx = dx / len;
    const ny = dy / len;
    const px = -ny;
    const py = nx;
    overlay
      .poly([
        cur.x,                                       cur.y,
        cur.x - nx * arrowSize - px * arrowSize * 0.5, cur.y - ny * arrowSize - py * arrowSize * 0.5,
        cur.x - nx * arrowSize + px * arrowSize * 0.5, cur.y - ny * arrowSize + py * arrowSize * 0.5,
      ])
      .fill({ color: 0xffffff, alpha: 0.7 });
  }

  // Path mode: draw control-point dials + tangent handles and return their
  // world positions so the viewport controller can hit-test + drag them.
  if (pathMode) {
    const points = posCh.path.points || [];
    const H = resolvePointHandles(points);
    const pathHandles = [];
    const dotR = 6 / viewportScale;
    const hR = 4.5 / viewportScale;
    const lineW = 1.5 / viewportScale;
    for (let i = 0; i < points.length; i++) {
      const wp = toWorld(points[i]);
      const wo = toWorld({ x: H[i].outX, y: H[i].outY });
      const wi = toWorld({ x: H[i].inX, y: H[i].inY });
      overlay
        .moveTo(wi.x, wi.y).lineTo(wp.x, wp.y).lineTo(wo.x, wo.y)
        .stroke({ color: 0x4f9eff, width: lineW, alpha: 0.55 });
      overlay.circle(wi.x, wi.y, hR).fill({ color: 0x4f9eff, alpha: 0.9 });
      overlay.circle(wo.x, wo.y, hR).fill({ color: 0x4f9eff, alpha: 0.9 });
      pathHandles.push({ kind: 'in', index: i, x: wi.x, y: wi.y });
      pathHandles.push({ kind: 'out', index: i, x: wo.x, y: wo.y });
      overlay
        .circle(wp.x, wp.y, dotR)
        .fill({ color: 0xffd166, alpha: 0.95 })
        .stroke({ color: 0x1a1d24, width: lineW, alpha: 1 });
      pathHandles.push({ kind: 'point', index: i, x: wp.x, y: wp.y });
    }
    return { drawn: true, keyDots: [], pathHandles };
  }

  // Dots at each keyframe time — also returned for viewport hit-testing.
  const dotR = 5 / viewportScale;
  const keyDots = [];
  for (const t of keyTimes) {
    const p = evalChannel(posCh, t, 'position');
    if (!p) continue;
    const wp = toWorld(p);
    overlay
      .circle(wp.x, wp.y, dotR)
      .fill({ color: 0xffffff, alpha: 0.95 })
      .stroke({ color: 0x1a1d24, width: 1.5 / viewportScale, alpha: 1 });
    keyDots.push({ t, x: wp.x, y: wp.y, absT: (clip.start || 0) + t });
  }
  return { drawn: true, keyDots, pathHandles: [] };
}

/** Draw selection rectangle + 8 resize handles in world space.
 *  Returns `{ keyDots, pathHandles }` in world space so the viewport
 *  controller can hit-test motion-path key dots (click-to-seek) and
 *  path-mode control dials (drag-to-edit). */
export function drawSelection(overlay, obj, viewportScale = 1, contentRoot = null, guides = null, selectedClip = null, baseT = null) {
  overlay.clear();
  let keyDots = [];
  let pathHandles = [];
  if (selectedClip) {
    const mp = drawMotionPath(overlay, selectedClip, viewportScale, baseT, obj, contentRoot);
    keyDots = mp.keyDots || [];
    pathHandles = mp.pathHandles || [];
  }
  if (Array.isArray(guides) && guides.length) {
    const gw = 1 / viewportScale;
    for (const g of guides) {
      overlay.moveTo(g.x1, g.y1).lineTo(g.x2, g.y2).stroke({ color: 0x4f9eff, width: gw, alpha: 0.9 });
    }
  }
  const handles = getHandlePositions(obj, contentRoot);
  if (!handles) return { keyDots, pathHandles };
  const strokeW = 2 / viewportScale;
  const [nw, ne, se, sw] = handles.corners;
  overlay
    .moveTo(nw.x, nw.y)
    .lineTo(ne.x, ne.y)
    .lineTo(se.x, se.y)
    .lineTo(sw.x, sw.y)
    .lineTo(nw.x, nw.y)
    .stroke({ color: 0xffd166, width: strokeW, alpha: 0.95 });
  // Handle markers — constant 9px on screen
  const m = 9 / viewportScale;
  for (const name of HANDLE_NAMES) {
    const p = handles[name];
    overlay.rect(p.x - m / 2, p.y - m / 2, m, m).fill({ color: 0xffd166, alpha: 1 });
    overlay.rect(p.x - m / 2, p.y - m / 2, m, m).stroke({ color: 0x1a1d24, width: 1 / viewportScale, alpha: 1 });
  }
  return { keyDots, pathHandles };
}

/** Resize the renderer canvas to match its DOM container. */
export function resizeRenderer(app, canvasW, canvasH) {
  app.renderer.resize(canvasW, canvasH);
}

/**
 * Cheap path: only transforms changed → update existing handles in place,
 * no destroy/create, no async asset loads.
 *
 * Guards against stale handles (post-destroy) so a transform tick that
 * races with a rebuild won't blow up.
 */
export function syncTransforms(app, handles, scene) {
  if (!handles) return;
  const orientation = scene.stage.activeOrientation;
  for (const layer of scene.layers) {
    const obj = handles.get(layer.id);
    if (!obj || obj.destroyed) continue;
    obj.visible = layer.visible;
    const t = resolveTransform(layer, orientation);
    obj.x = t.x;
    obj.y = t.y;
    if (obj.scale?.set) obj.scale.set(t.scaleX ?? 1, t.scaleY ?? 1);
    obj.rotation = t.rotation;
    if (obj.anchor?.set && t.anchor) obj.anchor.set(t.anchor[0] ?? 0.5, t.anchor[1] ?? 0.5);
    // Alpha + tint (Round 4). Defaults sit in normalizeTransform so older
    // scenes loading without these fields still get sensible values.
    obj.alpha = typeof t.alpha === 'number' ? Math.max(0, Math.min(1, t.alpha)) : 1;
    const tint = t.tint || { r: 1, g: 1, b: 1 };
    const r = Math.max(0, Math.min(255, Math.round((tint.r ?? 1) * 255)));
    const g = Math.max(0, Math.min(255, Math.round((tint.g ?? 1) * 255)));
    const b = Math.max(0, Math.min(255, Math.round((tint.b ?? 1) * 255)));
    try { obj.tint = (r << 16) | (g << 8) | b; } catch { /* spine container may reject */ }
  }
  if (app?.renderer) app.render();
}

/**
 * Build a structural hash of a scene — everything that, when changed,
 * requires us to tear down and rebuild the Pixi scene graph. Pure
 * transform / visibility / blend changes don't bump the hash; those go
 * through the cheap syncTransforms path.
 */
export function sceneStructuralHash(scene) {
  const parts = [];
  for (const c of scene.canvases || []) parts.push('c:', c.id, c.visible ? '1' : '0');
  parts.push('|a|');
  for (const a of scene.assets) parts.push(a.id, a.type, a.src?.slice?.(0, 32) || '');
  parts.push('|l|');
  // Layer order + parentage are structural — reorder/reparent must rebuild
  // the Pixi tree (children physically move between containers).
  for (const l of scene.layers) {
    parts.push(
      l.id, l.assetId,
      l.canvasId || '-',
      l.parentId || '-',
      l.spine ? JSON.stringify(l.spine) : '-',
      l.video ? JSON.stringify(l.video) : '-'
    );
  }
  return parts.join(':');
}

function validSpeed(clip) {
  const n = Number(clip?.speed);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function getSpineAnimationDuration(obj, animationName) {
  if (!animationName || !obj?.skeleton?.data) return null;
  try {
    const anim = obj.skeleton.data.findAnimation?.(animationName)
      || obj.skeleton.data.animations?.find((a) => a.name === animationName)
      || null;
    const d = Number(anim?.duration);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

function autoMixDurationForTransition(obj, layer, track, clip) {
  const clips = track?.clips || [];
  const idx = clips.findIndex((c) => c.id === clip.id);
  if (idx <= 0) return 0;
  const prev = clips[idx - 1];
  if (!prev) return 0;
  if (prev.start + prev.duration > clip.start + 1e-4) return 0.12;

  const prevAnim = prev.anim ?? layer.spine?.defaultAnimation ?? null;
  const prevAnimDuration = getSpineAnimationDuration(obj, prevAnim);
  const prevCycle = prevAnimDuration ? (prevAnimDuration / validSpeed(prev)) : null;
  const prevInterrupted = prev.loop !== false || !prevCycle || (prev.duration + 1e-4 < prevCycle);
  return prevInterrupted ? 0.12 : 0;
}

function resolveMixDuration(obj, layer, track, clip) {
  const explicit = Number(clip?.mixDuration);
  if (clip?.mixDuration != null) {
    if (!Number.isFinite(explicit) || explicit < 0) return 0;
    return explicit;
  }
  return autoMixDurationForTransition(obj, layer, track, clip);
}

/**
 * Apply timeline/flow state to already-built Pixi objects.
 *
 * Multi-track per layer is supported (see SCENE_STUDIO.md §19):
 *  - Spine layers: each track maps to a Spine `state.setAnimation(idx, …)`.
 *    Tracks without an active clip clear that index (`setEmptyAnimation`).
 *  - PNG layers: tracks with a `tween` payload override the base pose
 *    last-wins per property. Tracks without a tween are no-ops.
 *  - Video layers use only the first track; multi-track video is N/A.
 *
 * Visibility is `layer.visible` only — "outside any clip" means the layer
 * renders at its base pose (the inspector's transform fields). This is
 * the source-of-truth rule from §19.2.
 *
 * This pass never rebuilds the scene graph. `syncTransforms` runs first
 * and writes base values; this function only overrides for layers where
 * at least one active clip declares an override.
 */
export function applyFlowAtTime(handles, scene, t) {
  if (!handles || !scene) return;
  const runtime = scene.flow?.runtime || {};
  const runtimePlaying = runtime.playing !== false;
  const runtimeHeld = !!runtime.hold;
  const orientation = scene.stage.activeOrientation;

  for (const layer of scene.layers) {
    const obj = handles.get(layer.id);
    if (!obj || obj.destroyed) continue;
    obj.visible = layer.visible !== false;
    if (!obj.visible) continue;

    const asset = scene.assets.find((a) => a.id === layer.assetId);
    if (!asset) continue;
    const tracks = tracksForLayer(scene, layer.id);

    if (asset.type === 'spine' && obj.state && obj.skeleton) {
      applySpineMultiTrack(obj, layer, tracks, t);
      // Alpha + tint channels also apply on Spine layers so the user
      // can fade / colourise the whole skeleton from the timeline.
      applyPngChannels(obj, layer, tracks, t, orientation, { alphaAndTintOnly: true });
      continue;
    }

    if (asset.type === 'video' && obj.texture?.source?.resource?.source) {
      applyVideoClip(obj, tracks[0], t, runtimePlaying, runtimeHeld);
      applyPngChannels(obj, layer, tracks, t, orientation, { alphaAndTintOnly: true });
      continue;
    }

    if (asset.type === 'png' || asset.type === 'pngSequence') {
      applyPngChannels(obj, layer, tracks, t, orientation);
    }
  }
}

/**
 * Walk every track on a Spine layer and reflect it onto the Spine
 * AnimationState. Track index = position in the per-layer subset, so a
 * layer with 3 tracks fills slots 0, 1, 2. Tracks without an active clip
 * clear their slot with a short empty-animation crossfade.
 */
function applySpineMultiTrack(obj, layer, tracks, t) {
  obj.__flow = obj.__flow || { perTrack: new Map() };
  if (!obj.__flow.perTrack) obj.__flow.perTrack = new Map();
  const perTrack = obj.__flow.perTrack;
  const seen = new Set();

  tracks.forEach((track, idx) => {
    seen.add(idx);
    const clip = clipAt(track, t);
    const cache = perTrack.get(idx) || {};
    if (!clip) {
      if (cache.activeClipId !== null) {
        try { obj.state.setEmptyAnimation(idx, cache.mixDuration ?? 0.1); }
        catch { /* ignore */ }
        perTrack.set(idx, { activeClipId: null, anim: null, loop: null, mixDuration: 0 });
      }
      return;
    }
    const anim = clip.anim ?? layer.spine?.defaultAnimation ?? null;
    const animDuration = getSpineAnimationDuration(obj, anim);
    const loop = clip.loop !== false;
    const mixDuration = resolveMixDuration(obj, layer, track, clip);
    if (cache.activeClipId !== clip.id || cache.anim !== anim || cache.loop !== loop) {
      try {
        if (anim) {
          const e = obj.state.setAnimation(idx, anim, !!loop);
          if (e) {
            e.mixDuration = mixDuration;
            if (mixDuration > 0) {
              const sinceClipStart = Math.max(0, t - clip.start);
              e.mixTime = Math.min(mixDuration, sinceClipStart);
            }
          }
        } else {
          obj.state.setEmptyAnimation(idx, mixDuration);
        }
      } catch { /* anim missing — ignore */ }
      perTrack.set(idx, { activeClipId: clip.id, anim, loop, mixDuration });
    }
    try {
      const tr = obj.state?.tracks?.[idx];
      if (tr) {
        tr.trackTime = remapClipTime(clip, t, animDuration);
        if (mixDuration > 0) {
          const sinceClipStart = Math.max(0, t - clip.start);
          tr.mixTime = Math.min(mixDuration, sinceClipStart);
        }
      }
    } catch { /* ignore */ }
  });

  // Slots that no longer have a corresponding track entry get cleared so
  // a removed track stops bleeding through.
  for (const [idx] of perTrack) {
    if (seen.has(idx)) continue;
    try { obj.state.setEmptyAnimation(idx, 0.1); }
    catch { /* ignore */ }
    perTrack.delete(idx);
  }

  // IMPORTANT: in paused/scrub mode we still need a deterministic pose
  // refresh right now. `obj.update(0)` applies the current track state
  // without advancing time, so seeking the timeline updates instantly.
  if (typeof obj.update === 'function') {
    try {
      obj.update(0);
      return;
    } catch {
      /* fallback below */
    }
  }

  try {
    obj.state.apply(obj.skeleton);
    obj.skeleton.updateWorldTransform?.(0);
  } catch { /* ignore */ }
}

/**
 * Video clip = single track, single clip. Seeks the underlying
 * HTMLVideoElement to the clip-local time and pauses / resumes in lock-step
 * with the global playhead.
 */
function applyVideoClip(obj, track, t, runtimePlaying, runtimeHeld) {
  const video = obj.texture?.source?.resource?.source;
  if (!video || video.nodeName?.toLowerCase() !== 'video') return;
  const clip = clipAt(track, t);
  if (!clip) {
    if (!video.paused) { try { video.pause(); } catch {} }
    return;
  }
  const sourceDuration = Number.isFinite(Number(video.duration)) && Number(video.duration) > 0
    ? Number(video.duration)
    : null;
  const desired = remapClipTime(clip, t, sourceDuration);
  if (Math.abs((video.currentTime || 0) - desired) > 0.09) {
    try { video.currentTime = desired; } catch { /* ignore */ }
  }
  if (runtimePlaying && !runtimeHeld && video.paused) {
    try { video.play(); } catch { /* gesture required */ }
  } else if ((!runtimePlaying || runtimeHeld) && !video.paused) {
    try { video.pause(); } catch { /* ignore */ }
  }
}

/**
 * Walk every logical channel on the latest active clip per track on a PNG
 * layer and override the base pose written by `syncTransforms`. Channels
 * are clip-local — `clipLocalSeconds` honours loop + speed and clamps
 * times past the end of a non-looping clip so the sprite holds its last
 * keyframe instead of snapping back to base pose. Multiple tracks
 * animating the same channel = last-wins (array order).
 */
function applyPngChannels(obj, layer, tracks, t, orientation, opts = {}) {
  if (!tracks.length) return;
  const baseT = orientation === 'portrait'
    ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
    : layer.transforms?.landscape;
  if (!baseT) return;

  const namesToApply = opts.alphaAndTintOnly
    ? CHANNEL_NAMES.filter((n) => n === 'alpha' || n === 'tint')
    : CHANNEL_NAMES;

  for (const track of tracks) {
    const clip = lastClipAt(track, t);
    if (!clip?.channels) continue;
    const localT = clipLocalSeconds(clip, t, { clampPastEnd: true });
    for (const name of namesToApply) {
      const ch = clip.channels[name];
      if (!ch) continue;
      // A channel is "live" when it has linked keys OR any split sub-list
      // has keys OR it's a path-mode position. Skip empty channels so they
      // don't override base pose.
      const hasLinked = ch.keys?.length;
      const hasSplit = ch.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length);
      if (!hasLinked && !hasSplit && !isPathChannel(ch)) continue;
      const val = evalChannel(ch, localT, name);
      if (val == null) continue;
      CHANNEL_DEFS[name]?.apply?.(obj, val);
    }
  }
}
