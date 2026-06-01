// InspectorPanel — right panel with properties of the selected layer and,
// when a clip is selected on the timeline, properties of that clip.

import { hasPortraitOverride } from '../engine/orientationManager.js';
import { CURVE_PRESETS, TWEEN_PROPS } from '../engine/sceneModel.js';
import { DragNumberField } from './DragNumberField.jsx';

const BLEND_OPTIONS = ['normal', 'additive', 'screen', 'multiply'];
const CURVES = CURVE_PRESETS;

const PROP_META = {
  x:        { label: 'x',        step: 1,    unit: 'px',  toDisplay: (v) => v,           fromDisplay: (v) => v },
  y:        { label: 'y',        step: 1,    unit: 'px',  toDisplay: (v) => v,           fromDisplay: (v) => v },
  scaleX:   { label: 'scale x',  step: 0.01, unit: '×',   toDisplay: (v) => v,           fromDisplay: (v) => v },
  scaleY:   { label: 'scale y',  step: 0.01, unit: '×',   toDisplay: (v) => v,           fromDisplay: (v) => v },
  rotation: { label: 'rotation', step: 1,    unit: '°',   toDisplay: (v) => (v * 180) / Math.PI, fromDisplay: (v) => (v * Math.PI) / 180 }
};

export function InspectorPanel({
  scene,
  selectedLayerId,
  selectedClip = null,
  assetDescriptors = {},
  onPatchLayer,
  onPatchTransform,
  onResetPortrait,
  onPatchFlow
}) {
  const layer = scene.layers.find((l) => l.id === selectedLayerId);
  const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
  const orientation = scene.stage.activeOrientation;

  if (!layer) {
    return (
      <div className="scene-panel scene-panel--right">
        <div className="scene-panel-head">inspector</div>
        <div className="scene-empty">select a layer to edit</div>
      </div>
    );
  }

  const t = orientation === 'portrait'
    ? (layer.transforms.portrait ?? layer.transforms.landscape)
    : layer.transforms.landscape;

  const inheriting = orientation === 'portrait' && !hasPortraitOverride(layer);

  return (
    <div className="scene-panel scene-panel--right">
      <div className="scene-panel-head">inspector</div>

      <label className="scene-field">
        <span>name</span>
        <input
          type="text"
          value={layer.name}
          onChange={(e) => onPatchLayer(layer.id, { name: e.target.value })}
        />
      </label>

      <label className="scene-field">
        <span>blend</span>
        <select
          value={layer.blend}
          onChange={(e) => onPatchLayer(layer.id, { blend: e.target.value })}
        >
          {BLEND_OPTIONS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </label>

      <div className="scene-field-group">
        <div className="scene-field-group-head">
          transform · {orientation} <span className="scene-pill scene-pill--base">base pose</span>
          {inheriting && <span className="scene-pill">inherits from landscape</span>}
        </div>

        <DragNumberField label="x" value={t.x} step={1}
          onChange={(v) => onPatchTransform(layer.id, { x: v })} />
        <DragNumberField label="y" value={t.y} step={1}
          onChange={(v) => onPatchTransform(layer.id, { y: v })} />
        <DragNumberField label="scale x" value={t.scaleX ?? 1} step={0.01} min={0.01}
          onChange={(v) => onPatchTransform(layer.id, { scaleX: v })} />
        <DragNumberField label="scale y" value={t.scaleY ?? 1} step={0.01} min={0.01}
          onChange={(v) => onPatchTransform(layer.id, { scaleY: v })} />
        <DragNumberField label="rotation" value={(t.rotation * 180) / Math.PI} step={1} suffix="°"
          onChange={(v) => onPatchTransform(layer.id, { rotation: (v * Math.PI) / 180 })} />

        {orientation === 'portrait' && hasPortraitOverride(layer) && (
          <button
            className="scene-btn scene-btn--ghost"
            onClick={() => onResetPortrait(layer.id)}
            title="Discard portrait override; inherit from landscape"
          >
            ↺ reset portrait to landscape
          </button>
        )}
      </div>

      {asset?.type === 'spine' && (
        <SpineSection
          layer={layer}
          descriptor={assetDescriptors[asset.id]}
          onPatchLayer={onPatchLayer}
        />
      )}
      {asset?.type === 'video' && (
        <VideoSection layer={layer} onPatchLayer={onPatchLayer} />
      )}

      {selectedClip && (
        <ClipSection
          scene={scene}
          layer={layer}
          asset={asset}
          basePose={t}
          track={selectedClip.track}
          clip={selectedClip.clip}
          descriptor={asset?.type === 'spine' ? assetDescriptors[asset.id] : null}
          onPatchFlow={onPatchFlow}
        />
      )}
    </div>
  );
}

function SpineSection({ layer, descriptor, onPatchLayer }) {
  const animations = descriptor?.animations || [];
  const skins = descriptor?.skins || [];
  const spine = layer.spine || {};
  const setSpine = (patch) => onPatchLayer(layer.id, { spine: { ...spine, ...patch } });
  return (
    <div className="scene-field-group">
      <div className="scene-field-group-head">spine · defaults</div>
      <label className="scene-field">
        <span>animation</span>
        <select
          value={spine.defaultAnimation ?? ''}
          onChange={(e) => setSpine({ defaultAnimation: e.target.value || null })}
        >
          <option value="">— none (setup pose) —</option>
          {animations.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label className="scene-field scene-field--check">
        <input
          type="checkbox"
          checked={spine.loop !== false}
          onChange={(e) => setSpine({ loop: e.target.checked })}
        />
        <span>loop animation</span>
      </label>
      {skins.length > 1 && (
        <label className="scene-field">
          <span>skin</span>
          <select
            value={spine.skin ?? ''}
            onChange={(e) => setSpine({ skin: e.target.value || null })}
          >
            <option value="">— default —</option>
            {skins.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {!animations.length && (
        <div className="scene-empty" style={{ padding: '8px 12px', fontSize: 10 }}>
          loading spine metadata…
        </div>
      )}
    </div>
  );
}

function VideoSection({ layer, onPatchLayer }) {
  const v = layer.video || {};
  const setVid = (patch) => onPatchLayer(layer.id, { video: { ...v, ...patch } });
  return (
    <div className="scene-field-group">
      <div className="scene-field-group-head">video</div>
      <label className="scene-field scene-field--check">
        <input type="checkbox" checked={v.loop !== false} onChange={(e) => setVid({ loop: e.target.checked })} />
        <span>loop</span>
      </label>
      <label className="scene-field scene-field--check">
        <input type="checkbox" checked={v.muted !== false} onChange={(e) => setVid({ muted: e.target.checked })} />
        <span>muted</span>
      </label>
    </div>
  );
}

/**
 * Clip-scoped editor that appears below the layer section when a clip
 * is selected. PNG clips show a tween editor with per-property from/to
 * + curve override; Spine clips show an animation picker.
 *
 * All mutations go through `onPatchFlow(newFlow)` because clips live on
 * `scene.flow.tracks[].clips[]`.
 */
function ClipSection({ scene, layer, asset, basePose, track, clip, descriptor, onPatchFlow }) {
  const patchClip = (patch) => {
    const nextTracks = (scene.flow?.tracks || []).map((tr) =>
      tr.id === track.id
        ? {
            ...tr,
            clips: tr.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c))
          }
        : tr
    );
    onPatchFlow?.({ ...(scene.flow || {}), tracks: nextTracks });
  };

  const animations = descriptor?.animations || [];
  const isSpine = asset?.type === 'spine';
  const supportsTween = asset?.type === 'png' || asset?.type === 'spine';
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  const mixDuration = Number.isFinite(Number(clip.mixDuration)) ? Number(clip.mixDuration) : null;
  const resolvedAnim = isSpine ? (clip.anim || layer.spine?.defaultAnimation || '') : '';
  const rawAnimDuration = resolvedAnim ? Number(descriptor?.animationDurations?.[resolvedAnim]) : NaN;
  const hasAnimDuration = Number.isFinite(rawAnimDuration) && rawAnimDuration > 0;
  const cycleDuration = hasAnimDuration ? (rawAnimDuration / Math.max(0.01, speed)) : null;

  const setClipAnimation = (nextAnimRaw) => {
    const nextAnim = nextAnimRaw || null;
    const prevResolved = clip.anim || layer.spine?.defaultAnimation || null;
    const nextResolved = nextAnim || layer.spine?.defaultAnimation || null;
    const patch = { anim: nextAnim };
    if ((clip.autoFitDuration || !prevResolved) && nextResolved) {
      const d = Number(descriptor?.animationDurations?.[nextResolved]);
      if (Number.isFinite(d) && d > 0) patch.duration = Math.max(0.05, d / speed);
    }
    patch.autoFitDuration = false;
    if (supportsTween && !clip.tween) {
      const seed = getLayerPoseAtClipStart(scene, layer, clip);
      patch.tween = { from: { ...seed }, to: { ...seed }, curves: {} };
    }
    patchClip(patch);
  };

  return (
    <div className="scene-field-group scene-clip-section">
      <div className="scene-field-group-head">
        clip · {isSpine ? (clip.anim || '(setup pose)') : (clip.tween ? 'tween' : 'static')}
        <span className="scene-pill scene-pill--clip">on {track.layerId === layer.id ? layer.name : '(other layer)'}</span>
      </div>

      <DragNumberField label="start" value={clip.start} step={0.01} min={0}
        onChange={(v) => patchClip({ start: Math.max(0, v) })} />
      <DragNumberField label="duration" value={clip.duration} step={0.01} min={0.05}
        onChange={(v) => patchClip({ duration: Math.max(0.05, v), autoFitDuration: false })} />

      <DragNumberField label="speed" value={speed} step={0.01} min={0.01}
        onChange={(v) => patchClip({ speed: Math.max(0.01, v) })} />

      {isSpine && (
        <label className="scene-field">
          <span>mix (s)</span>
          <input
            type="number"
            step={0.01}
            min={0}
            placeholder="auto"
            value={mixDuration == null ? '' : Number(mixDuration.toFixed(3))}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') { patchClip({ mixDuration: null }); return; }
              const n = Number(raw);
              if (Number.isFinite(n) && n >= 0) patchClip({ mixDuration: n });
            }}
          />
        </label>
      )}

      <label className="scene-field scene-field--check">
        <input
          type="checkbox"
          checked={clip.loop !== false}
          onChange={(e) => patchClip({ loop: e.target.checked })}
        />
        <span>loop</span>
      </label>

      {supportsTween && (
        <PngTweenEditor
          clip={clip}
          basePose={basePose}
          layerPoseSeed={getLayerPoseAtClipStart(scene, layer, clip)}
          onPatchClip={patchClip}
        />
      )}

      <label className="scene-field">
        <span>curve</span>
        <select
          value={clip.curve || 'linear'}
          onChange={(e) => patchClip({ curve: e.target.value })}
        >
          {CURVES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      {isSpine ? (
        <>
          <label className="scene-field">
            <span>animation</span>
            <select
              value={clip.anim ?? ''}
              onChange={(e) => setClipAnimation(e.target.value)}
            >
              <option value="">— layer default —</option>
              {animations.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {hasAnimDuration ? (
            <div className="scene-clip-anim-meta">
              <span className="scene-clip-anim-meta-text">
                anim: {Number(rawAnimDuration.toFixed(3))}s · cycle @ speed: {Number(cycleDuration.toFixed(3))}s
              </span>
              <button
                className="scene-btn scene-btn--ghost"
                onClick={() => patchClip({ duration: Math.max(0.05, cycleDuration), autoFitDuration: false })}
                title="Set clip duration to one animation cycle at current speed"
              >
                set duration = 1 cycle
              </button>
            </div>
          ) : (
            <div className="scene-empty" style={{ padding: '6px 12px', fontSize: 10 }}>
              animation duration unavailable — run the scene once so Spine metadata can load
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * PNG tween editor. Renders a chip per tweenable property; toggling the
 * chip ON seeds from/to with the layer's current base value, OFF strips
 * that property from the tween. When all chips are OFF, the tween
 * payload is removed entirely (back to "static" clip).
 */
function PngTweenEditor({ clip, basePose, layerPoseSeed, onPatchClip }) {
  const tween = clip.tween || null;
  const seedPose = layerPoseSeed || basePose || {};
  const defaultEndpointMode = clip.endpointMode || 'to';
  const enabledProps = new Set(
    TWEEN_PROPS.filter((p) =>
      tween && (tween.from?.[p] !== undefined || tween.to?.[p] !== undefined)
    )
  );

  const toggleProp = (prop) => {
    const nextFrom = { ...(tween?.from || {}) };
    const nextTo = { ...(tween?.to || {}) };
    const nextCurves = { ...(tween?.curves || {}) };
    if (enabledProps.has(prop)) {
      delete nextFrom[prop];
      delete nextTo[prop];
      delete nextCurves[prop];
    } else {
      const seed = seedPose?.[prop] ?? 0;
      nextFrom[prop] = seed;
      nextTo[prop] = seed;
    }
    const anyEnabled = Object.keys(nextFrom).length || Object.keys(nextTo).length;
    onPatchClip({
      tween: anyEnabled
        ? { from: nextFrom, to: nextTo, curves: nextCurves }
        : null
    });
  };

  const setEndpoint = (side, prop, value) => {
    const base = seedPose?.[prop] ?? 0;
    const nextFrom = { ...(tween?.from || {}) };
    const nextTo = { ...(tween?.to || {}) };
    const nextCurves = { ...(tween?.curves || {}) };
    if (side === 'from') nextFrom[prop] = value;
    if (side === 'to') nextTo[prop] = value;
    // Ensure both endpoints exist for an enabled prop so the lerp
    // doesn't silently default to base on one side and the user's
    // explicit value on the other.
    if (nextFrom[prop] === undefined && nextTo[prop] !== undefined) nextFrom[prop] = base;
    if (nextTo[prop] === undefined && nextFrom[prop] !== undefined) nextTo[prop] = base;
    onPatchClip({ tween: { from: nextFrom, to: nextTo, curves: nextCurves } });
  };

  const setPropCurve = (prop, curve) => {
    const nextCurves = { ...(tween?.curves || {}) };
    if (curve === '') delete nextCurves[prop];
    else nextCurves[prop] = curve;
    onPatchClip({
      tween: {
        from: tween?.from || {},
        to: tween?.to || {},
        curves: nextCurves
      }
    });
  };

  const snapEndpoint = (side, prop) => {
    const base = seedPose?.[prop] ?? 0;
    setEndpoint(side, prop, base);
  };

  const setEndpointMode = (mode) => {
    const nextMode = mode === 'from' ? 'from' : 'to';
    const nextFrom = { ...(tween?.from || {}) };
    const nextTo = { ...(tween?.to || {}) };
    const nextCurves = { ...(tween?.curves || {}) };
    for (const p of TWEEN_PROPS) {
      const seed = seedPose?.[p] ?? 0;
      if (nextFrom[p] == null) nextFrom[p] = seed;
      if (nextTo[p] == null) nextTo[p] = seed;
    }
    onPatchClip({ tween: { from: nextFrom, to: nextTo, curves: nextCurves }, endpointMode: nextMode });
  };

  return (
    <div className="scene-tween-editor">
      <div className="scene-tween-chips">
        <span className="scene-field-group-sub">animate:</span>
        {TWEEN_PROPS.map((p) => (
          <button
            key={p}
            type="button"
            className={'scene-chip' + (enabledProps.has(p) ? ' on' : '')}
            onClick={() => toggleProp(p)}
            title={enabledProps.has(p) ? `Stop animating ${p}` : `Animate ${p} (initialised from base pose)`}
          >
            {PROP_META[p].label}
          </button>
        ))}
      </div>

      <div className="scene-endpoint-mode-row">
        <span className="scene-field-group-sub">edit endpoint:</span>
        <button
          type="button"
          className={'scene-chip' + (defaultEndpointMode === 'from' ? ' on' : '')}
          onClick={() => setEndpointMode('from')}
        >
          from
        </button>
        <button
          type="button"
          className={'scene-chip' + (defaultEndpointMode === 'to' ? ' on' : '')}
          onClick={() => setEndpointMode('to')}
        >
          to
        </button>
      </div>

      <CurvePreview curve={clip.curve || 'linear'} />

      {enabledProps.size === 0 ? (
        <div className="scene-empty" style={{ padding: '8px 0', fontSize: 10 }}>
          toggle a property above to animate it from / to a value during this clip
        </div>
      ) : (
        TWEEN_PROPS.filter((p) => enabledProps.has(p)).map((p) => (
          <TweenPropRow
            key={p}
            prop={p}
            tween={tween}
            basePose={seedPose}
            onSetEndpoint={setEndpoint}
            onSetPropCurve={setPropCurve}
            onSnapEndpoint={snapEndpoint}
          />
        ))
      )}
    </div>
  );
}

function TweenPropRow({ prop, tween, basePose, onSetEndpoint, onSetPropCurve, onSnapEndpoint }) {
  const meta = PROP_META[prop];
  const fromRaw = tween?.from?.[prop] ?? basePose?.[prop] ?? 0;
  const toRaw = tween?.to?.[prop] ?? basePose?.[prop] ?? 0;
  const propCurve = tween?.curves?.[prop] || '';
  return (
    <div className="scene-tween-row">
      <div className="scene-tween-row-head">
        <span className="scene-tween-row-label">{meta.label}</span>
        <select
          className="scene-tween-curve"
          value={propCurve}
          onChange={(e) => onSetPropCurve(prop, e.target.value)}
          title="Per-property curve (empty = inherit master curve)"
        >
          <option value="">(master)</option>
          {CURVES.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="custom">custom…</option>
        </select>
      </div>
      <div className="scene-tween-pair">
        <DragNumberField
          label="from"
          value={meta.toDisplay(fromRaw)}
          step={meta.step}
          suffix={meta.unit === '°' ? '°' : undefined}
          onChange={(v) => onSetEndpoint('from', prop, meta.fromDisplay(v))}
        />
        <button
          className="scene-icon-btn scene-tween-snap"
          title={`Snap "from" to current base pose ${meta.label}`}
          onClick={() => onSnapEndpoint('from', prop)}
        >
          ⟲
        </button>
        <DragNumberField
          label="to"
          value={meta.toDisplay(toRaw)}
          step={meta.step}
          suffix={meta.unit === '°' ? '°' : undefined}
          onChange={(v) => onSetEndpoint('to', prop, meta.fromDisplay(v))}
        />
        <button
          className="scene-icon-btn scene-tween-snap"
          title={`Snap "to" to current base pose ${meta.label}`}
          onClick={() => onSnapEndpoint('to', prop)}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}

function CurvePreview({ curve }) {
  const path = buildCurvePath(curve);
  return (
    <div className="scene-curve-preview-wrap">
      <svg className="scene-curve-preview" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Curve preview">
        <polyline points="0,60 100,0" className="scene-curve-guide" />
        <path d={path} className="scene-curve-path" />
      </svg>
    </div>
  );
}

function buildCurvePath(curve) {
  const steps = 28;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    const y = evalCurvePreview(curve, x);
    const px = x * 100;
    const py = 60 - y * 60;
    d += (i === 0 ? 'M' : ' L') + `${px.toFixed(2)} ${py.toFixed(2)}`;
  }
  return d;
}

function evalCurvePreview(curve, p) {
  const x = Math.max(0, Math.min(1, p));
  if (curve && typeof curve === 'object' && String(curve.type || '').toLowerCase() === 'custom') {
    const pts = Array.isArray(curve.points) ? curve.points : [];
    if (pts.length < 2) return x;
    const sorted = pts
      .map((pt) => ({ x: Number(pt?.x), y: Number(pt?.y) }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .sort((a, b) => a.x - b.x);
    if (sorted.length < 2) return x;
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (x > b.x) continue;
      const dx = b.x - a.x;
      if (dx <= 0.000001) return b.y;
      const t = (x - a.x) / dx;
      return a.y + (b.y - a.y) * t;
    }
    return x;
  }
  if (curve === 'easeIn') return x * x;
  if (curve === 'easeOut') return 1 - (1 - x) * (1 - x);
  if (curve === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  if (curve === 'smoothstep') return x * x * (3 - 2 * x);
  if (curve === 'backIn') return x * x * (2.70158 * x - 1.70158);
  if (curve === 'backOut') {
    const t = x - 1;
    return 1 + t * t * (2.70158 * t + 1.70158);
  }
  if (curve === 'overshoot') {
    const t = x - 1;
    return 1 + t * t * (3.3 * t + 2.3);
  }
  if (curve === 'stepStart') return x <= 0 ? 0 : 1;
  if (curve === 'stepEnd') return x < 1 ? 0 : 1;
  return x;
}

function getLayerPoseAtClipStart(scene, layer, clip) {
  const base = scene.stage.activeOrientation === 'portrait'
    ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
    : layer.transforms?.landscape;
  const pose = {
    x: Number(base?.x) || 0,
    y: Number(base?.y) || 0,
    scaleX: Number(base?.scaleX ?? 1),
    scaleY: Number(base?.scaleY ?? 1),
    rotation: Number(base?.rotation || 0)
  };
  const tracks = (scene.flow?.tracks || []).filter((t) => t.layerId === layer.id);
  for (const track of tracks) {
    const active = (track.clips || []).find((c) => clip.start >= c.start && clip.start < c.start + c.duration);
    if (!active?.tween) continue;
    const progress = computeClipProgressLocal(active, clip.start);
    for (const prop of TWEEN_PROPS) {
      const from = active.tween.from?.[prop] ?? pose[prop];
      const to = active.tween.to?.[prop] ?? pose[prop];
      if (typeof from !== 'number' || typeof to !== 'number') continue;
      const c = active.tween.curves?.[prop] ?? active.curve ?? 'linear';
      const eased = evalCurvePreview(c, progress);
      pose[prop] = from + (to - from) * eased;
    }
  }
  return pose;
}

function computeClipProgressLocal(clip, t) {
  const dur = Math.max(0.001, Number(clip.duration) || 0);
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  let local = Math.max(0, t - clip.start) * speed;
  if (clip.loop) local = local % dur;
  else local = Math.min(local, dur);
  return local / dur;
}
