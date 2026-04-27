# Asset Checker — automatable review checks

Planning doc for a new tool section in the YGG Toolkit React app. The user
drops the entire art-output folder of a game (PNGs, Spine `.json`/`.atlas`/`.png`,
preview PNGs, source `.spine` files, etc.) and the tool runs every check
locally in the browser and produces a categorised report (errors / warnings /
info), with click-through to the offending file.

**Hard constraint**: serverless, hosted on GitHub Pages, all processing runs
in the user's browser. No uploads, no backend. Reuses the existing WASM
ImageMagick stack and adds a few small in-browser libs (Tesseract.js for OCR,
JSZip for bundles, pHash via canvas for similarity).

The check list below is grounded in real findings from past tech-art reviews
(FishGame Notes 1+2, Toothless Smile review 1, Bus Stop part 1+2, Aurora
review 1). Every check cites the review issue that motivated it where
possible. Items are tagged with implementation difficulty.

> **Missing input**: the tech-art preparation/naming-convention doc the user
> mentioned was not attached. Several "convention" checks below currently use
> placeholder rules — wire them to the real doc once supplied. The intent is
> that the tool reads convention rules from a config (JSON) so non-engineers
> can tweak the rules without touching code.

Difficulty legend: **E** easy (pure JS) · **M** medium (needs WASM/IM,
canvas pixel work, or non-trivial parsing) · **H** hard (OCR, perceptual
hashing, ML-flavoured heuristics, or fuzzy detection).

---

## 1. Folder structure & top-level coverage

Detects missing whole-feature folders or unexpected/orphan folders.

- **1.1 Required top-level folders present** — E
  Configurable list, e.g. `BaseGame/`, `FreeSpins/`, `BonusGame/`, `Symbols/`,
  `WinSequence/`, `Popups/`, `Backgrounds/`, `Splash/`, `Preloader/`,
  `Buttons/`, `Fonts/`, `Previews/`. Flag missing ones.
  *Source:* Toothless review — preloader missing loading bar/bg; Aurora —
  splash empty; BusStop pt2 — "is there no splash screen view?"

- **1.2 No duplicate folders for the same feature** — E
  E.g. assets duplicated between `FreeSpins/` and `BonusGame/` instead of a
  shared `04_FreeSpins_and_BonusGame/`.
  *Source:* Toothless review.

- **1.3 Source `.spine` project files alongside exports** — E
  Every exported `.json`+`.atlas`+`.png` set should have a sibling
  `.spine`/`.psd` source. Flag exports without sources.
  *Source:* Toothless — "I don't see animation sources of most of the stuff
  now, only exports"; FishGame pt2 — "Please deliver with json exported".

- **1.4 No reference-only assets bundled into export folder** — E
  Files matching `ref`, `_ref`, `REF`, `reference`, `concept`, `wireframe`
  in export folders should be flagged (they leak into atlases otherwise).
  *Source:* Aurora — "Remove ref3 so that unnecessary assets don't get
  exported to texture atlas".

- **1.5 Orphan/unknown folders** — E
  Anything outside the configured layout gets surfaced as a warning so the
  reviewer can decide.

---

## 2. Naming conventions & filename hygiene

All driven by a JSON ruleset so the actual convention doc (when supplied)
becomes the source of truth.

- **2.1 Whitelist of allowed characters** — E
  Disallow spaces, parentheses, non-ASCII, accidental `Copy`/`final`/`v2`
  suffixes. Configurable.

- **2.2 Case consistency** — E
  Per-folder rule: snake_case / camelCase / PascalCase. Flag
  `bg_Land.png` mixed with `Bg_sky.png` mixed with `bg_sea.PNG`.

- **2.3 Extension case** — E
  All extensions lowercase (`.png` not `.PNG`).

- **2.4 Required prefix per folder** — E
  e.g. backgrounds must start with `bg_`, symbols with `sym_`/`hp`/`lp`,
  popups with `popup_`, etc.

- **2.5 Forbidden suffixes** — E
  `_copy`, `_v1`, `_FINAL`, `-bak`.

- **2.6 Spine triplet name match** — E
  For each Spine export, `name.json` / `name.atlas` / `name.png` (and any
  `name2.png` page) must share the same base name. Flag `bigwin.json` +
  `BigWin.atlas`.

- **2.7 Atlas page filenames match the names listed inside `.atlas`** — E
  Parse the `.atlas` header lines, confirm each referenced PNG file exists
  on disk with exact case.

- **2.8 Bone/slot naming** — E (Spine JSON)
  Dynamic text bones must start with `TEXT_` or `text_`. Flag any bone
  whose name suggests text content (`*win*amount*`, `*counter*`, `*number*`,
  `*multiplier*`) but is missing the prefix.
  *Source:* every review (FishGame, Toothless, BusStop pt1+2). Direct quote
  from BusStop pt2: *"Text bones names should start with TEXT_ or text_ for
  easier readability."*

---

## 3. Asset coverage — "what should exist for this game"

Per-feature manifest of expected assets; flag what is missing.

- **3.1 Per-symbol completeness** — E
  Every symbol skeleton must have animations named (configurable):
  `idle`, `land`, `win` (HP/LP), plus `anticipation` for special symbols.
  Parse Spine JSON `animations` keys.
  *Source:* user prompt — "the symbols animations should have the landing
  and win animation in their names".

- **3.2 Static PNG per symbol** — E
  Every symbol must have an exported static PNG (idle frame). Match by
  symbol id between `Symbols/sym_xxx.json` and `Symbols/static/sym_xxx.png`
  (configurable layout).
  *Source:* FishGame pt2 — "Each symbol should be also exported as static
  png by exporting the 1st frame of spine".

- **3.3 Symbol size matrix** — E
  If the game uses multi-cell symbols (1×1, 1×3, etc.), check every HP
  symbol has every required size variant. Aurora/BusStop both flagged
  missing sizes for some symbols.
  *Source:* BusStop pt1 — "Only hp2 and hp4 has all the sizes of symbols
  exported, hp3 has no 1x1 and hp 1 has no 1x3".

- **3.4 Required statics** — E
  `bg_static.png`, `logo_static.png`, `splash_bg.png`, machine frame,
  loading bar + loading bar bg, board static, button statics. Configurable
  manifest.
  *Source:* FishGame pt2 — "Static bg and logo for loading/splash";
  Toothless — "Missing loading bar and loading bar_bg entirely?"; BusStop —
  "static for the board is missing".

- **3.5 Win-sequence chain completeness** — E
  Within the single win-sequence skeleton, the following animations must
  exist (configurable): `small_idle` *or* `small_begin`, `medium_begin`,
  `medium_idle`, `large_begin`, `large_idle`, `big_begin`, `big_idle`,
  `mega_begin`, `mega_idle`, `*_outro`.
  *Source:* BusStop pt2 — explicit flow described; Aurora — "Win sequence
  should be made inside single skeleton that chain animations in a
  specific flow"; Toothless implied; user prompt.

- **3.6 Previews per view** — E
  Configurable list of views (base game, free spins, bonus intro/outro,
  total win, win sequence, splash, popups). Each must have a 1920×1080
  landscape PNG and a 1080×2160 portrait PNG in `Previews/`.
  *Source:* FishGame pt2 — "every specific feature/element there should
  also be a preview exported in 1920x1080 for the landscape and 1080x2160
  for the portrait mode"; BusStop pt2 — "needs to be done for every
  possible view".

- **3.7 Font-set completeness** — M
  For dynamic text bones (e.g. `TEXT_Win_Counter`, `TEXT_FS_Number`,
  `TEXT_Multiplier_Number`), expect a matching font sheet under `Fonts/`.
  Naïve check: is there a PNG in `Fonts/` with a corresponding name? Deeper
  check: glyph coverage (see §6.3).
  *Source:* FishGame pt1 — "we need that font exported separately"; FishGame
  pt2 — currency letters needed.

---

## 4. Spine JSON content checks

Spine JSON is just JSON, parses in milliseconds.

- **4.1 Spine version** — E
  Read `skeleton.spine` field. Flag exports not matching the configured
  target (e.g. `4.2.x`).
  *Source:* Aurora — "exported in version 4.1 and we use 4.2".

- **4.2 Mock text not exported** — E
  For every bone whose name starts with `TEXT_`/`text_`, verify there is
  **no slot/attachment with image data parented to that bone** (mock text
  must be deleted before export). If we find an attachment under a TEXT_
  bone whose name suggests a glyph, flag it.
  *Source:* BusStop pt1 — "use those mock texts while making that animation
  but delete them before exporting"; FishGame, Toothless, Aurora repeat.

- **4.3 Empty bone present where text is expected** — E
  Reverse of 4.2: animations that are *supposed* to host dynamic text
  (configurable per skeleton type — big win, multiplier, button) must have
  the `TEXT_*` empty bone. Missing one is an error.
  *Source:* BusStop pt1 — "no empty bone that we can attach the won amount
  to"; FishGame pt1 — multiplier should be `TEXT_Multiplier_Number`.

- **4.4 Skeletons-per-`.spine` for symbols** — E
  All symbols must live in one project, each as its own skeleton, so they
  share an atlas.
  *Source:* Toothless — "Every high, low and special symbols should have
  its own skeleton inside the same .spine project"; BusStop pt1 — "Put all
  the symbols into one .spine file and make separate skeleton for each one".

- **4.5 Bone/vertex/transform budgets** — E
  Per skeleton type, configurable upper limits (warn over). Counts come
  straight from JSON.
  *Source:* FishGame pt2 — "Bone count, vertex transforms and vertices
  count could be optimized".

- **4.6 No duplicate animation names across skeletons that should chain** — E
  e.g. win sequence shouldn't have both `super_win_intro` and
  `mega_intro` if convention is single chain.
  *Source:* BusStop pt1 — "no need for what you called super win intro and
  mega win intro as they always escalate".

- **4.7 Animation name lints** — E
  Configurable regex set. e.g. `_transition` should be `_intro`/`_begin`.
  *Source:* BusStop pt1.

- **4.8 Slot/attachment references resolve in atlas** — E
  Cross-check every attachment name in JSON exists in the paired `.atlas`.
  Catches stale exports.

---

## 5. Atlas (.atlas) checks

Plain text, trivial parser.

- **5.1 Atlas page count and dimensions** — E
  Each `page` declares `size: WxH`. Flag if any page is non-power-of-two
  for textures intended to be POT (configurable per category — UI atlases
  often non-POT, symbol atlases always POT).
  *Source:* user prompt.

- **5.2 Hard caps per category** — E
  Symbols ≤ 2048×4096, Big-win sequence ≤ 2048×4096, generic UI ≤ 2048².
  Configurable.
  *Source:* BusStop pt1 — "final wins animation should fit in 2048 x 4096
  single sprite sheet"; "max atlas size for all the symbols should be
  2048x4096"; "lower resolution of some of those assets so the atlas will
  be less than 2k width".

- **5.3 Atlas page count per skeleton** — E
  Each Spine export should normally fit in 1 page; flag at 2+, error at 4+.
  *Source:* BusStop pt1 — "9 sprite sheets is WAY to much".

- **5.4 Region padding & wasted space** — M
  Sum of region areas vs page area = **fill ratio**. Below e.g. 55% on a
  big atlas → warn (likely too much padding or too few regions for the
  page size).
  *Source:* BusStop pt1 — "padding of all of those assets is to big".

- **5.5 Unused regions in atlas** — E
  Any region in `.atlas` not referenced by a `.json` attachment.

---

## 6. Texture / image analysis (PNG-level)

- **6.1 Power-of-two for "should-be-POT" categories** — E
  Backgrounds, symbol atlases. `(w & (w-1)) === 0`.
  *Source:* user prompt; BusStop pt1 backgrounds.

- **6.2 Background canonical resolution** — E
  Backgrounds expected at one of {2048, 4096} on long edge (configurable).
  *Source:* BusStop pt1 — "Deliver them in either 4096 or 2048px size".

- **6.3 Font sheet glyph completeness** — M
  Detect grid layout via brightness profile (`ImageMagick -lat`) and count
  cells; compare to expected glyph set (A–Z, 0–9, currency letters,
  punctuation). Configurable expected set per font sheet.
  *Source:* FishGame pt2 — "we need a set of all letters uppercase so we
  can write with them any currency by letters".

- **6.4 Total uncompressed asset weight** — E
  Sum file sizes per folder, total. Threshold per game.

- **6.5 Estimated compressed size** — M
  Run each PNG through `pngquant`/`oxipng` (WASM) at the engine's expected
  quality, sum, report the realistic on-device cost.
  *Source:* user prompt.

- **6.6 Oversized assets** — E
  Any single PNG > N MB or > 4096px on either axis → warn.

- **6.7 Almost-empty alpha** — M
  Alpha histogram via canvas. If >90% transparent, the asset is likely
  oversized canvas (trim before export).

- **6.8 Excessive padding inside a region** — M
  Auto-trim bounds vs original bounds — if trimmed area is <50% of
  original, flag.

- **6.9 Near-duplicate / could-be-tinted assets** — H
  Perceptual hash (pHash, dHash) over all images in a folder; cluster.
  For each cluster, also compute a desaturated pHash — clusters that are
  near-identical when desaturated are tint-recolor candidates that should
  be one greyscale asset + tint.
  *Source:* user prompt; FishGame pt1 — "the gradients/other generic assets
  can be reused in many places by creating white fade and recolor"; BusStop
  pt1 — "create only ONE asset for that shape and use tint to recolor it".

- **6.10 Mirror-symmetry detection** — M
  Compare an image to its horizontal flip (and halves). Strong symmetry →
  suggest export as half + mirror in spine.
  *Source:* FishGame pt1 — "light asset can be scaled down a little and
  cut in half to mirror it as it's the same mirrored from what it looks";
  "BusStop board cut up so we stitch up to be in 4x5 and 3x5".

- **6.11 Repeated-frame flipbooks** — H
  For known flipbook sprite sheets (configurable region pattern), check
  near-duplicate cells via pHash; suggest reduced frame count.
  *Source:* FishGame pt1 — "Can we maybe limit some of those tiles that
  don't add too much"; BusStop pt1 — "Consider using only one of those
  sequences with even lower frame count".

- **6.12 Resolution sanity per category** — E
  Configurable max size per asset category — e.g. small UI flares /
  highlights ≤ 256px, "small detail" assets ≤ 128px.
  *Source:* Toothless — "assets should be scaled down to 256px max"; BusStop
  pt1 — "Resolution of assets like those should always be set to minimal
  with no artifacts (128px is most often good)".

---

## 7. Baked-text / "text on the atlas" detection

The most-cited issue across every review. Multi-layer detection.

- **7.1 `TEXT_*` bone presence** — E (cheap, high signal)
  As §4.3.

- **7.2 Mock text in atlas under TEXT bone** — E
  As §4.2 (image attachment under a TEXT bone = baked text).

- **7.3 Heuristic glyph detection on atlas pages** — H
  For any atlas region that is **not** under a TEXT bone, run a fast
  text-likelihood pass:
  1. Edge density + stroke-width transform → identifies text-like regions
     reasonably well even when rotated.
  2. If a region scores high, run Tesseract.js OCR on that region only
     (rotated 0/90/180/270°). If recognised text length ≥ 3 chars and
     dictionary-plausible → flag.
  Tesseract.js works fully in browser (~10 MB WASM), and we only OCR
  the suspect crops, not the whole atlas. Acceptable cost behind a
  "Run deep text scan" toggle.
  *Source:* user prompt; every review flagged baked text on big-win
  atlases, popups, win-sequence, button labels.

- **7.4 String-like attachment names** — E
  Quick heuristic: attachments named `text`, `win_amount`, `bonus`,
  `multiplier`, `5x`, `START`, `TAP_TO_CONTINUE`, `freespins` etc. → very
  likely baked text. Cheap pre-filter that catches most cases without OCR.
  *Source:* Toothless — "win amount baked on it"; BusStop pt2 — "remove
  start text from there"; FishGame — "TEXT_Win_Counter, TEXT_FS_Number".

- **7.5 Static panels delivered with baked text** — H
  Same OCR pipeline run on standalone panel/popup PNGs.
  *Source:* BusStop pt1 — "Instead of panel filed with text please deliver
  empty panels".

---

## 8. Atlas/packing strategy

- **8.1 One atlas per Spine** — E
  Each `.spine` export gets its own atlas. Confirm.

- **8.2 Single atlas for shared-static category** — E
  Configurable: `{ static_ui: ['machine_frame.png', 'static_symbols/*.png',
  'board_static.png', ...] }` — assets in this category should not have
  per-asset PNGs unless they have a justification, because they'll be
  re-packed by Unity into one atlas. Warn if static_ui PNGs are
  unexpectedly large (> N px) for a packed atlas.
  *Source:* user prompt — "static art... can be packed into one sprite
  atlas in unity".

- **8.3 Expected atlas count summary** — E
  Compute and report: 1 per Spine + 1 per shared-static category. Flag
  surprising counts (way over).

---

## 9. Pivot, alignment, transform sanity

- **9.1 Static PNG pivot ↔ Spine root pivot** — M
  The exported static (idle frame) PNG must share centre with the Spine
  skeleton's root setup pose. Check by:
  - Computing the alpha-bbox centre of the PNG.
  - Comparing to the Spine setup-pose bbox centre (sum of attachment
    setup positions).
  Tolerance configurable (e.g. ±2 px).
  *Source:* FishGame pt2 — "in the same center pivot as spine center pivot".

- **9.2 Preview PNG aspect** — E
  Strict 16:9 (1920×1080) and 1:2 (1080×2160).

---

## 10. Optimization heuristics (advisory)

These don't fail the review, they surface optimisation opportunities.

- **10.1 Gradient asset oversized** — M
  Detect smooth-gradient assets (low colour count, smooth derivative) at
  >512 px → suggest downscale.
  *Source:* FishGame pt1 — repeated theme; Toothless — shadow too low quality
  (other direction, but same metric).

- **10.2 Highlight/flare suggestion to use additive blending** — H
  Hard to fully automate; we can at least flag bright, mostly-additive-looking
  assets that take a large atlas footprint as candidates for "bake at runtime
  via blending instead".
  *Source:* FishGame pt1 — Metter highlight asset.

- **10.3 Atlas fill < 55%** — M
  As §5.4, repeated here as "you have headroom; consider larger assets or
  smaller page".

- **10.4 Bone/vertex/transform percentile** — E
  Across the project, any single skeleton in top 5% of bone/vert/transform
  count → flag for optimisation.

---

## 11. Cross-consistency / project-level

- **11.1 Same Spine version everywhere** — E
  All `.json`s in the drop must agree on `skeleton.spine`.
  *Source:* Aurora.

- **11.2 Same atlas filter mode everywhere** — E
  `.atlas` filter line (`filter: Linear,Linear` etc.) consistent within a
  category.

- **11.3 Same colour profile** — M
  PNGs without sRGB chunk among others with sRGB → likely a colour-shift
  bug at runtime.

- **11.4 Game id / project name in metadata** — E
  Optional: parse a top-level `project.json` if present; require the
  drop's folder names to match.

---

## 12. Output / report

The tool produces:

1. **Summary header** — pass/warn/fail counts, total asset weight, est.
   compressed weight, atlas count, spine version.
2. **Categorised list** — each finding has: severity (error/warn/info),
   category, file path(s), short message, "fix hint" pulled from a
   `hints.json` (so the messages map to the same advice the tech-art doc
   gives), and a click-target that opens the offending file in a preview
   (image preview, JSON viewer for spine, atlas viewer).
3. **Exportable as `report.html`** (zero-dep self-contained file) — so the
   reviewer can send it to the artist.
4. **Optional**: produce a markdown `report.md` for pasting into Slack /
   the existing review docx flow.

---

## 13. Implementation notes (browser-only)

- **Folder ingest** — `<input webkitdirectory>` plus drag-and-drop (the
  Sidebar already accepts dropped files; extend to accept dropped folders
  via `DataTransferItemList` + `getAsFileSystemHandle()`).
- **Worker pool** — every check that processes images should run in a
  Web Worker pool (e.g. 4–8 workers). The existing Content Browser
  global-search pattern (8-worker pool, see `index.html` L3037–3329) is a
  good template.
- **WASM ImageMagick** — already in the toolkit; reused for §6.5, §6.7,
  §6.8, §6.10, §10.1.
- **Tesseract.js** — lazy-loaded only when "deep text scan" is enabled.
- **pHash / dHash** — implement in JS over a 32×32 canvas downscale; no
  lib needed.
- **Spine parsing** — pure JSON; no Spine runtime needed.
- **JSZip** — only if we accept `.zip` art bundles in addition to folders.
- **Memory** — for big drops (multi-GB), don't hold all decoded images at
  once. Stream by file, run the per-file checks, drop the bitmap, then
  proceed. Aggregate findings keep only paths + small data.
- **Configurability** — every threshold lives in a single
  `checker.config.json` shipped with the app, overridable via a "Load
  config" button in the tool. The official tech-art doc maps 1:1 to this
  config.

---

## 14. Phasing suggestion

**Phase 1 (high-value, all easy)**
1.1, 1.3, 1.4, 2.1–2.7, 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.7, 4.8,
5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.4, 6.6, 7.1, 7.2, 7.4, 8.1, 8.2, 8.3,
11.1, 11.2 → covers ~80% of past review findings with cheap parsing only.

**Phase 2 (medium effort, good ROI)**
3.7, 5.4, 6.3, 6.5, 6.7, 6.8, 6.10, 6.12, 9.1, 10.1, 10.3, 10.4.

**Phase 3 (heavy)**
6.9, 6.11, 7.3, 7.5, 10.2 — perceptual-hash and OCR layer behind an
opt-in toggle.

---

## 15. Things this tool deliberately does NOT do

- Subjective art-direction calls ("the symbol looks dim", "background feels
  empty") — those stay human.
- Animation timing / "doesn't look seamless" judgements — possible only
  with a Spine runtime + visual diff, out of scope.
- Anything requiring server compute (e.g. cloud OCR, ML scene
  classification).
