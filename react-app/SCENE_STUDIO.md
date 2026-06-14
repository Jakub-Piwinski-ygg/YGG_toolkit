# Scene Studio — design document

> Status: **Phases 1–3.7 landed** (skeleton + Spine/video + timeline/flow
> + full keyframe-channel animation). Phase 3.7 grew well past its
> original scope across rounds 4–6 — see **§20** for the as-built record.
> Since the §18 audit, **Phase 4.2 (Unity `.unitypackage` export) and
> Phase 5 (Spinner, `SPINNER.md`) have also shipped**, plus per-key
> tangent-model keyframes and path-mode position animation
> (`SCENE_STUDIO_PHASE_STATUS.md`). **Phase 4 web exporters (hero PNG /
> PNG sequence / WebM) remain NOT started**, as do pixi-filters wiring,
> `pngSequence` rendering, and the `loop` marker.
> GlowForge is no longer part of Scene Studio — it will ship as its own
> top-level Art Tool.
> Branch: work continues on `main` (the originally-proposed
> `feat/scene-studio` branch was never cut).
> Last updated: 2026-06-12.
>
> **Read order for the animation system:** §19 is the original Phase 3.7
> *design proposal* (per-property channels, single shared key per vec2).
> §20 is the **as-built** record — it supersedes §19 wherever they
> differ (vec2/vec3 logical channels, alpha+tint, graph editor, motion
> path, split channels, auto-key toggle, add-key menu). When in doubt,
> §20 + the code win.

> See §18 **Phase audit** at the bottom for the line-by-line
> reconciliation between this document and the code on disk.

---

## 0. TL;DR

Scene Studio is a new top-level category in the YGG Toolkit. It is a stateful,
Pixi-rendered scene editor for slot-game art previews. Artists compose a scene
from PNG sprites, Spine animations and video, animate PNG properties with
multi-keyframe channels recorded by an auto-key inspector, drive sequencing
with a single timeline that can pause on user clicks or named signals, then
export landscape (1920×1080) and portrait (1080×2160) previews — both as
single hero-frame PNGs (consumed by Asset Checker) and as PNG sequences /
WebM movies.

**GlowForge is not part of Scene Studio.** It will ship as its own top-level
Art Tool (like every other tool in the toolkit). Its output (a PNG sequence)
can be imported into Scene Studio as a `pngSequence` asset like any other
externally-produced sequence — Scene Studio does not host it as a bake panel.

This document is the **single source of truth** for `scene.json`, the flow
model, the module layout, and the phased implementation plan. Anything not
covered here is either out of scope (§13) or an open decision (§12).

---

## 1. Goals and non-goals

### Goals

1. **Composition editor** — drop in PNG / Spine / video assets, position them,
   stack them, see them live at 60 fps.
2. **Animation** — per-property keyframe channels on PNG layers (x, y,
   scale, rotation, …) authored with an auto-key inspector: select a clip,
   scrub anywhere inside it, change a property → keyframe lands at the
   playhead. Per-segment easing with presets or an editable cubic-bezier.
3. **Sequencing** — single-track timeline with clips per layer + hold markers
   that pause playback until a condition is met (time / click / named signal).
4. **Multi-orientation** — one scene, two viewport modes (landscape /
   portrait), per-layer transforms diverge on edit (copy-on-write).
5. **Reproducible** — scene is fully described by `scene.json`. Re-opening a
   scene with the same asset folder reproduces the same render frame-by-frame.
6. **Export** — single-frame PNG per orientation (hero frame), PNG sequence
   (linear-mode timeline), WebM (linear-mode timeline).
7. **Pipeline-aware** — scenes live next to project art in the existing Unity
   `Art/_Game/<element>/` layout and reference assets by relative paths. No
   asset copying.

### Non-goals (for MVP)

- Node-graph view for flow (timeline-only UI in MVP; internal model is
  graph-shaped so node view can be added later without migrating files).
- Animating non-numeric properties via keyframes (no `visible` / `blend` /
  `anchor` keys in MVP — numeric transform channels only). Spine layers are
  driven by their own animations, not by Scene Studio keyframes.
- Audio (Spine event sounds, video sound) — mute by default, no UI.
- Particle systems — deferred to future phase.
- Collaborative editing, version history, undo/redo across sessions.
- Mobile / touch input on the editor itself.

---

## 2. Real-world scaffold context

The reference project we are targeting:
`C:\Users\jakub.pi\game-toothless-smile\Assets\Games\Toothless Smile\Art\_Game\`

Observed structure (NOT what `ProjectScaffold` currently generates):

```
_Game/
├── 01_Preloader/        ← flat PNG (bg_splash.png, logo.png, logo_SE.png)
├── 02_Splash/           ← flat PNG
├── 03_BaseGame/
│   └── StaticArt/       ← bg_base_game.png, bg_machine.png, fs_counter.png
├── 04_FreeSpins/
├── 05_BonusGame/
│   ├── Animation/       ← Spine: *.json + *.atlas.txt + *.png (+ Unity .asset/.mat artifacts)
│   └── StaticArt/
├── 06_Win_Sequence/
│   ├── Animation/       ← base game.json, total_win.json, wins.json, ... (Spine 4.2.43)
│   └── StaticArt/       ← big_win.png, mega_win.png, super_win.png, dark_layer_60.png, ...
├── 07_Intro/            ← flat PNG
├── 08_Symbols/
│   ├── Animations/      ← note plural
│   ├── Blurred/
│   └── StaticArt/
├── 09_WinTicker/
├── 10_Fonts/            ← per-font subfolders (font_win_A-Z/font_win.png, ...)
├── 12_Payline/
├── 13_BuyBonus/
└── 14_PayTable/
```

Key takeaways:

- **Spine 4.2.43 JSON** (not `.skel` binary). Bone naming convention includes
  semantic roles like `text`, `bg` — Yggdrasil uses `text` as a slot for
  Unity runtime to attach dynamic strings.
- **Atlas extension is `.atlas.txt`** (Unity convention to make atlases
  text-importable). Studio's loader must read these as plain text regardless
  of extension.
- **Unity artifacts** (`*.spriteatlasv2`, `*_SkeletonData.asset`,
  `*_Atlas.asset`, `*_Material.mat`) are runtime artifacts. Studio ignores
  them when listing loadable assets.
- **No `Preview/` folder anywhere.** Scenes must not assume one exists. Save
  location is user-picked via dialog; default convention proposed in §10.
- **No `Export/` / `Source/` split.** The current `ProjectScaffold` tool
  generates a more aspirational layout. Scene Studio must work with both
  the aspirational layout AND the real flat one.

Consequence: **Scene Studio is structurally agnostic.** It accepts any folder
as `projectRoot` and treats `assets[].src` as freeform relative paths.

---

## 3. Architecture — three orthogonal layers

```
                  ┌──────────────────────────────┐
                  │   scene.json (source of truth)│
                  ├──────────────────────────────┤
                  │  assets:    [ ... ]          │  ← what exists (files)
                  │  layers:    [ ... ]          │  ← what's on the stage
                  │  effects:   [ ... ]          │  ← per-layer modifiers (Pixi filters)
                  │  flow:      { nodes, edges } │  ← when things happen
                  │  stage:     { ... }          │  ← canvas dimensions, fps
                  └──────────────┬───────────────┘
                                 │ build / rebuild
                                 ▼
                  ┌──────────────────────────────┐
                  │   Pixi scene graph (transient)│
                  │   - PIXI.Application          │
                  │   - Container per layer       │
                  │   - Filter list per layer     │
                  │   - Spine instances           │
                  │   - AnimatedSprite for PNG seq│
                  └──────────────┬───────────────┘
                                 │ each frame
                                 ▼
                  ┌──────────────────────────────┐
                  │   Flow interpreter            │
                  │   - tracks playhead time      │
                  │   - resolves hold markers     │
                  │   - drives layer/effect state │
                  └──────────────────────────────┘
```

Three layers of state are kept **orthogonal**:

| Layer    | Owns                                   | Mutated by               |
|----------|----------------------------------------|--------------------------|
| Asset    | file references, types                 | drop / upload            |
| Stage    | viewport size, fps, current orientation| viewport toggle, settings|
| Layers   | which assets are on stage, transforms  | drag, inspector, tools   |
| Effects  | filters attached to layers             | effect panel             |
| Flow     | clips, hold markers, signals           | timeline editor          |

This separation matters because each can be changed without rebuilding the
others. Repositioning a layer doesn't invalidate the timeline. Adding an
effect doesn't invalidate the asset list. Etc.

---

## 4. Project + scene schema

> **v2 (2026-06-14):** the document is now a **Project** (`ygg-project/1`) that
> owns a **shared asset pool** and references **multiple scenes**. Each scene
> bumped to `ygg-scene/2`, replacing the single `flow` with a **`timelines[]`**
> array + `activeTimelineId`. Legacy `ygg-scene/1` files (inline `flow` +
> `assets`) still open: the flow migrates to `timelines[0]` ("Timeline 1") and
> a lone scene loads as a 1-scene project. See `engine/projectModel.js` +
> `engine/sceneModel.js`; migration is covered by `engine/projectModel.test.mjs`.

### `project.json` (top-level document, schema `ygg-project/1`)

```json
{
  "$schema": "ygg-project/1",
  "version": 1,
  "name": "Big Win Project",
  "assets":  [ /* SceneAsset[] — shared pool, moved out of scenes */ ],
  "scenes":  [ { "id": "...", "name": "...", "variantOf": null, "data": { /* scene */ } } ],
  "activeSceneId": "...",
  "exports": { ... },
  "meta":    { ... }
}
```

`project.json` is a **single source of truth** — every scene is stored inline as
`data` (scenes aren't shared between projects, so there's no file-per-scene
split). Scaffold mode writes `project.json` into the linked folder; quick mode
downloads it. `duplicateSceneAsVariant` records `variantOf` = the source scene id
(Unity-prefab-variant style). A `file` ref on a `scenes[]` entry is still
tolerated on load for back-compat, but the editor always writes inline `data`.

### Scene file (schema `ygg-scene/2`)

```json
{
  "$schema": "ygg-scene/2",
  "version": 2,
  "name": "Win Sequence Big Win Preview",
  "variantOf": null,
  "projectRoot": "<absolute or relative — see §10>",
  "stage":   { ... },
  "canvases": [ ... ],
  "activeCanvasId": "...",
  "layers":  [ ... ],          // layer.assetId -> project.assets pool
  "effects": [ ... ],
  "timelines": [               // was `flow` — one entry per timeline
    { "id": "...", "name": "Timeline 1", "tracks": [ ... ], "markers": [ ... ], "nodes": [], "edges": [] }
  ],
  "activeTimelineId": "...",
  "exports": { ... },
  "meta":    { "createdAt": "...", "author": "...", "toolkitVersion": "..." }
}
```

Each timeline keeps the exact shape of the legacy `flow` so `deriveFlowGraph`,
`normalizeTrack`, `normalizeClip` are reused unchanged. In the running editor a
live `flow` mirror = the active timeline; `syncFlowToActiveTimeline()` commits
it back into `timelines[]` before save / timeline-switch / export. Scene assets
are **not** written into scene files (the project pool owns them); inline
`assets[]` on a legacy file are tolerated and folded into the pool on load.

### Setup vs Animate modes

The studio toolbar toggles **Setup** (no timeline — drag objects to set the
default pose per orientation; edits route to the base pose) and **Animate**
(timelines visible; with auto-key ON edits write keyframes, with auto-key OFF
edits are transient and snap back). Base-pose editing only happens in Setup.

### `stage`

```json
{
  "fps": 30,
  "duration": 5.0,
  "orientations": {
    "landscape": { "w": 1920, "h": 1080 },
    "portrait":  { "w": 1080, "h": 2160 }
  },
  "activeOrientation": "landscape",
  "background": { "type": "checker" | "color", "value": "#000000" }
}
```

- `fps` and `duration` are timeline-global. The timeline scrubber operates in
  frames `0..(fps*duration - 1)`.
- `orientations` is fixed to landscape/portrait pair. Sizes are defaults from
  Yggdrasil's reference (1920×1080 + 1080×2160) and can be overridden per
  scene if needed.

### `assets[]`

Two modes share the same schema. Mode is implicit from `src`:

```json
{
  "id": "a1",
  "type": "png" | "spine" | "video" | "pngSequence",
  "src": "06_Win_Sequence/Animation/wins.json",      // scaffold mode (relative)
  "src": "data:image/png;base64,...",                // quick mode (embedded)
  "atlas": "06_Win_Sequence/Animation/wins.atlas.txt", // spine only
  "texture": "06_Win_Sequence/Animation/wins.png",     // spine only (atlas page)
  "frames": ["..._0001.png", "..._0002.png", ...],     // pngSequence only
  "fps": 30,                                           // pngSequence only
  "meta": { "originalName": "wins.json", "size": 12345 }
}
```

- **Scaffold mode**: `src` is a relative path from `projectRoot`. Resolved
  via `FileSystemDirectoryHandle.getFileHandle()` chain.
- **Quick mode**: `src` is a `data:` URL (base64). Survives `JSON.stringify`.
- **pngSequence** holds a pre-baked sequence (numbered PNGs from any
  external producer — a future GlowForge tool, an exported Spine sprite
  strip, hand-drawn frames). Stored as a list of frames + fps; renderer
  wraps in `PIXI.AnimatedSprite`.

### `layers[]`

```json
{
  "id": "L1",
  "name": "wins (spine)",
  "assetId": "a1",
  "visible": true,
  "blend": "normal" | "additive" | "screen" | "multiply",
  "transforms": {
    "landscape": { "x": 960, "y": 540, "scale": 1, "rotation": 0, "anchor": [0.5,0.5] },
    "portrait":  null
  },
  "spine": {
    "skin": "default",
    "defaultAnimation": "idle",
    "loop": true
  }
}
```

- `transforms.portrait: null` means "inherit from landscape" until first edit
  in portrait viewport. On first portrait edit, the system **copies the
  current landscape value into portrait and only then mutates it**
  (copy-on-write). Reverting portrait sets it back to `null`.
- `blend` maps to Pixi `BLEND_MODES`.
- `spine.*` fields only apply when the asset is type=spine.
- Layer z-order = array order (first = bottom).

### `effects[]`

```json
{
  "id": "E1",
  "type": "glow" | "blur" | "colorMatrix" | "outline",
  "targetLayer": "L1",
  "enabled": true,
  "params": { ... type-specific ... }
}
```

- In MVP, effects are **Pixi filters** attached to the target layer's
  Container. Live, no bake step.
- Effect-as-Pixi-filter is used for cheap things: `BlurFilter`,
  `ColorMatrixFilter`, `OutlineFilter` from `pixi-filters`. These render at
  60 fps with zero CPU cost.

### `flow`

The flow is internally a **DAG** but in MVP UI is rendered as a single linear
timeline. See §5.

```json
{
  "tracks": [
    {
      "id": "T1",
      "layerId": "L1",
      "clips": [
        { "id": "C1", "start": 0.0, "duration": 3.5, "anim": "big_win_in" },
        { "id": "C2", "start": 3.5, "duration": 2.0, "anim": "big_win_loop", "loop": true }
      ]
    }
  ],
  "markers": [
    { "id": "M1", "time": 3.5, "type": "waitForClick" },
    { "id": "M2", "time": 5.5, "type": "wait", "duration": 0.5 },
    { "id": "M3", "time": 6.0, "type": "emit", "signal": "win_done" }
  ]
}
```

Marker types:

| Type             | Behavior                                                     |
|------------------|--------------------------------------------------------------|
| `wait`           | Pause playhead for `duration` seconds. Same as a gap.        |
| `waitForClick`   | Pause playhead until canvas click. Linear export = wait(1.0).|
| `waitForSignal`  | Pause until `emit(signal)` fires.                            |
| `emit`           | Fire a named signal (instant, doesn't pause).                |
| `loop`           | Jump playhead to `target` marker. End-of-scene loop.         |

### `exports`

```json
{
  "heroFrame": { "landscape": 30, "portrait": 30 },
  "pngSequence": { "padDigits": 4, "renumber": true, "destSubdir": "Preview/" },
  "webm": { "fps": 30, "bitrate": 5000000 }
}
```

- `heroFrame` = frame index (in current orientation's timeline) to use for
  single-frame PNG export. Default = whichever frame the scrubber is on
  when "Export hero" is clicked; persisted on save.
- `destSubdir` defaults to `Preview/` — created if missing.

---

## 5. Flow timeline — MVP UI, future-proof model

### UI in MVP (timeline)

```
┌────────────────────────────────────────────────────────────────────┐
│ ▶ ⏸ ⏹    [00:00:30 / 00:05:00]   ⊕ Add clip   ⊕ Add marker        │
├────────────────────────────────────────────────────────────────────┤
│ L1 wins   │██████████████│waitForClick│██████│   loop ►            │
│ L2 coins  │              │            │██████████│ emit("done")    │
│ L3 bg     │████████████████████████████████████████ (continuous)   │
└────────────────────────────────────────────────────────────────────┘
   scrubber ─────────────●─────────────────────────────────
```

- One row per layer.
- Clips are rectangles, draggable on start, resizable on end.
- Markers are vertical lines spanning all tracks (they pause the *global*
  playhead).
- Click a clip → inspector shows `anim`, `loop`, etc.
- Click a marker → inspector shows marker type + parameters.
- Right-click on timeline → context menu: add clip, add marker.

### Internal model: graph-shaped, even when UI is linear

```js
flow.nodes = [
  { id: "n1", kind: "clip",   layerId: "L1", anim: "big_win_in", duration: 3.5 },
  { id: "n2", kind: "wait",   condition: "click" },
  { id: "n3", kind: "clip",   layerId: "L1", anim: "big_win_loop", duration: 2.0, loop: true },
  { id: "n4", kind: "emit",   signal: "win_done" }
];
flow.edges = [
  { from: "n1.done", to: "n2.start" },
  { from: "n2.done", to: "n3.start" },
  { from: "n3.done", to: "n4.start" }
];
```

For MVP, edges are auto-derived from clip/marker time ordering — the editor
never shows them. When we add the node-graph view later, edges become
user-editable and the linear-time assumption goes away.

Why bother now: file format is stable. Scenes saved with timeline UI can be
opened by future node-UI users without migration.

### Linear-mode export

For PNG sequence / WebM export, the renderer needs a **deterministic linear
timeline**. Interactive markers degrade gracefully:

| Marker         | Linear export behavior                        |
|----------------|-----------------------------------------------|
| `wait(t)`      | Wait `t` seconds (literal).                   |
| `waitForClick` | Wait `linearClickFallback` seconds (UI-set, default 1.0). |
| `waitForSignal`| Wait `linearSignalFallback` seconds (default 0.5). |
| `emit`         | Skipped (no side effect in linear mode).      |
| `loop`         | Skipped (no loop in linear export).           |

UI shows a warning banner when interactive markers exist and the export
button is pressed: *"Scene uses interactive markers — they will be replaced
by fixed waits. Adjust fallback in Export panel."*

---

## 6. Multi-orientation — copy-on-write transforms

### Model

Each layer's `transforms` object holds one entry per orientation.

```json
"transforms": {
  "landscape": { "x": 960, "y": 540, "scale": 1, "rotation": 0 },
  "portrait":  null
}
```

- `null` means "inherit from landscape" (the canonical orientation).
- On first user edit in portrait mode, the system performs a
  copy-on-write: copies the resolved landscape values into portrait, then
  applies the edit only to portrait.
- A "Reset portrait to landscape" button on the layer inspector restores
  `portrait` to `null`.

### Viewport switching

- A toggle in the viewport header: `[ Landscape ▣  Portrait ◻ ]`.
- Switching repaints the stage at the orientation's dimensions and rebuilds
  layer positions from the chosen `transforms.{orientation}` (resolving
  `null` to landscape).
- The flow timeline is **shared** across orientations — same clips, same
  markers, same hero frame index. Only positions diverge.

### Export

- "Export hero PNG" exports **both** orientations to `Preview/landscape.png`
  and `Preview/portrait.png` in one click.
- PNG sequence / WebM export prompts for orientation (default: current).

---

## 7. Layer types

| Type          | Backing Pixi object                | Source                                |
|---------------|------------------------------------|---------------------------------------|
| `png`         | `PIXI.Sprite` with `Texture.from(File)` | single PNG file                  |
| `spine`       | `Spine` (from `@esotericsoftware/spine-pixi-v8`) | `.json` + `.atlas.txt` + `.png` |
| `video`       | `PIXI.Sprite` with `Texture.from(videoElement)` | `.mp4` / `.webm` |
| `pngSequence` | `PIXI.AnimatedSprite` from frame array | pre-baked PNG sequence (any source) |

### Spine specifics

- Atlas file extension is `.atlas.txt` (Unity convention) — loader reads as
  plain text regardless of extension.
- Asset references for spine layer: 3 files (data JSON, atlas, texture).
  All three relative paths stored on the `assets[]` entry.
- Spine bone naming convention at Yggdrasil includes semantic roles like
  `text` (Unity runtime attaches dynamic strings). Scene Studio is
  read-only with respect to bones — it just plays animations.
- Animations are Spine's own keyframed tracks. Scene Studio does not animate
  Spine bones; it picks which animation to play per clip via
  `clip.anim = "<animation name>"`.

### Video specifics

- `HTMLVideoElement` with `.src = blob URL` then `Texture.from(videoEl)`.
- Pixi syncs the texture each tick. Muted, autoplay-on-clip-start.
- Loop is per-clip (not per-video).

### pngSequence specifics

- Stored as a list of frame paths (in scaffold mode) or base64 frames
  (quick mode).
- `fps` is per-asset, independent of stage fps — `AnimatedSprite.animationSpeed`
  is computed each tick.
- Imported as a numbered-PNG folder drop (§8).

---

## 8. Sequence assets (importing pre-baked PNG sequences)

Scene Studio does **not** host any bake tool itself — no GlowForge panel,
no shadow generator, no particle baker. Bake tools live as their own
top-level Art Tools in the YGG Toolkit (existing model: each tool ships
independently). Scene Studio consumes their output as a `pngSequence`
asset:

- Drop a folder of numbered PNGs (`*_0001.png`, `*_0002.png`, …) onto the
  viewport or the Assets panel → registered as a single `pngSequence`
  asset with the frame list and a `fps`.
- Inspector exposes `fps` and a "loop in clip" toggle. Pixi renders as
  `AnimatedSprite` and seeks per-clip according to the active clip's time.
- A `pngSequence` layer is just another layer in the timeline; it can
  carry channels and curves like any other PNG.

GlowForge (and any future bake tool) ships separately and writes its
output into the Unity art folder; Scene Studio picks it up via the file
system, no integration code required.

---

## 9. Render pipeline

### Tick

For each `requestAnimationFrame`:

1. **Flow interpreter** advances playhead by `deltaSeconds * playbackRate`.
2. If playhead hits a non-pass-through marker (`wait`, `waitForClick`,
   `waitForSignal`), playhead is held until the condition resolves.
3. For each track, the active clip at the current time is resolved.
   - For `spine` layers: set `spine.state.setAnimation(0, clip.anim, clip.loop)`
     if not already set.
   - For `video` layers: ensure `videoEl.play()` and seek to clip-relative time.
   - For `pngSequence` layers: set `animatedSprite.currentFrame` based on
     clip-relative time × asset fps.
   - For `png` layers: visibility on/off based on clip presence.
4. Effects (Pixi filters) are kept attached as long as
   `effect.enabled === true`. Filter params can change per-frame if the
   effect supports it (not in MVP).
5. Pixi renders.

### Linear export

Same as tick, but:
- `deltaSeconds = 1 / stage.fps`.
- Markers degrade per §5 ("Linear-mode export").
- After each tick, `app.renderer.extract.canvas(stage)` produces an
  `HTMLCanvasElement` → `.toBlob('image/png')`.
- For WebM: `canvas.captureStream(fps)` piped into `MediaRecorder`.

---

## 10. Asset loading — scaffold mode and quick mode

### Scaffold mode

1. User clicks "Open scene…" → `window.showDirectoryPicker()` returns a
   `FileSystemDirectoryHandle` (`projectRoot`).
2. Studio looks for `scene.json` in the picked folder, or prompts user to
   create a new one.
3. Each `assets[].src` is resolved by walking the dir handle:
   ```js
   async function resolveAsset(rootHandle, relPath) {
     const segments = relPath.split('/');
     let h = rootHandle;
     for (let i = 0; i < segments.length - 1; i++) {
       h = await h.getDirectoryHandle(segments[i]);
     }
     return await h.getFileHandle(segments[segments.length - 1]);
   }
   ```
4. File handle → `File` → `URL.createObjectURL(file)` → Pixi texture.
5. Directory handle is **persisted to IndexedDB** so re-opening the scene
   on Chrome restarts works without re-prompting. (Firefox/Safari: re-prompt
   each session — known limitation.)

### Quick mode

1. User opens an empty Studio (no folder picker).
2. Drags PNGs / Spine / video files into the viewport.
3. Each dropped file is read as base64 and stored inline in `assets[].src`.
4. Save → downloads `scene.json` (large because base64).
5. Optional: "Export quick scene as .zip" downloads a ZIP with `scene.json`
   + extracted asset files alongside it (for sharing without scaffold).

### Where `scene.json` lives in scaffold mode

The real Unity project has no `Preview/` folder. Studio does not enforce a
location — user picks a save path via dialog. Recommended convention
(documented in UI):

```
_Game/06_Win_Sequence/
├── Animation/                 (existing, untouched)
├── StaticArt/                 (existing, untouched)
└── Preview/                   ← created by Studio on first save
    ├── scene.json
    ├── landscape.png          ← hero frame export
    ├── portrait.png
    └── sequence/              ← if PNG sequence exported
        ├── frame_0001.png
        └── ...
```

A separate proposal (not part of this PR) is to extend `ProjectScaffold`
to add a `Preview/` leaf with rule `landscapeAndPortraitPng` to each art
element. That closes the loop with Asset Checker.

### `.atlas.txt` quirk

Spine atlases at Yggdrasil are stored with the `.atlas.txt` extension. The
Pixi Spine loader expects atlas content as a string; the file extension is
not used to detect format. Studio's loader:

```js
const atlasFile = await resolveAsset(rootHandle, layer.atlas);
const atlasText = await atlasFile.getFile().then(f => f.text());
// pass atlasText to Spine.from({...})
```

---

## 11. Module layout

```
react-app/src/tools/SceneStudio/
├── SceneStudioTool.jsx                  ← entry; meta + Component
├── meta.js                              ← exported meta + category info
├── engine/
│   ├── sceneModel.js                    ← TS-style JSDoc types + validator + migrations
│   ├── persist.js                       ← load/save scene.json; FS Access integration; IndexedDB handle store
│   ├── pixiApp.js                       ← PIXI.Application bootstrap + lifecycle
│   ├── pixiSceneBuilder.js              ← scene.json → Pixi scene graph
│   ├── flowInterpreter.js               ← playhead + marker resolution
│   ├── timelineEngine.js                ← clip lookup, signal bus
│   ├── exporter.js                      ← PNG single, PNG sequence, WebM
│   └── orientationManager.js            ← copy-on-write transform resolution
├── effects/
│   ├── registry.js
│   ├── blur.js                          ← thin wrapper over PIXI.BlurFilter
│   ├── colorMatrix.js                   ← thin wrapper over ColorMatrixFilter
│   └── outline.js                       ← OutlineFilter from pixi-filters
├── animation/
│   ├── keyframes.js                     ← segment lookup + eased lerp
│   └── curves.js                        ← preset table + cubic-bezier eval
├── panels/
│   ├── LayerListPanel.jsx               ← left: layers with visibility/blend
│   ├── InspectorPanel.jsx               ← right: selected item's params
│   ├── EffectsPanel.jsx                 ← right: list of effects on selected layer
│   ├── TimelinePanel.jsx                ← bottom: timeline + scrubber + markers + keyframe diamonds
│   └── ExportPanel.jsx                  ← right bottom: orientation/format/destination
├── components/
│   ├── PixiViewport.jsx                 ← <canvas ref> + Pixi mount/unmount
│   ├── DragDropOverlay.jsx
│   ├── ParamSlider.jsx
│   └── CurveEditor.jsx                  ← cubic-bezier popover (P1, P2 handles)
├── styles/
│   └── sceneStudio.css
└── README.md                            ← short pointer to this design doc
```

Registry change in `src/tools/registry.js`:

```js
import { sceneStudioMeta, SceneStudioTool } from './SceneStudio/SceneStudioTool.jsx';

const STUDIO = [
  { meta: sceneStudioMeta, Component: SceneStudioTool }
];

export const TOOL_CATEGORIES = [
  { id: 'arttools',   label: 'Art Tools',     icon: '🎨', tools: ART },
  { id: 'review',     label: 'Asset Pipeline',icon: '🏗️', tools: REVIEW },
  { id: 'studio',     label: 'Scene Studio',  icon: '🎬', tools: STUDIO },  // ← new
  { id: 'cheets',     label: 'Cheets',        icon: '🎲', tools: CHEETS }
];
```

`sceneStudioMeta.fullBleed = true` and `hideOutput = true` (same convention
as `ProjectScaffold`), so Studio takes the entire viewport and skips the
`OutputPanel`.

### Lazy loading

Scene Studio's bundle (Pixi v8 + spine-pixi-v8 + pixi-filters + JSZip) is
around 500-700 KB gzipped. The rest of the toolkit is small. We avoid
forcing that cost on users who never open Studio by lazy-loading:

```js
const SceneStudioTool = React.lazy(() => import('./SceneStudio/SceneStudioTool.jsx'));
```

A `<Suspense fallback={<Spinner/>}>` wraps the route.

---

## 12. Open decisions / TBDs

These are intentional unknowns. Each has a recommended default; reviewer may
overrule before implementation starts.

| # | Decision                          | Default                                       | Where to revisit |
|---|-----------------------------------|-----------------------------------------------|------------------|
| 1 | Naming for top-level category     | "Scene Studio"                                | Phase 1 PR title |
| 2 | Audio handling (Spine/video)      | Mute by default, no UI                        | Phase 2 review   |
| 3 | Browser support stance            | Chrome/Edge first-class; Firefox/Safari degraded (no IndexedDB handle, no FS Access — quick mode only) | Phase 1 |
| 4 | Should `ProjectScaffold` add `Preview/` leaf? | Yes, separate PR after Studio MVP | Future          |
| 5 | Should `AssetChecker` validate `scene.json`? | Yes, separate PR (`sceneValid` rule) | Future        |
| 6 | Studio panel width vs YGG default | 280px left, 320px right                       | Phase 1 styling  |
| 7 | Channel curve overshoot UX | Cubic-bezier `y` allowed outside `[0, 1]` for back-easing; UI clamps the plot's draw area but the value isn't capped | Phase 3.7 |
| 8 | Maximum scene size limits         | Soft: 50 layers, 500 frames in any pngSequence, 100MB total assets | Phase 1 sanity check |
| 9 | Undo/redo                         | Out of scope for MVP                          | Future           |
| 10| `reactflow` vs custom for future node view | Defer to when needed; not in MVP    | Future           |
| 11| Spine version mismatch error UX   | Banner: "This file is Spine X.Y; supported version is 4.2. Re-export from Spine Editor." | Phase 2 |
| 12| Per-frame export progress UI      | Inline progress bar in Export panel; cancellable | Phase 5     |

---

## 13. Out of scope (explicit)

The following are deliberately excluded from MVP and any phase listed in
§14. They are listed here so reviewers don't ask "why isn't X here?":

- Custom shaders / GLSL filters written by users.
- Bake tools hosted inside Scene Studio (GlowForge, shadow gen, particle
  gen). These ship as their own top-level Art Tools; Scene Studio imports
  their output as `pngSequence` assets.
- Cross-scene asset library (each scene reloads assets independently).
- Cloud storage / SharePoint integration.
- Real-time multi-user editing.
- Keyframes on non-numeric properties (`visible`, `blend`, `anchor`). Only
  numeric transform channels (`x / y / scaleX / scaleY / rotation`) get
  channels in MVP.
- Custom font rendering. Use a `png` layer with a pre-baked text image, or
  a Spine animation that contains text bones (Unity runtime handles dynamic
  text — out of scope for preview).
- Mobile/touch support on the editor UI.

---

## 14. Phase plan

Each phase ends with a runnable Studio. All phases land in one PR
(`feat/scene-studio`) but as separate commits so review is tractable.

### Phase 1 — Skeleton (estimated 4-5 days)

- `tools/SceneStudio/` module created, registered as new category.
- `PixiViewport` mounts a `PIXI.Application`, renders an empty stage.
- `LayerListPanel` + `InspectorPanel` skeletons.
- Drag-drop a PNG → adds it as a `png` layer at (960,540), visible at 1:1.
- `scene.json` save/load via FS Access API in scaffold mode (`<picked
  folder>/scene.json`).
- Quick mode dropbox: PNGs encoded as base64 in `scene.json`.
- Stage toggle landscape ↔ portrait, with copy-on-write transforms.
- No timeline yet; layers are static.

Exit criteria: can author and save a static scene with PNG sprites at two
orientations.

### Phase 2 — Spine + video (estimated 3-4 days)

- `@esotericsoftware/spine-pixi-v8` added as dep.
- `.json` + `.atlas.txt` + `.png` drop pattern: studio detects three-file
  group and offers "Add as Spine layer".
- Inspector shows animation list; user picks default animation.
- `pixi-filters` added; `BlurFilter` and `ColorMatrixFilter` exposed in
  `EffectsPanel`.
- Video drop adds a `video` layer; inspector shows loop / mute toggles.

Exit criteria: scene with one Spine animation + one video + one PNG +
filters renders at 60fps.

### Phase 3 — Timeline + flow (estimated 5-7 days)

- `TimelinePanel` UI: track per layer, clips with drag/resize, scrubber.
- Markers: `wait`, `waitForClick`, `waitForSignal`, `emit`.
- `flowInterpreter` ticks correctly through clips and pauses on markers.
- Click-to-resume binding on Pixi viewport.
- Signal bus: emit/listen named signals.
- Internal model stays graph-shaped (`flow.nodes/edges`) — derived from
  timeline UI.

Exit criteria: scene with three layers and two `waitForClick` markers
plays back interactively.

### Phase 3.7 — Keyframe channels + curve editor (estimated 3-4 days)

The big animation usability pass. Replaces the 2-endpoint `tween` model
with per-property keyframe channels, adds the auto-key inspector flow,
and ships an editable cubic-bezier curve editor. Full design in §19.

Exit criteria: select a PNG clip, scrub anywhere inside it, drag a
sprite in the viewport (or change a number in the inspector) → see a
keyframe diamond appear on the clip's track at the playhead. Edit the
curve between two keyframes via either preset or bezier handles and
watch the eased motion update live.

### Phase 4 — Exporters + polish (estimated 4-5 days)

- `ExportPanel`: hero PNG (both orientations), PNG sequence, WebM.
- Progress bar + cancel button.
- Linear-mode warning banner for interactive markers.
- `pixi-filters` wiring (Phase 2 carryover): `BlurFilter`,
  `ColorMatrixFilter`, `OutlineFilter` exposed in an `EffectsPanel`,
  attached to the target layer's container in `rebuildScene`.
- `Preview/` subfolder auto-created in scaffold mode.
- README in `react-app/src/tools/SceneStudio/` pointing at this doc.
- Manual QA pass on the Toothless Smile project.

Exit criteria: can produce `Preview/landscape.png`, `Preview/portrait.png`,
`Preview/sequence/*.png`, and `Preview/preview.webm` from one click each.

**Total estimate: 19-25 days of focused work**, plus review/iteration time.

---

## 15. Tech stack

| Dependency              | Version          | Purpose                                | Why                  |
|-------------------------|------------------|----------------------------------------|----------------------|
| `pixi.js`               | ^8.0             | 2D WebGL renderer                      | scene graph, filters |
| `@esotericsoftware/spine-pixi-v8` | matching Spine 4.2 | Spine playback in Pixi v8     | Yggdrasil ships Spine 4.2 |
| `pixi-filters`          | matching v8      | BlurFilter, OutlineFilter, etc.        | cheap effects        |
| `jszip`                 | ^3.10            | quick-mode zip export, sequence zip    | already used by ProjectScaffold |
| `framer-motion`         | (already in repo)| panel animations                       | match toolkit style  |

No new dev dependencies expected. Vite + React + JSDoc stays.

---

## 16. Glossary

- **Layer** — one visual element on the stage. A PNG sprite, a Spine
  animation, a video, or a PNG sequence (any pre-baked numbered-PNG
  folder).
- **Effect** — a Pixi filter attached to a layer (BlurFilter etc). Live, no
  bake.
- **Track** — one row in the timeline corresponding to one layer. A layer
  can host multiple tracks (Spine-style track indices).
- **Clip** — a time range within a track during which a specific animation
  plays on that layer's asset.
- **Channel** — a list of keyframes for one numeric property on a clip
  (e.g. `clip.channels.x`). Each segment between consecutive keyframes
  has its own easing curve.
- **Keyframe** — one entry on a channel: `{ t, v, out }` — time inside
  the clip, value, and the easing curve from this key to the next.
- **Auto-key** — implicit recording mode: if a clip is selected and the
  playhead is inside it, any inspector edit to a numeric property
  inserts or updates a keyframe at the playhead on that property's
  channel.
- **Marker** — a timeline event that affects global playback (pause, signal,
  loop).
- **Hero frame** — the single frame index used for `Preview/landscape.png`
  and `Preview/portrait.png` export.
- **Orientation** — landscape (1920×1080) or portrait (1080×2160). Scenes
  hold per-layer transforms for both, with copy-on-write semantics.
- **Scaffold mode** — scene references assets by relative path inside a
  Unity Art folder; needs FS Access API.
- **Quick mode** — scene embeds assets as base64; works in any browser, no
  folder picker.
- **Linear mode** — export mode that resolves interactive markers
  (`waitForClick`, `waitForSignal`) to fixed waits so the output is
  deterministic.

---

## 17. Review checklist (for reviewer)

Before approving this doc, please confirm or push back on:

1. [ ] Module layout in `react-app/src/tools/SceneStudio/` (§11) is acceptable.
2. [ ] `scene.json` schema (§4) covers your save/load needs — flag anything
   you'd want to add (custom metadata, tags, version notes).
3. [ ] Flow timeline + hold markers (§5) is the right MVP UX for sequencing.
4. [ ] Copy-on-write multi-orientation (§6) is the right model — flag if
   you'd prefer "two separate scenes" instead.
5. [ ] Keyframe channel model (§19) — per-property channels with auto-key
   recording and per-segment cubic-bezier curves. Confirm the AE/Spine-
   style mental model fits your authoring flow.
6. [ ] Phase plan (§14) and the ~19-25 day estimate are acceptable.
7. [ ] Tech stack (§15) is approved (specifically adding
   `@esotericsoftware/spine-pixi-v8` as a hard dep).
8. [ ] Open decisions (§12) — flag anything you want to settle now instead
   of later.

When all items are checked, mark task #2 complete and we move to Phase 1.

---

## 18. Phase audit — what shipped vs what's in this doc

Reconciles §14 (phase plan) and §11 (module layout) against the code on
disk as of 2026-06-01. Use this section to know exactly what's runnable
without re-reading the engine.

### Actual module layout (vs §11)

```
react-app/src/tools/SceneStudio/
├── SceneStudioTool.jsx        ← lazy wrapper (matches §11)
├── SceneStudioInner.jsx       ← all React state + handlers (new — §11 didn't name it)
├── meta.js                    ← matches §11
├── README.md                  ← short pointer (matches §11)
├── engine/
│   ├── sceneModel.js          ← types + validator + channel migration/normalize
│   ├── persist.js             ← FS Access + virtual-handle integration (matches §11)
│   ├── pixiApp.js             ← Pixi v8 bootstrap + rebuild + transform sync + applyPngChannels + motion path
│   ├── flowInterpreter.js     ← playhead/markers + clipAt / lastClipAt
│   ├── orientationManager.js  ← matches §11
│   ├── assetBrowser.js        ← project-folder scan (new — §11 had it under different name)
│   ├── spineLoader.js         ← Spine 4.2 atlas/skel loader + drop grouping (new)
│   ├── viewportController.js  ← pan/zoom/select/drag/resize controller (new)
│   ├── virtualHandle.js       ← Firefox/Safari read-only directory shim (new)
│   └── animation/             ← Phase 3.7 (round 4+) — NOW EXISTS
│       ├── keyframes.js       ← channels: CHANNEL_DEFS, eval, insert/move/split/link, channelKeyDots
│       └── curves.js          ← cubic-bezier solver + preset table
├── components/                ← §11 split this into panels/ + components/; we flattened
│   ├── PixiViewport.jsx       ← canvas host + RAF drive loop + selection / motion-path redraw
│   ├── PixiErrorBoundary.jsx  ← isolates Pixi crashes from the rest of the UI (new)
│   ├── HierarchyPanel.jsx     ← left tree; replaces §11's LayerListPanel
│   ├── LayerListPanel.jsx     ← legacy flat list (unused — kept temporarily)
│   ├── InspectorPanel.jsx     ← layer + clip sections, channel chips, graph/list toggle
│   ├── ClipGraphEditor.jsx    ← whole-clip multi-channel graph, 2D-draggable keys (new)
│   ├── CurveEditor.jsx        ← editable cubic-bezier popover (new)
│   ├── AssetBrowserPanel.jsx  ← project-folder asset tree (new — §11 didn't include)
│   ├── TimelinePanel.jsx      ← tracks, clip blocks, stacked keyframe diamonds, auto-key + add-key UI
│   ├── StudioToolbar.jsx      ← + undo/redo buttons
│   └── DragNumberField.jsx    ← shared numeric drag-input
└── styles/
    └── scene-studio.css       ← all styles, single file (matches §11)
```

Deltas worth flagging:

- `panels/` and `components/` directories from §11 are **merged into one
  `components/`** in code. `animation/` now exists (Phase 3.7). Still
  no `effects/` (Phase 2/4 carryover — pixi-filters). GlowForge bake
  panel was removed from the design entirely — it ships as its own
  top-level Art Tool.
- New first-class modules absent from §11: `assetBrowser.js`,
  `spineLoader.js`, `viewportController.js`, `virtualHandle.js`,
  `animation/keyframes.js`, `animation/curves.js`, `AssetBrowserPanel.jsx`,
  `ClipGraphEditor.jsx`, `CurveEditor.jsx`, `PixiErrorBoundary.jsx`,
  `DragNumberField.jsx`. None invalidate the design — they fill in
  gaps §11 glossed over plus the Phase 3.7 animation system (§20).
- `LayerListPanel.jsx` is the old flat list; `HierarchyPanel.jsx`
  superseded it. Safe to delete in a cleanup pass.

### Phase 1 — Skeleton (DONE, exceeded scope)

- [x] `tools/SceneStudio/` module created, registered under the new
      `studio` category in `src/tools/registry.js`.
- [x] `PixiViewport` mounts a `PIXI.Application` v8 with a permanent
      RAF drive loop, draws a stage-frame outline at the active
      orientation's resolution.
- [x] `HierarchyPanel` + `InspectorPanel` (named differently from
      §11's `LayerListPanel`, but functionally equivalent and richer).
- [x] Drag-drop a PNG → adds it as a `png` layer centred on stage.
- [x] `scene.json` save/load via FS Access API in scaffold mode.
- [x] Quick mode: PNGs encoded as base64 in `scene.json` for download.
- [x] Stage toggle landscape ↔ portrait with copy-on-write transforms.

**Beyond the Phase 1 plan:**

- Pan/zoom viewport with middle-mouse drag, mouse-wheel zoom around
  cursor, fit-to-stage on first mount (`viewportController.js`).
- Click-to-select sprite (oriented-bounds hit test) and drag-to-move
  with snap-to-stage / snap-to-siblings + interaction guides.
- 8-handle resize widget (corners + edge midpoints) with rotation- and
  parent-aware math; snap targets share the drag pipeline.
- Hierarchy panel supports Unity-style drag-drop reparenting
  (above / below / inside zones) and a multi-canvas data model
  (single-canvas UI for now; format already supports more).
- Firefox / Safari fallback: `virtualHandle.js` wraps a flat
  `File[]` (picked via `<input webkitdirectory>` or folder drop) into
  a read-only `FileSystemDirectoryHandle`-shaped object so the rest of
  the engine doesn't care which browser opened the workspace.
- Drag a project folder from Explorer onto the toolbar slot or the
  Assets panel to link the root.
- Imperative `window.__sceneStudio` debug API for inspection / scripting
  (list layers / assets, patch transform, play/pause, etc.).

### Phase 2 — Spine + video (DONE, partial)

- [x] `@esotericsoftware/spine-pixi-v8@^4.3.5` added as a hard dep.
- [x] Three-file drop (`*.json` + `*.atlas.txt` + `*.png`) detected
      via `groupSpineFiles()` and added as a Spine layer. The Unity
      `.atlas.txt` extension is handled natively.
- [x] **Shared atlas+texture fallback** (not called out in §14): if
      a drop contains multiple `*.json` files and exactly one
      `*.atlas[.txt]` + one `*.png`, each `.json` reuses the lone pair.
      This matches the Yggdrasil pipeline (one atlas, many skeletons).
- [x] Inspector shows the Spine animation list + skin picker.
      Auto-picks the first animation whose name contains `idle`
      (case-insensitive) the first time a Spine asset's metadata
      arrives — preserves user choice on re-edit.
- [x] Video drop adds a `video` layer; inspector exposes loop / mute
      toggles. Auto-play is best-effort (some browsers block until
      first user gesture).
- [ ] **`pixi-filters` NOT added.** `BlurFilter` / `ColorMatrixFilter` /
      `OutlineFilter` and the `effects[]` slot in `scene.json` are
      defined in §4 but no `effects/` directory, no `EffectsPanel.jsx`,
      and no filter wiring exists in `pixiApp.js`. Filters were
      planned in Phase 2 but did not ship. Track as carryover.

### Phase 3 — Timeline + flow (DONE, with minor UX gaps)

- [x] `TimelinePanel` renders a track per layer with a scrubber, ruler
      ticks, marker pins, and a play / pause / stop control strip.
- [x] Clips: per-layer add, editable `start` / `duration` / `loop`,
      curve selector (`linear` / `easeIn` / `easeOut` / `easeInOut`),
      Spine `anim` field on spine layers, delete.
- [x] Markers: `wait`, `waitForClick`, `waitForSignal`, `emit` — all
      four types editable from the panel. Marker pins render on the
      ruler at their time.
- [x] `flowInterpreter` ticks correctly: advances `time`, fires `emit`
      passes through, `wait` holds for `duration`, `waitForClick` holds
      until viewport click, `waitForSignal` holds until matching
      `emit` (with replay semantics via `signalsSeen` Set).
- [x] Viewport click-to-resume wired through `PixiViewport.onViewportClick`
      → `flowResumeByClick`.
- [x] Signal bus (`flowResolveSignal`) drains emitted signals each tick
      and resolves pending holds.
- [x] Internal model stays graph-shaped: `deriveFlowGraph` rebuilds
      `flow.nodes` / `flow.edges` from `flow.tracks` + `flow.markers`
      on every patch. The DAG is invisible in the UI but persists in
      `scene.json` for the future node view.
- [x] Spine clips drive `state.setAnimation` + manual `trackTime`
      seeking; video clips drive `currentTime` + play/pause honouring
      `runtime.playing` / `runtime.hold`. Implemented in
      `pixiApp.js#applyFlowAtTime`.
- [x] Scene `duration` editable from the toolbar (clamped to
      [0.5, 300] seconds).

**Gaps vs §5 (timeline UI) and §4 (marker types):**

- Clips are still **number-input rectangles**, not draggable on start
  or resizable on end. Visually they read as boxes but you can't
  push them around with the mouse — §5's "drag start, resize end"
  remains TODO.
- Right-click context menu on the timeline is not implemented. The
  `+ marker` / `+ clip on selected` buttons in the timeline header
  cover the same operations.
- The `loop` marker type listed in §4's marker table is **not
  implemented** anywhere — neither the `flowInterpreter` switch nor
  the panel's `MARKER_TYPES` array includes it. End-of-scene looping
  is not currently possible from the timeline. Decide whether to
  implement it or drop it from §4.

### Phase 3.7 — Keyframe channels + curve editor (DONE, exceeded scope)

Replaced the 2-endpoint tween model with multi-keyframe channels and
then kept going across rounds 4–6. **The full as-built record is §20.**
Headline deliverables:

- [x] `validateScene` migrates old `clip.tween` to `clip.channels`
      (and the legacy per-prop channel shape → vec2/vec3 logical
      channels).
- [x] `applyPngTweens` (`pixiApp.js`) replaced by `applyPngChannels`
      with segment lookup + eased lerp; holds the last keyframe past a
      clip's end instead of snapping to base pose.
- [x] Inspector auto-key flow: clip selected + playhead-in-clip turns
      a numeric edit (inspector field OR viewport drag/resize/rotate)
      into a keyframe write. Plus an **auto-key on/off toggle**.
- [x] Per-channel keyframe list in inspector with `t / v / out`
      columns and an **editable cubic-bezier** curve editor popover
      (`CurveEditor.jsx`).
- [x] Keyframe diamonds on timeline clip blocks; click selects +
      seeks, drag moves in time, Delete removes, Ctrl+C/V/D
      copy/paste/duplicate.
- [x] **Beyond original scope** (§20): vec2/vec3 logical channels
      (position/scale/rotation/alpha/tint), whole-clip graph editor,
      on-scene motion-path overlay, per-channel link/split toggle,
      vertical keyframe stacking, and an add-key dropdown.

### Phase 4 — Exporters + polish (NOT STARTED)

- [ ] No `ExportPanel`, no `exporter.js`.
- [ ] No hero-frame PNG export, no PNG sequence, no WebM.
- [ ] No `Preview/` subfolder auto-creation.
- [ ] No linear-mode-warning banner.
- [ ] `pixi-filters` (Phase 2 carryover) still not wired —
      `effects[]` slot in `scene.json` is reserved but unused. Filter
      support is the first thing to revisit when this phase opens.
- [ ] `pngSequence` asset type defined in `sceneModel.js` typedefs
      but no code creates / renders one yet. Import path (drag a
      numbered-PNG folder) is part of this phase.

### Other notes

- **IndexedDB persistence of the directory handle** (§10): deferred.
  The handle is held in memory for the session only; on reload, the
  user re-picks the folder. Comment in `persist.js` flags this.
- **Effects pipeline (§4 `effects[]`, §11 `effects/`)**: the schema
  reserves the slot but no runtime code consumes it. Filter support
  is the first thing to revisit when Phase 2 carryover comes due.
- **Live-preview toggle** (`StudioToolbar` `● live` / `◯ frozen`):
  freezes / resumes the manual Spine `update(dt)` drive in
  `PixiViewport`. Not in the original spec — added because Spine 4.2
  auto-update via the shared ticker was unreliable in Pixi v8.

### Carryover into the next chunk of work

Phase 3.7 (animation system) is done — see §20. Ranked by what
unblocks downstream work fastest now:

1. **Fix the Pixi v8 viewport crash (§20.10).** Recurring
   `SpritePipe._initGPUSprite` "Cannot read 'orig' of null" when a
   sprite renders before its texture source is uploaded. A
   `PixiErrorBoundary` already isolates it (the rest of the studio
   keeps working + offers Retry), and `Assets.load` reduced its
   frequency, but it still fires on rapid add+rebuild of large PNGs.
   Proper fix: guard the RAF render to skip sprites whose
   `texture.source` isn't `uploaded`, or defer adding the sprite to
   the tree until the source is ready. **Most user-visible bug.**
2. Begin Phase 4 (exporters): `exporter.js` with hero-frame PNG, PNG
   sequence and WebM via `MediaRecorder`; `pngSequence` asset import
   path (drop a numbered-PNG folder onto the Assets panel) so a
   future standalone GlowForge tool's output drops in cleanly.
3. Wire up `pixi-filters` + an `effects/` registry + `EffectsPanel`
   (Phase 2 carryover). Schema is ready; just needs UI + the
   filter-attach step inside `pixiApp.js#rebuildScene`.
4. Decide on the `loop` marker type — implement or remove from §4.
5. Delete the unused `LayerListPanel.jsx`.
6. Smaller animation polish — see the §20.11 backlog.

---

## 19. Timeline animation — keyframe channels + auto-key (Phase 3.7)

The Phase 3.5 redesign (drag-resizable clips, multi-track per layer,
clip-section inspector) is **already implemented** in code. The §18
audit predates it and is stale on that point.

What landed was a 2-endpoint `tween` model: `clip.tween = { from, to,
curves }`. In practice this is too rigid:

- **Adding a keypoint is awkward.** To set `x / y / scale`, you toggle
  property chips, then type `from` and `to` numbers. Visual feedback
  on the timeline is non-existent.
- **No midpoints.** You can't say "go from A to B, then change
  direction at the middle and end at C." Every change of direction
  needs a new clip.
- **The curve editor is read-only.** You pick a preset, see the
  output, but can't edit the actual slope of a specific segment.

This section replaces §19's previous content. It is the source of
truth for the new animation model. §4 (`clips` schema) and §6 (base
pose) remain canonical; §5 (timeline mockup) is kept for historical
context only.

### 19.1 The "base pose" rule (unchanged)

`layer.transforms[orientation]` is the layer's **base pose** — its
identity in the scene, valid at every moment when no clip channel
is overriding it. The inspector's transform fields edit the base
pose **when no clip is selected or the playhead is outside every
clip on that layer**.

When a clip is selected and the playhead is inside it, the same
fields enter **auto-key mode** (§19.4) and write keyframes to that
clip's channels instead of the base pose.

### 19.2 Schema — `channels` per property, with editable curves

The `clip.tween` shape is replaced by `clip.channels`, a map from
animated property name → list of keyframes. Each keyframe carries
its **outgoing** easing curve (the curve from this key to the next).

```json
{
  "id": "C1",
  "start": 0.0,
  "duration": 2.0,
  "loop": false,
  "anim": "big_win_in",                    // spine clips only
  "channels": {                            // png/pngSequence clips only
    "x": {
      "keys": [
        { "t": 0.0, "v":  100, "out": "easeOut" },
        { "t": 1.0, "v":  800, "out": { "bezier": [0.42, 0, 0.58, 1] } },
        { "t": 2.0, "v": 1820 }
      ]
    },
    "y": {
      "keys": [
        { "t": 0.0, "v": 540, "out": "linear" },
        { "t": 2.0, "v": 900 }
      ]
    },
    "rotation": { "keys": [ ... ] }
  }
}
```

Field semantics:

- **`t`** — clip-relative seconds, `0 ≤ t ≤ clip.duration`. Multiple
  keys on the same channel are sorted by `t` on write; ties are not
  allowed (auto-key collapses to "update existing key at t").
- **`v`** — the property value. Numeric only in MVP (`x / y / scaleX
  / scaleY / rotation`).
- **`out`** — the easing curve **from this key to the next**:
  - Preset string: `"linear" | "easeIn" | "easeOut" | "easeInOut" | "step"`.
  - Custom: `{ "bezier": [x1, y1, x2, y2] }` — CSS-style cubic-bezier
    control points. `x1, x2 ∈ [0, 1]`; `y1, y2 ∈ ℝ` (overshoot is allowed).
  - Defaults to `"linear"` when missing. Ignored on the last key.
- **Hold-in / hold-out** — values before the first key clamp to the
  first key's `v`; values after the last key clamp to the last key's
  `v`. No extrapolation. (A user who wants a "constant after end"
  shouldn't have to add an extra key — the clamp handles it.)
- **Missing channels** — properties not present in `channels` are
  not animated; the base pose applies.
- A clip with no `channels` and no `anim` is a presence marker.
  Today: no-op. Reserved for a future "outside clip = invisible"
  toggle.

`clip.curve` from the old schema is **dropped** (now per-segment).
`clip.tween` is **dropped** (migrated in §19.7).

### 19.3 Interpreter — `applyPngChannels`

`tickFlow` is unchanged (still drives the global playhead and resolves
markers). `applyFlowAtTime` in `pixiApp.js` replaces `applyPngTweens`
with a channel walk:

```js
// pseudocode, per PNG layer, per frame
for (const track of tracksForLayer(layer)) {
  const clip = clipAt(track, t)
  if (!clip?.channels) continue
  const local = (t - clip.start) * (clip.speed ?? 1)
  for (const [prop, ch] of Object.entries(clip.channels)) {
    if (!ch.keys?.length) continue
    container[prop] = evalChannel(ch, local)        // base value already in container
  }
}

function evalChannel(channel, localT) {
  const keys = channel.keys                         // sorted by t on write
  if (localT <= keys[0].t)                  return keys[0].v
  if (localT >= keys[keys.length - 1].t)    return keys[keys.length - 1].v
  const i = lowerBound(keys, localT)                // keys[i].t ≤ localT < keys[i+1].t
  const a = keys[i], b = keys[i + 1]
  const p = (localT - a.t) / (b.t - a.t)            // linear 0..1
  const eased = curveEval(a.out, p)                 // preset or cubic-bezier
  return a.v + (b.v - a.v) * eased
}
```

Multi-track per layer: the same property animated on two tracks is
last-write-wins in `flow.tracks` array order — same rule as
`applyPngTweens` today.

For Spine layers: nothing changes. `clip.channels` is allowed on
Spine clips too in the schema (a future "transform override" on top
of the Spine animation) but the interpreter ignores it in MVP.

### 19.4 Auto-key UX — implicit recording

Auto-key avoids the "press R to record" hidden state most users hate.
Recording is implicit and visible:

**Recording is ON** when all of the following are true:
- A clip is selected.
- The playhead is inside that clip (`clip.start ≤ t ≤ clip.start + clip.duration`).
- The clip's layer matches the selected layer **or** the user is
  editing the selected clip's inspector section directly.

**Recording is OFF** otherwise — inspector edits go to the base pose.

When recording is ON and the user changes a numeric property
(inspector field, viewport drag, resize handle, rotation), the
system:

1. Computes `local = t - clip.start`.
2. Looks up `clip.channels[prop]`. Creates the channel if missing.
3. Binary-searches `channel.keys` for an existing key with `|kt - local| ≤ ε`
   (ε = 1/240 s, sub-frame at 60 fps).
4. If a match → update its `v` in place.
5. Otherwise → insert a new key with that `v`. Its `out` defaults to
   `"linear"` and the **previous** key's `out` is preserved (so the
   curve into this new key matches what it was before).
6. Re-sort `channel.keys` by `t`.

UI cues, so this is never hidden state:

- **Inspector field decoration.** A numeric field with a channel
  on the selected clip shows a small filled diamond next to the
  label. A field with no channel but in recording mode shows a
  hollow diamond — "next edit will record".
- **Header strip.** The inspector header for the Clip section shows
  a `● rec` / `○ static` badge. Click toggles a "lock" — when locked,
  edits go to base pose even if the playhead is inside the clip.
  Lock state is session-only, not persisted.
- **Modifier override.** Hold **Alt** during the edit to bypass
  recording for one edit (writes go to base pose). Hold **Shift**
  during the edit to also insert a key at `t = 0` on the same
  channel if one doesn't exist (so "drag at t = 1s without a t = 0
  key" doesn't silently produce a hold-from-start animation).

### 19.5 Curve editor — preset OR editable bezier

Per-segment. Lives on the LEFT keyframe's `out` field. Two surfaces:

**Inline in the Clip inspector.** Each animated channel renders as a
small table:

```
x channel                                                       [ +key ]
┌──────┬──────────┬─────────────────────────────────────────┬───┐
│  t   │   v      │  out                                    │ × │
├──────┼──────────┼─────────────────────────────────────────┼───┤
│ 0.00 │   100.0  │ [easeOut ▾]   ╱  (mini curve preview)   │ × │
│ 1.00 │   800.0  │ [custom ▾]    ⤴  [edit…]                │ × │
│ 2.00 │  1820.0  │ — (last key)                            │ × │
└──────┴──────────┴─────────────────────────────────────────┴───┘
```

- `t / v` are drag-number inputs (same widget as transforms).
- `out` is a preset dropdown + a tiny inline preview thumbnail.
- "Custom" preset reveals an `[edit…]` button.

**Bezier popover.** Clicking `[edit…]` opens a 240×240 popover with a
unit-square plot:

- Y-axis is progress 0 → 1 (eased); X-axis is time 0 → 1.
- Two draggable control handles `P1 = (x1, y1)` and `P2 = (x2, y2)`,
  starting from whichever preset was selected (`easeIn` ≈ `[0.42, 0,
  1, 1]`, `easeInOut` ≈ `[0.42, 0, 0.58, 1]`, etc.).
- Live preview: the curve redraws on drag; the parent inspector and
  Pixi viewport update in real time (the scrubber's current frame
  re-evaluates as the curve changes).
- A row of preset buttons below the plot snaps the handles to canon.
- `x` clamped to `[0, 1]`; `y` allowed to overshoot for back-easing.
- Numeric readout below: `cubic-bezier(0.42, 0.00, 0.58, 1.00)` —
  click to copy, paste into another segment.

Internally, `engine/animation/curves.js` exposes:

```js
export function curveEval(spec, p) {
  if (typeof spec === 'string') return PRESETS[spec]?.(p) ?? p
  if (spec?.bezier) return cubicBezierY(spec.bezier, p)
  return p
}
```

`cubicBezierY` is a 2-step solver (Newton-Raphson on `x(t) = p`, then
evaluate `y(t)`), cached per-segment to avoid re-solving on every
frame.

### 19.6 Timeline visuals — keyframe diamonds

Inside the clip block, each animated channel renders a horizontal
band with diamond markers at its keyframes.

```
┌─ clip block (track 1, L1) ─────────────────────────────────────┐
│  big_win_in                                                    │
│  x      ◇━━━━━━━◇━━━━━━━━━━━◇                                  │
│  y      ◇━━━━━━━━━━━━━━━━━━━◇                                  │
│  scale  ◇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◇                  │
└────────────────────────────────────────────────────────────────┘
```

- One band per channel; bands stack inside the clip's vertical
  space. Clip height grows with channel count up to a cap (4 bands
  visible, scroll inside the clip beyond that).
- Hover diamond → tooltip `x = 800.0 @ 1.00s`.
- Click diamond → selects it; inspector scrolls/highlights the
  channel row.
- Drag diamond horizontally → moves the key in time (snaps to
  neighbours / scrubber / 1-frame ticks; Alt to disable snap).
  Vertical drag is ignored (`v` is edited in the inspector or by
  recording a new key).
- Right-click diamond → "delete key", "set curve to…" submenu (the
  curve being the `out` from this key).
- Right-click clip body (not on a diamond) → "delete clip", "add
  key at playhead for every animated channel" (handy when you've
  moved the sprite by hand and want to lock the current pose as a
  key on every channel).

### 19.7 Migration — from `tween` to `channels`

`validateScene` migrates one-time on load. For every clip with a
`tween` block:

```js
function migrateTweenToChannels(clip) {
  if (!clip.tween) return clip
  const dur = Math.max(0.001, clip.duration)
  const props = new Set([
    ...Object.keys(clip.tween.from || {}),
    ...Object.keys(clip.tween.to   || {})
  ])
  const channels = {}
  for (const p of props) {
    const v0 = clip.tween.from?.[p]
    const v1 = clip.tween.to?.[p]
    if (v0 === undefined && v1 === undefined) continue
    const out = clip.tween.curves?.[p] || clip.curve || 'linear'
    channels[p] = { keys: [
      { t: 0,    v: v0 ?? v1, out },
      { t: dur,  v: v1 ?? v0 }
    ] }
  }
  const next = { ...clip, channels }
  delete next.tween
  delete next.curve   // now per-segment via channel.keys[i].out
  return next
}
```

Old scenes load and play **identically**. New writes never produce
`tween` again.

### 19.8 Inspector — Clip section (refreshed)

Selecting a clip stacks two sections in the inspector:

1. **Layer** (unchanged) — edits base pose. Diamonds next to fields
   show which props have channels on the selected clip.
2. **Clip** —
   - `start`, `duration`, `loop`, `speed`, `mixDuration` (Spine).
   - **Spine clips:** animation picker (combobox, writes `anim`).
   - **PNG / pngSequence clips:** channel list (§19.5). Each channel
     row is collapsible — collapsed shows `x: 3 keys [easeOut, custom]`;
     expanded shows the full `t / v / out / ×` table.
   - **"Animate" chips** — a row of toggles for `x / y / scaleX /
     scaleY / rotation`. Toggle ON when no channel exists → creates
     a channel with a single key at `t = 0` snapshotting the current
     base value. Toggle OFF → deletes the channel after confirmation
     (loses all keys).
   - **"Snap key to current pose"** button on each channel row — sets
     the value of the channel's nearest key at playhead to the
     layer's current base value. Useful when you've authored the
     final pose in the viewport and want to write it into the clip's
     last key without typing.

### 19.9 Implementation plan

Roughly 3-4 days of focused work, split for review:

1. **Schema + interpreter + migration.** Extend `validateScene` to
   accept `channels` and run `migrateTweenToChannels` on load.
   Replace `applyPngTweens` with `applyPngChannels` in `pixiApp.js`.
   Add `engine/animation/keyframes.js` (segment lookup + lerp) and
   `engine/animation/curves.js` (preset table + cubic-bezier solver
   with per-call cache). No UI changes yet; old scenes still play.
2. **Auto-key recording.** Hook the inspector's drag-number widget
   to a `writeKeyframe(layerId, prop, value)` action that decides
   between base-pose update and channel keyframe write based on
   the selection + playhead state. Add the diamond decoration on
   fields. Same hook on viewport drag/resize/rotate handles.
3. **Channel table in the Clip section.** Render the rows, edit
   `t / v / out`, delete keys, add-key button at playhead.
4. **Bezier popover.** `CurveEditor.jsx` with two-handle plot, live
   preview, preset snap buttons, numeric readout.
5. **Timeline keyframe diamonds.** Render bands per channel inside
   clip blocks; click-to-select, drag-in-time, right-click menu.
6. **Polish.** Animate chips, snap-key-to-pose buttons, Alt /
   Shift modifiers, recording lock toggle, key cleanup on channel
   delete.

Each step lands as its own commit on the current branch.

### 19.10 Out of scope for Phase 3.7

- **Weighted / split tangents.** Each segment has one outgoing curve
  on the left key; the right key has no incoming side. AE-style
  in/out handles per key are deferred — standard CSS cubic-bezier
  per segment is enough.
- **Channels on Spine layers driving transforms.** Schema permits
  it, interpreter ignores. Comes later if a real use-case appears.
- **Non-numeric channels** (`visible`, `blend`, `anchor`). Numeric
  only in MVP.
- **Channel-level loops** (a single channel repeating inside a clip
  that isn't itself looping). Use `clip.loop` instead.
- **Drag a marker onto a clip to attach it.** Markers stay global to
  the playhead in MVP.
- **Auto-removal of empty channels.** A channel with one key is
  valid (a hold). The user removes it explicitly via the Animate
  chips or per-channel delete button.

---

## 20. Animation system — as-built (rounds 3.7 → 6)

**This section supersedes §19 wherever they differ.** §19 was the
original proposal; the shipped system grew past it over several
iteration rounds. This is the source of truth for what's actually in
the code. Read it alongside `engine/animation/keyframes.js`,
`engine/animation/curves.js`, `components/ClipGraphEditor.jsx`,
`components/CurveEditor.jsx`, and the channel logic in
`SceneStudioInner.handlePatchTransform`.

### 20.1 Logical channels (NOT per-property)

§19 proposed one channel per sprite prop (`x`, `y`, `scaleX`, …). The
build instead uses **logical channels** so the artist authors x+y in
one move:

| Channel    | Layout   | Value shape          | Applied to Pixi          |
|------------|----------|----------------------|--------------------------|
| `position` | vec2     | `{ x, y }`           | `obj.x`, `obj.y`         |
| `scale`    | vec2     | `{ x, y }`           | `obj.scale.set(x, y)`    |
| `rotation` | scalar   | radians (number)     | `obj.rotation`           |
| `alpha`    | scalar   | 0..1 (number)        | `obj.alpha`              |
| `tint`     | rgb/vec3 | `{ r, g, b }` 0..1   | `obj.tint` (packed u24)  |

`CHANNEL_DEFS` (in `keyframes.js`) holds the layout + an `apply(obj, v)`
per channel. `CHANNEL_NAMES` is the canonical order. `SPRITE_PROP_TO_
CHANNEL` maps a raw transform-field patch (`x`, `y`, `scaleX`, `scaleY`,
`rotation`, `alpha`, `tintR/G/B`) onto its logical channel + component.

`alpha` and `tint` apply to **PNG, pngSequence, Spine, and video**
layers (Spine/video get an `{ alphaAndTintOnly: true }` pass so the
artist can fade / colourise a skeleton without disturbing its own
animation). The other channels are PNG/pngSequence only.

### 20.2 Two storage shapes per channel — linked vs split

A channel is stored one of two ways:

- **Linked** (default): `{ keys: [{ t, v, out }] }`. For vec2/rgb the
  `v` is the whole `{x,y}` / `{r,g,b}`; one key holds all components
  and they share one `out` curve. This is §19's shape.
- **Split**: `{ split: true, perComp: { x: { keys }, y: { keys } } }`
  (rgb uses `r`/`g`/`b`). Each component is an **independent scalar
  curve** — separate key times, values, and `out` curves. Added in
  round 5 because artists wanted x and y to ease differently.

`splitChannel(ch, name)` / `linkChannel(ch, name)` convert between the
two (link takes the union of per-comp key times and re-merges). The
graph editor exposes a per-channel **linked / split toggle**.

`channelKeyDots(channel)` enumerates display dots for either shape —
the timeline + motion path use it so split channels don't vanish.

### 20.3 Keyframe shape + evaluation

A key is `{ t, v, out }`: clip-local seconds, value (number / vec2 /
vec3), and the easing curve from this key to the next (`out`; ignored
on the last key). `evalChannel(channel, t, channelName)`:

- Linked: binary-search the segment, ease `t→p` via `curveEval(out, p)`,
  lerp `a.v → b.v`.
- Split: evaluate each per-comp scalar list and assemble the vec.
- Hold-in / hold-out: clamp to first/last key value; **no
  extrapolation**. The interpreter also evaluates *past* the clip end
  (`clipLocalSeconds(..., { clampPastEnd: true })`) so a sprite holds
  its final keyframe instead of snapping back to base pose.

`lastClipAt(track, t)` (in `flowInterpreter.js`) returns the latest
clip whose `start ≤ t` so the hold-last behaviour works after a clip
ends. (Spine/video still use the strict-range `clipAt`.)

### 20.4 Curves — preset OR editable cubic-bezier

`out` is either a preset string (`linear`, `easeIn`, `easeOut`,
`easeInOut`, `smoothstep`, `backIn`, `backOut`, `overshoot`,
`stepStart`, `stepEnd`) or `{ bezier: [x1, y1, x2, y2] }`.
`engine/animation/curves.js` has the Newton-Raphson cubic-bezier
solver, the preset→bezier table (`PRESET_BEZIER`), `detectPreset`,
`formatBezier`, `toBezier`. `CurveEditor.jsx` is the real editable
SVG surface: two draggable handles, preset snap chips, live
`cubic-bezier(...)` readout. It edits the selected key's `out`.

### 20.5 Auto-key (with on/off toggle)

When **auto-key is ON** (default) AND a clip is selected AND the
playhead is inside that clip AND the clip is on the selected layer,
any numeric transform edit (inspector field OR viewport
drag/resize/rotate) records a keyframe at the playhead instead of
touching the base pose. Implemented in
`SceneStudioInner.handlePatchTransform`, which groups the patch by
logical channel, merges vec2/vec3 components (preserving the
untouched component via `composeVec2Value` / `composeRgbValue`), and
writes one key per channel (split-aware).

A **`⦿ / ○ auto-key` toggle** in the timeline header turns recording
off — then every transform edit writes the base pose, never a key.
(`autoKeyRef` so the patch callback reads fresh state.)

Inspector transform fields show a diamond indicator: `◆` = this
channel is keyed on the selected clip, `◇` = recording-armed (will
create a key on next edit). A `● rec @ <t>s` pill marks the active
recording window.

### 20.6 Add-key dropdown (explicit keying)

A **`+ key…` dropdown** in the timeline header (enabled when a clip is
selected) inserts keys at the playhead regardless of the auto-key
toggle. Options: *key all*, *position (x,y)*, *position x-only*,
*position y-only*, *scale (x,y)*, *scale x/y-only*, *rotation*,
*alpha*, *tint*. A component-only target (e.g. *position x-only*)
forces the channel into **split** mode so the single component gets
its own independent key. Handler: `SceneStudioInner.handleAddKeys`.

### 20.7 Inspector — graph view vs list view

The Clip section's channel editor (`PngChannelEditor` in
`InspectorPanel.jsx`) has a **graph / list** toggle:

- **Graph view** (default once any channel exists): `ClipGraphEditor`
  renders one stacked subplot per channel with a shared time axis and
  per-subplot **absolute** Y auto-fit. vec2/rgb overlay one coloured
  line per component (x=red, y=blue; r/g/b for tint). Keyframes are
  draggable in 2D (changes `t` and `v` at once). Click empty curve →
  insert a key there. A split channel renders N component sub-rows.
  The selected key (matched on `name` + `idx` + `comp`) highlights a
  **single** dot — clicking X no longer selects Y too.
- **List view**: per-channel `t / v / out / ×` tables (good for typing
  exact numbers). vec2 rows show two number fields; rgb rows show an
  `<input type=color>`. Split channels show a "edit in graph view"
  hint (the per-comp tables would crowd the panel).

`selectedKey` shape is `{ clipId, name, idx, comp }` (comp = null for
linked / scalar). It's owned by `SceneStudioInner` and threads to both
the inspector and the timeline.

### 20.8 Timeline keyframe diamonds — stacking

Diamonds render along the bottom of each clip block, colour-coded per
logical channel. Keyframes that **share a frame stack vertically**
(one above another) and the track row **grows taller** to fit the
tallest stack, so overlapping keys from different channels are each
individually clickable. `buildClipDots(clip, pxPerSec)` buckets dots
by pixel-x and assigns a `stack` slot; `trackRowHeight()` sizes the
row. Click a diamond → selects the key + seeks the playhead to it;
horizontal drag → moves its `t`. Keyboard on the selected key:
Delete removes, Ctrl+C / Ctrl+V copy/paste, Ctrl+D duplicates (at the
playhead). All split-aware (carry `comp`).

### 20.9 Motion path overlay on scene

When a clip with an animated `position` channel (≥2 key times,
linked or split) is selected, `drawMotionPath` (in `pixiApp.js`)
traces the sampled position path into the selection-overlay Graphics.
Per-segment **stroke alpha** follows the `alpha` channel, **stroke
colour** follows `tint` (or base tint), **stroke width** hints at the
sampled `scale`. White dots mark each keyframe time (union of
per-component times for split). Renders live as the scene + selection
change.

### 20.10 Known issue — Pixi v8 viewport crash

`SpritePipe._initGPUSprite` throws `Cannot read properties of null
(reading 'orig')` when a sprite is rendered before its texture
source is uploaded — a Pixi v8 race, **not** in the animation logic.
Mitigations in place:

- `loadTextureFromUrl` uses `Assets.load(url)` (resolves only after
  `source.orig` exists), with an `<img>.decode()` + `Texture.from`
  fallback. This cut the frequency a lot.
- `components/PixiErrorBoundary.jsx` wraps `PixiViewport` so a crash
  leaves the timeline / inspector / graph editor fully usable and
  shows a **Retry** button to remount the viewport.

It still fires on rapid add+rebuild of large PNGs. **Proper fix
(carryover #1):** guard the RAF render to skip sprites whose
`texture.source` isn't `uploaded`, or defer adding the sprite to the
scene graph until the source is ready.

### 20.11 Remaining animation backlog (small)

Deferred polish — none block authoring:

- **Right-click context menu** on timeline clips / diamonds (delete,
  set-curve submenu). Today: keyboard + inspector cover these.
- **Snap-to-marker / snap-to-neighbour** while dragging a keyframe
  diamond (clip-block drag already snaps; key drag does not).
- **Alt-bypass on a single auto-key edit** (§19.4 proposed it; the
  on/off toggle replaced the need, but a one-shot modifier is nicer).
- **`loop` marker type** (§4) — still neither implemented nor removed.
- **pixi-filters / `effects[]`** (Phase 2 carryover) — schema ready,
  no UI / wiring yet. Belongs with Phase 4.
- **Weighted / split tangents** per key (AE-style in+out handles).
  Still out of scope; one `out` curve per segment.
- **Channels on Spine layers driving transforms** (beyond alpha/tint).
  Schema permits, interpreter ignores.
