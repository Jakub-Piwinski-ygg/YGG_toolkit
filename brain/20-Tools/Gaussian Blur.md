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
- **Wanted**: two near-identical code paths; no guidance on modes. *(~~single-file~~ — batch shipped 2026-06-14; feather chain now shared `makeFeatherMask()`.)*

Uses the shared `makeFeatherMask()` (extracted 2026-06-14; see [[Blur]], [[Tool Review]]).

> [!bug] White edge halo (straight-alpha bleed) — open, deferred 2026-06-14
> Same as [[Blur]]: transparent white RGB bleeds through `-blur` on the feather path.
> Fix = premultiply around the blur. Pre-existing, not from the refactor.
