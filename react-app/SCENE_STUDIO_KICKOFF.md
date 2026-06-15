# Scene Studio — next implementation session (kickoff prompt)

> Paste the block below as the first message of a fresh session. It picks up the
> backlog from `react-app/SCENE_STUDIO_TODO.md` and the brain note
> `brain/50-Sessions/Session 2026-06-15 Scene Studio Keyframe Multiselect Timeline and Overlays.md`.

---

## KICKOFF PROMPT (copy from here)

We're continuing **Scene Studio** work. Before coding, read:
- `react-app/SCENE_STUDIO_TODO.md` (next-session backlog)
- `brain/50-Sessions/Session 2026-06-15 Scene Studio Keyframe Multiselect Timeline and Overlays.md` (what shipped + known limitations)
- `react-app/src/tools/SceneStudio/components/TimelinePanel.jsx`,
  `engine/animation/keyframes.js`, `components/PixiViewport.jsx`,
  `engine/pixiApp.js` (the files this work touches)

**Working conventions**
- Surgical edits; match surrounding style. `cd react-app && npm run build` after each
  phase — keep it green. Don't commit unless I ask.
- This is interaction/visual work: at every **✋ CHECK-GATE**, STOP, summarize what
  to test, and wait for me to verify in `npm run dev` before starting the next phase.
- If a requirement is ambiguous (e.g. device-guide→stage mapping), ask before building.

Implement in **three phases, in order**. Do not start a phase until I've signed off
the previous gate.

### Phase 1 — Keyframe track redesign (biggest; do first while context is fresh)
Goal: make the per-clip keyframe UI big and legible, Unity-AnimationTrack-style.
- Only the **selected clip "expands"** to show full per-channel keyframe rows, rendered
  **bigger** with a larger hit area; **expand the whole track height** while one clip
  is expanded.
- **Unselected clips flatten** every channel's keys to **one diamond per time**
  (collapsed summary) so they read cleanly.
- When a clip is selected, render a **Unity-style summary keyframe row on top** that
  drags **all** the clip's keys together in time.
- While here, fix the two deferred bugs that share the root cause (index-based key
  identity): **moving a selected set *past* a non-selected key should pass through**
  (not clamp — see `transformClipKeys` clamp in `keyframes.js`), and the occasional
  **copy/paste/delete "have to re-click to unstick"** staleness. Consider stable key
  ids or post-sort selection re-derivation.
- ✋ **CHECK-GATE 1:** verify marquee → move (incl. past neighbours) → scale → copy /
  paste / delete on the expanded clip; confirm unselected clips are flattened and the
  summary row drags all keys.

### Phase 2 — Timeline display (zoom, ticks, dynamic length)
- **Zoom ~4× deeper** than current max. At high zoom show **sub-second ticks**
  (.25 / .5 / .75) and, deeper still, **per-frame gridlines** (count = timeline fps).
- **Dynamic total timeline length**: auto-grow when a clip is dragged/extended past the
  end; auto-shrink to the last clip — UNLESS the user set the length manually via the
  length field (track a "manual length" flag).
- ✋ **CHECK-GATE 2:** verify deep zoom shows sub-second then per-frame ticks; dragging a
  clip out grows the timeline and removing it shrinks back; manual length still wins.

### Phase 3 — Shell, chrome & overlays
- **Resizable panels** (drag to resize, NOT pop-out/rearrange): timeline height; expand
  the **inspector** leftward (cap rightward at current width); mirror for **hierarchy /
  workspace** (expand rightward, capped).
- **Bigger Setup / Animate buttons with art** (e.g. running stick-figure = Animate,
  T-pose = Setup), Spine-style.
- **Re-enable device-view overlay modes** — the Pixi code is dormant
  (`loadDeviceGuideTexture`, `deviceGuide` sprite in `pixiApp.js`/`PixiViewport.jsx`);
  re-add the two `<option>`s in `StudioToolbar.jsx` **after** fixing the guide→stage
  mapping (likely map the guide's white safe-rect to the stage, not cover-to-stage —
  ask me to confirm the intended mapping first).
- **Project auto-load**: on linking a workspace folder, scan for and load the **first
  project file found**.
- ✋ **CHECK-GATE 3:** verify panel resizing within caps; new mode buttons; device
  overlays aligned; auto-load picks up a project from a freshly-linked workspace.

Update `react-app/SCENE_STUDIO_TODO.md` and the brain session note as items land, and
write a session-review note at the end (English, `brain/50-Sessions/`).

## (end of kickoff prompt)
