---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, performance, bugfix]
---

# Session 2026-07-04 (round 4) — fix animOnly blur performance regression, real persisted sigma/feather

> [!success] Shipped (2026-07-04)
> Follow-up to [[Session 2026-07-04 Scene Studio Spinner Wizard UX Polish]].
> The artist reported two problems: the blur/sigma/feather panel doesn't
> appear at all when working with animation-only symbols, and the preview
> takes multiple seconds to render after "fill from animations". The second
> one is a genuine performance regression introduced earlier the same day.

## The regression

Round 2's fix for animOnly symbol blur quality (see
[[Session 2026-07-04 Scene Studio Spinner Outcome and Blur Fixes]]) replaced
a cheap Pixi `BlurFilter` with the proper directional WASM motion-blur
chain — but ran it **synchronously, inline, in the middle of scene
construction**. That chain is 5 separate `window._Magick.Call()` round-trips
per symbol; a handful of animOnly symbols could block the entire scene from
appearing for multiple seconds. Visual correctness improved; responsiveness
regressed. Neither was caught because there's no automated test harness for
this DOM/Pixi/WASM-dependent code, and no browser-automation tool was
available to notice it by eye before the artist did.

## The fix

`bakeSpinePoseTexture` (`spinnerRuntime.js`) split into two phases:

1. **`bakeSpinePoseSharpTexture`** — cheap, blocking: pose the Spine
   instance, capture the sharp texture via `renderer.generateTexture`, plus
   a raw canvas via `renderer.extract.canvas` for the blur pass. No WASM.
2. **`queueBlurBake`** — the actual directional blur, dispatched onto a
   single **shared, strictly-sequential** module-level promise queue and
   never awaited by the caller. `buildSpinnerObject` sets `{ tex: sharp,
   blurTex: sharp }` immediately (a perfectly reasonable stand-in — blur only
   matters during actual spin motion, not at rest) and lets the scene render
   right away; the queue swaps in the real `blurTex` once ready by mutating
   the same `textures` Map the per-frame render loop already reads live, so
   no rebuild is needed to pick it up.

Why a *queue* and not `Promise.all` for genuine parallelism: every
ImageMagick WASM call in this app (not just this one) writes to fixed,
shared temp filenames — concurrent calls could clobber each other's files
mid-flight. No code in the codebase has ever called `_Magick.Call`
concurrently, and there's no way to verify the underlying library's
filesystem isolation model without a working browser session, so introducing
first-of-its-kind concurrency here was judged too risky. A queue gets the
actual goal (don't block the caller) without that risk — bakes still happen
one at a time, just off the critical path.

## Real, persisted blur settings

The prior round's sigma/feather sliders only ever affected the wizard's
"fill missing blurs" button — which does nothing for a symbol with no static
PNG. Added `blur.sigma`/`blur.feather` to the spinner config schema
(`defaultSpinnerBlur`, `normalizeSpinnerConfig` in `spinnerModel.js`), shared
by **both** blur mechanisms: the wizard's static-symbol PNG generation and
the animOnly runtime bake (`bakeSpinePoseTexture` now reads
`config.blur.sigma`/`.feather` instead of hardcoded constants). Removed the
separate, non-persisted `blurSigma`/`blurFeather` wizard state entirely —
the sliders now edit `blur.sigma`/`blur.feather` directly via the existing
`patchBlur`, so there's one source of truth instead of two similarly-named
but disconnected values. The panel showing these sliders is no longer gated
on "has a static PNG" — it shows for any symbol set, with the
static-only buttons (fill missing / regenerate all) hidden when irrelevant.

## What's still unverified

Same limitation as every prior round touching this code: no browser to
actually look at. Please check that animOnly symbols render near-instantly
now, with blur visibly "catching up" a moment later without stuttering, and
that the sigma/feather sliders visibly affect that runtime bake.

## Files

| Area | File |
|---|---|
| `blur.sigma`/`blur.feather` schema | `engine/spinner/spinnerModel.js` |
| `bakeSpinePoseTexture` → sharp bake (blocking) + `queueBlurBake` (background) | `engine/spinner/spinnerRuntime.js` |
| Removed local `blurSigma`/`blurFeather` state; panel visibility for any symbol | `components/SpinnerWizard.jsx` |
| 1 new schema test | `engine/spinner/spinnerEval.test.js` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner Wizard UX Polish]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
