---
type: tool
tool: Project Scaffold
category: 🏗️ Asset Pipeline
status: shipped
priority: P1
updated: 2026-06-24
tags: [asset-pipeline, unity, scaffold]
---

# Project Scaffold

Editable folder-structure tree designer: presets, leaf rules (spineAtLeastOne,
pngAtLeastOne…), exports a **single empty-folder scaffold ZIP** in the Unity
delivery layout + a reusable config JSON. Source: `ProjectScaffoldTool.jsx`.

- **Layout** (the only output): `<Project>/` → `_Game` (runtime art: `Export/*`
  leaves route here as `Animations/` + `StaticArt/`), `_Source` (working files:
  `Source/*` leaves), `_Previews` (per-node `preview` toggle), plus
  `.ygg-scaffold.json` at the project root. No `Art/` wrapper, no `unity_export/`.
  Routing is deterministic and built in-tool (does **not** go through the Asset
  Checker `resolveTarget` mappings) so nested features keep their full path —
  e.g. `_Game/NN_Intro_Outro/Free_Spins_Intro_Outro/Animations/`.
- **Defaults**: `Export/*` and `Source/*` leaf folders both ticked on; top-level
  elements get a `_Previews` entry; `BonusGame` is an addable common preset.
- **Base elements** (auto-created in the default tree): `Background`, `Symbols`,
  `Machine_Frame`, `Win_Sequence`, `Logo`, `Splash`, `Preloader`, `Win_Ticker`,
  `Fonts`.
- **Grouped common elements** (`GROUPED_ELEMENTS`): certain common-palette items
  nest under a shared, auto-created top-level parent group instead of landing at
  top level. Picking any member creates the parent group with that leaf inside;
  picking another member nests it into the *same* existing parent. Each child is a
  normal leaf feature (full `Export`/`Source` substructure). Current groups:
    - **`Intro_Outro`** ← `Free_Spins_Intro_Outro`, `Bonus_Intro_Outro`,
      `Pick_a_Prize_Intro_Outro`. (`Intro_Outro` is no longer a base element —
      the old `Transition` subfolder + auto-spawned preset were dropped, 2026-06-24.)
    - **`Counters`** ← `Multiplier_Counter`, `Free_Spin_Counter`.
- **Good**: leaf rules align 1:1 with [[Asset Checker]] coverage; JSON roundtrip
  (v3 config; loads legacy v1/v2); slug-safe naming; preset subtrees.
- **History**: was a dual SharePoint-ZIP / Unity-tree exporter — the Unity path
  re-used Asset Checker mappings and mis-nested subfolders (intro leaves collapsed
  into bare `_Game/`, fonts got a stray `unity_export/` segment). Replaced by one
  deterministic builder (2026-06-14).
- **Wanted (P1)**: monolith → decompose (tree, palette, export, rules); dense tree
  UI (no drag-reorder); no team sharing/versioning of templates.
