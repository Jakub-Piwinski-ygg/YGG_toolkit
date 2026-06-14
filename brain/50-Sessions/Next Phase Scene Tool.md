---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-14
lang: en
source: next phase scene tool.md
tags: [session, scene-studio, backlog]
---

# Scene Studio — original feature wishlist (translated)

> [!info] Translated from Polish
> English translation of [`next phase scene tool.md`](../../next%20phase%20scene%20tool.md).
> This was the original wishlist; **most items have since shipped** — see
> [[Scene Studio Phase Status]] for the as-built record.

## Things to add

- **Auto-key beyond clip end**: with auto-key on and a clip selected, if you scrub
  past the clip and change the object's scene position → the clip should extend to the
  current frame and a keyframe lands there for whatever changed. ✅
- **Motion-path render improvements**:
  - Path line scales with x/y (or single-axis) scaling. ✅
  - Small direction arrows every N units of time-motion (showing direction + speed);
    arrow spacing should be configurable. ✅
  - Clickable keyframe dots on the on-scene path → seek the timeline there and allow
    direct keyframe edit. ✅
- **Smooth interpolation between in-between keys**: new keys made between two keys
  should be flat/linear as now, OR (if chosen in the tool's main options) use an ease
  in / in-out — computed as a real path/spline (Bézier-like), separately on x and y,
  so the on-scene path becomes rounded. Heavy topic but expected of an animation tool.
  Idea: edit paths traditionally on the curve graph AND on scene as splines. ✅ (tangent
  model + path mode)
- **Timeline clip readability**: show what each keyframe changes near the left edge;
  clip name at the very top above keyframes (static-clip naming was bugged); for
  spin-related clips, the top name should be a dropdown of that clip's animation. ✅
- **Controls**: Space play/stop; arrows = stop + step one frame; Alt+scroll = timeline
  vertical. ✅
- **Drag asset from the assets panel onto the scene** → spawns as the lowest object in
  the canvas hierarchy. ✅
- **Stage-area overlay dropdown** (next to landscape/portrait toggle): default behind
  all objects, alternative above all objects but 100% transparent inside so you see
  where to fit. ✅

## Bugs (all addressed)

- Clicking a variable's key opens its local curve but doesn't seek the timeline →
  hard to set. **High-prio extension**: show a 3-point local curve (prev / selected /
  next) with Unity-style smooth/broken/flat handle modes. ✅
- Splitting position into x/y bugs single-key selection on the timeline. ✅
- Static-PNG clips have weird names; allow naming in the inspector, default
  `<canvas object name> + clip N`. ✅
- Empty space under the timeline; it should run to the very bottom. ✅
- Scrolling the timeline hides its top part. ✅
- **High-prio — page state persistence**: leaving Scene Studio for Art Tools destroyed
  the whole scene; state must persist across tool switches, across page/browser reloads
  (same version), and prompt to save the old version on reload/new-version; plus a "new
  project" button that prompts save/discard. ✅ (keep-mounted + IndexedDB autosave)

Related: [[Scene Studio]] · [[Scene Studio Phase Status]]
