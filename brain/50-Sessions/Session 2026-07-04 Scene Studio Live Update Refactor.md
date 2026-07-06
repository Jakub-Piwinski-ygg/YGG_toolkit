---
date: 2026-07-04
tool: Scene Studio
tags: [session, scene-studio, performance, pixi]
---

# Session 2026-07-04 — Live-update refactor (edits without full Pixi rebuilds)

English mirror of the Polish canonical entry in
`react-app/SCENE_STUDIO_PHASE_STATUS.md` ("Live-update refactor"). Full plan
with trigger inventory, decision matrix and open questions:
`~/.claude/plans/scene-studio-refactor-minimize-serene-hammock.md`.

## Problem

Too many common edits triggered the slow full `rebuildScene(...)` path —
especially in setup/authoring flow: spine layer defaults, video loop/mute,
every spinner/win-sequence wizard Apply (unconditional `rev` bump), spinner
timing drags in the wizard preview. The spinner even rebuilt **twice** per
Apply (`handleSpinnerAnimDurations` bumped `rev` again after the first build
resolved animation durations).

## What shipped (Phase 1+2 of the plan)

- **New pure module [[Scene Studio Design|engine/structuralHash.js]]** —
  `sceneStructuralParts/Hash` covers only true topology / GPU-resource
  identity: canvases + `activeCanvasId` (bugfix — switching the active canvas
  previously didn't rebuild), asset src identity (now length-aware — a 32-char
  data-URL prefix is mostly the shared mime header), spine/winseq
  atlas+texture, layer order/parentage, `spinnerStructuralSig` (grid + symbol
  set + land/win anim specs) and `winseqNumberSig` (glyph sheet:
  fontSrc/cell/cols/rows/charLayout — previously the layout fields weren't
  hashed at all). **Removed from the hash**: `JSON(layer.spine)`,
  `JSON(layer.video)`, `spinner.rev`, `winseq.rev` — wizard rev bumps are now
  rebuild-inert.
- **New `applyRuntimeConfigs(handles, scene, studioMode)` pass** in
  `engine/pixiApp.js`, called at the top of PixiViewport's cheap-path effect
  (and after a rebuild commits, to reconcile edits made during the async
  build). Reference-identity guards → zero work when nothing changed.
  Live-patches: spine defaults (full `applySpineState` re-apply in setup,
  skin-only in animate — Phase C.5 owns anim/loop there), video element
  loop/muted, spinner config swap + `resolveKey` invalidation, winseq config
  swap + `__wsCache` reset + setup-pose re-apply. Swaps are skipped when the
  structural signature differs (that edit already queued a rebuild).
- **Diagnostics**: `window.__sceneStudioDiag` (rebuilds / livePatches /
  lastRebuildMs / lastReason) + per-rebuild reason tracing via
  `diffStructuralParts` (detects pure reorders too), logged to console (dev)
  and `onDiag` (`?debug=1`).
- **Manual refresh unchanged** — the ⟳ refresh-assets button (`refreshNonce`)
  remains the only cache-bust + forced-rebuild path.

## Review round (multi-agent, 8 angles) — fixed before close

- Spinner config swap preserved the build-learned land/win anim durations
  (they only live in the built config; the wizard preview never persists them).
- Structural guard now compares against the sig the object was **built** with
  (`sp.structSig` / `ws.numSig` stamped at build) — sound even if a rebuild
  fails or is superseded.
- Clearing `defaultAnimation` while paused snap-clears the cached `__default__`
  slot (the 0.1 s fade never completes under `update(0)`).
- `defaultMix`-only edits no longer touch the skeleton (paused-pose pop).
- Re-enabling `loop` on an already-ended video restarts playback.
- SpinnerWizard: 150 ms debounce restored for **structural** fields (reel/row
  counts + symbol set) — with `rev` rebuild-inert, drag-scrubs there would
  have rebuilt per keystroke (Pixi v8 rapid-rebuild crash risk); everything
  else bypasses it.
- **Cell size + spacing are now live geometry** (user feedback): only reel/row
  COUNTS are container topology — `relayoutSpinnerGeometry` resizes the built
  board (offsets, mask, reel/cell x-positions, base bounds) in place, so
  cellW/cellH/spacingX/spacingY edits never rebuild, in the wizard or on a
  committed spinner.
- Diagnostics: rebuild reasons accumulate until a build commits; scene-identity
  fast path in `applyRuntimeConfigs`; stale "rev → rebuild" comments updated.

## Verification

- New `engine/structuralHash.test.mjs` — 17 checks (what is / isn't
  structural, signature stability, diff reasons incl. reorder).
- All engine suites green (~180 checks), `npm run build` clean.
- **TODO**: visual browser pass (spine defaults in setup, spinner timing drag
  in wizard, live winseq tier edits) — not done this session.

## Deferred (Phase 3, needs product sign-off)

Live PNG src swap, incremental layer add/remove, live reorder/reparent via
`addChildAt`. Open questions listed in the plan file (§8).
