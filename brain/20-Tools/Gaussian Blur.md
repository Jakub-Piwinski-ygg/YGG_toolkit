---
type: tool
tool: Gaussian Blur
category: 🎨 Art
status: shipped
updated: 2026-06-14
tags: [art-tool, wasm]
---

# Gaussian Blur

Keep/blur alpha modes, feather. Source: `GaussianBlurTool.jsx` (154 L).

- **Good**: keep/blur alpha modes; feather.
- **Wanted**: two near-identical code paths (L32–75 vs L77–112); no guidance on modes; single-file (no batch).

Shares the duplicated feather chain → `makeFeatherMask()` (see [[Blur]], [[Tool Review]] P0).
