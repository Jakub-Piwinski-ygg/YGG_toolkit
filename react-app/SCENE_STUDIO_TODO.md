# Scene Studio — feedback triage (2026-06-15)

Captured from a review session. Split into **THIS SESSION** (contained, low risk,
done now) and **NEXT SESSION** (bigger redesigns / new subsystems).

## ✅ Works (confirmed by user)
- Enter selected clip → cursor turns to cross → marquee box-select keyframes.
- Multi-select keyframes; copy / paste / delete (occasional "have to re-click to
  unstick" glitch — see NEXT §B).
- Marquee only arms when the clip is already selected (clicking an unselected
  clip still drags the whole clip — good).

## THIS SESSION (done)
1. **Rename "assets" panel → "workspace".** (AssetBrowserPanel header.)
2. **Hide the zoom slider** in the timeline header (zoom is mouse-wheel).
3. **Setup mode is the default** view on load (was 'animate').
4. **Hide the timeline panel in Setup mode** (no timeline interaction there).
5. **Hierarchy header shows the scene title + rename pencil** (like the timeline
   rename); **remove the scene-name input from the toolbar.**
6. **Clip left-resize keeps keyframes at their global (scene) time** — extending
   `start` leftward no longer shifts the keys' absolute timing.
7. **Selection-rect interaction:** removed the broken scale "dials". The dashed
   selection box itself is now interactive — drag the **body to move** all
   selected keys, drag the **left/right edge (ew-resize) to scale** their timing
   (faster/slower). Dragging a selected diamond still moves the whole group.
8. **Middle-mouse drag pans the timeline** (like the scene view). Wheel still
   zooms; Alt+wheel still scrolls vertically.

## Session 2 (done)
- **Fixed:** Setup mode left an empty 220px timeline row — the center column now
  collapses to a single row (`.scene-center-stack--no-timeline`) so the viewport
  fills it.
- **C. Device-view overlay modes** — built (`device · landscape` / `device ·
  portrait`, guide PNGs scaled to cover the stage, greyed out around).
  **TEMPORARILY DISABLED** in the toolbar dropdown — alignment was off; the Pixi
  code stays in place (`loadDeviceGuideTexture`, `deviceGuide` sprite, dim) for a
  later fix. Re-enable the two `<option>`s in StudioToolbar once the guide→stage
  mapping is corrected (likely map the guide's white safe-rect to the stage
  instead of cover-to-stage).
- **D. "Frame in front" overlay** — now the **default**; greys out everything
  **outside the stage** (≈50% dark) so the device-visible area is obvious.
  ‑ Dim overlay + guide are hidden during WebM export.
  ‑ **Note / to confirm:** the device guide is scaled *cover-to-stage* as a v1.
    If the white "safe" rectangle in the guide should instead map 1:1 to the
    stage (guide larger, extending out), that's a quick scale tweak.

## Progress — implementation session (2026-06-15, kickoff phases) — ALL GATES PASSED

- ✅ **Phase 1 (A + B)** — keyframe-track redesign. Stable key ids (`kid`,
  stamped in `deriveFlowGraph`) are now the selection identity; `transformClipKeys`
  sorts freely so a selected set passes through neighbours; delete/copy/paste
  re-derive idx from kid (no more "unstick"). Selected clip expands to big
  per-channel rows + Unity summary row (drags all keys at a time); unselected
  clips flatten to one diamond per time. Drag-stable pointer capture (stable DOM
  order + summary keyed by member set).
- ✅ **Phase 2 (G + H)** — zoom 4× deeper (1440 px/s, multiplicative wheel),
  sub-second + per-frame gridlines, dynamic auto grow/shrink length with a
  manual-pin flag (`stage.manualDuration`) + "auto" toggle.
- ✅ **Phase 3 (E + F + I)** — drag-resizable panels (timeline height / inspector
  / hierarchy-workspace, capped, persisted to localStorage); Spine-style
  Setup/Animate buttons with stick-figure art (T-pose / running); project
  auto-load broadened to `<name>.project.json`.
- ⏸ **Phase 3 (C) — device-view overlay DEFERRED** at user request. Dormant Pixi
  code untouched; guide→stage mapping (cover vs safe-rect) still to confirm.

Session note: `brain/50-Sessions/Session 2026-06-15 Scene Studio Keyframe Track
Redesign Zoom and Panels.md`.

## NEXT SESSION (delegated — bigger / riskier)
> Done items below are kept for reference and struck through; **C (device-view
> overlay)** is the only open item from this list.

### ✅ A. Keyframe track redesign (biggest item) — DONE (2026-06-15)
- Only **one clip "expanded" at a time** (the selected one) shows individual
  per-channel keyframe rows, rendered **bigger** with a larger work area; expand
  the **whole track height** (all clips on the track) while one is expanded.
- **Unselected clips flatten** every channel's keys into a single diamond per
  time (collapsed summary), so they read cleanly.
- When a clip is selected, render a **Unity-style summary keyframe row on top**
  that drags **all** the clip's keys together along the timeline.
- Goal: bigger, clearer hit targets; the tiny "find the cross" area becomes a
  non-issue because the expanded band is large.

### ✅ B. Keyframe move-past-neighbour (folded into A) — DONE (2026-06-15)
- Moving a selected set **past** another (non-selected) key currently **clamps**
  at that key (intentional index-stability guard in `transformClipKeys`). User
  wants it to pass through. Needs stable key identity (keys have no ids) or
  selection re-derivation after the sort. Revisit during the redesign.
- Likely cause of the occasional copy/paste/delete "unstick" glitch: stale
  index-based selection after a sort — same root cause.

### ✅ E. Resizable panels (drag to resize, NOT pop-out / rearrange) — DONE (2026-06-15)
- Drag the **timeline panel up/down** to see more rows.
- Expand the **inspector** leftward (cap rightward growth at current width) for
  bigger curve editors.
- Mirror for **hierarchy / workspace** (expand rightward, capped).

### ✅ F. Bigger Setup / Animate mode buttons with art — DONE (2026-06-15)
- Larger toggle buttons with nice art (e.g. running stick-figure for Animate,
  T-pose for Setup), Spine-style.

### ✅ G. Timeline zoom + tick density — DONE (2026-06-15)
- Allow ~4× more max zoom. At high zoom, show sub-second ticks (.25/.5/.75) and
  eventually **per-frame** gridlines (count = timeline fps).

### ✅ H. Dynamic total timeline length — DONE (2026-06-15)
- Auto-grow when a clip is dragged/extended past the end; auto-shrink to the
  last clip — UNLESS the user set the length manually via the length field.

### ✅ I. Project auto-load — DONE (2026-06-15)
- On loading a workspace folder, scan for and auto-load the **first project file
  found**.

---
*Implementation notes for THIS SESSION live in the code; this file tracks the
NEXT-SESSION backlog. Pull items up as capacity allows.*
