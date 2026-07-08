---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-08
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, wizard, spine, idle-pose, performance, ux]
---

# Session 2026-07-08 — Spinner: per-symbol idle frame, single skeleton, preview perf, activity bar

> [!success] Shipped (2026-07-08)
> Spinner-wizard-focused session (animation-only symbols) plus one scene-view-wide
> change. Everything builds (`npm run build` OK). Tests: `spinnerEval` **66/66**
> (added idle-pose cases + fixed a stale blur-sigma default assertion 8→36),
> `structuralHash` 18/18, prefab spinner 5/5, spinnerTrack 19/19, persist 10/10.
> No browser-automation tool was available, so visual behaviour was reasoned about;
> the user verified interactively across several iterations.

## What changed

- **Per-symbol "idle frame" selector.** An animations-only symbol (no static PNG)
  can now choose which animation frame is its resting/idle texture **and** its
  motion-blur source. Started as land/win first/last; generalized to **ANY
  animation in the symbol's skeleton**, first or last frame of each. Placed where
  the static-PNG dropdown sits (after the name, left of it); the static dropdown is
  hidden for anim symbols since there's no static to pick.

- **`resolveIdlePose` — single source of truth** (`engine/spinner/spinnerModel.js`).
  Shared by the wizard dropdown (what it shows), `pickPoseAnimConf` (what gets
  baked), and the live-patch idle diff — they MUST agree or the UI reads one frame
  while the render bakes another. Model is `idlePose: { anim, frame } | null`
  (legacy `{ source, frame }` still accepted + mapped). Availability-aware defaults
  when unset: **land clip → LAST frame** (settled pose), else **win clip → FIRST
  frame** (neutral pre-celebration; the last win frame is a full FX burst → poor
  idle AND a huge/slow texture+blur bake).

- **Two bugs fixed along the way.** (1) The pose snapshot *looped*:
  `setTrackTime(dur)` on a looping track wrapped modulo the clip back to frame 0,
  so "last" rendered identical to "first" — the bake now forces `loop=false` so
  `trackTime=dur` clamps to the true last frame. (2) The dropdown's displayed value
  disagreed with the baked frame (showed "win first" while baking "win last"),
  fixed by resolving both through `resolveIdlePose`.

- **Single Spine skeleton per symbol.** The two separate land/win spine-file
  dropdowns are replaced by ONE "spine skeleton" dropdown (after the symbol name,
  left of the idle selector). Land + win clips are picked from that one skeleton
  (`assignSymbolSkeleton` points both `landAnim.assetId` and `winAnim.assetId` at
  it, then async-resolves clip names + default skin). Underlying data shape
  unchanged → runtime/export untouched. Removed the now-dead `assignSpineAnim`.

- **Preview performance.** Idle-frame edits are no longer structural
  (`idlePose` removed from `spinnerStructuralSig`) — `applyRuntimeConfigs` live-
  re-bakes just the one changed symbol's texture (`refreshSpinnerIdle`) instead of a
  full rebuild + overlay-pool rebuild. Baked idle/blur textures are cached module-
  side (keyed `assetId~anim~skin~frame` [+ sigma/feather]); safe because teardown
  uses `destroy({children:true})` (leaves textures intact); cleared on app destroy
  (`clearSpinnerBakeCache`) and on "refresh assets". The GPU readback
  (`extract.canvas`) is deferred off the sharp-bake critical path into the blur
  queue (`bakeSpinePoseSharpTexture` gained `wantCanvas`). The heavy land/win
  overlay-pool build is deferred to the background for the wizard preview
  (`scene.__previewSpinner`) so the machine appears immediately.

- **Scene-view background-activity bar.** A thin indeterminate progress bar shows
  along the bottom of the scene view (`PixiViewport` `rebuilding` state →
  `.scene-rebuild-bar`) while any structural rebuild is in flight (skeleton/texture
  (re)loads etc.), so the user knows work is happening. Only the latest build clears
  it, so a rapid sequence of edits keeps it up seamlessly.

## Files

| Area | File |
|---|---|
| `resolveIdlePose`, `pickPoseAnimConf`, `normalizeIdlePose` (idle model) | `engine/spinner/spinnerModel.js` |
| idle/blur texture cache, `refreshSpinnerIdle`, `clearSpinnerBakeCache`, deferred extract + overlay pool, `bakeSpinePoseSharpTexture` `wantCanvas`, `bakeDeps` on `__spinner` | `engine/spinner/spinnerRuntime.js` |
| `idlePose` removed from spinner sig (idle is live-patched now) | `engine/structuralHash.js` |
| live idle-patch in `applyRuntimeConfigs`; `clearSpinnerBakeCache` on destroy; `pickPoseAnimConf` import | `engine/pixiApp.js` |
| idle-frame selector (any skeleton anim), single skeleton dropdown, `assignSymbolSkeleton`, `__previewSpinner` flag, static-dropdown gating | `components/SpinnerWizard.jsx` |
| `rebuilding` state + `.scene-rebuild-bar`, cache clear on refresh | `components/PixiViewport.jsx` |
| `onBakeSpinePose` `atFraction` wiring | `SceneStudioInner.jsx` |
| `.scene-pixi-wrap` + `.scene-rebuild-bar` | `styles/scene-studio.css` |
| idle-pose tests + stale sigma-default fix | `engine/spinner/spinnerEval.test.js` |

Related: [[Session 2026-07-07 Scene Studio Spinner Wizard Preview Overhaul]], [[Spinner Design]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
