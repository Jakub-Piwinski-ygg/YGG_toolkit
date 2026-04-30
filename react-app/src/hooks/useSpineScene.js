import { useEffect, useRef, useState } from 'react';
import { loadSpineRuntime } from '../utils/spine/runtime.js';
import { buildSpineAssets } from '../utils/spine/assets.js';

// Manages the full spine-webgl lifecycle for a single canvas.
//
// open        — boolean gate; effect only runs when true
// canvasRef   — ref to the <canvas> element
// spec        — { name, jsonPath, atlasPath, dir, textures }
// resolveUrl  — async (path) => blobUrl (auth-aware, cached by caller)
//
// Returns { status, error, animations, currentAnim, controls }
export function useSpineScene({ open, canvasRef, spec, resolveUrl }) {
  const [status, setStatus] = useState('idle');     // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [animations, setAnimations] = useState([]); // [{name, duration}]
  const [currentAnim, setCurrentAnim] = useState(null);
  const [skins, setSkins] = useState([]);           // skin name strings
  const [currentSkin, setCurrentSkin] = useState(null);
  const [paused, setPaused] = useState(false);

  // Hot-updatable refs — changed by controls without triggering re-render
  const speedRef = useRef(1);
  const alphaRef = useRef(1);
  const pausedRef = useRef(false);
  const bgRef = useRef({ r: 0, g: 0, b: 0, a: 0 }); // transparent = checker default
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // Runtime refs — set during effect, read by controls
  const animStateRef = useRef(null);
  const skeletonRef = useRef(null);
  const rendererRef = useRef(null);
  const progressRef = useRef(0);   // normalized [0,1] track progress, updated every frame
  const fitRef = useRef(null);     // { cx, cy, w, h } from skeleton bounds, used by resetView
  // Stable ref for resolveUrl to avoid effect re-runs on every render
  const resolveUrlRef = useRef(resolveUrl);
  resolveUrlRef.current = resolveUrl;

  useEffect(() => {
    if (!open || !spec || !canvasRef.current) return;

    const ac = new AbortController();
    const { signal } = ac;
    let rafId = null;
    let disposeAssets = null;

    setStatus('loading');
    setError(null);
    setAnimations([]);
    setCurrentAnim(null);
    setSkins([]);
    setCurrentSkin(null);
    setPaused(false);
    pausedRef.current = false;
    speedRef.current = 1;
    alphaRef.current = 1;

    (async () => {
      try {
        const spine = await loadSpineRuntime();
        if (signal.aborted) return;

        const canvas = canvasRef.current;

        // Create WebGL context + renderer.  alpha:true so the checker bg option
        // can clear to transparent and show the CSS checker underneath.
        const context = new spine.ManagedWebGLRenderingContext(canvas, {
          alpha: true,
          premultipliedAlpha: false,
        });
        const renderer = new spine.SceneRenderer(canvas, context, false);
        rendererRef.current = renderer;

        // Load all assets (fetches JSON, atlas text, textures; builds skeleton data)
        const { skeletonData, dispose } = await buildSpineAssets({
          context,
          spec,
          resolveUrl: (...args) => resolveUrlRef.current(...args),
          signal,
        });
        if (signal.aborted) { dispose(); return; }
        disposeAssets = dispose;

        // Build skeleton + animation state
        const skeleton = new spine.Skeleton(skeletonData);
        const stateData = new spine.AnimationStateData(skeletonData);
        stateData.defaultMix = 0.2;
        const animState = new spine.AnimationState(stateData);

        skeletonRef.current = skeleton;
        animStateRef.current = animState;

        const animList = skeletonData.animations.map((a) => ({
          name: a.name,
          duration: a.duration,
        }));
        const skinNames = skeletonData.skins.map((s) => s.name);
        const initialSkin = skinNames[0] || null;

        // Prefer the export viewport baked into the JSON by the Spine editor
        // (skeleton.x/y/width/height in project settings).  This is the most
        // reliable source: it's what the artist sized the animation to fill
        // and it doesn't depend on which slots/attachments happen to be
        // visible in any particular frame.
        // Fall back to getBounds with the initial skin applied if missing.
        let cx, cy, bw, bh;
        if (skeletonData.width > 0 && skeletonData.height > 0) {
          bw = skeletonData.width;
          bh = skeletonData.height;
          cx = skeletonData.x + bw / 2;
          cy = skeletonData.y + bh / 2;
        } else {
          if (initialSkin) skeleton.setSkinByName(initialSkin);
          skeleton.setToSetupPose();
          skeleton.updateWorldTransform(spine.Physics.update);
          const bOff = new spine.Vector2();
          const bSz  = new spine.Vector2();
          skeleton.getBounds(bOff, bSz, []);
          bw = bSz.x;  bh = bSz.y;
          cx = bOff.x + bw / 2;  cy = bOff.y + bh / 2;
        }

        panRef.current = { x: cx, y: cy };
        fitRef.current = { cx, cy, w: bw, h: bh };
        // Zoom resolved on first RAF frame when canvas.clientWidth is non-zero
        let fitPending = bw > 0 && bh > 0;

        // Set up skeleton for playback
        if (initialSkin) skeleton.setSkinByName(initialSkin);
        skeleton.setToSetupPose();

        setSkins(skinNames);
        setCurrentSkin(initialSkin);
        setAnimations(animList);

        if (animList.length > 0) {
          animState.setAnimation(0, animList[0].name, true);
          setCurrentAnim(animList[0].name);
        }

        setStatus('ready');

        const gl = context.gl;
        let last = performance.now();

        const frame = (now) => {
          if (signal.aborted) return;

          // First frame: canvas is laid out — compute fit zoom now
          if (fitPending) {
            fitPending = false;
            const fit = fitRef.current;
            if (fit && fit.w > 0 && fit.h > 0) {
              const cw = canvas.clientWidth || canvas.offsetWidth || 700;
              const ch = canvas.clientHeight || canvas.offsetHeight || 500;
              // spine OrthoCamera: visible extent = viewport × zoom (larger = more zoomed out)
              zoomRef.current = Math.max(0.01, Math.max(fit.w / cw, fit.h / ch) / 0.85);
            }
          }

          const dt = Math.min((now - last) / 1000, 0.1); // clamp to avoid hitches
          last = now;

          if (!pausedRef.current) {
            animState.update(dt * speedRef.current);
            animState.apply(skeleton);
          }

          // Track normalized progress for scrubber (read even while paused)
          const track0 = animState.tracks[0];
          if (track0 && track0.animation && track0.animation.duration > 0) {
            progressRef.current = (track0.trackTime % track0.animation.duration)
              / track0.animation.duration;
          }

          skeleton.color.a = alphaRef.current;
          skeleton.updateWorldTransform(spine.Physics.update);

          // Sync canvas backing resolution to its CSS display size
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          gl.viewport(0, 0, canvas.width, canvas.height);

          const bg = bgRef.current;
          gl.clearColor(bg.r, bg.g, bg.b, bg.a);
          gl.clear(gl.COLOR_BUFFER_BIT);

          renderer.camera.position.x = panRef.current.x;
          renderer.camera.position.y = panRef.current.y;
          renderer.camera.zoom = zoomRef.current;
          renderer.resize(spine.ResizeMode.Expand);

          renderer.begin();
          renderer.drawSkeleton(skeleton, false);
          renderer.end();

          rafId = requestAnimationFrame(frame);
        };
        rafId = requestAnimationFrame(frame);
      } catch (e) {
        if (signal.aborted) return;
        setError(e.message);
        setStatus('error');
      }
    })();

    return () => {
      ac.abort();
      if (rafId) cancelAnimationFrame(rafId);
      if (disposeAssets) disposeAssets();
      if (rendererRef.current) {
        try { rendererRef.current.dispose(); } catch { /* ignore */ }
        rendererRef.current = null;
      }
      skeletonRef.current = null;
      animStateRef.current = null;
    };
  }, [open, spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const controls = {
    paused,
    togglePause() {
      pausedRef.current = !pausedRef.current;
      setPaused(pausedRef.current);
    },
    setSpeed(v) { speedRef.current = v; },
    setAlpha(v) { alphaRef.current = v; },
    setBg(rgba) { bgRef.current = rgba; },
    setAnimation(name) {
      if (!animStateRef.current) return;
      animStateRef.current.setAnimation(0, name, true);
      setCurrentAnim(name);
      pausedRef.current = false;
      setPaused(false);
    },
    setSkin(name) {
      const skeleton = skeletonRef.current;
      if (!skeleton) return;
      skeleton.setSkinByName(name);
      // Reset slot attachments to the new skin without disturbing bone transforms.
      // Then re-queue the current animation so it keeps playing cleanly.
      skeleton.setSlotsToSetupPose();
      if (animStateRef.current) animStateRef.current.apply(skeleton);
      setCurrentSkin(name);
    },
    // Pan in world-space, accounting for current zoom.
    // screenDx/screenDy are mouse pixel deltas (screen y-down → world y-up inversion).
    // spine OrthoCamera: visible extent = viewport × zoom, so 1 screen pixel
    // = zoom world units.  Multiply (not divide) to keep panning proportional.
    panWorld(screenDx, screenDy) {
      const z = zoomRef.current;
      panRef.current = {
        x: panRef.current.x - screenDx * z,
        y: panRef.current.y + screenDy * z,
      };
    },
    // Zoom centred on the cursor point so the world position under the cursor
    // stays fixed.  cursorX/Y are clientX/Y from the wheel event.
    zoomAt(delta, cursorX, cursorY) {
      const oldZoom = zoomRef.current;
      const newZoom = Math.max(0.01, Math.min(50, oldZoom * (1 + delta)));

      const canvas = canvasRef.current;
      if (canvas && cursorX !== undefined) {
        const rect = canvas.getBoundingClientRect();
        // Cursor offset from canvas centre in screen pixels
        const cx = cursorX - rect.left - rect.width  / 2;
        const cy = cursorY - rect.top  - rect.height / 2;
        // World point under cursor at old zoom (visible extent = viewport × zoom)
        const wx = panRef.current.x + cx * oldZoom;
        const wy = panRef.current.y - cy * oldZoom; // screen y-down → world y-up
        // Shift pan so that same world point stays under cursor at new zoom
        panRef.current = { x: wx - cx * newZoom, y: wy + cy * newZoom };
      }

      zoomRef.current = newZoom;
    },
    resetView() {
      const fit = fitRef.current;
      const canvas = canvasRef.current;
      if (!fit || !canvas) return;
      const cw = canvas.clientWidth || 700;
      const ch = canvas.clientHeight || 500;
      if (fit.w > 0 && fit.h > 0) {
        zoomRef.current = Math.max(0.01, Math.max(fit.w / cw, fit.h / ch) / 0.85);
      }
      panRef.current = { x: fit.cx, y: fit.cy };
    },
    seek(t) {
      const track = animStateRef.current?.tracks[0];
      if (!track?.animation) return;
      const clamped = Math.max(0, Math.min(0.9999, t));
      track.trackTime = clamped * track.animation.duration;
      animStateRef.current.apply(skeletonRef.current);
      progressRef.current = clamped;
    },
  };

  return { status, error, animations, currentAnim, skins, currentSkin, controls, progressRef };
}
