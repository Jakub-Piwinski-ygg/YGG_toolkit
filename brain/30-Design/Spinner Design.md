---
type: design
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-06-14
source: react-app/SPINNER.md
tags: [design, scene-studio, spinner, slot]
---

# Spinner — Design (Scene Studio Phase 5)

> [!info] Canonical source
> Full design + milestone status: [`react-app/SPINNER.md`](../../react-app/SPINNER.md).
> Unity-export work is logged across [[Spinner Unity Phase 2]] → [[Spinner Unity Phase 5]].

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

Related: [[Scene Studio]] · [[Scene Studio Design]]
