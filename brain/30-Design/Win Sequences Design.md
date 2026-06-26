---
type: design
tool: Win Sequences
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-26
source: react-app/WIN_SEQUENCES.md
tags: [design, scene-studio, win-sequences, spine, slot]
---

# Win Sequences — Design (Scene Studio Phase 6)

> [!info] Canonical source
> Full design + Phase 1 session log: [`react-app/WIN_SEQUENCES.md`](../../react-app/WIN_SEQUENCES.md).
> Phase 1 (web + timeline) shipped — see [[Win Sequences Phase 1]].

The **second wizard-built** Scene Studio object after the [[Spinner Design|Spinner]],
reached from the **🪄 wizards** panel (now in the left stack, between the hierarchy
and the workspace). A win-sequence object is a single Spine skeleton
(`win_sequence.json`) whose animations are mapped to win tiers and chained into
escalation **flows**; on the timeline it behaves like a Spine object whose
"animations" are those flows.

## Key concepts

- **Naming convention** `NNx_tier_sub` — the number belongs to the **tier**, not its
  position (`big` is always `04` even when `medium`/`large` are skipped; the gap
  stays). Sub order `begin → idle → end`; escalation small → medium → large → big →
  super → mega → max.
- **Flows (escalation from small).** Every enabled+present tier T gets a flow that
  climbs from `small` through each enabled present tier ≤ T, playing each tier's
  `begin → idle` and **only the final tier's `end`**. Missing tiers are skipped.
- **`large` (03) and `max` (07) gated** behind wizard toggles (default off) per the
  Design rule, even when their animations exist on the skeleton.
- **Manual assignment** — every tier row exposes begin/idle/end dropdowns of the
  skeleton's full animation list, so anything the name-matcher misses can be assigned
  by hand (and undetected tiers built manually). Assigning to a non-optional tier
  auto-enables it.
- **Clip behaviour** — a winseq layer drags onto the timeline like a Spine layer;
  each clip picks a **flow**. "Set duration" computes one full chained cycle from the
  live skeleton. **Hang on last idle** (`clip.winseq.hangOnLastIdle`) drops the
  terminal `_end` and loops the final idle (the in-game "wait for tap" state).
- **Durations are not persisted** — the runtime/inspector read them from the live
  Spine skeleton, so the object self-heals if the skeleton changes.

## Full-focus wizard (shared with Spinner)

Opening the wizard auto-switches to **setup mode**, hides the hierarchy + inspector,
docks the wizard as a wide vertical right-side column, and takes over the scene view
with a live preview rendered through the **one** Pixi renderer (a synthetic preview
scene swapped in, mirroring scenario `directPreview`) — so there is never a second
`Application`. As of 2026-06-26, wizard mode also defaults the scene view to **frame
behind** (restoring the prior overlay on close) so the previewed object isn't greyed
by the in-front frame.

## Data model

```js
// asset
{ id, type: 'winseq', src, atlas, texture,   // the win_sequence.json triplet
  winseq: { rev, tiers: [{ key, begin, idle, end, enabled }, …] },  // sequences DERIVED
  meta: { originalName } }

// clip
clip.winseq = { sequenceId, hangOnLastIdle }
```

## Phases

- **Phase 1 — web + timeline (SHIPPED 2026-06-26).** Model, runtime, wizard, timeline
  + inspector integration. Build green, 15/15 model tests.
- **Phase 2 — Unity export (future).** A `winseq` layer currently emits a "not
  supported yet" export warning (not a crash); the framework-agnostic model means a
  `YggWinSequence` exporter can be added like the Spinner's Unity phases.

Related: [[Scene Studio]] · [[Scene Studio Design]] · [[Spinner Design]] · [[Win Sequences Phase 1]]
