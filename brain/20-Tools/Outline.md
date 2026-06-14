---
type: tool
tool: Outline
category: 🎨 Art
status: shipped
updated: 2026-06-14
tags: [art-tool, wasm]
---

# Outline / Stroke

True morphological outline (outside/center/inside), 3 kernel shapes, canvas-expand.
Source: `OutlineTool.jsx` (196 L).

- **Good**: true morphological outline; 3 kernels; canvas-expand.
- **Wanted**: 6+ sequential Magick calls (slow); **duplicated mask chain**; no preview.

Shares the feather/mask chain → `makeFeatherMask()` (see [[Blur]], [[Tool Review]] P0).
