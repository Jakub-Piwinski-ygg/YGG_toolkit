---
type: tool
tool: Scaler
category: 🎨 Art
status: shipped
updated: 2026-06-14
tags: [art-tool, wasm]
---

# Scaler (Image Scaler)

8 filter algorithms via WASM ImageMagick. Source: `ScalerTool.jsx` (112 L).

- **Good**: 8 filters with descriptions; two modes.
- **Wanted**: no aspect lock; uniform-only scaling. *(~~no batch~~ — batch shipped 2026-06-14; scale call now uses shared `scaleImageWasm()`.)*

Shares a scale-call pattern with [[Atlas Packer]] → extract `scaleImageWasm()`
(see [[Tool Review]] P0). Implements the [[Runner Registry Pattern]]. See [[Gotchas]].
