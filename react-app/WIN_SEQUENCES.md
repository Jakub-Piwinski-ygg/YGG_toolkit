# Win Sequences — Scene Studio Phase 6

> **Phase 1 — COMPLETE (2026-06-26).** Web + timeline shipped and verified
> (build green, 15/15 model tests). Unity export is intentionally out of scope
> for Phase 1 (a `winseq` layer produces a "not supported yet" export warning,
> not a crash) — the pure model is framework-agnostic so a `YggWinSequence`
> exporter can be added later.
>
> **Phase 2 — count-up Win Number — COMPLETE (2026-06-26).** A bitmap-font win
> amount that follows a `TEXT_` bone (Unity-BoneFollower style) and counts up as
> the sequence escalates. New skippable wizard step, locked hierarchy child,
> build green + 9/9 new model tests. See **§ Phase 2** below.

## Phase 2 — Win Number (count-up display)

A win sequence can carry an optional **count-up number** — a bitmap-font win
amount (e.g. `120.00 $`) rendered from a 2048×2048 atlas (8×8 grid, 256px/cell,
fixed glyph layout) that **follows a spine bone** and **counts up** as the
sequence climbs through its tiers.

- **Wizard step "2. Number"** (between Skeleton and Sequences) — fully skippable
  (skip = behaves exactly like Phase 1). Auto-detects the font png (name
  contains `win`/`font`/`number`) and the follow bone (first `TEXT_`/`text_`).
  Configures currency (`$ € ₽ £ ₺ ₹ kr`), currency **position** (prefix `$ 2137.00`
  — default — or suffix `2137.00 $`), decimal separator, decimals, wager, glyph
  scale (default 1) / letter-spacing / baseline, with a glyph-grid verify. The
  scene-view preview shows a fixed **sample** (`2137`) on this step so spacing/
  scale/format can be inspected; on the Sequences step it does the live count-up.
- **Locked hierarchy child:** a `winnumber` layer parented to the win-sequence
  layer (`locked: true`). Selectable + offset/scale-tweakable, but can't be
  dragged out, reparented, or deleted on its own; deleting the win-sequence
  removes it. Its Pixi object is a child of the Spine container, so the bone's
  skeleton-space transform IS its local transform (replicating spine-pixi-v8's
  own `updateSlotObject` matrix verbatim: `a=a, b=c, c=-b, d=-d, tx=worldX,
  ty=worldY`). The user offset/scale composes on top.
- **Count-up ladder (× wager, fixed):** tier thresholds small=0 medium=1 large=10
  big=20 super=40 mega=80; each tier segment ramps from its threshold to the next
  **present** tier's threshold; the terminal tier ramps to its final
  (medium→10 large→20 big→40 super→80 mega→120 max→240). Standalone `win_small`
  shows a sub-bet final with no count-up (no celebration ≤ bet). The value is a
  pure, scrub-safe function of (flow, durations, clip-local t, wager).
- **Config** lives on the winseq asset as `asset.winseq.number` (single source of
  truth; the `winnumber` asset stores only `parentAssetId`). Edit via the
  inspector's "✎ edit number…" (reopens the wizard on the Number step).

**Phase 2 implementation map** — pure model + count-up:
`engine/winseq/winNumberModel.js` (+ `.test.mjs`); Pixi atlas slicing + glyph
layout: `winNumberView.js`; bone-follow + count-up driver: `winNumberRuntime.js`;
build/apply/reset/hash/syncTransforms-skip + bone list: `pixiApp.js`,
`spineLoader.js` (`describeSpine.bones`); `locked` layer flag + `winnumber` asset
type: `sceneModel.js`; wizard Number step: `WinSequenceWizard.jsx`; locked-child
create/reconcile/cascade-delete/reorder-guard: `SceneStudioInner.jsx`; lock UI:
`HierarchyPanel.jsx`; edit button: `InspectorPanel.jsx`.

## Phase 1 — status & session log

Win Sequences is the second wizard-built Scene Studio object after the Spinner.
**Phase 1 = the web authoring + timeline runtime** (everything below); **Phase 2
(future) = Unity `.unitypackage` export**, mirroring the Spinner's Phase 5 →
Unity-phase split.

| Session | What landed |
|---|---|
| **2026-06-24** | Design doc + pure model (`winseqModel.js`) + Spine-backed runtime (`winseqRuntime.js`). Tier parse (`NNx_tier_sub`), tier→flow escalation, normalize/derive sequences, flow eval (step + local time), duration sums, `hangOnLastIdle`, `large`/`max` gated default-off. First web + timeline render. |
| **2026-06-25** | Wizard (`WinSequenceWizard.jsx`): skeleton-triplet fetch, tier auto-map **+ manual per-tier begin/idle/end dropdowns**, flow generation, in-panel preview transport. Model refinements + the full 15-test suite (`winseqModel.test.mjs`): single-frame anims respected, unknown-anim fallback, hang-mode final-idle loop. |
| **2026-06-26** | Wizard entry points **moved from the toolbar into the left stack** (under the hierarchy, above the workspace) — see `StudioToolbar.jsx` / `SceneStudioInner.jsx`. Workspace-lock gate (grey-out + centered forced load when no root). Wizard mode now defaults the scene view to **frame behind** (saving/restoring the prior overlay on close) so the previewed object isn't greyed by the in-front frame. Phase 1 declared complete. |

> The wizards foldout referenced below as **🪄 wizards ▾** now lives as a
> dedicated panel in the left stack (between the hierarchy and the workspace),
> not in the toolbar.

A second wizard-built Scene Studio object (alongside the Spinner), reached from
the toolbar **🪄 wizards ▾** foldout. A win-sequence object is a single Spine
skeleton (`win_sequence.json`) whose animations are mapped to win tiers and
chained into escalation **flows**; on the timeline it behaves like a Spine
object whose "animations" are those flows.

> **Wizards are full-focus in-place panels, not modals.** Opening a wizard
> (Spinner or Win Sequences) auto-switches to **setup mode**, hides the
> hierarchy + inspector, docks the wizard as a **wide vertical right-side column**
> (`WIZARD_PANEL_W`, wider than the inspector), and takes over the **scene view**
> with a live preview rendered through the main viewport's own renderer (a
> synthetic preview scene swapped in, mirroring scenario `directPreview`).
> Closing the wizard restores the previous layout + scene. This avoids the
> second-`Application` crash entirely — there is only ever one Pixi renderer.
>
> The wizard panel keeps a transport: a color-coded begin/idle/end timeline
> strip (segments sized by real durations) with play/scrub + current-anim label
> that **drives the scene-view preview** (`onTime` → `onPreviewTime`).
>
> **Mode gating:** wizards and "add asset to hierarchy from the workspace" only
> happen in setup mode — triggering either from another mode auto-switches to
> setup first.

## Naming convention

Animations are `NNx_tier_sub`:

```
01a_small_begin  01b_small_idle  01c_small_end
02a_medium_begin 02b_medium_idle 02c_medium_end
03a_large_begin  03b_large_idle  03c_large_end     (optional — Design only)
04a_big_begin    04b_big_idle    04c_big_end
05a_super_begin  05b_super_idle  05c_super_end
06a_mega_begin   06b_mega_idle   06c_mega_end
07a_max_begin    07b_max_idle    07c_max_end       (optional — Design only)
```

- **The number belongs to the tier, not its position.** `big` is always `04`
  even when `medium`/`large` are skipped — the gap stays, nothing renumbers.
- Sub order: `begin → idle → end`.
- Escalation order: small → medium → large → big → super → mega → max.

## Flows (escalation, from small)

Every enabled+present tier T gets one flow that climbs from `small` through each
enabled present tier ≤ T, playing each tier's `begin → idle`, and **only the
final tier's `end`** (intermediate ends are skipped). Missing tiers are simply
skipped — the chain jumps to the next present tier.

```
win_small  : 01a → 01b → 01c
win_medium : 01a → 01b → 02a → 02b → 02c
win_big    : 01a → 01b → 02a → 02b → 04a → 04b → 04c   (large 03 disabled → skipped)
```

`large` (03) and `max` (07) are gated behind wizard toggles (default off) per the
Design rule, even when their animations exist on the skeleton.

**Manual assignment:** every tier row in the wizard exposes begin/idle/end
**dropdowns** populated with the skeleton's full animation list, so anything the
name-matcher misses can be assigned by hand (and tiers not auto-detected can be
built manually). Assigning an animation to a non-optional tier auto-enables it.

## Clip behaviour

- A win-sequence layer drags onto the timeline like a Spine layer. Each clip
  picks a **flow** (the per-clip selector mirrors Spine's animation picker).
- **Set duration**: the inspector computes the full chained sequence time
  (one cycle of every animation) and sets the clip length. Durations come from
  the live skeleton via the asset descriptor — same source spine clips use.
- **Hang on last idle** (`clip.winseq.hangOnLastIdle`): drops the terminal
  `_end` so the sequence holds on its final idle (the in-game "wait for the
  player to tap" state). Toggling it **recomputes the clip duration** to the
  end-less length.
- Idle steps play exactly **one cycle** in normal mode; in hang mode the final
  idle loops.

## Implementation map

| Concern | File |
|---|---|
| Pure model (tiers, parse, flows, normalize, eval, durations) | `src/tools/SceneStudio/engine/winseq/winseqModel.js` (+ `.test.mjs`) |
| Pixi driver (Spine-backed, scrub-safe `setAnimation + trackTime`) | `src/tools/SceneStudio/engine/winseq/winseqRuntime.js` |
| Build / apply / reset / hash / onAssetReady wiring | `engine/pixiApp.js` |
| `clip.winseq` payload + `winseq` asset type | `engine/sceneModel.js` |
| Wizard (skeleton fetch + tier map + flow gen + DOM preview) | `components/WinSequenceWizard.jsx` |
| Wizard launcher panel (left stack, under hierarchy / above workspace) | `SceneStudioInner.jsx` (`.scene-wizards-panel`) |
| Create/edit/update handlers + render | `SceneStudioInner.jsx` |
| Clip inspector (flow picker, hang, set-duration, re-edit) | `components/InspectorPanel.jsx` |
| Timeline clip label + flow picker + default duration | `components/TimelinePanel.jsx` |

## Data model

```js
// asset
{ id, type: 'winseq', src, atlas, texture,   // the win_sequence.json triplet
  winseq: {
    rev,                                      // bumps on wizard re-run → Pixi rebuild
    tiers: [{ key, begin, idle, end, enabled }, …],  // mapping (source of truth)
    // sequences are DERIVED from tiers by normalizeWinSeqConfig (not persisted raw)
  },
  meta: { originalName } }

// clip
clip.winseq = { sequenceId, hangOnLastIdle }
```

Durations are **not** persisted — the runtime/inspector read them from the live
Spine skeleton, so the object self-heals if the skeleton changes.
