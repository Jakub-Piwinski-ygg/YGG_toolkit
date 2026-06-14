---
type: architecture
title: React App
updated: 2026-06-14
tags: [architecture, react, vite]
---

# React App (primary)

Vite + React 18 + Framer Motion. Modular components, dev server + GitHub Pages
deployment. **20 tools across 4 categories** (see [[Tools]]).

## Project structure

```
react-app/
├── package.json            # Vite + React + Framer Motion
├── vite.config.js          # base: './' (→ '/YGG_toolkit/' for GH Pages subpath)
├── index.html              # Vite entry
└── src/
    ├── main.jsx            # React root
    ├── App.jsx             # Layout: Header + Sidebar + ToolPanel + OutputPanel
    ├── context/AppContext.jsx     # Shared state (files, log, tool, magick ready)
    ├── hooks/useMagick.js         # WASM loader (CDN import)
    ├── components/         # Header, Sidebar, Dropzone, FileList, ToolTabs,
    │                       #   ToolPanel, OutputLog, ResultsGrid, DownloadBar, WasmBadge
    ├── tools/              # registry.js + one module per tool (see [[Tools]])
    ├── styles/             # tokens.css, base.css, components.css
    └── utils/              # download.js, image.js (getImageDimensions, freshBytes)
```

## Dev server

```bash
cd react-app
npm install
npm run dev        # Vite dev server on localhost:5173
npm run build      # Production build → dist/
```

## GitHub Pages deploy

1. `npm run build`
2. Copy `dist/*` to repo root
3. Push to `main`
4. Settings → Pages → Deploy from branch: main, folder: root
5. Update `vite.config.js` → `base: '/YGG_toolkit/'` before building for subpath

## Key design patterns

- [[Runner Registry Pattern]] — imperative `run` registration, no tool imports in the shell.
- **meta flags** (ToolPanel dispatch): `needsMagick`, `batchMode`, `needsFiles`; a runner returning `null` is safe.
- **Animation** — Framer Motion for tab switches, result-card reveals, button taps.

## What NOT to do

- Don't import tools directly in components — use the [[Runner Registry Pattern]].
- Don't store settings in context — let tools own their state.
- Don't make WASM calls before `magickReady`.
- Don't assume blob URLs persist after unmount — store both File and URL, revoke on removal.
- Don't skip `useEffect` cleanup in tool runners.

See [[Gotchas]] for the full pitfall list.
