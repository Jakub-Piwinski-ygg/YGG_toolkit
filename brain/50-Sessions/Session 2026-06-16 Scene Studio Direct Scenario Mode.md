---
type: session
tool: Scene Studio
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-16
source: react-app/SCENE_STUDIO_DIRECT.md
tags: [session, scene-studio, scenario, node-graph, changelog]
---

# Session 2026-06-16 — Scene Studio Direct (scenario) mode

A whole **third studio mode** landed: `direct`, a Unreal-Blueprint-style node graph
that sequences the timelines authored in *animate* into a branching **scenario** and
plays the resulting flow start→end in the same Pixi preview. Design doc:
[[Scene Studio Direct Mode]] (mirror of `react-app/SCENE_STUDIO_DIRECT.md`). P1–P4
shipped + a playback refit, all in one push (commits `167dd3a` fixes, `ddbedad`).

## What shipped

- **Project-level scenarios** — `project.scenarios[]` + `project.activeScenarioId`,
  schema bumped to **`ygg-project/2`** (back-compat: absent = `[]`). Each `timeline`
  node binds to `{sceneId, timelineId}`; dangling nodes are kept + flagged.
- **`engine/scenarioModel.js`** — pure CRUD + node/edge ops + `resolveWalk` +
  `listProjectTimelines`; per-source active-edge exclusivity; `setEdgeTransition` /
  `setNodeEntry`. Normalized in `validateProject`, persisted in `saveProject`. Tested
  (`scenarioModel.test.mjs`).
- **Graph UI** — `ScenarioGraphPanel` (header bar + dotted-grid canvas + transport),
  `ScenarioTimelineList` (left list, drag source), `ScenarioInspectorSections` (right
  panel). Middle-mouse pan + wheel-zoom-around-cursor, node drag, pin drag-to-connect
  with rubber-band, active-edge click (yellow + sibling reset), Delete removal, view +
  positions persisted to `scenario.view` / node x,y.
- **Playback refit (the key change)** — the initial P3 linear state machine
  (`scenarioRuntime.js`) was **replaced** by a **global-time, scrubbable** model:
  - `engine/scenarioTimeline.js` flattens the active-edge walk into end-to-end segments
    (crossfades = overlap windows); `sampleScenario(T)` maps one global time → timeline
    + local time → preview pose. A **scrubber bar** drags the whole flow.
  - Preview swaps to the current node's **origin scene** (`directPreviewScene`) and
    feeds the unchanged `PixiViewport`.
  - `engine/scenarioBlend.js` makes **same-scene crossfades actually render** (blends
    position/scale/rotation/alpha/tint of the two timelines into the preview pose).
    Cross-scene crossfades still cut at the midpoint.
  - Per-timeline speed + startOffset honoured by the segment math.
- **Inspector (P4)** — scenario summary / timeline-node editor (label, branch
  add/remove, entry options) / edge transition editor (cut/crossfade/hold, mix
  duration, per-channel toggles).
- **Graph fx** — per-node progress fill, playing/intro/outro glow, travelling-dash on
  the live edge, validity chip, ▶ gated on `resolveWalk`.

## Open / deferred

- **P5** — auto-arrange, minimap, breadcrumb, edge-insert; `YggScenarioPlayer.cs` +
  scenario payload baked into the `.unitypackage` (data, not frames).
- Cross-scene crossfade rendering + **wait-for-click** authored but preview as a cut.
- Direct-mode edits **bypass the scene undo stack** (mutate the project directly).
- Per-layer (vs global) channel crossfade overrides.

> [!note] Doc sync
> The canonical Polish changelog (`react-app/SCENE_STUDIO_PHASE_STATUS.md`) did **not**
> yet carry a Direct-mode entry as of this session; the canonical design lives in
> `react-app/SCENE_STUDIO_DIRECT.md`. See [[Docs dual system]].

Related: [[Scene Studio]] · [[Scene Studio Direct Mode]] · [[Scene Studio Phase Status]]
