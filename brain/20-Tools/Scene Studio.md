---
type: tool
tool: Scene Studio
category: 🎬 Scene Studio
status: in-progress
priority: P0
updated: 2026-06-16
tags: [scene-studio, pixi, animation, unity]
---

# Scene Studio

Pixi v8 scene editor/animator (~7K lines, `fullBleed`). Layer hierarchy, 5 keyframe
channels with cubic-bezier/Hermite curves, auto-key, timeline + flow interpreter
(wait/signal/emit), motion-path overlay, Spine + video layers, FS Access
persistence, undo/redo. Source: `SceneStudio/`.

Spine-2D-style document model (2026-06-14): a **Project** (`ygg-project/1`) owns a
**shared asset pool** and many **scenes** (`ygg-scene/2`), each with multiple
**timelines** (`timelines[]` replaces the single `flow`; live `flow` mirrors the
active one). Scene **variants** (`variantOf`), a **Setup vs Animate** toolbar toggle,
and **per-timeline Unity bake** (one `.anim` per timeline, descriptor
`ygg-unity-scene/2`). Engine: `engine/projectModel.js` + `engine/sceneModel.js`.

- **Good**: feature depth rivals desktop tools; clean module split (`projectModel.js`,
  `sceneModel.js`, `keyframes.js`, `flowInterpreter.js`, `pixiApp.js`); Spine + video;
  project/scenes/timelines + variants; local FS + IndexedDB autosave; undo/redo; tests
  on the project/timeline model (`projectModel.test.mjs`, `perTimeline.test.mjs`).
- **Phase 4 web export — WebM SHIPPED 2026-06-14** (`engine/webmExport.js` +
  `WebMExportDialog` + `PixiViewport.exportWebM()`: deterministic, native-res, opaque).
- **Wanted (P0)**: hero-frame PNG + PNG sequence exporters (WebM done). *(Pixi v8
  rapid-rebuild crash now **FIXED** — `pixiApp.js` `Assets.load()`; boundary kept as
  failsafe.)* Filters defined but not UI-wired; editable/auto clip-naming for
  static-PNG clips still open.

- **Timeline keyframe multi-select (2026-06-15)**: marquee box-select keys within a
  selected clip; drag the selection (dot or box body) to move; box edges scale
  timing; Ctrl+C/V/Delete on keys **and** clips; clip-expansion on drag past edges
  (`transformClipKeys`). Frozen-column timeline (sticky labels), Setup-mode default,
  spinner re-edit wizard, "frame in front" grey-out. See the session note.

- **Viewport fullscreen button (2026-06-16)**: a ⛶/🗗 toggle pinned top-right of
  `.scene-viewport-wrap` calls the native Fullscreen API on the wrap element
  (`SceneStudioInner` `toggleFullscreen` + `fullscreenchange` listener). No manual
  canvas resize — `PixiViewport`'s existing `ResizeObserver` refits the renderer
  when the wrap grows. Esc exits and syncs the icon.

- **Direct (scenario) mode — third studio mode (2026-06-16)**: a Blueprint-style
  node graph that sequences *animate*-authored **timelines** into a branching
  **scenario** and plays the flow start→end in the same Pixi preview. Project-level
  (`project.scenarios[]`, schema `ygg-project/2`); nodes bind to `{sceneId,
  timelineId}`. Global-time **scrubbable** playback (`engine/scenarioTimeline.js` +
  `sampleScenario`), same-scene crossfade rendering (`engine/scenarioBlend.js`), per-
  source active-edge exclusivity, transition/entry inspector. P1–P4 shipped; Unity
  `YggScenarioPlayer.cs` export is P5. Full design: [[Scene Studio Direct Mode]].

## Sub-objects & docs

- [[Spinner Design]] — deterministic slot-machine Spinner object (Phase 5).
- Full design: [[Scene Studio Design]] · [[Scene Studio Direct Mode]] (scenario graph).
- Sessions: [[Scene Studio Phase Status]], [[Next Phase Scene Tool]],
  [[Session 2026-06-16 Scene Studio Direct Scenario Mode]],
  [[Session 2026-06-15 Scene Studio Keyframe Multiselect Timeline and Overlays]].
- Unity export sessions: [[Spinner Unity Phase 2]] … [[Spinner Unity Phase 5]].

> [!success] Shipped
> Phases 1–3.7, per-key tangent model, path-mode position, Phase 4.2 Unity
> `.unitypackage` export, the project/scenes/timelines + Setup-Animate rework
> (per-timeline Unity bake), and the [[Spinner Design|Spinner]] all landed. The
> retired Slot Machine soft-redirects here via `TOOL_ALIASES`.
