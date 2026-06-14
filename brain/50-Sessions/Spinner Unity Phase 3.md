---
type: session
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-13
lang: en
source: next phase spinner unity phase3.md
tags: [session, spinner, unity, spine]
---

# Spinner → Unity export — Phase 3 (symbol animations + parity round 2)

> [!info] Translated summary
> Outcome log for [`next phase spinner unity phase3.md`](../../next%20phase%20spinner%20unity%20phase3.md).
> All implemented; build + 41 tests green. Generated C# needed Unity-import
> verification (§A3 runtime overlay = biggest risk).

## Shipped ✅
- **§A1** — removed the unwanted procedural scale-punch (web `spinnerRuntime.js` +
  Unity `YggSpinner.Evaluate`). Land/win = Spine animations only.
- **§A2** — `normalizeSymbol` keeps `loop` (overlay-pool key bug) + carries `offset`;
  web overlay honors loop + offset.
- **§A3** — symbol land/win Spine triplets export (`usedAssetIds`); `symbolAnimBindings`
  (spineName/anim/loop/offset + SkeletonDataAsset) serialized in `YggSpinner`;
  `YggSpineAutoWire.WireSpinnerOverlays` assigns SkeletonDataAsset by name; `YggSpinner`
  spawns + drives an overlay pool in `Fx` (reflection, play-mode, try/catch — degrades
  instead of crashing).
- **§B** — per-symbol land/win time offset (wizard + model + web + Unity).
- **§C** — "set duration" buttons for spinner clips (spin-up / 2s idle / until-all-landed)
  — helpers in `spinnerModel.js`.
- **§D** — full Spine Animation State Clip fields (easeIn/out, defaultMixDuration,
  dontPause, dontEnd, clipEndMixOut, *Threshold). **§D1 mix fix**: builder forces
  `defaultMixDuration=false` + `useBlendDuration=false` + explicit `mixDuration` (default 0).
- **§E** — timeline-driven spine layers have no starting animation (prefab + autowire,
  gated on `spineHasCues`); builder adds a leading empty "hold" clip.
- **§F** — default spine mix = 0 (snap) in export + runtime `FireSpineCue`.

## To verify in Unity
§A3 runtime overlay (reflection `New*GameObject` + `AnimationState`), `template.*`
names in the spine-timeline, web overlay render.

## Files changed
`engine/spinner/spinnerRuntime.js`, `engine/spinner/spinnerModel.js`, `unity/csharp.js`,
`unity/exportUnityPackage.js`, `unity/prefab.js`, `unity/bake.js`, `engine/sceneModel.js`,
`components/InspectorPanel.jsx`, `components/SpinnerInspectorSections.jsx`,
`components/SpinnerWizard.jsx`, `unity/spinnerTrack.test.mjs` (41 pass).

Next → [[Spinner Unity Phase 4]]. Related: [[Spinner Design]] · [[Spinner Unity Phase 2]]
