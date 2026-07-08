// components/SpinnerWizard.jsx
// Spinner setup wizard — 3 steps: Symbols → Grid → Preview.
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
  generateWinningBoard,
  generateOutcomeBoard,
  generateStrip,
  mulberry32,
  hash32,
  buildSpinnerTestClips,
  classifySymbols,
  SPINNER_DEFAULT_STRIP_LEN,
  defaultSpinnerTiming,
  defaultSpinnerBounce,
  defaultSpinnerBlur,
  defaultSpinnerEvents,
  pickPoseAnimConf,
  resolveIdlePose,
} from '../engine/spinner/spinnerModel.js';

// T12: same threshold set as the director node / timeline clip inspectors —
// kept as a small local duplicate rather than a cross-component import.
const SPIN_OUTCOME_LABELS = [
  { value: 'default', label: 'default (seeded win)' },
  { value: 'noWin', label: 'no win' },
  { value: 'smallWin', label: 'small win' },
  { value: 'bigWin', label: 'big win' },
  { value: 'wildWin', label: 'wild win' }
];

/** Build the synthetic spinner preview scene shown in the viewport while the
 * wizard is open: the referenced symbol assets + a centered spinner layer,
 * optionally with a one-shot test-spin track. */
function buildSpinnerPreviewScene(spinnerConfig, refAssets, testTrack, projectRoot = null) {
  if (!spinnerConfig) return null;
  const base = createEmptyScene('Spinner preview');
  base.projectRoot = projectRoot;
  // Flag read by buildSpinnerObject to DEFER the heavy land/win overlay-pool
  // build to the background — the at-rest wizard preview only needs idle
  // textures, so the machine appears immediately instead of blocking on
  // hundreds of Spine instantiations. Overlays populate before the Spin! step.
  base.__previewSpinner = true;
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
  base.flow.runtime = {
    ...(base.flow.runtime || {}),
    spinnerCellGizmoLayerId: 'sprev_layer'
  };
  base.timelines = [{ ...base.timelines[0], tracks }];
  if (testTrack) {
    const end = Math.max(1, ...testTrack.clips.map((c) => c.start + c.duration));
    base.stage = { ...base.stage, duration: Math.max(base.stage.duration, end) };
  }
  return base;
}
import { makeBlurredSymbol } from '../engine/spinner/spinnerBlur.js';
import {
  spineMatchScore, pickAnimName,
  assetBaseName, assetPathSegments, symbolScore, isConfidentSymbolMatch,
} from '../engine/spinner/symbolMatch.js';
import { BoardGridEditor } from './SpinnerInspectorSections.jsx';

const STEPS = ['symbols', 'grid', 'preview'];
const STEP_LABELS = { symbols: '1. Symbols', grid: '2. Grid', preview: '3. Spin!' };

function uid(prefix = 's') {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

function defaultSymbol(n) {
  // idlePose left null so resolveIdlePose applies availability-aware defaults
  // (land→last frame, win→first frame) until the artist explicitly picks one.
  return { id: uid('sym'), name: `sym${n + 1}`, assetId: null, blurAssetId: null, landAnim: null, winAnim: null, skin: null, idlePose: null };
}

function preferredDefaultSkin(skins) {
  if (!Array.isArray(skins) || skins.length === 0) return null;
  const byLower = new Map(skins.map((s) => [String(s).toLowerCase(), s]));
  return byLower.get('base') || byLower.get('default') || null;
}

// assetBaseName / assetPathSegments / symbolScore / isConfidentSymbolMatch
// now live in engine/spinner/symbolMatch.js (T7) — moved so the candidate-
// discovery heuristic is unit tested outside this component.

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

/**
 * T7: fallback gate for symbol auto-detection when there is NO recognizable
 * Symbols folder structure. Without this the wizard scored every Spine rig in
 * the whole project and turned any rig with a "win"/"land"-ish animation into a
 * symbol — dragging in win_sequence, win_counter_multiplier and other non-symbol
 * rigs as false positives. So the unstructured fallback only considers rigs
 * whose file name (or a path segment) literally says "symbol". Manual land/win
 * dropdowns still expose every Spine asset — this only bounds AUTO-detection.
 */
function looksLikeSymbolSpine(asset) {
  if (/symbol/i.test(assetBaseName(asset))) return true;
  return assetPathSegments(asset).some((s) => /symbol/i.test(s));
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
  // Group assets by their *Symbols root (path up to and incl. the Symbols
  // segment). PNGs classify into statics/blurred/loose; Spine rigs collect
  // under `spines` so an animation-ONLY Symbols folder (no static PNGs at all)
  // is still detected — the common animations-first convention.
  const groups = new Map(); // rootKey → { rootLabel, statics, blurred, loose, spines }
  const ensureGroup = (segs, i) => {
    const rootKey = segs.slice(0, i + 1).join('/').toLowerCase();
    if (!groups.has(rootKey))
      groups.set(rootKey, {
        rootKey,
        rootLabel: segs[i],                       // just the Symbols segment
        rootPath: segs.slice(0, i + 1).join('/'), // full path up to & incl. it (original case)
        statics: [], blurred: [], loose: [], spines: [],
      });
    return groups.get(rootKey);
  };
  for (const a of pngPool) {
    const segs = assetPathSegments(a);
    const i = segs.findIndex(isSymbolsSegment);
    if (i < 0) continue;
    const g = ensureGroup(segs, i);
    const sub = segs[i + 1]; // subfolder name, or the filename if PNG sits in root
    const isFile = i + 1 === segs.length - 1;
    if (!isFile && isStaticSegment(sub)) g.statics.push(a);
    else if (!isFile && isBlurSegment(sub)) g.blurred.push(a);
    else if (isFile) g.loose.push(a);
    // PNGs in Animations/ are Spine atlas pages — ignore.
  }
  for (const a of spinePool) {
    const segs = assetPathSegments(a);
    const i = segs.findIndex(isSymbolsSegment);
    if (i < 0) continue;
    ensureGroup(segs, i).spines.push(a);
  }
  if (!groups.size) return null;

  // Pick the root with the most statics (tie-break: most assets overall,
  // spines included — so a spine-only folder with 0 statics is still chosen).
  const total = (g) => g.statics.length + g.blurred.length + g.loose.length + g.spines.length;
  let best = null;
  for (const g of groups.values()) {
    const score = [g.statics.length, total(g)];
    const bestScore = best ? [best.statics.length, total(best)] : [-1, -1];
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) best = g;
  }
  if (!best) return null;

  // No StaticArt subfolder → PNGs sitting directly in the Symbols folder are
  // the statics (minus obvious blur variants). May be empty for an
  // animation-only folder — that's fine, the Spine anims define the set.
  const statics = best.statics.length
    ? best.statics
    : best.loose.filter((a) => !isBlurVariant(a));

  // Spine assets under this root (prefer an Animations/ subfolder; fall back
  // to anything under the root if there is none).
  const spineUnderRoot = best.spines;
  const spineInAnimFolder = spineUnderRoot.filter((a) => {
    const segs = assetPathSegments(a);
    const i = segs.findIndex(isSymbolsSegment);
    return segs.slice(i + 1, -1).some(isAnimSegment);
  });
  const anims = spineInAnimFolder.length ? spineInAnimFolder : spineUnderRoot;

  // Need SOMETHING to define the symbol set: static PNGs or Spine anims.
  if (!statics.length && !anims.length) return null;

  return {
    rootLabel: best.rootLabel,
    rootPath: best.rootPath,
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
  // T7: require a CONFIDENT score, not merely positive — score 0 (neutral
  // asset, no recognizable signals) was already excluded, but a weak
  // positive (e.g. +4 from sitting in a Blurred folder with no other
  // signal) isn't strong enough evidence to bulk-create a symbol from
  // unattended either. See weakSymbolCandidates() below for what this excludes.
  const nonBlur = pool.filter((a) => !isBlurVariant(a));
  const scored  = nonBlur.filter((a) => isConfidentSymbolMatch(symbolScore(a)));
  return scored; // may be empty — caller shows a hint
}

/**
 * T7: assets that scored positively but BELOW the confidence threshold — real
 * signal, not enough of it to auto-create a symbol without a human look.
 * Surfaced as a warning next to the "fill from assets" button instead of
 * being silently included in (or silently dropped from) the bulk fill.
 * Same scope as buildCandidates' no-filter branch: only meaningful when
 * there's no manual filter text and no detected Symbols folder structure.
 */
function weakSymbolCandidates(pool) {
  const nonBlur = pool.filter((a) => !isBlurVariant(a));
  return nonBlur.filter((a) => {
    const s = symbolScore(a);
    return s > 0 && !isConfidentSymbolMatch(s);
  });
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

function SpinnerPreviewTimeline({ run, time, onScrub }) {
  const total = Math.max(0.001, run?.total || 0.001);
  const clips = run?.clips || [];
  const playPct = Math.max(0, Math.min(100, (time / total) * 100));
  const activeClip = clips.find((c) => time >= c.start && time < c.start + c.duration) || null;
  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    onScrub?.(p * total);
  };
  const onMove = (e) => {
    if (!(e.buttons & 1)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    onScrub?.(p * total);
  };
  const onUp = (e) => e.currentTarget.releasePointerCapture?.(e.pointerId);
  return (
    <div className="spinner-preview-timeline">
      <div className="spinner-preview-timeline-bar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {clips.map((c) => (
            <div
              key={c.id}
              className={'spinner-preview-seg spinner-preview-seg--' + c.action + (activeClip?.id === c.id ? ' active' : '')}
              style={{ width: `${(c.duration / total) * 100}%` }}
              title={`${c.action} · ${c.duration.toFixed(2)}s`}
            >
            <span>{c.action}</span>
          </div>
        ))}
        <div className="spinner-preview-playhead" style={{ left: `${playPct}%` }} />
      </div>
      <div className="spinner-preview-now">▶ <strong>{activeClip?.action || 'idle'}</strong></div>
    </div>
  );
}

/** Land/win cell: renders the ACTUAL Spine pose through the live viewport
 * (land = first frame, win = mid-clip frame) instead of just the animation
 * name. Falls back to the resolved name / '?' / '✕' glyph while the pose bakes
 * or when there's no renderer (overlay mode) / nothing to pose. */
function AnimPoseThumb({ label, kind, anim, spinePool, skin, onRenderSpinePose, refreshNonce }) {
  const spineA = anim?.assetId ? spinePool.find((a) => a.id === anim.assetId) : null;
  const animName = anim?.anim || '';
  const state = spineA && animName ? 'ok' : spineA ? 'warn' : 'missing';
  const [url, setUrl] = useState(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let alive = true;
    let created = null;
    let timer = null;
    let tries = 0;
    setUrl(null);
    setRendering(false);
    if (state !== 'ok' || !onRenderSpinePose) return undefined;
    // land → first frame; win → mid-clip, to catch a more expressive pose.
    const frac = kind === 'win' ? 0.5 : 0;
    setRendering(true);
    const attempt = async () => {
      if (!alive) return;
      try {
        const blob = await onRenderSpinePose(spineA, animName, anim.loop !== false, skin || null, frac);
        if (!alive) return;
        if (blob) {
          created = URL.createObjectURL(blob);
          setUrl(created);
          setRendering(false);
          return;
        }
      } catch { /* fall through to retry / name fallback */ }
      if (!alive) return;
      // The preview scene may not have loaded this rig yet on the first tick —
      // retry a few times before giving up and showing the name.
      if (++tries < 6) timer = setTimeout(attempt, 450);
      else setRendering(false);
    };
    attempt();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
      if (timer) clearTimeout(timer);
    };
  }, [state, anim?.assetId, animName, anim?.loop, skin, kind, onRenderSpinePose, refreshNonce]);

  const title =
    state === 'ok' ? `${label}: ${assetBaseName(spineA)} → ${animName}`
    : state === 'warn' ? `${label}: ${assetBaseName(spineA)} — animation name not resolved`
    : `${label}: no spine assigned`;
  return (
    <div className={'spinner-thumb spinner-thumb--anim spinner-thumb--' + state} title={title}>
      <span className="spinner-thumb-box">
        {url ? <img src={url} alt="" />
          : state === 'ok' ? (rendering ? '…' : <small>{animName}</small>)
          : state === 'warn' ? '?' : '✕'}
      </span>
      <em>{label}</em>
    </div>
  );
}

/** Animation-clip picker for a symbol's land/win slot: a dropdown of the
 * assigned rig's real animation names (parsed from its .json) so the artist
 * picks the right clip instead of guessing the spelling. Falls back to a
 * free-text field when the rig's animation list isn't known (unreadable json).
 * Disabled until a Spine file is assigned in the sibling picker. */
function AnimNamePicker({ symName, kind, conf, animOptions, onChange }) {
  const assetId = conf?.assetId || null;
  const value = conf?.anim || '';
  if (assetId && animOptions.length) {
    return (
      <select
        className="spinner-sym-asset spinner-sym-anim-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Animation clip in the selected Spine skeleton"
      >
        <option value="">— {kind} anim —</option>
        {animOptions.map((nm) => (
          <option key={nm} value={nm}>{nm}</option>
        ))}
        {/* A value that isn't in the rig's list (renamed/edited clip) stays
            visible + selected instead of silently blanking. */}
        {value && !animOptions.includes(value) && <option value={value}>{value} (?)</option>}
      </select>
    );
  }
  return (
    <input
      className="spinner-sym-anim-name"
      type="text"
      placeholder={`${symName}_${kind}`}
      value={value}
      disabled={!assetId}
      onChange={(e) => { if (assetId) onChange(e.target.value); }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function SpinnerWizard({
  scene, assetItems, rootHandle, onClose, onCreate,
  existingConfig = null, existingName = null,
  embedded = false, onPreviewScene, onPreviewTime, onBakeSpinePose, onRenderSpinePose, previewControlsRef = null, refreshNonce = 0,
}) {
  const isEdit = !!existingConfig;
  const [step, setStep] = useState('symbols');

  // Step 1 — grid
  const [name, setName] = useState(existingName || 'Spinner');
  const [reels, setReels] = useState(existingConfig?.grid?.reels ?? 5);
  const [rows, setRows] = useState(existingConfig?.grid?.rows ?? 5);
  const [cellW, setCellW] = useState(existingConfig?.grid?.cellW ?? 200);
  const [cellH, setCellH] = useState(existingConfig?.grid?.cellH ?? 200);
  const [spacingX, setSpacingX] = useState(existingConfig?.grid?.spacingX ?? 0);
  const [spacingY, setSpacingY] = useState(existingConfig?.grid?.spacingY ?? 0);
  const [symbolScale, setSymbolScale] = useState(existingConfig?.grid?.symbolScale ?? 1);

  // Step 2 — symbols
  const [symbols, setSymbols] = useState(() =>
    existingConfig?.symbols?.length
      ? existingConfig.symbols.map((s) => ({ ...s }))
      : Array.from({ length: 6 }, (_, i) => defaultSymbol(i))
  );
  const [assetFilter, setAssetFilter] = useState('');
  const [blurGenerating, setBlurGenerating] = useState(false);
  // True across a "render blurs and continue" batch — spans both the static
  // and anim-only generation passes (which each toggle blurGenerating), so the
  // final "create spinner" button stays disabled for the whole span, not just
  // one pass. Cleared when the batch settles (success or partial failure).
  const [finalizingBlurs, setFinalizingBlurs] = useState(false);
  // { done, total, name } while generateBlurs runs, else null — drives the
  // progress bar so a batch of slow WASM calls doesn't look like a freeze.
  const [blurProgress, setBlurProgress] = useState(null);
  const [generatedAssets, setGeneratedAssets] = useState([]);

  // Step 3 — preview (timing + blur + board + transport)
  const [timing, setTiming] = useState(() => ({ ...defaultSpinnerTiming(), ...(existingConfig?.timing || {}) }));
  const [blur, setBlur] = useState(() => ({ ...defaultSpinnerBlur(), ...(existingConfig?.blur || {}) }));

  // Step 3 — initial board
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

  // Blur search order: detected Blurred folder first, then the whole pool.
  const blurSearchPool = structure ? [...structure.blurred, ...allPngAssets] : allPngAssets;
  // Anim search order: Spine assets from the symbols root's Animations folder
  // first; otherwise fall back to only rigs that LOOK like symbols (name/path
  // contains "symbol") — never the whole project pool, which used to admit
  // win_sequence / win_counter_multiplier etc. as false-positive symbols.
  // A detected NN_Symbols/Animations/ folder IS the authoritative marker: take
  // EVERY Spine rig inside it as a symbol, no filename check — the folder
  // placement is trusted. Only the UNSTRUCTURED fallback (no Symbols folder in
  // the project at all) still requires "symbol" in the filename, to avoid
  // dragging in win_sequence / fire_effect / etc. that merely happen to have a
  // win/land animation.
  const animSearchPool = structure?.anims?.length
    ? structure.anims
    : allSpineAssets.filter(looksLikeSymbolSpine);

  // Candidates for the "fill from assets" button:
  //   manual filter text → filtered pool (user override)
  //   detected structure → statics folder ONLY
  //   neither            → legacy name-score heuristic
  const candidates =
    assetFilter.trim() ? buildCandidates(allPngAssets, assetFilter)
    : structure        ? structure.statics
    : buildCandidates(allPngAssets, '');
  // True when no filter text AND nothing was detected: no Symbols folder
  // (structure null — covers animation-only folders now too), no static
  // candidates, and no symbol Spine rigs to fill from either.
  const noAutoDetect  = !assetFilter.trim() && !structure && candidates.length === 0
    && animSearchPool.length === 0 && allPngAssets.length > 0;
  // T7: weak (positive but sub-threshold) matches, only meaningful in the
  // legacy no-structure/no-filter heuristic path — a detected Symbols folder
  // or an explicit manual filter are already confident/user-directed.
  const weakCandidates = (!assetFilter.trim() && !structure) ? weakSymbolCandidates(allPngAssets) : [];

  // ── Spine metadata (animations + skins) from the actual .json files ──────
  // assetId → { animations: string[]|null, skins: string[] }.
  const spineMetaCacheRef = useRef(new Map());
  const [spineSkinsById, setSpineSkinsById] = useState({});
  // assetId → string[] of animation names, so the land/win pickers can offer a
  // dropdown of the rig's real animations instead of a free-text field.
  const [spineAnimsById, setSpineAnimsById] = useState({});
  // "Refresh assets" re-reads files from disk — drop cached anim-name lists so
  // edited spine .json files re-parse.
  useEffect(() => {
    spineMetaCacheRef.current.clear();
    setSpineSkinsById({});
    setSpineAnimsById({});
  }, [refreshNonce]);

  const parseSpineSkins = (doc) => {
    const skins = doc?.skins;
    if (Array.isArray(skins)) {
      return skins
        .map((s) => (typeof s === 'string' ? s : s?.name))
        .filter((s) => typeof s === 'string' && s);
    }
    if (skins && typeof skins === 'object') return Object.keys(skins).filter(Boolean);
    return [];
  };

  const loadSpineMeta = useCallback(async (spineAsset) => {
    if (!spineAsset) return null;
    const cache = spineMetaCacheRef.current;
    if (cache.has(spineAsset.id)) return cache.get(spineAsset.id);
    let meta = { animations: null, skins: [] };
    try {
      const src = String(spineAsset.src || '');
      let text = null;
      if (isDirectUrl(src)) text = await (await fetch(src)).text();
      else if (rootHandle) {
        const file = await resolveAssetFile(src, rootHandle);
        if (file) text = await file.text();
      }
      if (text) {
        const doc = JSON.parse(text);
        meta = {
          animations: Object.keys(doc.animations || {}),
          skins: parseSpineSkins(doc),
        };
      }
    } catch { /* unreadable → keep null, callers fall back to name guess */ }
    cache.set(spineAsset.id, meta);
    if (meta.skins.length) {
      setSpineSkinsById((prev) => {
        const prevVal = prev[spineAsset.id] || [];
        if (prevVal.length === meta.skins.length && prevVal.every((v, i) => v === meta.skins[i])) return prev;
        return { ...prev, [spineAsset.id]: meta.skins };
      });
    }
    if (Array.isArray(meta.animations) && meta.animations.length) {
      setSpineAnimsById((prev) => {
        const prevVal = prev[spineAsset.id] || [];
        if (prevVal.length === meta.animations.length && prevVal.every((v, i) => v === meta.animations[i])) return prev;
        return { ...prev, [spineAsset.id]: meta.animations };
      });
    }
    return meta;
  }, [rootHandle]);

  useEffect(() => {
    if (!allSpineAssets.length) return;
    Promise.all(allSpineAssets.map((a) => loadSpineMeta(a)));
  }, [allSpineAssets, loadSpineMeta]);

  /** land/win entries for a symbol: real anim names when readable, guess otherwise. */
  const resolveAnimsFor = useCallback(async (symName, spineA) => {
    if (!spineA) return { landAnim: null, winAnim: null };
    const meta = await loadSpineMeta(spineA);
    const names = meta?.animations ?? null;
    const skin = preferredDefaultSkin(meta?.skins);
    const entry = (kind) => {
      const picked = names ? pickAnimName(names, kind, symName) : null;
      // File unreadable → legacy guess; readable but no match → leave empty
      // so the UI flags it instead of inventing a wrong key.
      const anim = picked ?? (names ? '' : `${symName}_${kind}`);
      return { kind: 'spine', assetId: spineA.id, anim };
    };
    return { landAnim: entry('land'), winAnim: entry('win'), skin };
  }, [loadSpineMeta]);

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
          skin: anims.skin || null,
          ...anims,
        };
      })
    );
    setSymbols(built);
  };

  // T7: animations-only pipeline, the DEFAULT/primary auto-fill — one symbol
  // per Spine rig (the common "one file per symbol, land+win anims inside it"
  // convention). Statics are NEVER auto-attached here: the resting/idle texture
  // is baked at build time from the land (or win) animation's first frame (see
  // spinnerRuntime.bakeSpinePoseTexture) and post-win the symbol holds its last
  // computed pose. Auto-attaching a name-matched PNG from the whole project pool
  // used to fuzzy-match backgrounds/UI/false positives — some symbols ended up
  // with a static (4-icon panel), some without (3-icon), inconsistently. The
  // artist can still add a static by hand via the per-symbol dropdown.
  const autoFillFromAnimations = async () => {
    if (!animSearchPool.length) return;
    const built = await Promise.all(
      animSearchPool.map(async (spineA) => {
        const symName = assetBaseName(spineA);
        const anims = await resolveAnimsFor(symName, spineA);
        if (!anims.landAnim?.anim && !anims.winAnim?.anim) return null; // this rig has neither — not a symbol
        return {
          id: uid('sym'),
          name: symName,
          assetId: null,       // animations-first → no static art, idle pose baked from anim
          blurAssetId: null,   // blur is generated from the baked pose, not a static PNG
          skin: anims.skin || null,
          animOnly: true,
          ...anims,
        };
      })
    );
    const filled = built.filter(Boolean);
    if (filled.length) setSymbols(filled);
  };

  // T7: auto-run the animations-first fill on a FRESH wizard, once, the
  // moment Spine assets are available — same "auto-suggest, let the artist
  // override" pattern as WinSequenceWizard's font auto-pick. Never touches
  // an edit-mode wizard (existing symbols) or one the artist has already
  // populated (manually or via a previous auto-fill).
  const symbolsAutoFilledRef = useRef(false);
  useEffect(() => {
    if (isEdit || symbolsAutoFilledRef.current) return;
    const untouched = symbols.every((s) => !s.assetId && !s.landAnim?.anim && !s.winAnim?.anim);
    if (!untouched || !animSearchPool.length) return;
    symbolsAutoFilledRef.current = true;
    autoFillFromAnimations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animSearchPool.length, isEdit]);

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

  // Single spine skeleton per symbol: both land + win clips MUST come from the
  // same skeleton .json. Picking a skeleton points both landAnim and winAnim at
  // it (preserving each side's loop/offset), then async-resolves the real clip
  // names + default skin from that one skeleton. Clearing it drops both anims.
  const symbolSkeletonId = (sym) => sym.landAnim?.assetId || sym.winAnim?.assetId || '';
  const assignSymbolSkeleton = (symId, assetId) => {
    setSymbols((prev) =>
      prev.map((s) => {
        if (s.id !== symId) return s;
        if (!assetId) return { ...s, landAnim: null, winAnim: null };
        const mk = (cur, isWin) => ({
          kind: 'spine', assetId, anim: '',
          loop: cur?.loop ?? !isWin, // win holds its final pose; land loops by default
          offset: cur?.offset || 0,
        });
        return { ...s, landAnim: mk(s.landAnim, false), winAnim: mk(s.winAnim, true) };
      })
    );
    if (!assetId) return;
    const spineA = allSpineAssets.find((a) => a.id === assetId);
    const symName = symbols.find((s) => s.id === symId)?.name || '';
    loadSpineMeta(spineA).then((meta) => {
      const names = meta?.animations ?? null;
      const resolve = (kind) => {
        const picked = names ? pickAnimName(names, kind, symName) : null;
        return picked ?? (names ? '' : `${symName}_${kind}`);
      };
      const landName = resolve('land');
      const winName = resolve('win');
      const skin = preferredDefaultSkin(meta?.skins);
      setSymbols((prev) =>
        prev.map((s) => {
          if (s.id !== symId) return s;
          const next = { ...s };
          // Only fill clip names we still own + haven't been hand-edited since.
          if (next.landAnim?.assetId === assetId && !next.landAnim.anim)
            next.landAnim = { ...next.landAnim, anim: landName };
          if (next.winAnim?.assetId === assetId && !next.winAnim.anim)
            next.winAnim = { ...next.winAnim, anim: winName };
          if (!next.skin && skin) next.skin = skin;
          return next;
        })
      );
    });
  };

  // ── Generate blur variants ────────────────────────────────────────────────
  // Runs strictly on explicit user click (the two buttons below) — never
  // automatically from auto-detect/matching. Each WASM motion-blur call can
  // take a noticeable moment; the loop below yields a frame before each one
  // and updates state incrementally (by symbol id, not a stale end-of-batch
  // snapshot) so the progress bar is accurate and the live preview keeps
  // rendering symbols as they finish instead of appearing to freeze until
  // the whole batch completes. True background execution (a Web Worker)
  // isn't used: the shared `window._Magick` WASM chain writes to FIXED
  // temp filenames (input.png, blurred.png, …) also used by every other
  // ImageMagick call in the app, so concurrent calls would race — this has
  // to stay sequential regardless of where it runs.
  const generateBlurs = async (onlyMissing = true) => {
    const targets = symbols.filter((s) => s.assetId && (!onlyMissing || !s.blurAssetId));
    if (!targets.length) return;
    setBlurGenerating(true);
    for (let i = 0; i < targets.length; i++) {
      const sym = targets[i];
      setBlurProgress({ done: i, total: targets.length, name: sym.name || `symbol ${i + 1}` });
      await new Promise(requestAnimationFrame); // let the progress update (and Pixi) paint first
      const asset = allPngAssets.find((a) => a.id === sym.assetId);
      if (!asset?.src) continue;
      try {
        // Project-folder-scanned assets (`_fromBrowser`) carry a raw relative
        // path as `src`, not a loadable URL — same resolution SymbolThumb
        // already does for previews. Assigning that path straight to <img
        // src> (as this used to) silently fails to load, so the blur step
        // below ran on nothing and the batch "succeeded" with no output.
        const direct = isDirectUrl(asset.src);
        const imgSrc = direct
          ? asset.src
          : await (async () => {
              const file = rootHandle ? await resolveAssetFile(asset.src, rootHandle) : null;
              return file ? URL.createObjectURL(file) : null;
            })();
        if (!imgSrc) throw new Error(`could not resolve source image for ${assetBaseName(asset)}`);
        const img = await new Promise((resolve, reject) => {
          const el  = new Image();
          el.crossOrigin = 'anonymous';
          el.onload  = () => resolve(el);
          el.onerror = reject;
          el.src     = imgSrc;
        });
        if (!direct) URL.revokeObjectURL(imgSrc); // decoded into `img` already; drop our temp blob URL
        const blob   = await makeBlurredSymbol(img, cellW, cellH, 1.0, blur.sigma, blur.feather);
        const blobUrl = URL.createObjectURL(blob);
        const blurId  = uid('gen');
        setGeneratedAssets((prev) => [...prev, {
          id: blurId,
          type: 'png',
          src: blobUrl,
          meta: { originalName: assetBaseName(asset) + '_blur.png', generated: true },
        }]);
        setSymbols((prev) => prev.map((s) => (s.id === sym.id ? { ...s, blurAssetId: blurId } : s)));
      } catch (e) {
        console.warn('[SpinnerWizard] blur gen failed for', sym.name, e);
      }
    }
    setBlurProgress(null);
    setBlurGenerating(false);
  };

  // Symbols with no static PNG but a usable land/win Spine anim to pose from
  // — the same condition + land-before-win-first-frame preference the runtime's
  // idle-pose bake uses (shared pickPoseAnimConf), keyed on `!assetId` not the
  // `animOnly` flag (which auto-detect sets but a manually-added symbol never
  // gets). Land is the idle source only when it has a resolved clip name; a
  // symbol with only a win anim still bakes from the win clip's first frame.
  const poseAnimConfFor = (sym) => pickPoseAnimConf(sym);

  // ── Generate blur variants for animation-only symbols ───────────────────────
  // Mirrors generateBlurs above, but the source isn't a static PNG — there
  // isn't one. It's a Spine idle/landing pose rendered live through the
  // wizard's own preview viewport (onBakeSpinePose → PixiViewport's live
  // renderer), then run through the SAME downsample-then-blur pipeline
  // (spinnerBlur.js#blurRenderedCanvas) as static art. Persists a real
  // generated blur PNG asset + blurAssetId exactly like the static path, so
  // these symbols stop depending solely on the runtime's own automatic
  // (fire-and-forget, per-rebuild) bake-and-blur fallback in
  // spinnerRuntime.js — that fallback now only fires when no persisted
  // blurAssetId exists yet.
  const generateAnimOnlyBlurs = async (onlyMissing = true) => {
    const targets = symbols.filter((s) =>
      !s.assetId && poseAnimConfFor(s) && (!onlyMissing || !s.blurAssetId));
    if (!targets.length || !onBakeSpinePose) return;
    setBlurGenerating(true);
    for (let i = 0; i < targets.length; i++) {
      const sym = targets[i];
      setBlurProgress({ done: i, total: targets.length, name: sym.name || `symbol ${i + 1}` });
      await new Promise(requestAnimationFrame); // let the progress update (and Pixi) paint first
      const animConf = poseAnimConfFor(sym);
      const spineA = allSpineAssets.find((a) => a.id === animConf.assetId) || null;
      try {
        const blob = await onBakeSpinePose(spineA, animConf.anim, animConf.loop !== false, sym.skin || null, blur.sigma, blur.feather, animConf.poseFrac ?? 0);
        if (!blob) throw new Error('idle-pose render returned nothing');
        const blobUrl = URL.createObjectURL(blob);
        const blurId  = uid('gen');
        setGeneratedAssets((prev) => [...prev, {
          id: blurId,
          type: 'png',
          src: blobUrl,
          meta: { originalName: (sym.name || 'symbol') + '_blur.png', generated: true },
        }]);
        setSymbols((prev) => prev.map((s) => (s.id === sym.id ? { ...s, blurAssetId: blurId } : s)));
      } catch (e) {
        console.warn('[SpinnerWizard] animOnly blur gen failed for', sym.name, e);
      }
    }
    setBlurProgress(null);
    setBlurGenerating(false);
  };

  const symbolsNeedingBlur = symbols.filter((s) => s.assetId && !s.blurAssetId).length;
  const symbolsWithStatic = symbols.filter((s) => s.assetId).length;
  const poseBakeSymbols = validSymbols.filter((s) => !s.assetId && poseAnimConfFor(s));
  const poseBlurNeeding = poseBakeSymbols.filter((s) => !s.blurAssetId).length;
  const blursOutstanding = symbolsNeedingBlur > 0 || poseBlurNeeding > 0;

  // Symbols-step primary action: generate the missing blurs (static + anim-only
  // pose) while STAYING on the Symbols page (so the machine preview + progress
  // bar stay put), then advance to Grid once the whole batch settles. Offered
  // only when there's actually work left; once every symbol has a matched blur
  // the plain "next →" takes over. `finalizingBlurs` spans both passes.
  const renderBlursAndContinue = async () => {
    setFinalizingBlurs(true);
    try {
      await generateBlurs(true);
      await generateAnimOnlyBlurs(true);
    } finally {
      setFinalizingBlurs(false);
      goToStep('grid');
    }
  };
  const skinOptionsForSymbol = (sym) => {
    const ids = [sym.landAnim?.assetId, sym.winAnim?.assetId].filter(Boolean);
    if (!ids.length) return [];
    return [...new Set(ids.flatMap((id) => spineSkinsById[id] || []))];
  };

  // Idle-frame options for an animations-only symbol: EVERY animation in the
  // symbol's skeleton (first + last frame of each), so a bespoke idle clip not
  // wired to land/win can be chosen too. The skeleton's clip list comes from
  // spineAnimsById once parsed; the land/win clip names are folded in up front
  // so the picker isn't empty during the brief parse window. Value encoding is
  // `anim\nframe` (newline separator — never appears in an animation name).
  const IDLE_SEP = '\n';
  const idlePoseOptionsFor = (sym) => {
    const skel = symbolSkeletonId(sym);
    if (!skel) return [];
    const names = new Set();
    if (sym.landAnim?.kind === 'spine' && sym.landAnim.anim) names.add(sym.landAnim.anim);
    if (sym.winAnim?.kind === 'spine' && sym.winAnim.anim) names.add(sym.winAnim.anim);
    for (const nm of (spineAnimsById[skel] || [])) names.add(nm);
    const opts = [];
    for (const nm of names) {
      opts.push({ v: `${nm}${IDLE_SEP}first`, l: `${nm} · first frame` });
      opts.push({ v: `${nm}${IDLE_SEP}last`, l: `${nm} · last frame` });
    }
    return opts;
  };

  // Fill default symbol skin when metadata lands later (or after reassignment),
  // but never override an explicit user pick.
  useEffect(() => {
    setSymbols((prev) => {
      let changed = false;
      const next = prev.map((sym) => {
        if (sym.skin) return sym;
        const skin = preferredDefaultSkin(skinOptionsForSymbol(sym));
        if (!skin) return sym;
        changed = true;
        return { ...sym, skin };
      });
      return changed ? next : prev;
    });
  }, [spineSkinsById]);

  // ── BoardGridEditor preview config ────────────────────────────────────────
  const previewConfig = { grid: { reels, rows, cellW, cellH, spacingX, spacingY, symbolScale }, symbols: validSymbols };

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
  // T12: the wizard's own re-roll surface — same seeded-outcome path as the
  // director node and timeline clip inspectors (spinnerModel.buildSpinnerTestClips).
  const [testOutcome, setTestOutcome] = useState('bigWin');
  const [testReroll, setTestReroll] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const testTimeRef = useRef(0);
  const testRafRef = useRef(0);
  const testLastRef = useRef(0);

  // STRUCTURAL preview inputs (reel/row counts + symbol set) are DEBOUNCED: a
  // structural change means a full Pixi rebuild of the preview spinner, and
  // Pixi v8 dislikes rapid rebuilds (SPINNER.md §20.10) — `bakedStruct` only
  // catches up 150ms after edits settle, so drag-scrubbing the reel/row count
  // doesn't thrash the renderer. Everything else (cell size / spacing /
  // timing / blur / board) bypasses the debounce — since the structural-hash
  // refactor those live-patch the built spinner without a rebuild
  // (engine/pixiApp.js applyRuntimeConfigs + relayoutSpinnerGeometry), so
  // slider drags update the preview immediately AND keep the object stable
  // during a test spin (no texture reload → no blank/blur flash).
  const contentHash = useMemo(() => hash32(JSON.stringify({
    s: validSymbols.map((s) => [s.id, s.assetId, s.blurAssetId, s.skin || null, s.landAnim, s.winAnim, s.idlePose || null]),
    g: { reels, rows },
  })) || 1, [symbols, reels, rows]);
  const [bakedStruct, setBakedStruct] = useState(() => ({
    symbols: validSymbols, reels, rows, rev: contentHash,
  }));
  useEffect(() => {
    const id = setTimeout(() => setBakedStruct({
      symbols: validSymbols, reels, rows, rev: contentHash,
    }), 150);
    return () => clearTimeout(id);
  // The closure re-captures the live fields whenever the structural hash moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentHash]);

  const previewSpinnerConfig = useMemo(() => {
    // Topology comes from the DEBOUNCED snapshot (see bakedStruct above) so
    // rapid reel/row/symbol edits coalesce into one rebuild; everything else —
    // including cell size + spacing (live geometry relayout) — is live. A
    // momentary strips/board ↔ grid mismatch inside the debounce window is
    // safe — normalizeSpinnerConfig regenerates invalid strips and the board
    // check below falls back to a generated board.
    const ids = bakedStruct.symbols.map((s) => s.id);
    if (ids.length < 2 || !previewStrips) return null;
    const g = { reels: bakedStruct.reels, rows: bakedStruct.rows, cellW, cellH, spacingX, spacingY, symbolScale };
    const idSet = new Set(ids);
    const boardValid = initialBoard && initialBoard.length === g.reels
      && initialBoard.every((col) => Array.isArray(col) && col.length === g.rows && col.every((c) => idSet.has(c)));
    const board = boardValid ? initialBoard : generateNonWinningBoard(ids, g.reels, g.rows, seed);
    return {
      symbols: bakedStruct.symbols,
      grid: g,
      strips: previewStrips,
      initialBoard: board,
      seed,
      direction: existingConfig?.direction ?? 1,
      timing,
      bounce: existingConfig?.bounce || defaultSpinnerBounce(),
      blur,
      events: existingConfig?.events || defaultSpinnerEvents(),
      perReel: existingConfig?.perReel || [],
      rev: bakedStruct.rev,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakedStruct, cellW, cellH, spacingX, spacingY, symbolScale, timing, blur, initialBoard, seed, previewStrips]);

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

  // Auto-spin the moment the Spin! step is entered (first time AND on every
  // re-entry), so the spinner demonstrates itself and the transport timeline
  // appears without the artist having to click. Previously this required a
  // spin to ALREADY be running (`if (!testRun) return`), so a fresh wizard
  // never span on first entry. `wantAutoSpinRef` defers the spin until the
  // (debounced) previewSpinnerConfig is actually ready.
  const prevStepRef = useRef(step);
  const wantAutoSpinRef = useRef(false);
  useEffect(() => {
    if (step === 'preview' && prevStepRef.current !== 'preview') wantAutoSpinRef.current = true;
    prevStepRef.current = step;
    if (wantAutoSpinRef.current && step === 'preview' && previewSpinnerConfig && validSymbols.length >= 2) {
      wantAutoSpinRef.current = false;
      runTestSpin();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, previewSpinnerConfig, validSymbols.length]);

  // Drive the preview clock; autoplay in the preview step and hold at the end.
  useEffect(() => {
    if (!embedded || !onPreviewTime) return undefined;
    if (!testRun) {
      testTimeRef.current = 0;
      setPreviewTime(0);
      onPreviewTime(0);
      return undefined;
    }
    testLastRef.current = 0;
    const frame = (ts) => {
      const dt = testLastRef.current ? Math.min(0.05, (ts - testLastRef.current) / 1000) : 0;
      testLastRef.current = ts;
      if (previewPlaying) {
        const next = Math.min(testRun.total, testTimeRef.current + dt);
        testTimeRef.current = next;
        if (next >= testRun.total - 1e-4) setPreviewPlaying(false);
      }
      setPreviewTime(testTimeRef.current);
      onPreviewTime(testTimeRef.current);
      testRafRef.current = requestAnimationFrame(frame);
    };
    testRafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(testRafRef.current);
  }, [embedded, onPreviewTime, testRun, previewPlaying]);

  useEffect(() => {
    if (!previewControlsRef) return undefined;
    previewControlsRef.current = {
      togglePlay: () => setPreviewPlaying((p) => !p),
      resetToStart: () => {
        setPreviewPlaying(false);
        testTimeRef.current = 0;
        setPreviewTime(0);
        onPreviewTime?.(0);
      }
    };
    return () => { previewControlsRef.current = null; };
  }, [previewControlsRef, onPreviewTime]);

  // Picking a Result / re-rolling computes a concrete board for that threshold,
  // writes it straight into `initialBoard`, and then AUTO-SPINS onto it: rather
  // than dropping the frozen frame and leaving the timeline empty (which forced
  // a manual "rerun spin"), we request a fresh spin so the transport rebuilds
  // and plays automatically. The spin itself is deferred to the auto-spin effect
  // (via wantAutoSpinRef) so it runs once previewSpinnerConfig has caught up to
  // the new board.
  const applyOutcomeBoard = useCallback((outcome, rerollSeed) => {
    // Uses the same live (non-debounced) grid/symbol values BoardGridEditor
    // itself renders with (previewConfig), not the debounced `bakedStruct`
    // behind previewSpinnerConfig — this runs from a discrete click, not a
    // rapid drag, so there's no reason to risk a transient shape mismatch.
    const ids = validSymbols.map((s) => s.id);
    if (ids.length < 2) return;
    const boardSeed = (seed ^ hash32(`board::${outcome}::${rerollSeed}`)) >>> 0;
    const board = (!outcome || outcome === 'default')
      ? generateWinningBoard(ids, reels, rows, boardSeed)
      : generateOutcomeBoard(previewConfig, outcome, boardSeed);
    if (!board) return;
    setInitialBoard(board);
    wantAutoSpinRef.current = true; // auto-spin onto the new board
  }, [validSymbols, reels, rows, seed, previewConfig]);

  const runTestSpin = () => {
    if (!previewSpinnerConfig) return;
    // Land on the board already shown (initialBoard) — no seed/outcome
    // re-derivation, so the spin can never diverge from the preview.
    testTimeRef.current = 0;
    setPreviewTime(0);
    onPreviewTime?.(0);
    setTestRun(buildSpinnerTestClips(previewSpinnerConfig, null, 0, initialBoard));
    setPreviewPlaying(true);
  };
  const resetPreview = () => {
    setPreviewPlaying(false);
    testTimeRef.current = 0;
    setPreviewTime(0);
    onPreviewTime?.(0);
  };
  const scrubPreview = (t) => {
    if (!testRun) return;
    setPreviewPlaying(false);
    testTimeRef.current = Math.max(0, Math.min(testRun.total, t));
    setPreviewTime(testTimeRef.current);
    onPreviewTime?.(testTimeRef.current);
  };

  const goToStep = (next) => {
    if (next === 'preview') {
      const ids = validSymbols.map((s) => s.id);
      // First time into Spin!: seed the board from the default Result (big win)
      // so the auto-spin lands on a win, not a blank non-winning board. On
      // re-entry (board already set, possibly a hand-picked Result) leave it be.
      if (ids.length >= 2 && !initialBoard) applyOutcomeBoard(testOutcome, 0);
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
      grid: { reels, rows, cellW, cellH, spacingX, spacingY, symbolScale },
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
    validSymbols, reels, rows, cellW, cellH, spacingX, spacingY, symbolScale,
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

          {/* ── Step 2: Grid ─────────────────────────────────────── */}
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
                <DragNumberField label="spacing X" value={spacingX} step={2} min={1 - cellW}
                  onChange={(v) => setSpacingX(Math.max(1 - cellW, Math.round(v)))} />
                <DragNumberField label="spacing Y" value={spacingY} step={2} min={1 - cellH}
                  onChange={(v) => setSpacingY(Math.max(1 - cellH, Math.round(v)))} />
              </div>
              <div className="spinner-wizard-row">
                <DragNumberField label="symbol scale" value={symbolScale} step={0.05} min={0.05} max={10}
                  onChange={(v) => setSymbolScale(Math.max(0.05, Math.min(10, v)))} />
              </div>
              <div className="scene-spinner-meta">
                Grid: {reels * cellW + (reels - 1) * spacingX} × {rows * cellH + (rows - 1) * spacingY} px
              </div>
            </div>
          )}

          {/* ── Step 1: Symbols ──────────────────────────────────── */}
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
                      📁 <strong style={{ wordBreak: 'break-all' }}>{structure.rootPath || structure.rootLabel}</strong> detected —{' '}
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

                  {weakCandidates.length > 0 && (
                    <div className="scene-spinner-meta" style={{ color: 'var(--warn, #e0b34a)', marginBottom: 6 }}>
                      ⚠ {weakCandidates.length} weak match{weakCandidates.length !== 1 ? 'es' : ''} not included
                      (some signal, not enough to auto-fill confidently) — add manually if relevant:{' '}
                      {weakCandidates.slice(0, 6).map((a) => assetBaseName(a)).join(', ')}
                      {weakCandidates.length > 6 ? `, +${weakCandidates.length - 6} more` : ''}
                    </div>
                  )}

                  {/* T7: animations-first is the DEFAULT/primary workflow — one symbol
                      per Spine rig, static art optional. "fill from assets" (statics)
                      is the secondary/legacy path, demoted to a ghost button. */}
                  <div className="spinner-wizard-auto-row">
                    {animSearchPool.length > 0 && (
                      <button
                        type="button"
                        className="scene-btn scene-btn--primary"
                        onClick={autoFillFromAnimations}
                        title={`Create symbol(s) from ${animSearchPool.length} Spine rig(s) — land/win animations only, no static art required. A matching static PNG (if any) is attached automatically.`}
                      >
                        ⬇ fill from animations ({animSearchPool.length})
                      </button>
                    )}
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
                      ⬇ {structure && !assetFilter.trim() ? `fill from ${structure.rootLabel} statics` : 'fill from static assets'} ({candidates.length})
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
                      {/* Single spine skeleton for this symbol — land + win clips
                          both come from it (picked in the anim row below). */}
                      {allSpineAssets.length > 0 && (
                        <select
                          className="spinner-sym-asset"
                          value={symbolSkeletonId(sym)}
                          onChange={(e) => assignSymbolSkeleton(sym.id, e.target.value || null)}
                          title="Spine skeleton (.json) — land and win animations both come from this one skeleton"
                        >
                          <option value="">— spine skeleton —</option>
                          {allSpineAssets.map((a) => (
                            <option key={a.id} value={a.id}>{assetBaseName(a) || a.id}</option>
                          ))}
                        </select>
                      )}
                      {/* Animations-only symbols (from "fill from animations")
                          show the idle-frame picker HERE instead of a static-PNG
                          dropdown — there's no static to pick; the resting texture
                          is baked from the chosen anim frame. Symbols that use a
                          static PNG keep the static dropdown (the PNG IS the idle). */}
                      {(() => {
                        const idleOpts = !sym.assetId ? idlePoseOptionsFor(sym) : [];
                        if (idleOpts.length) {
                          const r = resolveIdlePose(sym);
                          const cur = r ? `${r.anim}${IDLE_SEP}${r.frame}` : idleOpts[0].v;
                          const effective = idleOpts.some((o) => o.v === cur) ? cur : idleOpts[0].v;
                          return (
                            <select
                              className="spinner-sym-asset"
                              value={effective}
                              onChange={(e) => {
                                const sep = e.target.value.lastIndexOf(IDLE_SEP);
                                const anim = e.target.value.slice(0, sep);
                                const frame = e.target.value.slice(sep + IDLE_SEP.length);
                                patchSymbol(i, { idlePose: { anim, frame } });
                              }}
                              title="Idle frame — which skeleton animation + frame is this symbol's resting texture + motion-blur source. Default: last landing frame (or first win frame when there's no landing anim)."
                            >
                              {idleOpts.map((o) => (
                                <option key={o.v} value={o.v}>idle: {o.l}</option>
                              ))}
                            </select>
                          );
                        }
                        return (
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
                        );
                      })()}
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
                      {/* Animations-only symbols have no static art — don't show
                          an empty ✕ box for them; the static thumb appears only
                          once a static PNG is actually assigned (fill from statics
                          or a manual pick). */}
                      {sym.assetId && (
                        <SymbolThumb label="static" asset={allPngAssets.find((a) => a.id === sym.assetId) || null} rootHandle={rootHandle} />
                      )}
                      <SymbolThumb label="blur" asset={allPngAssets.find((a) => a.id === sym.blurAssetId) || null} rootHandle={rootHandle} />
                      <AnimPoseThumb label="land" kind="land" anim={sym.landAnim} spinePool={allSpineAssets}
                        skin={sym.skin} onRenderSpinePose={onRenderSpinePose} refreshNonce={refreshNonce} />
                      <AnimPoseThumb label="win" kind="win" anim={sym.winAnim} spinePool={allSpineAssets}
                        skin={sym.skin} onRenderSpinePose={onRenderSpinePose} refreshNonce={refreshNonce} />
                    </div>

                    {allSpineAssets.length > 0 && (
                      <div className="spinner-sym-anim-row">
                        {(() => {
                          const skinOptions = skinOptionsForSymbol(sym);
                          return (
                            <>
                              <span className="spinner-sym-anim-label">skin</span>
                              <select
                                className="spinner-sym-asset spinner-sym-asset--sm"
                                value={sym.skin || ''}
                                onChange={(e) => patchSymbol(i, { skin: e.target.value || null })}
                                disabled={!skinOptions.length}
                                title="Default Spine skin for this symbol"
                              >
                                <option value="">— default skin —</option>
                                {skinOptions.map((skin) => (
                                  <option key={skin} value={skin}>{skin}</option>
                                ))}
                              </select>
                            </>
                          );
                        })()}
                        <span className="spinner-sym-anim-label">land</span>
                        <AnimNamePicker
                          symName={sym.name}
                          kind="land"
                          conf={sym.landAnim}
                          animOptions={spineAnimsById[symbolSkeletonId(sym)] || []}
                          onChange={(v) => {
                            if (sym.landAnim?.assetId)
                              patchSymbol(i, { landAnim: { ...sym.landAnim, anim: v } });
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
                        <AnimNamePicker
                          symName={sym.name}
                          kind="win"
                          conf={sym.winAnim}
                          animOptions={spineAnimsById[symbolSkeletonId(sym)] || []}
                          onChange={(v) => {
                            if (sym.winAnim?.assetId)
                              patchSymbol(i, { winAnim: { ...sym.winAnim, anim: v } });
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

              {/* Blur look — sigma/feather are always visible whenever there's
                  any symbol at all (only runs on an explicit click below,
                  never automatically). Both generation buttons below —
                  static-art and animations-only — share these same settings
                  and the same downsample-then-blur pipeline
                  (spinnerBlur.js#blurRenderedCanvas), so the two symbol kinds
                  can never look different. The animations-only path renders
                  each symbol's landing/idle Spine pose live (no static PNG
                  involved) and blurs THAT render. */}
              {validSymbols.length > 0 && (
                <div className="spinner-blur-gen">
                  <div className="scene-field-group-sub">
                    {symbolsNeedingBlur > 0 || poseBlurNeeding > 0
                      ? [
                          symbolsNeedingBlur > 0 ? `${symbolsNeedingBlur} static symbol${symbolsNeedingBlur !== 1 ? 's' : ''} without a blur PNG` : null,
                          poseBlurNeeding > 0 ? `${poseBlurNeeding} animation-only symbol${poseBlurNeeding !== 1 ? 's' : ''} without a rendered blur` : null,
                        ].filter(Boolean).join(' · ')
                      : 'All symbols have a blur PNG — adjust sigma/feather and regenerate if you want a different look'}
                  </div>
                  <div className="spinner-wizard-row">
                    <DragNumberField label="sigma px" value={blur.sigma} step={1} min={1} max={64}
                      onChange={(v) => patchBlur({ sigma: Math.max(1, Math.round(v)) })} />
                    <DragNumberField label="feather px" value={blur.feather} step={1} min={0} max={32}
                      onChange={(v) => patchBlur({ feather: Math.max(0, Math.round(v)) })} />
                  </div>
                  {symbolsWithStatic > 0 && (
                    <div className="spinner-wizard-auto-row" style={{ marginBottom: 0 }}>
                      <button
                        type="button"
                        className="scene-btn scene-btn--ghost"
                        onClick={() => generateBlurs(true)}
                        disabled={blurGenerating || symbolsNeedingBlur === 0}
                      >
                        ⚡ fill missing blurs ({symbolsNeedingBlur})
                      </button>
                      <button
                        type="button"
                        className="scene-btn scene-btn--ghost"
                        onClick={() => generateBlurs(false)}
                        disabled={blurGenerating}
                        title="Re-runs the blur on EVERY symbol with a static PNG using the current sigma/feather, overwriting existing blur PNGs"
                      >
                        ↻ regenerate all ({symbolsWithStatic})
                      </button>
                    </div>
                  )}
                  {poseBakeSymbols.length > 0 && (
                    <div className="spinner-wizard-auto-row" style={{ marginBottom: 0, marginTop: symbolsWithStatic > 0 ? 6 : 0 }}>
                      <button
                        type="button"
                        className="scene-btn scene-btn--ghost"
                        onClick={() => generateAnimOnlyBlurs(true)}
                        disabled={blurGenerating || poseBlurNeeding === 0 || !onBakeSpinePose}
                        title="Renders each animation-only symbol's landing/idle Spine pose live, then runs the SAME downsample blur pipeline as static art — no static PNG is created"
                      >
                        ⚡ render + blur idle pose ({poseBlurNeeding})
                      </button>
                      <button
                        type="button"
                        className="scene-btn scene-btn--ghost"
                        onClick={() => generateAnimOnlyBlurs(false)}
                        disabled={blurGenerating || !onBakeSpinePose}
                        title="Re-renders the idle pose and re-blurs EVERY animation-only symbol using the current sigma/feather, overwriting existing blur PNGs"
                      >
                        ↻ regenerate all ({poseBakeSymbols.length})
                      </button>
                    </div>
                  )}
                  {blurProgress && (
                    <div className="spinner-blur-progress">
                      <div className="spinner-blur-progress-bar">
                        <div
                          className="spinner-blur-progress-fill"
                          style={{ width: `${Math.round((blurProgress.done / blurProgress.total) * 100)}%` }}
                        />
                      </div>
                      <span className="scene-spinner-meta">
                        ⏳ blurring "{blurProgress.name}" — {blurProgress.done + 1}/{blurProgress.total}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {validSymbols.length < 2 && (
                <div className="scene-spinner-meta" style={{ color: 'var(--err, #f88)', marginTop: 6 }}>
                  Need at least 2 symbols with non-empty names.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Preview ──────────────────────────────────── */}
          {step === 'preview' && (
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

              {/* Spin Preview — always visible in this step so the transport
                  timeline is there from the moment you enter (auto-spins on
                  entry). "rerun spin" sits to the LEFT of the play/reset
                  transport controls. */}
              {embedded && (
                <>
                  <div className="scene-field-group-head" style={{ marginTop: 12 }}>
                    Spin Preview
                    <span className="scene-pill">autoplay + scrub</span>
                  </div>
                  <SpinnerPreviewTimeline run={testRun} time={previewTime} onScrub={scrubPreview} />
                  <div className="spinner-wizard-auto-row" style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="scene-btn scene-btn--primary"
                      onClick={runTestSpin}
                      disabled={validSymbols.length < 2}
                      title={`startSpin → spin (${(timing.minSpinTime ?? 1)}s) → stopSpin, landing on the board below exactly`}
                    >
                      🎰 rerun spin ({(timing.minSpinTime ?? 1)}s)
                    </button>
                    <button
                      type="button"
                      className="scene-btn scene-btn--ghost"
                      onClick={() => setPreviewPlaying((p) => !p)}
                      disabled={!testRun}
                    >
                      {previewPlaying ? '⏸ pause' : '▶ play'}
                    </button>
                    <button type="button" className="scene-btn scene-btn--ghost" onClick={resetPreview} disabled={!testRun}>⏮ reset</button>
                    <span className="scene-spinner-meta" style={{ marginLeft: 'auto' }}>
                      {previewTime.toFixed(2)} / {Math.max(0, testRun?.total || 0).toFixed(2)}s
                    </span>
                  </div>
                </>
              )}

              {/* Result — semi-random outcome + reroll, BELOW the timeline */}
              <div className="scene-field-group-head" style={{ marginTop: 12 }}>
                Result
                <span className="scene-pill">sets the board below + the preview ↑</span>
              </div>
              <div className="spinner-wizard-auto-row">
                <select
                  value={testOutcome}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTestOutcome(next);
                    setTestReroll(0);
                    applyOutcomeBoard(next, 0);
                  }}
                  disabled={validSymbols.length < 2}
                  title="Picking a result generates a board for that outcome and shows it immediately, below and in the live preview"
                >
                  {SPIN_OUTCOME_LABELS.map((o) => (
                    <option
                      key={o.value}
                      value={o.value}
                      disabled={o.value === 'wildWin' && !(previewSpinnerConfig && classifySymbols(previewSpinnerConfig).wildId)}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
                {testOutcome !== 'default' && (
                  <button
                    type="button"
                    className="scene-btn scene-btn--sm scene-btn--ghost"
                    title="Re-seed within the same threshold — same category, different board"
                    onClick={() => {
                      const next = testReroll + 1;
                      setTestReroll(next);
                      applyOutcomeBoard(testOutcome, next);
                    }}
                    disabled={validSymbols.length < 2}
                  >
                    🎲 Re-roll
                  </button>
                )}
              </div>

              <div className="scene-field-group-head" style={{ marginTop: 12 }}>Initial Board</div>
              {validSymbols.length >= 2 ? (
                <>
                  <BoardGridEditor config={previewConfig} board={initialBoard} onChange={setInitialBoard} />
                  <div className="scene-spinner-meta">
                    Shown before the first startSpin clip. Editing a cell by hand overrides the Result
                    above — it won't re-sync unless you pick a Result (or re-roll) again.
                  </div>
                </>
              ) : (
                <div className="scene-spinner-meta" style={{ color: 'var(--err, #f88)' }}>
                  Go back to Symbols — need at least 2.
                </div>
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
          {step === 'preview' ? (
            <button type="button" className="scene-btn scene-btn--primary"
              disabled={validSymbols.length < 2 || blurGenerating || finalizingBlurs}
              title={blurGenerating || finalizingBlurs ? 'Waiting for blur generation to finish…' : undefined}
              onClick={handleCreate}>
              {blurGenerating || finalizingBlurs
                ? '⏳ rendering blurs…'
                : isEdit ? '✓ rebuild spinner' : '＋ create spinner'}
            </button>
          ) : step === 'symbols' && blursOutstanding ? (
            // Primary action while blurs are still missing: render them (staying
            // on this page, with the progress bar above) then advance. The plain
            // "next →" only reappears once every symbol has a matched blur — to
            // skip blur generation entirely, use the step tabs at the top.
            <button type="button" className="scene-btn scene-btn--primary"
              disabled={!canNext || blurGenerating || finalizingBlurs}
              title="Render the missing blur PNGs (static + animation-only poses), then continue to Grid"
              onClick={renderBlursAndContinue}>
              {blurGenerating || finalizingBlurs ? '⏳ rendering blurs…' : '⚡ render blurs and continue'}
            </button>
          ) : (
            <button type="button" className="scene-btn scene-btn--primary"
              disabled={!canNext}
              onClick={() => goToStep(STEPS[stepIdx + 1])}>
              next →
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
