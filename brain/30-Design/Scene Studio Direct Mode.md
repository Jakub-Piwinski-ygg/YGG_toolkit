---
type: design
tool: Scene Studio
category: 🎬 Scene Studio
status: in-progress
updated: 2026-07-03
source: react-app/SCENE_STUDIO_DIRECT.md
tags: [design, scene-studio, scenario, node-graph, pixi]
---

# Scene Studio — Direct Mode (scenario node graph)

> [!info] Canonical source
> Full design doc: [`react-app/SCENE_STUDIO_DIRECT.md`](../../react-app/SCENE_STUDIO_DIRECT.md).
> Companion to [[Scene Studio Design]] (§20 = as-built animation) and [[Spinner Design]].
> Phase changelog lives in [[Scene Studio Phase Status]].

> [!success] Status — P1–P4 shipped + scrubber/crossfade refit (2026-06-16);
> P4.x QoL batch shipped (2026-07-03): **hold/crossfade pose carry** (the web
> preview now honours all three transition modes — hold keeps the outgoing
> pose, crossfade blends from it; cut still snaps), **per-node spin outcome
> overrides** (no/small/big/wild win, name-based symbol tiers, boards carried
> downstream), chained ＋ node spawn with a focus tween, ⏮ + mode-aware Space
> transport, playing-segment scrubber highlight. See
> [[Session 2026-07-03 Scene Studio Direct QoL]]. P5 (auto-arrange, minimap,
> Unity scenario export incl. outcome-generator parity) pending.

## TL;DR

The **third studio mode** after `setup` and `animate`. *Animate* mode produces
reusable **timelines** (`scene.timelines[]`); *Direct* mode arranges those timelines
as **nodes** in an Unreal-Blueprint-style graph, wires them **pin→pin** into an
ordered (and optionally branching) **scenario**, marks the **active path**, and plays
the whole flow start→end in the **same Pixi preview** — one timeline handing off to
the next from a green **start** node to a red **end** node.

Branch *selection* is purely a preview convenience: real branching is decided in
Unity at runtime, so Direct mode has **no logic gates** — only "which branch do I
want to watch right now." It reuses the existing **mode switch**, **timeline data
model**, and **Pixi preview + single-timeline interpreter** wholesale; the new surface
is a node-graph editor and a thin scenario runtime.

## Data model

Scenarios are **project-level** (the one deviation from the original scene-scoped
sketch): `project.scenarios[]` + `project.activeScenarioId`, schema bumped to
**`ygg-project/2`** (back-compat: absent = `[]`, older `/1` files still load). Each
`timeline` node carries **both `sceneId` and `timelineId`**, so it stays strongly
bound to the scene that authored the timeline and can never reference an orphan.
Dangling timeline nodes (origin scene/timeline gone) are **kept and flagged**, never
silently pruned.

Model + CRUD + walk resolver live in `engine/scenarioModel.js` (pure data, tested in
`scenarioModel.test.mjs`); `validateProject` normalizes scenarios and `saveProject`
persists them.

**Node kinds:** `start` (one, green, output pin only, undeletable) · `end` (one, red,
input pin only, undeletable) · `timeline` (references a timeline by `{sceneId,
timelineId}`; one input pin, N output pins = branches).

**Pin & edge rules:** input pins accept many incoming edges (fan-in allowed); each
output pin connects to **exactly one** target; multiple branches ⇒ multiple output
pins. Cycles are allowed in data but flagged by the cycle guard.

**Active path (yellow):** each edge has `active: boolean`. Clicking an edge sets it
active and clears `active` on every *other edge leaving the same source node*
(per-source exclusivity = "choose which branch this node takes for the preview"). The
resolved walk follows active edges from `start`; unreached branches render dimmed.

## Modules & components

```
SceneStudio/
├── engine/
│   ├── scenarioModel.js       # CRUD + normalize + validate + resolveWalk + listProjectTimelines
│   ├── scenarioTimeline.js    # flatten active-edge walk → end-to-end segments; sampleScenario(T)
│   ├── scenarioBlend.js       # same-scene crossfade: blend transform channels of two timelines
│   └── *.test.mjs             # scenarioModel / scenarioTimeline / scenarioBlend tests
├── components/
│   ├── ScenarioTimelineList.jsx       # left list (project timelines grouped by scene), drag source
│   ├── ScenarioGraphPanel.jsx         # header bar + scrubbable node canvas + transport
│   └── ScenarioInspectorSections.jsx  # right panel: scenario summary / node / edge editors
└── styles/scene-studio.css            # .ss-scenario-* classes
```

`scenarioModel` surface: `createScenario` (seeds start+end) · `add/remove/rename/
setActive/duplicateScenario` · `addTimelineNode` · `removeNode` (start/end protected) ·
`addOutputPin`/`removeOutputPin` · `connect` (1-edge-per-output) · `disconnect` ·
`setActiveEdge` (per-source exclusivity) · `resolveWalk` → `{order, ok, reason}` ·
`setEdgeTransition`/`setNodeEntry` · `normalizeScenario`/`validateScenarios`.

## Playback — global-time scrubbable model (2026-06-16 refit)

The original P3 status-machine runtime (`scenarioRuntime.js`) was **replaced** by a
global-time, scrubbable model:

- **`engine/scenarioTimeline.js`** flattens the active-edge walk into segments laid
  end-to-end (crossfades become overlap windows). `sampleScenario(T)` maps a single
  global time → timeline + local time → preview pose (or a blend).
- A **scrubber bar** in the graph panel drags through the whole flow; it rebuilds
  whenever connections change.
- Because scenarios are project-level, the preview swaps to the **current node's
  ORIGIN scene** (`directPreviewScene`: that scene's layers + the shared asset pool,
  flow = the node's timeline tracks at the sampled local time) and feeds the unchanged
  `PixiViewport`.
- **Same-scene crossfades render** via `engine/scenarioBlend.js` — it blends transform
  channels (position/scale/rotation/alpha/tint) of the two timelines, baked into the
  preview pose. **Cross-scene crossfades still cut at the midpoint** (can't composite
  two scenes in one viewport).
- Per-timeline **speed** and **startOffset** are honoured by the segment math.

**Graph fx (CSS/SVG, costs nothing in Pixi):** per-node left→right progress fill,
playing/intro/outro glow, travelling-dash on the live edge, validity chip, transport
(▶ ⏸ ⏹ ↺) gated on `resolveWalk`.

## Inspector (P4)

`ScenarioInspectorSections` replaces the layer InspectorPanel in Direct mode:
- **Nothing selected** → scenario summary (timeline/edge counts, resolved active-path
  length + total duration).
- **Timeline node** → label override, branch (output pin) add/remove, per-node entry
  options (speed / start offset / wait-for-click), open-in-animate, delete.
- **Edge** → transition editor: `cut`/`crossfade`/`hold`, mix duration, per-channel
  blend toggles (`edge.transition`). Runtime honours speed + start offset + same-scene
  crossfade live; **wait-for-click** and cross-scene crossfade are authored + Unity-
  exported (P5) but preview as a cut for now. Per-layer (vs global) channel overrides
  deferred — v1 is global per-channel.

## Validation & guards

Playable = an active-edge walk from `start` reaches ≥1 timeline node (▶ disabled
otherwise). Unreachable nodes render dimmed; dangling timeline nodes get a red "missing
timeline" badge and are skipped at runtime. A scenario always keeps its start + end.

## Unity export (P5, pending)

Export the scenario as **data, not baked frames**: a `YggScenario` payload (nodes,
edges, active-path, per-node `timelineId`, transitions) into the `.unitypackage`
pipeline, plus a generated `YggScenarioPlayer.cs` (sibling to `YggSpinner.cs`) that
plays timelines in sequence and exposes branch selection to game code. The stable ids
+ explicit pins make the data model export-ready from day one.

## Phase status

- **P1 — Skeleton & data ✅** — `studioMode:'direct'` + clapperboard toolbar button;
  `ygg-project/2` schema; `scenarioModel.js` (19 tests); `ScenarioTimelineList`;
  `ScenarioGraphPanel` shell (picker/new/duplicate/rename/delete, validity chip,
  dotted-grid canvas, timeline drops).
- **P2 — Graph editing ✅** — node render, drag-to-place (+ `＋` per row), middle-mouse
  pan + wheel-zoom-around-cursor, node drag, pin drag-to-connect (rubber-band), active-
  edge click selection, Delete-key removal, view + positions persisted. *(Scenario edits
  bypass the scene undo stack — Direct-mode undo is later polish.)*
- **P3 — Playback ✅** — originally a linear state machine (`scenarioRuntime.js`),
  **refit 2026-06-16** to the global-time scrubbable model above.
- **P4 — Inspector & transitions ✅** — see Inspector section.
- **P5 — Polish & export (pending)** — auto-arrange, minimap, breadcrumb, edge-insert;
  `YggScenarioPlayer.cs` + scenario payload in `.unitypackage`.

## Open questions — RESOLVED (2026-06-16)

Branch model = multiple output pins (Blueprint-style) · timeline reuse = yes (×N usage
badge) · fan-in = yes · crossfade scope = per-channel in v1 · scenario scope =
project-level with each node strongly bound to `{sceneId, timelineId}`.

---

Related: [[Scene Studio]] · [[Scene Studio Design]] · [[Spinner Design]] ·
[[Scene Studio Phase Status]]
