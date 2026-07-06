---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, bugfix]
---

# Session 2026-07-04 (follow-up) — real "no win" fix, animOnly blur parity, Result drives the board directly

> [!success] Shipped (2026-07-04)
> Follow-up to [[Session 2026-07-04 Scene Studio Spinner Wizard Polish]] — the
> artist reported the earlier fix didn't fully hold up in practice, in three
> distinct ways. Diagnosed with three parallel research passes before writing
> any code; the resulting brief (originally meant to hand off to a fresh
> session) is saved at `~/.claude/plans/spinner-wizard-outcome-blur-rework-prompt.md`
> but was executed in-session instead, on request. All 169 Scene Studio tests
> pass (166 → 169, three new this session).

## The real "no win" bug

The previous session's fix (clip-normalization dropping `outcome`/`rerollSeed`)
was genuinely correct — but a **second, unrelated bug** in
`generateNonWinningBoard` (`spinnerModel.js`) meant "no win" could still land a
win. Its greedy fix-up loop never re-verified its own postcondition: with the
wizard's own minimum of 2 symbols crossed with more rows, the "safe replacement"
pool could be exhausted mid-fixup, silently returning a still-winning board.
Reproduced empirically: **40% of re-rolls failed** on a 2-symbol/3×5 config
over 50 seeds; a broader sweep found 84 failing configs, all within the
wizard's allowed range but outside what the existing test fixtures covered.

Fixed with a deterministic last-resort guarantee, not a bigger retry budget: a
ways win needs its candidate symbol present *somewhere* in every reel from 0
through `WAYS_MIN_COUNT-1`. Overwriting one interior reel entirely with symbol
X and the next entirely with a *different* symbol Y caps every candidate below
the win threshold regardless of what reel 0 (or anything past that) contains —
X is absent from the Y-reel, Y is absent from the X-reel, everything else dies
at the X-reel. Works with as few as 2 non-wild symbols; the genuinely
impossible case (only 1 non-wild symbol left) now logs a warning instead of
pretending success.

New test sweeps 2–6 symbols × 3 reel counts × 3 row counts × 100 seeds each —
the exact coverage gap that let this ship.

## animOnly symbol blur — parity with regular symbols

Confirmed a real, previously self-documented shortcut: regular symbols get
their blur variant from a directional ImageMagick WASM `-motion-blur` chain
(`spinnerBlur.js`), but T7's `animOnly` symbols (no static PNG; idle texture
baked from a posed Spine frame) got Pixi's generic **isotropic** `BlurFilter`
instead — visually inconsistent, and admitted as lower quality in the original
T7 changelog entry.

Extracted `blurCanvasWasm`/`blurCanvasFallback` — low-level versions of the
existing directional-blur chain that operate on an arbitrary canvas instead of
requiring an `HTMLImageElement` pre-drawn into a cell — shared now by both the
static-symbol pipeline and `bakeSpinePoseTexture`. The animOnly bake extracts
a canvas from the exact same posed Spine frame already used for the sharp/idle
texture (`renderer.extract.canvas`), runs it through the identical
WASM-or-canvas-ghost chain, and loads the result back as a Pixi texture via
the existing `loadTexture` dependency (which already accepts `blob:` URLs).

## Result now drives the board directly

Previously `initialBoard` (what the board editor shows, what persists) and
`testOutcome`/`testRun` (what the test-spin animates to) were two entirely
disconnected mechanisms — picking "no win" never touched the board editor or
the resting preview, only the transient one-shot test-spin clip.

Now: picking a Result (or re-rolling) synchronously computes a concrete board
via `generateOutcomeBoard`/`generateWinningBoard` and writes it straight into
`initialBoard` — the board editor grid and the live preview at rest update
immediately, no spin required to see it. `Spin` (renamed from "test spin")
now carries an explicit `targetBoard` — the literal board already on
screen — instead of `outcome`/`rerollSeed`, so the animation can never land
anywhere other than what was just previewed. `buildSpinnerTestClips` gained an
optional 4th `targetBoard` parameter for this (unrelated call sites, like the
scene's persisted full-spin timeline, are unaffected). Manual per-cell edits
in the board editor still work exactly as before; they just silently stop
matching whatever Result label happens to be showing (documented in the UI
caption rather than auto-resetting the dropdown, to avoid guessing at a UX
call that wasn't specified).

## What's still unverified

The blur bake and the live-preview sync are both visual/DOM/Pixi-dependent
with no automated test harness — same limitation as the original T7 session.
No browser-automation tool was available in this environment, so none of this
was checked by actually looking at it. Flagged explicitly rather than claimed.

## Files

| Area | File |
|---|---|
| `generateNonWinningBoard` deterministic fix; `buildSpinnerTestClips` `targetBoard` param | `engine/spinner/spinnerModel.js` |
| Extracted shared `blurCanvasWasm`/`blurCanvasFallback` | `engine/spinner/spinnerBlur.js` |
| `bakeSpinePoseTexture` uses directional blur instead of `BlurFilter` | `engine/spinner/spinnerRuntime.js` |
| `applyOutcomeBoard`, Review-step rework, Spin uses explicit board | `components/SpinnerWizard.jsx` |
| 3 new tests | `engine/spinner/spinnerEval.test.js` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner Wizard Polish]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
