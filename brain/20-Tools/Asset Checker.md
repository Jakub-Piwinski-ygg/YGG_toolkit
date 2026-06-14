---
type: tool
tool: Asset Checker
category: 🏗️ Asset Pipeline
status: shipped
priority: P0
updated: 2026-06-14
tags: [asset-pipeline, validation, unity]
---

# Asset Checker

Delivery validator — 7 check modules (structure, naming, spineJson, atlas, images,
coverage, bakedText) + Unity-structured ZIP export. Source: `AssetChecker/` (~358 L + engine).

- **Good**: pipeline-critical (catches naming, Spine-version, atlas-size, coverage
  errors before the game team); fully local; severity-configurable; multiple result
  views; ZIP export with rename rules.
- **Shipped (2026-06-14 audit)**: auto-fix **suggestions** (`engine/suggest.js` →
  `naming.js`; ReportView shows from→to + copy). Config-swap exists (`public/configs/manifest.json`
  + ad-hoc uploads).
- **Dropped 2026-06-14**: rule presets per game type — not wanted (only `default` ships, fine).
- **Wanted**: shallow Spine linting; coverage hostage to scaffold accuracy;
  `findSpineInTree()` O(n) full-tree scan.

Forms a pipeline with [[Project Scaffold]] (coverage checks ↔ leaf rules — single
source of truth). Full rule reference: [[Asset Checker Checks]].
