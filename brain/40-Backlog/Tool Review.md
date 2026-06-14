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

### P0 — do first (blocks value or compounds daily)
1. **[[Scene Studio]]: ship Phase 4 web export** (PNG hero / sequence / WebM) + fix
   or contain the Pixi v8 crash. *(Unity `.unitypackage` export + Spinner Unity
   phases 2–5 already SHIPPED — see [[Spinner Unity Phase 5]].)*
2. **Art Tools shared infra** — extract `makeFeatherMask()` / `scaleImageWasm()` /
   `canvasToBlob()` + add **batch mode** to the 7 single-file tools ([[Crop]],
   [[Scaler]], [[Blur]], [[Gaussian Blur]], [[Grey to Alpha]], [[Gradient Map]],
   [[Outline]]). Small effort, multiplies across 12 tools.
3. **[[Asset Checker]]: rule presets + auto-fix suggestions.**

### P1 — next
4. **[[Atlas Packer]] JSON metadata output** (sprite rects for engines).
5. **[[Project Scaffold]]**: decompose the 848-line monolith; template
   sharing/versioning; inline rule hints.
6. **App-shell hardening**: log cap, blob/tree cache eviction
   ([[Repo Content Browser]]), prominent WASM-failure state, rejected-file feedback.
7. **Live previews** on Magick tools ([[Blur]], [[Gaussian Blur]], [[Outline]],
   [[Gradient Map]] first).

### P2 — valuable, not urgent
8. ~~Slot Machine~~ — retired; replaced by [[Spinner Design|Spinner]].
9. **Accessibility pass** (run `web-design-guidelines` — see [[Agent Skills]]): ARIA,
   focus-visible, keyboard nav, Escape handling. Shell currently has **zero** of these.
10. **[[Converter]]**: frame scrubber preview, clearer multi-frame output naming.
11. **[[Cheat Tool]]**: state validation, drift warning vs backend version.

### P3 — polish/backlog
12. Tool settings persistence (localStorage per tool); tool search in sidebar.
13. [[Gradient Map]] preset import/export; [[RGBA Mask]] combined preview;
    [[Paylines]] JSON export; [[Font Preview]] kerning; [[Char Extractor]] export file.
14. [[Templates]] search/filter + manifest auto-generation.
15. Delete dead `toolUrl.js` duplication; route SceneStudio `console.warn`s to app
    log; **refresh CLAUDE.md tool list** (done structurally by this vault — [[Tools]]).
16. ~~Resolve the duplicate `react-app/react-app/.../CHEAT_TOOL.md` path~~ — **DONE
    2026-06-14**: it was a *stranded* (not duplicate) doc; moved next to its code at
    `react-app/src/tools/CheatTool/CHEAT_TOOL.md`, empty doubled tree removed.

### P4 — nice-to-have
17. New tool ideas: trim-whitespace, sprite-sheet slicer, palette extractor, batch optimizer.
18. Light-mode theme; offline/service-worker caching of WASM.

## Cross-cutting app shell

**Good**: clean 3-context split (App / RepoBrowser / UnityExport); URL tool
persistence with aliases; blob-URL revocation; fullBleed keep-alive; lightbox.
**Bad**: zero ARIA/focus/keyboard nav; unbounded log; silent failures; dead code; no tests; no sidebar search.
