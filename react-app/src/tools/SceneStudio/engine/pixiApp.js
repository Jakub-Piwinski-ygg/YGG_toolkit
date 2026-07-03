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
import { CHANNEL_DEFS, CHANNEL_NAMES, channelFirstKeyTime, clipLocalSeconds, evalChannel, isPathChannel } from './animation/keyframes.js';
import { resolvePointHandles } from './animation/pathSpline.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { buildSpineFromUrls, loadSkeletonData, applySpineState, describeSpine, snapshotSpineBounds } from './spineLoader.js';
import { buildSpinnerObject, applySpinnerAtTime } from './spinner/spinnerRuntime.js';
import { applyWinSeqAtTime, resetWinSeqState, applyWinSeqSetupPose, winSeqDurationsFromSpine } from './winseq/winseqRuntime.js';
import { normalizeWinSeqConfig } from './winseq/winseqModel.js';
import { normalizeWinNumber, isTemplateFont, templateFontUrl } from './winseq/winNumberModel.js';
import { buildWinNumberContainer } from './winseq/winNumberView.js';
import { applyWinNumberAtTime } from './winseq/winNumberRuntime.js';

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

  // Device-view guide image (e.g. landscape / portrait safe-zone maps), shown
  // for the 'device-*' overlay modes. Hidden otherwise.
  const deviceGuide = new Sprite();
  deviceGuide.label = 'deviceGuide';
  deviceGuide.anchor.set(0.5);
  deviceGuide.visible = false;
  deviceGuide.eventMode = 'none';
  viewport.addChild(deviceGuide);

  // Dim overlay: greys out everything OUTSIDE the in-view region (the stage for
  // 'frame in front', or the guide bounds for device modes) so the workable /
  // device-visible area stands out. Sits above content + guide, below selection.
  const dimOverlay = new Graphics();
  dimOverlay.label = 'dimOverlay';
  dimOverlay.eventMode = 'none';
  viewport.addChild(dimOverlay);

  const selectionOverlay = new Graphics();
  selectionOverlay.label = 'selectionOverlay';
  viewport.addChild(selectionOverlay);

  return { app, viewport, content, stageFrame, deviceGuide, dimOverlay, selectionOverlay };
}

/**
 * Grey out everything OUTSIDE `clearRect` ({x,y,w,h}) by painting four large
 * dark bands around it. The extent is large enough to cover the viewport at
 * any pan/zoom. `clearRect` null → clears the overlay (no dimming).
 */
export function drawDimOverlay(g, clearRect, alpha = 0.5) {
  if (!g) return;
  g.clear();
  if (!clearRect) return;
  const { x, y, w, h } = clearRect;
  const BIG = 100000;
  const col = 0x05070b;
  g.rect(x - BIG, y - BIG, w + 2 * BIG, BIG).fill({ color: col, alpha });          // top
  g.rect(x - BIG, y + h, w + 2 * BIG, BIG).fill({ color: col, alpha });            // bottom
  g.rect(x - BIG, y, BIG, h).fill({ color: col, alpha });                          // left
  g.rect(x + w, y, BIG, h).fill({ color: col, alpha });                            // right
}

// Device-view guide images (public/sceneStudio/). Cached as load promises.
const DEVICE_GUIDE_URLS = {
  'device-landscape': 'sceneStudio/DeviceViewLanscape.png',
  'device-portrait': 'sceneStudio/DeviceViewPortrait.png'
};
const deviceGuideTexCache = new Map();

/** Load (and cache) the guide texture for a device-view overlay mode, or null. */
export function loadDeviceGuideTexture(mode) {
  const rel = DEVICE_GUIDE_URLS[mode];
  if (!rel) return Promise.resolve(null);
  if (deviceGuideTexCache.has(mode)) return deviceGuideTexCache.get(mode);
  const base = (import.meta?.env?.BASE_URL) || '/';
  const url = (base.endsWith('/') ? base : base + '/') + rel;
  const p = loadTextureFromUrl(url).catch(() => null);
  deviceGuideTexCache.set(mode, p);
  return p;
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
  if (overlayMode === 'behind') {
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
  // Any non-'behind' mode (frame in front + device guides) floats above content.
  const above = overlayMode !== 'behind';
  if (above && frameIdx < contentIdx) {
    viewport.removeChild(stageFrame);
    // content index shifts down by 1 after removal; insert right after it
    viewport.addChildAt(stageFrame, children.indexOf(content) + 1);
  } else if (!above && frameIdx > contentIdx) {
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
export async function rebuildScene(app, content, selectionOverlay, scene, selectedLayerId, rootHandle, onAssetReady, onSpinnerAnimDurations) {
  clearContainer(content);
  const handles = new Map();
  // Every `blob:` URL minted while resolving this build's assets is collected
  // here so the caller (PixiViewport) can revoke / Assets.unload the PREVIOUS
  // build generation once this one is live — bounding the memory of a "refresh
  // assets" loop. Attached to the returned Map as a non-enumerable-ish field.
  const blobUrls = new Set();
  const orientation = scene.stage.activeOrientation;

  // Build per-canvas trees and walk depth-first; each layer's Pixi object
  // is added as a child of its parent layer's object (or directly to the
  // content root for top-level layers under the active canvas).
  const trees = buildLayerTree(scene);
  const activeCanvasId = scene.activeCanvasId || scene.canvases?.[0]?.id;

  const buildNode = async (node, pixiParent) => {
    const { layer, children } = node;
    // NB: build hidden layers too (just mark them invisible). Skipping them
    // meant a layer created hidden — e.g. a Scene-Setup mode group — had no Pixi
    // object, so toggling its visibility later showed nothing until a full
    // rebuild. Building it lets the cheap-path visibility toggle work live.
    const asset = scene.assets.find((a) => a.id === layer.assetId);
    if (!asset) return;
    const obj = await buildLayerObject(asset, layer, rootHandle, scene.projectRoot || null, scene, onSpinnerAnimDurations, blobUrls);
    if (!obj) return;
    obj.visible = layer.visible !== false;

    if ((asset.type === 'spine' || asset.type === 'winseq') && onAssetReady) {
      try { onAssetReady(asset.id, describeSpine(obj)); }
      catch (e) { console.warn('[SceneStudio] describeSpine failed', e); }
    }

    const t = resolveTransform(layer, orientation, scene.stage);
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
  handles.__blobUrls = blobUrls;
  return handles;
}

// Factory for the spinner's land/win Spine overlay pool
// (spinnerRuntime.js deps.createSpineContainer). SkeletonData is memoized per
// assetId so the pool's N instances share one fetch/parse and atlas texture.
// Overlay spines are scrub-driven only: autoUpdate off, no __isSpine mark, so
// neither the shared ticker nor the live-preview RAF advances them —
// setTrackTime(t) is the single source of pose truth.
function makeSpineOverlayFactory(scene, rootHandle, sceneBasePath, urlSink = null) {
  const rec = (r) => { if (urlSink && r?.url && r.url.startsWith('blob:')) urlSink.add(r.url); return r; };
  const dataCache = new Map(); // assetId → Promise<SkeletonData|null>
  const skeletonDataFor = (assetId) => {
    if (!dataCache.has(assetId)) {
      dataCache.set(assetId, (async () => {
        const asset = (scene?.assets || []).find((a) => a.id === assetId && a.type === 'spine');
        if (!asset) return null;
        const skelR = rec(await resolveAssetUrl(asset.src, rootHandle, sceneBasePath));
        const atlasR = rec(await resolveAssetUrl(asset.atlas, rootHandle, sceneBasePath));
        const texR = rec(await resolveAssetUrl(asset.texture, rootHandle, sceneBasePath));
        if (!skelR || !atlasR || !texR) return null;
        return await loadSkeletonData(skelR.url, atlasR.url, texR.url);
      })().catch((e) => {
        console.warn('[SceneStudio] spinner overlay spine load failed', assetId, e);
        return null;
      }));
    }
    return dataCache.get(assetId);
  };
  return async function createSpineContainer(assetId, animName, loop) {
    const skeletonData = await skeletonDataFor(assetId);
    const animData = skeletonData ? skeletonData.findAnimation(animName) : null;
    if (!skeletonData || !animData) return null;
    try {
      const spine = new Spine(skeletonData);
      spine.state.setAnimation(0, animName, !!loop);
      try { spine.autoUpdate = false; } catch { /* readonly in some builds */ }
      return {
        container: spine,
        // Real animation length (seconds) from the Spine data — the runtime
        // writes this into the symbol's winAnim/landAnim.duration so the win
        // window matches the actual anim and never cuts off at a fixed default.
        duration: Number(animData.duration) || 0,
        setTrackTime(t) {
          const tr = spine.state.tracks[0];
          if (tr) tr.trackTime = t;
          // Deterministic pose refresh without advancing time — same scrub
          // pattern as applySpineMultiTrack.
          try { spine.update(0); } catch { /* ignore */ }
        }
      };
    } catch (e) {
      console.warn('[SceneStudio] spinner overlay spine instantiation failed', assetId, animName, e);
      return null;
    }
  };
}

async function buildLayerObject(asset, layer, rootHandle, sceneBasePath = null, scene = null, onSpinnerAnimDurations = null, urlSink = null) {
  // Record every blob: URL minted for this layer so the previous build
  // generation can be revoked/unloaded when the next build goes live.
  const rec = (r) => { if (urlSink && r?.url && r.url.startsWith('blob:')) urlSink.add(r.url); return r; };
  const resolve = async (src) => rec(await resolveAssetUrl(src, rootHandle, sceneBasePath));
  try {
    if (asset.type === 'spinner') {
      return await buildSpinnerObject(asset, layer, {
        scene,
        rootHandle,
        sceneBasePath,
        resolveAssetUrl: async (src, rh, bp) => rec(await resolveAssetUrl(src, rh, bp)),
        loadTexture: loadTextureFromUrl,
        createSpineContainer: makeSpineOverlayFactory(scene, rootHandle, sceneBasePath, urlSink),
        // Persist resolved per-symbol Spine durations back to the model so the
        // inspector's clip-length button and the Unity bake see real lengths.
        onSpinnerAnimDurations: onSpinnerAnimDurations
          ? (symbols) => onSpinnerAnimDurations(asset.id, symbols)
          : null
      });
    }
    if (asset.type === 'png') {
      const resolved = await resolve(asset.src);
      if (!resolved) return null;
      const texture = await loadTextureFromUrl(resolved.url);
      return new Sprite(texture);
    }
    if (asset.type === 'empty') {
      // A transform-only group parent (no visual). Children parent under it so
      // moving/scaling/rotating this node drives the whole group. A default
      // selection box makes it grabbable in the viewport.
      const c = new Container();
      c.__baseBounds = { x: -60, y: -60, width: 120, height: 120 };
      if (!c.anchor) c.anchor = { x: 0.5, y: 0.5, set() {} };
      return c;
    }
    if (asset.type === 'spine') {
      const skelR = await resolve(asset.src);
      const atlasR = await resolve(asset.atlas);
      const texR = await resolve(asset.texture);
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
    if (asset.type === 'winseq') {
      // A win-sequence object IS a Spine (win_sequence.json). It is driven
      // entirely by applyWinSeqAtTime (deterministic, t-driven) — so it is
      // NOT marked __isSpine (the live-preview RAF must not auto-advance it).
      const config = normalizeWinSeqConfig(asset.winseq);
      if (!config) return null;
      const skelR = await resolve(asset.src);
      const atlasR = await resolve(asset.atlas);
      const texR = await resolve(asset.texture);
      if (!skelR || !atlasR || !texR) return null;
      const spine = await buildSpineFromUrls(skelR.url, atlasR.url, texR.url);
      // Start on the setup pose; applyWinSeqAtTime takes over per frame.
      applySpineState(spine, { animation: null, loop: false, skin: null });
      snapshotSpineBounds(spine);
      if (!spine.anchor) spine.anchor = { x: 0, y: 0, set() {} };
      try { spine.autoUpdate = false; } catch { /* readonly in some builds */ }
      spine.__winseq = { config, durations: winSeqDurationsFromSpine(spine) };
      spine.__wsCache = { anim: null, loop: null };
      // Show the setup default pose so a freshly-built object is visible for
      // positioning in setup mode; animate mode's applyWinSeqAtTime overrides.
      applyWinSeqSetupPose(spine);
      return spine;
    }
    if (asset.type === 'winnumber') {
      // The count-up win-number display. A child of its parent win-sequence
      // layer (so its Pixi object lives under the Spine container). Config is
      // the single source of truth on the PARENT winseq asset
      // (parent.winseq.number); this asset stores none of its own.
      const parent = (scene?.assets || []).find((a) => a.id === asset.parentAssetId && a.type === 'winseq');
      const num = normalizeWinNumber(parent?.winseq?.number);
      if (!num) return null;
      const fontR = isTemplateFont(num.fontSrc) ? { url: templateFontUrl() } : await resolve(num.fontSrc);
      if (!fontR) return null;
      const baseTex = await loadTextureFromUrl(fontR.url);
      const container = buildWinNumberContainer(baseTex.source, num);
      container.__winnumber = { num, parentAssetId: asset.parentAssetId };
      // Transform-code stub (matches the Spine/Sprite anchor contract).
      if (!container.anchor) container.anchor = { x: 0, y: 0, set() {} };
      return container;
    }
    if (asset.type === 'video') {
      const resolved = await resolve(asset.src);
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

// Scene model blend → Pixi v8 blend-mode string. normal/add/screen/multiply are
// all GPU-native in Pixi v8 (no advanced-blend-modes import needed).
const BLEND_PIXI = { normal: 'normal', additive: 'add', screen: 'screen', multiply: 'multiply' };

/**
 * Apply a layer's blend mode to its display object. Sprites take it directly;
 * Spine / spinner objects render through child meshes, so the mode is pushed
 * down the whole subtree. Cached on the object (mode + child count) so the
 * per-frame syncTransforms call doesn't re-walk the tree unless something
 * actually changed.
 */
export function applyBlendMode(obj, blend) {
  if (!obj) return;
  const mode = BLEND_PIXI[blend] || 'normal';
  const n = obj.children?.length || 0;
  if (obj.__blendApplied === mode && obj.__blendChildCount === n) return;
  obj.__blendApplied = mode;
  obj.__blendChildCount = n;
  try { obj.blendMode = mode; } catch { /* some containers reject */ }
  if (n) {
    const stack = obj.children.slice();
    while (stack.length) {
      const c = stack.pop();
      try { c.blendMode = mode; } catch { /* ignore */ }
      if (c.children && c.children.length) for (const gc of c.children) stack.push(gc);
    }
  }
}

/**
 * Unified metrics for any selectable object — Sprite (texture-based) or
 * Spine (bounds-based). Returns null if the object has no measurable
 * geometry.
 *   baseW/baseH = width/height at unit scale (in local space)
 *   ax/ay       = effective anchor (origin fraction within bounds)
 */
export function getObjectMetrics(obj) {
  if (!obj) return null;
  // Every successful computation is cached on the object as `__lastMetrics`.
  // If a later call can't measure the geometry (a texture that hasn't loaded
  // yet, or a Spine whose live bounds momentarily collapse to 0×0), we fall
  // back to the last good value instead of returning null — otherwise the
  // object becomes silently un-clickable / un-draggable for that window, which
  // is one root of the intermittent "can't move/scale/rotate" bug
  // (PLAN_2026-07 B3).
  const remember = (m) => { if (m) obj.__lastMetrics = m; return m; };

  if (obj.texture && obj.texture.width != null && obj.texture.width > 0 && obj.texture.height > 0) {
    return remember({
      baseW: obj.texture.width,
      baseH: obj.texture.height,
      ax: obj.anchor?.x ?? 0.5,
      ay: obj.anchor?.y ?? 0.5
    });
  }
  // Spine — use cached base bounds captured at build time so selection
  // doesn't jitter as the animation progresses.
  if (obj.__baseBounds && obj.__baseBounds.width > 0 && obj.__baseBounds.height > 0) {
    const b = obj.__baseBounds;
    return remember({
      baseW: b.width,
      baseH: b.height,
      ax: b.width > 0 ? -b.x / b.width : 0.5,
      ay: b.height > 0 ? -b.y / b.height : 0.5
    });
  }
  try {
    const lb = obj.getLocalBounds?.();
    if (lb && lb.width > 0 && lb.height > 0) {
      return remember({
        baseW: lb.width,
        baseH: lb.height,
        ax: lb.width > 0 ? -lb.x / lb.width : 0.5,
        ay: lb.height > 0 ? -lb.y / lb.height : 0.5
      });
    }
  } catch { /* fall through to cache */ }
  return obj.__lastMetrics || null;
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

  // Pivot cross — the object's origin (rotation centre) + orientation. Drawn
  // through the anchor (local 0,0) so it rotates with the object. Axis colours:
  //   +x (right) light red · −x (left) dark red
  //   −y (up)   light green · +y (down) dark green
  const axLen = 48 / viewportScale;
  const axW = 2 / viewportScale;
  const pivot = localToContent(obj, 0, 0, contentRoot);
  const xPos = localToContent(obj, axLen, 0, contentRoot);
  const xNeg = localToContent(obj, -axLen, 0, contentRoot);
  const yDown = localToContent(obj, 0, axLen, contentRoot);
  const yUp = localToContent(obj, 0, -axLen, contentRoot);
  overlay.moveTo(pivot.x, pivot.y).lineTo(xNeg.x, xNeg.y).stroke({ color: 0x7a1f1f, width: axW, alpha: 0.95 });
  overlay.moveTo(pivot.x, pivot.y).lineTo(xPos.x, xPos.y).stroke({ color: 0xff5a5a, width: axW, alpha: 0.95 });
  overlay.moveTo(pivot.x, pivot.y).lineTo(yDown.x, yDown.y).stroke({ color: 0x1f7a2a, width: axW, alpha: 0.95 });
  overlay.moveTo(pivot.x, pivot.y).lineTo(yUp.x, yUp.y).stroke({ color: 0x5aff6e, width: axW, alpha: 0.95 });
  const pr = 3.5 / viewportScale;
  overlay.circle(pivot.x, pivot.y, pr).fill({ color: 0xffffff, alpha: 0.95 });
  overlay.circle(pivot.x, pivot.y, pr).stroke({ color: 0x1a1d24, width: 1 / viewportScale, alpha: 1 });

  return { keyDots, pathHandles };
}

/** Resize the renderer canvas to match its DOM container. */
export function resizeRenderer(app, canvasW, canvasH) {
  app.renderer.resize(canvasW, canvasH);
  // Pixi's `autoDensity` rewrites canvas.style.width/height to px on every
  // resize. Under the global CSS ui-scale (`zoom` on #root) that px value is
  // ALREADY zoomed, so the browser would zoom it a second time — at scale < 1
  // the canvas ends up smaller than its host and the stage's right/bottom edge
  // stops rendering (empty checkerboard). Re-assert the fluid 100% sizing so the
  // canvas always fills the host; the backing buffer stays correctly sized.
  if (app.canvas) {
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
  }
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
  const assetTypeById = new Map((scene.assets || []).map((a) => [a.id, a.type]));
  for (const layer of scene.layers) {
    const obj = handles.get(layer.id);
    if (!obj || obj.destroyed) continue;
    // Win-number layers are driven entirely by applyWinNumberAtTime (bone
    // follow + user offset composed each frame) — don't fight it here.
    if (assetTypeById.get(layer.assetId) === 'winnumber') { obj.visible = layer.visible !== false; continue; }
    obj.visible = layer.visible;
    const t = resolveTransform(layer, orientation, scene.stage);
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
    applyBlendMode(obj, layer.blend);
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
  for (const a of scene.assets) {
    parts.push(a.id, a.type, a.src?.slice?.(0, 32) || '');
    // Spine atlas/texture are part of the structure: when the self-heal recovers
    // a missing atlas+texture, the object must rebuild (e.g. so a spinner's
    // land/win overlay pool re-loads with the now-valid skeleton). Without this,
    // the repaired references would never reach the Pixi build.
    if (a.type === 'spine') parts.push(a.atlas?.slice?.(0, 24) || '', a.texture?.slice?.(0, 24) || '');
    // Win-sequence objects are Spine-backed too — atlas/texture are structural,
    // and `rev` bumps on wizard re-runs (tier mapping / enabled set changed).
    if (a.type === 'winseq') parts.push(a.atlas?.slice?.(0, 24) || '', a.texture?.slice?.(0, 24) || '', 'rev', String(a.winseq?.rev ?? 1), 'num', a.winseq?.number?.fontSrc?.slice?.(0, 24) || '-');
    // Win-number objects rebuild from their parent winseq's number config — the
    // parent ref is structural so a re-parent / parent swap rebuilds the glyphs.
    if (a.type === 'winnumber') parts.push('parent', a.parentAssetId || '-');
    // Spinner structural edits bump `rev` (wizard re-runs) — clip/timing
    // edits stay on the cheap apply path via the resolve-key memo.
    if (a.type === 'spinner') parts.push('rev', String(a.spinner?.rev ?? 1));
  }
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

function skeletonDefaultMix(obj) {
  const dm = Number(obj?.state?.data?.defaultMix);
  return Number.isFinite(dm) && dm >= 0 ? dm : 0;
}

function clamp01(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/**
 * Clip weight [0,1] from the Timeline clip blend — `easeIn` ramps the weight up
 * at the clip's start, `easeOut` (and the Spine `clipEndMixOut`) ramps it down
 * at the end. This is the web analogue of a Unity Timeline clip's ease in/out:
 * it fades the Spine track-entry alpha so the clip blends with whatever sits
 * underneath (lower tracks / held pose) at its edges. Returns 1 in the middle.
 */
function clipWeightEnvelope(clip, t) {
  const start = Number(clip.start) || 0;
  const end = start + (Number(clip.duration) || 0);
  const easeIn = Number(clip.easeIn) > 0 ? Number(clip.easeIn) : 0;
  const easeOut = Math.max(
    Number(clip.easeOut) > 0 ? Number(clip.easeOut) : 0,
    Number(clip.clipEndMixOut) > 0 ? Number(clip.clipEndMixOut) : 0
  );
  let w = 1;
  if (easeIn > 0 && t < start + easeIn) w = Math.min(w, (t - start) / easeIn);
  if (easeOut > 0 && t > end - easeOut) w = Math.min(w, (end - t) / easeOut);
  return Math.max(0, Math.min(1, w));
}

function resolveMixDuration(obj, layer, track, clip) {
  // "default mix duration" → use the skeleton's AnimationStateData.defaultMix,
  // mirroring Unity's Timeline clip "Use Default" mix mode.
  if (clip?.defaultMixDuration === true) return skeletonDefaultMix(obj);
  // "use blend duration" → defer to the Timeline clip-blend heuristic (the web
  // analogue of Spine Timeline's "Use Blend Duration").
  if (clip?.useBlendDuration === true) return autoMixDurationForTransition(obj, layer, track, clip);
  const explicit = Number(clip?.mixDuration);
  if (clip?.mixDuration != null) {
    if (!Number.isFinite(explicit) || explicit < 0) return 0;
    return explicit; // explicit 0 means a hard cut — no residual blend
  }
  // No explicit value → fall back to the skeleton's default mix (Unity-like).
  // This is 0 by default, so an untouched clip does NOT silently blend.
  return skeletonDefaultMix(obj);
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
      // Transform channels (position/scale/rotation/alpha/tint) apply to the
      // Spine container too — same hold / setup-until-first-key behaviour as a
      // PNG, on top of the skeletal animation. Parity across object types.
      applyPngChannels(obj, layer, tracks, t, orientation);
      continue;
    }

    if (asset.type === 'spinner' && obj.__spinner) {
      // Direct-mode scenario playback threads a carry-in board per spinner layer
      // (the result the previous timeline segment landed on) so the reels HOLD
      // that board across a timeline hand-off instead of resetting to the
      // authored initial board. Null in single-timeline mode → initial board.
      const carryBoard = scene.__spinnerCarry ? (scene.__spinnerCarry[layer.id] || null) : null;
      // Per-node spin outcome override (Direct mode) — null → authored result.
      applySpinnerAtTime(obj, layer, tracks, t, carryBoard, scene.__spinnerOutcome || null);
      applyPngChannels(obj, layer, tracks, t, orientation);
      continue;
    }

    if (asset.type === 'winseq' && obj.__winseq) {
      applyWinSeqAtTime(obj, layer, tracks, t);
      applyPngChannels(obj, layer, tracks, t, orientation);
      continue;
    }

    if (asset.type === 'winnumber' && obj.__winnumber) {
      // Follows a bone on its parent winseq (processed earlier this pass, so
      // __wsActive is current) + counts up. The user offset/scale comes from
      // this layer's transform, composed on top of the bone follow.
      const parentLayer = layer.parentId ? scene.layers.find((l) => l.id === layer.parentId) : null;
      const parentObj = parentLayer ? handles.get(parentLayer.id) : null;
      // Wizard Number-step override: a fixed sample value (read live from the
      // scene so it needs no rebuild), else the live count-up.
      const sampleOverride = typeof scene.winNumberPreview?.sample === 'number' ? scene.winNumberPreview.sample : null;
      // Live config so cheap edits (glyph scale / spacing / format) re-layout the
      // existing glyphs without a full scene rebuild.
      const parentAsset = scene.assets.find((a) => a.id === obj.__winnumber.parentAssetId);
      const liveNum = normalizeWinNumber(parentAsset?.winseq?.number);
      // Colour (alpha + tint) can be keyframed on the number layer's clips —
      // composed on top of the bone follow inside applyWinNumberAtTime.
      const colorOverride = evalWinNumberColor(tracks, t);
      applyWinNumberAtTime(obj, parentObj, layer, resolveTransform(layer, orientation, scene.stage), sampleOverride, liveNum, colorOverride);
      continue;
    }

    if (asset.type === 'video' && obj.texture?.source?.resource?.source) {
      applyVideoClip(obj, tracks[0], t, runtimePlaying, runtimeHeld);
      applyPngChannels(obj, layer, tracks, t, orientation);
      continue;
    }

    if (asset.type === 'png' || asset.type === 'pngSequence') {
      applyPngChannels(obj, layer, tracks, t, orientation);
    }
  }
}

/**
 * Reset every animated object back to its clean setup state. Used when the
 * user switches into setup mode so nothing bleeds the last animated pose:
 *   - Spine: clear all AnimationState tracks, snap the skeleton to its setup
 *     pose, and wipe the per-track flow cache so animate mode re-arms cleanly.
 *   - Spinner: re-show the idle board (empty tracks at t=0).
 *   - Video: pause and rewind to frame 0.
 * The container transforms (x/y/scale/rotation/alpha/tint) are restored to the
 * base pose by the subsequent `syncTransforms` pass.
 */
export function resetAnimationState(handles, scene) {
  if (!handles || !scene) return;
  for (const layer of scene.layers) {
    const obj = handles.get(layer.id);
    if (!obj || obj.destroyed) continue;
    if (obj.state && obj.skeleton) {
      try { obj.state.clearTracks(); } catch { /* ignore */ }
      try {
        if (typeof obj.skeleton.setToSetupPose === 'function') obj.skeleton.setToSetupPose();
        else if (typeof obj.skeleton.setupPose === 'function') obj.skeleton.setupPose();
      } catch { /* ignore */ }
      if (obj.__flow) obj.__flow.perTrack = new Map();
      try { obj.update?.(0); } catch { /* ignore */ }
    }
    if (obj.__spinner) {
      try { applySpinnerAtTime(obj, layer, [], 0); } catch { /* ignore */ }
    }
    if (obj.__winseq) {
      try { resetWinSeqState(obj); } catch { /* ignore */ }
    }
    // The count-up number only exists while a win-sequence clip plays — hide it
    // in setup so it doesn't linger at the skeleton origin showing "0".
    if (obj.__winnumber) { obj.visible = false; obj.__lastStr = undefined; }
    const video = obj.texture?.source?.resource?.source;
    if (video && video.nodeName?.toLowerCase() === 'video') {
      try { video.pause(); } catch { /* ignore */ }
      try { video.currentTime = 0; } catch { /* ignore */ }
    }
  }
}

/**
 * The Spine AnimationState track index a clip plays on. Comes from the explicit
 * per-clip `clip.track` (default 0), NOT the timeline row's array position —
 * clips on different indices MIX simultaneously and a higher index draws on top.
 * Read defensively (a clip created since the last load may not have been through
 * `normalizeClip`); same clamp as the model so runtime and persistence agree.
 */
function spineTrackIndex(clip) {
  const n = Number(clip?.track);
  return Number.isFinite(n) && n >= 0 ? Math.min(64, Math.floor(n)) : 0;
}

/**
 * Reflect a Spine layer's clips onto the Spine AnimationState. Each clip is
 * dispatched to the Spine track index named by `clip.track` (see
 * spineTrackIndex), decoupled from which timeline row it lives on — so two
 * clips on different indices play together (mix), a higher index drawing on top.
 *
 * Resolution is gather-then-apply, keyed by spine index:
 *   A. active clip per index (clipAt across all rows; later row wins a collision)
 *   B. held "last frame" per index (lastClipAt; active beats held; later start wins)
 *   C. apply each resolved slot (animation, mix, alpha envelope, trackTime)
 *   D. clear slots with no clip this frame — 0s for an intended-but-empty index
 *      (deterministic scrub), 0.1s for a slot no clip targets anymore (edit-time)
 *   E. one paused-scrub pose flush
 */
function applySpineMultiTrack(obj, layer, tracks, t) {
  obj.__flow = obj.__flow || { perTrack: new Map() };
  if (!obj.__flow.perTrack) obj.__flow.perTrack = new Map();
  const perTrack = obj.__flow.perTrack;
  const seen = new Set();

  // Mirror Unity's SkeletonDataAsset "Default Mix" — the AnimationStateData
  // mix used wherever a clip doesn't specify its own mix. Default 0 (no blend)
  // so the editor is WYSIWYG; set layer.spine.defaultMix to e.g. 0.2 for full
  // Unity-import parity. Kept in sync every frame so inspector edits take hold.
  try {
    const dm = Number(layer.spine?.defaultMix);
    if (obj.state?.data) obj.state.data.defaultMix = Number.isFinite(dm) && dm >= 0 ? dm : 0;
  } catch { /* ignore */ }

  // Spine-Timeline clip parity (see SCENE_STUDIO.md): clip-in offset, entry
  // alpha, hold-previous blending, ease-in/out envelope, track-entry thresholds.
  const applyActiveClipToIndex = (si, clip, track) => {
    const cache = perTrack.get(si) || {};
    const anim = clip.anim ?? layer.spine?.defaultAnimation ?? null;
    const animDuration = getSpineAnimationDuration(obj, anim);
    const loop = clip.loop !== false;
    const mixDuration = resolveMixDuration(obj, layer, track, clip);
    const clipIn = Number(clip.clipIn) > 0 ? Number(clip.clipIn) : 0;
    const baseAlpha = Number.isFinite(Number(clip.alpha)) ? Math.min(1, Math.max(0, Number(clip.alpha))) : 1;
    // Timeline clip blend (ease in/out, clip-end mix-out) fades the entry alpha
    // at the clip's edges; the static `alpha` is the mid-clip strength.
    const clipAlpha = baseAlpha * clipWeightEnvelope(clip, t);
    // `cache.held` → the previous frame was a frozen post-clip hold on this
    // slot; re-arm the animation so timeScale / mix reset cleanly.
    if (cache.activeClipId !== clip.id || cache.anim !== anim || cache.loop !== loop || cache.held) {
      try {
        if (anim) {
          const e = obj.state.setAnimation(si, anim, !!loop);
          if (e) {
            e.mixDuration = mixDuration;
            e.alpha = clipAlpha;
            e.holdPrevious = clip.holdPrevious === true;
            // Spine track-entry thresholds (Spine 4.3 names) — parity with the
            // Unity Animation State Clip's event / attachment / draw-order
            // thresholds. Affect which timelines apply mid-mix.
            e.eventThreshold = clamp01(clip.eventThreshold, 0);
            e.mixAttachmentThreshold = clamp01(clip.attachmentThreshold, 0);
            e.mixDrawOrderThreshold = clamp01(clip.drawOrderThreshold, 0);
            if (mixDuration > 0) {
              const sinceClipStart = Math.max(0, t - clip.start);
              e.mixTime = Math.min(mixDuration, sinceClipStart);
            }
          }
        } else {
          obj.state.setEmptyAnimation(si, mixDuration);
        }
      } catch { /* anim missing — ignore */ }
      perTrack.set(si, { activeClipId: clip.id, anim, loop, mixDuration, held: false });
    }
    try {
      const tr = obj.state?.tracks?.[si];
      if (tr) {
        tr.trackTime = remapClipTime(clip, t, animDuration) + clipIn;
        tr.alpha = clipAlpha; // re-applied every frame so the ease envelope animates
        tr.timeScale = 1; // un-freeze (in case the slot was holding a moment ago)
        if (mixDuration > 0) {
          const sinceClipStart = Math.max(0, t - clip.start);
          tr.mixTime = Math.min(mixDuration, sinceClipStart);
        }
      }
    } catch { /* ignore */ }
  };

  // Unity Timeline holds the LAST clip's final pose until the next clip / end of
  // timeline, so that's the default: keep the last animation set and freeze it
  // on its final frame. A clip can opt back into "snap to setup pose" via
  // `clearAfterEnd`; `dontEnd` forces the hold even then.
  const applyHeldClipToIndex = (si, held) => {
    const cache = perTrack.get(si) || {};
    const heldAnim = held.anim ?? layer.spine?.defaultAnimation ?? null;
    const shouldHold = (held.dontEnd === true || held.clearAfterEnd !== true) && !!heldAnim;
    if (!shouldHold) {
      // Use a 0-second empty animation so it snaps deterministically even
      // while scrubbing (a non-zero mix freezes mid-blend when paused).
      if (cache.activeClipId !== null) {
        try { obj.state.setEmptyAnimation(si, 0); }
        catch { /* ignore */ }
        perTrack.set(si, { activeClipId: null, anim: null, loop: null, mixDuration: 0 });
      }
      return;
    }
    const loop = held.loop !== false;
    const heldAnimDuration = getSpineAnimationDuration(obj, heldAnim);
    const heldClipIn = Number(held.clipIn) > 0 ? Number(held.clipIn) : 0;
    // Freeze at the clip's very last frame (non-loop clamps to the anim end;
    // a looping clip holds whatever phase it ended on).
    const heldT = held.start + held.duration - 1e-4;
    // Carry the clip's ease-out weight into the held pose so a faded-out clip
    // stays faded instead of snapping back to full alpha at the boundary.
    const baseHeldAlpha = Number.isFinite(Number(held.alpha)) ? Math.min(1, Math.max(0, Number(held.alpha))) : 1;
    const heldAlpha = baseHeldAlpha * clipWeightEnvelope(held, heldT);
    if (cache.activeClipId !== held.id || cache.anim !== heldAnim || cache.loop !== loop || cache.held !== true) {
      try {
        const e = obj.state.setAnimation(si, heldAnim, !!loop);
        if (e) { e.mixDuration = 0; e.alpha = heldAlpha; }
      } catch { /* anim missing — ignore */ }
      perTrack.set(si, { activeClipId: held.id, anim: heldAnim, loop, mixDuration: 0, held: true });
    }
    try {
      const tr = obj.state?.tracks?.[si];
      if (tr) {
        tr.trackTime = remapClipTime(held, heldT, heldAnimDuration) + heldClipIn;
        tr.alpha = heldAlpha;
        tr.timeScale = 0; // hold — don't advance during continued playback
      }
    } catch { /* ignore */ }
  };

  // Phase A — active clip per spine index. A later row in the array wins a
  // same-index collision (rows are stacked in UI/array order; this preserves
  // the spirit of the old row-order priority and is deterministic).
  const activeByIndex = new Map(); // si -> { clip, track }
  // Every spine index any clip targets, regardless of time — so we can clear an
  // "intended but currently empty" slot with a 0s snap rather than a 0.1s fade.
  const referencedIndices = new Set();
  for (const track of tracks) {
    for (const c of track.clips || []) referencedIndices.add(spineTrackIndex(c));
    const clip = clipAt(track, t);
    if (clip) activeByIndex.set(spineTrackIndex(clip), { clip, track });
  }

  // Phase B — held "last frame" per spine index, bucketed by the held clip's
  // OWN index. Active beats held; on tie keep the later-starting clip (and a
  // later row breaks a start tie since it overwrites).
  const heldByIndex = new Map(); // si -> clip
  for (const track of tracks) {
    const held = lastClipAt(track, t);
    if (!held) continue;
    const si = spineTrackIndex(held);
    if (activeByIndex.has(si)) continue; // active suppresses a hold on this slot
    const cur = heldByIndex.get(si);
    if (!cur || held.start >= cur.start) heldByIndex.set(si, held);
  }

  // Phase C — apply each resolved slot.
  for (const [si, { clip, track }] of activeByIndex) {
    seen.add(si);
    applyActiveClipToIndex(si, clip, track);
  }
  for (const [si, held] of heldByIndex) {
    seen.add(si);
    applyHeldClipToIndex(si, held);
  }

  // Phase D — clear slots with no clip this frame.
  //  - An index a clip targets but which resolved to neither active nor held
  //    (e.g. before its first clip) snaps clear with a 0s empty animation so
  //    paused scrubbing is deterministic.
  for (const si of referencedIndices) {
    if (seen.has(si)) continue;
    const cache = perTrack.get(si);
    if (cache && cache.activeClipId !== null) {
      try { obj.state.setEmptyAnimation(si, 0); } catch { /* ignore */ }
      perTrack.set(si, { activeClipId: null, anim: null, loop: null, mixDuration: 0 });
    }
    seen.add(si);
  }
  //  - A cached slot no clip targets anymore (clip moved index / row removed)
  //    fades out so it stops bleeding through.
  for (const [si] of perTrack) {
    if (seen.has(si)) continue;
    try { obj.state.setEmptyAnimation(si, 0.1); }
    catch { /* ignore */ }
    perTrack.delete(si);
  }

  // Phase E — IMPORTANT: in paused/scrub mode we still need a deterministic
  // pose refresh right now. `obj.update(0)` applies the current track state
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

/** A channel contributes a pose only when it has linked keys, any split
 *  sub-list with keys, or it's a path-mode position. */
function channelIsLive(ch) {
  if (!ch) return false;
  const hasLinked = ch.keys?.length;
  const hasSplit = ch.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length);
  return !!(hasLinked || hasSplit || isPathChannel(ch));
}

/**
 * Walk every logical channel across ALL clips up to time `t` on a layer and
 * override the base pose written by `syncTransforms`. Channels are clip-local —
 * `clipLocalSeconds` honours loop + speed and clamps times past the end of a
 * non-looping clip so the value holds its last keyframe instead of snapping
 * back to base pose.
 *
 * Crucially this resolves PER CHANNEL by folding across clips in chronological
 * order: a value keyed on an earlier clip (e.g. alpha → 1) PERSISTS into later
 * clips on the same track that don't re-key it, instead of reverting to the
 * object's setup pose. This matches how a static object holds its last keyed
 * value for the rest of the timeline. A later clip that DOES re-key the channel
 * takes over from its first key onward. Multiple tracks animating the same
 * channel = last-wins (track array order).
 */
/**
 * Fold one channel's value across the clips live at time `t` (oldest first, so
 * the most recent contributor wins). Returns undefined when no clip overrides
 * the channel — keep the base pose. Shared by the PNG/Spine transform pass and
 * the win-number colour pass.
 */
function evalChannelAcrossClips(clips, name, t) {
  let val; // undefined = no override yet
  for (const clip of clips) {
    const ch = clip.channels[name];
    if (!channelIsLive(ch)) continue;
    // Per-clip opt-out: once the playhead is past a clip that asked to clear,
    // it stops contributing (mirrors the Spine hold/clear path).
    if (clip.clearAfterEnd === true && t >= clip.start + clip.duration) continue;
    // Un-wrapped, speed-scaled local time — detects "before this channel's
    // first key" on the clip's first pass. Before that key the clip does NOT
    // contribute, so an earlier clip's held value carries through.
    const rawLocal = Math.max(0, t - clip.start) * validSpeed(clip);
    const firstT = channelFirstKeyTime(ch);
    if (firstT != null && rawLocal < firstT - 1e-6) continue;
    const localT = clipLocalSeconds(clip, t, { clampPastEnd: true });
    const v = evalChannel(ch, localT, name);
    if (v != null) val = v;
  }
  return val;
}

function applyPngChannels(obj, layer, tracks, t, orientation) {
  if (!tracks.length) return;
  const baseT = orientation === 'portrait'
    ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
    : layer.transforms?.landscape;
  if (!baseT) return;

  for (const track of tracks) {
    if (!track?.clips?.length) continue;
    // Clips that have started by now, oldest first, so the fold below ends on
    // the most recent contributor for each channel.
    const clips = track.clips
      .filter((c) => c.start <= t && c.channels)
      .sort((a, b) => a.start - b.start);
    if (!clips.length) continue;

    for (const name of CHANNEL_NAMES) {
      const val = evalChannelAcrossClips(clips, name, t);
      if (val !== undefined) CHANNEL_DEFS[name]?.apply?.(obj, val);
    }
  }
}

/**
 * Evaluate ONLY the colour channels (alpha + tint) for a win-number layer's
 * clips. Win numbers are bone-driven, so position/scale/rotation are not
 * keyframable — colour is, to allow fade in/out. Returns { alpha?, tint? } or
 * null when nothing animates.
 */
const WINNUMBER_COLOR_CHANNELS = ['alpha', 'tint'];
function evalWinNumberColor(tracks, t) {
  if (!tracks?.length) return null;
  let out = null;
  for (const track of tracks) {
    if (!track?.clips?.length) continue;
    const clips = track.clips
      .filter((c) => c.start <= t && c.channels)
      .sort((a, b) => a.start - b.start);
    if (!clips.length) continue;
    for (const name of WINNUMBER_COLOR_CHANNELS) {
      const v = evalChannelAcrossClips(clips, name, t);
      if (v !== undefined) { out = out || {}; out[name] = v; }
    }
  }
  return out;
}
