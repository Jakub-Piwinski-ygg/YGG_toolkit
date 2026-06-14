---
type: session
category: 🗂️ Cross-cutting
status: complete
updated: 2026-06-14
lang: en
tags: [session, audit, art-tools, scene-studio, backlog]
---

# Session 2026-06-14 — backlog audit + P0 (WebM export, Art-Tools infra)

> [!info] Scope
> Re-audited the stale [[Tool Review]] backlog against actual code, then shipped
> both remaining P0 items (minus the dropped Asset Checker presets). Working tree
> only — not committed at session end.

## 1. Backlog re-audit (verdicts corrected in [[Tool Review]] + per-tool notes)

Many items had silently shipped or were mis-stated. Corrected:

- **Pixi v8 rapid-rebuild crash** → actually **FIXED** (`pixiApp.js` `Assets.load()`),
  not just contained; `PixiErrorBoundary` kept as a failsafe.
- **[[Asset Checker]] auto-fix suggestions** → **SHIPPED** (`engine/suggest.js` + ReportView).
- **[[Templates]] search/filter** → **SHIPPED**. **[[Cheat Tool]] state validation** → **SHIPPED**.
- **[[Next Phase Scene Tool|Animator wishlist]]** → almost all SHIPPED (bezier/spline
  tangents smooth/broken/flat, 3-point curve editor, motion-path scale+arrows+click-seek,
  drag-to-canvas, overlay-mode dropdown, spacebar/arrows/Alt-scroll, persistence). Only
  **editable/auto clip naming** for static-PNG clips remains.
- Accuracy fixes: "zero a11y" → **minimal** (some ARIA/role/Escape exist); Project
  Scaffold **771** lines (not 848); registry is **20 tools** (12 Art / 6 Asset Pipeline
  incl. **Asset Library** / 1 Scene Studio / 1 Cheets) — CLAUDE.md counts fixed.

## 2. P0 shipped

- **A — [[Scene Studio]] WebM export** (WebM only, opaque, deterministic). See
  [[Scene Studio Phase Status]] "Phase 4 — WebM export". User-verified in browser.
- **B — Art-Tools shared infra + batch mode.** Extracted `makeFeatherMask()` /
  `scaleImageWasm()` / `canvasToBlob()` → `utils/image.js`; new `utils/batch.js#makeBatchRun()`;
  all 7 single-file tools flipped to `batchMode:true` ([[Crop]], [[Scaler]], [[Blur]],
  [[Gaussian Blur]], [[Grey to Alpha]], [[Gradient Map]], [[Outline]]). Build + 65
  SceneStudio tests green. User-verified resize batch.

## 3. Decisions

- **Asset Checker rule presets — DROPPED** (not wanted). Auto-fix already shipped;
  config-swap stays for ad-hoc uploads.
- **WebM scope** = opaque + deterministic only (no alpha; PNG/PNG-sequence deferred).

## 4. New known bug (deferred by user)

- **[[Blur]] / [[Gaussian Blur]] white edge halo** — straight-alpha bleed: transparent
  white RGB leaks through `-motion-blur`/`-blur`. **Pre-existing, NOT from the B
  refactor** (Magick arg chain byte-identical). Fix = premultiply around the blur.
  Tracked in [[Tool Review]] (Known bugs + P1 item 3b).

## 5. Next

P1: blur white-halo fix (3b), Atlas Packer JSON metadata, Project Scaffold
decomposition, app-shell hardening, live Magick previews. Plus the deferred
hero-PNG / PNG-sequence Scene Studio exporters.
