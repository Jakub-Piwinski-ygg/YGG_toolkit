# Spinner — Unity export phase 2 → implementation plan (handoff)

> Companion to `next phase spinner unity.md` (the original feedback handoff).
> That doc's items #1 (web land/win overlay) and #2 (pre-baked reel hierarchy)
> are DONE (✓ 2026-06-12). This doc plans the REMAINING work: #3 spinner Timeline
> track, #4 spine clip parity, #5 auto-build → opt-in, and the carry-over gaps —
> plus extra issues found by reading the generated C#.
> Design refs: `react-app/SPINNER.md`, `react-app/SCENE_STUDIO.md`, `TOOL_REVIEW.md`.

## ✅ IMPLEMENTED 2026-06-13 — VERIFIED in a real Unity import

All four phases below are coded, pass JS tests + `npm run build`, **and a real
Unity import confirmed the spinner appears and the `YggSpinnerTrack` control
track scrubs**. Import surfaced two bugs (split-file + bounds) — fixed same day
(see end of doc). Remaining feedback from that import is specced in
**`next phase spinner unity phase3.md`** (symbol land/win animations, spine clip
parity round 2, timing helpers, two spine export bugs).

- **Phase A (item #3) — DONE.** New gated RUNTIME assembly
  `Ygg.SceneStudio.Runtime.Timeline` (`runtimeTimelineAsmdefSource`) hosts
  `YggSpinnerTrack` / `YggSpinnerClip` / `YggSpinnerMixerBehaviour`
  (`yggSpinnerTrackSource` in `csharp.js`). The mixer calls
  `spinner.SetClips(...)` + `spinner.Evaluate(GetTime())`, so scrubbing moves
  the reels in edit mode. `YggSpinner` got `SetClips()` and an
  `Application.isPlaying` guard so edit-mode bind never instantiates. Builder
  parses descriptor `spinnerCues` → `TryBuildSpinnerTrack` creates the track and
  sets `player.spinnerHandledByTimeline` (runtime Evaluate loop then steps aside).
  Editor.Timeline asmdef now references Runtime.Timeline.
- **Phase C (item #5) — DONE.** `autoBuildTimeline` (default **false**) serialized
  on `YggScenePlayer` (from `DEFAULT_UNITY_SETTINGS.autoBuildTimeline`); the auto-
  build sweep is gated on it. Missing spine-timeline now `Debug.LogWarning`s loudly
  instead of silently building a spine-less timeline. Manual inspector "Build Unity
  Timeline" button unchanged.
- **Phase B (item #4) — DONE.** Clip schema gained `holdPrevious` / `useBlendDuration`
  / `clipIn` / `alpha` (`sceneModel.js#normalizeClip`); Inspector UI added
  (spine-only); web playback honors them (`pixiApp.js` — entry alpha/holdPrevious,
  track clipIn offset, useBlendDuration→auto mix); export maps to Spine clip
  `template.*` (`csharp.js#TryBuildSpineTracks`) + runtime `FireSpineCue` + serialized
  `SpineCue` + `bake.js#spineCuesForLayer` + `prefab.js#scenePlayerYaml`.
- **Phase D — DONE.** `bytesForSrc` fetches `blob:` URLs (wizard blur PNGs now
  packaged). `spinnerRuntime.js` applies the procedural scale-punch for landing/win
  symbols WITHOUT a Spine anim (parity with `YggSpinner.Evaluate`).

**Tests:** `unity/spinnerTrack.test.mjs` (new, 8 cases) + existing
`prefab.spinner` / `spinnerEval` / `symbolMatch` — 35 pass.

**Still open / caveat:** edit-mode C# parity test vectors (`{t → scroll[]}`) were
NOT built — only JS codegen structural tests. Verify spine-timeline `template.*`
property names (`clipInFromLastClip`, `alpha`, `holdPrevious`, `useBlendDuration`,
`mixDuration`) against the installed spine-timeline version during import testing.

### Import-testing fixes (2026-06-13, round after first Unity import)

First import surfaced two bugs — both fixed:

1. **`No script asset for YggSpinnerClip`** → the clip would not deserialize, the
   control track "did nothing". Cause: `YggSpinnerClip : PlayableAsset` is a
   `ScriptableObject`; Unity only resolves its MonoScript when the class is in a
   **same-named file**. It was sharing `YggSpinnerTrack.cs`. Fixed by splitting it
   into its own `YggSpinnerClip.cs` (`yggSpinnerClipSource`, new
   `SCRIPT_PATHS.spinnerClip`, emitted in `exportUnityPackage.js`). The track file
   keeps only `YggSpinnerTrack` + mixer.
2. **`IndexOutOfRangeException` in `ResolveTrack`** — a cascade of #1 (the empty
   clip produced a malformed/short `targetBoard`), but also a latent fragility.
   Hardened every per-reel indexer in `YggSpinner.ResolveTrack` /
   `StripAt` / `EvalWaysWins` with bounds guards so a malformed clip can never
   crash the PlayableGraph.

**To pick up the fix:** re-export the `.unitypackage` from Scene Studio, re-import,
then press "Build Unity Timeline" again (it clears + recreates tracks).

---

## State verified in code (2026-06-13)

What ships and works:
- `YggSpinner.cs` (`unity/csharp.js#spinnerSource`, ~L1015) — full C# port of the
  evaluator (LUT, continuity, stop landing, bounce, blur crossfade, ways wins),
  with a real `Evaluate(t)` method.
- Prefab baking: `prefab.js#spinnerBakedDocs` bakes the layered reel hierarchy
  (statics / blurs / fx parents, per-reel masks, world-variant SpriteRenderers),
  `YggSpinner` binds it (`BindBakedHierarchy`).
- Runtime playback: `YggScenePlayer.Update()` reads `director.time` and calls
  `spinner.Evaluate(t)` every frame (`csharp.js:312-313`). ▶ Play spins and lands.

What is MISSING (the gap this plan closes):
- **No spinner Timeline track.** Grep confirms no `YggSpinnerTrack` / `YggSpinnerClip`
  / mixer anywhere. The timeline builder (`timelineBuilderSource`, `csharp.js:634`)
  builds only an `AnimationTrack` + Spine tracks (`TryBuildSpineTracks`).
- **No edit-mode scrub.** `Evaluate(t)` only runs inside `Update()` while `playing`,
  so scrubbing the Timeline playhead in edit mode does NOT move the reels.
- No runtime assembly references `Unity.Timeline` — track/clip/mixer have nowhere
  to live yet (only `Editor.Timeline` is gated; track types must be runtime).

---

## Phase A — Spinner control track on Timeline (item #3) — headline feature

Drive the spinner like Spine's `SpineAnimationStateTrack`: a custom track with one
clip per action, editable in the Timeline window, scrub moves the reels in edit mode.

### A1. New gated runtime-timeline assembly
`TrackAsset` / `PlayableAsset` / `PlayableBehaviour` must live in a RUNTIME (not
editor) assembly that references `Unity.Timeline`. None exists — create it.
- Add `SCRIPT_PATHS.runtimeTimelineAsmdef` →
  `Assets/YggSceneStudio/Runtime/Timeline/Ygg.SceneStudio.Runtime.Timeline.asmdef`.
- New `runtimeTimelineAsmdefSource()` in `csharp.js`: references
  `['Ygg.SceneStudio.Runtime', 'Unity.Timeline']`, `defineConstraints:
  ['YGG_HAS_TIMELINE']`, `versionDefines` for `com.unity.timeline`. Like
  `timelineAsmdefSource()` BUT runtime (`includePlatforms: []`, not Editor-only).
- Register via `pushShared` in `exportUnityPackage.js` (~L233).

### A2. Track / clip / mixer C# (new `yggSpinnerTrackSource()`, shipped to A1's asmdef)
- `YggSpinnerClip : PlayableAsset, ITimelineClipAsset` — serialized `action`
  (`startSpin/spin/stopSpin/holdResult`) + per-action params (`targetBoard` via
  `SpinnerRow[]` wrapper, `matchEntrySpeed`, `perReelStartDelay/StopDelay`).
- `YggSpinnerBehaviour : PlayableBehaviour` — carries the action payload.
- `YggSpinnerMixerBehaviour : PlayableBehaviour` — `ProcessFrame` computes effective
  spinner time and calls bound `YggSpinner.Evaluate(localT)`. **This is what makes
  scrub work** — the mixer runs in edit mode, not just play mode.
- `YggSpinnerTrack : TrackAsset` — `[TrackBindingType(typeof(YggSpinner))]`,
  `[TrackClipType(typeof(YggSpinnerClip))]`, creates the mixer.

### A3. Make `YggSpinner.Evaluate` scrub-safe (PREREQUISITE / riskiest)
`Evaluate(t)` must be fully idempotent and side-effect-free outside play mode
(no coroutines, repeated-call-safe cell layout). Add `[ExecuteAlways]` where needed
and verify `BindBakedHierarchy` / pool warm-start can run repeatedly in edit mode.
Validate THIS before building the mixer on top of it.

### A4. Timeline builder emits the spinner track
New `TryBuildSpinnerTrack(...)` called from `Build()` next to `TryBuildSpineTracks`:
for each spinner layer's cue clips, create a `YggSpinnerTrack`, bind the `YggSpinner`
component, add one `YggSpinnerClip` per action (`start`/`duration`/params). Resolve
track/clip types reflectively (`Type.GetType("…, Ygg.SceneStudio.Runtime.Timeline")`)
so the always-compiled path degrades gracefully when Timeline is absent — same
pattern as `csharp.js:597`.

### A5. Disable runtime polling when the track drives it
Mirror `spineCuesHandledByTimeline`: add `spinnerHandledByTimeline` on
`YggScenePlayer`, set it in the builder, skip the
`GetComponentsInChildren<YggSpinner>().Evaluate(t)` loop (`csharp.js:312`) when true.
Avoids double-driving.

### A6. Plumb cues to the builder
`spinnerCuesForLayer` (`bake.js:135`) already emits `clips[]`, but today they go into
the prefab `YggSpinner` component, NOT the `YggScenePlayer` the builder reads. Add a
serialized `spinnerCues` list on the player (or have the builder read the prefab's
`YggSpinner` directly) so `TryBuildSpinnerTrack` has the action timing.

### A tests
- Extend `unity/prefab.spinner.test.mjs`; add `unity/spinnerTrack.test.mjs` asserting
  clip→track structure.
- Build the long-overdue edit-mode parity vectors (`{t → scroll[]}` C# editor test).

---

## Phase B — Spine clip settings parity (item #4)

Make Scene Studio spine clips expose the same knobs as Spine Animation State clips
for a 1:1 export round-trip.

- **B1 schema** — `sceneModel.js#normalizeClip` (~L828): add `holdPrevious` (bool),
  `clipIn` (s ≥0), `alpha` (0–1), `useBlendDuration` (bool). Keep existing
  `loop/speed/mixDuration/curve`.
- **B2 UI** — `InspectorPanel.jsx` spine block (~L538–579): add fields beside the
  existing `mix (s)` / `time curve`.
- **B3 web playback** — `pixiApp.js#applyFlowAtTime`: honor at least `holdPrevious`,
  `clipIn`, `alpha` on scrub.
- **B4 export mapping** — `csharp.js#TryBuildSpineTracks` (~L786–794): map new fields
  onto `template.*` SerializedObject props (`template.holdPrevious`,
  `template.clipIn`, `template.alpha`, `template.useBlendDuration`); carry them in
  `spineCuesForLayer` (`bake.js:185`). NOTE: verify exact `template.*` property names
  against the installed spine-timeline version.

---

## Phase C — Timeline auto-build → opt-in (item #5)

- **C1** — add `autoBuildTimeline` (default **false**) to the export descriptor;
  serialize into the prefab/player.
- **C2** — `YggTimelineAutoBuild` (`csharp.js:847`): remove the `SessionSweep`
  `[InitializeOnLoadMethod]` auto-run; keep the import hook ONLY when opted in.
  Always keep the manual menu item / inspector button.
- **C3** — builder guard: when `player.spineCues` exist but spine-timeline types are
  missing, warn loudly and REFUSE rather than silently building a spine-less timeline
  (today `csharp.js:727` logs and continues).

---

## Phase D — Carry-over gaps

- **D1** — package `blob:` URLs: `bytesForSrc` (`exportUnityPackage.js:51`) add a
  branch that `fetch()`es wizard-generated blur blob URLs and returns bytes.
- **D2** — procedural `pop` web fallback in `spinnerRuntime.js` for symbols without a
  Spine land/win anim (Unity already has a scale-punch; web has nothing).

---

## Suggested order

1. **Phase A** — unblocks the "drive like a Spine track + scrub" UX (biggest value).
   Checkpoint: real Unity import → Ygg Spinner track appears, scrubbing moves reels.
2. **Phase C** — small; removes the surprise auto-build. Do early so the track from A
   is what the user builds manually.
3. **Phase B** — parity knobs.
4. **Phase D** — polish.

## Risks / unknowns

- **Edit-mode scrub** depends on `YggSpinner.Evaluate` being side-effect-free outside
  play mode — riskiest assumption; A3 verifies before A2 builds on it.
- **Runtime gated asmdef** referencing `Unity.Timeline` is a NEW asmdef pattern here.
  A missing by-name asmdef reference is a hard compile error (see gotchas in the
  original handoff) — the reflective degradation in A4 is what keeps the
  always-compiled editor path safe.
- **spine-timeline `template.*` property paths** (B4) referenced from a screenshot,
  not confirmed against the installed version.

## Verification

All work is JS-side codegen + generated C#; it cannot compile in the toolkit. Each
checkpoint needs a real import into `C:\Users\jakub.pi\game-toothless-smile`
(spine-unity 4.2, `.atlas.txt` atlases, `NN_Symbols/StaticArt|Animations|Blurred`).

### Acceptance (this phase)
- Timeline window shows a **Ygg Spinner track** with one clip per action; scrubbing
  moves the reels in edit mode; no timeline is created unless the user asks.
- Spine clip inspector exposes the Spine-Timeline-compatible fields and they survive
  export into Spine Animation State clips.
- Wizard-generated blur PNGs are packaged; symbols without spine land/win anims show
  the procedural pop in the web preview.

## Key files (insertion points)

| File | Role / where |
|---|---|
| `unity/csharp.js` | `SCRIPT_PATHS` (L18), asmdef sources (L132–191), `timelineBuilderSource` (L634), `TryBuildSpineTracks` (L717), `spinnerSource`/`YggSpinner` (L953/L1015), `YggScenePlayer` (L193), `YggTimelineAutoBuild` (L847). ADD `runtimeTimelineAsmdefSource` + `yggSpinnerTrackSource` + `TryBuildSpinnerTrack`. |
| `unity/exportUnityPackage.js` | `pushShared` script emission (L225–233) — register new asmdef + track script; `bytesForSrc` (L51) for D1. |
| `unity/bake.js` | `spinnerCuesForLayer` (L135), `spineCuesForLayer` (L185) — carry new fields. |
| `engine/sceneModel.js` | `normalizeClip` (L811) — B1 schema. |
| `components/InspectorPanel.jsx` | spine clip block (~L538–579) — B2 UI. |
| `engine/pixiApp.js` | `applyFlowAtTime` — B3 web playback. |
| `engine/spinner/spinnerRuntime.js` | D2 procedural pop. |
| `unity/prefab.spinner.test.mjs` + new `spinnerTrack.test.mjs` | tests. |
