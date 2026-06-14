---
type: tool
tool: Project Scaffold
category: 🏗️ Asset Pipeline
status: shipped
priority: P1
updated: 2026-06-14
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
  e.g. `_Game/08_Intro_Outro/Free_Spins_Intro/Animations/`.
- **Defaults**: `Export/*` and `Source/*` leaf folders both ticked on; top-level
  elements get a `_Previews` entry; `BonusGame` is an addable common preset.
- **Good**: leaf rules align 1:1 with [[Asset Checker]] coverage; JSON roundtrip
  (v3 config; loads legacy v1/v2); slug-safe naming; preset subtrees.
- **History**: was a dual SharePoint-ZIP / Unity-tree exporter — the Unity path
  re-used Asset Checker mappings and mis-nested subfolders (intro leaves collapsed
  into bare `_Game/`, fonts got a stray `unity_export/` segment). Replaced by one
  deterministic builder (2026-06-14).
- **Wanted (P1)**: monolith → decompose (tree, palette, export, rules); dense tree
  UI (no drag-reorder); no team sharing/versioning of templates.
