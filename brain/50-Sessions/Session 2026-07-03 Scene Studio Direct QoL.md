---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-03
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, direct, scenario, spinner, transport, hierarchy, wizard]
---

# Session 2026-07-03 — Scene Studio Direct QoL batch (pose carry, spin outcomes, transport)

> [!success] Shipped (2026-07-03)
> The user's 10-point punch-list plus a reported hold/crossfade bug, in 8 work
> packages. Build green; engine tests 28+19+8+3+39 all passing (19 new).

## The bug that anchored the session — hold/crossfade pose carry

`mode:'hold'` on a Direct edge was consumed **nowhere** — `buildScenarioTimeline`
only branched on `'crossfade'`, so hold behaved exactly like a cut. On every
segment hand-off `directPreview` rebuilt the scene from the incoming timeline
alone, and any layer it didn't key snapped back to its **setup pose** (the
`syncTransforms` base). Crossfade blended toward that base too.

Fix mirrors the spinner board carry (commit `a1dae28`):

- **`layerPoseCarryByNode(flat, project)`** (`engine/scenarioTimeline.js`) —
  folds the walk; each segment's timeline overwrites the running pose of every
  layer it keys, evaluated at the segment's END (channel values clamp-hold
  there, resolved **over the carried entering base** so partially-keyed layers
  chain). Segments entered via `hold`/`crossfade` get the entering pose map
  recorded per node; `cut` drops the carry for its scene (that's what cut means).
- Consumers: `directPreview` single branch bakes carried poses as the layers'
  base transforms (`bakeCarriedPoses`, `scenarioBlend.js`) — incoming keys still
  win; the blend branch passes `carryPoses` into `buildBlendedScene` so both
  sides resolve over the carried pose (`baseOverride` in
  `resolveLayerTransform`) — no post-overlap snap. The scenario video-export
  frame provider does the same.
- Documented limitation: crossfade blends container transform channels only;
  spine/spinner/winseq *animation state* stays frozen during the overlap window.

## Spin outcome overrides (Director)

Per-node `entry.spinOutcome` — `default / noWin / smallWin / bigWin / wildWin` —
with a "Spin outcome" select in the node inspector (shown only when the bound
timeline has a `stopSpin` clip on a spinner layer; `spinnerStopInfo`).

- **Name-based classification** (`classifySymbols`, `spinnerModel.js`): wild =
  name contains "wild"; low = `l/lo/low` token (L1, lo_2, low ace); high =
  `h/hi/high`; order-based fallback. No config changes, no wizard UI.
- **Wild-aware `evalWaysWins(board, wildId)`** — wilds substitute in runs,
  wild-led lines count via reel-1 candidates, substituting wild cells join the
  win and play the **wild's own** win anim (winCells read the board symbol).
  `wildId=null` ⇒ byte-identical to before.
- **Seeded generators** (`generateOutcomeBoard`): smallWin = exactly one 3–5
  reel win (70 % low pool); bigWin = 2–3 long high-symbol wins with 2-high
  stacks; wildWin = 3–5 wilds completing several combos (assert ≥1 win through
  a wild; fallback bigWin). All deterministic per (config.seed, clipId, outcome).
- Threading: `targetBoardForClip(config, clip, outcome)` overrides authored
  boards → `resolveSpinnerTrack`/`spinnerResolveKey` (outcome + derived wildId
  in the cache key) → `applySpinnerAtTime` ← `scene.__spinnerOutcome`
  (`pixiApp.js`). The override also rides `spinnerCarryByNode`, so **downstream
  nodes hold the forced board**. `wildWin` disabled until a symbol is named
  "wild". Unity parity (`YggSpinner.cs`) flagged for the export milestone.

## Transport & keyboard unification

- Global **Space** is now context-aware: wizard preview (via
  `wizardPreviewControlsRef`, registered by `WinSeqPreview`) → Direct scenario
  playhead → animate flow; setup mode is a deliberate no-op (it used to toggle
  the hidden animate flow). Arrow-key frame-step gated to animate.
- **⏮ jump-to-start** (keeps play state) on all three transports: animate
  `TimelinePanel`, win-seq preview, Direct graph header (`seekStart` action).
- Win-seq preview bar: **drag-to-scrub** with pointer capture (was click-only).

## Direct graph & viewport QoL

- **Chained ＋ spawn** — `addTimelineNodeChained`: first node right of Start,
  then right of the last spawned (fallback rightmost), row-aligned; node
  geometry consts exported from `scenarioModel.js` so model + panel share them.
  The view **pans to the new node** with a 280 ms ease-out rAF tween (drop too);
  wheel/pointer input cancels it. New node is auto-selected.
- **Scrubber highlight** — `is-current` (+ pulsing `is-running`) on the segment
  under the playhead.
- **Fullscreen fit** — `fitToStage()` on the PixiViewport imperative ref, called
  on `fullscreenchange` (double rAF) for enter AND exit; the ResizeObserver
  deliberately does not refit so panel drags never stomp the artist's pan/zoom.

## Hierarchy icons

`layerTypeIcon(asset)` in `sceneModel.js`: 🎬 scene-setup root · 📁 empty group ·
🎰 spinner · 🏆 winseq · 🔢 winnumber · 🦴 spine · 🖼 png (◻ for the generated
data-URL placeholder) · 🎞 video · 📽 pngSequence. Rendered between the
visibility checkbox and the name.

## Scene Setup: alpha-gated modes + idle timelines

Feature mode groups (Free Spins / Bonus / Pick&Click) are now created
`visible:true` + **alpha 0** — `visible` stays a pure editing toggle, mode
gating moved to the animatable alpha channel so Direct edges can crossfade
between game modes. The wizard also generates one **"\<Mode\> Idle"** timeline
per mode (2 s, one alpha key per feature group: own = 1, others = 0;
`engine/sceneSetupTimelines.js`, tagged `generatedBy: rootLayerId`, regenerated
on wizard re-entry). No migration — old `visible:false` scenes behave as before;
re-running the wizard upgrades them.

## Files

| Layer | File |
|---|---|
| Pose carry fold | `engine/scenarioTimeline.js` (`layerPoseCarryByNode`) |
| `baseOverride` / `carryPoses` / `bakeCarriedPoses` | `engine/scenarioBlend.js` |
| Carry + outcome consumers, Space dispatch, export | `SceneStudioInner.jsx` |
| Classifier, generators, wild-aware eval | `engine/spinner/spinnerModel.js` |
| Outcome in resolve/key/winCells | `engine/spinner/spinnerEval.js`, `spinnerRuntime.js`, `engine/pixiApp.js` |
| `entry.spinOutcome`, `spinnerStopInfo`, chained add, geometry | `engine/scenarioModel.js` |
| Outcome select + transition mode notes | `components/ScenarioInspectorSections.jsx` |
| Focus tween, ⏮, scrubber highlight | `components/ScenarioGraphPanel.jsx` |
| ⏮ animate | `components/TimelinePanel.jsx` |
| Drag-scrub, ⏮, `controlsRef` | `components/WinSequenceWizard.jsx` |
| `fitToStage()` | `components/PixiViewport.jsx` |
| `layerTypeIcon` + hierarchy row | `engine/sceneModel.js`, `components/HierarchyPanel.jsx` |
| Idle timelines | `engine/sceneSetupTimelines.js` (+ `.test.mjs`) |
| Styles | `styles/scene-studio.css` |

Related: [[Scene Studio]], [[Scene Studio Direct]], [[Spinner]], [[Win Sequences]],
[[Session 2026-06-30 Scene Studio Spine Tracks]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
