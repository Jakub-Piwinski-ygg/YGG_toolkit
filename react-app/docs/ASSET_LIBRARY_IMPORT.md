# Asset Library — import routine (agent runbook)

Run this routine whenever new source material lands in an import dump folder
(e.g. `react-app/2dAssetLibrary/` — import dumps are gitignored and are NOT the
library). The library itself lives in `react-app/public/assetLibrary/` and is
browsed by the **Asset Library** tool (`?tool=assetlibrary`).

Your job as the importing agent is **curation + classification**. All mechanics
(PNG conversion, thumbnails, sequence ZIPs, animated previews, manifest
bookkeeping) are done by `scripts/asset-library-add.mjs`.

## Prerequisites

- ImageMagick CLI on PATH (`magick -version` works).
- `npm install` has been run in `react-app/` (the script needs `adm-zip`).
- Run all script commands from `react-app/`.

## Step 1 — survey the dump

Walk the dump and identify *packs* (top-level folders that shipped together).
For each pack note: what the images are, where the license is, and how files
are organized (singles, size variants, frame sequences).

## Step 2 — decide what gets in

**Include**: standalone, reusable 2D textures and frame sequences — things an
artist would drop into an effect, shader, or mockup.

**Exclude** (never import):
- Unity `.meta`, Substance `.sbs`, `.xml`, `.js/.css/.html` docs, fonts,
  generated documentation folders, custom node libraries.
- Preview/promo/screenshot/README imagery (images *about* the pack).
- Sprite-sheet atlases (grids of unrelated sub-images).
- Duplicate size/quality variants — keep only the **largest** of each asset
  (e.g. skip `*_Half*`, skip `128×128` when a `256×256` of the same thing exists,
  skip a `Default/` set when a 2× `Double/` set exists).
- Source `.psd` files **when a flattened export also exists**.

**Stop and ask the user** (do not guess, do not silently skip):
- An asset exists **only** as a `.psd` (or other layered source).
- A pack has **no detectable license** (see Step 4) — import with
  `--license unknown` only after telling the user.
- An asset clearly doesn't fit any existing category and you think a **new
  category** is warranted. Never invent categories on your own.

## Step 3 — classify: statics vs sequences, and category

**Sequence detection**: a folder of same-named numbered frames
(`Name_0000.tga … Name_0200.tga`) with **more than 8 frames** is ONE sequence
asset. Variant subfolders (`256x256.tga/`, `Flowmap_256x256.tga/`) are
**separate** sequence assets — give the non-default ones a distinguishing
`--slug` (e.g. `noise-00-flowmap`). Fewer than ~8 numbered files = treat as
individual statics.

**Category decision tree** (current ids — check `manifest.json` for the live list):

| Category | Use for | Examples |
|---|---|---|
| `noise` | noise, flowmaps, distortion/turbulence maps | perlin, voronoi, caustics |
| `basics` | building-block primitives | gradients, solid pixels, checkerboards, vignettes |
| `patterns` | repeating/tiling decorative motifs | kenney pattern pack, polygon tiles |
| `trails` | elongated streak/trail/swipe textures | fire trails, motion streaks, line sweeps |
| `ui` | interface elements | buttons, joysticks, icons, frames |
| `texture` | everything else effect-like (the default) | flares, glows, smoke, auras, shockwaves, lightning |

If genuinely torn between two, prefer the more specific one; if nothing fits,
use `texture`; if `texture` feels wrong too, ask the user (new category?).

## Step 4 — license

1. Look for `License.txt`, `LICENSE*`, `README*` inside the pack.
2. Match it to an existing id in `manifest.json → licenses`. Current ids:
   `cc0` (Kenney etc.), `vfxstudio` (VFX STUDIO Texture Library), `unknown`.
3. New license? Copy its text to `public/assetLibrary/licenses/<id>.txt`, add a
   `licenses` entry to `manifest.json` (short human label + file path), then use
   the new id. The script refuses unknown license ids — that's intentional.

## Step 5 — naming

- Slugs are auto-derived (kebab-case of the filename; sequences get a `-seq`
  suffix and the frame counter stripped). Usually fine — let it happen.
- Override with `--slug`/`--name` (single input only) when:
  - the filename is meaningless (hashes, `256x256.tga`),
  - it collides with an existing slug from another pack — prefix with a short
    pack tag (e.g. `kenney-dot-pattern`),
  - a sequence variant needs distinguishing (`noise-00-flowmap`).
- For batch imports from one pack, prefer `--slug-prefix <pack-tag>` (e.g.
  `--slug-prefix kenney`), so auto-generated slugs become namespaced like
  `kenney-dot-pattern`. The prefix is normalized to kebab-case.
- The script **skips on slug collision** (warns, doesn't overwrite). Identical
  files shipped twice in a dump dedupe themselves this way — re-run with
  `--slug` only if the collision is two genuinely different assets.

## Step 6 — run the script

Batch per (category, license, source). Quote paths; globs are fine in PowerShell
via `Get-ChildItem`:

```powershell
# statics
node scripts/asset-library-add.mjs --category patterns --license cc0 `
  --source "kenney_pattern-pack" --slug-prefix kenney `
  (Get-ChildItem "..\dump\pattern-pack\PNG\Double\*.png").FullName

# one renamed static
node scripts/asset-library-add.mjs --category trails --license unknown `
  --source "UnitycApturedTextures" --slug soft-trail --name "Soft Trail" "..\dump\f2de81fa.png"

# sequences (each input is a DIRECTORY of frames; --fps = source frame rate)
node scripts/asset-library-add.mjs --seq --fps 30 --category noise --license vfxstudio `
  --source "VFX_Texture_Library_v1.0.0" --slug-prefix vfxstudio `
  "..\dump\Source_Texture\Noise_00\256x256.tga"
```

`--tags a,b,c` adds searchable tags — use for qualities the name doesn't carry
(`seamless`, `greyscale`, `flowmap`, `additive`).

## Step 7 — validate & spot-check

```powershell
node scripts/asset-library-add.mjs --validate   # must print OK
npm run dev                                     # open ?tool=assetlibrary, eyeball thumbs/sequences
```

## Step 8 — report to the user

Summarize: assets added per category, total MB added, sequences imported,
everything you **skipped and why**, plus any PSD-only / unknown-license /
new-category findings. Leave the import dump untouched — the user deletes it
after reviewing.
