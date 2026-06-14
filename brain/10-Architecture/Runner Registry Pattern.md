---
type: architecture
title: Runner Registry Pattern
updated: 2026-06-14
tags: [architecture, react, pattern]
---

# Runner Registry Pattern

Tools register an imperative `run` function on mount via
`registerRunner(id, { outName, run })`. The [[React App|ToolPanel]] queries the
runner when **RUN** is clicked. **No tool imports needed in the shell** — the
registry is the only coupling point.

```jsx
useEffect(() => {
  registerRunner(webpMeta.id, {
    outName: (name) => name.replace(/\.png$/i, '') + '.webp',
    run: async (_uint8, _name, file) => { /* return Blob */ }
  });
  return () => registerRunner(webpMeta.id, null);
}, [registerRunner]);
```

## Adding a tool (checklist)

1. Create `src/tools/NewTool.jsx` with `meta` + `Component` + `useEffect` runner.
2. Add to `registry.js` → the right category array (`ART` / `REVIEW` / `STUDIO` / `CHEETS`).
3. Import nothing in `App.jsx` — registry is the only coupling point.

## meta flags

| Flag | Effect |
|---|---|
| `needsMagick: true` | disables RUN until WASM ready |
| `batchMode: true` | runner called once with all files (`run(null, null, null, allFiles)`) |
| `needsFiles: false` | RUN not gated on input files (Paylines, Content Browser) |

> [!tip] Settings live in components, not context
> ToolPanel runs the tool but doesn't own its settings. Each tool component
> manages its own `useState` and keeps a `settingsRef` synced every render to pass
> fresh values to the registered runner without re-registering. See [[Gotchas]].

Related: [[React App]] · [[Tools]]
