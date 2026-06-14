---
type: architecture
title: Gotchas
updated: 2026-06-14
tags: [architecture, pitfalls, wasm, canvas]
---

# Gotchas (hard-won)

## React version

1. **Settings state lives in components, not context.** Keep a `settingsRef`
   synced every render to feed fresh values to the registered runner without
   re-registering. See [[Runner Registry Pattern]].
2. **WASM import is async, not bundled.** Magick is fetched from CDN at runtime
   (avoid shipping 2+ MB). Wait for `magickReady` before allowing RUN.
3. **Keep File objects alive during async ops.** Store both the `File` (for
   `.arrayBuffer()`) and a blob URL (for preview `<img>`); don't discard until the
   tool finishes.
4. **AnimatePresence needs a stable `key`** or exit animations won't play.

## Original / WASM-shared

1. **ArrayBuffer detachment.** `_Magick.Call` *transfers* the input ArrayBuffer —
   it's detached/zero-length afterwards. For 2+ WASM calls on the same source,
   `.slice()` it first: `new Uint8Array(original.buffer.slice(0))`.
2. **`wasm-imagemagick` import syntax** — CDN exposes named exports:
   `import * as Magick from '.../magickApi.js'` (not `import Magick from …`).
3. **Canvas premultiplies alpha — avoid it for output.** `getImageData` /
   `putImageData` corrupt straight-alpha pixels. For RGBA workflows (RGBA mask,
   grey→alpha, gradient map) feed raw bytes to ImageMagick with `rgba:`. Canvas is
   fine for *reading* source and *displaying* previews, not for output.
4. **Private repo media needs JS fetch + blob URL** — see [[Repo Browser]].
5. **Audio element layout differs cross-browser** — Sound Browser sets explicit
   dimensions; don't simplify them away.

Related: [[React App]] · [[Original index.html]]
