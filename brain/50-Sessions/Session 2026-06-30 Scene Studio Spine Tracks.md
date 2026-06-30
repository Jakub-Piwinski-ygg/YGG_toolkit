---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-30
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spine, timeline, tracks, mixing, unity]
---

# Session 2026-06-30 — Scene Studio Spine Tracks (per-clip + mixing)

> [!success] Shipped (2026-06-30)
> A Spine object can now play several animations at once on separate Spine
> AnimationState tracks, chosen **per clip** (`clip.track`, default 0) and
> decoupled from the timeline row. Higher track draws on top. Build green,
> 63/63 model + unity tests.

## Why

A Spine object can run multiple animations simultaneously on separate
AnimationState tracks (animation layers). The timeline used to map each
timeline **row → Spine track index by its array position**, so mixing was
implicit, priority was inverted vs. intuition (top row = index 0 = *lowest*
priority), there was no per-clip control, and several UI papercuts made
multi-track effectively unusable. The Unity export silently dropped multi-track
entirely (`trackIndex` was never populated → every cue exported as track 0).

## Key idea — `clip.track` decoupled from the row

Add an explicit **`clip.track`** integer (Spine AnimationState index, default 0,
soft-cap 64) set per clip and **independent of which timeline row the clip sits
on**. Rows are organizational; a clip plays on whatever index its number names.
Clips on different indices MIX; a **higher index draws on top** (native Spine
semantics — the number *is* the index, no UI inversion). Confirmed with the user:
per-clip number + higher-on-top + **no migration** (old 2+-row spine scenes
collapse to track 0; the artist re-assigns).

## Session log

### Data + runtime
- **`engine/sceneModel.js`** — `normalizeClip` gains `track` (finite int ≥ 0,
  `Math.min(64, floor)`, default 0).
- **`engine/pixiApp.js`** — `applySpineMultiTrack` rewritten from row-index
  iteration to **gather-then-apply, keyed by spine index** (`spineTrackIndex`
  helper reads `clip.track ?? 0` defensively, since `deriveFlowGraph` does NOT
  run `normalizeClip`):
  - **Phase A** active clip per index (`clipAt` across all rows; later row wins a
    same-index collision).
  - **Phase B** held "last frame" per index (`lastClipAt`, bucketed by the held
    clip's own index; active beats held; later start wins).
  - **Phase C** apply each slot — existing active/held blocks, `idx → si`,
    `resolveMixDuration(obj, layer, track, clip)` gets the paired row.
  - **Phase D** clear: 0s snap for an intended-but-empty index (deterministic
    scrub), 0.1s fade for a slot no clip targets anymore.
  - **Phase E** unchanged single `obj.update(0)` paused-scrub flush.
  All per-clip behaviour preserved (mix, alpha/ease envelope, clipIn, trackTime).

### Unity export
- **`unity/bake.js`** — `spineCuesForLayer` now sets `trackIndex: clip.track`
  (same clamp). `prefab.js` (`trackIndex: ${c.trackIndex ?? 0}`) + `csharp.js`
  already consumed it — this fixes the silent multi-track loss end-to-end.

### Timeline UI — `components/TimelinePanel.jsx`
- `defaultClipForLayer` seeds `track: 0`.
- **Per-clip "T#" badge** on spine clips, rendered to the **left, in front of the
  name** in a `scene-clip-body-line` row (compact number stepper).
- **"New Clip" ghost on EVERY row** of the selected object (was one row only —
  the bug where lower rows couldn't get a clip). Removed the single
  `ghostTargetTrackId` memo.
- **Streamlined ghost track**: a trackless object's ghost row shows the in-lane
  **"＋ New Clip"** at the playhead → one click creates the track *and* a clip
  (`createTrackForLayer`); the label-cell "+" stays as add-empty-track.
- **Row reordering** ▲/▼ in the track label cell (`moveTrack`) — move a row
  above/below any other.

### Inspector — `components/InspectorPanel.jsx`
- **`track` field** directly below the `animation` dropdown.
- **"Match anim time"** (`durationAction`) moved to the **bottom** of the clip
  section — it's now just a manual override since duration auto-fits on
  animation/sequence/action change.

### Styles — `styles/scene-studio.css`
- `.scene-clip-body-line` (flex row), `.scene-clip-track` badge + stepper.

## Resolution / priority rules
- Spine track index = `clip.track` (not the row). Higher index = drawn on top.
- Same-index collision at time `t` → **later row in the array wins** (deterministic;
  rows are reorderable with ▲/▼).
- "Hold last frame" computed per index across all rows; an active clip on an index
  always beats a hold on the same index.

## Implementation map

| Concern | File |
|---|---|
| `clip.track` field (validate, cap 64) | `engine/sceneModel.js` |
| Per-index dispatch (gather-then-apply) | `engine/pixiApp.js` (`applySpineMultiTrack`, `spineTrackIndex`) |
| `trackIndex` on export cues | `unity/bake.js` (`spineCuesForLayer`) |
| T# badge, per-row ghost, ghost-track New Clip, ▲/▼ reorder | `components/TimelinePanel.jsx` |
| `track` field + relocated "match anim time" | `components/InspectorPanel.jsx` |
| Badge/stepper + clip body-line styles | `styles/scene-studio.css` |

## Notes / future
- **No migration** (user's call): old 2+-row spine scenes read every clip as
  `track:0` until re-assigned.
- Row order is now mostly organizational + the same-index tie-break; spine
  playback is driven by `clip.track`.

Related: [[Scene Studio]] · [[Scene Studio Design]] · [[Scene Studio Phase Status]]
