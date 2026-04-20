# YGG Toolkit — Claude Code context

Internal browser-based toolkit for Yggdrasil Gaming artists. Provides image
processing (ImageMagick WASM), asset browsing (GitHub / self-hosted GitLab), and
slot-game preview utilities.

**Two versions coexist**:
1. **Original (`index.html`)**: Single ~4100-line HTML file, zero dependencies, runs
   from `file://`. Legacy reference during React port.
2. **React rewrite (`react-app/`)**: Vite + React 18 + Framer Motion, modular
   components, dev server + GitHub Pages deployment. MVP complete: shell + WebP
   tool. Remaining 12 tools pending.

---

## Version: React (MVP, ongoing port)

**Status**: Scaffold + proof-of-concept complete (commit `fb2b720`).

### Project structure
```
react-app/
├── package.json                    # Vite + React + Framer Motion
├── vite.config.js                  # base: './' (update to '/YGG_toolkit/' for GitHub Pages subpath)
├── index.html                      # Vite entry
└── src/
    ├── main.jsx                    # React root
    ├── App.jsx                     # Layout: Header + Sidebar + ToolPanel + OutputPanel
    ├── context/AppContext.jsx      # Shared state (files, log, tool, magick ready)
    ├── hooks/useMagick.js          # WASM loader (CDN import)
    ├── components/
    │   ├── Header.jsx              # Logo, subtitle links, WASM badge, restart button
    │   ├── Sidebar.jsx             # Dropzone, file list, tool tabs
    │   ├── Dropzone.jsx
    │   ├── FileList.jsx
    │   ├── ToolTabs.jsx            # Framer Motion: smooth tab switches
    │   ├── ToolPanel.jsx           # Settings + RUN/CLEAR + OutputLog
    │   ├── OutputLog.jsx           # Scrolling log with color-coded entries
    │   ├── ResultsGrid.jsx         # Animated card grid with lazy-load
    │   ├── DownloadBar.jsx
    │   ├── WasmBadge.jsx
    ├── tools/
    │   ├── registry.js             # ART_TOOLS[] — add new tools here
    │   └── WebPTool.jsx            # PNG → WebP (canvas-based, proof-of-concept)
    ├── styles/
    │   ├── tokens.css              # CSS variables (--bg, --accent, etc.)
    │   ├── base.css                # Resets, scrollbars, animations
    │   └── components.css          # All component styles (ported from original)
    └── utils/download.js           # triggerDownload, downloadAll

### Dev server
```bash
cd react-app
npm install
npm run dev                          # Vite dev server on localhost:5173
npm run build                        # Production build → dist/
```

### Running on GitHub Pages
1. Build: `npm run build`
2. Copy `dist/*` to repo root
3. Push to main branch
4. Enable GitHub Pages (Settings → Pages → Deploy from branch: main, folder: root)
5. Access: `https://username.github.io/YGG_toolkit/` (if subpath deployment)
   - Update `vite.config.js` → `base: '/YGG_toolkit/'` before building

### Key design patterns

**Runner registration**: Tools register an imperative `run` function on mount via
`registerRunner(id, { outName, run })`. The ToolPanel queries the runner when
RUN is clicked. No tool imports needed in the shell.

```jsx
useEffect(() => {
  registerRunner(webpMeta.id, {
    outName: (name) => name.replace(/\.png$/i, '') + '.webp',
    run: async (_uint8, _name, file) => { /* return Blob */ }
  });
  return () => registerRunner(webpMeta.id, null);
}, [registerRunner]);
```

**Tool checklist** (add each tool by):
1. Create `src/tools/NewTool.jsx` with `meta` + `Component` + `useEffect` runner
2. Add to `registry.js` → `ART_TOOLS`
3. Import nothing in `App.jsx` — registry is the only coupling point

**Animation**: Framer Motion used for:
- Tool tab switches (`whileHover`, `whileTap` with spring physics)
- Result card reveals (`AnimatePresence` with fade+scale)
- Button taps (scale feedback)

### Porting checklist (remaining 12 tools)

- [ ] Crop (Canvas Resize — crop/pad modes)
- [ ] Blur (Directional Blur)
- [ ] Gaussian Blur
- [ ] RGBA Mask Combiner (4 slot UI, live preview)
- [ ] Grey to Alpha (CPU pixel-push, threshold curve)
- [ ] Font Preview (letter assignment grid, canvas render)
- [ ] Image Scaler (filter selection, Magick resize)
- [ ] Gradient Map (draggable stops, preset library, LUT builder)
- [ ] Paylines (grid designer, click-to-toggle cells)
- [ ] Outline / Stroke (morph pipeline, 3 modes)
- [ ] Atlas Packer (grid/tile mode, multi-sprite composite)
- [ ] Slot Machine (animation loop + WASM blur, complex state)
- [ ] Content Browser (repo browser, search, auth panel, breadcrumb nav)

---

## Version: Original (`index.html`, legacy reference)

### Running / testing

- Open `index.html` directly in Chrome or Firefox. That's it (no server needed).
- For the internal GitLab-backed version, host on the internal GitLab Pages
  instance; for the public version, GitHub Pages.
- Syntax-check a monolithic edit without a build system:
  ```bash
  python3 -c "import re,sys; html=open('index.html').read(); \
    [print('---block',i); __import__('subprocess').run(['node','--check','/dev/stdin'],input=b.encode()) \
     for i,b in enumerate(re.findall(r'<script(?![^>]*type=\"module\")[^>]*>(.*?)</script>', html, re.S))]"
  ```
  Or just paste suspect blocks into `node --check`.

### Golden rule: keep as-is during React port

The original `index.html` is a deliberate reference while the React version is
being built. Do NOT modify it except to fix bugs that block current use.

- All logic lives in inline `<script>` blocks inside `index.html`.
- The ONE exception is the wasm-imagemagick loader at the bottom, which must be
  `<script type="module">` for `import * as`.
- No bundler, no package.json, no node_modules. No `npm run anything`.

---

## File map (line ranges in `index.html`)

Use these to jump directly to the block you need — don't `view` the whole file.

| Lines        | Block                                       |
|--------------|---------------------------------------------|
| 1–380        | `<head>`: CSS, DOM skeleton                 |
| 382–398      | Global `state`, Content Browser `_cb`, tiny event bus (`on`/`emit`) |
| 401–542      | `core/ui.js` — `log`, `renderFileList`, `renderResults`, `replaceFilesWithOutput`, `restartToolkit`, `hardResetToolkit` |
| 545–630      | `tools/crop.js` — Canvas Resize (crop + pad) |
| 632–670      | `tools/blur.js` — Directional Blur          |
| 672–778      | `tools/gaussblur.js` — Gaussian Blur        |
| 780–806      | `tools/webp.js` — Convert to WebP           |
| 808–888      | `tools/rgba.js` — RGBA Mask Combiner        |
| 890–1146     | `tools/fontpreview.js` — mirrors `ImageText.cs` engine layout |
| 1148–1683    | `tools/slotmachine.js` — spin sim, WebM overlays, blur cache |
| 1685–1744    | `tools/greyalpha.js` — luminance → alpha    |
| 1746–1827    | `tools/scaler.js` — Image Scaler (WASM filters) |
| 1829–2043    | `tools/paylines.js` — payline designer      |
| 2045–2221    | `tools/gradientmap.js` — Photoshop-style gradient map |
| 2223–2323    | `ToolGradientMap` descriptor + misc         |
| 2325–3329    | `shared/repo-browser.js` — **`_gh` state, provider auto-detect, GH/GL APIs, auth, content-browser UI, cross-repo search** |
| 3331–3434    | `tools/soundbrowser.js`                     |
| 3436–3584    | `tools/artbrowser.js`                       |
| 3586–3722    | `tools/atlas.js` — Atlas Packer             |
| 3724–3874    | `app.js` — `TOOLS` assembly, sidebar build, run dispatch |
| 3877–3886    | WASM loader (`<script type="module">`)      |

---

## Tool descriptor pattern

Every art tool is an object with this shape:

```js
const ToolX = {
  meta: {
    id: 'x',                    // unique slug, used for tab id, section id, switchTool
    label: 'Human Name',
    small: 'short tagline',
    icon: '🎨',
    needsMagick: true,          // gates run button until WASM ready
    batchMode: false,           // true = one call w/ all files; false = per-file loop
    // Optional branch flags:
    isSlotMachine: true,        // delegate entirely to tool.run()
    isPaylines: true,
    isBrowser: true,
    desc: 'settings panel description…'
  },
  settingsHTML() { return `<div class="field-row">…</div>`; },
  outName(inputName) { return inputName.replace(/\.png$/i, '_x.png'); },
  async run(uint8, name, file, allFiles) { /* return Blob */ }
};
```

Wiring-up happens in `app.js` (L3724+):
```js
const ART_TOOLS     = [ToolCrop, ToolScaler, ToolWebp, ...];
const BROWSER_TOOLS = [ToolSoundBrowser, ToolArtBrowser];
const TOOLS         = [...ART_TOOLS, ...BROWSER_TOOLS];
```

**Script order is critical.** Every `const ToolX = {…}` block MUST appear BEFORE
the `app.js` block, or `TOOLS` initialization throws `ReferenceError`.

---

## React version: hard-won gotchas

### 1. Settings state lives in components, not context
ToolPanel runs the tool but doesn't own its settings (quality slider, mode
selects). Each tool component manages its own state (`useState`) and keeps a ref
to pass fresh values to the registered runner without re-registering:
```jsx
const settingsRef = useRef({ quality, lossless });
settingsRef.current = { quality, lossless };  // Sync on every render
```

### 2. WASM import is async, not bundled
Magick is fetched from CDN at runtime (not bundled) to avoid shipping 2+ MB. The
`useMagick` hook handles the async load. If you need to use Magick in a tool,
wait for `magickReady` before allowing RUN.

### 3. File objects must be kept alive during async ops
When adding files to context, store both the `File` object (for `.arrayBuffer()`)
and a blob URL (for preview `<img>`). Don't discard the File until the tool
finishes running.

### 4. AnimatePresence needs a key to animate exit
ResultsGrid wraps cards in `<AnimatePresence>` to animate departures. Each card
must have a stable `key` (e.g., `key={f.name}`) or the animation won't play.

---

## Original version: hard-won gotchas (reference)

### 1. ArrayBuffer detachment in WASM pipelines
`_Magick.Call` **transfers** the input `ArrayBuffer` — after the call the
original is detached and zero-length. If a pipeline makes 2+ WASM calls on the
same source buffer, `.slice()` it BEFORE the first call:
```js
const copy = new Uint8Array(original.buffer.slice(0));
```

### 2. `wasm-imagemagick` import syntax
CDN exposes **named exports**. Use:
```js
import * as Magick from 'https://knicknic.github.io/wasm-imagemagick/magickApi.js';
```
Not `import Magick from …` — that binds to `undefined`.

### 3. Canvas premultiplies alpha — avoid it for output
`getImageData` / `putImageData` corrupt straight-alpha pixels (channels decay
when alpha < 255). For any RGBA workflow that cares about channel integrity
(RGBA mask combiner, grey-to-alpha, gradient map), feed raw bytes to ImageMagick
with the `rgba:` format specifier instead of round-tripping through canvas.
Canvas is fine for *reading* source and *displaying* previews, not for output.

### 4. Private repo media needs JS fetch + blob URL
`<img src=…>` and `<audio src=…>` cannot send `Authorization` or `PRIVATE-TOKEN`
headers. For private GitHub/GitLab assets, fetch with auth headers, wrap the
response in `URL.createObjectURL(blob)`, and cache the blob URL. See the
repo-browser block (L2325+) for the working pattern.

### 5. Audio element layout differs cross-browser
Chrome and Firefox render `<audio controls>` differently (width/height
defaults). Sound Browser sets explicit dimensions — don't "simplify" them away.

---

## Repo-browser (L2325+) — key facts

- State lives in `_gh` (provider, token, baseUrl, owner, repo, repos, branch).
- Provider auto-detects from token prefix: `glpat-` → gitlab; `ghp_` / `github_pat_` → github; bare 20-char → gitlab.
- Default GitLab base: `https://gitlab.yggdrasil.lan` (internal build).
- Cross-repo search: prefix-filtered repo list (up to ~170), 8-worker concurrent
  pool, cached results, cancellable, live progress, click-through to match.
- Trees fetched via one recursive GitHub/GitLab Trees API call per repo —
  avoid n+1 directory listings.

---

## Working conventions

- **Surgical edits, not rewrites.** Target the exact line range; leave the rest
  alone. When a full-file output isn't practical, return clearly-labeled diff
  blocks (`// === replace L1234-L1256 with: ===`).
- **Compact style.** Two-column settings panels, `.field-row` grid, short
  inline CSS rules (see L57-L99). Match surrounding density — don't prettify.
- **Output naming.** Tool outputs use suffix-underscore convention:
  `_gmap.png`, `_scaled.png`, `_rgba.png`, etc. Defined in each tool's `outName()`.
- **Versioned filenames.** Release files: `ygg-toolkit-v12_3.html`
  (underscore for minor, not dot).
- **Commits / deliverables.** Edits to `/mnt/project/` are read-only in the
  chat sandbox — copy to `/mnt/user-data/outputs/` and present with
  `present_files` for the user to download.
- **Event bus.** The tiny `on(e, fn)` / `emit(e, data)` pair at L395-L398 is
  how cross-block communication happens. Known events: `toolSwitched`,
  `filesChanged`. Add more when you need to, don't reach into DOM from unrelated
  tools.

---

## React version: what NOT to do

- Do not import tools directly in components — use the runner registry.
- Do not store settings in context — let tools own their state.
- Do not make WASM calls before `magickReady` is true.
- Do not assume blob URLs persist after the component unmounts — store both File
  and URL, revoke URLs when removing files.
- Do not skip `useEffect` cleanup (return statement) in tool runners — register
  runner on mount, deregister on unmount.

---

## Original version: what NOT to do

- Do not introduce a build step, bundler, or package manager to `index.html`.
- Do not split tools into external files or ES modules.
- Do not use canvas round-tripping for alpha-sensitive pipelines.
- Do not reuse an `ArrayBuffer` across multiple `_Magick.Call` invocations.
- Do not set `<img src>` to a private-repo asset URL — fetch + blob it.
- Do not add new tool scripts AFTER the `app.js` block.
- Do not assume npm / node tooling is available at runtime — it isn't.
