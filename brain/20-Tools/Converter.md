---
type: tool
tool: Converter
category: 🎨 Art
status: shipped
priority: P2
updated: 2026-06-14
tags: [art-tool, wasm, video]
---

# Converter

Format converter + video frame extraction (WebP/PNG…). Source: `ConverterTool.jsx` (339 L).

- **Good**: video frame extraction (time/index/range); quality + lossless controls; good progress labels.
- **Wanted**: no frame scrubber/preview; seek reliability epsilon-fragile; output labeling unclear for multi-frame (P2 in [[Tool Review]]).

Implements the [[Runner Registry Pattern]].
