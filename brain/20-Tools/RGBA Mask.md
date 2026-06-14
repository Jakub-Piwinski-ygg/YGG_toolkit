---
type: tool
tool: RGBA Mask
category: 🎨 Art
status: shipped
updated: 2026-06-14
tags: [art-tool, wasm, alpha]
---

# RGBA Mask Combiner

4 slots, live preview thumbs, Rec.709 luma. Source: `RgbaMaskTool.jsx` (157 L).

- **Good**: color-coded slots + thumbs; Rec.709 luma; fill defaults.
- **Wanted**: no combined-result preview; fixed channel order; PNG-only.

> [!warning] Alpha integrity
> Feed raw bytes to ImageMagick with `rgba:` — do not round-trip through canvas
> (it premultiplies alpha). See [[Gotchas]].
