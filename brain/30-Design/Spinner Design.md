---
type: design
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-07
source: react-app/SPINNER.md
tags: [design, scene-studio, spinner, slot]
---

# Spinner — Design (Scene Studio Phase 5)

> [!info] Canonical source
> Full design + milestone status: [`react-app/SPINNER.md`](../../react-app/SPINNER.md).
> Unity-export work is logged across [[Spinner Unity Phase 2]] → [[Spinner Unity Phase 5]].

> [!note] Latest (2026-07-07)
> Wizard round: land/win preview cells render the real Spine pose + an anim-clip
> dropdown; pose baking moved to an isolated renderer (fixed scene-graph
> corruption + preview blanking); win anims play once & hold; idle/blur falls
> back to the win first frame; "Spin!" step auto-spins on entry, reroll re-arms
> the spin, default outcome = big win; "render blurs and continue" primary
> button. See [[Session 2026-07-07 Scene Studio Spinner Wizard Preview Overhaul]].

Deterministic slot-machine **Spinner** object inside [[Scene Studio]]. Replaced the
retired standalone Slot Machine tool (`?tool=slotmachine` soft-redirects to Scene
Studio via `TOOL_ALIASES`).

## Section map

| §   | Topic                       |
| --- | --------------------------- |
| 1   | Design principles           |
| 2   | Evaluation model (the math) |
| 3   | Data model                  |
| 4   | Editor UX                   |
| 5   | Win logic (v1)              |
| 6   | Milestones                  |
| 7   | Known risks                 |

## Key concepts (from the Unity-export sessions)

- **Baked reel hierarchy** → Unity Timeline `YggSpinnerTrack` that scrubs in edit mode.
- **Symbol land/win Spine overlays** baked into prefab `Fx` (autowired + bound).
- **Single shared-atlas export** (one draw call, native 1:1 symbol sizing).
- **Runtime API** — `YggSpinner.SetResultBoard(string[][])` + `Spin()` for backend
  result injection (§6 of SPINNER.md).
- **`presentWin` clip** — controls *when* winning symbols animate, with per-reel stagger.
- **Animations-only symbols** (2026-07-04) — a symbol can skip static art entirely
  (`animOnly: true`): its idle texture is baked from the landing/win Spine animation's
  first frame at build time, and it holds its last computed pose after a win instead of
  reverting to a static. Web-only so far — `YggSpinner.cs` has no Unity-side equivalent
  yet (§3 of SPINNER.md).
- **Reusable spin re-roll** (2026-07-04) — one seeded-outcome path
  (`spinnerModel.targetBoardForClip`) serves the director node, a timeline clip's own
  outcome selector, and the wizard's test-spin preview; "re-roll" bumps a seed so the
  same threshold lands a different board.
- **Wizard polish** (2026-07-04) — steps reordered to Symbols-first (matches §4's
  original design); new `grid.symbolScale` (live-patched art scale independent of cell
  size); negative grid spacing (cells can overlap); faster new-spinner timing defaults;
  fixed a normalization bug that silently dropped the test-spin outcome dropdown. See
  [[Session 2026-07-04 Scene Studio Spinner Wizard Polish]].
- **Outcome + blur follow-up fixes** (2026-07-04) — the normalization fix above
  wasn't the whole story: `generateNonWinningBoard` itself never verified its own
  postcondition (fixed with a deterministic two-reel-monochrome guarantee, works
  even at 2 symbols); `animOnly` symbols' blur used a different, lower-quality Pixi
  filter than every other symbol's directional WASM motion-blur (now shares the
  same pipeline via `blurCanvasWasm`/`blurCanvasFallback`); and the Review step's
  Result dropdown now writes directly into the resting board + live preview instead
  of only affecting a transient test-spin. See
  [[Session 2026-07-04 Scene Studio Spinner Outcome and Blur Fixes]].
- **Wizard UX polish round 2** (2026-07-04) — blur generation now shows an
  incremental progress bar (still explicit-click-only, never automatic);
  sigma/feather controls stay visible even once nothing needs blurring, with
  a new "regenerate all" action; wizard panel default width and per-symbol
  preview thumbnail size both increased (were leaving most of the panel
  visibly blank). See
  [[Session 2026-07-04 Scene Studio Spinner Wizard UX Polish]].
- **AnimOnly blur performance fix** (2026-07-04) — the directional-blur fix two
  rounds up had an unintended side effect: it ran a 5-step WASM chain
  synchronously per animOnly symbol, blocking the whole scene from appearing
  for multiple seconds. Split the bake into a fast blocking sharp-texture pass
  and a non-blocking shared sequential background queue for the blur pass
  (queued WASM calls still can't run concurrently — every ImageMagick call in
  the app shares fixed temp filenames). Also made `blur.sigma`/`blur.feather`
  real persisted config fields shared by both blur mechanisms, and made the
  wizard's blur-settings panel show up for animation-only symbol sets, not
  just static ones. See
  [[Session 2026-07-04 Scene Studio Spinner AnimOnly Blur Perf Fix]].
- **Two more blur bugs** (2026-07-04) — `generateBlurs` assigned a
  project-folder-scanned asset's raw filesystem path straight to an `<img>`
  src (silently fails to load; predates today, not a regression), now
  resolves it the same way `SymbolThumb` already does; the animOnly blur
  bake's canvas extraction switched from the raw off-stage Spine container to
  the already-generated sharp texture, a more reliable source. See
  [[Session 2026-07-04 Scene Studio Spinner Blur Loading Bugs]].
- **Blur generation speedup** (2026-07-04) — static-symbol blur generation
  now downsamples 4x before running the 5-step WASM chain (16x fewer pixels
  through every step), with sigma/feather scaled proportionally and no
  re-upsample in the generator. Display-time (web) computes the blur
  sprite's scale from the actual texture-size ratio instead of assuming 1:1,
  so it transparently handles both old and new blur asset sizes. Unity
  export got the matching fix on both UI and World render paths — without it
  a downsampled blur PNG would render visibly smaller than its static
  counterpart in a build. See
  [[Session 2026-07-04 Scene Studio Spinner Blur Downsample Speedup]].
- **The actual "blur never shows" root cause** (2026-07-04) — `resolveAssetUrl`
  (`engine/persist.js`), the ONE shared asset resolver for every asset kind
  in Scene Studio, only special-cased `data:` URLs. Generated blur PNGs use
  `blob:` URLs, which fell through to being treated as a project-folder
  relative path, always failed, and the spinner runtime's null-safe fallback
  silently reused the static texture as the blur texture — no error, blur
  crossfading in via alpha but showing the identical unblurred image
  underneath. App-wide bug (any blob-sourced asset anywhere in Scene Studio),
  not spinner-specific. Fixed with a one-line regex extension + new unit
  tests. See [[Session 2026-07-04 Scene Studio Asset URL Resolution Bug]].

Related: [[Scene Studio]] · [[Scene Studio Design]]
