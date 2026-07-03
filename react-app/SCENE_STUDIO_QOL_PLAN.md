# Scene Studio — Direct Mode & Wizard QoL Plan (2026-07-04)

Unified implementation plan merged from two independent planning passes, with every
root cause re-verified against the code (file:line refs below checked on 2026-07-04).

---

## Starting prompt (for the implementing agent)

> Implement the plan in `react-app/SCENE_STUDIO_QOL_PLAN.md`, one theme at a time,
> in the execution order given in §3. Before touching code:
>
> 1. Read `react-app/SCENE_STUDIO_DIRECT.md`, `react-app/SPINNER.md`,
>    `react-app/WIN_SEQUENCES.md`, and skim `react-app/SCENE_STUDIO_PHASE_STATUS.md`
>    for the latest as-built state — trust code over older design docs.
> 2. Re-verify the root cause cited for the theme you are about to work on
>    (the file:line refs in §1) — the code may have moved since this plan was written.
> 3. For each theme: reproduce the bug first (or state why it can't be reproduced
>    headlessly), implement, then run the engine tests
>    (`cd react-app && npx vitest run src/tools/SceneStudio/engine` — the `.test.mjs`
>    files) and add/extend tests named in the theme.
> 4. Work in small commits, one theme (or coherent sub-theme) per commit.
> 5. After each theme, append a short entry to
>    `react-app/SCENE_STUDIO_PHASE_STATUS.md` (Polish, matching existing style) and
>    keep the brain-vault English mirror (`brain/50-Sessions/…`, `brain/30-Design/…`)
>    in sync at session close.
> 6. Constraints from CLAUDE.md apply: surgical edits, no clamping of numeric
>    inputs while typing (use `DragNumberField`/`NumberField`), tools own their
>    settings state, match surrounding code density.
> 7. STOP and ask before shipping T5 — the open question in §5 (does a closed eye
>    serialize into Unity/WebM export as "starts hidden", or is it editor-only?)
>    needs the user's answer.
>
> Definition of done per theme: bug reproducible before / not after, acceptance
> criterion in §4 met, no regressions in direct-mode playback, scrub, spinner and
> win-sequence preview flows.

---

## 1) Current problems / verified root causes

| # | Problem | Verified root cause / location |
|---|---|---|
| 1 | Director hold doesn't preserve keyframed end pose; scene snaps back to setup state after playback | `engine/scenarioModel.js:32` — `transitionDefaults()` returns `{ mode: 'cut', ... }`; carry-pose path in `scenarioTimeline.js` needs audit for hold semantics |
| 2 | Alpha-only crossfade still moves objects (portrait only) | `engine/scenarioBlend.js:80` — `blendTransforms` **snaps every unmasked channel to the incoming B value** (`mask.position ? lerp(...) : B.x`). Portrait-only visibility likely because blend reads raw `layer.transforms.portrait` while editor inheritance lives in `orientationManager.js` |
| 3 | Clips can't be dragged past each other on the timeline | `components/TimelinePanel.jsx` drag/clamp constraints enforce non-overlap by blocking, not reordering |
| 4 | Spine idle animations don't update on scrub, only on play | `engine/pixiApp.js` paused/scrub path — pose refresh exists but doesn't model "looped from clip-start at speed" for default/idle animations |
| 5 | Setup-pose semantics inconsistent; non-setup objects should be invisible | Not codified anywhere; mode groups in `SceneStudioInner.jsx` are alpha-gated ad hoc |
| 6 | Bonus-game parent alpha doesn't propagate to children; only bonus has a parent group at all | Group/alpha composition in `pixiApp.js` + mode-group creation in `SceneStudioInner.jsx` |
| 7 | Enabled/disabled + alpha are two overlapping visibility systems | `components/HierarchyPanel.jsx:191` — plain `checked={layer.visible}` checkbox |
| 8 | Spinner wizard: wrong step order, symbol false positives, cramped non-standard panels | `components/SpinnerWizard.jsx` heuristics + wizard shell layout |
| 9 | Win-number font false positives | `WinSequenceWizard.jsx:107` `looksLikeFont()` is name-regex only — **no dimension check**; auto-pick at L493–499 grabs the first name match |
| 10 | No wager switching in win-timeline inspector | Wager control exists only inside the wizard Number step; evaluator path (`winNumberModel.js` / `winNumberRuntime.js`) already supports sampled values |
| 11 | WebM export renders "blind" | `WebMExportDialog.jsx` has progress state (L88, L233–239) but no bring-scene-to-front mode |
| 12 | Spinner randomization not reusable | `spinnerModel.js:249/700–730` already has `randomResult` + seeded outcome override — logic exists, only surfaced in the director node |

All paths relative to `react-app/src/tools/SceneStudio/`.

## 2) Unified plan

### T1 — Hold as default + end-pose preservation (incl. idle timelines)
Change `transitionDefaults()` to `mode: 'hold'` for **newly created edges only**;
existing serialized transitions keep their authored mode. Audit the carry-pose path
in `scenarioTimeline.js` so hold genuinely freezes the outgoing timeline's final
sampled pose (not the setup pose) until the next node takes over. Explicitly wire
this into the **mode idle timelines** (base game / bonus / etc. — see
`sceneSetupTimelines.js`): an idle timeline entered via hold must start from the
carried pose, and via crossfade must blend from it.
Files: `scenarioModel.js`, `scenarioTimeline.js`, `sceneSetupTimelines.js`,
tests in `scenarioTimeline.test.mjs`.

### T2 — Crossfade channel isolation + portrait parity
Fix `blendTransforms` so unmasked channels **hold the A (outgoing/carried) value**
instead of snapping to B. Route both A and B sampling through one
orientation-normalized accessor shared with `orientationManager.js` so portrait
inheritance can't leak into masked channels. Add portrait + landscape test cases
for alpha-only crossfade.
Files: `scenarioBlend.js`, `orientationManager.js`, `scenarioBlend.test.mjs`.

### T3 — Timeline drag: clips can pass each other
Rework the drag pipeline into intent → resolved placement → commit: dragging a clip
past a neighbor swaps order deterministically instead of clamping. Preserve
non-overlap invariants at commit time only.
Files: `TimelinePanel.jsx`.

### T4 — Scrub determinism + setup-pose visibility rules
On scrub, treat any spine object with a default/idle animation as *started at its
clip's first frame, looping at its speed* — sample `state` at
`(scrubTime − clipStart) × speed mod duration`, apply, `updateWorldTransform`.
Codify the visibility contract: **setup pose not selected → object invisible
(alpha-composed to 0) unless a clip/keyframe drives it; any other animation
selected → first-frame-loop rule.** Exceptions, explicit and isolated: spinner
shows its initial board; win sequence shows biggest-win idle in *scene setup* mode
but is invisible in *animate* mode.
Files: `pixiApp.js`, `sceneModel.js`, `SceneStudioInner.jsx`.

### T5 — Eye visibility model (replaces enable/disable)
Replace the hierarchy checkbox with an open/closed-eye toggle. Binary eye value
composes with inspector alpha as `effectiveAlpha = min(inspectorAlpha, eyeAlpha)` —
closing the eye never overwrites the authored inspector alpha. Objects stay in the
graph and runtime (alpha 0 already skips Pixi rendering); no hard-disable path.
Include a short **Unity translation note** in the export docs: CanvasGroup maps
1:1; SpriteRenderer has no group alpha, so the exporter should emit a per-node
alpha multiplier component (research task, small).
⚠ Open question in §5 must be answered before this ships.
Files: `HierarchyPanel.jsx`, `sceneModel.js`, `pixiApp.js`, Unity exporter docs.

### T6 — Mode parent groups everywhere
Every mode (base, bonus, free spins, …) gets a real parent group; fix the
alpha-propagation bug so parent alpha multiplies through children identically to
any other container, updated live during playback and scrub. Migration-safe
normalization for scenes missing the expected group.
Files: `SceneStudioInner.jsx`, `pixiApp.js`, `sceneModel.js`.

### T7 — Spinner wizard redesign
Asset-selection-first step order. Two pipelines: **statics** (current behavior)
and **animations-only** — detect animations + blurred variants, with an
*auto-generate blur* action; idle/landing frame = first frame of `landing`,
falling back to first frame of `win`; that frame also seeds blur generation.
Post-win, symbols simply hold their last computed pose — no statics required.
Tighten symbol candidate heuristics (structured folder preference, stronger
UI/bg/machine exclusion, confidence threshold — weak matches stay unassigned with
a warning instead of silently filling). Also allow the animation-derived setup in
the static workflow, since animations are the primary objects.
Files: `SpinnerWizard.jsx`, `spinnerModel.js`, atlas/blur helpers.

### T8 — Wizard shell standardization
All wizards get one shared panel shell: ~33% of the right side by default,
user-resizable like other panels, and visually consistent (scene wizard currently
diverges). The spinner animation-setup step expands to fill the panel instead of
floating in dead space.
Files: wizard components + `styles/scene-studio.css`.

### T9 — Win-number font detection tightening
Extend `looksLikeFont` gating: candidate must be a PNG of **width 2048**
(256 × 8 columns; height may vary by row count) **and** the name must include a
font-ish token. Anything failing either check falls back to the template with an
inline "unverified pick" badge rather than auto-binding.
Files: `WinSequenceWizard.jsx`, `winseq/winNumberModel.js`.

### T10 — Wager selector in win-timeline inspector
Add a wager dropdown to the win-timeline inspector/preview contexts reusing the
wizard's evaluator path, so different result numbers can be previewed instantly.
Preview-only override — never persisted unless applied.
Files: `ScenarioInspectorSections.jsx` / win-timeline inspector,
`winseq/winNumberRuntime.js`.

### T11 — WebM export "watch the render" mode
New toggle, **default ON**: exporting brings the scene view to front and plays the
capture in real time with the existing frame-progress readout overlaid.
Cancel/retry behavior unchanged.
Files: `WebMExportDialog.jsx`, `PixiViewport.jsx`.

### T12 — Reusable spinner result randomization
Add a "re-roll result" button on the director spinner node (re-seeds within the
selected win threshold), and expose the same action + threshold selector in the
timeline spinner clip setup and wizard preview. All three call the same
`spinnerModel.js` seeded-outcome path (`randomResult` / outcome override,
L700–730) — one implementation, three surfaces.
Files: `ScenarioGraphPanel.jsx` (director node), `SpinnerInspectorSections.jsx`,
`SpinnerWizard.jsx`, `spinner/spinnerEval.js`.

## 3) Execution order

Engine correctness first, then UX, then wizards/export:

1. **T2** crossfade channel isolation (smallest, highest-value engine fix)
2. **T1** hold default + carry pose + idle-timeline integration
3. **T4** scrub determinism + setup-pose rules
4. **T6** mode parent groups
5. **T5** eye visibility model (after T6 so alpha composition lands once)
6. **T3** timeline drag reorder
7. **T12** randomization reuse → **T10** wager selector → **T11** export view
   (small, independent)
8. **T7** spinner wizard redesign → **T8** wizard shell → **T9** font detection
   (biggest surface last; benefits from T12)

## 4) Acceptance criteria

- Playing a scenario with hold leaves objects exactly at their final keyframed
  pose — verified after director playback, node hand-off, and entry into a mode
  idle timeline; portrait and landscape.
- Alpha-only crossfade changes *nothing* but alpha, in both orientations;
  per-channel tests in `scenarioBlend.test.mjs`.
- Scrubbing to any time twice yields the identical spine pose; idle animations
  visibly advance while dragging the playhead.
- A clip dragged past its neighbor swaps cleanly; no jitter, no phantom overlaps.
- Closing the eye on any mode group fades all children to 0 without touching
  their authored alphas; reopening restores them exactly.
- Wizard auto-detect assigns no symbol/font it isn't confident about; uncertain
  candidates surface as warnings.
- Export with render-front ON shows the scene playing live with frame progress;
  output identical to background export.
- The same threshold + re-roll produces identical boards in director, timeline
  setup, and wizard preview (shared seed path).

## 5) Risks / open questions

- **Behavioral migration**: hold-by-default and the blend fix both change how
  existing scenes play. Mitigation: new defaults apply to new edges only; add a
  one-time console note when a legacy scene relies on the old snap-to-B behavior.
- **TimelinePanel refactor** is the regression-heaviest item — dense pointer
  logic; needs a manual interaction checklist before/after.
- **Detection tightening reduces recall** — the badge/warning fallback is
  deliberate; expect a few more manual picks in exchange for zero silent wrong
  ones.
- **OPEN QUESTION (blocks T5 ship):** should a closed eye be editor-only, or
  serialize into the Unity/WebM export as "starts hidden"? The `min()` model
  supports either; the exporter needs to know which.
