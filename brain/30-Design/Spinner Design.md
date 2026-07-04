---
type: design
tool: Spinner
category: 🎬 Scene Studio
status: shipped
updated: 2026-07-04
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
- **Animations-only symbols** (2026-07-04) — a symbol can skip static art entirely
  (`animOnly: true`): its idle texture is baked from the landing/win Spine animation's
  first frame at build time, and it holds its last computed pose after a win instead of
  reverting to a static. Web-only so far — `YggSpinner.cs` has no Unity-side equivalent
  yet (§3 of SPINNER.md).
- **Reusable spin re-roll** (2026-07-04) — one seeded-outcome path
  (`spinnerModel.targetBoardForClip`) serves the director node, a timeline clip's own
  outcome selector, and the wizard's test-spin preview; "re-roll" bumps a seed so the
  same threshold lands a different board.

Related: [[Scene Studio]] · [[Scene Studio Design]]
