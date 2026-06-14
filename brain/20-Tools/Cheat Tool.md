---
type: tool
tool: Cheat Tool
category: 🎲 Cheets
status: shipped
priority: P2
updated: 2026-06-14
tags: [cheets, qa, simulation]
---

# Cheat Tool

Visual builder for the `/cheats/find-spin` API payload + inline runner for
`/v2/games/{id}/play` ("Real Spin"). Targets internal QA workflows. Source:
`CheatTool/` (18+ files).

- **Good**: full client-side game sim ("Real Spin" with actual game math); presets; board editor.
- **Wanted (P2)**: heavy context state; no impossible-state validation; sim can drift
  from live backend version; read-only (no backend export).

Full design: [[Cheat Tool Architecture]].
