# Spinner — Unity export phase 5 (kickoff / handoff)

> [!done] ✅ SHIPPED 2026-06-14 — all three confirmed decisions (§A, §B, §C) are
> implemented and test-covered (58 SceneStudio tests green, incl. explicit
> `phase 5 §A/§B/§C` cases). See per-section "SHIPPED" notes below.
> **Sole remaining caveat:** none of this has been sanity-checked in a live Unity
> import yet (baked `Anim_*` overlays playing/positioning on land/win; web overlays
> after atlas self-heal). Code + tests are complete; in-engine verification pending.

> Self-contained kickoff for a NEW session. The Spinner → Unity export has been
> built across phases 2–4 (see `next phase spinner unity phase2/3/4.md`,
> `react-app/SPINNER.md`, `react-app/SCENE_STUDIO.md`). This doc captures the full
> state + the THREE confirmed things to build next (decisions already made by the
> user), so you can start implementing without re-deriving context.

---

## 0. What the feature is + where the code lives

A deterministic slot "Spinner" object in Scene Studio (`react-app/`), rendered in
the web preview by Pixi and exported to Unity as a prefab + generated C# +
(optional) Timeline. Everything is JS that GENERATES C# — nothing compiles in the
toolkit. Validate with `npm run build` + `node --test src/tools/SceneStudio/unity/*.test.mjs`
(42 tests today), then a real import into `C:\Users\jakub.pi\game-toothless-smile`.

Key files:
| File | Role |
|---|---|
| `src/tools/SceneStudio/engine/spinner/spinnerModel.js` | config + clip-payload normalize; SPINNER_ACTIONS; symbol land/win anim (`loop`,`offset`); duration helpers |
| `…/engine/spinner/spinnerEval.js` (+ `.test.js`) | pure evaluator: `resolveSpinnerTrack`, `evaluateSpinner`; reel scroll, stop landing, win timing |
| `…/engine/spinner/spinnerRuntime.js` | Pixi renderer: `buildSpinnerObject` (reel cells + overlay pool), `applySpinnerAtTime` |
| `…/engine/pixiApp.js` | `makeSpineOverlayFactory` (createSpineContainer), `sceneStructuralHash` (rebuild trigger — now includes spine atlas/texture) |
| `…/engine/persist.js` | `resolveSpineSiblings`, `repairSceneSpineAssets` (atlas self-heal) |
| `…/unity/exportUnityPackage.js` | asset placement (incl. shared-atlas grouping), descriptor, animBindings, prefab call |
| `…/unity/prefab.js` | prefab YAML: `spinnerBakedDocs` (Board>Statics/Blurs/Fx + baked overlays), `spinnerYaml`, `skeletonGraphicYaml`/`skeletonAnimationYaml` |
| `…/unity/csharp.js` | ALL generated C#: `YggSpinner` (Configure/Evaluate/ResolveTrack/EvaluateInternal/BindBakedHierarchy/BuildOverlays/DriveOverlay), `YggScenePlayer`, timeline builder, `YggSpineAutoWire` (`WireSpinnerOverlays`), spinner Timeline track |
| `…/components/SpinnerInspectorSections.jsx` | `SpinnerClipSection` (per-action clip UI), `BoardGridEditor`, per-reel delay editor |
| `…/components/InspectorPanel.jsx` | spine clip inspector (grouped to mirror Unity) |
| `…/components/SpinnerWizard.jsx` | symbol/anim assignment incl. land/win `offset` |

---

## 1. What's DONE (phases 2–4, all build + 42 tests green)

- **Control track**: `YggSpinnerTrack`/`Clip`/`Mixer` in a gated runtime-timeline
  asmdef; scrubs the reels in edit mode.
- **Spine clip parity round 2** + **mix fix**: `ApplySpineClipTemplate` sets clip
  fields by ENUMERATING the clip's real serialized props (version-robust; spine-
  timeline is a compiled DLL, names not readable) + forces clip ease-in/out so
  mix=0 truly snaps. Inspector regrouped to Unity's layout (Clip Timing / Spine
  Animation State Clip / Mixing Settings).
- **Atlas/texture self-heal**: `repairSceneSpineAssets` recovers the shared
  atlas+png from disk and persists it (the Spinner wizard had dropped them);
  `sceneStructuralHash` now includes spine atlas/texture so the spinner rebuilds
  after repair.
- **Symbol land/win Spine overlays — BAKED**: one `SkeletonGraphic`/
  `SkeletonAnimation` GO per (symbol,kind) baked under `Fx` (`Anim_<sym>_<kind>`,
  inactive), autowired by name (`YggSpineAutoWire`), bound + driven by
  `YggSpinner.BuildOverlays`/`DriveOverlay` (Find, not spawn → edit-mode safe).
  Procedural scale-punch removed (Spine-only).
- **Single shared atlas export**: skeletons sharing an atlas export into ONE
  folder (atlas+png once) → one SpineAtlasAsset/material → one draw call.
- **Hide static/blur behind a playing overlay** (web + Unity).
- **Land/win timing `offset`** per symbol (wizard + model + web + Unity).
- **Spinner clip "set duration" buttons** (spin-up / 2s / until-all-landed).

### Still needs Unity-import VERIFICATION (never confirmed live)
- Baked `Anim_*` overlays autowire their SkeletonDataAsset and actually PLAY on
  land/win (position/scale to the cell may need tuning).
- Web overlays render after the atlas self-heal (reload may be needed).
- Reflective `AnimationState` driving in `DriveOverlay` (edit-mode vs play-mode).

---

## 2. BUILD NEXT — three confirmed decisions

### A. "Present Win" clip (replaces the auto-fired win) — ✅ SHIPPED 2026-06-14
> `presentWin` in `SPINNER_ACTIONS` + normalized params (`spinnerModel.js`); evaluator
> override (`spinnerEval.js:278`); inspector stagger + per-reel delay + set-duration
> helper (`SpinnerInspectorSections.jsx:237`); bake carries params (`bake.js:188`); C#
> mirror in `csharp.js`. Per-reel Fx overlays added (same symbol can win on several reels).

Win currently auto-fires from the evaluator (`winStartAt = allLand + winDelay`),
which plays too early. Replace with an explicit clip the user places AFTER stopSpin.
- **New spinner action `presentWin`** (add to `SPINNER_ACTIONS` in `spinnerModel.js`;
  the "+" add-clip flow offers it after stopSpin).
- **Inspector** (`SpinnerInspectorSections.jsx` `SpinnerClipSection`): a "present
  win" section with a **per-reel win delay** field — `reelWinStagger` seconds:
  `0` = all winning symbols play at once; `>0` = play winning symbols on reel 0,
  wait, then reel 1, etc. (and a "set duration" helper = stagger·(reels-1) +
  winAnimDuration). Consider a per-reel-delay array editor too (like stop delays).
- **Evaluator** (`spinnerEval.js#resolveSpinnerTrack`/`evaluateSpinner`): win
  timing comes from the `presentWin` clip's `start` (+ per-reel stagger), NOT the
  auto `winDelay`. The winning cells still come from the stopSpin `targetBoard`
  (ways-win logic already exists: `EvalWaysWins`). When no `presentWin` clip exists,
  either keep the old auto behavior or no win — pick the cleaner default.
- **Unity** (`csharp.js` `SpinnerClipData` + `ResolveTrack`/`EvaluateInternal`):
  mirror — read `presentWin` clip, set per-cell Win state timing from clip start +
  reel stagger. The Win cell→overlay drive (`DriveOverlay`) already exists.
- **Bake**: `bake.js#spinnerCuesForLayer` must carry the `presentWin` clip + its
  params into `clipsJson`/descriptor.

### B. Single machine mask + 1:1 symbols — ✅ SHIPPED 2026-06-14
> Web: one machine-sized `boardMask` wraps the reels, symbols at native scale 1
> (overflow their cell), Fx outside the mask (`spinnerRuntime.js:79-110,241`). Unity:
> `RectMask2D` (UI) / single `SpriteMask` + `VisibleInsideMask` (world); per-reel masks
> removed, no `FitScale`, `SetNativeSize` on sprite swap (`csharp.js:1561-1885`).

- **Render statics + blurred at native 1:1** (a 220×220 symbol stays 220, NOT
  shrunk to the 200 cell). Remove the fit-shrink: world `fit`/`FitScale`, UI
  `preserveAspect` cell-fit. Cells size to the sprite's native px; on runtime
  sprite swap, resize the cell to the new sprite's native size.
- **Delete the per-reel masks** (RectMask2D / per-reel SpriteMask).
- **Add ONE mask around the whole machine** that clips ONLY statics + blurred —
  i.e. wrap `Statics` + `Blurs` in a single masked container (RectMask2D for UI;
  one machine-sized SpriteMask for world, statics/blur SpriteRenderers =
  VisibleInsideMask). **`Fx` (animations) stays OUTSIDE the mask** so land/win anims
  extend beyond their cell and even beyond the machine frame.
- Touch: `prefab.js#spinnerBakedDocs` (hierarchy + mask + native cell size),
  `csharp.js` `YggSpinner.BindBakedHierarchy`/`BuildRuntime`/`Evaluate` (bind new
  structure, native sizing, no FitScale), `spinnerRuntime.js#buildSpinnerObject`/
  `applySpinnerAtTime` (one board mask on the statics/blur container, native
  `fitSpriteToCell` → native size, Fx unmasked).
- Note: the spin still needs VERTICAL clipping (the board window). The single mask
  is the machine rectangle (full width × visible rows height) — symbols overflow
  horizontally into neighbors/edges (wanted) but the board window still clips the
  scrolling top/bottom.

### C. Runtime result injection API (programmer-facing) — ✅ SHIPPED 2026-06-14
> `SetResultBoard(string[][])`, `Spin()`, `Spin(string[][])` on `YggSpinner`, self-driving
> off the evaluator (`csharp.js:1425-1438`). Win cells derive from the injected board.

Programmers will inject random spin symbols + the actual backend result (not the
baked board). Add a small public API on `YggSpinner`:
- `public void SetResultBoard(string[][] board)` — sets the landing/result board
  used by the next stop (overrides the baked stopSpin `targetBoard`), re-resolves.
- `public void Spin()` / `Spin(string[][] board)` — kick a spin→stop→present-win
  cycle at runtime (driven by the same evaluator, not requiring the Timeline).
- Win cells derive from the injected board (`EvalWaysWins`) so the `presentWin`
  clip plays the right symbols.
- Keep the Timeline driving the VISUAL; the API injects the RESULT. Document the
  intended usage for the game programmers (a few lines in `SPINNER.md`).

---

## 3. Hard-won gotchas (don't relearn)
- spine-timeline is a **compiled DLL** in the user's project (no readable source) —
  set spine clip fields by ENUMERATING serialized props, never hard-coded names.
- Symbol skeletons SHARE one atlas+texture (`08_Symbols/Animations/`,
  `Hp_Lp_SSybbols_Multiplier_Anticipation.atlas.txt/.png`, 16 skeletons). Keep them
  in ONE export folder (single draw call). `spineName` MUST equal the json base
  (spine-unity names the SkeletonDataAsset `<json>_SkeletonData`, autowire matches that).
- Prefab YAML is hand-written; fileIDs from `guid.js#fileIdFor(seed)` — deterministic
  per seed. Keep seeds stable so re-exports don't churn IDs.
- Overlays are BAKED + bound by name (`_fxRoot.Find("Anim_<sym>_<kind>")`), not
  spawned — keep it that way (edit-mode safe, visible in editor).
- Reflective spine calls are try/caught → failures disable overlays, never crash;
  watch the Console `[YggSpinner] …` warnings.
- Limitation today: one overlay per (symbol,kind) — same symbol on multiple reels
  shows one. Phase-5 §A (per-reel win cascade) may want a per-cell pool; decide then.

## 4. Acceptance for phase 5
- A `presentWin` clip after stopSpin controls when wins play; its per-reel delay
  staggers win anims reel-by-reel (0 = simultaneous). Verified in web preview +
  Unity Play.
- Statics/blurred render 1:1 (220 stays 220, overflows the cell); one machine mask
  clips statics/blur to the board window; animations extend beyond freely.
- A programmer can call `YggSpinner.SetResultBoard(...)` + `Spin()` to drive a
  backend-randomized result; the right symbols win.
- Still no procedural scale-pop; mix=0 still snaps; single draw call for shared-atlas
  symbols.

## 5. Suggested order
1. **§B mask + 1:1** first (self-contained rendering; unblocks judging visuals).
2. **§A present-win clip** (model + eval + inspector + Unity + bake).
3. **§C runtime API** (small, builds on the evaluator).
4. Re-verify the still-open phase-4 items (overlays actually play) along the way.
