// PixiViewport — mounts Pixi v8, owns pan/zoom + selection/move interactions.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Assets } from 'pixi.js';
import {
  applyFlowAtTime,
  createPixiApp,
  destroyPixiApp,
  drawDimOverlay,
  drawSelection,
  drawStageFrame,
  loadDeviceGuideTexture,
  rebuildScene,
  resetAnimationState,
  resizeRenderer,
  sceneStructuralHash,
  setStageFrameZOrder,
  syncTransforms
} from '../engine/pixiApp.js';
import { attachViewportController, fitViewportToStage } from '../engine/viewportController.js';
import { pickVideoMime, recordCanvasFrames, grabCanvasFrames } from '../engine/webmExport.js';

export const PixiViewport = forwardRef(function PixiViewport({ scene, rootHandle, selectedLayerId, selectedClip = null, onSelectLayer, onTransformLayer, onAssetReady, onSpinnerAnimDurations, onViewportClick, onSeekToKey, onPathEdit, flowTime = 0, livePreview = true, overlayMode = 'behind', studioMode = 'animate', refreshNonce = 0, onDiag = null, showGizmo = true }, ref) {
  const hostRef = useRef(null);
  const onDiagRef = useRef(onDiag);
  onDiagRef.current = onDiag;
  // Gizmo visibility (pivot cross + selection box/handles). When off we clear
  // the overlay and disable handle/rotate hit-testing for a clean preview.
  const showGizmoRef = useRef(showGizmo);
  showGizmoRef.current = showGizmo;
  const appRef = useRef(null);
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const stageFrameRef = useRef(null);
  const selectionOverlayRef = useRef(null);
  const deviceGuideRef = useRef(null);
  const dimOverlayRef = useRef(null);
  const guideRectRef = useRef(null); // {x,y,w,h} of the device guide in stage coords
  const handlesRef = useRef(new Map());
  // Blob: URLs minted by the live build generation. When a new build commits we
  // revoke + Assets.unload the PREVIOUS generation's URLs so repeated "refresh
  // assets" rebuilds don't leak GPU textures / object URLs.
  const buildBlobUrlsRef = useRef(null);
  const buildIdRef = useRef(0);
  const pendingRef = useRef(Promise.resolve());
  const detachControllerRef = useRef(null);
  const fittedOnceRef = useRef(false);
  const interactionGuidesRef = useRef([]);
  // True while the user is directly manipulating an object (drag / resize /
  // rotate / path edit). Playback's per-frame syncTransforms skips while this
  // is set, so a running timeline can't stomp the gesture (PLAN_2026-07 B3).
  const interactingRef = useRef(false);
  const [pixiTick, setPixiTick] = useState(0);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const livePreviewRef = useRef(livePreview);
  livePreviewRef.current = livePreview;
  const flowTimeRef = useRef(flowTime);
  flowTimeRef.current = flowTime;
  const studioModeRef = useRef(studioMode);
  studioModeRef.current = studioMode;

  // Latest values captured in refs so the controller (which closes over them
  // once) always sees fresh data.
  const selectedRef = useRef(selectedLayerId);
  selectedRef.current = selectedLayerId;
  const onSelectRef = useRef(onSelectLayer);
  onSelectRef.current = onSelectLayer;
  const onTransformRef = useRef(onTransformLayer);
  onTransformRef.current = onTransformLayer;
  const onViewportClickRef = useRef(onViewportClick);
  onViewportClickRef.current = onViewportClick;
  const selectedClipRef = useRef(selectedClip);
  selectedClipRef.current = selectedClip;
  const onSeekToKeyRef = useRef(onSeekToKey);
  onSeekToKeyRef.current = onSeekToKey;
  const onPathEditRef = useRef(onPathEdit);
  onPathEditRef.current = onPathEdit;
  const overlayModeRef = useRef(overlayMode);
  overlayModeRef.current = overlayMode;
  const motionKeyDotsRef = useRef([]);
  const pathHandlesRef = useRef([]);
  // While true, the live render/spine-tick RAF is a no-op so the WebM
  // exporter can drive deterministic frames without interference.
  const exportingRef = useRef(false);

  const requestRender = () => {
    const app = appRef.current;
    const sel = selectionOverlayRef.current;
    const frame = stageFrameRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const s = sceneRef.current;
    const vScale = viewport?.scale?.x ?? 1;
    if (sel) {
      // Motion path is drawn into the same overlay layer; it only renders
      // when the selected clip has a position channel with ≥ 2 keys.
      const ctx = selectedClipRef.current;
      const selClip = ctx?.clip || ctx || null;
      const selLayerId = selectedRef.current;
      const selLayer = selLayerId ? s.layers.find((l) => l.id === selLayerId) : null;
      const baseT = selLayer
        ? (s.stage.activeOrientation === 'portrait'
            ? (selLayer.transforms?.portrait ?? selLayer.transforms?.landscape)
            : selLayer.transforms?.landscape)
        : null;
      const selResult = drawSelection(sel, handlesRef.current.get(selLayerId), vScale, content, interactionGuidesRef.current, selClip, baseT) || {};
      motionKeyDotsRef.current = selResult.keyDots || [];
      pathHandlesRef.current = selResult.pathHandles || [];
    }
    if (frame) {
      const stage = s.stage.orientations[s.stage.activeOrientation];
      drawStageFrame(frame, stage.w, stage.h, vScale, overlayModeRef.current);
    }
    // Dim overlay: grey out around the in-view region (stage, or guide bounds).
    const dim = dimOverlayRef.current;
    if (dim) {
      const mode = overlayModeRef.current;
      const stage = s.stage.orientations[s.stage.activeOrientation];
      if (mode === 'above') {
        drawDimOverlay(dim, { x: 0, y: 0, w: stage.w, h: stage.h });
      } else if (mode === 'device-landscape' || mode === 'device-portrait') {
        drawDimOverlay(dim, guideRectRef.current || { x: 0, y: 0, w: stage.w, h: stage.h });
      } else {
        drawDimOverlay(dim, null);
      }
    }
    if (app?.renderer) app.render();
  };

  // Mount Pixi once.
  useEffect(() => {
    let cancelled = false;
    let localApp = null;
    (async () => {
      try {
        const host = hostRef.current;
        const rect = host.getBoundingClientRect();
        const initialSize = { w: Math.max(2, Math.round(rect.width)), h: Math.max(2, Math.round(rect.height)) };
        const built = await createPixiApp(host, initialSize);
        localApp = built.app;
        if (cancelled) { destroyPixiApp(built.app); return; }
        appRef.current = built.app;
        viewportRef.current = built.viewport;
        contentRef.current = built.content;
        stageFrameRef.current = built.stageFrame;
        selectionOverlayRef.current = built.selectionOverlay;
        deviceGuideRef.current = built.deviceGuide;
        dimOverlayRef.current = built.dimOverlay;

        // Initial fit + stage frame at the resulting zoom
        const stage = sceneRef.current.stage.orientations[sceneRef.current.stage.activeOrientation];
        fitViewportToStage(built.viewport, initialSize.w, initialSize.h, stage.w, stage.h);
        drawStageFrame(built.stageFrame, stage.w, stage.h, built.viewport.scale.x, overlayModeRef.current);
        // Apply the initial overlay z-order NOW. The overlayMode effect runs
        // before this async mount resolves (refs still null → it no-ops), so
        // without this the stageFrame stays below content and the blue border +
        // centre cross sit hidden behind the artwork in 'frame in front' mode
        // until the user toggles the overlay select.
        setStageFrameZOrder(built.viewport, built.stageFrame, built.content, overlayModeRef.current);
        fittedOnceRef.current = true;
        // Draw the dim overlay (and any device guide) for the initial mode now
        // that the Pixi refs are assigned — the effects ran before this resolved.
        requestRender();
        built.app.render();

        const onCanvasClick = () => onViewportClickRef.current?.();
        built.app.canvas.addEventListener('click', onCanvasClick);
        built.app.__onCanvasClick = onCanvasClick;

        // Hook pan/zoom/select/drag
        detachControllerRef.current = attachViewportController({
          canvas: built.app.canvas,
          viewport: built.viewport,
          content: built.content,
          getSelectedLayerId: () => selectedRef.current,
          onSelect: (id) => onSelectRef.current?.(id),
          onTransformLayer: (id, patch) => onTransformRef.current?.(id, patch),
          getHandles: () => handlesRef.current,
          getScene: () => sceneRef.current,
          setInteractionGuides: (guides) => { interactionGuidesRef.current = guides || []; },
          requestRender,
          getMotionKeyDots: () => motionKeyDotsRef.current,
          onSeekToKey: (t) => onSeekToKeyRef.current?.(t),
          getPathHandles: () => pathHandlesRef.current,
          onPathEdit: (edit) => onPathEditRef.current?.(edit),
          onInteractingChange: (v) => { interactingRef.current = v; },
          onDiag: (msg) => onDiagRef.current?.(msg),
          getGizmoEnabled: () => showGizmoRef.current
        });
        // Reference is already passed above; keep this stub so HMR replacements
        // re-attach cleanly when the controller file changes.

        // Permanent render + spine-tick RAF.
        //
        // Pixi v8's `Application.init()` is supposed to wire up its own ticker
        // but in practice we've seen Spine animations freeze unless we render
        // every frame ourselves. We also can't rely on
        // `@esotericsoftware/spine-pixi-v8`'s shared-ticker auto-update — it
        // exists, but the deltas it receives only matter if `app.render()`
        // actually runs each frame. Driving both from one RAF guarantees:
        //   - `app.render()` runs every animation frame (60fps cap by the
        //     browser; Pixi handles partial frames gracefully)
        //   - When `livePreview` is on we hand each tracked Spine instance an
        //     explicit `dt` so its animation state advances independent of
        //     whatever the shared ticker is doing.
        let rafHandle = 0;
        let lastTs = performance.now();
        const drive = (ts) => {
          rafHandle = requestAnimationFrame(drive);
          const app = appRef.current;
          if (!app?.renderer) return;
          // The WebM exporter owns rendering while active — stand down.
          if (exportingRef.current) return;
          const dtMs = Math.max(0, Math.min(100, ts - lastTs));
          lastTs = ts;
          const runtime = sceneRef.current?.flow?.runtime || {};
          const runtimePlaying = runtime.playing !== false;
          const runtimeHeld = !!runtime.hold;
          // Setup mode has no "flow" to play/pause — flowState.playing
          // defaults false there, so the play/hold gate below (meant for
          // animate/direct scrubbing) always blocked ticking and a spine's
          // default/idle animation sat frozen on its build-time bind pose.
          // Setup wants a live, looping preview regardless of that state.
          const isSetup = studioModeRef.current === 'setup';
          if (livePreviewRef.current && (isSetup || (runtimePlaying && !runtimeHeld))) {
            // Tick every spine instance manually so we don't depend on the
            // shared-ticker subscription. NOTE: pixi-spine-v8's
            // `spine.update(dt)` expects SECONDS (it's just a thin wrapper
            // around `internalUpdate(_, deltaSeconds)`). Passing milliseconds
            // makes animations play 1000× too fast. Convert.
            const dtSec = dtMs / 1000;
            for (const obj of handlesRef.current.values()) {
              if (obj?.__isSpine && typeof obj.update === 'function') {
                try { obj.update(dtSec); } catch { /* ignore per-tick failure */ }
              }
            }
          }
          app.render();
        };
        rafHandle = requestAnimationFrame(drive);
        built.app.__driveRaf = () => cancelAnimationFrame(rafHandle);

        // Resize canvas with the wrap.
        const ro = new ResizeObserver(() => {
          const r = host.getBoundingClientRect();
          const w = Math.max(2, Math.round(r.width));
          const h = Math.max(2, Math.round(r.height));
          if (appRef.current) {
            resizeRenderer(appRef.current, w, h);
            appRef.current.render();
          }
        });
        ro.observe(host);
        appRef.current.__ro = ro;

        setPixiTick((t) => t + 1);
      } catch (e) {
        if (!cancelled) console.warn('[SceneStudio] Pixi init failed', e);
      }
    })();
    return () => {
      cancelled = true;
      if (detachControllerRef.current) { detachControllerRef.current(); detachControllerRef.current = null; }
      if (appRef.current?.__onCanvasClick) {
        appRef.current.canvas?.removeEventListener('click', appRef.current.__onCanvasClick);
      }
      if (appRef.current?.__driveRaf) appRef.current.__driveRaf();
      if (appRef.current?.__ro) { appRef.current.__ro.disconnect(); }
      destroyPixiApp(localApp || appRef.current);
      if (appRef.current === localApp) {
        appRef.current = null;
        viewportRef.current = null;
        contentRef.current = null;
        stageFrameRef.current = null;
        selectionOverlayRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update stage frame whenever orientation/size changes.
  useEffect(() => {
    const frame = stageFrameRef.current;
    if (!frame) return;
    const stage = scene.stage.orientations[scene.stage.activeOrientation];
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (app && viewport && fittedOnceRef.current) {
      const r = hostRef.current.getBoundingClientRect();
      fitViewportToStage(viewport, r.width, r.height, stage.w, stage.h);
    }
    // Pass the active overlay mode (was previously omitted, which forced the
    // 'behind' dark-fill look on every orientation/size change and pushed the
    // blue border + centre cross behind the content). Keeping the mode here
    // means the frame renders identically in setup AND animate.
    drawStageFrame(frame, stage.w, stage.h, viewport?.scale?.x ?? 1, overlayModeRef.current);
    if (app) app.render();
  }, [
    scene.stage.activeOrientation,
    scene.stage.orientations.landscape.w,
    scene.stage.orientations.landscape.h,
    scene.stage.orientations.portrait.w,
    scene.stage.orientations.portrait.h,
    pixiTick
  ]);

  // Structural hash — only changes when assets are added/removed or layer
  // shape changes (spine/video config, asset binding). Pure transform edits
  // do NOT bump this, so they go through the cheap sync path below instead
  // of triggering a full Spine rebuild on every mouse-move.
  const structHash = useMemo(() => sceneStructuralHash(scene), [scene.assets, scene.layers]);

  useEffect(() => {
    const app = appRef.current;
    const content = contentRef.current;
    if (!app || !content) return;
    const myBuild = ++buildIdRef.current;
    pendingRef.current = pendingRef.current.catch(() => {}).then(async () => {
      if (myBuild !== buildIdRef.current) return;
      try {
        const handles = await rebuildScene(
          app, content, selectionOverlayRef.current, scene, selectedLayerId, rootHandle, onAssetReady, onSpinnerAnimDurations
        );
        if (myBuild === buildIdRef.current) {
          handlesRef.current = handles;
          // Pose freshly-built objects at the current time immediately —
          // otherwise a newly-added object (e.g. a win-number child entering
          // the Number step) sits at its build state until the next scene/time
          // change instead of following its bone / showing its value.
          try {
            syncTransforms(app, handles, sceneRef.current);
            if (studioModeRef.current !== 'setup') applyFlowAtTime(handles, sceneRef.current, flowTimeRef.current);
            if (app.renderer) app.render();
          } catch { /* ignore */ }
          // Rotate blob-URL generations: the new build is live, so the previous
          // generation's URLs are dead — unload their cached textures + revoke.
          const prev = buildBlobUrlsRef.current;
          buildBlobUrlsRef.current = handles.__blobUrls || null;
          if (prev) {
            for (const url of prev) {
              try { Assets.unload(url).catch(() => {}); } catch { /* not cached */ }
              try { URL.revokeObjectURL(url); } catch { /* ignore */ }
            }
          }
        }
      } catch (e) {
        console.warn('[SceneStudio] rebuild failed', e);
      }
    });
  }, [structHash, rootHandle, pixiTick, refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cheap path: transform / visibility / blend changes don't trigger
  // rebuild — they update existing handles in place. This is what makes
  // dragging Spine sprites and scrubbing scale sliders not crash.
  useEffect(() => {
    // While a direct manipulation is in flight, the controller drives the
    // object's transform imperatively and renders via its own RAF. Re-running
    // syncTransforms here (e.g. because a playing timeline advanced flowTime)
    // would reset the object back to its scene/flow pose mid-gesture — the
    // "can't move/scale/rotate" bug. Skip the pose sync but still refresh the
    // selection overlay so the handles track the object as it moves.
    if (!interactingRef.current) {
      syncTransforms(appRef.current, handlesRef.current, scene);
      // Setup mode shows the base pose only — no timeline overrides applied.
      if (studioMode !== 'setup') applyFlowAtTime(handlesRef.current, scene, flowTime);
    }
    if (selectionOverlayRef.current) {
      if (!showGizmo) {
        // Gizmo hidden — clear the overlay and drop interactive dots/handles.
        selectionOverlayRef.current.clear();
        motionKeyDotsRef.current = [];
        pathHandlesRef.current = [];
      } else {
        const ctx = selectedClipRef.current;
        const selClip = ctx?.clip || ctx || null;
        const selLayer = selectedLayerId ? scene.layers.find((l) => l.id === selectedLayerId) : null;
        const baseT = selLayer
          ? (scene.stage.activeOrientation === 'portrait'
              ? (selLayer.transforms?.portrait ?? selLayer.transforms?.landscape)
              : selLayer.transforms?.landscape)
          : null;
        const selResult = drawSelection(
          selectionOverlayRef.current,
          handlesRef.current.get(selectedLayerId),
          viewportRef.current?.scale?.x ?? 1,
          contentRef.current,
          interactionGuidesRef.current,
          selClip,
          baseT
        ) || {};
        motionKeyDotsRef.current = selResult.keyDots || [];
        pathHandlesRef.current = selResult.pathHandles || [];
      }
      appRef.current?.render();
    }
  }, [scene.layers, scene.flow, scene.stage.activeOrientation, selectedLayerId, selectedClip, flowTime, studioMode, showGizmo]);

  // Reorder stageFrame and redraw it when overlay mode changes.
  useEffect(() => {
    setStageFrameZOrder(viewportRef.current, stageFrameRef.current, contentRef.current, overlayMode);
    requestRender();
  }, [overlayMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Device-view guide: load + size the guide image to COVER the stage (centred),
  // record its bounds for the dim overlay, and toggle visibility per mode.
  useEffect(() => {
    const guide = deviceGuideRef.current;
    if (!guide) return;
    const isDevice = overlayMode === 'device-landscape' || overlayMode === 'device-portrait';
    if (!isDevice) {
      guide.visible = false;
      guideRectRef.current = null;
      requestRender();
      return;
    }
    let cancelled = false;
    (async () => {
      const tex = await loadDeviceGuideTexture(overlayMode);
      if (cancelled || !tex) return;
      const stage = sceneRef.current.stage.orientations[sceneRef.current.stage.activeOrientation];
      const tw = tex.width || tex.source?.width || stage.w;
      const th = tex.height || tex.source?.height || stage.h;
      const scale = Math.max(stage.w / tw, stage.h / th); // cover
      guide.texture = tex;
      guide.scale.set(scale);
      guide.position.set(stage.w / 2, stage.h / 2);
      guide.visible = true;
      const dw = tw * scale;
      const dh = th * scale;
      guideRectRef.current = { x: stage.w / 2 - dw / 2, y: stage.h / 2 - dh / 2, w: dw, h: dh };
      requestRender();
    })();
    return () => { cancelled = true; };
  }, [overlayMode, scene.stage.activeOrientation]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    /**
     * Reset every animated object to its clean setup state (clear Spine tracks
     * + setup pose, idle the spinner board, rewind videos) and redraw the base
     * pose. Called when the editor enters setup mode.
     */
    resetToSetup() {
      resetAnimationState(handlesRef.current, sceneRef.current);
      syncTransforms(appRef.current, handlesRef.current, sceneRef.current);
      requestRender();
    },

    /**
     * Re-fit + center the design frame in the current canvas — same recipe as
     * the mount/orientation-change fit. Called explicitly (e.g. on fullscreen
     * enter/exit) rather than from the ResizeObserver so ordinary panel
     * resizes never stomp the artist's pan/zoom.
     */
    fitToStage() {
      const app = appRef.current;
      const viewport = viewportRef.current;
      const host = hostRef.current;
      if (!app?.renderer || !viewport || !host) return;
      const s = sceneRef.current;
      const stage = s.stage.orientations[s.stage.activeOrientation];
      const r = host.getBoundingClientRect();
      fitViewportToStage(viewport, r.width, r.height, stage.w, stage.h);
      if (stageFrameRef.current) {
        drawStageFrame(stageFrameRef.current, stage.w, stage.h, viewport.scale.x, overlayModeRef.current);
      }
      app.render();
    },

    screenToWorld(clientX, clientY) {
      const vp = viewportRef.current;
      const canvas = appRef.current?.canvas;
      if (!vp || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cx = (clientX - rect.left) * (canvas.width / rect.width) / dpr;
      const cy = (clientY - rect.top) * (canvas.height / rect.height) / dpr;
      return { x: (cx - vp.x) / vp.scale.x, y: (cy - vp.y) / vp.scale.y };
    },

    /**
     * Render the active timeline 0 → duration into a WebM Blob.
     *
     * The live stage is temporarily reconfigured to a clean, native-resolution
     * render of the active orientation (no pan/zoom, no stage-frame or
     * selection chrome, opaque background) so the captured frames match the
     * exported asset rather than the editor view. Everything is restored in
     * `finally`, so a cancel or error leaves the editor untouched.
     */
    /**
     * Render the chosen source to a video Blob.
     *
     * @param {object} o
     * @param {'webm'|'mp4'} [o.format]  container/codec to produce
     * @param {number} [o.crf]           ffmpeg x264 quality for the MP4 fallback
     * @param {(globalT:number)=>({scene:object,flowTime:number}|null)} [o.frameProvider]
     *        maps export time → the scene+flowTime to render that frame; defaults
     *        to the live active timeline. Used to render an arbitrary timeline or
     *        a flattened scenario.
     */
    async exportVideo({
      fps, durationSec, scale = 1, backgroundColor = 0x000000, bitrate,
      format = 'webm', crf = 22, frameProvider, onProgress, signal
    } = {}) {
      const app = appRef.current;
      const viewport = viewportRef.current;
      const stageFrame = stageFrameRef.current;
      const selectionOverlay = selectionOverlayRef.current;
      const dimOverlay = dimOverlayRef.current;
      const deviceGuide = deviceGuideRef.current;
      const scene = sceneRef.current;
      if (!app?.renderer || !viewport || !scene) throw new Error('Scene is not ready.');
      if (typeof app.canvas.captureStream !== 'function') {
        throw new Error('This browser cannot capture the canvas. Try Chrome or Firefox.');
      }

      // Native mime for the requested format (null ⇒ MP4 needs the ffmpeg fallback).
      const nativeMime = pickVideoMime(format);
      const useFfmpeg = format === 'mp4' && !nativeMime;
      if (format === 'webm' && !nativeMime) {
        throw new Error('This browser cannot record WebM. Try Chrome or Firefox.');
      }

      const stage = scene.stage.orientations[scene.stage.activeOrientation];
      const outW = Math.max(2, Math.round(stage.w * scale));
      const outH = Math.max(2, Math.round(stage.h * scale));
      const realFps = Math.max(1, Math.round(fps || scene.stage.fps || 30));
      const dur = Math.max(0.1, durationSec || scene.stage.duration || 5);
      const frameCount = Math.max(1, Math.ceil(dur * realFps));
      const renderFrame = (t) => {
        const fp = frameProvider ? frameProvider(t) : { scene: sceneRef.current, flowTime: t };
        if (fp?.scene) applyFlowAtTime(handlesRef.current, fp.scene, fp.flowTime ?? t);
        app.render();
      };

      // ---- enter export mode: stop live drivers, stash editor view ----
      exportingRef.current = true;
      try { app.stop(); } catch { /* ignore */ }
      const saved = {
        x: viewport.x, y: viewport.y, sx: viewport.scale.x, sy: viewport.scale.y,
        frameVis: stageFrame ? stageFrame.visible : true,
        selVis: selectionOverlay ? selectionOverlay.visible : true,
        dimVis: dimOverlay ? dimOverlay.visible : true,
        guideVis: deviceGuide ? deviceGuide.visible : false,
        bgAlpha: app.renderer.background.alpha,
        // NB: `background.color` GETTER returns the live Color object by
        // reference, and the SETTER mutates it in place — so snapshot an
        // immutable numeric value here, else the export's fill leaks back into
        // the editor view (the restore would just re-apply the mutated object).
        bgColor: app.renderer.background.color.toNumber(),
        w: app.renderer.width, h: app.renderer.height,
        res: app.renderer.resolution
      };
      if (stageFrame) stageFrame.visible = false;
      if (selectionOverlay) selectionOverlay.visible = false;
      if (dimOverlay) dimOverlay.visible = false;
      if (deviceGuide) deviceGuide.visible = false;
      app.renderer.background.alpha = 1;
      app.renderer.background.color = backgroundColor;
      app.renderer.resize(outW, outH, 1); // resolution 1 → backing store == outW×outH
      viewport.position.set(0, 0);
      viewport.scale.set(scale, scale);

      try {
        let blob;
        let mimeType;
        if (useFfmpeg) {
          // No native MP4 recorder — grab discrete frames and encode with
          // ffmpeg.wasm (lazy CDN import, so the core only downloads on demand).
          const frames = await grabCanvasFrames({
            canvas: app.canvas, frameCount, fps: realFps, renderFrame,
            onProgress: (p) => onProgress?.({ ...p, phase: 'rendering' }), signal
          });
          if (signal?.aborted) throw new Error('cancelled');
          const { encodeFramesToMp4 } = await import('../engine/mp4Export.js');
          blob = await encodeFramesToMp4(frames, {
            fps: realFps, crf,
            onProgress: (p) => onProgress?.({ frame: frameCount, total: frameCount, ...p }),
            signal
          });
          mimeType = 'video/mp4';
        } else {
          mimeType = nativeMime;
          blob = await recordCanvasFrames({
            canvas: app.canvas, frameCount, fps: realFps, mimeType, bitrate,
            renderFrame, onProgress, signal
          });
        }
        return { blob, width: outW, height: outH, fps: realFps, frames: frameCount, mimeType, format };
      } finally {
        // ---- restore editor view ----
        if (stageFrame) stageFrame.visible = saved.frameVis;
        if (selectionOverlay) selectionOverlay.visible = saved.selVis;
        if (dimOverlay) dimOverlay.visible = saved.dimVis;
        if (deviceGuide) deviceGuide.visible = saved.guideVis;
        // Restore COLOR first (setting a numeric color resets alpha to 1), then
        // reapply the saved alpha so a transparent editor background stays clear.
        app.renderer.background.color = saved.bgColor;
        app.renderer.background.alpha = saved.bgAlpha;
        const r = hostRef.current?.getBoundingClientRect();
        const hw = Math.max(2, Math.round(r?.width || saved.w));
        const hh = Math.max(2, Math.round(r?.height || saved.h));
        app.renderer.resize(hw, hh, saved.res);
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';
        viewport.position.set(saved.x, saved.y);
        viewport.scale.set(saved.sx, saved.sy);
        exportingRef.current = false;
        try { app.start(); } catch { /* ignore */ }
        requestRender();
      }
    },

    /**
     * Render the CURRENT frame (whatever the playhead/mode is showing) to a PNG
     * Blob at the active orientation's native stage resolution. Transparent by
     * default (pass an opaque `backgroundColor` to fill). Mirrors exportVideo's
     * clean capture (no pan/zoom, no stage-frame/selection chrome) and restores
     * everything in `finally`, so it never leaves a mark on the editor view.
     */
    async exportFramePng({ scale = 1, backgroundColor = null } = {}) {
      const app = appRef.current;
      const viewport = viewportRef.current;
      const stageFrame = stageFrameRef.current;
      const selectionOverlay = selectionOverlayRef.current;
      const dimOverlay = dimOverlayRef.current;
      const deviceGuide = deviceGuideRef.current;
      const scene = sceneRef.current;
      if (!app?.renderer || !viewport || !scene) throw new Error('Scene is not ready.');

      const stage = scene.stage.orientations[scene.stage.activeOrientation];
      const outW = Math.max(2, Math.round(stage.w * scale));
      const outH = Math.max(2, Math.round(stage.h * scale));

      exportingRef.current = true;
      try { app.stop(); } catch { /* ignore */ }
      const saved = {
        x: viewport.x, y: viewport.y, sx: viewport.scale.x, sy: viewport.scale.y,
        frameVis: stageFrame ? stageFrame.visible : true,
        selVis: selectionOverlay ? selectionOverlay.visible : true,
        dimVis: dimOverlay ? dimOverlay.visible : true,
        guideVis: deviceGuide ? deviceGuide.visible : false,
        // Immutable numeric snapshot — the getter returns the live Color object.
        bgAlpha: app.renderer.background.alpha,
        bgColor: app.renderer.background.color.toNumber(),
        w: app.renderer.width, h: app.renderer.height,
        res: app.renderer.resolution
      };
      if (stageFrame) stageFrame.visible = false;
      if (selectionOverlay) selectionOverlay.visible = false;
      if (dimOverlay) dimOverlay.visible = false;
      if (deviceGuide) deviceGuide.visible = false;
      if (backgroundColor == null) {
        app.renderer.background.alpha = 0; // transparent PNG
      } else {
        app.renderer.background.color = backgroundColor;
        app.renderer.background.alpha = 1;
      }
      app.renderer.resize(outW, outH, 1); // resolution 1 → backing store == outW×outH
      viewport.position.set(0, 0);
      viewport.scale.set(scale, scale);

      try {
        app.render();
        const blob = await new Promise((resolve, reject) => {
          app.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/png');
        });
        return { blob, width: outW, height: outH, orientation: scene.stage.activeOrientation };
      } finally {
        if (stageFrame) stageFrame.visible = saved.frameVis;
        if (selectionOverlay) selectionOverlay.visible = saved.selVis;
        if (dimOverlay) dimOverlay.visible = saved.dimVis;
        if (deviceGuide) deviceGuide.visible = saved.guideVis;
        app.renderer.background.color = saved.bgColor;
        app.renderer.background.alpha = saved.bgAlpha;
        const r = hostRef.current?.getBoundingClientRect();
        const hw = Math.max(2, Math.round(r?.width || saved.w));
        const hh = Math.max(2, Math.round(r?.height || saved.h));
        app.renderer.resize(hw, hh, saved.res);
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';
        viewport.position.set(saved.x, saved.y);
        viewport.scale.set(saved.sx, saved.sy);
        exportingRef.current = false;
        try { app.start(); } catch { /* ignore */ }
        requestRender();
      }
    }
  }), []);

  return <div ref={hostRef} className="scene-pixi-host" />;
});
