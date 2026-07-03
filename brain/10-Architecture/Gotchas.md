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
5. **Never clamp/coerce numeric inputs while the user is typing** (rule added
   2026-07-02). No `onChange(clamp(v))` per keystroke, no rewriting the field
   text mid-edit — typing "1" on the way to "20" must not snap to `min`. Keep
   raw text local; parse + clamp + commit on **Enter/blur** (Esc = revert).
   Live-preview fields propagate only when the text parses in-range, and still
   never touch the user's text. Use the shared field (`DragNumberField` /
   `NumberField`), not bare `<input type="number">` with inline `Math.max/min`.
   See [[Plan 2026-07]] item B2 for the migration of existing offenders.
6. **UI scale uses CSS `zoom` on #root — pointer math must divide by it**
   (added 2026-07-02, [[Plan 2026-07]] M1). Under `zoom`, an element's
   `getBoundingClientRect()` reports VISUAL (zoomed) px while layout metrics
   (`offsetWidth`, `scrollLeft`, CSS `left`, px-per-second constants) stay
   UNzoomed. Any handler mapping a pointer `clientX/Y` into layout/content
   space by mixing `clientX - rect.left` (or a `clientX` delta) with a layout
   constant is offset by the scale factor. **Immune pattern**: normalise by the
   same rect — `(clientX-rect.left)/rect.width` (fraction) — the zoom cancels
   (curve editors, clip-graph, hierarchy drop-zones do this). **Broken pattern**:
   `(clientX-rect.left) + scrollLeft`, `delta/pxPerSec`, `base + delta` for
   panel sizes. Fix: divide the pointer term by `elementZoom(el)` /`rootZoom()`
   (`utils/domZoom.js`) — a no-op at scale 1, self-measuring, so it corrects
   only when there's an actual discrepancy. Pixi canvas hit-testing is fine
   because it measures the canvas rect consistently on both sizing and input.
   **Sub-gotcha (canvas sizing under zoom)**: Pixi `autoDensity` rewrites
   `canvas.style.width/height` to px on every `renderer.resize()`, using the
   ALREADY-zoomed `getBoundingClientRect()` — so CSS `zoom` scales it a second
   time. At scale < 1 the canvas ends up smaller than its host and the stage's
   right/bottom edge stops rendering (empty checkerboard). Fix: re-assert
   `canvas.style.width='100%'; height='100%'` after every resize
   (`pixiApp.js resizeRenderer`) — the backing buffer stays correctly sized.
7. **`rebuildScene` must build hidden layers too** (added 2026-07-02). It used to
   `if (!layer.visible) return` — skipping the whole invisible subtree — so a
   layer created hidden (e.g. a Scene-Setup mode group) had NO Pixi object and
   toggling its visibility later showed nothing until a full rebuild. Now it
   builds every layer and just sets `obj.visible = layer.visible`, so the cheap
   visibility toggle works live. Corollary: hit-testing must check EFFECTIVE
   visibility (walk ancestors) — an object hidden by its parent still has its own
   `.visible === true` (`viewportController isEffectivelyVisible`).

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
