---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: in-progress
updated: 2026-06-14
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, changelog, spinner, unity]
---

# Scene Studio — Phase Status (changelog)

> [!info] Translated from Polish
> English translation of [`react-app/SCENE_STUDIO_PHASE_STATUS.md`](../../react-app/SCENE_STUDIO_PHASE_STATUS.md)
> (the session-by-session, most-current log). Technical detail preserved verbatim.

## Spinner → Unity — Phase 5, round 5 (2026-06-14) ✅

Three confirmed builds from [[Spinner Unity Phase 5]] (build + 49 tests green):

- **§A "present win" clip** — new `presentWin` action (after `stopSpin`) controls
  *when* winning symbols play the win animation (instead of auto `winDelay`).
  Per-reel `reelWinStagger` (0 = simultaneous, >0 = cascade reel 0→1→…) + optional
  `perReelWinDelay`. Evaluator: `winStartByReel[]` per stop (`spinnerEval.js`); no
  clip → old auto behavior. Ported to Unity: `bake.js` (reads nested `c.spinner` —
  previously read flat and **lost** target board/delays), `csharp.js`
  (`SpinnerClipData`/`ResolveTrack`/`EvaluateInternal`, `YggSpinnerClip`/Track/mixer,
  timeline builder). UI: `SpinnerInspectorSections.jsx` + `spinnerPresentWinDuration`.
- **§B one machine mask + native 1:1** — symbols render at native px (220px stays
  220px, overflows the cell); fit-shrink removed. One mask (RectMask2D / SpriteMask)
  covers `Statics+Blurs`; `Fx` is OUTSIDE the mask (animations overflow the machine).
  Hierarchy: `Board > Mask > Statics/Blurs` + `Fx`. `spinnerRuntime.js`,
  `prefab.js#spinnerBakedDocs`, `csharp.js` (`NewMaskContainer`/`SetNativeSize`, no
  `FitScale`; legacy prefab fallback).
- **§C runtime API** — `YggSpinner.SetResultBoard(string[][])` + `Spin()`/`Spin(board)`
  drive the spin→stop→present-win cycle from their own clock (`Update()`), without
  Timeline; wins computed from the injected board. Documented in `SPINNER.md` §6.

## Prior session

### P0 — state persistence ✅
- **Keep-mounted**: `ToolPanel.jsx` holds fullBleed tools (`display:none`) instead of
  `key={currentTool}` — Scene Studio + Pixi aren't destroyed on tool switch.
- **Autosave IndexedDB**: new `engine/sessionStore.js`, 1s debounce, saves `scene + rootHandle`.
- **Restore banner**: on page start, if IDB has a session with layers → "Restore / New scene" banner.
- **Version compat**: when `$schema` differs → option to "Download a copy" of the old scene.
- **"New" button**: in the toolbar with Save / Discard / Cancel dialog.
- **Body class**: `fullbleed-tool-active` on `<body>` only when a tool is ACTIVE.

### P1 — timeline fixes & UX ✅
Sticky ruler, sticky scrollbar at bottom, timeline anchored to bottom, clip-naming
fix, clip structure, spine dropdown, fixed split x/y selection bug, `ROW_H = 40`.

### P2 — controls & shortcuts ✅
Space play/pause, arrow stepping, Alt+scroll, auto-key extend/shift.

### UI/UX polish ✅
Body padding, vertical channel labels, alternating stripes, stripe alignment.

## This session

### Bugs fixed ✅
- **Clicking a key in the graph seeks the timeline** — `InspectorPanel.jsx`:
  `onFlowAction` prop added, threaded through `ClipSection` → `PngChannelEditor`;
  `setSelectedKey` computes `clip.start + key.t` and calls `onFlowAction('seek', absT)`.
- **Clip name field in the inspector** — `<input>` writing to `clip.name` (or `null`
  when empty), placed before the start field.

### P3 — scene: motion-path & interaction ✅
- **Direction arrows on the path** — `drawMotionPath` draws a filled triangle every
  ~12% of samples indicating direction (collects `posSamples`, no extra eval).
- **Clickable key dots on the path** — `drawMotionPath` returns `{drawn, keyDots}`;
  propagated through `drawSelection` → `PixiViewport` → `viewportController` hit-test
  (10px screen radius) before sprite hit-test → `onSeekToKey(absT)`.
- **Drag asset from panel onto scene** — `AssetBrowserPanel.jsx` list items are
  `draggable` (`application/x-ygg-asset-id`); `SceneStudioInner` drop handler checks
  for the asset id before file handling and calls `addAssetItemFromBrowser` via a ref.

## Session 3 — P3 finalization ✅
- **Motion-path → parent-chain transform** — `drawMotionPath` extended with
  `obj, contentRoot`; `toWorld(p)` maps through nested parent when applicable.
- **Stage-frame overlay dropdown** — `drawStageFrame` takes `overlayMode='behind'|'above'`;
  new `setStageFrameZOrder` reorders children; threaded through toolbar + viewport;
  `.scene-toolbar-select` styled to match `.scene-btn`.

## Session 4 — P4: full per-key tangent model ✅

Data model is **dual-path, lossless, non-destructive**. Old scenes (keys without
`tm`) animate bit-identically; the new model only engages when a key has `tm`.

- **New key model** (`keyframes.js` / `sceneModel.js`): optional `tm`
  (`auto|flat|linear|free|broken`) + `ti`/`to` slopes; legacy `out` bezier preserved.
  `normalizeChannelKey` validates per layout (scalar/vec2/rgb).
- **Hermite interpolator** (`curves.js` + `keyframes.js`): segment a→b is Hermite when
  either endpoint has `tm`, else legacy `curveEval(a.out)`. Slope resolvers per mode
  (`auto`=Catmull-Rom, `flat`=0, `linear`=secant, `free`=mirror, `broken`=`ti`/`to`).
  Mixed legacy↔tangent joints seed the missing slope numerically for continuity.
  Per-component for vec2/rgb. Mutation helpers: `effectiveSlopes`, `setKeyTangentMode`,
  `setKeyTangentSlope`.
- **3-point editor** (`ClipGraphEditor.jsx`): selected key gets 2 draggable in/out
  handles in value-space; neighbors get 1 context handle. Drag computes slope from
  geometry and promotes the segment to Hermite (seeded from legacy → no jump).
  `TangentControls` mode chips; legacy keys keep the old bezier `CurveEditor` until
  the artist enters the tangent model.
- **Global ease toggle for new keys** (`StudioToolbar.jsx`): `defaultEase`
  (smooth/flat/linear, default `auto`) stamped on ALL new keys (auto-key, `+key`,
  enable-channel seed, plot-click insert); existing keys untouched.
- **Curved path on scene** — no code change: `drawMotionPath` samples `evalChannel`
  ~80×/s, so the spline appears automatically when the interpolator goes Hermite.

Unit tests: interpolator 14/14, mutations 12/12 (legacy bit-identical, flat=smoothstep,
linear=straight, vec2 per-component, mode-switch seeds, drag round-trip). Clean build.

> **Spin clip — ✅ verified with real Spine data (session 5).**

## Session 5 — P5: scene path mode (path + progress, baked on export)

Optional mode where position is driven by a **spatial spline** (dials on scene) + a
separate `progress(t)` curve computed over **arc length** (constant speed; progress
shapes accel). You edit as a path, but on **export** it bakes to plain x/y curves
(the engine doesn't compute arc-length). User decisions: **bake only on export** +
**configurable density (fps slider)**.

- **P5.1 — spline math** (`engine/animation/pathSpline.js`, new): 2D spline from
  `{x,y,tm,ti,to}` points; arc-length LUT cached by array identity (WeakMap);
  `getPathSpline(points)` → `{totalLength, pointAtFraction, tangentAtFraction}`. Test 11/11.
- **P5.2 — model + interpreter**: `channels.position.mode='path'` +
  `path:{points, progress:{keys}, bakeFps}`. `keyframes.js`: `isPathChannel()`, path
  branch in `evalChannel`, `bakePathToKeys()`. `sceneModel.js` normalizers (clamp
  progress 0..1, default fps=30, ≥2 points). `pixiApp.js` draws + applies path mode.
  Interpreter/export read path like a normal vec2 channel. Test 10/10.
- **P5.3 — inspector UI**: toggle "◈ edit position as path (scene)" seeds from current
  keys or base pose; disabling bakes to x/y. In path mode, x/y graphs hidden, a
  `progress(t)` graph shown (reuses `ChannelSubplot`) + "bake fps" field.
- **P5.4 — on-scene dials** (`pixiApp.js`, `viewportController.js`, ...): yellow point
  dials + blue tangent handles; hit-test before sprite; drag → `onPathEdit` in
  parent-local; 250ms coalescing = 1 undo per drag.
- **P5.5 — bake on export** (`persist.js`): `bakePathsForExport(scene)` in `saveScene`
  adds baked linear x/y keys (per `bakeFps`) alongside the `path` source; engine reads
  plain `keys`, toolkit prefers `path` on reload (re-editable). Fix: path-mode position
  takes precedence in `normalizeChannels`.

> **P5 complete.** Tests: geometry 11/11, eval+bake 11/11, normalize 10/10,
> mutations 12/12, export+round-trip 6/6. Clean build, stable render.

### Session 5 UX fixes & bugfixes (post-feedback)
- Bigger path toggle + `confirm()` both directions; auto-key adds a path point;
  Delete no longer deletes the clip; fixed Delete deleting wrong key then clip;
  path progress-key delete handler; smaller path button; flatten precision picker
  (`bakePathToKeyCount`, prompt for frame count, clamp 2..400); clip resize no longer
  pushes keys outside the clip (`maxChannelKeyTime`).
- **"+" clip inherits edge state** (`seedChannelsFromClipEdge`): adding a "+" clip on
  the left holds the selected clip's **start** state, on the right its **end** state.
- **Transform top-fields = source of truth while recording**: fields show the value
  evaluated at the playhead (not the base pose), fixing "very hard to set alpha".
- **Scene management**: `scanProjectScenes` + dropdown to switch scenes (Save/Discard/
  Cancel), "＋ new scene" within the project.
- **Object-swap socket on a layer**: "source" dropdown of all scene assets + DnD drop
  target → reassign `layer.assetId`; keeps pose & animation, resets scale to 1:1.

### Deferred (optional, session 6)
- [ ] Object swap by dragging **from the scene** (sprite onto sprite).
- [ ] Manual add/remove of path points on scene (dbl-click add / alt-click remove).
- [ ] Per-point tangent-mode chips on scene.

## Spinner → Unity export sessions

Each session has its own full English note:

- [[Spinner Unity Phase 2]] — control track, Spine clip parity round 1, opt-in auto-build, import fixes.
- [[Spinner Unity Phase 3]] — symbol land/win Spine overlays, parity round 2, mix bug fixes.
- [[Spinner Unity Phase 4]] — baked overlays into prefab `Fx`, single shared-atlas export.
- [[Spinner Unity Phase 5]] — present-win clip, one mask + native 1:1, runtime API.

Related: [[Scene Studio]] · [[Scene Studio Design]] · [[Spinner Design]]
