---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
lang: en
source: react-app/SCENE_STUDIO_PHASE_STATUS.md
tags: [session, scene-studio, spinner, ux]
---

# Session 2026-07-04 (round 3) — blur generation progress bar, always-visible sigma/feather, bigger wizard panel

> [!success] Shipped (2026-07-04)
> Follow-up to [[Session 2026-07-04 Scene Studio Spinner Outcome and Blur Fixes]].
> UI/UX-only — no logic changes, so nothing new to unit test; all 169 Scene
> Studio tests still pass. Purely visual/interactive, and no
> browser-automation tool was available to actually verify it by eye.

## What changed

- **Blur generation progress bar** — `generateBlurs` (`SpinnerWizard.jsx`)
  now updates state incrementally per symbol (matched by `id`, not a
  stale end-of-batch array swap) and yields a frame
  (`await new Promise(requestAnimationFrame)`) before each symbol's WASM
  call, so a progress bar ("blurring 'x' — 3/14") stays visible and the
  live preview keeps repainting between symbols instead of the whole batch
  looking frozen. True background execution (a Web Worker) was considered
  and rejected: the shared `window._Magick` WASM chain writes to fixed temp
  filenames also used by every other ImageMagick call in the app, so
  concurrent calls would race regardless of which thread runs them — this
  has to stay sequential either way.
- **Confirmed already explicit-click-only** — verified `generateBlurs` was
  never called anywhere except the button's `onClick`; the reported "symbols
  didn't render at first" was very likely this same blocking-batch feel
  without progress feedback, not an accidental auto-trigger.
- **Sigma/feather no longer hidden** — the blur-gen panel (with its
  sigma/feather `DragNumberField`s) used to disappear entirely once no
  symbol was missing a blur, which also hid the controls needed to tune and
  redo the blur look. It's now always shown when any symbol has a static
  PNG, and a new **"↻ regenerate all"** button re-blurs every symbol with
  the current settings (not just the missing ones).
- **Wizard panel default width 460→620px** (`PANEL_SIZES.wizard` in
  `SceneStudioInner.jsx` — shared by every wizard dock, not just Spinner).
- **Symbol preview thumbnails 44→76px** (`.spinner-thumb-box` in
  `scene-studio.css`) — previously a fixed size regardless of panel width,
  so widening the panel (even via the existing T8 resize handle) just added
  blank margin instead of showing bigger, more useful previews. The preview
  row now wraps (`flex-wrap`) at narrow widths instead of overflowing, and
  the symbol list's scroll height grew 260→420px to fit more rows before
  scrolling is needed.

## Files

| Area | File |
|---|---|
| Incremental `generateBlurs` + `blurProgress` state; always-visible controls + regenerate-all | `components/SpinnerWizard.jsx` |
| Default wizard panel width | `SceneStudioInner.jsx` |
| Progress bar CSS; bigger thumbnails; taller symbol list | `styles/scene-studio.css` |

Related: [[Spinner Design]], [[Session 2026-07-04 Scene Studio Spinner Outcome and Blur Fixes]], [[Scene Studio]].

Polish changelog (canonical): `react-app/SCENE_STUDIO_PHASE_STATUS.md`.
