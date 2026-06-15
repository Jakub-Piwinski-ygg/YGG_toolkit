---
type: session
category: 🎬 Scene Studio
status: complete
updated: 2026-06-15
lang: en
tags: [session, scene-studio, timeline, keyframes, spinner, spine, overlay, ux]
---

# Session 2026-06-15 — Scene Studio: spinner re-edit, frozen-column timeline, keyframe multi-select, overlays

> [!info] Scope
> A long [[Scene Studio]] UX/feature pass driven by live user review. Shipped a
> spinner re-edit wizard, a timeline frozen-column rewrite, a full **keyframe
> multi-selection / move / scale / clipboard** system, several UX fixes, the
> "frame in front" grey-out overlay (device-view modes built then disabled), and
> two Spine pose fixes. Working tree only — not committed. Backlog for the big
> remaining items lives in `react-app/SCENE_STUDIO_TODO.md`.

---

## 1. Spinner re-edit wizard (edit + rebuild an existing spinner)

- The [[Spinner Design|Spinner]] setup wizard (`SpinnerWizard.jsx`) now also runs
  in **edit mode**: pass `existingConfig` + `existingName` and every step
  pre-populates (grid, symbols w/ land/win anims + offsets, timing, blur, initial
  board, seed). Title → "✎ Edit Spinner", submit → "✓ rebuild spinner".
- On rebuild it **preserves config fields the wizard doesn't expose** (bounce,
  events, direction, perReel), bumps `rev`, and only regenerates strips/board when
  the symbol set or reel count changed.
- Entry point: a button **at the very top of the Inspector** (above the name),
  **Setup-mode only** (removed from Animate per request). `SceneStudioInner`
  tracks `editSpinnerTarget`; `handleUpdateSpinner` patches the existing asset's
  `spinner` + renames the layer; `handleEditSpinner` normalizes the asset config
  and opens the wizard.

## 2. Inspector — "set duration = computed" buttons moved to top of clip section

- The spine **"set duration = 1 cycle"** and the spinner action buttons
  (spin-up / until-all-landed / idle / until-all-wins) are now rendered at the
  **top of the yellow clip section, above the name field**, via a shared
  `spinnerClipDurationAction(config, clip)` helper. Removed from their old deep
  locations in `SpinnerInspectorSections`.

## 3. Timeline — frozen-column rewrite (fixes label↔lane vertical desync)

> The old design was two separate columns (labels + lanes) kept in sync by JS
> `scrollTop`/`scrollLeft`, which drifted on vertical scroll.

- Rebuilt as a **single 2-D scroll container** where **each track is one flex
  row**: a **sticky-left label cell + its lane**. Vertical scroll can no longer
  desync them. The **ruler is a sticky-top row**; its "time" corner is sticky on
  both axes; labels stay visible during horizontal scroll.
- Deleted the JS scroll-sync effect + `rulerScrollRef`/`labelsRef`/`rulerRef`.
- Coordinate math (`sceneXFromClient`, `timeFromClientX`, marquee hit-test,
  zoom-centering) now offsets by the frozen label-column width / ruler height.
- Sticky label backgrounds composite their state tint over an **opaque** base so
  clips never show through the frozen column when scrolled.

### Track selection highlight + ghost track (NEW)
- **Two-tier highlight:** a track whose **clip is selected** = accent/yellow;
  a track whose **object (layer) is selected but no clip** = neutral **grey/white**
  (`.layer-selected`). So picking an object on stage/hierarchy instantly reveals
  which track it controls.
- **Ghost track:** selecting an object that has **no track yet** renders a ghost
  row (label + lane) with a **"＋ add track for …"** button.

## 4. ⭐ NEW REQUIREMENT — Keyframe multi-selection, move, scale, clipboard

The headline feature this session. Mirrors desktop animation tools.

**Selection**
- **Marquee box-select** keyframes by dragging on a clip's keyframe band — but
  **only when that clip is already selected** (an unselected clip still drags the
  whole clip; first click selects it, then the band arms for marquee — cursor
  turns to a crosshair).
- **Ctrl/⌘-click** a diamond toggles it in/out of the selection.
- Selection is **constrained to a single clip** (cannot span clips / move keys to
  another clip).

**Move**
- Drag **any selected diamond** OR the **selection-box body** → moves the whole
  selection in time.
- Dragging **past the clip's edges expands the clip** — `duration` extends on the
  right, `start` extends on the left — clamped to the free space beside it
  (neighbouring clips / timeline edges).

**Scale (faster/slower)**
- The dashed **selection box has draggable left/right edges** (ew-resize) that
  **scale the selected keys' timing** about the opposite edge. (Earlier visible
  "dial" widgets were removed — the box edges are the grips; box sits below the
  dots so diamonds stay clickable.)

**Clipboard + delete (also applies to multi-clip selections)**
- **Ctrl+C / Ctrl+V** copy/paste the selected keyframe **sequence**; paste lands
  the **first key at the current playhead** (clip-local) on the selected clip.
- **Delete/Backspace** removes **all** selected keyframes.
- Same **copy / paste / delete** now works for **multiple selected clips**
  (clips paste at the playhead onto their original tracks; first clip at playhead).
- `Ctrl+C/V/D/Delete` route by what's selected: **keyframes win over clips**.

**Engine** — `engine/animation/keyframes.js#transformClipKeys(clip, selected,
mapT, bounds)`: applies a clip-local time map (`+delta` for move,
`pivot+(t-pivot)*factor` for scale) to a **subset** of keys, **index-stable**
(selected keys can't cross their non-selected neighbours, so the live selection
survives the drag) and grows `start`/`duration` into `bounds.leftRoom/rightRoom`
when keys map past the clip. Also added `channelKeyList()`. `SceneStudioInner`
holds `selectedKeys` (+ `selectedKey` primary) and a unified `clipboard`
(`kind:'keys'|'clips'`); handlers `handleTransformKeys`, `handleSelectKeys`,
`handleDeleteSelectedKeys`, `handleCopy/PasteSelectedKeys`,
`handleCopy/PasteSelectedClips`, `handleCopy/Paste/DuplicateSelection`.

> [!warning] Known limitation (deferred — see §8 backlog)
> Index-stable clamping means a selected set currently **cannot be dragged *past*
> a non-selected key** (it stops at the neighbour). User wants pass-through; needs
> stable key identity or post-sort re-derivation. Also the occasional
> "have to re-click to unstick copy/paste/delete" is likely the same
> index-staleness root cause. Folded into the keyframe-track redesign.

## 5. Timeline / editor UX fixes

- **"assets" panel → "workspace".**
- **Zoom slider hidden** (zoom is mouse-wheel; small % readout kept).
- **Middle-mouse drag pans** the timeline (like the scene view); wheel still
  zooms, Alt+wheel still scrolls vertically.
- **Setup mode is the default** view; **timeline panel hidden in Setup** (center
  column collapses via `.scene-center-stack--no-timeline` so the viewport fills
  the freed space).
- **Hierarchy header shows the scene title with a rename ✎** (prompt, like the
  timeline); the **scene-name input was removed from the toolbar**.
- **Clip left-resize keeps keyframes at their global (scene) time** — extending a
  clip's start no longer drags the keys along (`shiftClipChannels`).

## 6. Overlays — "frame in front" default + grey-out

- **"Frame in front" is now the default** overlay; it **greys out everything
  outside the stage** (~50% dark, `drawDimOverlay` 4-band mask in stage space so
  it pans/zooms) so the device-visible/workable area pops. Interior stays clear.
- Dim overlay + device guide are **hidden during WebM export**.
- **Device-view modes (landscape/portrait)** were built — render the guide PNGs
  `public/sceneStudio/DeviceView{Lanscape,Portrait}.png` scaled to cover the stage
  with grey-out around them — then **DISABLED in the dropdown** (alignment off).
  Pixi code (`loadDeviceGuideTexture`, `deviceGuide` sprite) left dormant for a
  later fix; only **frame in front / frame behind** are selectable now.

## 7. Spine pose fixes

- **Empty timeline windows hold the SETUP pose** (Unity "no clip / hold"
  behaviour). The clear-to-empty used a 0.1s mix that **froze mid-blend while
  scrubbing** → broken pose between/before clips. Now uses a **0-second empty
  animation** → snaps deterministically to the exported setup pose.
- **"No pose" selection now sticks.** `handleAssetReady` auto-picked an *idle*
  animation whenever `defaultAnimation` was **falsy**, so choosing
  "— none (setup pose) —" was overwritten on the next rebuild's `onAssetReady`.
  Fixed to guard on **key presence** (`hasOwnProperty('defaultAnimation')`): it
  auto-picks **once** on first sight, then never again — so explicit `null`
  ("no pose" → Spine setup pose) persists. On-creation idle auto-pick unchanged.

## 8. Backlog captured for NEXT SESSION (`react-app/SCENE_STUDIO_TODO.md`)

> [!todo] Big remaining items (new requirements)
> - **Keyframe track redesign** (largest): only the **selected clip expands** to
>   show big per-channel rows; **unselected clips flatten** to one diamond per
>   time; a **Unity-style top summary row** drags ALL the clip's keys; expand the
>   whole track height. Folds in **keyframe move-past-neighbour** + the copy/paste
>   "unstick" glitch (§4 limitation).
> - **Device-view overlay** — re-enable the two modes after fixing the guide→stage
>   mapping (likely map the guide's white safe-rect to the stage, not cover).
> - **Resizable panels** — drag timeline height; expand inspector / hierarchy /
>   workspace widths (capped).
> - **Bigger Setup/Animate buttons with art** (running stick-figure / T-pose).
> - **Zoom 4× deeper** + sub-second (.25/.5/.75) and **per-frame** ticks (by fps).
> - **Dynamic total timeline length** (auto grow/shrink unless set by hand).
> - **Project auto-load** — load the first project file found in the workspace.

## 9. Decisions

- Spinner re-edit lives in **Setup mode only**; rebuild **renames the layer** and
  regenerates strips/board only when symbols/grid changed.
- Keyframe move clamps at non-selected neighbours (index stability) — pass-through
  deferred to the track redesign.
- Empty Spine windows = **instant setup pose** (no fade) — base-pose correctness
  over smoothness, per request.
- Device-view overlay **disabled** until alignment is fixed; grey-out frame kept.

See also: [[Scene Studio]] · [[Scene Studio Phase Status]] · [[Spinner Design]] ·
[[Tool Review]].
