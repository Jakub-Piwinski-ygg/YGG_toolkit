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
import { hash32 } from '../engine/spinner/spinnerModel.js';

/**
 * Build the synthetic preview scene rendered in the main viewport while the
 * wizard is open: one centered winseq layer + a single clip playing the
 * selected flow. Returns { scene, total } (total = flow length in seconds).
 */
function buildWinSeqPreviewScene(skeleton, winseqConfig, flowId, durations, projectRoot = null) {
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
  base.stage = { ...base.stage, duration: Math.max(base.stage.duration, total) };
  const track = normalizeTrack({
    id: 'wprev_track', layerId,
    clips: [{ id: 'wprev_clip', start: 0, duration: total, winseq: { sequenceId: flow?.id || null, hangOnLastIdle: false } }]
  });
  base.flow = deriveFlowGraph({ tracks: [track], markers: [], nodes: [], edges: [] });
  base.timelines = [{ ...base.timelines[0], tracks: [track] }];
  return { scene: base, total };
}

const STEPS = ['skeleton', 'sequences'];
const STEP_LABELS = { skeleton: '1. Skeleton', sequences: '2. Sequences' };

const isDirectUrl = (src) => /^(blob:|data:|https?:)/.test(String(src || ''));

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
  embedded = false, onPreviewScene, onPreviewTime,
}) {
  const isEdit = !!existingConfig;
  const [step, setStep] = useState('skeleton');
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
    const named = skeletonPool.find((e) => looksLikeWinSeq(e.label) || looksLikeWinSeq(e.src));
    return named?.id || skeletonPool[0]?.id || null;
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
  const [tiers, setTiers] = useState(existingConfig?.tiers || []);

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
        setAnimNames(names);
        setDurations(durs);
        setTiers(full);
        setLoading(false);
      } catch (e) {
        revoke();
        if (!cancelled) { setLoadError('failed to load skeleton'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntry?.src, rootHandle]);

  const flows = useMemo(() => buildWinSeqFlows(tiers), [tiers]);
  const [previewFlowId, setPreviewFlowId] = useState(null);
  useEffect(() => {
    if (!flows.length) { setPreviewFlowId(null); return; }
    if (!flows.some((f) => f.id === previewFlowId)) setPreviewFlowId(flows[flows.length - 1].id);
  }, [flows, previewFlowId]);
  const previewFlow = flows.find((f) => f.id === previewFlowId) || flows[flows.length - 1] || null;

  // Push the synthetic preview scene to the host viewport (full-focus mode).
  // Rebuilds only when the skeleton / tier set / selected flow / durations
  // change — the transport (WinSeqPreview onTime) drives the clock separately.
  const previewConfig = useMemo(() => {
    const tierList = tiers.map((t) => ({ key: t.key, begin: t.begin, idle: t.idle, end: t.end, enabled: t.enabled }));
    // rev bumps when the tier mapping / enabled set changes so the preview
    // object re-bakes its derived sequences (the viewport otherwise won't
    // rebuild now that ids are stable).
    return { rev: hash32(JSON.stringify(tierList)) || 1, tiers: tierList };
  }, [tiers]);

  useEffect(() => {
    if (!embedded || !onPreviewScene) return;
    if (!selectedEntry || !previewFlow) { onPreviewScene(null); return; }
    const { scene: previewScene } = buildWinSeqPreviewScene(selectedEntry, previewConfig, previewFlow.id, durations, scene?.projectRoot || null);
    onPreviewScene(previewScene);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, selectedEntry?.src, previewConfig, previewFlow?.id, durations]);

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
    };
    const skeleton = { src: selectedEntry.src, atlas: selectedEntry.atlas, texture: selectedEntry.texture };
    onCreate?.({ name: name.trim() || 'Win Sequences', winseqConfig, skeleton });
  }, [flows.length, selectedEntry, existingConfig, tiers, name, onCreate]);

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

          {/* ── Step 2: Sequences + preview ──────────────────────── */}
          {step === 'sequences' && (
            <div className="spinner-wizard-section">
              <div className="scene-field-group-head">
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
            <button type="button" className="scene-btn scene-btn--primary" disabled={!canNext} onClick={() => setStep('sequences')}>
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
