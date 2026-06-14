# YGG Toolkit — tool review & priority backlog (2026-06-10, verdicts re-audited against code 2026-06-14)

Code review of every tool in `react-app/src/`, with strengths, weaknesses, and
expansion ideas per tool, followed by a Jira-style priority ranking (P0…P4).
Informed by the installed agent skills (see `SKILLS.md`): React best practices,
frontend/web design guidelines, Framer Motion, ImageMagick, web performance.

> **Note**: `CLAUDE.md` only documents 13 art tools and is internally inconsistent
> (says "19" in two places, "20" in another). The actual registry
> (`src/tools/registry.js`, confirmed 2026-06-14) has **20 tools across 4 categories**:
> Art Tools 🎨 (12), Asset Pipeline 🏗️ (6 — Asset Checker, Project Scaffold, Char
> Extractor, Repo Content Browser, Templates, **Asset Library**), Scene Studio 🎬 (1),
> Cheets 🎲 (1). CLAUDE.md needs a refresh (tracked in P3 below).

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

**Bad / wanted** *(verdicts re-audited against code 2026-06-14)*
1. **Phase 4 web export — WebM SHIPPED 2026-06-14** (`engine/webmExport.js` + `WebMExportDialog` + `PixiViewport.exportWebM()`: deterministic 0→duration capture, native res, opaque). **hero-PNG / PNG-sequence still NOT shipped.** The Unity `.unitypackage` export also works (shipped + verified).
2. ~~Pixi v8 crash on rapid add+rebuild~~ — **the underlying crash is FIXED** (`pixiApp.js` `loadTextureFromUrl` now `Assets.load()`s so `source.orig` is populated before use); `PixiErrorBoundary` is kept only as a failsafe, not the fix.
3. Filters defined but not wired to UI; loop marker in flow spec but unimplemented. *(not re-audited)*
4. 7K lines with sparse inline docs — steep onboarding for a second contributor; no tests on the keyframe/flow math (pure functions, ideal test targets). *(NB: `engine/keyframes.js`, `curves.js`, `spinner/*.test.js`, and `unity/*.test.mjs` now exist — partial.)*
5. `console.warn` scattered (18 calls across SceneStudio) instead of routed to the app log — **still open**.

> [!note] Animator wishlist (`next phase scene tool.md`) — mostly SHIPPED (audit 2026-06-14)
> Re-audit found these implemented in code, despite not being struck through anywhere:
> bezier/spline keyframes with **smooth/broken/flat/auto/linear** tangent modes
> (`keyframes.js` `TANGENT_MODES`, `curves.js` `hermite()`, `CurveEditor`/`ClipGraphEditor`);
> **3-point local curve editor** (prev/selected/next, `ClipGraphEditor.jsx`);
> motion-path that **scales with scale keys, draws directional arrows, and is
> click-to-seek** (`pixiApp.js drawMotionPath`, `viewportController.js onSeekToKey`);
> **drag asset → canvas to spawn** (`AssetBrowserPanel`→`SceneStudioInner onDrop`);
> **work-area overlay dropdown** (behind/above, `StudioToolbar`); spacebar play/pause,
> arrow-step, Alt+scroll; keep-mounted + IndexedDB autosave + restore banner.
> **Still open from that list:** editable/auto clip naming for static-PNG clips
> (`objectName + clip N`, inspector field) — NOT DONE.

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

**Bad / wanted** *(re-audited 2026-06-14)*
1. ~~No presets per game type~~ — **DROPPED 2026-06-14** (not wanted). A config-swap system exists (`AssetCheckerTool.jsx` loads `public/configs/manifest.json` + ad-hoc uploaded configs); only `default` ships, and that's fine.
2. ~~Report-only, no auto-fix~~ — **fix SUGGESTIONS shipped**: `AssetChecker/engine/suggest.js` (`suggestCleanName`/`RemoveSuffix`/`LowercaseExt`/`Prefix`) feeds `naming.js`; `ReportView.jsx` shows a "Suggested fix" from→to with copy button. (Auto-*apply* still manual — review required.)
3. Spine linting is shallow (no engine-specific semantic checks).
4. Coverage quality is hostage to scaffold-template accuracy, with no validation loop between the two tools.
5. `findSpineInTree()` is an O(n) full-tree scan per query; no index for large deliveries.

---

## ⭐ Focus area 3 — Project Scaffold (`ProjectScaffoldTool.jsx`, ~770 lines)

Editable folder-structure tree designer; presets, leaf rules
(spineAtLeastOne, pngAtLeastOne…), exports a **single empty-folder scaffold ZIP**
in the Unity delivery layout + a reusable config JSON.

**Good**
1. Leaf rules align 1:1 with Asset Checker coverage — single source of truth for "what a project must contain".
2. JSON roundtrip (v3 config; loads legacy v1/v2) enables template reuse.
3. Slug-safe naming, preset subtrees (Intro_Outro, Fonts, BonusGame) reduce setup time.
4. **Single deterministic builder (2026-06-14)** — `<Project>/{_Game,_Source,_Previews}` + `.ygg-scaffold.json`, no `Art/` wrapper. Replaced the old dual SharePoint-ZIP / Unity-tree export; the Unity path re-used Asset Checker `resolveTarget` mappings and mis-nested subfolders (intro leaves collapsed into bare `_Game/`, fonts got a stray `unity_export/` segment). Routing is now built in-tool so nested features keep their full path; `Export/*`→`_Game`, `Source/*`→`_Source` (both on by default), `preview`→`_Previews`.

**Bad / wanted**
1. 771-line monolith (re-confirmed 2026-06-14; no sibling modules) — needs decomposition (tree, palette, export, rules as modules).
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
1. ~~Duplicated feather-mask Magick chain~~ — **FIXED 2026-06-14**: extracted to `utils/image.js#makeFeatherMask()` (prep modes: colorizeWhite / alphaExtract / asis); Blur, GaussianBlur (×2) and spinnerBlur now call it.
2. ~~No batch mode on 7 single-file tools~~ — **FIXED 2026-06-14** via `utils/batch.js#makeBatchRun()`; Crop, Scaler, Blur, GaussBlur, GreyAlpha, GradientMap, Outline are all batch now.
3. **No before/after preview** on any Magick tool — users run blind and iterate by re-running.
4. Duplicated scale-call pattern (Scaler ↔ AtlasPacker) and canvas-to-blob pattern (RGBA/GreyAlpha/GradientMap) → shared utils.
5. No per-tool settings persistence and no cancellation of long Magick runs.

### Per-tool quick reviews

| Tool | Good (top 3) | Bad / wanted (top 3) |
|---|---|---|
| **Converter** (339 L) | video frame extraction (time/index/range); quality+lossless controls; good progress labels | no frame scrubber/preview; seek reliability epsilon-fragile; output labeling unclear for multi-frame |
| **Atlas Packer** (183 L) | grid+tile modes; pre-scale w/ filters; size caps + logging | **no JSON metadata output for engines** (top wanted); no bin-packing; silently clips overflow sprites |
| **Outline** (196 L) | true morphological outline (outside/center/inside); 3 kernels; canvas-expand; **batch** | 6+ sequential Magick calls (slow); own morphology mask chain; no preview |
| **Gradient Map** (290 L) | 8 presets; cubic interpolation; 4 luma formulas; drag-stop editor; **batch** | no custom-preset import/export; overlapping-stop edge cases; gestures undocumented |
| **Blur** (141 L) | bidirectional; edge feather; angle slider; **batch**; shared `makeFeatherMask()` | **white edge halo on straight-alpha PNGs** (transparent RGB bleeds through `-motion-blur`; needs premultiply-around-blur fix — see Known bugs); 5 sequential Magick calls; no direction preview |
| **Gaussian Blur** (154 L) | keep/blur alpha modes; feather; **batch**; shared `makeFeatherMask()` | same **white-halo straight-alpha bleed** as Blur (feather path); two near-identical code paths; no guidance on modes |
| **Font Preview** (238 L) | live canvas; gradient bg; per-letter thumbs | uniform letter heights assumed; no kerning table; no multi-line |
| **RGBA Combiner** (157 L) | color-coded slots + thumbs; Rec.709 luma; fill defaults; shared `canvasToBlob()` | no combined-result preview; fixed channel order; PNG-only |
| **Crop** (104 L) | crop/pad hints; match-first-image; **batch** | center-gravity only; transparent-pad only |
| **Scaler** (112 L) | 8 filters w/ descriptions; two modes; **batch**; shared `scaleImageWasm()` | no aspect lock; uniform-only scaling |
| **Paylines** (203 L) | import/parse; clipboard; custom symbols | no JSON export; regex parse fragile for emoji; ignores loaded files |
| **Grey→Alpha** (81 L) | compact; Rec.709; white/original RGB; **batch**; shared `canvasToBlob()` | confusing scale slider; no preview |

### Known bugs

- **Blur / Gaussian Blur — white edge halo (straight-alpha bleed).** Confirmed
  2026-06-14 (pre-existing; *not* introduced by the batch/`makeFeatherMask` refactor —
  the Magick arg chain is byte-identical to before). PNGs with white RGB in their
  fully-transparent regions (alpha 0, RGB 255,255,255 — common from art exporters)
  leak white through `-motion-blur`/`-blur`, which blend RGB independently of alpha,
  producing a white fringe along feathered edges. **Fix (deferred, user choice):**
  premultiply RGB by alpha before the blur and un-premultiply after, so transparent
  RGB can't bleed in (and no dark fringe either). Apply to both Blur and the Gaussian
  Blur feather path.

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

**Bad** *(re-audited 2026-06-14):* **minimal** a11y (not zero — scattered `aria-label`/
`role=tablist`/`role=group` in RepoBrowser, StudioToolbar, InspectorPanel; Escape in
Lightbox + SpinePlayer; one `:focus-within` in cheat-tool.css — but no systematic
focus-visible or keyboard nav); **unbounded log** (`AppContext.jsx:70`, no cap —
confirmed); silent failures — **no WASM-failure UI** (`useMagick.js:25` logs only;
`WasmBadge` has no error state) and **rejected files dropped silently**
(`Dropzone.jsx:14` filters, no feedback); **dead code `toolUrl.js`** (exists, zero
imports; logic re-implemented inline in `AppContext.jsx`); no tests at app level;
flat tool column **without search** (confirmed: no filter in `Sidebar.jsx`/`ToolTabs.jsx`).
Cache: RepoBrowser blob/tree caches clear **only on disconnect** (`RepoBrowserContext.jsx:102`),
no LRU/TTL eviction.

---

## PRIORITY RANKING (Jira-style)

### P0 — do first (blocks value or compounds daily)
1. **Scene Studio Phase 4 web export** — ~~WebM~~ **SHIPPED 2026-06-14** (deterministic, native-res, opaque; `engine/webmExport.js`). **Remaining: hero-frame PNG + PNG sequence.** The **Unity `.unitypackage` export already works** (shipped + import-verified, and its per-timeline path is now test-covered — build + 27 `unity/*.test.mjs` green as of 2026-06-14). ~~Also: fix or properly contain the Pixi v8 crash~~ — **crash FIXED 2026-06-14** (`pixiApp.js` `Assets.load()`; error boundary kept as failsafe). ~~Phase 4.2 Unity package export~~ — **SHIPPED 2026-06-04..12** (`SceneStudio/unity/`: `.unitypackage` with `.meta` files, Unity Timeline translation, SkeletonGraphic prefab, generated C# player + `YggSpinner.cs`). Browser-side exports remain the gap. ~~**Spinner Unity phase 2**~~ — **SHIPPED + import-verified 2026-06-13** (`next phase spinner unity phase2.md`): baked reel hierarchy, `YggSpinnerTrack` control track that scrubs in edit mode, Spine clip parity round 1, opt-in Timeline auto-build, web overlay wiring. ~~**Spinner Unity phase 3**~~ — **SHIPPED 2026-06-13** (`next phase spinner unity phase3.md`): removed procedural scale-punch; symbol land/win **Spine** overlay pipeline (export triplets + autowire + `Fx` pool); per-symbol timing offset; spinner clip "set duration" buttons; Spine clip parity round 2; spine starting-anim/mix-default bugs fixed; **atlas/texture self-heal** (`repairSceneSpineAssets`); **mix bug fixed** via version-robust `ApplySpineClipTemplate` + forced clip ease; inspector regrouped to Unity layout. ~~**Spinner Unity phase 4**~~ — **SHIPPED 2026-06-14**: symbol land/win Spine overlays BAKED into prefab `Fx` (autowired + bound, not runtime-spawned); single shared-atlas export (one draw call, no per-symbol duplication); static/blur hidden behind playing overlay. **Spinner Unity phase 5** queued — `next phase spinner unity phase5.md`: (A) "present win" clip after stopSpin w/ per-reel win delay; (B) 1:1 native symbols + single machine mask (statics/blur only, animations overflow); (C) runtime `SetResultBoard`/`Spin` API for backend result injection; verify baked overlays play.
2. ~~**Art Tools shared infra**~~ — **SHIPPED 2026-06-14**. Extracted `makeFeatherMask()` / `scaleImageWasm()` / `canvasToBlob()` into `utils/image.js` (call sites refactored: Blur, GaussianBlur×2, spinnerBlur, Scaler, AtlasPacker, RGBA, Grey, Gradient, Converter). Added a shared `utils/batch.js#makeBatchRun()` and flipped all **7 single-file tools to `batchMode: true`** (Crop, Scaler, Blur, GaussianBlur, GreyToAlpha, GradientMap, Outline) with per-file error isolation + progress. Build + 65 SceneStudio tests green.

> [!done] Asset Checker auto-fix shipped; presets dropped (2026-06-14)
> Auto-fix *suggestions* already shipped (`engine/suggest.js` + ReportView). **Rule
> presets per game type were considered and explicitly dropped** — not wanted. The
> config-swap system stays for ad-hoc uploaded configs.

### P1 — next
3b. **Blur / Gaussian Blur white-halo fix** — premultiply alpha around the blur to stop transparent white RGB bleeding into feathered edges (see *Known bugs* above). Confirmed real 2026-06-14; deferred by user choice this session.
4. **Atlas Packer JSON metadata output** (sprite rects for engines) — small, highly wanted. *(Confirmed open: `AtlasPackerTool.jsx` outputs PNG only.)*
5. **Project Scaffold**: decompose the 771-line monolith (confirmed, no sibling modules); add template sharing/versioning; inline rule hints.
6. **App shell hardening**: log cap (confirmed unbounded), blob/tree cache eviction (RepoBrowserContext — confirmed clear-on-disconnect only), prominent WASM-failure state (confirmed missing), surface rejected-file feedback (confirmed silent).
7. **Live previews** on Magick tools (Blur, Gaussian, Outline, Gradient Map first). *(Confirmed open: none have a before/after preview.)*

### P2 — valuable, not urgent
8. ~~**Slot Machine**~~ — tool retired in Phase 5; replaced by the deterministic Scene Studio Spinner object (`react-app/SPINNER.md`).
9. **Accessibility pass** (run the `web-design-guidelines` skill audit): systematic focus-visible, keyboard nav. *(Some ARIA/role + Escape already exist — this is filling gaps, not greenfield.)*
10. **Converter**: frame scrubber **visual preview** (time/index/range inputs exist; no preview of the selected frame), clearer multi-frame output naming.
11. **Cheat Tool**: **state validation already SHIPPED** (`lib/validation.js` + field errors). Remaining: drift warning vs backend version.

### P3 — polish/backlog
12. Tool settings persistence — **partial** (Cheat Tool + Asset Library persist to localStorage; extend to the rest); tool search in sidebar (confirmed missing).
13. Gradient Map preset import/export; RGBA combined preview; Paylines JSON export (confirmed `.txt` only); Font Preview kerning; Char Extractor **file** export (confirmed clipboard-only).
14. ~~Templates search/filter~~ — **SHIPPED** (`TemplatesTool.jsx` search input + `useMemo` filter). Remaining: manifest **auto-generation** (still hand-maintained).
15. **Scene Studio clip naming** — static-PNG clips show "weird" auto-names; want `objectName + clip N` default + an editable clip-name field in the inspector (the rest of the `next phase scene tool.md` wishlist shipped; this is the only open item).
16. Delete dead `toolUrl.js` duplication (confirmed unused); route SceneStudio `console.warn`s to app log (18 calls); refresh CLAUDE.md tool list (**20 tools**: 12 Art / 6 Asset Pipeline incl. Asset Library / 1 Scene Studio / 1 Cheets — CLAUDE.md still says 13 art tools and is internally inconsistent on 19 vs 20).

### P4 — nice-to-have
17. New tool ideas (from the image-processing skill): trim-whitespace, sprite-sheet slicer, palette extractor, batch optimizer.
18. Light-mode theme; offline/service-worker caching of WASM.
