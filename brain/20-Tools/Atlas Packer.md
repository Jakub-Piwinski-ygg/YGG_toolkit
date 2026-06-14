---
type: tool
tool: Atlas Packer
category: 🎨 Art
status: shipped
priority: P1
updated: 2026-06-14
tags: [art-tool, wasm, atlas]
---

# Atlas Packer

Grid/tile mode, pre-scaling with filters, size caps. Source: `AtlasPackerTool.jsx` (183 L).

- **Good**: grid + tile modes; pre-scale with filters; size caps + logging.
- **Wanted**: **no JSON metadata output for engines** (top wanted — P1 in [[Tool Review]]); no bin-packing; silently clips overflow sprites.

Shares the scale-call pattern with [[Scaler]] → `scaleImageWasm()`.
