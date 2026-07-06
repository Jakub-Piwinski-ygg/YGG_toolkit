---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, performance]
---

# Session 2026-07-04 (round 6) — static-symbol blur generation speedup: downsample before blurring

> [!success] Shipped (2026-07-04)
> Follow-up to [[Session 2026-07-04 Scene Studio Spinner Blur Loading Bugs]].
> Blur generation now actually loads and works, but is slow — the artist
> asked to downsample (~4x) before running the blur, then display at correct
> size in the spinner to compensate.

## The idea

The WASM directional-blur chain (`spinnerBlur.js`) is 5 separate ImageMagick
calls, each paying for PNG encode/decode plus the actual computation — all
roughly proportional to pixel count. Blurring at 1/4 resolution in each
dimension is 16x fewer pixels through the entire chain, and a motion-streak
blur has no fine detail to lose — nobody can tell the difference once it's
scaled back up.

## Implementation

- **Generation** (`spinnerBlur.js`): `makeBlurredSymbolWasm`/
  `makeBlurredSymbolCanvas` downsample the rendered cell canvas via a new
  `downsampleCanvas` helper (`BLUR_DOWNSAMPLE = 4`) before handing it to
  `blurCanvasWasm`/`blurCanvasFallback`. `sigma`/`feather` scale down
  proportionally too — they're pixel radii, so blurring at 1/4 size with the
  same sigma would look 4x stronger relative to the image once scaled back
  up. The output blob is returned at the downsampled size — **no re-upsample
  in the generator**, to keep the whole point of the optimization (fewer
  pixels through every remaining step).
- **Display compensation** (`spinnerRuntime.js`): the blur sprite's scale
  used to be hardcoded to match the static sprite's (both at native 1:1).
  Now computed from the *actual* texture dimensions — `tex.width /
  blurTex.width` (and height) — read at texture-swap time. This is fully
  backward compatible: existing full-size blur PNGs and animOnly's
  same-resolution runtime bake both naturally get a ratio of 1 (no visual
  change), while the new downsampled blur PNGs get scaled up to match.
- **Unity export parity** (`csharp.js`) — this genuinely would have broken
  Unity builds without a fix, since both render paths there size symbols at
  native pixel resolution (§B convention), same as web:
  - UI (`Image`) variant: `SetNativeSize` used to size the blur cell's
    `RectTransform` from the blur sprite's *own* dimensions — now sized from
    the *static* sprite's dimensions instead, so `preserveAspect=false`
    stretches the smaller blur texture to fill the correct footprint.
  - World (`SpriteRenderer`) variant: added `CellView.blurScaleX/Y` fields,
    computed as `staticSprite.rect.width/height` ÷ `blurSprite`'s at
    texture-swap time, multiplied into `bTr.localScale` every frame
    alongside `symbolScale`. Defaults to 1 (no-op) for the UI variant, which
    never touches these fields.

## What's still unverified

`spinnerBlur.js` is DOM/canvas-dependent with zero test coverage (as always
for this file); the `csharp.js` changes are generated-C#-as-string-template
edits with no way to compile or run in Unity from here. **Nothing in this
round has been visually or timing-verified** — please confirm blur
generation is actually faster, and that the result still looks right at 4x
upscale (30×30 source from a 120×120 default cell is a real resolution
drop, though motion blur has no sharp edges to alias).

## Files

| Area | File |
|---|---|
| Downsample before blur, proportional sigma/feather | `engine/spinner/spinnerBlur.js` |
| Blur sprite scale from actual texture-size ratio | `engine/spinner/spinnerRuntime.js` |
| UI: size blur cell from static sprite; World: `blurScaleX/Y` | `unity/csharp.js` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner Blur Loading Bugs]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
