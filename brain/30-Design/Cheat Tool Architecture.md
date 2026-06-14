---
type: design
tool: Cheat Tool
category: 🎲 Cheets
status: shipped
updated: 2026-06-14
source: react-app/src/tools/CheatTool/CHEAT_TOOL.md
tags: [design, cheets, qa]
---

# Cheat Tool — Architecture & Extension Guide

> [!info] Canonical source
> Full guide: [`react-app/src/tools/CheatTool/CHEAT_TOOL.md`](../../react-app/src/tools/CheatTool/CHEAT_TOOL.md)
> — now sitting next to its code. (Was previously stranded at a doubled
> `react-app/react-app/...` path; moved 2026-06-14.)

A visual builder for the `/cheats/find-spin` API payload plus an inline runner for
`/v2/games/{id}/play` ("Real Spin"). Targets internal QA workflows; ships in the
**Cheets** category.

See [[Cheat Tool]] for the tool summary and backlog.
