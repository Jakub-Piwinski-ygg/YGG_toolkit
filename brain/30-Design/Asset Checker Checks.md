---
type: design
tool: Asset Checker
category: 🏗️ Asset Pipeline
status: shipped
updated: 2026-06-14
source: react-app/docs/asset-checker-checks.md
tags: [design, asset-pipeline, validation]
---

# Asset Checker — Checks Reference

> [!info] Canonical source
> Full rule reference (681 lines): [`react-app/docs/asset-checker-checks.md`](../../react-app/docs/asset-checker-checks.md).

The 7 check modules run by [[Asset Checker]] against art deliveries:

1. **structure** — folder layout vs scaffold rules.
2. **naming** — file/folder naming conventions.
3. **spineJson** — Spine `.json` version + sanity.
4. **atlas** — atlas size / packing constraints.
5. **images** — image format / dimension checks.
6. **coverage** — required-asset coverage vs [[Project Scaffold]] leaf rules.
7. **bakedText** — baked-text detection.

Severity is configurable per rule. Output exports a Unity-structured ZIP with
rename rules. Coverage checks share leaf-rule definitions with [[Project Scaffold]]
(single source of truth).

Related: [[Asset Checker]] · [[Project Scaffold]]
