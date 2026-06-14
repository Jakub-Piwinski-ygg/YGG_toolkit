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
pngAtLeastOne…), exports SharePoint ZIP / Unity tree / config JSON. Source:
`ProjectScaffoldTool.jsx` (848 L).

- **Good**: leaf rules align 1:1 with [[Asset Checker]] coverage (single source of
  truth); JSON roundtrip; slug-safe naming; preset subtrees.
- **Wanted (P1)**: **848-line monolith → decompose** (tree, palette, export, rules);
  dense tree UI (no drag-reorder, no inline rule hints); no team sharing/versioning
  of templates; font handling special-cased via `fontVariant`.
