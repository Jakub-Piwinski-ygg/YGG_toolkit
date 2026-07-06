# Spinner — Phase 5 of Scene Studio

> Status (2026-06-12): **M0–M4 and M6 shipped**; M5 shipped except the
> procedural `pop` fallback. The wizard shipped as **4 steps** and its
> auto-detect was reworked to structure-driven detection + fuzzy
> spine/anim matching (`engine/spinner/symbolMatch.js`, see §4) with a
> per-symbol static/blur/land/win preview strip.
>
> **Unity feedback round 1 (2026-06-12) — SHIPPED.** ① web land/win overlay
> wiring, ② baked reel hierarchy, ③ `YggSpinnerTrack` control track (scrubs in
> edit mode), ④ Spine clip parity round 1 (mix/holdPrevious/clipIn/alpha),
> ⑤ opt-in Timeline auto-build. See `next phase spinner unity phase2.md`.
>
> **Unity feedback round 2 (2026-06-13) — verified by import.** Spinner is
> in-scene and the control track scrubs.
>
> **Unity feedback round 3 (2026-06-13) — SHIPPED; `next phase spinner unity
> phase3.md`.** Removed procedural scale-punch (land/win are Spine-only). Symbol
> spine triplets export; pooled overlays spawn/drive in `Fx`; SkeletonDataAsset
> autowired by name. Land/win timing **offset**; spinner clip "set duration"
> buttons; Spine clip parity round 2. **Atlas/texture self-heal**
> (`repairSceneSpineAssets`) recovers the shared atlas from disk (the wizard had
> dropped it). **Mix bug fixed**: `ApplySpineClipTemplate` sets clip fields by
> enumerating real serialized properties (version-robust) + forces clip ease-in/out
> so mix=0 snaps. Inspector regrouped to mirror Unity's Spine clip.
>
> **Round 4 (2026-06-14) — SHIPPED.** Symbol land/win Spine overlays now BAKED into
> the prefab `Fx` (visible in-editor, autowired, bound + driven — not runtime-spawned);
> **single shared-atlas export** (one folder/atlas/material → one draw call, no more
> per-symbol duplication); static/blur hidden behind a playing overlay.
>
> **Round 5 (2026-06-14) — SHIPPED.** Three confirmed builds: (A) a **"present
> win" clip** after stopSpin with a per-reel win delay (cascade vs simultaneous),
> replacing the auto-fired win; (B) **1:1 native symbols + a single machine mask**
> clipping only statics/blur (animations overflow freely); (C) a runtime
> **`SetResultBoard`/`Spin` API** so programmers inject the backend-randomized
> result. See "Phase 5 round 5" under §6 for details. Still needs live Unity-import
> verification (baked overlays actually play; native sizing tuning).

> **2026-06-24 — wizard is now an in-place full-focus panel + live test-spin.**
> The Spinner wizard no longer opens as a modal: it docks as a **wide vertical
> right-side column** and takes over the **scene view** with a live preview
> (rendered through the main viewport renderer — a synthetic preview scene, like
> scenario `directPreview`). Opening it auto-switches to **setup mode**; the
> hierarchy + inspector hide. A new **`timing.minSpinTime`** field (default
> 0.5s — see 2026-07-04 below)
> is the duration of `spin` action clips added to the timeline AND drives the
> wizard's **🎰 test spin** button, which plays the FULL cycle
> startSpin → spin(minSpinTime) → stopSpin → presentWin (landing a seeded
> *winning* board so present-win has something to show), exactly like the scene
> timeline. The preview object is **stable during a test spin** (no texture-reload
> flash): rebuilds are **debounced** (~150ms after edits settle) so dragging
> timing/blur sliders doesn't thrash the renderer (§20.10 rapid-rebuild crash).
> Adding objects to the hierarchy from the workspace is now setup-mode-only
> (auto-switches). Companion: `react-app/WIN_SEQUENCES.md`.

> **2026-07-04 — wizard polish: step order, faster defaults, symbol scale,
> negative spacing, outcome-dropdown fix.** The wizard now opens on **Symbols**
> first, **Grid** second (Timing → Review unchanged) — symbols-first matches
> what artists actually need to pick before grid dimensions matter. New-spinner
> timing defaults are snappier: `startDuration` 0.4→0.25s, `spinSpeed` 12→30
> cells/s, `stopDuration` 0.6→0.35s, `minSpinTime` 1.0→0.5s (existing spinners
> keep their saved values; only the wizard's defaults for a brand-new spinner
> change). A new **`grid.symbolScale`** (default 1, range 0.05–10) uniformly
> scales the rendered art (static/blur/spine) inside each cell independently of
> cell size — live-patched with no Pixi rebuild, mirrored in the Unity export.
> **Negative `spacingX`/`spacingY`** are now allowed (clamped so cell+spacing
> never drops below 1px), so cells can touch or overlap. **Bug fix**: the
> wizard's test-spin "Result" outcome dropdown (e.g. "no win") was silently
> ignored — `outcome`/`rerollSeed` were dropped by clip normalization before
> `targetBoardForClip` ever saw them, and the non-winning-board fallback wasn't
> wild-aware (a wild-substituted win could leak into a "no win" board). Both
> fixed; see §3's clip-payload schema and §4.

> **2026-07-04 (follow-up) — real "no win" fix, animOnly blur parity, Result
> now drives the board directly.** The prior fix above closed a normalization
> bug but a SEPARATE bug remained: `generateNonWinningBoard`'s greedy fix-up
> never re-verified its own postcondition, so with few symbols (the wizard's
> own minimum of 2) crossed with more rows it could exhaust its "safe"
> replacement pool and silently return a still-winning board (empirically:
> 40% of re-rolls failed on a 2-symbol/3×5 config). Fixed with a deterministic
> last-resort guarantee: making one interior reel monochrome in symbol X and
> the next in a different symbol Y caps every candidate's run below the win
> threshold regardless of what's on any other reel — works even at 2 symbols.
> **`animOnly` symbols' blur** (T7) previously used Pixi's generic isotropic
> `BlurFilter`, visibly different from every other symbol's directional
> motion-blur — `bakeSpinePoseTexture` now runs the SAME WASM/canvas-fallback
> directional-blur chain (`spinnerBlur.js`, extracted into reusable
> `blurCanvasWasm`/`blurCanvasFallback`) against the identical posed frame
> already used for the sharp/idle bake. **Review step reworked**: picking a
> Result (or re-rolling) now SYNCHRONOUSLY computes a concrete board and
> writes it into `initialBoard` — the board editor grid and the live preview
> at rest update immediately, no need to spin first. `Spin` now carries an
> explicit `targetBoard` (the board already on screen) instead of
> `outcome`/`rerollSeed`, so the animation can never land anywhere other than
> what was just previewed (`buildSpinnerTestClips` gained a 4th `targetBoard`
> param for this). Manual per-cell edits in the board editor still work and
> simply stop matching whatever Result label is showing.

> **2026-07-04 (blur UX + panel space)** — blur generation ("⚡ fill missing
> blurs") is still 100% explicit-click only (it never auto-ran), but each
> symbol's blur now updates the wizard incrementally with a **progress bar**
> ("blurring 'x' — 3/14") and yields a frame between symbols instead of
> looking frozen for the whole batch — true background execution (a Worker)
> isn't used because the shared WASM chain writes fixed temp filenames also
> used by every other ImageMagick call in the app, so it has to stay
> sequential regardless. The sigma/feather sliders are no longer hidden once
> nothing is "missing" — a new **"↻ regenerate all"** button lets you tune
> them and re-blur every symbol on demand. The wizard panel's default width
> grew 460→620px and the per-symbol preview thumbnails grew 44→76px (were a
> fixed size regardless of how wide the panel got, leaving most of a resized
> panel blank).

> **2026-07-04 (animOnly blur perf regression fix + real settings)** — the
> round above's "regenerate all"/sigma-feather panel only appears for symbols
> with a static PNG, which does nothing for an animations-only symbol set —
> and worse, the earlier directional-blur fix for `animOnly` symbols
> (`bakeSpinePoseTexture`) had turned a cheap Pixi filter into a **5-step
> WASM ImageMagick chain run synchronously in the middle of scene
> construction**, so a handful of animOnly symbols could stall the preview
> for multiple seconds before anything rendered. Both fixed: `blur.sigma`/
> `blur.feather` are now real, **persisted** config fields (`defaultSpinnerBlur`)
> shared by both blur mechanisms — the wizard's static-symbol sigma/feather
> sliders are the SAME control for both, and now show up whenever there's any
> symbol at all, not just static ones. `bakeSpinePoseTexture` was split: the
> SHARP texture (cheap, no WASM) is captured and shown immediately so the
> scene never waits on blur; the actual directional blur is queued onto a
> single shared, strictly-sequential background queue (`queueBlurBake`) and
> swapped in once ready, with no caller ever blocking on it. Concurrent WASM
> calls are still avoided (every ImageMagick call in the app shares fixed temp
> filenames) — the queue serializes them without making anyone wait.

> **2026-07-04 (two more blur bugs)** — still no visible blur reported after
> the round above. Found: `generateBlurs` (wizard "fill missing blurs"/
> "regenerate all") assigned a project-folder-scanned asset's raw filesystem
> path straight to an `<img>` element's `src` — silently fails to load (a
> pre-existing bug, not a regression from today), so the progress bar
> completed with nothing to show. Now resolves it via `resolveAssetFile`, the
> same path `SymbolThumb`'s own preview already used correctly. Also switched
> the animOnly blur bake's canvas extraction from the raw, un-parented Spine
> container (`extract.canvas(inst.container)`) to the already-generated sharp
> **texture** (`extract.canvas(sharp)`) — more reliable bounds, though
> unconfirmed as the actual root cause without a browser to check in.

> **2026-07-04 (blur generation speed — downsample before blurring)** — the
> WASM directional-blur chain's cost scales with pixel count across all 5
> steps (plus PNG encode/decode between each). Static-symbol blur generation
> (`spinnerBlur.js`) now downsamples the rendered cell 4x (`BLUR_DOWNSAMPLE`,
> 16x fewer pixels) before running the chain — sigma/feather scale down
> proportionally — and returns the blob at that reduced size, with **no
> re-upsample in the generator**. Display-time compensates instead:
> `spinnerRuntime.js`'s blur sprite scale is now computed from the ACTUAL
> texture-size ratio (`tex.width/blurTex.width`) rather than assumed 1:1, so
> it transparently handles the new smaller blur PNGs, old full-size ones, and
> animOnly's same-size runtime bake alike. Unity export (`csharp.js`) got the
> matching fix on both variants — UI sizes the blur `Image` against the
> *static* sprite's dimensions instead of the blur sprite's own (smaller)
> ones; World caches a `blurScaleX/Y` ratio per cell and folds it into
> `bTr.localScale` — without either, a downsampled blur PNG would render
> visibly smaller than its static counterpart in an exported build.

> **2026-07-04 (the actual root cause — blur never displayed anywhere)** —
> generated blur was faster after the round above but still never visibly
> appeared, in the wizard preview, the timeline, or Direct mode alike. Found:
> `resolveAssetUrl` (`engine/persist.js`) — the ONE shared resolver every
> asset kind in Scene Studio goes through (spine skel/atlas/texture, plain
> PNG layers, spinner statics/blur) — only special-cased `data:` URLs.
> Generated blur PNGs use `URL.createObjectURL(blob)` → a `blob:` URL, which
> fell through to being treated as a relative project-folder path, never
> matched anything, and returned `null`. The spinner runtime's `null`-safe
> fallback (`blurTex || tex || Texture.WHITE`) then silently used the
> **static texture as the blur texture** — no error anywhere, the blur
> sprite just showed the exact same unblurred image as its static
> counterpart. This affected every generated/blob-sourced asset in the app,
> not just spinner blur. Fixed: `resolveAssetUrl` now recognizes `blob:` and
> `https?:` as directly-loadable, same as `data:`. New `engine/persist.test.mjs`
> (3 tests) covers it.

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
              winAnim:  {kind:'spine'|'pop'|'none', assetId?, anim?},
              animOnly  // (2026-07-04, T7) explicit flag — no static PNG;
                        // idle/resting texture is BAKED from landAnim's (or
                        // winAnim's) first frame at build time
                        // (spinnerRuntime.bakeSpinePoseTexture), and the
                        // symbol holds its last computed win pose at rest
                        // instead of reverting to a static. Deliberately
                        // explicit, not inferred from `!assetId` — an
                        // in-progress symbol (static not picked yet) must
                        // not silently opt into hold-forever win timing.
            }],
  grid:   { reels, rows, cellW, cellH, spacingX, spacingY, symbolScale },
                                 // spacingX/spacingY: default 0, negative allowed
                                 // (clamped to keep cell+spacing >= 1px) so cells
                                 // can touch/overlap. symbolScale: default 1,
                                 // range 0.05–10 — uniform art scale inside each
                                 // cell (statics/blur/spine), independent of
                                 // cell size; live-patched, no relayout.
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
  //            boardSeed?,  // seeded random non-winning board stamped at creation
  //            outcome?,    // (2026-07-04, T12) 'noWin'|'smallWin'|'bigWin'|'wildWin' —
  //                         // the clip's OWN authored result threshold; a Direct-mode
  //                         // per-node override still wins over this when present
  //            rerollSeed?  // (T12) bumped by "re-roll result" — folds into the
  //                         // outcome board's seed so re-rolling within the same
  //                         // threshold produces a different board
}
```

`loop / speed / curve / mixDuration` are ignored and hidden for spinner clips.

**Direct-mode per-node override** (scenario node `entry`, not the clip): `spinOutcome` +
`spinOutcomeReroll` (T12) — same outcome/reroll pair, but set on the director graph node
instead of a specific clip; wins over the clip's own `outcome` when not `'default'`. All
three surfaces (director node, timeline clip, spinner wizard test-spin preview) resolve
through the one shared seeded-outcome path in `spinnerModel.targetBoardForClip`.

**Animations-only symbols** (2026-07-04, T7): a symbol with `animOnly: true` skips static
art rendering entirely. Its idle/resting appearance is a texture baked once, at Pixi
build time, from a temporary Spine instance posed at `landAnim`'s (or `winAnim`'s) first
frame and captured via `renderer.generateTexture()` — inserted into the same texture map
ordinary static PNGs use, so the per-frame render loop needs no special case. A live,
continuously-updating Spine per idle cell was considered and rejected: the land/win
overlay pool is deliberately capped (~12 instances, for per-instance Spine render cost)
and idle cells routinely outnumber that on any real board. After a win presentation, an
`animOnly` symbol's window has no upper bound (`spinnerEval.isAnimOnlySymbol`) — it holds
the win animation's last computed pose (non-looping) or keeps looping it (looping) at
rest, until the reel spins again. **Known gap**: the Unity exporter passes a `null`
static GUID through cleanly for these symbols, but `YggSpinner.cs` has no equivalent
bake-from-pose or hold-last-pose logic yet — web preview and a Unity build will diverge
for `animOnly` symbols until that's built.

## §4 Editor UX

> **As-built (2026-06-12):** the wizard shipped as 4 steps — Grid → Symbols →
> Timing → Review (reordered 2026-07-04 to **Symbols → Grid → Timing →
> Review** — symbols-first, matching §4's original design intent below).
> Symbol auto-detect is **structure-driven**: it finds the
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

### Phase 5 round 5 (2026-06-14) — SHIPPED

Three confirmed builds from `next phase spinner unity phase5.md`:

- **§A "Present win" clip.** A new `presentWin` spinner action (after `stopSpin`
  in the add-clip sequence) controls *when* the winning symbols of the preceding
  stop play their win animation — replacing the auto-fired
  `winStartAt = allLanded + winDelay`. Per-reel **`reelWinStagger`** (0 = all at
  once; >0 = cascade reel 0 → 1 → …) plus an optional explicit `perReelWinDelay`
  array. The evaluator stores `winStartByReel[]` per stop (auto-filled, then
  overridden by the `presentWin` clip's `start` + stagger); with no `presentWin`
  clip the old auto behaviour is unchanged. Carried to Unity through
  `bake.js → clipsJson/descriptor → YggSpinnerClip/Track/mixer → ResolveTrack`.
  Inspector: `SpinnerInspectorSections.jsx` present-win section with a
  "set duration = until all wins played" helper (`spinnerPresentWinDuration`).
  Note: bake.js previously read clip params *flat* (`c.targetBoard`) while
  normalized clips nest them under `c.spinner` — fixed to read nested (the
  target board / delays were silently dropped on export before).

- **§B Single machine mask + native 1:1 symbols.** Statics/blur render at the
  sprite's **native px** (a 220px symbol stays 220px and overflows its cell) — the
  per-cell fit-shrink (`fitSpriteToCell` / `FitScale` / UI `preserveAspect` cell-fit)
  is gone. Per-reel masks are replaced by **one machine-sized mask** wrapping
  `Statics + Blurs` (RectMask2D for UI; one machine SpriteMask for world,
  `VisibleInsideMask`). The new hierarchy is `Board > Mask > Statics/Blurs` with
  **`Fx` a sibling of `Mask`, OUTSIDE it** — land/win anims extend past the cell
  and even the machine frame. The mask still clips the scrolling top/bottom buffer
  rows and the machine's left/right edges. Web: `spinnerRuntime.js` (board mask +
  native scale). Unity: `prefab.js#spinnerBakedDocs` (single Mask, native cell px),
  `csharp.js` (`NewMaskContainer`, `BindBakedHierarchy` finds `Mask`, `SetNativeSize`,
  no `FitScale`; legacy prefabs still bind via the Board fallback).

- **§C Runtime result-injection API** (`YggSpinner`, programmer-facing):
  ```csharp
  var spinner = machineGo.GetComponentInChildren<YggSpinner>();
  spinner.SetResultBoard(backendResult); // string[reel][row] of symbol ids
  spinner.Spin();                         // or Spin(backendResult) in one call
  // ... spinner.IsSpinning is true until the present-win finishes.
  ```
  `SetResultBoard(string[][])` overrides the baked `stopSpin` target board (and
  re-resolves, so wins derive from the injected board via `EvalWaysWins`).
  `Spin()` / `Spin(board)` drive a `startSpin → spin → stopSpin → presentWin`
  cycle on an **internal clock** in `Update()` — no Timeline required (the Timeline,
  when present, still drives the *visual* via `Evaluate`; this injects the
  *result*). Timing is derived from the config (`BuildDefaultCycle`). The injection
  flows through `InjectBoard()` which clones each `stopSpin` clip with the new board.

- **Follow-up fixes (post first Unity import):**
  - **Real per-symbol win/land durations (the cutoff fix, round 6).** The win and
    land state windows are now sized by each SYMBOL's *actual* referenced Spine
    animation length — not a config default. `spineLoader.describeSpine` already
    exposes `animationDurations`; `pixiApp.createSpineContainer` now also returns the
    anim `duration`. `buildSpinnerObject` captures each (symbol, kind) length while
    building the overlay pool, writes it into the in-memory
    `config.symbols[*].{winAnim,landAnim}.duration` (fixes the web preview instantly),
    and surfaces a `{ [symbolId]: { win, land } }` map via the new
    `deps.onSpinnerAnimDurations` callback (threaded `buildLayerObject` →
    `rebuildScene` → `PixiViewport` → `SceneStudioInner`, mirroring `onAssetReady`).
    `SceneStudioInner` patches those durations onto `asset.spinner.symbols[*]` and
    bumps `rev` — so **existing scenes self-heal on open** (no wizard re-run). The
    evaluator (`evaluateSpinner`) and the C# `EvaluateInternal` (`WinDurFor`/`LandDurFor`,
    fed by baked `SpinnerSymbolData.winDur/landDur`) use the symbol's real length,
    falling back to `events.winAnimDuration`/`landAnimDuration` only when unknown (0).
    `spinnerPresentWinDuration` returns `maxReelDelay + longest win-anim across
    symbols`. The fragile runtime Spine-reflection extension (`YggSpinner.WinExtensionT`,
    `Overlay.dur`) from the previous attempt is REMOVED — the baked deterministic
    durations replace it. `SpinnerSection`'s `land/win anim dur` fields remain as the
    editable fallback.
  - **Per-reel Fx overlays** — baked overlays moved from `Fx/Anim_<sym>_<kind>` to
    `Fx/Reel_<r>/Anim_<sym>_<kind>` (one instance per reel), so the SAME winning
    symbol can animate on multiple reels at once (the staggered present-win cascade).
    `BuildOverlays`/`DriveOverlay` key by `reel:sym:kind` when `Fx/Reel_0` exists and
    fall back to the flat `sym:kind` layout for legacy prefabs. The web runtime
    already supported simultaneous overlays via its instance pool (unchanged).

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
