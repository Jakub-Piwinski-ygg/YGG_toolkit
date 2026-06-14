---
type: architecture
title: Original index.html
updated: 2026-06-14
tags: [architecture, legacy, reference]
---

# Original `index.html` (legacy reference)

Single ~4100-line HTML file, zero dependencies, runs from `file://`. Kept as a
deliberate reference during the React port — **do NOT modify except to fix bugs
that block current use**.

- All logic lives in inline `<script>` blocks. No bundler, no package.json, no
  node_modules, no `npm run anything`.
- The ONE exception is the wasm-imagemagick loader at the bottom, which must be
  `<script type="module">` for `import * as`.

## Line-range map (jump directly)

| Lines | Block |
|---|---|
| 1–380 | `<head>`: CSS, DOM skeleton |
| 382–398 | Global `state`, Content Browser `_cb`, event bus (`on`/`emit`) |
| 401–542 | `core/ui.js` — log, renderFileList, renderResults, restartToolkit |
| 545–630 | `tools/crop.js` |
| 632–670 | `tools/blur.js` |
| 672–778 | `tools/gaussblur.js` |
| 780–806 | `tools/webp.js` |
| 808–888 | `tools/rgba.js` |
| 890–1146 | `tools/fontpreview.js` (mirrors `ImageText.cs`) |
| 1148–1683 | `tools/slotmachine.js` (retired — see [[Spinner Design]]) |
| 1685–1744 | `tools/greyalpha.js` |
| 1746–1827 | `tools/scaler.js` |
| 1829–2043 | `tools/paylines.js` |
| 2045–2323 | `tools/gradientmap.js` + descriptor |
| 2325–3329 | `shared/repo-browser.js` — see [[Repo Browser]] |
| 3331–3434 | `tools/soundbrowser.js` |
| 3436–3584 | `tools/artbrowser.js` |
| 3586–3722 | `tools/atlas.js` |
| 3724–3874 | `app.js` — TOOLS assembly, sidebar build, run dispatch |
| 3877–3886 | WASM loader (`<script type="module">`) |

> [!danger] Script order is critical
> Every `const ToolX = {…}` block MUST appear BEFORE the `app.js` block, or
> `TOOLS` initialization throws `ReferenceError`. Don't add new tool scripts after
> `app.js`.

The tool descriptor pattern (`meta` / `settingsHTML` / `outName` / `run`) is the
ancestor of the React [[Runner Registry Pattern]]. See [[Gotchas]] for WASM/canvas
pitfalls that still apply.
