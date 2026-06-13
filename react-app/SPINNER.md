# Spinner — Phase 5 of Scene Studio

> Status (2026-06-12): **M0–M4 and M6 shipped**; M5 shipped except the
> procedural `pop` fallback. The wizard shipped as **4 steps** and its
> auto-detect was reworked to structure-driven detection + fuzzy
> spine/anim matching (`engine/spinner/symbolMatch.js`, see §4) with a
> per-symbol static/blur/land/win preview strip.
>
> **Unity feedback round (2026-06-12) — next phase is specced in
> `next phase spinner unity.md` (repo root).** Headlines:
> ① BUG: land/win Spine overlays never render in the WEB preview —
> `pixiApp.js` never provides `deps.createSpineContainer` to
> `spinnerRuntime.js`, so the overlay pool is always empty.
> ② Unity prefab should bake the reel hierarchy (pool-style cells,
> statics/blurred/anims layered under separate parents for draw calls,
> RectMask2D for UI / SpriteMask + SpriteRenderer for world) instead of
> runtime-only `Build()` — the spinner reads as an empty GO in the editor.
> ③ Wanted: a Spine-Timeline-style `YggSpinnerTrack` with action clips,
> scrubbable in edit mode; ④ Scene Studio spine clips should expose the
> Spine Animation State Clip fields (mix, hold previous, clip-in, alpha…)
> for 1:1 export; ⑤ Timeline auto-build should be opt-in and refuse to
> build spine-less timelines silently.

Deterministic slot-machine reel object for Scene Studio ("pixie engine"), replacing
the old `SlotMachineTool` art tool. Cross-target by design: the core model is a pure
JSON spec + evaluator with **zero rendering dependencies**, rendered first by Pixi
(Milestone A) and later by generated C# in the Unity export (Milestone B), with the
door open for any future framework.

Companion docs: `SCENE_STUDIO.md` (master design, Phases 1–4),
`src/tools/SceneStudio/README.md` (status).

---

## §1 Design principles

1. **Position from time, never simulation.** Every reel's scroll offset, every
   symbol in every cell, the blur mix, the bounce, and the land/win animation poses
   are pure functions of timeline time `t`. Scrubbing the timeline to *any* frame —
   forwards, backwards, randomly — shows the exact correct state. This is the same
   contract Spine clips already honor (`trackTime = clipLocalSeconds(...)`).
2. **Outcome first, animation second.** The machine knows where it wants to place
   the final, non-randomized symbols before the stop begins (industry-standard
   "calculate → animate to result"). Final boards are authored per `stopSpin` clip.
3. **Framework-agnostic core.** `spinnerModel.js` + `spinnerEval.js` import nothing
   but pure curve math. Pixi and Unity are thin renderers over `evaluateSpinner()`.
4. **Layered configurability.**
   - *Layer 1* — one generic "total spin time" (UI sugar that distributes downward).
   - *Layer 2* — startDuration / startEase / spinSpeed / stopDuration / stopEase /
     reel staggers / blur thresholds / bounce defaults (machine-level, inspector).
   - *Layer 3* — per-reel overrides + per-clip action params (clip inspector).
5. **Consistency over flexibility.** One spinner = one action track. Clips never
   overlap. Continuity across adjacent clips is computed analytically, not hoped for.

## §2 Evaluation model (the math)

### State

Per reel `r`: scroll `s_r(t)` in **cells** (float, increases while spinning).
Visible symbol at row `j` = `stripAt(r, floor(s_r) + j)` — modulo lookup into the
reel's persisted strip, with a derived *stop overlay* (see below). Sub-cell pixel
offset = `frac(s_r) · cellPitch · direction`. The renderer keeps `rows + 2` cell
sprites per reel (one buffer row above and below) inside a rect mask.

### Curve integral LUT

Eased speed profiles need the integral of the ease curve; cubic beziers have no
closed form, so the evaluator builds `buildCurveLUT(spec, N=256)` — a cumulative
trapezoid table over the existing `curveEval` (`engine/animation/curves.js`) —
memoized per curve spec. `lutIntegral(lut, p)` interpolates linearly. Deterministic,
frame-rate independent, and ports to C# verbatim.

### Phase functions (clip-local τ, per reel after its stagger delay)

| Action | Speed | Scroll |
|---|---|---|
| `startSpin` | `v(τ) = vmax·E(τ/d)` | `s = s₀ + vmax·d·∫E` |
| `spin` | entry `{s₀,v₀}`; if `v₀ < vmax`, ramp over `dr = startDuration·(1−v₀/vmax)`; else constant | ramp integral, then linear |
| `stopSpin` | ease-out `B` to 0, landing on whole cells | `s = s₀ + D·B(τ/ds)` |
| `holdResult` / gap / past end | 0 | hold previous exit state |

- **Continuity stitching:** each clip's evaluator receives `{entryScroll,
  entrySpeed}` from the previous clip's exit state. A `startSpin` cut short of full
  speed exits at sub-`vmax`; the following `spin` clip ramps the remainder while
  scroll stays continuous — position **and** velocity continuous by construction.
  This is the user-visible guarantee: "+ spin after startSpin continues exactly
  where it left off".
- **Stop landing:** solve raw travel `D = v₀·ds / B'(0)` from entry speed and the
  ease-out endpoint slope, round **up** to whole cells `n`, then per the clip's
  `matchEntrySpeed` flag:
  - `true` (default): rescale that reel's stop duration `ds' = n·B'(0)/v₀` →
    perfect velocity continuity, a few ms drift from the authored duration;
  - `false`: keep `ds` exact, accept a tiny entry-speed snap (classic slot feel).
- **Symbol injection:** at resolve time, `finalScroll_r = round(s₀) + n` is known,
  so the resolver writes `overlay[r][(finalScroll_r + j) mod L] = targetBoard[r][j]`.
  `stripAt` consults the overlay first. The persisted strip is never mutated —
  landing is fully derived, and the machine "knows where it places final symbols".
- **Bounce:** additive output, not part of `s`:
  `bounce(τ) = amplitude · (curveEval(bounceCurve, p) − p)` over the last
  `durationFrac` of the stop. `backOut` / `overshoot` presets give the classic
  settle hump; the curve is editable with the existing CurveEditor. Amplitude in
  cells, fixed (not distance-scaled).
- **Blur mix:** `blurMix = clamp01((|v| − vLo) / (vHi − vLo))` — the renderer
  crossfades static ↔ pre-blurred symbol PNG alphas with it. No shaders needed,
  identical look in Unity.

### Resolve chain

`resolveSpinnerTrack(config, track)` walks the track's clips in order and caches per
clip × per reel `{entryScroll, entrySpeed, exitScroll, exitSpeed, n, ds',
lutRefs}`, the stop overlay map, and the **event table**:

```
reelLandAt[r]   = stopClip.start + stopDelay_r + ds'_r
allLandedAt     = max(reelLandAt)
landCells       = per reel: target symbols (land anims fire as each reel stops)
winCells        = ways-eval(targetBoard)        // 3+ same symbol, consecutive
                                                 // reels from left, any rows
winStartAt      = allLandedAt + winDelay
```

Memoized by a hash of (track clips JSON, `config.rev`, timing/bounce/blur JSON) —
clip edits invalidate automatically, no event wiring.

### Single entry point

```js
evaluateSpinner(config, resolved, t) → {
  reels: [{ scroll, speed, blurMix, bounce,
            cells: [{ row, symbolId, state: 'idle'|'spinning'|'landing'|'win',
                      stateT }] }]
}
```

`stateT` (time inside the state window) drives Spine `trackTime` or the procedural
pop deterministically — scrub-safe like the existing Spine path.

## §3 Data model

- **New asset type `'spinner'`** (joins `png|spine|video|pngSequence`). The layer
  stays an ordinary `SceneLayer` → transform, visibility, parenting, orientation
  overrides all work for free.
- Symbol static + blurred PNGs are **ordinary `png` assets** referenced by id →
  persistence (quick/scaffold) and Unity texture export unchanged.

```js
asset.spinner = {
  rev,                          // bumped on structural edits → Pixi rebuild
  symbols: [{ id, name, assetId, blurAssetId,
              landAnim: {kind:'spine'|'pop'|'none', assetId?, anim?},
              winAnim:  {kind:'spine'|'pop'|'none', assetId?, anim?} }],
  grid:   { reels, rows, cellW, cellH, spacingX, spacingY },
  strips: [[symbolId, …] per reel],     // persisted explicitly, length ~24–32
  initialBoard: [[symbolId per row] per reel],   // guaranteed non-winning
  seed,                         // mulberry32 seed used by generators
  direction: 1,                 // 1 = symbols scroll downward
  timing: { startDuration, startEase, spinSpeed /*cells/s*/, stopDuration,
            stopEase, reelStaggerStart, reelStaggerStop },
  bounce: { curve, amplitude /*cells*/, durationFrac },
  blur:   { enabled, vLo, vHi },        // cells/s crossfade thresholds
  events: { winDelay, landAnimDuration, winAnimDuration },
  perReel: [ { spinSpeed?, stopDuration?, … } ]   // sparse Layer-3 overrides
}
```

**Clip extension** (`normalizeClip`):

```js
clip.action  = 'startSpin' | 'spin' | 'stopSpin' | 'holdResult' | null
clip.spinner = {  // action-specific, all optional
  // startSpin: startEase?, perReelStartDelay?[]
  // spin:      spinSpeed?, rampEase?
  // stopSpin:  targetBoard?[][], stopEase?, perReelStopDelay?[],
  //            bounce?{curve,amplitude,durationFrac}, matchEntrySpeed? (default true),
  //            boardSeed?   // seeded random non-winning board stamped at creation
}
```

`loop / speed / curve / mixDuration` are ignored and hidden for spinner clips.

## §4 Editor UX

> **As-built (2026-06-12):** the wizard shipped as 4 steps — Grid → Symbols →
> Timing → Review. Symbol auto-detect is **structure-driven**: it finds the
> `NN_Symbols` folder in the scanned project, takes **`StaticArt/` PNGs as the
> symbol definitions** (one symbol per static), matches land/win Spine anims
> from the adjacent `Animations/` folder by name, matches blur PNGs from
> `Blurred/` by static stem (`h1` ↔ `Blurred/h1` / `h1_blur`), and offers a
> "⚡ fill missing blurs" button (WASM motion-blur) for symbols without a blur
> pair. A manual filter + the legacy name-score heuristic remain as fallback
> when no Symbols folder exists.

- **Setup wizard** (`SpinnerWizard.jsx`, opened from "+ spinner" in the toolbar /
  asset browser): ① symbols (drop PNGs or pick existing assets; per-symbol land/win
  Spine pickers, `pop` fallback) → ② grid (reels × rows, cell size, spacing, live
  preview) → ③ timings (Layer-1 master slider distributing into Layer-2 fields) →
  ④ blur (sigma/feather, "generate blurred variants" via the WASM motion-blur
  pipeline; canvas stacked-ghost fallback when Magick is unavailable) → ⑤ initial
  board (auto non-winning, re-roll + manual cell editing) → ⑥ create (one scene
  update: 2×N png assets + spinner asset + layer + optional default clip chain;
  offers to extend `stage.duration` if the sequence doesn't fit). Re-openable from
  the inspector for structural edits (bumps `rev`).
- **Hierarchy-selected inspector** (`SpinnerSection`): symbol thumbnail strip, grid
  readout, Layer-2 timing fields, blur thresholds, bounce defaults (CurveEditor),
  collapsible per-reel override table, "edit setup…" and "regenerate blurred PNGs".
- **Timeline:** spinner layers drag to the timeline like Spine. Clip blocks show an
  **action** selector (`startSpin / spin / stopSpin / holdResult`) exactly where
  Spine clips show the animation picker. The "+" adjacent-add stamps contextual
  defaults: first clip → `startSpin`; after `startSpin`/`spin` → `spin`; after
  `spin` → `stopSpin` with a seeded random non-winning target board.
- **Clip-selected inspector** (`SpinnerClipSection`): mostly action-specific params.
  `stopSpin` gets the `BoardGridEditor` — a reels×rows mini grid with per-cell
  symbol pickers, "randomize (no win)" / "randomize (force win)" buttons, ways-win
  highlight, per-reel stop delays, bounce override, `matchEntrySpeed` toggle.

## §5 Win logic (v1)

**Ways only, no paylines:** a win is 3+ of the same symbol on consecutive reels
starting from reel 0, any row positions. Used for (a) generating guaranteed
non-winning boards (rejection sampling with seeded RNG + greedy fix-up), (b)
`winCells` → win animation targets. Paylines later only touch `spinnerModel.js`
ways functions + the BoardGridEditor highlight.

## §6 Milestones

### Milestone A — Scene Studio (web)

- [x] **M0 — cleanup (½d)**: port `makeBlurWasm` (old `SlotMachineTool.jsx:36-90`)
      → `engine/spinner/spinnerBlur.js`; delete `SlotMachineTool.jsx`; scrub
      `registry.js`, `components.css` `.sm-*`, `CLAUDE.md`, `TOOL_REVIEW.md`.
      Legacy `index.html` block stays (reference golden rule).
      *Verify: build clean; grep clean.* **DONE.**
- [x] **M1 — pure core (1–2d)**: `spinnerModel.js`, `spinnerEval.js` + node unit
      tests. *Verify: ways truth table; non-winning generator over 1000 seeds;
      |Δs|,|Δv| < 1e-9 at clip boundaries incl. truncated startSpin; stop lands
      exact target board; evaluate(t) order-independent; blurMix monotone.*
      **DONE** (`spinnerEval.test.js`).
- [x] **M2 — Pixi rendering (2d)**: `spinnerRuntime.js`; `pixiApp.js` build branch,
      `applyFlowAtTime` dispatch, structural hash + `rev`. *Verify: hand-authored
      spinner JSON scrubs identically in both directions; selection handles work.*
      **DONE.**
- [x] **M3 — timeline + inspector (2d)**: clip `action` model, action picker,
      contextual "+ clip" defaults, `SpinnerSection` / `SpinnerClipSection` /
      `BoardGridEditor`. *Verify: edited stop board lands; staggers cascade;
      save/reload roundtrips.* **DONE** (`SpinnerInspectorSections.jsx`).
- [x] **M4 — wizard (2d)**: shipped as **4 steps** (Grid → Symbols → Timing →
      Review) instead of the 6 designed in §4; includes blur generation.
      **DONE, with caveat**: symbol auto-detect used fuzzy name scoring over the
      whole project pool and over-matched — reworked 2026-06-12 to
      structure-driven detection (see §4 status note).
- [x] **M5 — land/win events (1–2d)**: event windows, Spine overlay pool,
      per-reel land anims, win anims on `winCells`. **DONE except the
      procedural `pop` fallback** — symbols whose land/win anim is not Spine
      currently get nothing. *Remaining: `pop` scale-punch driven by `stateT`.*

### Milestone B — Unity export

- [x] **M6 (3–4d)** — **DONE** (`unity/csharp.js`: `YggSpinner.cs` C# port,
      `spinnerCues` in the canvas descriptor, auto-wired components).
      **2026-06-12 fixes**: the YggSpinner component (configJson + clipsJson +
      symbolBindings with sprite refs) is now serialized directly into the
      prefab (`prefab.js#spinnerYaml`) — previously the spinner exported as an
      empty GameObject and bindings were never assigned. Timeline-dependent
      editor code moved to a `defineConstraints`-gated
      `Ygg.SceneStudio.Editor.Timeline` asmdef so the package-install dialog
      can't be killed by a missing `Unity.Timeline` reference; manual re-prompt
      via *Ygg ▸ Scene Studio ▸ Install Required Packages*; Timelines now
      auto-build after import/package install (`YggTimelineAutoBuild`).
      **Unity phase 2 (2026-06-12, in progress)** — per
      `next phase spinner unity.md` (repo root):
      ✓ #1 web land/win Spine overlays fixed (`pixiApp.js#makeSpineOverlayFactory`
      provides the missing `createSpineContainer` dep; shared SkeletonData via
      `spineLoader.js#loadSkeletonData`; scrub-deterministic `setTrackTime`).
      ✓ #2 prefab-baked reel hierarchy: `prefab.js#spinnerBakedDocs` bakes
      `Board > Statics/Blurs/Fx` with per-reel masked columns (rows+2 cells,
      initial-board sprites; Statics/Blurs are sibling layers — not per-cell
      nesting — so same-texture cells batch). UI variant masks with RectMask2D
      per reel; **the world variant now renders** via SpriteRenderer cells +
      per-reel SpriteMask (generated 4×4 white `YggReelMask.png`; the old
      "UI-only" warning is gone). `YggSpinner` gained `worldVariant` /
      `pixelsPerUnit` / `maskSprite` fields, binds the baked hierarchy by name
      in Awake (`BindBakedHierarchy` — baked cells are the pool's warm start;
      config drift spawns/deactivates extras) and falls back to
      `BuildRuntime()` only for legacy prefabs. Cell layout convention is now
      centered-anchors everywhere: `y = H/2 − cellH/2 − (gridRow+disp)·pitchY`
      (matches the web runtime). Tests: `unity/prefab.spinner.test.mjs`.
      Remaining: #3 spinner Timeline track, #4 spine clip parity, #5 opt-in
      auto-build, carry-overs (blob: packaging, web `pop` fallback).
      Original spec: symbol/blur textures under `Art/Spinner/`; `SpinnerConfig` +
      clip actions serialized as `spinnerCues` in the canvas descriptor (motion is
      **not** baked into `.anim` — evaluated at runtime from the same math);
      generated `YggSpinner.cs` = direct C# port of `spinnerEval.js` (same N=256
      LUT, same resolve chain, same rounding) building `Image` pairs under
      `RectMask2D` (UI) / `SpriteMask` (world), public `Evaluate(float t)`;
      driven by `YggScenePlayer.Update` v1, reflective `YggSpinnerTrack` for Unity
      Timeline scrubbing as stretch; land/win Spine via existing reflection
      machinery from state windows. *Verify: import package, play + scrub Timeline,
      compare to web; sampled `{t → scroll[]}` parity vectors asserted in a C#
      editor test.*

### Future (out of scope, noted)

- pngSequence symbol animations; paylines mode; anticipation/near-miss reel
  slow-down; turbo spin; per-symbol weighting in strip generation; scaffold-mode
  file writing for wizard-generated PNGs; additional export targets (the pure core
  is the contract).

## §7 Known risks

- Wizard data-URL assets inflate `scene.json` / IndexedDB autosave — accepted v1.
- Default 5s stage duration tight for a full sequence — wizard offers extension.
- Per-reel stop duration drifts a few ms under `matchEntrySpeed` default — by
  design, toggleable per clip.
- Pixi v8 rapid-rebuild crash (SCENE_STUDIO.md §20.10) — spinner rebuilds only on
  `rev` bump, so exposure is limited to wizard edits.
