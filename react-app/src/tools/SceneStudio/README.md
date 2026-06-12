# Scene Studio

See `react-app/SCENE_STUDIO.md` (root of react-app) for the full design.
Phase 5 (deterministic slot-machine **Spinner** object) is designed in
`react-app/SPINNER.md` — milestones M0–M6, in progress.

## Status (2026-06-02)

Phases 1–3.7 land (skeleton + Spine/video + timeline/flow + full
keyframe-channel animation). Phase 4 (exporters) is next. The full
as-built record of the animation system is **§20** in
`react-app/SCENE_STUDIO.md`; **§18** is the older phase audit and
**§19** is the original Phase 3.7 proposal (superseded by §20).

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
  draggable/resizable clip blocks, scrubber on the ruler, markers
  (`wait`, `waitForClick`, `waitForSignal`, `emit`), play/pause/stop,
  viewport click-to-resume, signal bus with replay semantics,
  graph-shaped `flow.nodes/edges`. **Gap:** `loop` marker type
  defined in §4 is not implemented.
- **Phase 3.7 — keyframe-channel animation** (DONE, far past original
  scope — see §20): replaced the 2-endpoint `tween` with multi-key
  **logical channels** — `position` / `scale` (vec2), `rotation` /
  `alpha` (scalar), `tint` (rgb). Each key is `{ t, v, out }` where
  `out` is a preset OR an editable cubic-bezier. Highlights:
  - **Auto-key** with an on/off toggle: editing a transform (inspector
    or viewport drag) while a clip is selected + playhead inside it
    records a keyframe; off = base-pose only.
  - **`+ key…` dropdown** to key specific targets at the playhead
    (key all / position / x / y / scale / rotation / alpha / tint).
  - **Graph view** (`ClipGraphEditor`) — whole-clip, one absolute-Y
    subplot per channel, 2D-draggable keys; plus a **list view**.
  - **Editable cubic-bezier** curve editor (`CurveEditor`) per segment.
  - **Link / split** per channel — vec2/rgb components can share one
    curve (linked) or get independent curves (split).
  - **Timeline diamonds** colour-coded per channel, vertically
    **stacked** when sharing a frame; click selects + seeks, drag
    moves, Delete / Ctrl+C/V/D edit the selected key.
  - **Motion-path overlay** on the scene for animated `position`,
    gradient-shaded by `alpha` / `tint` / `scale`.
  - Channels hold their last value past a clip's end (no snap-back).
  - **Known issue:** Pixi v8 viewport can still crash on rapid
    add+rebuild of large PNGs (`SpritePipe … 'orig' of null`); a
    `PixiErrorBoundary` isolates it. See §20.10 — top carryover.
- **Phase 4 — exporters + polish**: not started. Hero PNG / PNG
  sequence / WebM + `pixi-filters` (Phase 2 carryover) + `Preview/`
  scaffolding + `pngSequence` asset import.

**GlowForge is no longer part of Scene Studio.** It will ship as its
own top-level Art Tool. Scene Studio imports its output as a
`pngSequence` asset like any other numbered-PNG folder.

## Module map

```
SceneStudio/
├── SceneStudioTool.jsx     React.lazy wrapper + meta
├── SceneStudioInner.jsx    main component (state + handlers + auto-key + undo)
├── meta.js                 public meta for registry
├── engine/
│   ├── sceneModel.js       JSON shape + validator + channel migration/normalize
│   ├── persist.js          load/save + FS Access + asset resolution
│   ├── pixiApp.js          Pixi v8 lifecycle + scene graph + applyPngChannels + motion path
│   ├── flowInterpreter.js  timeline hold/signal logic + clipAt / lastClipAt
│   ├── assetBrowser.js     project-folder scan for png/video/spine entries
│   ├── orientationManager.js  copy-on-write transforms
│   └── animation/
│       ├── keyframes.js    channels: eval, insert/move/split/link, CHANNEL_DEFS
│       └── curves.js       cubic-bezier solver + presets
├── components/
│   ├── PixiViewport.jsx    canvas host, mount/unmount Pixi, selection + motion-path redraw
│   ├── PixiErrorBoundary.jsx  isolates Pixi crashes from the rest of the UI
│   ├── AssetBrowserPanel.jsx
│   ├── HierarchyPanel.jsx
│   ├── TimelinePanel.jsx   tracks, clip blocks, stacked keyframe diamonds, auto-key + add-key UI
│   ├── ClipGraphEditor.jsx whole-clip multi-channel graph (2D-draggable keys, split sub-rows)
│   ├── CurveEditor.jsx     editable cubic-bezier popover
│   ├── InspectorPanel.jsx  layer + clip sections, channel chips, graph/list toggle
│   ├── DragNumberField.jsx scrub-on-drag number input
│   └── StudioToolbar.jsx   scene name, save/load, orientation, live-preview, undo/redo
└── styles/
    └── scene-studio.css
```
