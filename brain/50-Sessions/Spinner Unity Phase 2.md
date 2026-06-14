---
type: session
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-13
lang: en
source: next phase spinner unity phase2.md
tags: [session, spinner, unity, export]
---

# Spinner → Unity export — Phase 2 (shipped, import-verified)

> [!info] Translated summary
> Outcome log for [`next phase spinner unity phase2.md`](../../next%20phase%20spinner%20unity%20phase2.md)
> (handoff prompt remains in the canonical file). Verified by a real Unity import.

## Shipped ✅
- **Spinner control track on Timeline** — new gated runtime assembly
  `Ygg.SceneStudio.Runtime.Timeline` with `YggSpinnerTrack` / `YggSpinnerClip`
  (separate file!) / `YggSpinnerMixerBehaviour`. The mixer calls `SetClips` +
  `Evaluate`, so scrubbing the Timeline moves the reels in edit mode. Builder
  (`TryBuildSpinnerTrack`) creates the track from the descriptor's `spinnerCues`.
- **Spine clip parity round 1** — `holdPrevious` / `useBlendDuration` / `clipIn` /
  `alpha` in the clip schema, inspector, web playback, and export.
- **Auto-build Timeline → opt-in** (`autoBuildTimeline`, default false) + loud warning
  when a spine-timeline is missing.
- **Packing `blob:`** (blur PNG from the wizard) in `bytesForSrc`.

## Import fixes
- `YggSpinnerClip` moved to its own file (`No script asset` → the clip wasn't
  deserializing); `ResolveTrack` / `StripAt` / `EvalWaysWins` guarded against
  out-of-range indices.

## Files changed
`unity/csharp.js`, `unity/exportUnityPackage.js`, `unity/prefab.js`, `unity/bake.js`,
`engine/sceneModel.js`, `engine/pixiApp.js`, `engine/spinner/spinnerRuntime.js`,
`components/InspectorPanel.jsx`, `unity/spinnerTrack.test.mjs` (36 pass).

Next → [[Spinner Unity Phase 3]]. Related: [[Spinner Design]] · [[Scene Studio Phase Status]]
