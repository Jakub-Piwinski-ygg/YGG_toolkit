---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: in-progress
updated: 2026-07-03
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, changelog, spinner, win-sequences, unity, spine, tracks]
---

# Scene Studio — Phase Status (changelog)

> [!info] Translated from Polish
> English translation of [`react-app/SCENE_STUDIO_PHASE_STATUS.md`](../../react-app/SCENE_STUDIO_PHASE_STATUS.md)
> (the session-by-session, most-current log). Technical detail preserved verbatim.

## Direct: hold/crossfade pose carry + spin outcomes + transport QoL — COMPLETE ✅ (2026-07-03)

Big QoL session off the user's punch-list (10 items + a reported hold/crossfade bug).

- **Pose carry (bugfix)** — `hold` behaved like `cut`: on a segment hand-off
  objects snapped back to the setup pose because the preview was built from the
  incoming timeline alone. New `layerPoseCarryByNode`
  (`engine/scenarioTimeline.js`, analogue of the spinner board carry) folds the
  walk and records each keyed layer's transform-channel pose at segment END;
  `hold`/`crossfade` segments inherit those poses (baked as base transforms —
  the incoming timeline's keys still win), `cut` deliberately resets.
  `buildBlendedScene` blends FROM the carried pose (`carryPoses` +
  `baseOverride` in `resolveLayerTransform`), so a crossfade no longer snaps
  after the mix window. Wired into `directPreview` (single + blend) and the
  scenario video export. Documented limitation: crossfade blends transform
  channels only — spine/spinner/winseq animation state is frozen in the overlap.
  Tests: 6 new in `scenarioTimeline.test.mjs`, 3 in `scenarioBlend.test.mjs`.
- **Per-node spin outcomes** — new `entry.spinOutcome`
  (`default`/`noWin`/`smallWin`/`bigWin`/`wildWin`) + a "Spin outcome" select in
  the node inspector (shown when the timeline stops a spinner; `spinnerStopInfo`
  in `scenarioModel.js`). Boards from seeded generators (`generateOutcomeBoard`
  in `spinnerModel.js`): smallWin = exactly one 3–5-reel win (70% low pool),
  bigWin = 2–3 long high-symbol combos with 2-high stacks, wildWin = 3–5 wilds
  completing several combos. Symbol classification is **name-based**
  (`classifySymbols`): wild = name contains "wild", low = l/lo/low token (L1,
  lo_2, low ace), high = h/hi/high; list-order fallback. `evalWaysWins(board,
  wildId)` — wilds substitute in runs, wild cells join the win and play their
  OWN win anim (winCells read the board symbol + dedupe). The override rides
  `resolveSpinnerTrack`/`spinnerResolveKey`/`applySpinnerAtTime`
  (`scene.__spinnerOutcome`) AND the board carry, so downstream nodes hold the
  forced result. `wildWin` greyed out without a "wild"-named symbol. 7 new
  tests in `spinnerEval.test.js`. Export TODO: mirror the generators in
  `YggSpinner.cs`.
- **Transport / keyboard** — the global **Space is context-aware**: wizard
  preview (new `wizardPreviewControlsRef`) → Direct playhead → animate flow;
  no-op in setup (it used to toggle the HIDDEN flow). Arrow keys ←/→ animate
  only. **⏮ "jump to start"** on all three timelines (animate `TimelinePanel`,
  win-seq preview, Direct graph transport — new `seekStart` action that keeps
  the play state). The win-sequences preview bar now **drag-scrubs** with
  pointer capture (was click-only).
- **Playing-segment highlight** — the Direct scrubber marks the segment under
  the playhead with `is-current` + a pulsing `is-running`.
- **Fullscreen fit** — `fitToStage()` on the `PixiViewport` imperative ref
  (recipe from the orientation-change refit), called after `fullscreenchange`
  (double rAF) on enter AND exit. The ResizeObserver deliberately does not
  refit — ordinary panel resizes never stomp the artist's pan/zoom.
- **Chained ＋ in Direct** — `addTimelineNodeChained` (`scenarioModel.js`):
  first node right of Start, next ones right of the last spawned (fallback:
  rightmost / Start), row-aligned; node geometry exported from the model
  (`SCENARIO_TL_W`…), the panel imports it. The graph view **pans with a tween**
  (280 ms ease-out) to the new node — also on drag-drop; wheel/pointer input
  cancels the tween. The new node is selected immediately.
- **Hierarchy type icons** — `layerTypeIcon(asset)` (`sceneModel.js`):
  🎬 scene-setup root / 📁 empty group / 🎰 spinner / 🏆 winseq / 🔢 winnumber /
  🦴 spine / 🖼 png (◻ for the generated data-URL placeholder) / 🎞 video /
  📽 pngSequence. Rendered between the visibility checkbox and the name.
- **Scene Setup: alpha-gated modes + idle timelines** — mode groups (Free
  Spins / Bonus / Pick&Click) are now created `visible:true` + **alpha 0**
  (`visible` stays a pure editing toggle; the alpha channel is animatable →
  Direct-mode crossfades between game modes). The wizard generates one
  **"<Mode> Idle"** timeline per mode (2 s, one alpha key per group: own 1,
  rest 0; `engine/sceneSetupTimelines.js`, tagged `generatedBy: rootLayerId`,
  regenerated on wizard re-entry). Old scenes: no migration — `visible:false`
  works as before; upgrade by re-running the wizard. 3 tests in
  `sceneSetupTimelines.test.mjs`.

Session note: [[Session 2026-07-03 Scene Studio Direct QoL]].

## Spine: per-clip tracks + animation mixing — COMPLETE ✅ (2026-06-30)

A Spine object can play several animations at once on separate Spine
AnimationState tracks. The timeline used to map **row → track index by array
position**, so mixing was implicit, priority inverted (top row = index 0 =
lowest), and the Unity export silently dropped multi-track.

- **`clip.track`** (new field, AnimationState index, default 0, cap 64) — set
  per clip, **decoupled from the timeline row**. Clips on different numbers
  **mix**; higher number draws on top (native Spine semantics, no UI inversion).
- **`applySpineMultiTrack`** rewritten to *gather-then-apply* keyed by index:
  active clip per index (collision → **lower row wins**), then "hold last frame"
  per index (active beats hold), slot clearing 0s snap (deterministic scrub) vs
  0.1s fade (no clip). mix/alpha/ease/clipIn/trackTime/hold preserved.
- **Unity export fixed** — `spineCuesForLayer` sets `trackIndex: clip.track`
  (previously every cue exported as 0 despite YAML/C# support).
- **UI**: "T#" badge on the clip (left, in front of the name) + "track" field in
  the inspector (below the animation dropdown); "New Clip" ghost on **every** row
  of the selected object (fix: clips could only be added to the top row); empty
  track ghost shows "＋ New Clip" directly (creates track + clip at once); **▲/▼**
  buttons to move tracks above/below others (`moveTrack`); "Match anim time" moved
  to the bottom of the inspector (duration now auto-fits). **No migration** — old
  2+-row spine scenes collapse to track 0.

Full write-up: [[Session 2026-06-30 Scene Studio Spine Tracks]].

| Layer | File |
|---|---|
| `clip.track` field (validate, cap 64) | `engine/sceneModel.js` |
| Per-index dispatch (gather-then-apply) | `engine/pixiApp.js` (`applySpineMultiTrack`, `spineTrackIndex`) |
| `trackIndex` on export cues | `unity/bake.js` (`spineCuesForLayer`) |
| T# badge, per-row ghost, ghost-track New Clip, ▲/▼ | `components/TimelinePanel.jsx` |
| "track" field + relocated "match anim time" | `components/InspectorPanel.jsx` |
| Badge/stepper + clip body-line styles | `styles/scene-studio.css` |

## Win Sequences — Phase 1 (web + timeline) — COMPLETE ✅ (2026-06-26)

The second wizard-built Scene Studio object after the Spinner. **Phase 1 = web
authoring + timeline runtime**; **Phase 2 (future) = Unity `.unitypackage` export**
(`YggWinSequence`), mirroring the Spinner's Phase 5 → Unity-phase split. Build green,
15/15 model tests. Full write-up: [[Win Sequences Phase 1]]; design: [[Win Sequences Design]].

- **2026-06-24** — design doc + pure model (`engine/winseq/winseqModel.js`) + Spine-backed
  runtime (`engine/winseq/winseqRuntime.js`). Tier parse (`NNx_tier_sub`), tier→flow
  escalation (from `small`, each tier `begin → idle`, only the final `end`),
  normalize/derive sequences, flow eval (step + local time), duration sums,
  `hangOnLastIdle`, `large`/`max` gated default-off. First web + timeline render.
- **2026-06-25** — wizard (`components/WinSequenceWizard.jsx`): skeleton-triplet fetch,
  tier auto-map **+ manual per-tier begin/idle/end dropdowns**, flow generation, in-panel
  preview transport. Model refinements + the 15-test suite (`winseqModel.test.mjs`):
  single-frame anims respected, unknown-anim fallback, hang-mode final-idle loop.
- **2026-06-26** — wizard launchers **moved from the toolbar into the left stack** (under
  the hierarchy, above the workspace; `.scene-wizards-panel`). Workspace-lock gate
  (`WorkspaceLockOverlay.jsx` — grey-out + centered forced load when no root). Wizard mode
  defaults the scene view to **frame behind** (saves/restores the prior overlay on close).
  Phase 1 declared complete.

## Direct (scenario) mode — third studio mode (2026-06-16) ✅

A Blueprint-style node graph that sequences *animate* timelines into a branching
**scenario** and plays the flow start→end in the same Pixi preview. P1–P4 shipped +
a playback refit (commits `167dd3a`, `ddbedad`). Full write-up:
[[Session 2026-06-16 Scene Studio Direct Scenario Mode]]; design: [[Scene Studio Direct Mode]].

- **Project-level scenarios** — `project.scenarios[]` + `activeScenarioId`, schema
  `ygg-project/2` (back-compat: absent = `[]`). Nodes bind to `{sceneId, timelineId}`;
  dangling nodes kept + flagged. `engine/scenarioModel.js` (CRUD + `resolveWalk` +
  `listProjectTimelines` + per-source active-edge exclusivity; tested).
- **Graph UI** — `ScenarioGraphPanel` (canvas + transport + scrubber),
  `ScenarioTimelineList` (drag source), `ScenarioInspectorSections` (summary / node /
  edge-transition editors). Pan/zoom, node drag, pin drag-to-connect, Delete removal,
  view + positions persisted.
- **Playback refit** — the initial linear `scenarioRuntime.js` was **replaced** by a
  global-time scrubbable model: `engine/scenarioTimeline.js` flattens the active-edge
  walk into end-to-end segments, `sampleScenario(T)` maps global→local; preview swaps
  to the node's **origin scene** (`directPreviewScene`). `engine/scenarioBlend.js`
  renders **same-scene crossfades** (blends transform channels); cross-scene crossfades
  cut at the midpoint. Per-timeline speed + startOffset honoured.
- **Deferred (P5)** — auto-arrange, minimap, breadcrumb, edge-insert, `YggScenarioPlayer.cs`
  + scenario payload in `.unitypackage`; wait-for-click + cross-scene crossfade preview;
  Direct-mode undo (edits currently bypass the scene undo stack).

## Keyframe track redesign + deep zoom + resizable panels (2026-06-15) ✅

Three gated phases from `SCENE_STUDIO_KICKOFF.md`, each user-verified live before the
next (build green). Working tree, uncommitted. Full write-up:
[[Session 2026-06-15 Scene Studio Keyframe Track Redesign Zoom and Panels]].

- **Phase 1 — keyframe track redesign + stable key ids (`kid`).** Keys carry a stable
  `kid` (idempotent stamp in `deriveFlowGraph`, new keys in `insertOrUpdateKey`; `k…`/`kf…`
  prefixes never collide, survives save/load). `kid` is the canonical selection identity;
  the cached `idx` is **re-derived from kid** after every scene change (kills the
  "re-click to unstick" glitch). `transformClipKeys` maps times then **sorts freely** (no
  clamp) → a selected set passes through neighbours. Selected clip **expands** (big
  per-channel rows + Unity "all" summary row that drags every key at a time); unselected
  clips **flatten** to one diamond per time. Drag-stable pointer capture (stable kid DOM
  order + summary keyed by member-kid set).
- **Phase 2 — zoom + dynamic length.** Max zoom 360 → **1440 px/s** (~4× deeper),
  multiplicative wheel. `niceTimeStep` picks a zoom/fps-aware ruler step (labels densify
  `1s → 0.5s → 0.25s`); `buildGridlines` draws seconds / sub-second (.25/.5/.75) /
  **per-frame** lines (once frames ≥7px). **Dynamic timeline length**: `stage.manualDuration`
  — typing a length pins it, else an effect auto-fits to content (grow on drag-out, shrink
  to last clip); an "auto" toggle returns to auto-fit. Clips drag up to the 300s cap
  (`dragMax`). ⚠️ Existing scenes load in auto mode (length snaps to content until pinned).
- **Phase 3 — panels + mode buttons + auto-load.** **Resizable panels** (drag, persisted):
  timeline height (capped so viewport ≥160px), inspector width (grow leftward, min 300),
  hierarchy/workspace width (grow rightward, min 260) via `beginPanelResize` + thin
  `.scene-resize-handle` strips. **Setup/Animate buttons** Spine-style: bigger, stick-figure
  art (T-pose / running) + label. **Auto-load** broadened to `<name>.project.json`
  (canonical `project.json` still preferred).
- **DEFERRED — device-view overlay (C).** Skipped at user request; Pixi code untouched;
  guide→stage mapping (cover vs white safe-rect) still to confirm.

## Phase 4 — WebM export (2026-06-14) ✅

First web-media exporter (beyond Unity): the active timeline 0→duration is rendered
deterministically to a `.webm` (build green, user-verified in the browser).

- **`engine/webmExport.js`** — pure recorder: `pickWebmMime()` (vp9→vp8→webm probe),
  `recordCanvasFrames()` uses `canvas.captureStream(0)` + manual `track.requestFrame()`
  into a `MediaRecorder`, wall-clock-paced (`1000/fps` per frame) → correct duration;
  cooperative cancel (`signal.aborted`).
- **`PixiViewport.exportWebM()`** — export mode: stops the ticker + RAF (`exportingRef`),
  hides the stage frame + selection overlay, sets an opaque background, resizes the
  renderer to native stage resolution × scale at `resolution 1`, renders 0→duration
  deterministically (`applyFlowAtTime(t)` → `app.render()` → `requestFrame()`). All
  restored in `finally` (cancel/error leaves the editor untouched). Spine is seeked by
  `trackTime` (deterministic); dt-ticking is disabled during capture.
- **`WebMExportDialog.jsx`** — fps (15/24/30/60), quality (4/8/16 Mbps), resolution
  (100/50/25%), opaque background colour, progress bar, cancel, auto-download; settings
  in localStorage. **▶ webm** button in `StudioToolbar` next to ⇪ unity.
- **Limits (intentional):** opaque only (no alpha); video layers may not be
  frame-accurate; **hero-PNG and PNG sequence still NOT done.**

## Project / Scenes / Timelines + Setup-Animate (2026-06-14) ✅

Spine-2D-style workflow + a richer document model (build + all tests green, new
`engine/projectModel.test.mjs` + `unity/perTimeline.test.mjs`):

- **Phase 1 — Timeline UX.** Scrub **only** on the ruler, not on the lane body.
  Multi-select clips: plain click = single, ctrl/⌘ = toggle, shift = range within a
  track, marquee (rubber-band) on empty lane. Group-move selected clips (shared
  `deltaT`, clamped per neighbour). Delete key removes clips (priority: keyframe →
  clip[s]); the per-clip ✕ button is gone. `TimelinePanel.jsx`, `SceneStudioInner.jsx`
  (`selectedClipIds`).
- **Phase 2 — Setup vs Animate.** Toggle in `StudioToolbar`. **Setup**: ruler hidden,
  playhead = 0, edits write the **default pose** (per orientation); `PixiViewport`
  skips `applyFlowAtTime`. **Animate**: auto-key ON → keyframes; auto-key OFF → edits
  are transient (commit nothing, object snaps back to the evaluated pose). Removed the
  old fall-through that wrote the base pose when a clip was selected with auto-key OFF.
- **Phase 3 — Project / Scenes / Variants + multi-timeline.** New `ygg-project/1`
  document wrapping scenes bumped to `ygg-scene/2` (`timelines[]` replaces the single
  `flow`). Shared **asset pool** at the project level. Multiple scenes (switch without
  losing edits), **variants** (`variantOf`, duplicate-as-variant, Unity-prefab style).
  `engine/projectModel.js` (`createEmptyProject`, `validateProject`, `deriveWorkingScene`,
  `foldSceneIntoProject`, `addScene`/`removeScene`/`renameScene`/`setActiveScene`,
  `duplicateSceneAsVariant`, `mergeAssets`); timeline model in `engine/sceneModel.js`
  (`activeTimeline`, `syncFlowToActiveTimeline`, `setActiveTimeline`, `addTimeline`,
  `renameTimeline`, `removeTimeline`). `persist.js` gains `saveProject` /
  `loadProjectFromHandle` / `loadProjectFromFile` (one `project.json`, scenes inline).
  `SceneStudioInner` holds the `project` and materializes a working scene; `flow` is a
  **live mirror** of the active timeline, committed via `syncFlowToActiveTimeline`
  before save / switch / export. v1→v2 migration + legacy `scene.json` → 1-scene
  project. Timeline selector in `TimelinePanel`, scene/variant picker in `StudioToolbar`.
- **Phase 4 — Unity export per timeline.** One `.anim` per (canvas × timeline); the
  GUID seed includes `timelineId`, so re-export keeps existing timelines' clip GUIDs
  (merge) while a new timeline adds a fresh clip. Descriptor bumped to
  `ygg-unity-scene/2` with a `timelines[]` array (per-axis `clipGuid` + spine/spinner
  cues); top-level `spineCues`/`spinnerCues` mirror the primary timeline (back-compat).
  `YggSceneTimelineBuilder.cs` adds an `AnimationTrack` per extra timeline (loads the
  clip by GUID, additive). `exportUnityPackage.js` (`timelinesOf`, `sceneForTimeline`,
  `bakeTimelineForCanvas`), `csharp.js`.

---

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

## UX / feature sessions

- [[Session 2026-06-15 Scene Studio Keyframe Multiselect Timeline and Overlays]] —
  spinner re-edit wizard, frozen-column timeline rewrite, **keyframe
  multi-select / move / scale / clipboard**, "frame in front" grey-out overlay
  (device modes built then disabled), Spine setup-pose / "no pose" fixes.

## Spinner → Unity export sessions

Each session has its own full English note:

- [[Spinner Unity Phase 2]] — control track, Spine clip parity round 1, opt-in auto-build, import fixes.
- [[Spinner Unity Phase 3]] — symbol land/win Spine overlays, parity round 2, mix bug fixes.
- [[Spinner Unity Phase 4]] — baked overlays into prefab `Fx`, single shared-atlas export.
- [[Spinner Unity Phase 5]] — present-win clip, one mask + native 1:1, runtime API.

Related: [[Scene Studio]] · [[Scene Studio Design]] · [[Spinner Design]]
