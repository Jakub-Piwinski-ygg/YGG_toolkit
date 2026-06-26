---
type: session
tool: Win Sequences
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-26
lang: en
source: react-app/WIN_SEQUENCES.md
tags: [session, scene-studio, win-sequences, spine]
---

# Win Sequences — Phase 1 (web + timeline)

> [!success] Phase 1 COMPLETE (2026-06-26)
> The second wizard-built Scene Studio object after the [[Spinner Design|Spinner]].
> **Phase 1 = web authoring + timeline runtime**; **Phase 2 (future) = Unity
> `.unitypackage` export** (`YggWinSequence`), mirroring the Spinner's Phase 5 →
> Unity-phase split. Build green, 15/15 model tests. Design: [[Win Sequences Design]].

A win-sequence object is a single Spine skeleton (`win_sequence.json`) whose
animations follow the `NNx_tier_sub` convention (the number belongs to the **tier**,
not its position) and are chained into escalation **flows** — each flow climbs from
`small` through each enabled present tier, playing every tier's `begin → idle` and
**only the final tier's `end`**. On the timeline it behaves like a Spine layer whose
"animations" are those flows.

## Session log

### 2026-06-24 — model + runtime
- **Pure model** `engine/winseq/winseqModel.js`: tier parse, tier→flow escalation
  generation, `normalizeWinSeqConfig` (derives sequences from the tier mapping — the
  source of truth — and persists only tiers), flow eval (active step + clip-local
  time), one-cycle duration sums, `hangOnLastIdle` (drops the terminal `_end`),
  `large` (03) / `max` (07) gated default-off.
- **Runtime** `engine/winseq/winseqRuntime.js`: Spine-backed, scrub-safe via
  `setAnimation + trackTime` (deterministic seek, same approach as spine clips).
- First **web + timeline** render through the existing Pixi viewport.

### 2026-06-25 — wizard + tests
- **Wizard** `components/WinSequenceWizard.jsx`: skeleton-triplet fetch, tier
  auto-map **plus manual per-tier begin/idle/end dropdowns** (populated from the
  skeleton's full animation list; assigning a non-optional tier auto-enables it),
  flow generation, and an in-panel color-coded begin/idle/end transport strip that
  drives the scene-view preview.
- **Model refinements + 15-test suite** (`winseqModel.test.mjs`): single-frame
  (0-duration) anims respected (not padded to 1s), genuinely-unknown anim falls back
  to default, hang-mode loops the final idle past its window, escalation correctness
  (small/medium/big with `large` on/off, missing tiers skipped naturally).

### 2026-06-26 — entry-point UX + Phase 1 close
- **Wizard launchers moved out of the toolbar** into a dedicated `.scene-wizards-panel`
  in the left stack — between the hierarchy and the workspace (`SceneStudioInner.jsx`;
  the `🪄 wizards ▾` dropdown + its state removed from `StudioToolbar.jsx`). Left-stack
  grid is now 3 rows (`1fr auto minmax(120px,45%)`).
- **Workspace-lock gate** (`WorkspaceLockOverlay.jsx`): when no project root is linked,
  the body is greyed out + made non-interactive (`.scene-studio-body--locked`) and a
  large centered "No Workspace Loaded" panel with an orange **📁 load workspace folder**
  button is the only available action.
- **Wizard mode → "frame behind" default**: opening any wizard stashes the current
  overlay mode and forces `behind` so the previewed object isn't greyed by the
  in-front frame; the prior mode is restored on close (`savedOverlayModeRef`).

## Implementation map

| Concern | File |
|---|---|
| Pure model (tiers, parse, flows, normalize, eval, durations) | `engine/winseq/winseqModel.js` (+ `.test.mjs`, 15/15) |
| Pixi driver (Spine-backed, scrub-safe) | `engine/winseq/winseqRuntime.js` |
| Build / apply / reset / hash / onAssetReady | `engine/pixiApp.js` |
| `clip.winseq` payload + `winseq` asset type | `engine/sceneModel.js` |
| Wizard (skeleton fetch + tier map + flow gen + preview) | `components/WinSequenceWizard.jsx` |
| Wizard launcher panel (left stack) | `SceneStudioInner.jsx` (`.scene-wizards-panel`) |
| Create / edit / update handlers + render | `SceneStudioInner.jsx` |
| Clip inspector (flow picker, hang, set-duration, re-edit) | `components/InspectorPanel.jsx` |
| Timeline clip label + flow picker + default duration | `components/TimelinePanel.jsx` |

## Deferred → Phase 2
- Unity export: a `winseq` layer emits a "not supported yet" warning (not a crash).
  The model is framework-agnostic, so a `YggWinSequence` exporter can be added like
  the [[Spinner Unity Phase 5|Spinner's Unity phases]].

Related: [[Win Sequences Design]] · [[Scene Studio]] · [[Scene Studio Phase Status]] · [[Spinner Design]]
