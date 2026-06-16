# Scene Studio — "Direct" mode (scenario node graph)

> Status: **DESIGN** (2026-06-15). Third studio mode after `setup` and
> `animate`. Sequences the timelines authored in *animate* into a
> node-graph "scenario" — Unreal-Blueprint-style — and previews the
> resulting flow start→end. Companion doc to `SCENE_STUDIO.md` (§20 =
> as-built animation) and `SPINNER.md`.

---

## 1. Goal & one-paragraph summary

*Animate* mode produces reusable **timelines** (`scene.timelines[]`). *Direct*
mode is the next step: arrange those timelines as **nodes** in a graph, wire
them **pin→pin** into an ordered (and optionally branching) **scenario**, mark
the **active path**, and hit **play** to watch the whole flow run in the same
Pixi preview — one timeline handing off to the next from a green **start** node
to a red **end** node. Branch *selection* is purely a preview convenience: at
runtime the real branching is decided in Unity, so Direct mode never needs
logic gates — only "which branch do I want to watch right now."

The mode reuses three things wholesale: the existing **mode switch**, the
existing **timeline data model**, and the existing **Pixi preview + single
timeline interpreter**. The new surface area is a node-graph editor and a thin
scenario *runtime* that drives the existing interpreter one timeline at a time.

---

## 2. Where it plugs into today's architecture

| Existing piece | Today | Under Direct mode |
|---|---|---|
| `studioMode` state (`SceneStudioInner`) | `'setup' \| 'animate'` | add `'direct'` |
| `StudioToolbar` mode group | 2 buttons | add **direct** button (clapperboard/route icon) |
| **Left stack** (`scene-left-stack`) | Hierarchy + Asset browser | **Timeline list** (`ScenarioTimelineList`) |
| **Center bottom** (the `timelineH` split that holds `TimelinePanel` in animate) | TimelinePanel | **`ScenarioGraphPanel`** (top bar + node canvas) |
| **Center top** (`PixiViewport`) | Live stage | **Same preview**, driven by the scenario runtime |
| **Right** (`InspectorPanel`) | layer/clip sections | node/transition sections (mostly future) |
| `scene.timelines[]` | authored in animate | **read-only source** of timeline nodes |
| `flowInterpreter.tickFlow` / `flowState` | drives the active timeline | wrapped by `scenarioRuntime` per node |
| Project persistence (`foldSceneIntoProject`) | saves `scene.data` | saves `scene.scenarios[]` for free |

Key insight: the center stack is **already** a vertical split (`1fr /
timelineH`). Direct mode keeps the Pixi preview on top and substitutes the
bottom pane — so "preview while you wire" comes free, and the existing
row-resize handle works unchanged.

---

## 3. Data model

Scenarios are **scene-scoped** (they reference timeline ids that live on the
scene), so they live on the scene object next to `timelines[]`. Because
`splitScene`/`foldSceneIntoProject` persist everything on `scene.data`, no
persistence work is needed beyond normalization in `validateScene`.

```jsonc
// added to scene.json (schema bump → ygg-scene/3, back-compat: absent = [])
{
  "scenarios": [
    {
      "id": "SC_xxx",
      "name": "Base game → free spins",
      "nodes": [
        { "id": "n_start", "type": "start", "x": 80,  "y": 200 },
        { "id": "n_end",   "type": "end",   "x": 900, "y": 200 },
        {
          "id": "n_a", "type": "timeline",
          "timelineId": "TL_intro",
          "x": 320, "y": 160,
          "outputs": ["o_a0"],          // 1+ output pins (branches)
          "collapsed": false,
          "label": null                  // optional per-node override of timeline name
        }
      ],
      "edges": [
        {
          "id": "e1",
          "from": { "node": "n_start", "pin": "out" },
          "to":   { "node": "n_a",     "pin": "in"  },
          "active": true,
          "transition": null            // see §9 (key mixing) — future
        }
      ],
      "view": { "panX": 0, "panY": 0, "zoom": 1 }  // per-scenario canvas camera
    }
  ],
  "activeScenarioId": "SC_xxx"
}
```

### Node kinds
- **`start`** — exactly one per scenario. One **output** pin on the right. Deep
  green (`--ss-start: #1f7a3d`-ish). No input. Cannot be deleted.
- **`end`** — exactly one. One **input** pin on the left. Deep red
  (`--ss-end: #9b2226`). No output. Cannot be deleted.
- **`timeline`** — references a `scene.timelines[]` entry by `timelineId`. One
  **input** pin (left), **N output** pins (right, default 1, `+`/`−` to add a
  branch). Body shows timeline name, clip/track count, and computed duration.

### Pin & edge rules
- An **input** pin accepts many incoming edges (fan-in is allowed — several
  branches can converge on one timeline).
- An **output** pin connects to **exactly one** target (one edge per output
  pin). Multiple *branches* ⇒ multiple *output pins*.
- No self-loops; cycles are *allowed in data* but flagged (see §7 cycle guard).
- `start.out` and `end.in` are single, fixed pins.

### Active path (the "yellow" selection)
- Each edge has `active: boolean`. Inactive = grey/white; active = **yellow**.
- **Per-source-node exclusivity:** clicking an edge sets it active and clears
  `active` on every *other edge leaving the same source node*. This is the
  precise reading of "select a path → unselect the previous one": you're
  choosing *which branch this node takes* for the current preview. start and
  end nodes have a single edge, so the rule degenerates to a plain toggle.
- The **resolved walk** = follow active edges from `start`; the set of active
  edges therefore defines one deterministic path (plus any unreached
  branches, which render dimmed).

---

## 4. UI layout & interaction

### 4.1 Left — `ScenarioTimelineList`
Replaces Hierarchy + Asset browser while in direct mode.
- One row per `scene.timelines[]`: name, small meta (`3 tracks · 2.4s`), and a
  thumbnail dot colour-keyed to the timeline.
- **Draggable** (`draggable`, `dataTransfer` mime
  `application/x-ygg-timeline-id`). Drop onto the canvas spawns a timeline node
  at the drop point (`canvas.screenToGraph(x,y)`).
- Double-click a row → "jump to animate mode editing this timeline" (workflow
  glue; opens animate with that timeline active).
- A timeline already present in the scenario shows a "× in graph" badge (you
  *can* place it more than once — reusing a timeline is valid).

### 4.2 Center-bottom — `ScenarioGraphPanel`
A header bar + an infinite, pan/zoom node canvas.

**Header bar (left→right):**
- Scenario `<select>`: list scenarios + `＋ new scenario…` + `⎘ duplicate…`
  (mirrors the existing scene picker pattern in `StudioToolbar`).
- Inline rename (✎), delete (with confirm).
- Divider.
- **▶ play · ⏸ pause · ⏹ stop · ↺ reset** transport (drives the scenario
  runtime, §6).
- Right side: validity chip (`✓ playable` / `⚠ no path from start`),
  **⤢ maximize graph** toggle (collapses preview to a draggable PiP),
  **fit / 100% / auto-arrange** view buttons.

**Canvas:**
- Dotted grid background; pan (space-drag or MMB), zoom (wheel) — reuse the
  panning math from `engine/viewportController.js`.
- Nodes are HTML/SVG (not Pixi) for crisp text + easy hit-testing; edges are
  one SVG `<path>` layer (cubic béziers, horizontal tangents).
- **Wire a connection:** press a pin → drag → release on a compatible pin.
  Live "rubber-band" bézier follows the cursor; invalid targets are dimmed.
- **Select active branch:** left-click an edge → turns yellow, siblings reset.
- **Delete:** node (Del) removes it + its edges; edge (Del / right-click) removes it.
- Multi-select + marquee for moving node clusters (nice-to-have, phase 2).

### 4.3 Right — Inspector (mostly future, §9)
- **Nothing selected:** scenario summary (node count, resolved path length,
  total duration of the active walk).
- **Timeline node selected:** node label override, branch (output pin)
  add/remove, "open in animate", and *placeholder* for per-node entry options.
- **Edge selected:** the **transition / key-mixing** editor (§9) — shipped as a
  stub now, real in a later phase.

---

## 5. Components & modules to add

```
SceneStudio/
├── engine/
│   ├── scenarioModel.js       # CRUD + normalize + validate + walk resolution
│   ├── scenarioModel.test.mjs
│   └── scenarioRuntime.js     # playback state machine (wraps flowInterpreter)
├── components/
│   ├── ScenarioTimelineList.jsx   # left list, drag source
│   ├── ScenarioGraphPanel.jsx     # header bar + canvas host + transport
│   ├── ScenarioNode.jsx           # one node (start / end / timeline)
│   ├── ScenarioEdges.jsx          # SVG edge layer + rubber-band
│   └── ScenarioInspectorSections.jsx  # node/edge inspector (future-leaning)
└── styles/scene-studio.css        # .ss-scenario-* classes (extend existing file)
```

`scenarioModel.js` surface (mirrors the `sceneModel` timeline helpers so it
reads familiar):
```
createScenario(name)                       // seeds start+end nodes auto-placed
addScenario / removeScenario / renameScenario / setActiveScenario
duplicateScenario
addTimelineNode(sc, timelineId, x, y)
removeNode(sc, nodeId)                      // start/end protected
addOutputPin(sc, nodeId) / removeOutputPin
connect(sc, from, to)                       // enforces 1-edge-per-output
disconnect(sc, edgeId)
setActiveEdge(sc, edgeId)                   // per-source exclusivity
resolveWalk(sc)                             // → { order:[nodeId…], ok, reason }
normalizeScenario / validateScenarios       // called from validateScene
```

---

## 6. Scenario runtime (playback)

A small state machine that **reuses `flowInterpreter`** one timeline at a time
instead of re-implementing animation.

```js
// scenarioRuntime.js
createScenarioRun() => {
  scenarioId, status: 'idle'|'intro'|'playing'|'switching'|'outro'|'done',
  currentNodeId,            // start → timeline… → end
  localTime,                // seconds within the current timeline
  flow,                     // flowInterpreter state for the current timeline
  visited: [],              // nodeIds in play order (breadcrumb + cycle guard)
  fx: { phase, t0 }         // drives node fill %, flash, start/end fx
}
```

**Tick (called from the existing RAF loop in `SceneStudioInner`):**
1. `start` → run a short **intro** (green pulse, ~0.4 s), then jump to the node
   on `start`'s active edge. If start has no active edge → `status='done'`,
   surface "connect start to a timeline to play".
2. `timeline` node → set the runtime's active timeline = `node.timelineId`,
   advance `flow` with `tickFlow(timelineScene, flow, dt)`. `localTime` =
   `flow.time`. When the timeline ends (`time≥duration && !playing`):
   - emit a **flash** on the current node, mark visited,
   - follow the node's **active** output edge → next node (`switching` for ~1
     flash frame, applying the edge transition §9 when present),
   - if no active outgoing edge → go to `end` if reachable, else `done`.
3. `end` → run **outro** (red pulse), `status='done'`.
4. **Cycle guard:** if the next node is already in `visited` and would loop
   forever, stop with a "loop detected — add an end" notice (Unity owns real
   loops; preview is finite). A future `loop` node can make this intentional.

**Driving the preview:** `SceneStudioInner` builds `sceneWithRuntime` so that,
in direct mode while running, `.flow` is derived from the *current* timeline's
tracks and `flowTime = run.localTime`. `PixiViewport` already renders from
`scene.flow.tracks` + `flowTime`, so **no Pixi changes are required** for basic
playback. Timeline duration per node = `max(clip.start + clip.duration)` (the
same content-end calc the auto-fit effect already uses), cached per node.

Transport buttons map to: `play`→start the run from `start`; `pause`→freeze;
`stop`→`idle` + clear preview; `reset`→rewind to `start` without auto-playing.

---

## 7. Validation & guards

- **Playable** = there is an active-edge walk from `start` reaching at least
  one timeline node. Header chip reflects it; ▶ is disabled otherwise with a
  tooltip ("connect Start → a timeline").
- **Unreachable nodes** (no active path from start) render **dimmed**; their
  edges dashed-grey.
- **Dangling timeline node** (its `timelineId` no longer exists — timeline
  deleted in animate) renders with a **red "missing timeline"** badge and is
  skipped at runtime (logged). `resolveWalk` reports it.
- **Multiple active siblings** can never happen (exclusivity enforced on write).
- A scenario always keeps its start + end (delete is blocked on those).

---

## 8. Visual language (the "alive" feel)

Per the brief, playback should *read at a glance*:

- **Start node** deep green; **End node** deep red; timeline nodes neutral
  slate with the accent edge colour.
- **Running fill:** the active timeline node fills left→right with a translucent
  accent bar tracking `localTime / duration` (a CSS `background` gradient stop
  bound to progress) — a literal progress fill *inside* the node.
- **Hand-off flash:** when a node completes, it does a 1-frame bright flash and
  the chosen outgoing edge **pulses** (animated dash-offset travelling toward
  the next node). The next node briefly scales 1.0→1.06→1.0.
- **Active edge:** solid **yellow**; while that edge is the one being traversed,
  add the travelling-dash animation so you see *where the flow is*.
- **Start fx:** green ripple from the start node on ▶. **End fx:** red ripple +
  "done" badge on completion.
- **Idle vs running** edges: idle active edges are steady yellow; non-active
  branches are thin grey.

All of this is CSS/SVG-driven from the `run.fx` phase + per-node progress, so it
costs nothing in Pixi and survives the rapid-rebuild crash class entirely.

Suggested tokens (add to `tokens.css` / scoped in `scene-studio.css`):
```
--ss-start:#1f7a3d; --ss-start-glow:#3fcf6e;
--ss-end:#9b2226;   --ss-end-glow:# e5484d;
--ss-edge:#8a8f98;  --ss-edge-active:#ffd23f; --ss-node:#262a31;
```

---

## 9. Inspector: transitions & key mixing (future, data shape now)

The brief asks to "leave the inspector for stuff we might add… like mixing of
keys" — e.g. last timeline ends at `alpha 0`, next starts at `alpha 1`; you may
want to blend. We reserve this on the **edge** so it describes the *hand-off*:

```jsonc
"transition": {
  "mode": "cut" | "crossfade" | "hold",   // cut = snap (default)
  "mixDuration": 0.3,                       // seconds of overlap
  "channels": {                             // per-layer / per-channel opt-in
    "*": true,                              // blend everything, OR…
    "L_logo": { "alpha": true, "position": false }
  }
}
```

This piggybacks on the per-clip `mixDuration` / blend concept already in
`normalizeClip`. The runtime would, during `switching`, overlap the tail of
timeline A with the head of timeline B for `mixDuration`, lerping the opted-in
channels. **Phase-gated** — ship the inspector section as a read-only stub first;
the runtime honours `mode:'cut'` until crossfade lands.

The node inspector also reserves room for **entry options** (per-node speed
multiplier, "wait for click before continuing", start offset) — all optional
and Unity-exportable later.

---

## 10. Unity export

Because real flow control lives in Unity, export the scenario as **data**, not
baked frames: emit a `YggScenario` payload (nodes, edges, active-path, per-node
`timelineId`, transitions) into the existing `.unitypackage` pipeline (`unity/`)
alongside the per-timeline animation clips already produced. A generated
`YggScenarioPlayer.cs` (sibling to `YggSpinner.cs`) plays timelines in sequence
and exposes branch selection to game code. **Out of scope for the first
implementation phase** — listed so the data model (stable ids, explicit pins)
is export-ready from day one.

---

## 11. Suggested improvements (beyond the brief)

1. **Per-source-pin active exclusivity** (not global) — already folded into §3;
   it's what makes a full branching walk previewable.
2. **Preview-as-you-wire** by reusing the center split — no new preview surface.
3. **Maximize-graph PiP** so the node view can go full-height when wiring big
   graphs, preview shrinking to a corner.
4. **Auto-arrange** (simple layered/Sugiyama left→right) + **fit to view** — big
   quality-of-life win for graphs built by drag-drop.
5. **Breadcrumb / mini-timeline** under the header showing the resolved walk as
   chips (`Start › Intro › Win › End`) with the live position highlighted.
6. **Branch labels** on output pins (e.g. "win", "lose") — pure annotation now,
   becomes the Unity branch key later.
7. **Minimap** for large scenarios (phase 3).
8. **Dim non-active branches during play** so the eye follows the live path.
9. **Validation chip + disabled play** instead of silent no-op.
10. **`loop` node** (future) to express intentional repeats the cycle-guard
    would otherwise stop.
11. **Drag a timeline onto an existing edge** to *insert* it between two nodes
    (splices the connection) — fast linear authoring.

---

## 12. Implementation phases

- **P1 — Skeleton & data.** `studioMode:'direct'` + toolbar button; schema
  bump (`scenarios[]`, `activeScenarioId`) + `validateScene` normalize;
  `scenarioModel.js` + tests; left `ScenarioTimelineList`; empty
  `ScenarioGraphPanel` shell wired into the center-bottom slot; scenario
  picker/new/rename/delete.
- **P2 — Graph editing.** Node render (start/end/timeline), drag-to-place from
  the list, pan/zoom canvas, pin drag-to-connect, edge SVG layer, active-edge
  click selection (yellow + exclusivity), delete, persistence round-trip.
- **P3 — Playback.** `scenarioRuntime.js` + RAF integration;
  `sceneWithRuntime` flow swap; transport buttons; running fill + flash + edge
  pulse + start/end fx; validation chip; cycle guard.
- **P4 — Inspector & transitions.** Node + edge inspector sections; crossfade /
  key-mixing data + runtime; per-node entry options.
- **P5 — Polish & export.** Auto-arrange, minimap, breadcrumb, edge-insert;
  `YggScenarioPlayer.cs` + scenario payload in `.unitypackage`.

---

## 13. Open questions

1. **Branch model confirmation:** multiple **output pins** per timeline node
   (Blueprint-style), with one active edge per node — agree? (Alternative:
   single output pin with multiple edges and one active.) This doc assumes the
   former.
2. **Timeline reuse:** allow the same timeline as multiple nodes in one
   scenario? (Assumed **yes**.)
3. **Fan-in:** allow several branches to converge on one timeline's input?
   (Assumed **yes**; matters for the walk resolver.)
4. **Crossfade scope:** is per-channel mixing (vs whole-layer) needed in v1 of
   the transition editor, or is a single `mixDuration` + "blend all" enough?
5. **Scenario scope:** scene-level (this doc) vs project-level (sequence
   timelines across scenes)? Scene-level is simpler and matches "timelines from
   *this* creator"; project-level is a bigger lift.
