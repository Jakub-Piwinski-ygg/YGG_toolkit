# Scene Studio

See `react-app/SCENE_STUDIO.md` (root of react-app) for the full design.

## Status (2026-06-01)

Phases 1–3 land + Phase 3.5 timeline overhaul. Phase 3.7 (keyframe
channels) is the next big chunk; Phase 4 (exporters) after that. See
§18 **Phase audit** in `react-app/SCENE_STUDIO.md` for the full
code-vs-spec reconciliation.

- **Phase 1 — skeleton** (DONE, exceeded scope): Pixi v8 mount with
  permanent RAF + stage frame, PNG sprite layers, save/load
  `scene.json` (quick mode + scaffold mode via FS Access), hierarchy
  tree with reparenting DnD, inspector, orientation toggle with
  copy-on-write transforms. Beyond plan: pan/zoom viewport with
  snap-guides, 8-handle resize widget, drag-folder-as-root, Firefox
  / Safari read-only virtual handle fallback, `window.__sceneStudio`
  debug API.
- **Phase 2 — Spine + video** (DONE, minus filters): three-file Spine
  drop with Yggdrasil shared-atlas fallback, Spine inspector
  (animation list + skin picker, auto-pick `idle`), video layers
  with loop/mute. **Pixi filters (`effects[]`) not wired — Phase 2
  carryover, lands with Phase 4.**
- **Phase 3 / 3.5 — timeline + flow + UI overhaul** (DONE): timeline
  with per-layer multi-tracks, drag-from-hierarchy to add a track,
  draggable/resizable clip blocks, scrubber on the ruler, clips
  carry `start / duration / loop / curve` plus Spine `anim` and a
  2-endpoint PNG `tween`, markers (`wait`, `waitForClick`,
  `waitForSignal`, `emit`), play/pause/stop, viewport click-to-
  resume, signal bus with replay semantics, graph-shaped
  `flow.nodes/edges` derived from the linear UI, keyboard Delete on
  the selected clip. **Gaps:** `loop` marker type defined in §4 is
  not implemented; the `tween` model is the bottleneck the next
  phase rewrites.
- **Phase 3.7 — keyframe channels + curve editor**: not started.
  Replaces 2-endpoint `tween` with per-property channels (`keys[]`
  with `t / v / out`) and adds auto-key recording + editable
  cubic-bezier curves. Full spec in §19 of `SCENE_STUDIO.md`.
- **Phase 4 — exporters + polish**: not started. Hero PNG / PNG
  sequence / WebM + `pixi-filters` (Phase 2 carryover) + `Preview/`
  scaffolding.

**GlowForge is no longer part of Scene Studio.** It will ship as its
own top-level Art Tool. Scene Studio imports its output as a
`pngSequence` asset like any other numbered-PNG folder.

## Module map

```
SceneStudio/
├── SceneStudioTool.jsx     React.lazy wrapper + meta
├── SceneStudioInner.jsx    main component (state + handlers)
├── meta.js                 public meta for registry
├── engine/
│   ├── sceneModel.js       JSON shape + validator + defaults
│   ├── persist.js          load/save + FS Access + asset resolution
│   ├── pixiApp.js          Pixi v8 lifecycle + scene graph builder
│   ├── flowInterpreter.js  timeline hold/signal logic
│   ├── assetBrowser.js     project-folder scan for png/video/spine entries
│   └── orientationManager.js  copy-on-write transforms
├── components/
│   ├── PixiViewport.jsx    canvas host, mount/unmount Pixi
│   ├── AssetBrowserPanel.jsx
│   ├── HierarchyPanel.jsx
│   ├── TimelinePanel.jsx
│   ├── InspectorPanel.jsx
│   └── StudioToolbar.jsx
└── styles/
    └── scene-studio.css
```
