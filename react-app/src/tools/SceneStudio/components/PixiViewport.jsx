// PixiViewport — mounts Pixi v8, owns pan/zoom + selection/move interactions.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyFlowAtTime,
  createPixiApp,
  destroyPixiApp,
  drawSelection,
  drawStageFrame,
  rebuildScene,
  resizeRenderer,
  sceneStructuralHash,
  syncTransforms
} from '../engine/pixiApp.js';
import { attachViewportController, fitViewportToStage } from '../engine/viewportController.js';

export function PixiViewport({ scene, rootHandle, selectedLayerId, selectedClip = null, onSelectLayer, onTransformLayer, onAssetReady, onViewportClick, flowTime = 0, livePreview = true }) {
  const hostRef = useRef(null);
  const appRef = useRef(null);
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const stageFrameRef = useRef(null);
  const selectionOverlayRef = useRef(null);
  const handlesRef = useRef(new Map());
  const buildIdRef = useRef(0);
  const pendingRef = useRef(Promise.resolve());
  const detachControllerRef = useRef(null);
  const fittedOnceRef = useRef(false);
  const interactionGuidesRef = useRef([]);
  const [pixiTick, setPixiTick] = useState(0);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const livePreviewRef = useRef(livePreview);
  livePreviewRef.current = livePreview;

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
      drawSelection(sel, handlesRef.current.get(selLayerId), vScale, content, interactionGuidesRef.current, selClip, baseT);
    }
    if (frame) {
      const stage = s.stage.orientations[s.stage.activeOrientation];
      drawStageFrame(frame, stage.w, stage.h, vScale);
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

        // Initial fit + stage frame at the resulting zoom
        const stage = sceneRef.current.stage.orientations[sceneRef.current.stage.activeOrientation];
        fitViewportToStage(built.viewport, initialSize.w, initialSize.h, stage.w, stage.h);
        drawStageFrame(built.stageFrame, stage.w, stage.h, built.viewport.scale.x);
        fittedOnceRef.current = true;
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
          requestRender
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
          const dtMs = Math.max(0, Math.min(100, ts - lastTs));
          lastTs = ts;
          const runtime = sceneRef.current?.flow?.runtime || {};
          const runtimePlaying = runtime.playing !== false;
          const runtimeHeld = !!runtime.hold;
          if (livePreviewRef.current && runtimePlaying && !runtimeHeld) {
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
    drawStageFrame(frame, stage.w, stage.h, viewport?.scale?.x ?? 1);
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
          app, content, selectionOverlayRef.current, scene, selectedLayerId, rootHandle, onAssetReady
        );
        if (myBuild === buildIdRef.current) handlesRef.current = handles;
      } catch (e) {
        console.warn('[SceneStudio] rebuild failed', e);
      }
    });
  }, [structHash, rootHandle, pixiTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cheap path: transform / visibility / blend changes don't trigger
  // rebuild — they update existing handles in place. This is what makes
  // dragging Spine sprites and scrubbing scale sliders not crash.
  useEffect(() => {
    syncTransforms(appRef.current, handlesRef.current, scene);
    applyFlowAtTime(handlesRef.current, scene, flowTime);
    if (selectionOverlayRef.current) {
      const ctx = selectedClipRef.current;
      const selClip = ctx?.clip || ctx || null;
      const selLayer = selectedLayerId ? scene.layers.find((l) => l.id === selectedLayerId) : null;
      const baseT = selLayer
        ? (scene.stage.activeOrientation === 'portrait'
            ? (selLayer.transforms?.portrait ?? selLayer.transforms?.landscape)
            : selLayer.transforms?.landscape)
        : null;
      drawSelection(
        selectionOverlayRef.current,
        handlesRef.current.get(selectedLayerId),
        viewportRef.current?.scale?.x ?? 1,
        contentRef.current,
        interactionGuidesRef.current,
        selClip,
        baseT
      );
      appRef.current?.render();
    }
  }, [scene.layers, scene.flow, scene.stage.activeOrientation, selectedLayerId, selectedClip, flowTime]);

  return <div ref={hostRef} className="scene-pixi-host" />;
}
