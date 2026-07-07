---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-07
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, wizard, spine, ux]
---

# Session 2026-07-07 — Spinner wizard: pose-preview thumbnails, Spin! step, isolated pose-bake renderer

> [!success] Shipped (2026-07-07)
> Spinner-wizard-only session (UX + a real scene-corruption bug fix). All
> changes build (`npm run build` OK). Tests: `spinnerEval` 56/57 as-baseline
> (the lone "grid schema: blur sigma/feather" fail predates this work and is
> unrelated), prefab spinner 5/5. No browser-automation tool was available, so
> the visual behaviour was reasoned about, not eyeballed.

## What changed

- **Animation-only symbol auto-detect no longer over-matches.** When no
  `*Symbols` folder structure is detected, `animSearchPool` used to fall back to
  the WHOLE spine pool and `autoFillFromAnimations` turned any rig with a
  "win"/"land"-ish animation into a symbol — dragging in `win_sequence`,
  `win_counter_multiplier`, etc. New `looksLikeSymbolSpine` gate restricts that
  fallback to spines whose file name or a path segment contains "symbol". Manual
  land/win dropdowns still expose every spine. (`components/SpinnerWizard.jsx`)

- **Per-symbol card panels.** `.spinner-sym-entry` got a border/bg/padding/
  radius so it's obvious where one symbol's config begins and ends.
  (`styles/scene-studio.css`)

- **Land/win cells render the actual Spine pose, not green text.** `AnimBadge`
  → `AnimPoseThumb`: land = first frame, win = mid-clip (`atFraction`), with a
  name/`?`/`✕` fallback. The anim-name field became `AnimNamePicker` — a
  dropdown of the rig's real clip names (`spineAnimsById`, parsed from the
  skeleton .json), falling back to free text when the .json is unreadable.

- **Isolated pose-bake renderer — the real bug fix.** Baking poses through the
  shared on-screen renderer (`app.renderer` + `generateTexture` + `destroy`)
  corrupted the live scene graph: the selection/hover hit-test then walked
  destroyed containers and threw `this._position is null` on every mouse move,
  the thumbnails stuck on "…", and blur generation blanked the machine preview
  mid-flight. Fixed with a dedicated, isolated `autoDetectRenderer`
  (`poseBakeRendererRef`) + a serialized queue (`poseBakeQueueRef`) + shared
  `ensurePoseBakeRenderer()`. Both `renderSpinePosePng` and `bakeSpinePosePng`
  now take a spine descriptor + `projectRoot` and build a throwaway one-asset
  scene, so they resolve the rig regardless of what's on screen (e.g. <2 symbols
  → empty preview scene). `handleRenderSpinePose` was wrapped in `useCallback` so
  the thumbnail effect stops restarting every parent render.
  (`components/PixiViewport.jsx`, `SceneStudioInner.jsx`, `SpinnerWizard.jsx`)

- **Idle/blur pose falls back to the WIN clip's first frame** when there's no
  usable land anim. Shared `pickPoseAnimConf` (`engine/spinner/spinnerModel.js`)
  — land preferred only when it has a resolved clip NAME, else win's first frame
  — used by both the wizard's blur generation and the runtime idle-pose bake
  (`spinnerRuntime.js`). Previously a land-spine with no clip name blocked the
  fallback and no blur was generated.

- **Win symbol animations play ONCE and hold the final pose.** Default
  `loop=true` made a looping track wrap via `setTrackTime` and replay when the
  present-win window outlasted the clip. `effectiveAnimLoop(animConf, isWin)`
  forces win → `loop=false` (clamp to last frame), land keeps its flag — applied
  consistently across the overlay-pool key, the duration-map key, and the
  per-frame lookup (`spinnerRuntime.js`), plus the Unity export
  (`exportUnityPackage.js` `animOf`) for parity.

- **"Preview" step renamed "Spin!" and reworked.** Auto-spins on entry (first
  and every re-entry) — the old effect required a spin to ALREADY be running
  (`if (!testRun) return`), so a fresh wizard never span; now `prevStepRef` +
  `wantAutoSpinRef` fire the spin once `previewSpinnerConfig` is ready. Reroll /
  outcome change now re-arm the spin automatically (`applyOutcomeBoard` sets
  `wantAutoSpinRef` instead of `setTestRun(null)`), so the timeline rebuilds and
  plays itself. "rerun spin" sits to the LEFT of the play/reset transport; the
  Result section moved BELOW the timeline; the timeline is always visible in the
  step; default outcome is **big win** (`testOutcome` init `bigWin`, first entry
  seeds a big-win board).

- **Empty "static" thumbnail hidden for animation-only symbols** — rendered only
  when `sym.assetId` is set.

- **Symbols step: "⚡ render blurs and continue" is the primary button** while
  any blur is missing (instead of "next →"). It renders the missing blurs
  (static + anim-only poses) **staying on the Symbols page** (progress bar +
  machine preview stay put), then advances to Grid. Plain "next →" returns only
  once every symbol has a matched blur; skip blur-gen entirely via the step tabs
  at the top. The final "＋ create spinner" is disabled (`⏳ rendering blurs…`)
  while `blurGenerating || finalizingBlurs`.

## Files

| Area | File |
|---|---|
| `looksLikeSymbolSpine`, `AnimPoseThumb`, `AnimNamePicker`, `spineAnimsById`, Spin! step rework, render-blurs-and-continue, static-thumb gating | `components/SpinnerWizard.jsx` |
| Isolated pose-bake renderer + queue + `ensurePoseBakeRenderer`; `render/bakeSpinePosePng` scene-independent | `components/PixiViewport.jsx` |
| `onRenderSpinePose`/`onBakeSpinePose` wiring (asset descriptor + projectRoot); stable `handleRenderSpinePose` | `SceneStudioInner.jsx` |
| `pickPoseAnimConf` (shared idle-pose picker) | `engine/spinner/spinnerModel.js` |
| `effectiveAnimLoop` (win plays once); `pickPoseAnimConf` in idle bake; `bakeSpinePoseSharpTexture` gains `atFraction` | `engine/spinner/spinnerRuntime.js` |
| Win overlay `loop=false` export parity | `unity/exportUnityPackage.js` |
| Per-symbol card panels | `styles/scene-studio.css` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner Wizard UX Polish]], [[Session 2026-07-04 Scene Studio Spinner AnimOnly Blur Perf Fix]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
