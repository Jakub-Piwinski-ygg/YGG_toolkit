---
type: session
category: 🎬 Scene Studio
status: complete
updated: 2026-06-15
lang: en
tags: [session, scene-studio, timeline, keyframes, zoom, gridlines, panels, ux]
---

# Session 2026-06-15 — Scene Studio: keyframe track redesign, deep zoom, resizable panels

> [!info] Scope
> Three gated phases off the `SCENE_STUDIO_KICKOFF.md` prompt, each verified live
> by the user before the next started. **Phase 1** — Unity-AnimationTrack keyframe
> redesign + a stable key-id refactor that fixed two long-standing drag bugs.
> **Phase 2** — 4× deeper zoom with sub-second/per-frame gridlines + a dynamic
> auto-grow/shrink timeline length. **Phase 3** — drag-resizable panels, art-icon
> Setup/Animate buttons, broadened project auto-load. Device-view overlay was
> explicitly deferred by the user. Working tree only — not committed.

---

## 1. ⭐ Stable keyframe ids (`kid`) — root-cause fix for two drag bugs

The whole keyframe selection used **array indices** (`{clipId,name,comp,idx}`).
Any time-sort (move/delete/paste) shifted indices, so the live selection went
stale ("re-click to unstick") and `transformClipKeys` had to **index-clamp** to
keep the selection alive — which blocked dragging a set *past* a neighbour.

- Every keyframe now carries a stable **`kid`**, stamped idempotently in
  `deriveFlowGraph` (the choke point every flow mutation + load passes through)
  with structural sharing, and assigned to new keys in `insertOrUpdateKey`.
  Distinct prefixes — `k…` (legacy stamp) vs `kf…` (new keys) — guarantee no
  collision inside a key list. Ids round-trip stably through save/load.
- **`kid` is the canonical selection identity**; a cached `idx` rides along and a
  post-mutation effect **re-derives it from the kid** (the post-sort
  re-derivation). `handleSelectKey*` stamp the kid even when a caller (graph
  editor) passes idx only, so the graph editor / inspector keep working on idx.
- `transformClipKeys` rewritten to **map times then re-sort freely** (no clamp):
  a selected set passes right through non-selected neighbours. Delete / copy /
  move-by-frame all resolve by kid.

## 2. Keyframe track redesign (Unity AnimationTrack style)

- **Selected clip expands**: full per-channel rows rendered big (16px pitch,
  15px diamonds, large hit areas); the track grows to fit (`expandedTrackHeight`,
  selection-aware `trackHeights`).
- **Unselected clips flatten** to one decorative diamond per distinct time
  (`clipSummaryColumns`) so they read cleanly.
- **Unity summary row on top** ("all"): one diamond per time; dragging a column
  moves **every key at that time together**.
- **Pointer-capture stability:** the two failing drags (key past a neighbour;
  summary diamond) were losing capture because their DOM nodes reorder/remount
  mid-drag. Fixed by **stable DOM identity** — diamonds render in kid order (not
  time order; they're positioned by CSS `left`) and the summary diamond is keyed
  by its member-kid set — so nodes never reshuffle and capture survives.

## 3. Timeline display — deep zoom + gridlines (G)

- **Max zoom 360 → 1440 px/s** (~4× deeper); wheel zoom is now **multiplicative**
  for an even feel across the range.
- `niceTimeStep` picks a zoom/fps-aware ruler step, so labels densify
  `1s → 0.5s → 0.25s …`. `buildGridlines` emits three tiers — whole-second,
  sub-second (.25/.5/.75), and **per-frame** lines (count = fps) that appear only
  once frames are ≥7px wide. Rendered as a faint lane overlay + ruler ticks.

## 4. Dynamic timeline length (H)

- New `stage.manualDuration` flag. Typing in the **length field pins it (manual)**;
  otherwise an effect **auto-fits the length to the content** — grows when a clip
  is dragged past the end, shrinks back to the last clip. A small **"auto" toggle**
  hands the length back to auto-fit. Clips can be dragged up to the 300s cap
  (`dragMax`) so a drag can push the content end out.
- ⚠️ Behaviour change: existing scenes load in **auto** mode, so a saved length
  snaps to its content on open until re-pinned. Flagged to the user; left as-is.

## 5. Resizable panels, mode-button art, project auto-load (Phase 3)

- **Resizable panels** (drag, persisted to localStorage): timeline height
  (center-stack row, capped so the viewport keeps ≥160px), inspector width (grow
  leftward, min = default 300), hierarchy/workspace width (grow rightward, min =
  default 260). Window-listener drags (no pointer capture) via `beginPanelResize`;
  thin `.scene-resize-handle` strips straddle each boundary.
- **Setup/Animate buttons** are now Spine-style: bigger, with inline stick-figure
  SVGs (**T-pose = Setup**, **running = Animate**) + label, active highlight.
- **Project auto-load** already covered `project.json`/`scene.json` on
  link/drop/fallback; broadened the scan to also pick up download-style
  **`<name>.project.json`** (canonical `project.json` still preferred).

## 6. Deferred

- **Device-view overlay re-enable** (C) — explicitly skipped this session at the
  user's request. The dormant Pixi code (`loadDeviceGuideTexture`, `deviceGuide`
  sprite, cover-to-stage scaling) is untouched; the guide→stage mapping decision
  (cover vs map the white safe-rect to the stage) is still open.

## 7. Decisions

- Key identity is by **stable kid**, not index — the robust fix the prior session
  flagged. Both deferred bugs (pass-through, copy/paste "unstick") resolved by it.
- Timeline length defaults to **auto-fit**; manual pin wins until "auto" is clicked.
- Device overlay stays disabled until a later session.

See also: [[Scene Studio]] · [[Scene Studio Phase Status]] ·
[[Session 2026-06-15 Scene Studio Keyframe Multiselect Timeline and Overlays]] ·
[[Tool Review]].
