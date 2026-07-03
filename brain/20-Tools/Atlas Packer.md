---
type: tool
tool: Atlas Packer
category: 🎨 Art
status: shipped
priority: P1
updated: 2026-07-02
tags: [art-tool, wasm, atlas]
---

# Atlas Packer

Grid/tile/**winfont** mode, pre-scaling with filters, size caps. Source: `AtlasPackerTool.jsx` + `atlasWinFont.js`.

- **Good**: grid + tile modes; pre-scale with filters; size caps + logging.
- **Win Font mode** (added 2026-07-02): for artists who deliver win-number characters as individual sprites instead of a pre-built atlas. Auto-maps each loaded PNG to its cell in the Scene Studio win-number layout (`DEFAULT_CHAR_LAYOUT` in `winNumberModel.js` — 8 cols row-major, 256px cells) by filename (single char, word aliases like `dollar`/`comma`, or `font_0.png`-style prefixes), with a manual override dropdown per file for anything unmatched or ambiguous (`k`/`K` case sensitivity, duplicates). A trim option shrinks the output to only the rows actually used (e.g. digits-only → 2048×512) since [[Scene Studio]]'s glyph slicer only reads `cols`+`cell`, never `rows`.
- **Wanted**: **no JSON metadata output for engines** (top wanted — P1 in [[Tool Review]]); no bin-packing; silently clips overflow sprites (grid/tile modes).

Shares the scale-call pattern with [[Scaler]] → `scaleImageWasm()`. Win Font mode is a consumer of [[Scene Studio]]'s win-number model, not the other way around — `atlasWinFont.js` imports `DEFAULT_CHAR_LAYOUT` directly so the layout is never duplicated.
