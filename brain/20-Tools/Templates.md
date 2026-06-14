---
type: tool
tool: Templates
category: 🏗️ Asset Pipeline
status: shipped
priority: P3
updated: 2026-06-14
tags: [asset-pipeline, markdown]
---

# Templates Library

Markdown template library (`public/templates/`), zero-infra markdown + frontmatter
publishing. Source: `TemplatesTool.jsx` (475 L).

- **Good**: zero-infra publishing.
- **Shipped (2026-06-14 audit)**: search/filter (search input + `useMemo` name/desc filter).
- **Wanted**: `manifest.json` out-of-sync risk (still hand-maintained — auto-gen wanted); minimal YAML parser.

Current templates: `png-fonts.md`, `spine-export.md`. Related: [[Font Preview]].
