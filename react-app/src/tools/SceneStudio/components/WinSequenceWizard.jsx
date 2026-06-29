// components/WinSequenceWizard.jsx
// Win-Sequence setup wizard — 2 steps: Skeleton → Sequences (+ live preview).
//
// A win-sequence object is a single Spine skeleton (win_sequence.json) whose
// animations follow the Yggdrasil tier naming (01a_small_begin, 02b_medium_idle,
// 04c_big_end, …). The wizard:
//   ① fetches that skeleton from the loaded project (auto-detected by name,
//      like the Spinner wizard fills symbols), loads it, and maps every
//      animation onto its win tier;
//   ② auto-builds every escalation flow (small → medium → … → target, only the
//      final tier plays its _end), with a sequence-timeline preview of any flow
//      below the setup. Large (03) + Max (07) are gated behind toggles per Design rule.
//
// onCreate({ name, winseqConfig, skeleton: { src, atlas, texture } })
//
// Edit mode: pass `existingConfig` (normalized winseq config) + `existingName`
// + `existingSkeleton` ({ src, atlas, texture }) to re-open on a created object.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveAssetFile } from '../engine/persist.js';
import { loadSkeletonData } from '../engine/spineLoader.js';
import {
  createEmptyScene,
  defaultTransformsForNewLayer,
  deriveFlowGraph,
  normalizeTrack,
} from '../engine/sceneModel.js';
import {
  WIN_TIERS,
  mapAnimationsToTiers,
  buildWinSeqFlows,
  winSeqFlowDuration,
  evaluateWinSeqFlow,
  normalizeWinSeqConfig,
  findWinSeqFlow,
  winSeqStepDuration,
} from '../engine/winseq/winseqModel.js';
import {
  WIN_CURRENCIES,
  DEFAULT_CHAR_LAYOUT,
  TEMPLATE_FONT_ID,
  isTemplateFont,
  templateFontUrl,
  formatWinNumber,
  winNumberValueAt,
} from '../engine/winseq/winNumberModel.js';
import { hash32 } from '../engine/spinner/spinnerModel.js';

/**
 * Build the synthetic preview scene rendered in the main viewport while the
 * wizard is open: one centered winseq layer + a single clip playing the
 * selected flow. Returns { scene, total } (total = flow length in seconds).
 */
function buildWinSeqPreviewScene(skeleton, winseqConfig, flowId, durations, projectRoot = null, showNumber = false, numberSample = null) {
  const config = normalizeWinSeqConfig(winseqConfig);
  if (!config || !skeleton?.src) return { scene: null, total: 1 };
  const flow = findWinSeqFlow(config, flowId);
  const total = flow ? Math.max(0.1, winSeqFlowDuration(flow, durations, { hangOnLastIdle: false })) : 1;
  const base = createEmptyScene('Win sequence preview');
  base.projectRoot = projectRoot;
  // STABLE ids so changing the previewed flow doesn't churn the structural hash
  // and force a full Pixi rebuild (see the spinner preview for the rationale).
  base.canvases = [{ id: 'wprev_canvas', name: 'Canvas', visible: true }];
  base.activeCanvasId = 'wprev_canvas';
  const assetId = 'wprev_winseq';
  const layerId = 'wprev_layer';
  base.assets = [{
    id: assetId, type: 'winseq',
    src: skeleton.src, atlas: skeleton.atlas, texture: skeleton.texture,
    winseq: winseqConfig, meta: { originalName: 'preview' }
  }];
  base.layers = [{
    id: layerId, name: 'preview', assetId,
    canvasId: 'wprev_canvas', parentId: null, visible: true, blend: 'normal',
    transforms: defaultTransformsForNewLayer(base.stage)
  }];
  // Show the number child only on the Number/Sequences steps (not Skeleton).
  // `numberSample` (set on the Number step) makes it show a fixed value; on the
  // Sequences step it's null → the live count-up. Read live from the scene by
  // the runtime, so no rebuild is needed when only the sample changes.
  if (showNumber && winseqConfig?.number?.fontSrc) {
    base.assets.push({ id: 'wprev_num', type: 'winnumber', parentAssetId: assetId, meta: { originalName: 'number' } });
    base.layers.push({
      id: 'wprev_num_layer', name: 'Win Number', assetId: 'wprev_num',
      canvasId: 'wprev_canvas', parentId: layerId, locked: true, visible: true, blend: 'normal',
      transforms: { landscape: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5], alpha: 1, tint: { r: 1, g: 1, b: 1 } }, portrait: null }
    });
    base.winNumberPreview = (typeof numberSample === 'number') ? { sample: numberSample } : null;
  }
  base.stage = { ...base.stage, duration: Math.max(base.stage.duration, total) };
  const track = normalizeTrack({
    id: 'wprev_track', layerId,
    clips: [{ id: 'wprev_clip', start: 0, duration: total, winseq: { sequenceId: flow?.id || null, hangOnLastIdle: false } }]
  });
  base.flow = deriveFlowGraph({ tracks: [track], markers: [], nodes: [], edges: [] });
  base.timelines = [{ ...base.timelines[0], tracks: [track] }];
  return { scene: base, total };
}

const STEPS = ['skeleton', 'number', 'sequences'];
const STEP_LABELS = { skeleton: '1. Skeleton', number: '2. Number', sequences: '3. Sequences preview' };

const isDirectUrl = (src) => /^(blob:|data:|https?:)/.test(String(src || ''));

/** Heuristic for an auto-detectable win-number font png (mirrors looksLikeWinSeq). */
function looksLikeFont(s) {
  return /(^|[_\-\s])(win|font|number|num)([_\-\s]|$)/i.test(String(s || ''));
}

/** A fresh number config (Number step skipped → fontSrc stays null). */
function defaultNumberConfig() {
  return {
    fontSrc: null, cell: 256, cols: 8, rows: 8, charLayout: DEFAULT_CHAR_LAYOUT,
    letterSpacing: 0, glyphScale: 1, baselineOffset: 0, align: 'center',
    currency: '$', currencyPosition: 'prefix', decimalSep: '.', decimals: 2, boneName: '', wager: 1,
  };
}

/** The fixed sample value shown in the wizard's Number-step scene preview. */
const NUMBER_PREVIEW_SAMPLE = 2137;

/**
 * Time (s) landing in the MIDDLE of a flow's final idle — the begin frame often
 * has the TEXT_ bone scaled to 0 (invisible), so the Number-step preview poses
 * on the idle instead. Uses the same per-step durations as the runtime.
 */
function flowMidIdleTime(flow, durations) {
  if (!flow?.steps?.length) return 0;
  let lastIdle = -1;
  for (let i = flow.steps.length - 1; i >= 0; i--) {
    if (flow.steps[i].role === 'idle') { lastIdle = i; break; }
  }
  if (lastIdle < 0) return 0;
  let t = 0;
  for (let i = 0; i < lastIdle; i++) t += winSeqStepDuration(flow.steps[i].anim, durations);
  return t + winSeqStepDuration(flow.steps[lastIdle].anim, durations) * 0.5;
}

/** Resolve a stored src (relative path / data url) to a fetchable URL. */
async function resolveOne(src, rootHandle) {
  if (!src) return null;
  if (isDirectUrl(src)) return src;
  if (!rootHandle) return null;
  const file = await resolveAssetFile(src, rootHandle);
  return file ? URL.createObjectURL(file) : null;
}

function looksLikeWinSeq(s) {
  return /win[_\- ]?seq|win[_\- ]?sequence|winsequence/i.test(String(s || ''));
}

/** Base file name without path or extension, lowercased. */
function baseNameNoExt(s) {
  return String(s || '').split(/[\\/]/).pop()
    .replace(/\.atlas\.txt$/i, '').replace(/\.(json|atlas|png)$/i, '').toLowerCase();
}
/** Exact `win_sequence` skeleton (preferred over any fuzzy name match). */
function isExactWinSeq(s) {
  return baseNameNoExt(s) === 'win_sequence';
}

// ── Sequence preview (renderer-free) ─────────────────────────────────────────
// A live spine canvas would need a SECOND Pixi Application; in Pixi v8 a second
// WebGL renderer shares batch/program state with the main viewport's renderer
// and tearing it down crashes the main one ("batcher is null"). So the preview
// is a pure-DOM sequence timeline: color-coded begin/idle/end segments sized by
// each animation's real duration, with a play/scrub playhead and the current
// animation name — it previews the WHOLE flow (timing + escalation) safely.

function WinSeqPreview({ flow, durations, onTime }) {
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  playingRef.current = playing;
  const emit = (t) => { try { onTimeRef.current?.(t); } catch { /* ignore */ } };

  const total = useMemo(
    () => (flow ? winSeqFlowDuration(flow, durations, { hangOnLastIdle: false }) : 0),
    [flow, durations]
  );
  const totalRef = useRef(total);
  totalRef.current = total;

  // Per-step segments with cumulative offsets (for the timeline strip).
  const segments = useMemo(() => {
    if (!flow?.steps?.length) return [];
    let acc = 0;
    return flow.steps.map((s) => {
      const d = winSeqStepDuration(s.anim, durations);
      const seg = { ...s, start: acc, dur: d };
      acc += d;
      return seg;
    });
  }, [flow, durations]);

  useEffect(() => { timeRef.current = 0; setTime(0); emit(0); }, [flow?.id]);

  useEffect(() => {
    lastTsRef.current = 0;
    const frame = (ts) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = lastTsRef.current ? Math.min(0.05, (ts - lastTsRef.current) / 1000) : 0;
      lastTsRef.current = ts;
      if (!playingRef.current) return;
      const tot = totalRef.current || 0.001;
      timeRef.current = (timeRef.current + dt) % tot;
      setTime(timeRef.current);
      emit(timeRef.current);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    timeRef.current = p * total;
    setTime(timeRef.current);
    emit(timeRef.current);
  };

  const activeStep = flow ? evaluateWinSeqFlow(flow, durations, time, { hangOnLastIdle: false }) : null;
  const playPct = total > 0 ? (time / total) * 100 : 0;

  return (
    <div className="winseq-preview">
      <div className="winseq-preview-bar" onPointerDown={onScrub}>
        {segments.filter((s) => s.dur > 0).map((s, i) => {
          const active = time >= s.start && time < s.start + s.dur;
          return (
            <div
              key={i}
              className={'winseq-seg winseq-seg--' + s.role + (active ? ' active' : '')}
              style={{ width: `${total > 0 ? (s.dur / total) * 100 : 0}%` }}
              title={`${s.anim} · ${s.dur.toFixed(2)}s`}
            >
              <span>{s.role}</span>
            </div>
          );
        })}
        <div className="winseq-preview-playhead" style={{ left: `${playPct}%` }} />
      </div>
      <div className="winseq-preview-controls">
        <button type="button" className="scene-btn scene-btn--ghost" onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸' : '▶'}
        </button>
        <span className="winseq-preview-now">▶ <strong>{activeStep?.anim || '—'}</strong></span>
        <span className="winseq-preview-time">{time.toFixed(2)} / {total.toFixed(2)}s</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function WinSequenceWizard({
  scene, assetItems, rootHandle, onClose, onCreate,
  existingConfig = null, existingName = null, existingSkeleton = null,
  embedded = false, onPreviewScene, onPreviewTime, initialStep = null,
}) {
  const isEdit = !!existingConfig;
  const [step, setStep] = useState(STEPS.includes(initialStep) ? initialStep : 'skeleton');
  const [name, setName] = useState(existingName || 'Win Sequences');

  // Skeleton candidate pool: scene spine/winseq assets + project-scanned spines.
  const skeletonPool = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const a of scene?.assets || []) {
      if ((a.type === 'spine' || a.type === 'winseq') && a.src) {
        out.push({ id: a.id, label: a.meta?.originalName || a.id, src: a.src, atlas: a.atlas, texture: a.texture });
        seen.add(a.src);
      }
    }
    for (const it of assetItems || []) {
      if (it.type !== 'spine') continue;
      const src = it.jsonPath || it.path;
      if (!src || seen.has(src)) continue;
      out.push({ id: `item:${src}`, label: it.name, src, atlas: it.atlasPath || it.atlas, texture: it.texturePath || it.texture });
      seen.add(src);
    }
    return out;
  }, [scene?.assets, assetItems]);

  // Initial selection: edit → the existing skeleton; create → auto-pick a
  // win_sequence-named entry, else the first.
  const [selectedId, setSelectedId] = useState(() => {
    if (existingSkeleton?.src) {
      const match = skeletonPool.find((e) => e.src === existingSkeleton.src);
      if (match) return match.id;
    }
    // Prefer the exact `win_sequence` skeleton; only then fall back to a fuzzy
    // name match (win_seq / total_win etc.), then the first available.
    const exact = skeletonPool.find((e) => isExactWinSeq(e.label) || isExactWinSeq(e.src));
    const named = skeletonPool.find((e) => looksLikeWinSeq(e.label) || looksLikeWinSeq(e.src));
    return exact?.id || named?.id || skeletonPool[0]?.id || null;
  });

  const selectedEntry = useMemo(() => {
    if (existingSkeleton?.src && !skeletonPool.some((e) => e.id === selectedId)) {
      return { id: 'existing', label: existingName || 'win_sequence', ...existingSkeleton };
    }
    return skeletonPool.find((e) => e.id === selectedId) || null;
  }, [skeletonPool, selectedId, existingSkeleton, existingName]);

  // Loaded skeleton metadata.
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [animNames, setAnimNames] = useState([]);
  const [durations, setDurations] = useState({});
  const [boneNames, setBoneNames] = useState([]);
  const [tiers, setTiers] = useState(existingConfig?.tiers || []);

  // ── Number (count-up display) — step 2, fully skippable ──────────────────
  const [skipNumber, setSkipNumber] = useState(!existingConfig?.number?.fontSrc);
  const [num, setNum] = useState(() => ({ ...defaultNumberConfig(), ...(existingConfig?.number || {}) }));
  const setNumField = (k, v) => setNum((n) => ({ ...n, [k]: v }));
  // Inspection-only sample shown in the scene view on the Number step (not persisted).
  const [previewSample, setPreviewSample] = useState(NUMBER_PREVIEW_SAMPLE);

  // Load the selected skeleton ONCE just to read its animation list + durations
  // (used for tier mapping + the preview strip). No Pixi Application is created —
  // loadSkeletonData only parses data + makes a TextureSource, and the blob URLs
  // are revoked as soon as parsing finishes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    if (!selectedEntry) { setLoading(false); setLoadError('no skeleton found in project'); return undefined; }
    (async () => {
      let triple = null;
      const revoke = () => {
        if (triple) for (const u of [triple.json, triple.atlas, triple.texture]) {
          if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
        }
      };
      try {
        triple = {
          json: await resolveOne(selectedEntry.src, rootHandle),
          atlas: await resolveOne(selectedEntry.atlas, rootHandle),
          texture: await resolveOne(selectedEntry.texture, rootHandle),
        };
        if (cancelled) { revoke(); return; }
        if (!triple.json || !triple.atlas || !triple.texture) {
          revoke();
          setLoadError('skeleton is missing its .atlas / .png — pick a complete Spine export');
          setLoading(false);
          return;
        }
        const data = await loadSkeletonData(triple.json, triple.atlas, triple.texture);
        revoke(); // parsing is done — the URLs aren't needed any more
        if (cancelled) return;
        const anims = data.animations || [];
        const names = anims.map((a) => a.name);
        const durs = {};
        for (const a of anims) durs[a.name] = Number(a.duration) || 0;
        // Build a full tier list (every WIN_TIER, present or not) so the user
        // can manually assign animations to tiers auto-mapping missed. Saved
        // (edit-mode) slots + enabled flags win; otherwise auto-mapped values.
        const mapped = new Map(mapAnimationsToTiers(names).map((t) => [t.key, t]));
        const full = WIN_TIERS.map((def) => {
          const m = mapped.get(def.key);
          const prev = (existingConfig?.tiers || []).find((p) => p.key === def.key);
          const begin = prev?.begin ?? m?.begin ?? null;
          const idle = prev?.idle ?? m?.idle ?? null;
          const end = prev?.end ?? m?.end ?? null;
          const present = !!(begin || idle || end);
          return {
            key: def.key, num: def.num, label: def.label, optional: def.optional,
            begin, idle, end, present,
            enabled: prev ? prev.enabled === true : (present && !def.optional),
          };
        });
        // Bone list (for the Number step's follow-bone picker). Auto-pick the
        // first TEXT_/text_ bone when none is set yet.
        const bones = (data.bones || []).map((b) => b.name);
        setBoneNames(bones);
        setNum((n) => {
          if (n.boneName && bones.includes(n.boneName)) return n;
          // Skeletons often have a text CONTROL bone (e.g. `text_controler`) plus
          // the actual number holder (e.g. `TEXT_number`). Prefer the holder:
          // a text bone naming a win/number/amount, then an UPPERCASE `TEXT_`
          // (the convention for the holder), then any text_ / text bone.
          const auto =
            bones.find((b) => /text.*(win|number|amount|value|num)|(win|number|amount|value)/i.test(b) && /text/i.test(b)) ||
            bones.find((b) => /^TEXT_/.test(b)) ||
            bones.find((b) => /^text_/i.test(b)) ||
            bones.find((b) => /text/i.test(b)) || '';
          return auto && auto !== n.boneName ? { ...n, boneName: auto } : n;
        });
        setAnimNames(names);
        setDurations(durs);
        setTiers(full);
        setLoading(false);
      } catch (e) {
        revoke();
        if (!cancelled) {
          const msg = String(e?.message || e || '');
          // Spine runtime mismatch: 4.2 skeletons that use physics constraints
          // can't be parsed by the editor's 4.3 runtime (and vice-versa). Surface
          // an actionable hint instead of the cryptic raw error.
          const versionish = /physics|spine|version|constraint/i.test(msg);
          setLoadError(versionish
            ? `failed to load skeleton (${msg}). This usually means a Spine VERSION mismatch — the editor runs Spine 4.3, so re-export this skeleton from Spine 4.3 (or remove physics constraints).`
            : `failed to load skeleton: ${msg}`);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntry?.src, rootHandle]);

  // Font-png candidate pool: scene png assets + project-scanned pngs.
  const fontPool = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const a of scene?.assets || []) {
      if (a.type === 'png' && a.src && !seen.has(a.src)) {
        out.push({ src: a.src, label: a.meta?.originalName || a.id }); seen.add(a.src);
      }
    }
    for (const it of assetItems || []) {
      if (it.type !== 'png') continue;
      const src = it.path || it.src;
      if (!src || seen.has(src)) continue;
      out.push({ src, label: it.name || src }); seen.add(src);
    }
    return out;
  }, [scene?.assets, assetItems]);

  // Auto-pick a font: a workspace png named like win/font, else fall back to the
  // built-in template atlas so the artist can always test. Stops once the user
  // picks a font explicitly (or in edit mode where one is already saved). Upgrades
  // template → a real workspace font if one shows up later in the scan.
  const fontTouchedRef = useRef(!!existingConfig?.number?.fontSrc);
  const skipTouchedRef = useRef(false);
  useEffect(() => {
    if (fontTouchedRef.current) return;
    const named = fontPool.find((f) => looksLikeFont(f.label) || looksLikeFont(f.src));
    const pick = named?.src || TEMPLATE_FONT_ID;
    setNum((n) => (n.fontSrc === pick ? n : { ...n, fontSrc: pick }));
    if (!isEdit && !skipTouchedRef.current) setSkipNumber(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontPool]);

  // Resolve the chosen font to a previewable URL (for the verify grid) + probe size.
  const [fontUrl, setFontUrl] = useState(null);
  const [fontDims, setFontDims] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let url = null;
    setFontDims(null);
    if (!num.fontSrc) { setFontUrl(null); return undefined; }
    (async () => {
      url = isTemplateFont(num.fontSrc) ? templateFontUrl() : await resolveOne(num.fontSrc, rootHandle);
      if (cancelled) { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); return; }
      setFontUrl(url);
      if (url) {
        const img = new Image();
        img.onload = () => { if (!cancelled) setFontDims({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.src = url;
      }
    })();
    return () => { cancelled = true; if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num.fontSrc, rootHandle]);

  const flows = useMemo(() => buildWinSeqFlows(tiers), [tiers]);
  const [previewFlowId, setPreviewFlowId] = useState(null);
  useEffect(() => {
    if (!flows.length) { setPreviewFlowId(null); return; }
    if (!flows.some((f) => f.id === previewFlowId)) setPreviewFlowId(flows[flows.length - 1].id);
  }, [flows, previewFlowId]);
  const previewFlow = flows.find((f) => f.id === previewFlowId) || flows[flows.length - 1] || null;

  // Number step: which tier's IDLE to pose the preview on (begin frames often
  // hide the bone). Defaults to the BIGGEST enabled tier (e.g. mega) — its idle
  // is the most likely to show the number bone clearly.
  const [poseFlowId, setPoseFlowId] = useState(null);
  useEffect(() => {
    if (!flows.length) { setPoseFlowId(null); return; }
    if (!flows.some((f) => f.id === poseFlowId)) setPoseFlowId(flows[flows.length - 1].id);
  }, [flows, poseFlowId]);
  const poseFlow = flows.find((f) => f.id === poseFlowId) || flows[flows.length - 1] || null;

  // Push the synthetic preview scene to the host viewport (full-focus mode).
  // Rebuilds only when the skeleton / tier set / selected flow / durations
  // change — the transport (WinSeqPreview onTime) drives the clock separately.
  // The effective number config to persist / preview (null when skipped).
  const numberConfig = useMemo(
    () => ((skipNumber || !num.fontSrc) ? null : { ...num }),
    [skipNumber, num]
  );

  const previewConfig = useMemo(() => {
    const tierList = tiers.map((t) => ({ key: t.key, begin: t.begin, idle: t.idle, end: t.end, enabled: t.enabled }));
    // rev bumps (→ full Pixi rebuild) only on STRUCTURAL changes: tier mapping
    // and the number's glyph set (font / grid / layout string). Cheap number
    // edits (scale, spacing, currency, decimals, wager) are applied live by the
    // runtime without a rebuild, so they're excluded here.
    const numStruct = numberConfig
      ? { fontSrc: numberConfig.fontSrc, charLayout: numberConfig.charLayout, cell: numberConfig.cell, cols: numberConfig.cols, rows: numberConfig.rows }
      : null;
    return { rev: hash32(JSON.stringify({ tierList, numStruct })) || 1, tiers: tierList, number: numberConfig };
  }, [tiers, numberConfig]);

  // On the Number step the preview poses a chosen tier's idle; elsewhere it uses
  // the flow picked from the flow list (step 3) / the highest flow.
  const stepFlow = step === 'number' ? (poseFlow || previewFlow) : previewFlow;

  useEffect(() => {
    if (!embedded || !onPreviewScene) return;
    if (!selectedEntry || !stepFlow) { onPreviewScene(null); return; }
    // The number only previews on the Number + Sequences steps (the Skeleton
    // step is for the rig only). On Number it shows a fixed sample; on Sequences
    // it does the live count-up (sample = null).
    const showNumber = !!numberConfig && (step === 'number' || step === 'sequences');
    const numberSample = step === 'number' ? previewSample : null;
    const { scene: previewScene } = buildWinSeqPreviewScene(
      selectedEntry, previewConfig, stepFlow.id, durations, scene?.projectRoot || null, showNumber, numberSample
    );
    onPreviewScene(previewScene);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, selectedEntry?.src, previewConfig, stepFlow?.id, durations, step, numberConfig, previewSample]);

  // On the Number step, freeze the preview clock mid-idle of the chosen tier so
  // the bone (and number) are visible (begin frames can scale the bone to 0).
  useEffect(() => {
    if (!embedded || !onPreviewTime || step !== 'number' || !poseFlow) return;
    onPreviewTime(flowMidIdleTime(poseFlow, durations));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, step, poseFlow?.id, durations]);

  const toggleTier = (key) =>
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, enabled: !t.enabled } : t)));

  // Manually assign an animation to a tier slot (begin/idle/end). Updates
  // `present` and auto-enables a non-optional tier that just gained an anim.
  const setTierAnim = (key, role, value) =>
    setTiers((prev) => prev.map((t) => {
      if (t.key !== key) return t;
      const next = { ...t, [role]: value || null };
      next.present = !!(next.begin || next.idle || next.end);
      if (!t.optional && next.present && !t.present) next.enabled = true;
      return next;
    }));

  const matchedCount = tiers.filter((t) => t.present).length;
  const enabledCount = tiers.filter((t) => t.enabled).length;

  const handleCreate = useCallback(() => {
    if (!flows.length || !selectedEntry) return;
    const winseqConfig = {
      rev: (existingConfig?.rev || 0) + 1,
      tiers: tiers.map((t) => ({ key: t.key, begin: t.begin, idle: t.idle, end: t.end, enabled: t.enabled })),
      number: numberConfig,
    };
    const skeleton = { src: selectedEntry.src, atlas: selectedEntry.atlas, texture: selectedEntry.texture };
    onCreate?.({ name: name.trim() || 'Win Sequences', winseqConfig, skeleton });
  }, [flows.length, selectedEntry, existingConfig, tiers, name, numberConfig, onCreate]);

  const stepIdx = STEPS.indexOf(step);
  const canNext = step === 'skeleton' ? (!loading && !loadError && matchedCount > 0) : true;

  const Shell = embedded ? EmbeddedShell : OverlayShell;
  return (
    <Shell>
      <div className={'spinner-wizard' + (embedded ? ' spinner-wizard--embedded' : '')}>

        <div className="spinner-wizard-head">
          <span className="spinner-wizard-title">{isEdit ? '✎ Edit Win Sequences' : '＋ New Win Sequences'}</span>
          <div className="spinner-wizard-steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={'spinner-wizard-step-btn' + (s === step ? ' active' : '') + (i < stepIdx ? ' done' : '')}
                onClick={() => setStep(s)}
                disabled={i > stepIdx && !canNext}
              >
                {STEP_LABELS[s]}
              </button>
            ))}
          </div>
          <button type="button" className="scene-icon-btn" onClick={onClose} title="Cancel">✕</button>
        </div>

        <div className="spinner-wizard-body">

          {/* ── Step 1: Skeleton ─────────────────────────────────── */}
          {step === 'skeleton' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">Skeleton &amp; Name</div>
              <label className="scene-field">
                <span>name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Win Sequences" />
              </label>

              <label className="scene-field">
                <span>win_sequence.json</span>
                <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value || null)}>
                  {!skeletonPool.length && <option value="">— no Spine found in project —</option>}
                  {skeletonPool.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}{looksLikeWinSeq(e.label) || looksLikeWinSeq(e.src) ? ' ◆' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {skeletonPool.length === 0 && (
                <div className="scene-spinner-meta" style={{ color: 'var(--text-2)' }}>
                  No Spine skeleton found. Open the project folder in the asset browser
                  (or drop the win_sequence Spine files into the scene) first.
                </div>
              )}

              {loading && <div className="scene-spinner-meta">loading skeleton…</div>}
              {loadError && <div className="scene-spinner-meta" style={{ color: 'var(--err,#f88)' }}>{loadError}</div>}

              {!loading && !loadError && (
                <>
                  <div className="scene-field-group-head" style={{ marginTop: 12 }}>
                    Tiers — mapped {matchedCount} / {WIN_TIERS.length}
                    <span className="scene-pill">{animNames.length} anims</span>
                  </div>
                  <div className="scene-spinner-meta" style={{ marginBottom: 6 }}>
                    Animations are auto-matched by name — any anim containing the
                    tier word (e.g. <em>small</em>) plus the slot word (<em>begin</em>
                    / <em>idle</em> / <em>end</em>) fills that slot. Pick from the
                    dropdowns to fix any the matcher missed. Large (03) &amp; Max (07)
                    stay off until Design requests them.
                  </div>
                  <div className="winseq-tier-list">
                    {WIN_TIERS.map((def) => {
                      const t = tiers.find((x) => x.key === def.key);
                      const present = !!t?.present;
                      return (
                        <div key={def.key} className={'winseq-tier-row' + (present ? '' : ' winseq-tier-row--absent')}>
                          <label className="scene-field scene-field--check winseq-tier-head" style={{ margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={!!t?.enabled}
                              disabled={!present}
                              onChange={() => toggleTier(def.key)}
                            />
                            <span>{def.num} · {def.label}{def.optional ? ' *' : ''}</span>
                            {!present && <span className="winseq-tier-flag">unassigned</span>}
                          </label>
                          <div className="winseq-tier-slots">
                            {['begin', 'idle', 'end'].map((role) => (
                              <label key={role} className="winseq-slot">
                                <span className={'winseq-slot-label winseq-slot-label--' + (t?.[role] ? 'ok' : 'miss')}>{role}</span>
                                <select
                                  className="winseq-slot-select"
                                  value={t?.[role] || ''}
                                  onChange={(e) => setTierAnim(def.key, role, e.target.value)}
                                  title={t?.[role] || `no ${role} animation`}
                                >
                                  <option value="">— none —</option>
                                  {animNames.map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="scene-spinner-meta" style={{ marginTop: 6 }}>* optional tier (only when Design asks)</div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Number (count-up display) — skippable ─────── */}
          {step === 'number' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">Win Number (count-up)</div>
              <label className="scene-field scene-field--check" style={{ marginBottom: 6 }}>
                <input type="checkbox" checked={skipNumber} onChange={(e) => { skipTouchedRef.current = true; setSkipNumber(e.target.checked); }} />
                <span>Skip — no count-up display (behaves like before)</span>
              </label>

              {!skipNumber && (
                <>
                  <div className="scene-spinner-meta" style={{ marginBottom: 6 }}>
                    A bitmap-font win amount that follows a <em>TEXT_</em> bone on the
                    skeleton and counts up as the sequence escalates. Pick the 2K font
                    atlas and the follow bone; tune spacing &amp; scale; choose the
                    currency + wager for the preview.
                  </div>

                  <label className="scene-field">
                    <span>font atlas (.png)</span>
                    <select
                      value={num.fontSrc || ''}
                      onChange={(e) => { fontTouchedRef.current = true; setNumField('fontSrc', e.target.value || null); }}
                    >
                      {!num.fontSrc && <option value="">— pick a font atlas —</option>}
                      {/* Built-in template first, in italics; auto-found project
                          candidates list below it (the auto-select rule still
                          prefers a real project font when one matches). */}
                      <option value={TEMPLATE_FONT_ID} style={{ fontStyle: 'italic' }}>
                        Built-in template — font_win
                      </option>
                      {fontPool.map((f) => (
                        <option key={f.src} value={f.src}>
                          {f.label}{looksLikeFont(f.label) || looksLikeFont(f.src) ? ' ◆' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="scene-field">
                    <span>follow bone</span>
                    <select value={num.boneName || ''} onChange={(e) => setNumField('boneName', e.target.value)}>
                      {!boneNames.length && <option value="">— load a skeleton first —</option>}
                      {!num.boneName && <option value="">— pick a bone —</option>}
                      {boneNames.map((b) => (
                        <option key={b} value={b}>{b}{/^text_/i.test(b) ? ' ◆' : ''}</option>
                      ))}
                    </select>
                  </label>

                  {/* verify grid: the atlas with the fixed 8×8 layout overlaid */}
                  {fontUrl && (
                    <>
                      <div className="scene-field-group-head" style={{ marginTop: 10 }}>
                        Glyph map — verify
                        {fontDims && (
                          <span className="scene-pill" style={{ color: (fontDims.w === fontDims.h && fontDims.w >= 1024) ? undefined : 'var(--err,#f88)' }}>
                            {fontDims.w}×{fontDims.h}
                          </span>
                        )}
                      </div>
                      <div className="winnum-glyph-grid" style={{ backgroundImage: `url(${fontUrl})` }}>
                        {Array.from({ length: num.cols * num.rows }).map((_, i) => (
                          <div key={i} className="winnum-glyph-cell">
                            <span>{DEFAULT_CHAR_LAYOUT[i] || ''}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="scene-field-group-head" style={{ marginTop: 10 }}>Format</div>
                  <div className="scene-field-row">
                    <label className="scene-field">
                      <span>currency</span>
                      <select value={num.currency} onChange={(e) => setNumField('currency', e.target.value)}>
                        {WIN_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="scene-field">
                      <span>position</span>
                      <select value={num.currencyPosition} onChange={(e) => setNumField('currencyPosition', e.target.value)}>
                        <option value="prefix">before · {num.currency} 0.00</option>
                        <option value="suffix">after · 0.00 {num.currency}</option>
                      </select>
                    </label>
                    <label className="scene-field">
                      <span>decimal sep</span>
                      <select value={num.decimalSep} onChange={(e) => setNumField('decimalSep', e.target.value)}>
                        <option value=".">. (dot)</option>
                        <option value=",">, (comma)</option>
                      </select>
                    </label>
                    <label className="scene-field">
                      <span>decimals</span>
                      <input type="number" min="0" max="4" step="1" value={num.decimals}
                        onChange={(e) => setNumField('decimals', Math.max(0, Math.min(4, parseInt(e.target.value, 10) || 0)))} />
                    </label>
                  </div>

                  <div className="scene-field-group-head" style={{ marginTop: 8 }}>Layout</div>
                  <div className="scene-field-row">
                    <label className="scene-field">
                      <span>glyph scale</span>
                      <input type="number" min="0.05" step="0.05" value={num.glyphScale}
                        onChange={(e) => setNumField('glyphScale', Math.max(0.05, parseFloat(e.target.value) || 0.05))} />
                    </label>
                    <label className="scene-field">
                      <span>letter spacing</span>
                      <input type="number" step="2" value={num.letterSpacing}
                        onChange={(e) => setNumField('letterSpacing', parseFloat(e.target.value) || 0)} />
                    </label>
                    <label className="scene-field">
                      <span>baseline Y</span>
                      <input type="number" step="2" value={num.baselineOffset}
                        onChange={(e) => setNumField('baselineOffset', parseFloat(e.target.value) || 0)} />
                    </label>
                  </div>

                  <div className="scene-field-group-head" style={{ marginTop: 8 }}>Preview sample</div>
                  <div className="scene-field-row">
                    <label className="scene-field">
                      <span>pose on idle</span>
                      <select value={poseFlowId || ''} onChange={(e) => setPoseFlowId(e.target.value || null)}>
                        {!flows.length && <option value="">— no flows —</option>}
                        {flows.map((f) => <option key={f.id} value={f.id}>{f.label} idle</option>)}
                      </select>
                    </label>
                    <label className="scene-field">
                      <span>sample value</span>
                      <input type="number" min="0" step="1" value={previewSample}
                        onChange={(e) => setPreviewSample(Math.max(0, parseFloat(e.target.value) || 0))} />
                    </label>
                    <div className="scene-field" style={{ alignSelf: 'flex-end' }}>
                      <span>shows as</span>
                      <div style={{ fontWeight: 700, color: 'var(--accent,#ffd45a)' }}>{formatWinNumber(previewSample, num)}</div>
                    </div>
                  </div>
                  <div className="scene-spinner-meta">
                    Shown in the scene view ↑ for inspection only. On the Sequences step
                    the number counts up live (0 → tier amount) as you scrub a flow.
                  </div>

                  {(!num.fontSrc || !num.boneName) && (
                    <div className="scene-spinner-meta" style={{ color: 'var(--err,#f88)', marginTop: 6 }}>
                      {!num.fontSrc ? 'Pick a font atlas' : 'Pick a follow bone'} to enable the
                      number (or tick Skip).
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Sequences preview ────────────────────────── */}
          {step === 'sequences' && (
            <div className="spinner-wizard-section">
              {numberConfig && (
                <>
                  <div className="scene-field-group-head">Win amount</div>
                  <div className="scene-field-row">
                    <label className="scene-field">
                      <span>wager</span>
                      <input type="number" min="0" step="0.1" value={num.wager}
                        onChange={(e) => setNumField('wager', Math.max(0, parseFloat(e.target.value) || 0))} />
                    </label>
                    <div className="scene-field" style={{ alignSelf: 'flex-end' }}>
                      <span>count-up tops out at</span>
                      <div style={{ fontWeight: 700, color: 'var(--accent,#ffd45a)' }}>
                        {previewFlow ? formatWinNumber(winNumberValueAt(previewFlow, durations, 1e9, { wager: num.wager }), num) : '—'}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className="scene-field-group-head" style={{ marginTop: numberConfig ? 8 : 0 }}>
                Generated flows
                <span className="scene-pill">{flows.length} sequence{flows.length !== 1 ? 's' : ''}</span>
              </div>
              {!flows.length ? (
                <div className="scene-spinner-meta" style={{ color: 'var(--err,#f88)' }}>
                  No flow could be built — enable at least one tier in step 1.
                </div>
              ) : (
                <div className="winseq-flow-list">
                  {flows.map((f) => {
                    const dur = winSeqFlowDuration(f, durations, { hangOnLastIdle: false });
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={'winseq-flow-row' + (f.id === previewFlowId ? ' active' : '')}
                        onClick={() => setPreviewFlowId(f.id)}
                        title="Click to preview this flow below"
                      >
                        <div className="winseq-flow-head">
                          <strong>{f.label}</strong>
                          <span className="scene-pill">{f.id}</span>
                          <span className="winseq-flow-dur">{dur.toFixed(2)}s · {f.steps.length} steps</span>
                        </div>
                        <div className="winseq-flow-chain">
                          {f.steps.map((s, i) => (
                            <span key={i} className={'winseq-step winseq-step--' + s.role}>
                              {s.anim}{i < f.steps.length - 1 ? ' →' : ''}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {previewFlow && (
                <>
                  <div className="scene-field-group-head" style={{ marginTop: 12 }}>
                    Preview · {previewFlow.label}
                    <span className="scene-pill">plays in the scene view ↑</span>
                  </div>
                  <WinSeqPreview flow={previewFlow} durations={durations} onTime={embedded ? onPreviewTime : undefined} />
                </>
              )}

              <div className="scene-field-group-head" style={{ marginTop: 12 }}>Summary</div>
              <div className="scene-spinner-meta">
                <strong>{name || 'Win Sequences'}</strong> · {enabledCount} tier{enabledCount !== 1 ? 's' : ''} ·
                {' '}{flows.length} flow{flows.length !== 1 ? 's' : ''} · drag onto the timeline and pick a flow per clip.
              </div>
            </div>
          )}

        </div>{/* /body */}

        <div className="spinner-wizard-foot">
          {stepIdx > 0 && (
            <button type="button" className="scene-btn scene-btn--ghost" onClick={() => setStep(STEPS[stepIdx - 1])}>← back</button>
          )}
          <div style={{ flex: 1 }} />
          {step !== 'sequences' ? (
            <button type="button" className="scene-btn scene-btn--primary" disabled={!canNext} onClick={() => setStep(STEPS[stepIdx + 1])}>
              next →
            </button>
          ) : (
            <button type="button" className="scene-btn scene-btn--primary" disabled={!flows.length} onClick={handleCreate}>
              {isEdit ? '✓ rebuild win sequences' : '＋ create win sequences'}
            </button>
          )}
        </div>

      </div>
    </Shell>
  );
}

/** Modal overlay wrapper (standalone use). */
function OverlayShell({ children }) {
  return <div className="scene-confirm-overlay" style={{ zIndex: 1100 }}>{children}</div>;
}

/** Docked panel wrapper (embedded in the bottom slot). */
function EmbeddedShell({ children }) {
  return <>{children}</>;
}
