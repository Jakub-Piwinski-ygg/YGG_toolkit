// components/SpinnerWizard.jsx
// Spinner setup wizard — 4 steps: Grid → Symbols → Timing → Review.
//
// Asset model
// ──────────────────────────────────────────────────────────────────────────
// The wizard receives two sources of PNG assets:
//   • scene.assets (type:'png')   — already in the scene (may have canvas layers)
//   • assetItems (type:'png')     — scanned from the project folder by the asset
//                                   browser. These are NOT in scene.assets yet and
//                                   have NO canvas layer. They're just descriptors:
//                                   { id, type, name, folder, path, … }
//
// Internally the wizard works with a unified pool of "wizard assets":
//   { id, type:'png', src, meta: { originalName } }
// which is the same shape as scene.assets entries. assetItems get converted
// on wizard open; existing scene.assets entries are merged in (deduped by src).
//
// On create, only wizard-asset entries that are (a) referenced by a symbol and
// (b) not already in scene.assets are emitted as newAssets — the caller adds
// them to scene.assets WITHOUT creating canvas layers.
//
// onCreate({ name, spinnerConfig, newAssets })
//
// Edit mode
// ──────────────────────────────────────────────────────────────────────────
// Pass `existingConfig` (a normalized spinner config) + `existingName` to re-open
// the wizard on an already-created spinner. All steps are pre-populated from the
// config; on submit the same onCreate({ name, spinnerConfig, newAssets }) payload
// is emitted — the caller patches the existing asset instead of adding a layer.
// In edit mode the wizard preserves config fields it doesn't expose (bounce,
// events, direction, perReel) and only regenerates strips/board when the symbol
// set or grid changed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragNumberField } from './DragNumberField.jsx';
import { NumberField } from '../../../components/NumberField.jsx';
import { resolveAssetFile } from '../engine/persist.js';
import {
  createEmptyScene,
  defaultTransformsForNewLayer,
  deriveFlowGraph,
  normalizeTrack,
} from '../engine/sceneModel.js';
import {
  generateNonWinningBoard,
  generateStrip,
  mulberry32,
  hash32,
  buildSpinnerTestClips,
  SPINNER_DEFAULT_STRIP_LEN,
  defaultSpinnerTiming,
  defaultSpinnerBounce,
  defaultSpinnerBlur,
  defaultSpinnerEvents,
} from '../engine/spinner/spinnerModel.js';

/** Build the synthetic spinner preview scene shown in the viewport while the
 * wizard is open: the referenced symbol assets + a centered spinner layer,
 * optionally with a one-shot test-spin track. */
function buildSpinnerPreviewScene(spinnerConfig, refAssets, testTrack, projectRoot = null) {
  if (!spinnerConfig) return null;
  const base = createEmptyScene('Spinner preview');
  base.projectRoot = projectRoot;
  // STABLE ids — createEmptyScene mints random canvas/ids each call, which would
  // change the viewport's structural hash on every rebuild (e.g. arming the test
  // track) and force a full Pixi rebuild → texture reload flash. Pinning them so
  // only a real config change (spinner.rev) rebuilds.
  base.canvases = [{ id: 'sprev_canvas', name: 'Canvas', visible: true }];
  base.activeCanvasId = 'sprev_canvas';
  const spId = 'sprev_spinner';
  base.assets = [...refAssets, { id: spId, type: 'spinner', spinner: spinnerConfig, meta: { originalName: 'preview' } }];
  base.layers = [{
    id: 'sprev_layer', name: 'preview', assetId: spId,
    canvasId: 'sprev_canvas', parentId: null, visible: true, blend: 'normal',
    transforms: defaultTransformsForNewLayer(base.stage)
  }];
  const tracks = testTrack ? [testTrack] : [];
  base.flow = deriveFlowGraph({ tracks, markers: [], nodes: [], edges: [] });
  base.timelines = [{ ...base.timelines[0], tracks }];
  if (testTrack) {
    const end = Math.max(1, ...testTrack.clips.map((c) => c.start + c.duration));
    base.stage = { ...base.stage, duration: Math.max(base.stage.duration, end) };
  }
  return base;
}
import { makeBlurredSymbol } from '../engine/spinner/spinnerBlur.js';
import { spineMatchScore, pickAnimName } from '../engine/spinner/symbolMatch.js';
import { BoardGridEditor } from './SpinnerInspectorSections.jsx';

const STEPS = ['grid', 'symbols', 'timing', 'review'];
const STEP_LABELS = { grid: '1. Grid', symbols: '2. Symbols', timing: '3. Timing', review: '4. Review' };

function uid(prefix = 's') {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

function defaultSymbol(n) {
  return { id: uid('sym'), name: `sym${n + 1}`, assetId: null, blurAssetId: null, landAnim: null, winAnim: null };
}

/** File stem — strip extension and any leading path. */
function assetBaseName(asset) {
  const n = asset?.meta?.originalName || asset?.id || '';
  return n.replace(/\.[^.]+$/, '').replace(/.*[/\\]/, '');
}

/**
 * Decode all path segments from asset.src.
 * Returns [] for blob: or data: URLs (no structural path info).
 */
function assetPathSegments(asset) {
  const src = String(asset?.src || '');
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return [];
  try {
    const url = new URL(src);
    return url.pathname.split('/').map((s) => decodeURIComponent(s)).filter(Boolean);
  } catch {
    return src.split(/[/\\]/).filter(Boolean);
  }
}

/** Score how likely an asset is a slot symbol (positive = yes, negative = no). */
function symbolScore(asset) {
  const base = assetBaseName(asset).toLowerCase();
  const segs = assetPathSegments(asset).map((s) => s.toLowerCase());

  let score = 0;
  // Strong negatives: known non-symbol filename prefixes
  if (/^(bg_|fs_|ui_|btn_|machine_|board_|panel_|frame_|logo_|counter_|game_|banner_|overlay_|popup_|base_)/.test(base))
    score -= 10;
  // Positives: "symbol" or "sym" folder in path
  if (segs.some((s) => s.includes('symbol') || s.includes('_sym') || s === 'sym'))
    score += 12;
  // Positives: "static" or "statics" subfolder
  if (segs.some((s) => /^statics?$/.test(s)))
    score += 6;
  // Positives: "blur" subfolder
  if (segs.some((s) => /^blur(red)?$/.test(s)))
    score += 4;
  // Positives: classic slot symbol name patterns (h1–h9, l1–l9, wild, scatter…)
  if (/^(h|l)\d+(_|$)/.test(base)) score += 10;
  if (/^(wild|scatter|bonus|freespin|free_spin|multiplier|ace|king|queen|jack|ten|nine|sym_)/.test(base))
    score += 8;
  // Negatives: non-symbol folder names in path
  if (segs.some((s) => /^(background|backgrounds|bg|machine|logo|buttons?|ui|overlays?)$/.test(s)))
    score -= 8;
  // Negatives: Animations / Spine folder (not a static sprite)
  if (segs.some((s) => /^(anim|animation|animations|spine|spines?)$/.test(s)))
    score -= 6;

  return score;
}

/** True if this asset looks like a motion-blur variant (should not be a static slot). */
function isBlurVariant(asset) {
  const base = assetBaseName(asset).toLowerCase();
  const segs = assetPathSegments(asset).map((s) => s.toLowerCase());
  return (
    segs.some((s) => /^blur(red)?$/.test(s)) ||
    /(_blur|_blurred|_blr|_motion)(\.[^.]+)?$/.test(base)
  );
}

/** Find the blur counterpart for a static asset (by name suffix or Blur subfolder). */
function findBlurPair(staticAsset, pool) {
  const base = assetBaseName(staticAsset).toLowerCase();
  return (
    pool.find((a) => {
      if (a.id === staticAsset.id) return false;
      const n = assetBaseName(a).toLowerCase();
      const segs = assetPathSegments(a).map((s) => s.toLowerCase());
      const inBlurFolder = segs.some((s) => /^blur(red)?$/.test(s));
      return (
        (inBlurFolder && n === base) ||
        n === base + '_blur' ||
        n === base + '_blurred' ||
        n === base + '_blr' ||
        n.startsWith(base + '_blur')
      );
    }) || null
  );
}

/** Find the best-matching Spine asset for a symbol name (or null). */
function findSpineForSymbol(symName, spinePool) {
  if (!symName || !spinePool.length) return null;
  let best = null;
  let bestScore = 0;
  for (const a of spinePool) {
    const score = spineMatchScore(symName, assetBaseName(a));
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

// ── Structure-driven detection ───────────────────────────────────────────────
//
// The canonical Yggdrasil layout the wizard targets:
//
//   <...>/08_Symbols/            any "NN_Symbols" / "Symbols" folder
//     ├── StaticArt/             ← one PNG per symbol — the source of truth
//     ├── Animations/            ← Spine land/win anims (optional)
//     └── Blurred/               ← pre-made blur PNG per symbol (optional)
//
// Statics define the symbol set; Animations and Blurred only ever *match
// against* static names. This replaces scoring every PNG in the project,
// which over-matched badly on real projects.

const isSymbolsSegment = (s) => /^(\d+[_ -])?symbols?$/i.test(s);
const isStaticSegment  = (s) => /^static/i.test(s);
const isBlurSegment    = (s) => /^blur/i.test(s);
const isAnimSegment    = (s) => /^anim/i.test(s);

/**
 * Detect the symbols folder structure from asset paths.
 * Returns null when no *Symbols folder exists in the pool, otherwise
 * { rootLabel, statics, blurred, anims } where statics/blurred are PNG
 * wizard-assets and anims are Spine wizard-assets, all under that root.
 */
function detectSymbolsStructure(pngPool, spinePool) {
  // Group PNGs by their *Symbols root (path up to and incl. the Symbols segment)
  const groups = new Map(); // rootKey → { rootLabel, statics, blurred, loose }
  for (const a of pngPool) {
    const segs = assetPathSegments(a);
    const i = segs.findIndex(isSymbolsSegment);
    if (i < 0) continue;
    const rootKey = segs.slice(0, i + 1).join('/').toLowerCase();
    if (!groups.has(rootKey))
      groups.set(rootKey, { rootKey, rootLabel: segs[i], statics: [], blurred: [], loose: [] });
    const g = groups.get(rootKey);
    const sub = segs[i + 1]; // subfolder name, or the filename if PNG sits in root
    const isFile = i + 1 === segs.length - 1;
    if (!isFile && isStaticSegment(sub)) g.statics.push(a);
    else if (!isFile && isBlurSegment(sub)) g.blurred.push(a);
    else if (isFile) g.loose.push(a);
    // PNGs in Animations/ are Spine atlas pages — ignore.
  }
  if (!groups.size) return null;

  // Pick the root with the most statics (tie-break: most PNGs overall)
  let best = null;
  for (const g of groups.values()) {
    const score = [g.statics.length, g.statics.length + g.blurred.length + g.loose.length];
    const bestScore = best ? [best.statics.length, best.statics.length + best.blurred.length + best.loose.length] : [-1, -1];
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) best = g;
  }
  if (!best) return null;

  // No StaticArt subfolder → PNGs sitting directly in the Symbols folder are
  // the statics (minus obvious blur variants).
  const statics = best.statics.length
    ? best.statics
    : best.loose.filter((a) => !isBlurVariant(a));
  if (!statics.length) return null;

  // Spine assets under the same root (prefer an Animations/ subfolder; fall
  // back to anything under the root if there is none).
  const spineUnderRoot = spinePool.filter((a) => {
    const segs = assetPathSegments(a);
    const i = segs.findIndex(isSymbolsSegment);
    if (i < 0) return false;
    return segs.slice(0, i + 1).join('/').toLowerCase() === best.rootKey;
  });
  const spineInAnimFolder = spineUnderRoot.filter((a) => {
    const segs = assetPathSegments(a);
    const i = segs.findIndex(isSymbolsSegment);
    return segs.slice(i + 1, -1).some(isAnimSegment);
  });
  const anims = spineInAnimFolder.length ? spineInAnimFolder : spineUnderRoot;

  return {
    rootLabel: best.rootLabel,
    statics: statics.slice().sort((a, b) => assetBaseName(a).localeCompare(assetBaseName(b))),
    blurred: best.blurred,
    anims,
  };
}

/**
 * Build candidate list for the "fill from assets" button.
 *
 * • With filter text: any asset whose name+path contains any filter word.
 * • Without text:     assets with a strictly POSITIVE score — requires at least
 *   one positive signal (symbol folder, classic slot name, static subfolder…).
 *   Score 0 = "no evidence either way" → excluded to avoid flooding the list
 *   with neutral-named background/UI/machine assets.
 *
 * Returns null when the heuristic finds nothing (caller shows a hint instead
 * of silently falling back to the full pool).
 */
function buildCandidates(pool, filterText) {
  const words = filterText.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return pool.filter((a) => {
      const hay = [assetBaseName(a), ...assetPathSegments(a)].join('/').toLowerCase();
      return words.some((w) => hay.includes(w));
    });
  }
  // Require a positive score — score 0 (neutral asset, no recognizable signals)
  // is intentionally excluded so bg/machine/UI assets don't sneak through.
  const nonBlur = pool.filter((a) => !isBlurVariant(a));
  const scored  = nonBlur.filter((a) => symbolScore(a) > 0);
  return scored; // may be empty — caller shows a hint
}

// ── Preview cells ────────────────────────────────────────────────────────────

const isDirectUrl = (src) => /^(blob:|data:|https?:)/.test(String(src || ''));

/** Small image preview that resolves project-relative paths via rootHandle. */
function SymbolThumb({ label, asset, rootHandle }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let created = null;
    setUrl(null);
    setFailed(!asset?.src);
    if (!asset?.src) return undefined;
    const src = String(asset.src);
    if (isDirectUrl(src)) { setUrl(src); return undefined; }
    (async () => {
      try {
        const file = rootHandle ? await resolveAssetFile(src, rootHandle) : null;
        if (!file) { if (alive) setFailed(true); return; }
        created = URL.createObjectURL(file);
        if (alive) setUrl(created);
        else URL.revokeObjectURL(created);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [asset?.id, asset?.src, rootHandle]);

  const missing = !asset || failed;
  return (
    <div
      className={'spinner-thumb' + (missing ? ' spinner-thumb--missing' : '')}
      title={asset ? `${label}: ${assetBaseName(asset)}` : `${label}: missing`}
    >
      <span className="spinner-thumb-box">
        {url ? <img src={url} alt="" /> : missing ? '✕' : '…'}
      </span>
      <em>{label}</em>
    </div>
  );
}

/** Land/win cell: spine file + resolved animation name, or what's missing. */
function AnimBadge({ label, anim, spinePool }) {
  const spineA = anim?.assetId ? spinePool.find((a) => a.id === anim.assetId) : null;
  const state = spineA && anim?.anim ? 'ok' : spineA ? 'warn' : 'missing';
  const title =
    state === 'ok' ? `${label}: ${assetBaseName(spineA)} → ${anim.anim}`
    : state === 'warn' ? `${label}: ${assetBaseName(spineA)} — animation name not resolved`
    : `${label}: no spine assigned`;
  return (
    <div className={'spinner-thumb spinner-thumb--anim spinner-thumb--' + state} title={title}>
      <span className="spinner-thumb-box">
        {state === 'ok' ? <small>{anim.anim}</small> : state === 'warn' ? '?' : '✕'}
      </span>
      <em>{label}</em>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function SpinnerWizard({
  scene, assetItems, rootHandle, onClose, onCreate,
  existingConfig = null, existingName = null,
  embedded = false, onPreviewScene, onPreviewTime, refreshNonce = 0,
}) {
  const isEdit = !!existingConfig;
  const [step, setStep] = useState('grid');

  // Step 1 — grid
  const [name, setName] = useState(existingName || 'Spinner');
  const [reels, setReels] = useState(existingConfig?.grid?.reels ?? 5);
  const [rows, setRows] = useState(existingConfig?.grid?.rows ?? 3);
  const [cellW, setCellW] = useState(existingConfig?.grid?.cellW ?? 120);
  const [cellH, setCellH] = useState(existingConfig?.grid?.cellH ?? 120);
  const [spacingX, setSpacingX] = useState(existingConfig?.grid?.spacingX ?? 6);
  const [spacingY, setSpacingY] = useState(existingConfig?.grid?.spacingY ?? 6);

  // Step 2 — symbols
  const [symbols, setSymbols] = useState(() =>
    existingConfig?.symbols?.length
      ? existingConfig.symbols.map((s) => ({ ...s }))
      : Array.from({ length: 6 }, (_, i) => defaultSymbol(i))
  );
  const [assetFilter, setAssetFilter] = useState('');
  const [blurSigma, setBlurSigma] = useState(8);
  const [blurFeather, setBlurFeather] = useState(4);
  const [blurGenerating, setBlurGenerating] = useState(false);
  const [generatedAssets, setGeneratedAssets] = useState([]);

  // Step 3 — timing + blur
  const [timing, setTiming] = useState(() => ({ ...defaultSpinnerTiming(), ...(existingConfig?.timing || {}) }));
  const [blur, setBlur] = useState(() => ({ ...defaultSpinnerBlur(), ...(existingConfig?.blur || {}) }));

  // Step 4 — initial board
  const [initialBoard, setInitialBoard] = useState(existingConfig?.initialBoard || null);
  const [seed] = useState(() => existingConfig?.seed ?? (Math.floor(Math.random() * 0xFFFFFF) + 1));

  // ── Asset pool ────────────────────────────────────────────────────────────
  // scene.assets pngs that are already in the scene
  const scenePngAssets = (scene?.assets || []).filter((a) => a.type === 'png');
  const sceneSpineAssets = (scene?.assets || []).filter((a) => a.type === 'spine');

  // assetItems from the project folder scan → converted to the same shape as
  // scene.assets entries so the wizard can treat them uniformly.
  // We memoize this once at mount so IDs are stable throughout the session.
  const [browserPool] = useState(() => {
    const existingSrcs = new Set(scenePngAssets.map((a) => a.src));
    return (assetItems || [])
      .filter((it) => it.type === 'png' && !existingSrcs.has(it.path))
      .map((it) => ({
        id: uid('bp'),
        type: 'png',
        src: it.path,
        meta: { originalName: it.name, _fromBrowser: true },
      }));
  });

  // Spine assets from the asset browser (for anim pickers). MUST carry the
  // atlas + texture paths (browser items expose atlasPath/texturePath, incl.
  // the shared-atlas case) — otherwise a land/win anim picked here becomes a
  // scene asset with no atlas/texture and exports "partially" / fails to import.
  const [browserSpinePool] = useState(() => {
    const existingSrcs = new Set(sceneSpineAssets.map((a) => a.src));
    return (assetItems || [])
      .filter((it) => it.type === 'spine' && !existingSrcs.has(it.path || it.jsonPath))
      .map((it) => ({
        id: uid('bsp'),
        type: 'spine',
        src: it.path || it.jsonPath,
        atlas: it.atlasPath || it.atlas || null,
        texture: it.texturePath || it.texture || null,
        meta: { originalName: it.name, _fromBrowser: true },
      }));
  });

  // Unified pools used throughout the wizard
  const allPngAssets = [
    ...scenePngAssets,
    ...browserPool,
    ...generatedAssets.filter((a) => !scenePngAssets.find((p) => p.id === a.id)),
  ];
  const allSpineAssets = [...sceneSpineAssets, ...browserSpinePool];

  // ── Helpers ───────────────────────────────────────────────────────────────
  const patchTiming  = (patch) => setTiming((t) => ({ ...t, ...patch }));
  const patchBlur    = (patch) => setBlur((b) => ({ ...b, ...patch }));
  const patchSymbol  = (idx, patch) =>
    setSymbols((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addSymbol    = () => setSymbols((prev) => [...prev, defaultSymbol(prev.length)]);
  const removeSymbol = (idx) => setSymbols((prev) => prev.filter((_, i) => i !== idx));

  const validSymbols = symbols.filter((s) => s.name.trim());

  // ── Structure detection (NN_Symbols/StaticArt|Animations|Blurred) ─────────
  // Statics define the symbol set; blurred + anims only match against them.
  const structure = detectSymbolsStructure(allPngAssets, allSpineAssets);

  // Candidates for the "fill from assets" button:
  //   manual filter text → filtered pool (user override)
  //   detected structure → statics folder ONLY
  //   neither            → legacy name-score heuristic
  const candidates =
    assetFilter.trim() ? buildCandidates(allPngAssets, assetFilter)
    : structure        ? structure.statics
    : buildCandidates(allPngAssets, '');
  // True when no filter text AND nothing was detected (no Symbols folder, score ≤ 0 everywhere)
  const noAutoDetect  = !assetFilter.trim() && candidates.length === 0 && allPngAssets.length > 0;

  // Blur search order: detected Blurred folder first, then the whole pool.
  const blurSearchPool = structure ? [...structure.blurred, ...allPngAssets] : allPngAssets;
  // Anim search order: Spine assets from the symbols root's Animations folder
  // first, then everything (a symbol with no in-root match stays unassigned —
  // findSpineForSymbol matches by name, so unrelated spines don't leak in).
  const animSearchPool = structure?.anims?.length ? structure.anims : allSpineAssets;

  // ── Spine animation lists (read from the actual .json files) ─────────────
  // assetId → string[] (animation names) | null (file unreadable).
  const spineAnimsCacheRef = useRef(new Map());
  // "Refresh assets" re-reads files from disk — drop cached anim-name lists so
  // edited spine .json files re-parse.
  useEffect(() => { spineAnimsCacheRef.current.clear(); }, [refreshNonce]);

  const loadSpineAnims = useCallback(async (spineAsset) => {
    if (!spineAsset) return null;
    const cache = spineAnimsCacheRef.current;
    if (cache.has(spineAsset.id)) return cache.get(spineAsset.id);
    let names = null;
    try {
      const src = String(spineAsset.src || '');
      let text = null;
      if (isDirectUrl(src)) text = await (await fetch(src)).text();
      else if (rootHandle) {
        const file = await resolveAssetFile(src, rootHandle);
        if (file) text = await file.text();
      }
      if (text) names = Object.keys(JSON.parse(text).animations || {});
    } catch { /* unreadable → keep null, callers fall back to name guess */ }
    cache.set(spineAsset.id, names);
    return names;
  }, [rootHandle]);

  /** land/win entries for a symbol: real anim names when readable, guess otherwise. */
  const resolveAnimsFor = useCallback(async (symName, spineA) => {
    if (!spineA) return { landAnim: null, winAnim: null };
    const names = await loadSpineAnims(spineA);
    const entry = (kind) => {
      const picked = names ? pickAnimName(names, kind, symName) : null;
      // File unreadable → legacy guess; readable but no match → leave empty
      // so the UI flags it instead of inventing a wrong key.
      const anim = picked ?? (names ? '' : `${symName}_${kind}`);
      return { kind: 'spine', assetId: spineA.id, anim };
    };
    return { landAnim: entry('land'), winAnim: entry('win') };
  }, [loadSpineAnims]);

  // ── Auto-fill symbols ─────────────────────────────────────────────────────
  const autoFillFromAssets = async () => {
    if (!candidates.length) return;
    const nonBlurCandidates = candidates.filter((a) => !isBlurVariant(a));
    const built = await Promise.all(
      nonBlurCandidates.map(async (a) => {
        const symName   = assetBaseName(a);
        const blurAsset = findBlurPair(a, blurSearchPool);
        const spineA    = findSpineForSymbol(symName, animSearchPool);
        const anims     = await resolveAnimsFor(symName, spineA);
        return {
          id: uid('sym'),
          name: symName,
          assetId: a.id,
          blurAssetId: blurAsset?.id || null,
          ...anims,
        };
      })
    );
    setSymbols(built);
  };

  // ── Auto-match blur counterparts ──────────────────────────────────────────
  const autoMatchBlur = () => {
    setSymbols((prev) =>
      prev.map((sym) => {
        if (sym.blurAssetId) return sym;
        const staticA = allPngAssets.find((a) => a.id === sym.assetId);
        if (!staticA) return sym;
        const blurA = findBlurPair(staticA, blurSearchPool);
        return blurA ? { ...sym, blurAssetId: blurA.id } : sym;
      })
    );
  };

  // ── Auto-match spine anims ────────────────────────────────────────────────
  const autoMatchAnims = async () => {
    const updates = await Promise.all(
      symbols.map(async (sym) => {
        const spineA =
          sym.landAnim?.assetId
            ? allSpineAssets.find((a) => a.id === sym.landAnim.assetId)
            : findSpineForSymbol(sym.name, animSearchPool);
        if (!spineA) return null;
        const anims = await resolveAnimsFor(sym.name, spineA);
        return { symId: sym.id, anims };
      })
    );
    setSymbols((prev) =>
      prev.map((sym) => {
        const upd = updates.find((u) => u?.symId === sym.id);
        if (!upd) return sym;
        return {
          ...sym,
          landAnim: sym.landAnim?.anim ? sym.landAnim : upd.anims.landAnim,
          winAnim:  sym.winAnim?.anim  ? sym.winAnim  : upd.anims.winAnim,
        };
      })
    );
  };

  // Manual spine pick in a land/win dropdown: assign the file immediately,
  // then resolve the real animation name from it asynchronously.
  const assignSpineAnim = (symId, kind, assetId) => {
    const field = kind + 'Anim';
    setSymbols((prev) =>
      prev.map((s) =>
        s.id === symId
          ? { ...s, [field]: assetId ? { kind: 'spine', assetId, anim: '' } : null }
          : s
      )
    );
    if (!assetId) return;
    const spineA = allSpineAssets.find((a) => a.id === assetId);
    const symName = symbols.find((s) => s.id === symId)?.name || '';
    loadSpineAnims(spineA).then((names) => {
      const picked = names ? pickAnimName(names, kind, symName) : null;
      const anim = picked ?? (names ? '' : `${symName}_${kind}`);
      if (!anim) return;
      setSymbols((prev) =>
        prev.map((s) => {
          if (s.id !== symId) return s;
          const cur = s[field];
          // Bail if the user re-picked or typed a name in the meantime.
          if (!cur || cur.assetId !== assetId || cur.anim) return s;
          return { ...s, [field]: { ...cur, anim } };
        })
      );
    });
  };

  // ── Generate blur variants ────────────────────────────────────────────────
  const generateBlurs = async () => {
    setBlurGenerating(true);
    const newAssets     = [];
    const updatedSymbols = [...symbols];

    for (let i = 0; i < symbols.length; i++) {
      const sym   = symbols[i];
      if (!sym.assetId || sym.blurAssetId) continue;
      const asset = allPngAssets.find((a) => a.id === sym.assetId);
      if (!asset?.src) continue;
      try {
        const img = await new Promise((resolve, reject) => {
          const el  = new Image();
          el.crossOrigin = 'anonymous';
          el.onload  = () => resolve(el);
          el.onerror = reject;
          el.src     = asset.src;
        });
        const blob   = await makeBlurredSymbol(img, cellW, cellH, 1.0, blurSigma, blurFeather);
        const blobUrl = URL.createObjectURL(blob);
        const blurId  = uid('gen');
        newAssets.push({
          id: blurId,
          type: 'png',
          src: blobUrl,
          meta: { originalName: assetBaseName(asset) + '_blur.png', generated: true },
        });
        updatedSymbols[i] = { ...sym, blurAssetId: blurId };
      } catch (e) {
        console.warn('[SpinnerWizard] blur gen failed for', sym.name, e);
      }
    }

    setGeneratedAssets((prev) => [...prev, ...newAssets]);
    setSymbols(updatedSymbols);
    setBlurGenerating(false);
  };

  const symbolsNeedingBlur = symbols.filter((s) => s.assetId && !s.blurAssetId).length;

  // ── BoardGridEditor preview config ────────────────────────────────────────
  const previewConfig = { grid: { reels, rows, cellW, cellH, spacingX, spacingY }, symbols: validSymbols };

  // ── Live scene-view preview (embedded/full-focus) ──────────────────────────
  // Symbol art assets referenced by the (valid) symbols, so the preview spinner
  // can resolve its textures in the viewport.
  const referencedAssets = useMemo(() => {
    const ids = new Set(
      validSymbols.flatMap((s) => [s.assetId, s.blurAssetId, s.landAnim?.assetId, s.winAnim?.assetId]).filter(Boolean)
    );
    const out = [];
    for (const a of allPngAssets) if (ids.has(a.id)) out.push({ id: a.id, type: 'png', src: a.src, meta: a.meta });
    for (const a of allSpineAssets) if (ids.has(a.id)) out.push({ id: a.id, type: 'spine', src: a.src, atlas: a.atlas, texture: a.texture, meta: a.meta });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, allPngAssets.length, allSpineAssets.length]);

  // Stable strips for the preview (don't regenerate on every timing tweak).
  const previewStrips = useMemo(() => {
    const ids = validSymbols.map((s) => s.id);
    if (ids.length < 2) return null;
    const rand = mulberry32(seed);
    return Array.from({ length: reels }, () => generateStrip(ids, SPINNER_DEFAULT_STRIP_LEN, rand));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, reels, seed]);

  // The spinner config the preview renders. `rev` is a content hash so the
  // viewport rebuilds when grid/symbols/timing/blur change (the spinner caches
  // timing into its Pixi object at build time).
  //
  const [testRun, setTestRun] = useState(null); // { clips, total } | null
  const testTimeRef = useRef(0);
  const testRafRef = useRef(0);
  const testLastRef = useRef(0);

  // The spinner bakes its timing/blur into the Pixi object at BUILD time, and
  // Pixi v8 dislikes rapid rebuilds (SPINNER.md §20.10). We DEBOUNCE the rebuild:
  // `bakedRev` only catches up to the live content hash after edits settle
  // (150ms), so dragging a slider doesn't thrash the renderer, AND the object
  // stays STABLE during a test spin (no texture reload → no blank/blur flash).
  const contentHash = useMemo(() => hash32(JSON.stringify({
    s: validSymbols.map((s) => [s.id, s.assetId, s.blurAssetId, s.landAnim, s.winAnim]),
    g: { reels, rows, cellW, cellH, spacingX, spacingY },
    t: timing, b: blur, board: initialBoard,
  })) || 1, [symbols, reels, rows, cellW, cellH, spacingX, spacingY, timing, blur, initialBoard]);
  const [bakedRev, setBakedRev] = useState(contentHash);
  useEffect(() => {
    const id = setTimeout(() => setBakedRev(contentHash), 150);
    return () => clearTimeout(id);
  }, [contentHash]);

  const previewSpinnerConfig = useMemo(() => {
    const ids = validSymbols.map((s) => s.id);
    if (ids.length < 2 || !previewStrips) return null;
    const idSet = new Set(ids);
    const boardValid = initialBoard && initialBoard.length === reels
      && initialBoard.every((col) => Array.isArray(col) && col.length === rows && col.every((c) => idSet.has(c)));
    const board = boardValid ? initialBoard : generateNonWinningBoard(ids, reels, rows, seed);
    const cfg = {
      symbols: validSymbols,
      grid: { reels, rows, cellW, cellH, spacingX, spacingY },
      strips: previewStrips,
      initialBoard: board,
      seed,
      direction: existingConfig?.direction ?? 1,
      timing,
      bounce: existingConfig?.bounce || defaultSpinnerBounce(),
      blur,
      events: existingConfig?.events || defaultSpinnerEvents(),
      perReel: existingConfig?.perReel || [],
    };
    // Debounced rebuild rev (settles ~150ms after the last edit).
    cfg.rev = bakedRev;
    return cfg;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, reels, rows, cellW, cellH, spacingX, spacingY, timing, blur, initialBoard, seed, previewStrips, bakedRev]);

  // Test-spin transport: when `testRun` is set, the preview scene includes a
  // one-shot startSpin→spin→stopSpin track and the clock runs once to its end.
  const testTrack = useMemo(() => {
    if (!testRun) return null;
    return normalizeTrack({ id: 'sprev_track', layerId: 'sprev_layer', clips: testRun.clips });
  }, [testRun]);

  const previewScene = useMemo(
    () => buildSpinnerPreviewScene(previewSpinnerConfig, referencedAssets, testTrack, scene?.projectRoot || null),
    [previewSpinnerConfig, referencedAssets, testTrack, scene?.projectRoot]
  );

  // Push the preview scene up to the host viewport.
  useEffect(() => {
    if (!embedded || !onPreviewScene) return;
    onPreviewScene(previewScene);
  }, [embedded, onPreviewScene, previewScene]);

  // Drive the test-spin clock once through, then hold on the result.
  useEffect(() => {
    if (!embedded || !onPreviewTime) return undefined;
    if (!testRun) { testTimeRef.current = 0; onPreviewTime(0); return undefined; }
    testTimeRef.current = 0;
    testLastRef.current = 0;
    onPreviewTime(0);
    const frame = (ts) => {
      const dt = testLastRef.current ? Math.min(0.05, (ts - testLastRef.current) / 1000) : 0;
      testLastRef.current = ts;
      testTimeRef.current = Math.min(testRun.total, testTimeRef.current + dt);
      onPreviewTime(testTimeRef.current);
      if (testTimeRef.current < testRun.total) testRafRef.current = requestAnimationFrame(frame);
    };
    testRafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(testRafRef.current);
  }, [embedded, onPreviewTime, testRun]);

  const runTestSpin = () => {
    if (!previewSpinnerConfig) return;
    // Arm the one-shot test track (a fresh object each click restarts the
    // clock). The spinner is already baked with current timing (debounced
    // rebuild), so no flash — it spins from the current board exactly like the
    // scene timeline.
    setTestRun(buildSpinnerTestClips(previewSpinnerConfig));
  };
  const resetPreview = () => setTestRun(null);

  const goToStep = (next) => {
    if (next === 'review') {
      const ids = validSymbols.map((s) => s.id);
      if (ids.length >= 2)
        setInitialBoard((prev) => prev || generateNonWinningBoard(ids, reels, rows, seed));
    }
    setStep(next);
  };

  // ── Create spinner ────────────────────────────────────────────────────────
  const handleCreate = useCallback(() => {
    const symIds = validSymbols.map((s) => s.id);
    if (symIds.length < 2) return;

    // Preserve existing strips when editing and neither the symbol set nor the
    // reel count changed; otherwise regenerate (old strips would carry dangling
    // symbol ids or the wrong reel count).
    const prevIds = existingConfig ? (existingConfig.symbols || []).map((s) => s.id) : null;
    const sameSymbols = prevIds && prevIds.length === symIds.length && prevIds.every((id) => symIds.includes(id));
    const sameReels = existingConfig?.grid?.reels === reels;
    let strips;
    if (existingConfig?.strips?.length && sameSymbols && sameReels) {
      strips = existingConfig.strips;
    } else {
      const rand = mulberry32(seed);
      strips = Array.from({ length: reels }, () =>
        generateStrip(symIds, SPINNER_DEFAULT_STRIP_LEN, rand)
      );
    }

    // Keep the edited board only if it still matches the grid and every cell is
    // a current symbol; otherwise generate a fresh non-winning board.
    const idSet = new Set(symIds);
    const boardValid = initialBoard
      && initialBoard.length === reels
      && initialBoard.every((col) => Array.isArray(col) && col.length === rows && col.every((c) => idSet.has(c)));
    const board = boardValid ? initialBoard : generateNonWinningBoard(symIds, reels, rows, seed);

    const spinnerConfig = {
      rev: (existingConfig?.rev || 0) + 1,
      symbols: validSymbols,
      grid: { reels, rows, cellW, cellH, spacingX, spacingY },
      strips,
      initialBoard: board,
      seed,
      direction: existingConfig?.direction ?? 1,
      timing,
      bounce: existingConfig?.bounce || defaultSpinnerBounce(),
      blur,
      events: existingConfig?.events || defaultSpinnerEvents(),
      perReel: existingConfig?.perReel || [],
    };

    // Only emit assets that are used and not already in scene.assets
    const sceneAssetIds = new Set((scene?.assets || []).map((a) => a.id));
    const referencedIds = new Set(validSymbols.flatMap((s) => [s.assetId, s.blurAssetId]).filter(Boolean));
    const newAssets = [
      // Assets from the browser pool that were selected as symbols
      ...browserPool.filter((a) => referencedIds.has(a.id) && !sceneAssetIds.has(a.id)),
      // Generated blur variants
      ...generatedAssets.filter((a) => referencedIds.has(a.id) && !sceneAssetIds.has(a.id)),
      // Spine assets from browser that are referenced by any symbol's land/win anim
      ...browserSpinePool.filter((a) => {
        const usedByAnim = validSymbols.some(
          (s) => s.landAnim?.assetId === a.id || s.winAnim?.assetId === a.id
        );
        return usedByAnim && !sceneAssetIds.has(a.id);
      }),
    ];

    onCreate?.({ name: name.trim() || 'Spinner', spinnerConfig, newAssets });
  }, [
    validSymbols, reels, rows, cellW, cellH, spacingX, spacingY,
    timing, blur, initialBoard, seed, name,
    browserPool, browserSpinePool, generatedAssets,
    scene, onCreate, existingConfig,
  ]);

  const stepIdx = STEPS.indexOf(step);
  const canNext =
    step === 'grid'    ? reels >= 1 && rows >= 1 :
    step === 'symbols' ? validSymbols.length >= 2 :
    true;

  // ── Render ────────────────────────────────────────────────────────────────
  const Shell = embedded ? SpinnerEmbeddedShell : SpinnerOverlayShell;
  return (
    <Shell>
      <div className={'spinner-wizard' + (embedded ? ' spinner-wizard--embedded' : '')}>

        <div className="spinner-wizard-head">
          <span className="spinner-wizard-title">{isEdit ? '✎ Edit Spinner' : '＋ New Spinner'}</span>
          <div className="spinner-wizard-steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={'spinner-wizard-step-btn' + (s === step ? ' active' : '') + (i < stepIdx ? ' done' : '')}
                onClick={() => goToStep(s)}
                disabled={i > stepIdx && !canNext}
              >
                {STEP_LABELS[s]}
              </button>
            ))}
          </div>
          <button type="button" className="scene-icon-btn" onClick={onClose} title="Cancel">✕</button>
        </div>

        <div className="spinner-wizard-body">

          {/* ── Step 1: Grid ─────────────────────────────────────── */}
          {step === 'grid' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">Grid &amp; Name</div>
              <label className="scene-field">
                <span>name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spinner" />
              </label>
              <div className="spinner-wizard-row">
                <DragNumberField label="reels" value={reels} step={1} min={1} max={9}
                  onChange={(v) => setReels(Math.max(1, Math.min(9, Math.round(v))))} />
                <DragNumberField label="rows" value={rows} step={1} min={1} max={6}
                  onChange={(v) => setRows(Math.max(1, Math.min(6, Math.round(v))))} />
              </div>
              <div className="spinner-wizard-row">
                <DragNumberField label="cell W px" value={cellW} step={4} min={32}
                  onChange={(v) => setCellW(Math.max(32, Math.round(v)))} />
                <DragNumberField label="cell H px" value={cellH} step={4} min={32}
                  onChange={(v) => setCellH(Math.max(32, Math.round(v)))} />
              </div>
              <div className="spinner-wizard-row">
                <DragNumberField label="spacing X" value={spacingX} step={2} min={0}
                  onChange={(v) => setSpacingX(Math.max(0, Math.round(v)))} />
                <DragNumberField label="spacing Y" value={spacingY} step={2} min={0}
                  onChange={(v) => setSpacingY(Math.max(0, Math.round(v)))} />
              </div>
              <div className="scene-spinner-meta">
                Grid: {reels * cellW + (reels - 1) * spacingX} × {rows * cellH + (rows - 1) * spacingY} px
              </div>
            </div>
          )}

          {/* ── Step 2: Symbols ──────────────────────────────────── */}
          {step === 'symbols' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">
                Symbols ({validSymbols.length} valid)
                <span className="scene-pill">{allPngAssets.length} PNG{allPngAssets.length !== 1 ? 's' : ''} in project</span>
              </div>

              {allPngAssets.length === 0 ? (
                <div className="scene-spinner-meta" style={{ color: 'var(--text-2)' }}>
                  No PNG assets found. Open a project folder in the asset browser first,
                  or load PNGs via the Content Browser.
                </div>
              ) : (
                <>
                  {/* Filter + fill */}
                  <div className="spinner-asset-filter">
                    <input
                      type="text"
                      className="spinner-filter-input"
                      placeholder="filter by folder or name (e.g. Symbols, Static, h1)"
                      value={assetFilter}
                      onChange={(e) => setAssetFilter(e.target.value)}
                    />
                    <span className="spinner-filter-count">
                      {candidates.length} match
                    </span>
                  </div>

                  {structure && !assetFilter.trim() && (
                    <div className="scene-spinner-meta" style={{ marginBottom: 6 }}>
                      📁 <strong>{structure.rootLabel}</strong> detected —{' '}
                      {structure.statics.length} static{structure.statics.length !== 1 ? 's' : ''}
                      {' · '}{structure.blurred.length} blurred
                      {' · '}{structure.anims.length} spine anim{structure.anims.length !== 1 ? 's' : ''}
                    </div>
                  )}

                  {noAutoDetect && (
                    <div className="scene-spinner-meta" style={{ color: 'var(--text-2)', marginBottom: 6 }}>
                      No <em>Symbols</em> folder detected — type a folder name above (e.g. <em>Symbols</em>, <em>Static</em>) to filter.
                    </div>
                  )}

                  <div className="spinner-wizard-auto-row">
                    <button
                      type="button"
                      className="scene-btn scene-btn--ghost"
                      onClick={autoFillFromAssets}
                      disabled={candidates.length === 0}
                      title={
                        candidates.length === 0 ? 'Type a folder name in the filter above'
                        : structure && !assetFilter.trim()
                          ? `Create ${candidates.length} symbol(s) from ${structure.rootLabel} statics, matching blur + anims by name`
                          : `Create ${candidates.length} symbol(s) from matching assets`
                      }
                    >
                      ⬇ {structure && !assetFilter.trim() ? `fill from ${structure.rootLabel}` : 'fill from assets'} ({candidates.length})
                    </button>
                    <button type="button" className="scene-btn scene-btn--ghost" onClick={autoMatchBlur}
                      title="Find blur counterparts by filename suffix or Blur subfolder">
                      ↔ match blur
                    </button>
                    {allSpineAssets.length > 0 && (
                      <button type="button" className="scene-btn scene-btn--ghost" onClick={autoMatchAnims}
                        title="Auto-assign land/win Spine animations by matching symbol name">
                        ↔ match anims
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Symbol list */}
              <div className="spinner-sym-list">
                {symbols.map((sym, i) => (
                  <div key={sym.id} className="spinner-sym-entry">
                    <div className="spinner-sym-row">
                      <input
                        className="spinner-sym-name"
                        type="text"
                        value={sym.name}
                        placeholder={`sym${i + 1}`}
                        onChange={(e) => patchSymbol(i, { name: e.target.value })}
                      />
                      <select
                        className="spinner-sym-asset"
                        value={sym.assetId || ''}
                        onChange={(e) => patchSymbol(i, { assetId: e.target.value || null })}
                        title="Static PNG"
                      >
                        <option value="">— static PNG —</option>
                        {allPngAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {assetBaseName(a) || a.id}
                            {a.meta?.generated ? ' (gen)' : a.meta?._fromBrowser ? ' ◈' : ''}
                          </option>
                        ))}
                      </select>
                      <select
                        className="spinner-sym-asset"
                        value={sym.blurAssetId || ''}
                        onChange={(e) => patchSymbol(i, { blurAssetId: e.target.value || null })}
                        title="Blur PNG (optional)"
                      >
                        <option value="">— blur PNG —</option>
                        {allPngAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {assetBaseName(a) || a.id}
                            {a.meta?.generated ? ' (gen)' : a.meta?._fromBrowser ? ' ◈' : ''}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="scene-icon-btn" onClick={() => removeSymbol(i)} title="Remove">✕</button>
                    </div>

                    <div className="spinner-sym-previews">
                      <SymbolThumb label="static" asset={allPngAssets.find((a) => a.id === sym.assetId) || null} rootHandle={rootHandle} />
                      <SymbolThumb label="blur" asset={allPngAssets.find((a) => a.id === sym.blurAssetId) || null} rootHandle={rootHandle} />
                      <AnimBadge label="land" anim={sym.landAnim} spinePool={allSpineAssets} />
                      <AnimBadge label="win" anim={sym.winAnim} spinePool={allSpineAssets} />
                    </div>

                    {allSpineAssets.length > 0 && (
                      <div className="spinner-sym-anim-row">
                        <span className="spinner-sym-anim-label">land</span>
                        <select
                          className="spinner-sym-asset spinner-sym-asset--sm"
                          value={sym.landAnim?.assetId || ''}
                          onChange={(e) => assignSpineAnim(sym.id, 'land', e.target.value || null)}
                        >
                          <option value="">— spine —</option>
                          {allSpineAssets.map((a) => (
                            <option key={a.id} value={a.id}>{assetBaseName(a) || a.id}</option>
                          ))}
                        </select>
                        <input
                          className="spinner-sym-anim-name"
                          type="text"
                          placeholder={`${sym.name}_land`}
                          value={sym.landAnim?.anim || ''}
                          onChange={(e) => {
                            if (sym.landAnim?.assetId)
                              patchSymbol(i, { landAnim: { ...sym.landAnim, anim: e.target.value } });
                          }}
                        />
                        <NumberField
                          className="spinner-sym-anim-name spinner-sym-anim-offset"
                          step={0.05}
                          title="Land anim timing offset (s): negative = before the land moment, positive = after"
                          placeholder="+0s"
                          style={{ width: 52 }}
                          value={sym.landAnim?.offset}
                          onChange={(v) => {
                            if (!sym.landAnim?.assetId) return;
                            patchSymbol(i, { landAnim: { ...sym.landAnim, offset: v } });
                          }}
                        />
                        <span className="spinner-sym-anim-label">win</span>
                        <select
                          className="spinner-sym-asset spinner-sym-asset--sm"
                          value={sym.winAnim?.assetId || ''}
                          onChange={(e) => assignSpineAnim(sym.id, 'win', e.target.value || null)}
                        >
                          <option value="">— spine —</option>
                          {allSpineAssets.map((a) => (
                            <option key={a.id} value={a.id}>{assetBaseName(a) || a.id}</option>
                          ))}
                        </select>
                        <input
                          className="spinner-sym-anim-name"
                          type="text"
                          placeholder={`${sym.name}_win`}
                          value={sym.winAnim?.anim || ''}
                          onChange={(e) => {
                            if (sym.winAnim?.assetId)
                              patchSymbol(i, { winAnim: { ...sym.winAnim, anim: e.target.value } });
                          }}
                        />
                        <NumberField
                          className="spinner-sym-anim-name spinner-sym-anim-offset"
                          step={0.05}
                          title="Win anim timing offset (s): negative = before the win moment, positive = after"
                          placeholder="+0s"
                          style={{ width: 52 }}
                          value={sym.winAnim?.offset}
                          onChange={(v) => {
                            if (!sym.winAnim?.assetId) return;
                            patchSymbol(i, { winAnim: { ...sym.winAnim, offset: v } });
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button type="button" className="scene-btn scene-btn--ghost" onClick={addSymbol}>+ symbol</button>

              {/* Blur generation */}
              {symbolsNeedingBlur > 0 && (
                <div className="spinner-blur-gen">
                  <div className="scene-field-group-sub">
                    {symbolsNeedingBlur} symbol{symbolsNeedingBlur !== 1 ? 's' : ''} without a blur PNG — generate the missing ones
                  </div>
                  <div className="spinner-wizard-row">
                    <DragNumberField label="sigma px" value={blurSigma} step={1} min={1} max={64}
                      onChange={(v) => setBlurSigma(Math.max(1, Math.round(v)))} />
                    <DragNumberField label="feather px" value={blurFeather} step={1} min={0} max={32}
                      onChange={(v) => setBlurFeather(Math.max(0, Math.round(v)))} />
                  </div>
                  <button
                    type="button"
                    className="scene-btn scene-btn--ghost"
                    onClick={generateBlurs}
                    disabled={blurGenerating}
                  >
                    {blurGenerating ? '⏳ generating…' : `⚡ fill missing blurs (${symbolsNeedingBlur})`}
                  </button>
                </div>
              )}

              {validSymbols.length < 2 && (
                <div className="scene-spinner-meta" style={{ color: 'var(--err, #f88)', marginTop: 6 }}>
                  Need at least 2 symbols with non-empty names.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Timing ───────────────────────────────────── */}
          {step === 'timing' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">Timing</div>
              <DragNumberField label="spin speed c/s" value={timing.spinSpeed} step={0.5} min={1}
                onChange={(v) => patchTiming({ spinSpeed: Math.max(1, v) })} />
              <DragNumberField label="min spin time s" value={timing.minSpinTime ?? 1} step={0.1} min={0.1}
                onChange={(v) => patchTiming({ minSpinTime: Math.max(0.1, v) })} />
              <DragNumberField label="start dur s" value={timing.startDuration} step={0.05} min={0.05}
                onChange={(v) => patchTiming({ startDuration: Math.max(0.05, v) })} />
              <DragNumberField label="stop dur s" value={timing.stopDuration} step={0.05} min={0.05}
                onChange={(v) => patchTiming({ stopDuration: Math.max(0.05, v) })} />
              <DragNumberField label="stagger start s" value={timing.reelStaggerStart} step={0.01} min={0}
                onChange={(v) => patchTiming({ reelStaggerStart: Math.max(0, v) })} />
              <DragNumberField label="stagger stop s" value={timing.reelStaggerStop} step={0.01} min={0}
                onChange={(v) => patchTiming({ reelStaggerStop: Math.max(0, v) })} />

              <div className="scene-field-group-head" style={{ marginTop: 12 }}>Blur crossfade</div>
              <label className="scene-field scene-field--check">
                <input type="checkbox" checked={blur.enabled}
                  onChange={(e) => patchBlur({ enabled: e.target.checked })} />
                <span>enable blur crossfade</span>
              </label>
              {blur.enabled && (
                <>
                  <DragNumberField label="blur start c/s" value={blur.vLo} step={0.5} min={0}
                    onChange={(v) => patchBlur({ vLo: Math.max(0, v) })} />
                  <DragNumberField label="blur full c/s" value={blur.vHi} step={0.5} min={0}
                    onChange={(v) => patchBlur({ vHi: Math.max(0, v) })} />
                </>
              )}
            </div>
          )}

          {/* ── Step 4: Review ───────────────────────────────────── */}
          {step === 'review' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">Initial Board</div>
              {validSymbols.length >= 2 ? (
                <>
                  <BoardGridEditor config={previewConfig} board={initialBoard} onChange={setInitialBoard} />
                  <div className="scene-spinner-meta">Shown before the first startSpin clip.</div>
                </>
              ) : (
                <div className="scene-spinner-meta" style={{ color: 'var(--err, #f88)' }}>
                  Go back to Symbols — need at least 2.
                </div>
              )}
              {embedded && (
                <>
                  <div className="scene-field-group-head" style={{ marginTop: 12 }}>
                    Test spin
                    <span className="scene-pill">plays in the scene view ↑</span>
                  </div>
                  <div className="spinner-wizard-auto-row">
                    <button
                      type="button"
                      className="scene-btn scene-btn--primary"
                      onClick={runTestSpin}
                      disabled={validSymbols.length < 2}
                      title={`startSpin → spin (${(timing.minSpinTime ?? 1)}s) → stopSpin, using the current timing`}
                    >
                      🎰 test spin ({(timing.minSpinTime ?? 1)}s)
                    </button>
                    <button type="button" className="scene-btn scene-btn--ghost" onClick={resetPreview} disabled={!testRun}>
                      ↺ reset
                    </button>
                  </div>
                </>
              )}

              <div className="scene-field-group-head" style={{ marginTop: 12 }}>Summary</div>
              <div className="scene-spinner-meta">
                <strong>{name || 'Spinner'}</strong> · {reels}×{rows} · {validSymbols.length} symbols
                · speed {timing.spinSpeed} c/s · spin {timing.minSpinTime ?? 1}s
                {blur.enabled ? ` · blur ${blur.vLo}–${blur.vHi} c/s` : ' · blur off'}
                {generatedAssets.length > 0 ? ` · ${generatedAssets.length} blur(s) generated` : ''}
              </div>
            </div>
          )}

        </div>{/* /body */}

        <div className="spinner-wizard-foot">
          {stepIdx > 0 && (
            <button type="button" className="scene-btn scene-btn--ghost"
              onClick={() => goToStep(STEPS[stepIdx - 1])}>← back</button>
          )}
          <div style={{ flex: 1 }} />
          {step !== 'review' ? (
            <button type="button" className="scene-btn scene-btn--primary"
              disabled={!canNext}
              onClick={() => goToStep(STEPS[stepIdx + 1])}>
              next →
            </button>
          ) : (
            <button type="button" className="scene-btn scene-btn--primary"
              disabled={validSymbols.length < 2}
              onClick={handleCreate}>
              {isEdit ? '✓ rebuild spinner' : '＋ create spinner'}
            </button>
          )}
        </div>

      </div>
    </Shell>
  );
}

/** Modal overlay wrapper (standalone use). */
function SpinnerOverlayShell({ children }) {
  return <div className="scene-confirm-overlay" style={{ zIndex: 1100 }}>{children}</div>;
}

/** Docked panel wrapper (embedded in the bottom slot). */
function SpinnerEmbeddedShell({ children }) {
  return <>{children}</>;
}
