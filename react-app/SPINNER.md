# Spinner — Phase 5 of Scene Studio

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

- [ ] **M0 — cleanup (½d)**: port `makeBlurWasm` (old `SlotMachineTool.jsx:36-90`)
      → `engine/spinner/spinnerBlur.js`; delete `SlotMachineTool.jsx`; scrub
      `registry.js`, `components.css` `.sm-*`, `CLAUDE.md`, `TOOL_REVIEW.md`.
      Legacy `index.html` block stays (reference golden rule).
      *Verify: build clean; grep clean.*
- [ ] **M1 — pure core (1–2d)**: `spinnerModel.js`, `spinnerEval.js` + node unit
      tests. *Verify: ways truth table; non-winning generator over 1000 seeds;
      |Δs|,|Δv| < 1e-9 at clip boundaries incl. truncated startSpin; stop lands
      exact target board; evaluate(t) order-independent; blurMix monotone.*
- [ ] **M2 — Pixi rendering (2d)**: `spinnerRuntime.js`; `pixiApp.js` build branch,
      `applyFlowAtTime` dispatch, structural hash + `rev`. *Verify: hand-authored
      spinner JSON scrubs identically in both directions; selection handles work.*
- [ ] **M3 — timeline + inspector (2d)**: clip `action` model, action picker,
      contextual "+ clip" defaults, `SpinnerSection` / `SpinnerClipSection` /
      `BoardGridEditor`. *Verify: edited stop board lands; staggers cascade;
      save/reload roundtrips.*
- [ ] **M4 — wizard (2d)**: 6-step wizard incl. blur generation + fallback.
      *Verify: fresh scene → wizard → play → full spin cycle with blur crossfade
      and non-winning initial board.*
- [ ] **M5 — land/win events (1–2d)**: event windows, Spine overlay pool +
      procedural pop, per-reel land anims, win anims on `winCells`.
      *Verify: scrub into mid-win-window → pose matches `stateT`.*

### Milestone B — Unity export

- [ ] **M6 (3–4d)**: symbol/blur textures under `Art/Spinner/`; `SpinnerConfig` +
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
