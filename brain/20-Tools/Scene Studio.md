---
type: tool
tool: Scene Studio
category: 🎬 Scene Studio
status: in-progress
priority: P0
updated: 2026-06-14
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
- **Wanted (P0)**: **Phase 4 web exporters not shipped** (hero PNG / PNG sequence /
  WebM) — single biggest gap; Pixi v8 rapid-rebuild crash (contained, not fixed);
  filters defined but not UI-wired.

## Sub-objects & docs

- [[Spinner Design]] — deterministic slot-machine Spinner object (Phase 5).
- Full design: [[Scene Studio Design]].
- Sessions: [[Scene Studio Phase Status]], [[Next Phase Scene Tool]].
- Unity export sessions: [[Spinner Unity Phase 2]] … [[Spinner Unity Phase 5]].

> [!success] Shipped
> Phases 1–3.7, per-key tangent model, path-mode position, Phase 4.2 Unity
> `.unitypackage` export, the project/scenes/timelines + Setup-Animate rework
> (per-timeline Unity bake), and the [[Spinner Design|Spinner]] all landed. The
> retired Slot Machine soft-redirects here via `TOOL_ALIASES`.
