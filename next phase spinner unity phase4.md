# Spinner — Unity export phase 4 (kickoff / handoff)

> Paste this to start the next session. Focus: get the per-symbol **land/win
> Spine animations actually playing** — in the Scene Studio web preview AND in
> the Unity export — plus finish the leftover items. Companion docs:
> `next phase spinner unity phase3.md` (what shipped + fixes),
> `react-app/SPINNER.md`, `react-app/SCENE_STUDIO.md`, `TOOL_REVIEW.md`.

## Where things stand (end of phase 3, 2026-06-13)

Shipped & verified in Unity import:
- Spinner control track (`YggSpinnerTrack`) scrubs the reels.
- Spine clip parity round 2 (full Spine Animation State Clip fields).
- **Spine mix bug FIXED** — `ApplySpineClipTemplate()` sets clip fields by
  enumerating the clip's real serialized properties (version-robust, no hard-coded
  names) + forces clip ease-in/out to the requested value so mix=0 truly snaps.
- **Atlas/texture self-heal** — `repairSceneSpineAssets()` recovers shared
  atlas+texture from disk and persists it; export skips genuinely-incomplete spines.
- Procedural scale-punch REMOVED (web + Unity). Land/win is Spine-only now.
- Inspector regrouped to mirror the Unity Spine clip (Clip Timing / Spine Animation
  State Clip / Mixing Settings).
- §B land/win timing **offset**, §C spinner clip "set duration" buttons.

### UPDATE 2026-06-13 — Unity overlays are now BAKED (not runtime-spawned)
Reworked §A3 to bake the symbol Spine overlays into the prefab (the user
correctly noted there were no prebaked objects, only an empty `Fx`):
- `prefab.js#spinnerBakedDocs` now bakes one Spine GO per (symbol, kind) under
  `Fx`, named `Anim_<symbolId>_<kind>`, **inactive**, with a `SkeletonGraphic`
  (UI) / `SkeletonAnimation` (world) component — visible in the editor like the
  reel cells. (Needs `spineScriptGuid`, now passed through `buildPrefab`.)
- `exportUnityPackage.js` registers each overlay as a descriptor node
  (`…/Board/Fx/Anim_<sym>_<kind>`, `spineHasCues`), so the normal
  `YggSpineAutoWire` node pass assigns its `SkeletonDataAsset` by `spineName`.
- `YggSpinner.BuildOverlays()` now **binds** the baked GOs by name (Find +
  GetComponent — no instantiation, edit-mode safe) and `DriveOverlay()` positions
  + drives them; `AnimationState` resolved lazily. Runtime reflective spawn
  (`CreateOverlay`) REMOVED. Tests: `prefab.spinner.test.mjs` (baked overlay
  cases). 42 tests pass + build clean.
- **Limitation (v1):** one overlay per (symbol, kind) — if the same symbol lands
  on multiple reels at once, only one shows. Expand to a per-cell pool if needed.

Still **NOT yet verified working** (this phase's remaining job):
- **§A3 Unity** — confirm in a real import: the `Anim_*` GOs appear under
  `…/Board/Fx`, autowire assigns their SkeletonDataAsset, and on Play (or scrub)
  the right anim plays on the landed/winning cell. Likely tweaks: overlay
  position/scale to the cell, and SkeletonGraphic edit-mode `AnimationState` init.
- **§A2 web overlays** — FIXED the rebuild gap: `sceneStructuralHash` now includes
  spine `atlas`/`texture`, so when the self-heal recovers them the spinner rebuilds
  and its overlay pool re-loads with a valid skeleton. **Verify** the overlays now
  actually render on scrub into the land/win window (and tune fit-to-cell scale /
  position if they appear off).

## Primary goal: land/win symbol animations play (web + Unity)

### §1 — Web preview (Scene Studio) — verify & fix first (fast iteration)
1. With the project folder connected and a spinner that has land/win Spine anims
   assigned, scrub the spinner's stopSpin window and confirm the assigned Spine
   overlay plays on the landed cell(s).
2. If nothing renders, walk: does `config.symbols[*].landAnim/winAnim` carry
   `{kind:'spine', assetId, anim, loop, offset}`? Does `makeSpineOverlayFactory`'s
   `createSpineContainer(assetId, anim, loop)` return a non-null pool (skeletonData
   loaded via repaired atlas/texture)? Is `applySpinnerAtTime` reaching the
   `data.state==='landing'/'win'` branch with the matching `spKey`?
3. Likely fixes: overlay scale-to-cell (skeletons render at native size — may need
   fitting), overlay z-order under `Fx`, and the `localT = stateT - offset` gating.
4. Files: `engine/spinner/spinnerRuntime.js` (pool + `useSpineOverlay`/`DriveOverlay`
   region), `engine/pixiApp.js#makeSpineOverlayFactory`, `engine/spineLoader.js`.

### §2 — Unity (the hard part) — verify & fix the reflective overlay path
The reflective instantiation in `csharp.js#spinnerSource` (`CreateOverlay`,
`BuildOverlays`, `DriveOverlay`) is the highest risk. On a real import:
1. Confirm symbol spine triplets imported and `YggSpineAutoWire.WireSpinnerOverlays`
   assigned each `symbolAnimBindings[*].skeletonDataAsset` (check the prefab's
   YggSpinner in the inspector). If unresolved, the by-name match
   (`ResolveDataAssetPath`) may need adjusting to the shared-atlas naming.
2. Enter Play mode, trigger a spin→stop, and watch for overlay GameObjects appearing
   under `…/Board/Fx/Anim_<symbol>_<kind>`. Likely failure points:
   - `NewSkeletonGraphicGameObject(dataAsset, parent, material)` — the `material`
     arg (passed `null`) may be required → pass SkeletonGraphic's default material,
     or use `SkeletonGraphic.NewSkeletonGraphicGameObject` overload that supplies it.
   - SkeletonGraphic needs a CanvasRenderer/Canvas ancestor (UI variant) — the `Fx`
     layer is under the UI canvas, should be ok; verify.
   - `AnimationState.SetAnimation`/`GetCurrent`/`TrackTime` reflection signatures.
   - World variant: `SkeletonAnimation.NewSkeletonAnimationGameObject(dataAsset)`.
3. Decide on **edit-mode scrub** for overlays (currently play-mode only via the
   `Application.isPlaying` guard). If the user wants scrubbing to show land/win
   anims in the Timeline window, the overlays must spawn/drive in edit mode too
   (guard against dirtying the scene — bind, don't instantiate into the saved asset).
4. **Pooling**: today one overlay per `symbolId:kind`; if the same symbol lands on
   multiple reels simultaneously only one shows. Expand to a small pool if needed.
5. Consider driving overlays from the **spinner Timeline track** (the user's note:
   "the spinner track would control the exact animation state … they should be
   dynamic") rather than only from `YggSpinner.Evaluate`, so the control track owns
   land/win timing too.
6. Files: `unity/csharp.js` (`spinnerSource` overlay methods, `spineAutoWireSource`
   `WireSpinnerOverlays`), `unity/exportUnityPackage.js` (symbol triplet export +
   `animBindings`), `unity/prefab.js#spinnerYaml` (`symbolAnimBindings`).

## Round-2 feedback (2026-06-14)

DONE this round:
- **Single shared atlas (was: a folder+atlas+png+material per symbol → a draw call
  each).** `exportUnityPackage.js` now groups skeletons by their atlas source into
  ONE folder named after the atlas; the `.atlas.txt` + `.png` export once (deduped)
  and all `.json` skeletons sit beside them → spine-unity builds one shared
  SpineAtlasAsset/material → a single draw call. Mirrors the original Spine project
  layout.
- **Static/blur hidden behind a playing anim** (web + Unity): when a cell's land/win
  overlay is showing, its static + blur sprites go alpha 0 (`DriveOverlay` /
  `useSpineOverlay` now return whether they showed).

OPEN (design-level — confirm before building):
- **Win timing** — win currently auto-fires from the evaluator (`winStartAt =
  allLand + winDelay`) and plays too early. Want it driven by a clip AFTER stopSpin.
  Options: (a) a new `playWin` spinner action clip the user places on the timeline;
  (b) a separate win track. Ties into runtime result injection (which cells win).
- **Statics/blurred 1:1 + overflow** — render symbols at native size (220×220 stays
  220, not shrunk to the 200 cell) and let them extend past the cell. The blocker is
  the per-reel `RectMask2D`/`SpriteMask` clips horizontal overflow; truly showing it
  needs the mask to clip vertically only (board window) — a masking redesign in
  `spinnerBakedDocs` + `YggSpinner` + web runtime. (Animations already overflow
  because they live unmasked in `Fx`.)
- **Runtime symbol/result injection** — feasible; needs a small public API on
  `YggSpinner` (e.g. `SetResultBoard(string[][])` / `Spin(board)`) so programmers
  inject the backend result instead of the baked clip board; the timeline drives the
  visual. See §3.

## §3 — Other asked-for items to finish / confirm
- **Land-anim offset** (§B) end-to-end: editable in wizard, honored in web + Unity.
  Confirm the offset actually shifts the anim start in both.
- **Spinner clip "set duration" buttons** (§C): confirm spin-up / 2s / until-landed
  values feel right against a real reel config.
- **Spine "Blend Curves In/Out"**: Unity shows Auto/Linear/manual curve dropdowns we
  don't have (we only have one "time curve"). Add if the user wants full parity.
- **Web overlay polish**: fit-to-cell scaling, correct anchor, and whether land vs
  win overlays should layer.

## Hard-won gotchas (don't relearn)
- spine-timeline in the user's project is **compiled (no readable source on disk)**;
  the prior log "[Ygg] Built N Spine Timeline track(s)" proves the builder runs there.
  Set spine clip fields by ENUMERATING serialized properties, never hard-coded names.
- Symbol land/win spine skeletons **share one atlas+texture**
  (`08_Symbols/Animations/Hp_Lp_SSybbols_Multiplier_Anticipation.atlas.txt/.png`,
  16 skeletons). The Asset Browser / `resolveSpineSiblings` lone-atlas logic handles it.
- The Spinner wizard used to drop atlas/texture (fixed); existing scenes self-heal via
  `repairSceneSpineAssets` when the project root is connected.
- All Unity-side spine work is JS codegen → C#; nothing compiles in the toolkit.
  Validate JS via `npm run build` + `node --test src/tools/SceneStudio/unity/*.test.mjs`,
  then a real import into `C:\Users\jakub.pi\game-toothless-smile`.
- Runtime spine instantiation is reflective + try/caught → failures disable overlays,
  they don't crash; watch the Console for the `[YggSpinner] …` warnings.

## Acceptance
- Assign a symbol a land (and a win) Spine anim in the wizard; in the Scene Studio
  preview, scrubbing into the land/win window plays that Spine anim on the cell.
- Fresh Unity import + Play: on stop, landed symbols play their land Spine anim and
  winning symbols their win anim (in the `Fx` layer), with the timing offset honored.
- No procedural scale-pop anywhere. mix=0 clips still snap (no blend artifact).

## Key files
| File | Role |
|---|---|
| `engine/spinner/spinnerRuntime.js` | web overlay pool + per-frame land/win dispatch |
| `engine/pixiApp.js` | `makeSpineOverlayFactory` (createSpineContainer) |
| `engine/spineLoader.js` | spine skeleton-data load path |
| `engine/spinner/spinnerModel.js` | symbol land/win anim model (`loop`, `offset`) |
| `unity/csharp.js` | `YggSpinner` overlay pool (BuildOverlays/DriveOverlay/CreateOverlay), `WireSpinnerOverlays`, `ApplySpineClipTemplate` |
| `unity/exportUnityPackage.js` | symbol spine triplet export + `animBindings` |
| `unity/prefab.js` | `spinnerYaml` (`symbolAnimBindings`) |
| `components/SpinnerWizard.jsx` | land/win anim + offset assignment |
