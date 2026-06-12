# YGG Toolkit — tool review & priority backlog (2026-06-10)

Code review of every tool in `react-app/src/`, with strengths, weaknesses, and
expansion ideas per tool, followed by a Jira-style priority ranking (P0…P4).
Informed by the installed agent skills (see `SKILLS.md`): React best practices,
frontend/web design guidelines, Framer Motion, ImageMagick, web performance.

> **Note**: `CLAUDE.md` only documents 13 art tools. The actual registry
> (`src/tools/registry.js`) has **20 tools across 4 categories** — Art Tools 🎨,
> Asset Pipeline 🏗️, Scene Studio 🎬, Cheets 🎲. CLAUDE.md needs a refresh
> (tracked in P3 below).

---

## ⭐ Focus area 1 — Scene Studio (`tools/SceneStudio/`, ~7K lines)

Pixi v8 compositor/animator: layer hierarchy, 5 keyframe channels with
cubic-bezier curves, auto-key, timeline + flow interpreter (wait/signal/emit),
motion-path overlay, Spine + video layers, FS Access persistence, undo/redo.

**Good**
1. Feature depth rivals desktop tools — auto-key, curve editor, motion-path visualization are rare in browser apps.
2. Clean separation: `sceneModel.js` (schema+validator), `keyframes.js`, `flowInterpreter.js`, `pixiApp.js`.
3. Spine + video layer support covers the team's real formats.
4. Local-only FS Access persistence with Firefox fallback; undo/redo session store.

**Bad / wanted**
1. **Phase 4 export not shipped** — no PNG sequence / WebM export, so work can't leave the tool. Single biggest gap.
2. Known Pixi v8 crash on rapid add+rebuild of large PNGs (worked around with PixiErrorBoundary, not fixed).
3. Filters defined but not wired to UI; loop marker in flow spec but unimplemented.
4. 7K lines with sparse inline docs — steep onboarding for a second contributor; no tests on the keyframe/flow math (pure functions, ideal test targets).
5. `console.warn` scattered instead of routed to the app log.

### Phase 4.2 (planned) — Unity package export

Export the composed scene as a **`.unitypackage`** (gzipped tar of assets +
`.meta` files with serialized importer settings). Reuse the existing GUID
groundwork (commit "Add JSON GUID"), `UnityExportContext`, and the Asset
Checker's Unity-tree ZIP export.

1. **Assets in correct Unity scaffold** — package folder layout follows the Unity-specific scaffold defined by Project Scaffold / Asset Checker (single source of truth; reuse its tree + rename rules).
2. **Correct import settings via generated `.meta` files**:
   - Spine PNGs: straight alpha (`alphaIsTransparency`), texture settings appropriate for the spine-unity runtime; ship raw `.json`/`.atlas`/`.png` triplets so spine-unity generates SkeletonDataAssets on import.
   - Static PNGs: Sprite (Single), **no compression** by default unless overridden.
   - **Export-settings menu**: per-item / per-category overrides (e.g. background statics compressed, symbols uncompressed) — persisted in `UnityExportContext`.
3. **Animation → Unity Timeline**: translate Scene Studio's timeline (keyframed transforms of static objects AND chained/layered Spine animation clips) into a Unity Timeline asset (`.playable` YAML) — Activation/Animation tracks for statics, Spine animation tracks for skeletons. The models map closely (clips → TimelineClips, bezier channels → AnimationCurves), so translation is mostly 1:1.
4. **Prefab per canvas** (scene == one canvas today; design for multiple later, with sequential multi-timeline playback as a future step): all spines + statics placed at their Scene Studio default positions.
   - UI-canvas variant: `UnityEngine.UI.Image` for statics + `SkeletonGraphic` for spines.
   - World variant (export option): `SpriteRenderer` for statics + `SkeletonAnimation` from the spine 2D runtime.
5. **Scaffolded MonoBehaviour**: a small generated C# script on the prefab root with a `PlayableDirector` reference and an inspector button to play the (currently single) timeline for testing — Unity animation/Timeline systems only, no custom tweening; custom code only where a Scene Studio behavior can't be expressed in Timeline.

---

## ⭐ Focus area 2 — Asset Checker (`tools/AssetChecker/`, ~358 lines + engine)

7 check modules: structure, naming, spineJson, atlas, images, coverage,
bakedText. Validates art deliveries against scaffold rules; exports
Unity-structured ZIP.

**Good**
1. Genuinely pipeline-critical: catches naming, Spine-version, atlas-size, coverage errors before they hit the game team.
2. Fully local (privacy-first), severity-configurable per rule.
3. Coverage checks integrate with Project Scaffold templates — the two tools form a real pipeline.
4. Multiple result views (file / category / severity) + ZIP export with rename rules.

**Bad / wanted**
1. No rule presets beyond default — heavy config burden per project; presets per game type are highly wanted.
2. Report-only: no auto-fix or "fix suggestion" (e.g. rename proposals for naming violations) — the most-requested expansion.
3. Spine linting is shallow (no engine-specific semantic checks).
4. Coverage quality is hostage to scaffold-template accuracy, with no validation loop between the two tools.
5. `findSpineInTree()` is an O(n) full-tree scan per query; no index for large deliveries.

---

## ⭐ Focus area 3 — Project Scaffold (`ProjectScaffoldTool.jsx`, 848 lines)

Editable folder-structure tree designer; presets, leaf rules
(spineAtLeastOne, pngAtLeastOne…), exports SharePoint ZIP / Unity tree /
config JSON.

**Good**
1. Leaf rules align 1:1 with Asset Checker coverage — single source of truth for "what a project must contain".
2. JSON roundtrip enables template reuse.
3. Slug-safe naming, preset subtrees (Intro_Outro, Fonts) reduce setup time.

**Bad / wanted**
1. 848-line monolith — needs decomposition (tree, palette, export, rules as modules).
2. Dense tree UI: no drag-reorder between parents, no inline rule explanations/hover hints.
3. No team sharing/versioning of templates (a template library — like TemplatesTool — is the obvious expansion).
4. Font handling special-cased via `fontVariant` flag instead of a generic variant mechanism.

---

## ⭐ Focus area 4 — Art Tools as a package (13 tools)

**Good (package level)**
1. Consistent runner-registry pattern — every tool plugs into the shell identically.
2. WASM ImageMagick gives production-quality output (correct straight-alpha handling).
3. `utils/image.js` (`getImageDimensions`, `freshBytes`) shows the right abstraction instinct.
4. Replace-with-output flow enables chained workflows.

**Bad (package level) — these multiply across all 13 tools**
1. **Duplicated feather-mask Magick chain** (`-shave/-bordercolor/-border/-blur/-level`) in BlurTool:66, GaussianBlurTool:52+87, OutlineTool, and SceneStudio `engine/spinner/spinnerBlur.js` (the retired SlotMachineTool's copy moved there) → extract `makeFeatherMask()`.
2. **No batch mode** on 7 single-file tools (Crop, Scaler, Blur, GaussBlur, GreyAlpha, GradientMap, Outline) — biggest daily-use friction.
3. **No before/after preview** on any Magick tool — users run blind and iterate by re-running.
4. Duplicated scale-call pattern (Scaler ↔ AtlasPacker) and canvas-to-blob pattern (RGBA/GreyAlpha/GradientMap) → shared utils.
5. No per-tool settings persistence and no cancellation of long Magick runs.

### Per-tool quick reviews

| Tool | Good (top 3) | Bad / wanted (top 3) |
|---|---|---|
| **Converter** (339 L) | video frame extraction (time/index/range); quality+lossless controls; good progress labels | no frame scrubber/preview; seek reliability epsilon-fragile; output labeling unclear for multi-frame |
| **Atlas Packer** (183 L) | grid+tile modes; pre-scale w/ filters; size caps + logging | **no JSON metadata output for engines** (top wanted); no bin-packing; silently clips overflow sprites |
| **Outline** (196 L) | true morphological outline (outside/center/inside); 3 kernels; canvas-expand | 6+ sequential Magick calls (slow); duplicated mask chain; no preview |
| **Gradient Map** (290 L) | 8 presets; cubic interpolation; 4 luma formulas; drag-stop editor | no custom-preset import/export; overlapping-stop edge cases; gestures undocumented |
| **Blur** (141 L) | bidirectional; edge feather; angle slider | 5 sequential Magick calls; duplicated feather chain; no direction preview |
| **Gaussian Blur** (154 L) | keep/blur alpha modes; feather | two near-identical code paths (L32–75 vs L77–112); no guidance on modes; single-file |
| **Font Preview** (238 L) | live canvas; gradient bg; per-letter thumbs | uniform letter heights assumed; no kerning table; no multi-line |
| **RGBA Combiner** (157 L) | color-coded slots + thumbs; Rec.709 luma; fill defaults | no combined-result preview; fixed channel order; PNG-only |
| **Crop** (104 L) | crop/pad hints; match-first-image | center-gravity only; transparent-pad only; no batch |
| **Scaler** (112 L) | 8 filters w/ descriptions; two modes | no aspect lock; uniform-only scaling; no batch |
| **Paylines** (203 L) | import/parse; clipboard; custom symbols | no JSON export; regex parse fragile for emoji; ignores loaded files |
| **Grey→Alpha** (81 L) | compact; Rec.709; white/original RGB | confusing scale slider; no preview; single-file |

---

## Remaining tools (brief)

**Cheat Tool** (18+ files) — Good: full client-side game sim ("Real Spin" with
actual game math), presets, board editor. Bad: heavy context state; no
impossible-state validation; sim can drift from live backend; read-only (no
backend export).

**Char Extractor** (418 L) — Good: text + font (cmap) modes, 14 Unicode
categories, lazy opentype.js. Bad: hardcoded ranges (not CLDR); no progress on
big fonts; no export beyond clipboard.

**Templates Library** (475 L) — Good: zero-infra markdown+frontmatter
publishing. Bad: manifest.json out-of-sync risk; no search/filter; minimal YAML
parser.

**Repo Content Browser** (81 L + context) — Good: thin wrapper, GH/GL
auto-detect, art/sound modes, global search. Bad: **unbounded blob+tree caches**
(`RepoBrowserContext.jsx:37-38`, cleared only on disconnect); token in memory
only; no branch/date filters.

---

## App shell (cross-cutting, affects everything)

**Good:** clean 3-context split (App / RepoBrowser / UnityExport); URL tool
persistence with aliases; thorough blob-URL revocation; fullBleed tool
keep-alive (preserves Pixi state); lightbox exists.

**Bad:** **zero ARIA / focus-visible / keyboard nav** anywhere; unbounded log
entries; silent failures (WASM CDN load, rejected files); dead code
(`toolUrl.js` re-implemented inline in `AppContext.jsx:5-36`); no tests at all;
flat tool column without search.

---

## PRIORITY RANKING (Jira-style)

### P0 — do first (blocks value or compounds daily)
1. **Scene Studio: ship Phase 4 export** (PNG hero / PNG sequence / WebM) + fix or properly contain the Pixi v8 crash. ~~Phase 4.2 Unity package export~~ — **SHIPPED 2026-06-04..12** (`SceneStudio/unity/`: `.unitypackage` with `.meta` files, Unity Timeline translation, SkeletonGraphic prefab, generated C# player + `YggSpinner.cs`). Browser-side exports remain the gap. **Spinner Unity phase 2** queued from import testing — see `next phase spinner unity.md` (prefab-baked reel hierarchy, spinner Timeline track, spine-clip parity, opt-in auto-build, web land/win overlay bug).
2. **Art Tools shared infra**: extract `makeFeatherMask()` / `scaleImageWasm()` / `canvasToBlob()` utils + add batch mode to the 7 single-file tools. Small effort, multiplies across 13 tools.
3. **Asset Checker: rule presets + auto-fix suggestions** — turns a reporter into a pipeline tool teams act on.

### P1 — next
4. **Atlas Packer JSON metadata output** (sprite rects for engines) — small, highly wanted.
5. **Project Scaffold**: decompose the 848-line monolith; add template sharing/versioning; inline rule hints.
6. **App shell hardening**: log cap, blob/tree cache eviction (RepoBrowserContext), prominent WASM-failure state, surface rejected-file feedback.
7. **Live previews** on Magick tools (Blur, Gaussian, Outline, Gradient Map first).

### P2 — valuable, not urgent
8. ~~**Slot Machine**~~ — tool retired in Phase 5; replaced by the deterministic Scene Studio Spinner object (`react-app/SPINNER.md`).
9. **Accessibility pass** (run the `web-design-guidelines` skill audit): ARIA, focus-visible, keyboard nav, Escape handling.
10. **Converter**: frame scrubber preview, clearer multi-frame output naming.
11. **Cheat Tool**: state validation, drift warning vs backend version.

### P3 — polish/backlog
12. Tool settings persistence (localStorage per tool); tool search in sidebar.
13. Gradient Map preset import/export; RGBA combined preview; Paylines JSON export; Font Preview kerning.
14. Templates search/filter + manifest auto-generation; Char Extractor export file.
15. Delete dead `toolUrl.js` duplication; route SceneStudio `console.warn`s to app log; refresh CLAUDE.md tool list (13 documented vs 20 actual).

### P4 — nice-to-have
16. New tool ideas (from the image-processing skill): trim-whitespace, sprite-sheet slicer, palette extractor, batch optimizer.
17. Light-mode theme; offline/service-worker caching of WASM.
