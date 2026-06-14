---
type: tool
tool: Blur
category: 🎨 Art
status: shipped
updated: 2026-06-14
tags: [art-tool, wasm]
---

# Blur (Directional Motion Blur)

5-step WASM pipeline, bidirectional, edge feather, angle slider. Source: `BlurTool.jsx` (141 L).

- **Good**: bidirectional; edge feather; angle slider.
- **Wanted**: 5 sequential Magick calls; no direction preview. *(~~duplicated feather chain~~, ~~single-file~~ — both fixed 2026-06-14.)*

> [!bug] White edge halo (straight-alpha bleed) — open, deferred 2026-06-14
> PNGs with white RGB in transparent regions (alpha 0, RGB 255,255,255) leak white
> through `-motion-blur` (RGB blends independently of alpha) → white fringe on
> feathered edges. **Pre-existing — NOT from the batch/`makeFeatherMask` refactor**
> (arg chain byte-identical). Fix: premultiply RGB×alpha before blur, un-premultiply
> after. Same issue on [[Gaussian Blur]]'s feather path. See [[Tool Review]] Known bugs.

> [!done] Shared infra (P0) — SHIPPED 2026-06-14
> The feather-mask chain is now `utils/image.js#makeFeatherMask()`, shared by this
> tool, [[Gaussian Blur]] and Scene Studio's `spinnerBlur.js`. (Outline uses its own
> morphology chain, not this one.) Batch mode via `utils/batch.js`. See [[Tool Review]].
