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

# Session 2026-07-04 (round 5) — two more blur bugs: wizard image loading, animOnly canvas extraction

> [!success] Shipped (2026-07-04)
> Follow-up to [[Session 2026-07-04 Scene Studio Spinner AnimOnly Blur Perf Fix]].
> The artist reported still no blur at all for animation-only symbols, and
> the wizard's "fill missing blurs" button showing progress but never
> producing a visible blur thumbnail — even simple filename-based "match
> blur" didn't help, pointing at something upstream of blur quality itself.

## Real, pre-existing bug in `generateBlurs`

Assets scanned from the project folder (`browserPool`, tagged
`_fromBrowser`) carry a raw relative filesystem path as `src` — not a
loadable browser URL. `generateBlurs` assigned that path directly to an
`<img>` element's `src`, which silently fails to load (`onerror` fires,
caught, logged as a warning) — the progress bar still completes normally
since the loop just moves on, giving the appearance of success with zero
output. `SymbolThumb` (the existing per-symbol preview) already solves this
correctly via `resolveAssetFile(src, rootHandle)` + `URL.createObjectURL`;
`generateBlurs` now does the same before decoding the image. This bug
predates today's sessions — it's not a regression from anything touched
today, but it sits squarely on the blur-generation path that's been under
repair all day.

## Hardened animOnly blur canvas extraction

`bakeSpinePoseSharpTexture` extracted the blur-bake source canvas via
`deps.renderer.extract.canvas(inst.container)` — the raw, off-stage,
un-parented Spine container. Switched to extracting from the `sharp`
**texture** already produced by `generateTexture` on that same container
instead (`extract.canvas(sharp)`) — a texture has unambiguous dimensions,
whereas an arbitrary un-attached container's bounds for a different Pixi
subsystem's extraction path are less certain to resolve consistently. Not
confirmed as the actual root cause of "no blur at all" for animOnly symbols
(no way to verify without a browser), but a strictly safer choice either way.

## What's still unverified

Same as every prior round today: no browser-automation tool, so none of this
has actually been watched running. If animOnly blur is still missing after
this, check the browser console for `[SceneStudio] spinner idle-pose blur
bake failed` — `queueBlurBake`'s `.catch` logs every failure there, which
would narrow down whether the extraction, the WASM chain, or the texture
load-back is the remaining culprit.

## Files

| Area | File |
|---|---|
| `generateBlurs` resolves `src` via `resolveAssetFile` for non-scene assets | `components/SpinnerWizard.jsx` |
| Blur-bake canvas extracted from the sharp Texture, not the raw container | `engine/spinner/spinnerRuntime.js` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner AnimOnly Blur Perf Fix]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
