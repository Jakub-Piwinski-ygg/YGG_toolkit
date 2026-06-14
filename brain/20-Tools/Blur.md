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
- **Wanted**: 5 sequential Magick calls; **duplicated feather chain**; no direction preview.

> [!note] Shared infra (P0)
> The feather-mask Magick chain is duplicated here, in [[Gaussian Blur]], [[Outline]],
> and Scene Studio's `spinnerBlur.js` → extract `makeFeatherMask()`. See [[Tool Review]].
