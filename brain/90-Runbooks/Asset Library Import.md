---
type: runbook
tool: Asset Library
category: 🏗️ Asset Pipeline
updated: 2026-06-14
source: react-app/docs/ASSET_LIBRARY_IMPORT.md
tags: [runbook, asset-pipeline, library]
---

# Asset Library — Import Routine (agent runbook)

> [!info] Canonical source
> Full runbook: [`react-app/docs/ASSET_LIBRARY_IMPORT.md`](../../react-app/docs/ASSET_LIBRARY_IMPORT.md).

Run this routine whenever new source material lands in an import dump folder
(e.g. `react-app/2dAssetLibrary/` — import dumps are gitignored and are **NOT** the
library). The library itself lives in `react-app/public/assetLibrary/` and is what
the [[Asset Library]] tool serves.

See the canonical file for the step-by-step import steps (this note is the vault
index entry; the procedure is maintained in-repo so the agent reads it directly).
