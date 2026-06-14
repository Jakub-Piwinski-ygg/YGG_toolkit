---
type: backlog
title: Tool Review
updated: 2026-06-14
source: TOOL_REVIEW.md
tags: [backlog, priority, review]
---

# Tool Review & Priority Backlog

> [!info] Canonical source
> Full per-tool review: [`TOOL_REVIEW.md`](../../TOOL_REVIEW.md). This note is the
> linked priority index — see each [[Tools|tool note]] for per-tool detail.

## Priority ranking (Jira-style)

> [!check] Verdicts re-audited against code 2026-06-14
> Several items had silently shipped. Strikethrough = confirmed done in code.

### P0 — do first (blocks value or compounds daily)
1. **[[Scene Studio]] Phase 4 web export** — ~~WebM~~ **SHIPPED 2026-06-14**
   (`engine/webmExport.js` + `WebMExportDialog` + `PixiViewport.exportWebM()`:
   deterministic 0→duration capture, native res, opaque). **Remaining: hero-frame
   PNG + PNG sequence.** ~~+ fix or contain the Pixi v8 crash~~ → **crash FIXED**
   (`pixiApp.js` `Assets.load()`; boundary kept as failsafe).
   *(Unity `.unitypackage` export + Spinner Unity phases 2–5 already SHIPPED — see
   [[Spinner Unity Phase 5]]; per-timeline path test-covered, 27 `unity/*.test.mjs` green.)*
2. ~~**Art Tools shared infra**~~ — **SHIPPED 2026-06-14**. `makeFeatherMask()` /
   `scaleImageWasm()` / `canvasToBlob()` extracted to `utils/image.js`; shared
   `utils/batch.js#makeBatchRun()` flips all 7 single-file tools to `batchMode:true`
   ([[Crop]], [[Scaler]], [[Blur]], [[Gaussian Blur]], [[Grey to Alpha]],
   [[Gradient Map]], [[Outline]]) with per-file error isolation. Build + 65 tests green.
3. ~~**[[Asset Checker]]: rule presets**~~ — **auto-fix suggestions SHIPPED**
   (`engine/suggest.js` + ReportView from→to); **presets per game type DROPPED
   2026-06-14** (not wanted; config-swap stays for ad-hoc uploads).

### P1 — next
3b. **[[Blur]] / [[Gaussian Blur]] white-halo fix** — premultiply alpha around the
    blur so transparent white RGB stops bleeding into feathered edges. Confirmed real
    2026-06-14 (pre-existing, not from the refactor); deferred by user this session.
4. **[[Atlas Packer]] JSON metadata output** (sprite rects for engines) — confirmed open (PNG only).
5. **[[Project Scaffold]]**: decompose the **771-line** monolith (confirmed, no sibling
   modules); template sharing/versioning; inline rule hints.
6. **App-shell hardening**: log cap (confirmed unbounded), blob/tree cache eviction
   ([[Repo Content Browser]] — clear-on-disconnect only), prominent WASM-failure state
   (confirmed missing), rejected-file feedback (confirmed silent).
7. **Live previews** on Magick tools ([[Blur]], [[Gaussian Blur]], [[Outline]],
   [[Gradient Map]] first) — confirmed: none have before/after preview.

### P2 — valuable, not urgent
8. ~~Slot Machine~~ — retired; replaced by [[Spinner Design|Spinner]].
9. **Accessibility pass** (run `web-design-guidelines` — see [[Agent Skills]]):
   systematic focus-visible + keyboard nav. *(Some ARIA/role + Escape already exist —
   gap-filling, not greenfield. The "zero a11y" claim was inaccurate.)*
10. **[[Converter]]**: frame scrubber **visual** preview (inputs exist, no frame preview),
    clearer multi-frame output naming.
11. **[[Cheat Tool]]**: ~~state validation~~ **SHIPPED** (`lib/validation.js` + field
    errors). Remaining: drift warning vs backend version.

### P3 — polish/backlog
12. Tool settings persistence — **partial** ([[Cheat Tool]] + [[Asset Library]] persist
    to localStorage; extend to the rest); tool search in sidebar (confirmed missing).
13. [[Gradient Map]] preset import/export; [[RGBA Mask]] combined preview;
    [[Paylines]] JSON export (confirmed `.txt` only); [[Font Preview]] kerning;
    [[Char Extractor]] **file** export (confirmed clipboard-only).
14. ~~[[Templates]] search/filter~~ **SHIPPED** (search input + `useMemo` filter).
    Remaining: manifest **auto-generation** (still hand-maintained).
15. **[[Scene Studio]] clip naming** — static-PNG clips show weird auto-names; want
    `objectName + clip N` + editable clip-name field in inspector. The only open item
    from the [[Next Phase Scene Tool]] wishlist — the rest (bezier/spline keyframes
    w/ smooth/broken/flat handles, 3-point curve editor, motion-path scale+arrows+
    click-to-seek, drag-to-canvas, overlay-mode dropdown, spacebar/arrows/Alt-scroll,
    persistence) all **SHIPPED**.
16. Delete dead `toolUrl.js` duplication (confirmed unused); route SceneStudio
    `console.warn`s to app log (18 calls); **refresh CLAUDE.md tool list** (20 tools;
    done structurally by this vault — [[Tools]]).
17. ~~Resolve the duplicate `react-app/react-app/.../CHEAT_TOOL.md` path~~ — **DONE
    2026-06-14**: it was a *stranded* (not duplicate) doc; moved next to its code at
    `react-app/src/tools/CheatTool/CHEAT_TOOL.md`, empty doubled tree removed.

### P4 — nice-to-have
18. New tool ideas: trim-whitespace, sprite-sheet slicer, palette extractor, batch optimizer.
19. Light-mode theme; offline/service-worker caching of WASM.

## Cross-cutting app shell

**Good**: clean 3-context split (App / RepoBrowser / UnityExport); URL tool
persistence with aliases; blob-URL revocation; fullBleed keep-alive; lightbox.
**Bad** *(re-audited 2026-06-14)*: **minimal** (not zero) a11y — scattered
`aria-label`/`role`/Escape, but no systematic focus-visible or keyboard nav;
unbounded log; silent failures (no WASM-fail UI, rejected files dropped silently);
dead `toolUrl.js`; no app-level tests; no sidebar search; RepoBrowser caches
clear only on disconnect (no eviction).
