---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, wizard, bugfix]
---

# Session 2026-07-04 — Spinner wizard polish: step order, timing defaults, symbol scale, negative spacing, outcome-dropdown fix

> [!success] Shipped (2026-07-04)
> Five artist-requested changes to the Scene Studio Spinner. All verified against
> the current code (three Explore passes + one Plan pass) before implementation;
> full execution plan: `~/.claude/plans/spinner-wizard-step-reorder-squishy-waterfall.md`.
> All 166 Scene Studio tests pass (`node --test` over `src/tools/SceneStudio/`),
> including 8 new tests added this session.

## Wizard step reorder

The wizard now opens on **Symbols** (step 1), **Grid** second — Timing → Review
unchanged. This matches [[Spinner Design]] §4's original design intent
(`① symbols → ② grid → …`), which the as-built wizard (2026-06-12) had drifted
from (it shipped Grid-first). `canNext`/`goToStep` in `SpinnerWizard.jsx` key off
step **name** strings, not array index, so reordering `STEPS` needed no other
logic changes — only the array itself, `STEP_LABELS`, and the initial `useState`.

## Faster timing defaults for new spinners

`defaultSpinnerTiming()` (`spinnerModel.js`): `startDuration` 0.4→0.25s,
`spinSpeed` 12→30 cells/s, `stopDuration` 0.6→0.35s, `minSpinTime` 1.0→0.5s.
Existing spinners keep their saved values — this only changes what a
newly-created spinner starts with. Mirrored in Unity's `SpinnerConfigData`.

## New `grid.symbolScale` parameter

Symbols previously rendered at native 1:1 inside their cell (`cellC.scale.set(1)`
hardcoded) — artists could only resize the *cell rect*, not the art itself. A new
`grid.symbolScale` (default 1, range 0.05–10) uniformly scales the rendered
symbol — static, blur, and Spine overlay alike — independent of cell size,
live-patched with **no Pixi rebuild**:

- `cellC` (the cell container) is already centered on the cell (`cellC.x = cellW/2`
  fixed at build, `cellC.y` recomputed per-frame as `... + cellH/2`), and the
  static/blur sprites are its children (anchored 0.5) — so scaling `cellC.scale`
  scales them correctly centered, with zero new geometry code.
- Spine land/win overlays live in a **separate `fx` layer** in absolute board
  coordinates, not children of `cellC` — `useSpineOverlay` gained a 6th `scale`
  param, applied via `inst.container.scale.set(scale)`.
- Deliberately **excluded** from `spinnerStructuralSig` (`structuralHash.js`) —
  same bucket as `cellW`/`cellH`/spacing: geometry, not topology, so a scale
  change never triggers a rebuild, and `applyRuntimeConfigs`'s existing
  setup-mode re-apply already makes the live change visible without scrubbing.
- Unity parity: `SpinnerConfigData.symbolScale`, applied at the existing
  per-frame `cell.sTr/bTr.localScale` reset and inside `DriveOverlay`.

## Negative grid spacing

`spacingX`/`spacingY` can now go negative so cells can touch or overlap —
clamped to `-(cellW-1)` / `-(cellH-1)` so the pitch (`cell + spacing`) never
drops below 1px. Nothing else in the pipeline assumed non-negative spacing: win
evaluation works in cell/strip index units (modulo, not pixel spacing), and the
geometry relayout trigger already fires generically on any spacing change.

## Bug fix: test-spin outcome dropdown was ignored

Picking "no win" in the wizard's test-spin "Result" dropdown still landed a
generic (sometimes winning) board. Root cause, three layers deep:

1. `buildSpinnerTestClips` puts `{outcome, rerollSeed}` on the stopSpin clip's
   `spinner` payload — but `normalizeSpinnerClipPayload`'s `stopSpin` branch
   returned a **fixed key set that silently dropped both fields** during
   normalization (`normalizeTrack` → `normalizeClip` → this function). By the
   time `targetBoardForClip` looked at the clip, `outcome` was already gone, so
   it fell through to a generic fallback board regardless of the dropdown.
2. That fallback (`generateNonWinningBoard`) was called **without `wildId`** —
   and since ways-win evaluation IS wild-aware, a wild-substituted win could
   leak into a supposedly "non-winning" board even when the outcome path worked.
3. Same bug class, same fix, one more spot: `normalizeSpinnerConfig`'s
   `initialBoard` regeneration.

Fixed all three (payload now carries `outcome`/`rerollSeed` through
normalization; both fallback call sites now pass `classifySymbols(config).wildId`).
Also fixed the Unity bake (`bake.js`): outcome-driven stopSpin clips previously
exported `targetBoard: null` since normalization never populated it — now
resolves a concrete board via `targetBoardForClip` at bake time when needed.

**Why existing tests didn't catch it**: the T12 outcome tests in
`spinnerEval.test.js` all fed raw clip objects directly into
`resolveSpinnerTrack`, bypassing `normalizeTrack` entirely — the exact path
where the bug lived. New tests route through `normalizeTrack` first.

## Tests

8 new tests in `spinnerEval.test.js`: normalization round-trip for
outcome/rerollSeed (plus the "closes the actual bug" regression test that goes
through `normalizeTrack`), wild-awareness sweeps (100 seeds) for both fallback
call sites, determinism, `symbolScale`/negative-spacing schema clamps, and a
`defaultSpinnerTiming()` snapshot test to catch accidental reverts.

## Files

| Area | File |
|---|---|
| Grid schema (symbolScale, negative spacing), timing defaults, outcome/wildId fixes | `engine/spinner/spinnerModel.js` |
| `symbolScale` live-patch (cellC scale, spine overlay scale param) | `engine/spinner/spinnerRuntime.js` |
| Step reorder, symbolScale state/field/threading, spacing min clamps | `components/SpinnerWizard.jsx` |
| Unity parity: `symbolScale`, timing defaults, per-frame scale, overlay scale | `unity/csharp.js` |
| Unity `configJson.symbolScale`; outcome-clip board resolution at bake time | `unity/bake.js` |
| New tests + stale comment fix | `engine/spinner/spinnerEval.test.js` |

Related: [[Spinner Design]], [[Scene Studio]], [[Session 2026-07-03 Scene Studio Direct QoL]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
