// InspectorPanel — right panel with properties of the selected layer and,
// when a clip is selected on the timeline, properties of that clip.

import { useEffect, useMemo, useRef, useState } from 'react';
import { hasPortraitOverride } from '../engine/orientationManager.js';
import { CURVE_PRESETS } from '../engine/sceneModel.js';
import {
  CHANNEL_DEFS,
  CHANNEL_NAMES,
  channelLayout,
  evalChannel,
  insertOrUpdateKey,
  moveKeyTime,
  removeKey as removeChannelKey,
  setKeyComponent,
  setKeyOut,
  setKeyValue
} from '../engine/animation/keyframes.js';
import { ClipGraphEditor } from './ClipGraphEditor.jsx';
import { CurveEditor, CurveThumbnail } from './CurveEditor.jsx';
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

const CHANNEL_LABEL = {
  position: 'position (x, y)',
  scale:    'scale (x, y)',
  rotation: 'rotation',
  alpha:    'alpha',
  tint:     'tint (r, g, b)'
};

/** Map a sprite transform prop name → logical channel name. */
const PROP_TO_CHANNEL = {
  x: 'position',
  y: 'position',
  scaleX: 'scale',
  scaleY: 'scale',
  rotation: 'rotation',
  alpha: 'alpha',
  tint: 'tint'
};

function tintToHex(tint) {
  const r = Math.max(0, Math.min(255, Math.round((tint?.r ?? 1) * 255)));
  const g = Math.max(0, Math.min(255, Math.round((tint?.g ?? 1) * 255)));
  const b = Math.max(0, Math.min(255, Math.round((tint?.b ?? 1) * 255)));
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
function hexToTint(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 1, g: 1, b: 1 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function InspectorPanel({
  scene,
  selectedLayerId,
  selectedClip = null,
  assetDescriptors = {},
  flowTime = 0,
  selectedKey = null,
  onSelectKey,
  onDeleteKey,
  onMoveKeyByFrame,
  onPatchLayer,
  onPatchTransform,
  onResetPortrait,
  onPatchFlow,
  onFlowAction
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

  // When a clip is selected on THIS layer and the playhead is inside that
  // clip, transform-field edits below auto-key onto the clip's channels
  // instead of patching the base pose. The same channels that decorate the
  // inspector fields with a diamond also indicate that the field is in
  // recording mode.
  const recordingClip = (() => {
    if (!selectedClip) return null;
    if (selectedClip.track?.layerId !== layer.id) return null;
    const c = selectedClip.clip;
    if (!c) return null;
    if (flowTime >= c.start && flowTime < c.start + c.duration) return c;
    return null;
  })();
  const recordingChannels = recordingClip?.channels || null;

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
          transform · {orientation}
          {recordingClip ? (
            <span className="scene-pill scene-pill--rec" title="Recording — edits land as keyframes on the selected clip">
              ● rec @ {(flowTime - recordingClip.start).toFixed(2)}s
            </span>
          ) : (
            <span className="scene-pill scene-pill--base">base pose</span>
          )}
          {inheriting && <span className="scene-pill">inherits from landscape</span>}
        </div>

        <TransformField
          label="x" prop="x" value={t.x} step={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.position}
          onChange={(v) => onPatchTransform(layer.id, { x: v })}
        />
        <TransformField
          label="y" prop="y" value={t.y} step={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.position}
          onChange={(v) => onPatchTransform(layer.id, { y: v })}
        />
        <TransformField
          label="scale x" prop="scaleX" value={t.scaleX ?? 1} step={0.01} min={0.01}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.scale}
          onChange={(v) => onPatchTransform(layer.id, { scaleX: v })}
        />
        <TransformField
          label="scale y" prop="scaleY" value={t.scaleY ?? 1} step={0.01} min={0.01}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.scale}
          onChange={(v) => onPatchTransform(layer.id, { scaleY: v })}
        />
        <TransformField
          label="rotation" prop="rotation"
          value={(t.rotation * 180) / Math.PI} step={1} suffix="°"
          recording={!!recordingClip} hasChannel={!!recordingChannels?.rotation}
          onChange={(v) => onPatchTransform(layer.id, { rotation: (v * Math.PI) / 180 })}
        />

        <TransformField
          label="alpha" prop="alpha"
          value={typeof t.alpha === 'number' ? t.alpha : 1}
          step={0.01} min={0} max={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.alpha}
          onChange={(v) => onPatchTransform(layer.id, { alpha: Math.max(0, Math.min(1, v)) })}
        />

        <ColorField
          label="tint"
          value={t.tint || { r: 1, g: 1, b: 1 }}
          recording={!!recordingClip}
          hasChannel={!!recordingChannels?.tint}
          onChange={(rgb) => onPatchTransform(layer.id, { tint: rgb })}
        />

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
          flowTime={flowTime}
          selectedKey={selectedKey}
          onSelectKey={onSelectKey}
          descriptor={asset?.type === 'spine' ? assetDescriptors[asset.id] : null}
          onPatchFlow={onPatchFlow}
          onFlowAction={onFlowAction}
        />
      )}
    </div>
  );
}

/**
 * Thin wrapper over DragNumberField that shows a small diamond next to
 * the label when the selected clip has a channel for this property
 * (= editing here writes a keyframe instead of the base pose).
 */
function TransformField({ label, prop, value, step, min, max, suffix, recording, hasChannel, onChange }) {
  const indicator = hasChannel ? '◆' : (recording ? '◇' : null);
  return (
    <div className="scene-field-row-wrap">
      <DragNumberField label={label} value={value} step={step} min={min} max={max} suffix={suffix} onChange={onChange} />
      {indicator && (
        <span
          className={'scene-kf-indicator' + (hasChannel ? ' is-keyed' : '')}
          title={hasChannel
            ? `${prop} is keyframed on this clip — next edit updates a key at the playhead`
            : `${prop} is not keyframed yet — next edit creates a key on this clip at the playhead`}
        >
          {indicator}
        </span>
      )}
    </div>
  );
}

/**
 * Color picker variant that emits `{ r, g, b }` 0..1 floats. Reuses the
 * keyframe diamond indicator so artists see whether tint is currently
 * keyframed on the active clip.
 */
function ColorField({ label, value, recording, hasChannel, onChange }) {
  const hex = tintToHex(value);
  const indicator = hasChannel ? '◆' : (recording ? '◇' : null);
  return (
    <div className="scene-field-row-wrap">
      <label className="scene-field scene-field--inline scene-field--color">
        <span className="scene-field-scrub-handle" title="Pick a tint colour">{label}</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(hexToTint(e.target.value))}
        />
        <em className="scene-field-suffix">{hex.toUpperCase()}</em>
      </label>
      {indicator && (
        <span
          className={'scene-kf-indicator' + (hasChannel ? ' is-keyed' : '')}
          title={hasChannel
            ? 'tint is keyframed on this clip — next colour change updates a key at the playhead'
            : 'tint is not keyframed yet — next colour change creates a key on this clip at the playhead'}
        >
          {indicator}
        </span>
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
 * Clip-scoped editor that appears below the layer section when a clip is
 * selected.
 *
 * - Spine clips: animation picker + a master time-remap curve.
 * - PNG / pngSequence clips: per-property keyframe channels (auto-key
 *   from the layer transform fields above; explicit key management here).
 *
 * All mutations go through `onPatchFlow(newFlow)` because clips live on
 * `scene.flow.tracks[].clips[]`.
 */
function ClipSection({ scene, layer, asset, basePose, track, clip, flowTime, selectedKey, onSelectKey, descriptor, onPatchFlow, onFlowAction }) {
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
  const supportsChannels = asset?.type === 'png' || asset?.type === 'pngSequence';
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
    patchClip(patch);
  };

  // What to render in the clip header — gives users a fast hint at what
  // the clip does without opening the channels block.
  const animatedChannels = supportsChannels
    ? CHANNEL_NAMES.filter((n) => clip.channels?.[n]?.keys?.length)
    : [];
  const headerLabel = isSpine
    ? (clip.anim || '(setup pose)')
    : (animatedChannels.length ? animatedChannels.join(' · ') : 'static');

  return (
    <div className="scene-field-group scene-clip-section">
      <div className="scene-field-group-head">
        clip · {headerLabel}
        <span className="scene-pill scene-pill--clip">on {track.layerId === layer.id ? layer.name : '(other layer)'}</span>
      </div>

      <label className="scene-field">
        <span>name</span>
        <input
          type="text"
          value={clip.name || ''}
          placeholder="(auto)"
          onChange={(e) => patchClip({ name: e.target.value || null })}
        />
      </label>

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

      {isSpine && (
        <label className="scene-field">
          <span>time curve</span>
          <select
            value={clip.curve || 'linear'}
            onChange={(e) => patchClip({ curve: e.target.value })}
            title="Master time-remap curve for the Spine animation track time"
          >
            {CURVES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}

      {supportsChannels && (
        <PngChannelEditor
          clip={clip}
          basePose={basePose}
          flowTime={flowTime}
          onPatchClip={patchClip}
          selectedKey={selectedKey}
          onSelectKey={onSelectKey}
          onFlowAction={onFlowAction}
        />
      )}

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
 * PNG keyframe-channel editor. Replaces the old 2-endpoint tween editor.
 *
 * - Animate chips default OFF. Enabling a chip seeds a 2-key channel
 *   (t=0 + t=playhead) initialised from the layer's current base pose
 *   so the user can immediately drag the sprite to set the destination.
 * - Each channel renders a keys table (`t / v / out / ×`). Numeric
 *   cells are drag-number inputs. The `out` cell is a clickable curve
 *   thumbnail — clicking it opens an inline bezier editor below the
 *   table for that segment.
 * - Auto-key writes (from viewport drags or transform-field edits)
 *   land here via SceneStudioInner's `onPatchTransform` decision logic.
 */
function PngChannelEditor({ clip, basePose, flowTime, onPatchClip, selectedKey: externalKey = null, onSelectKey: externalOnSelectKey = null, onFlowAction = null }) {
  const channels = clip.channels || {};
  // A channel counts as "enabled" if it has linked keys OR any split
  // sub-list has keys. Split channels store `perComp.x.keys` etc., not
  // `keys` on the root, so we have to check both shapes.
  const enabled = useMemo(() => new Set(Object.keys(channels).filter((n) => {
    const ch = channels[n];
    if (ch?.keys?.length) return true;
    if (ch?.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length)) return true;
    return false;
  })), [channels]);

  // Derive local key selection from external global state (filtered to this clip).
  // Falls back to local state when external is not provided (standalone use).
  const [localKey, setLocalKey] = useState(null);
  const selectedKey = externalKey?.clipId === clip.id
    ? { name: externalKey.name, idx: externalKey.idx, comp: externalKey.comp ?? null }
    : localKey;

  const setSelectedKey = (keyOrNull) => {
    setLocalKey(keyOrNull);
    if (keyOrNull) {
      externalOnSelectKey?.({ clipId: clip.id, name: keyOrNull.name, idx: keyOrNull.idx, comp: keyOrNull.comp ?? null });
      // Seek the playhead to the clicked key's absolute time.
      const ch = channels[keyOrNull.name];
      const sub = (ch?.split && keyOrNull.comp) ? ch.perComp?.[keyOrNull.comp] : ch;
      const keyT = sub?.keys?.[keyOrNull.idx]?.t;
      if (typeof keyT === 'number') onFlowAction?.('seek', clip.start + keyT);
    } else {
      externalOnSelectKey?.(null);
    }
  };

  // Scroll the curve editor into view whenever the selected key changes.
  const curveRef = useRef(null);
  useEffect(() => {
    if (!selectedKey || !curveRef.current) return;
    curveRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedKey?.name, selectedKey?.idx, selectedKey?.comp]);

  const [viewMode, setViewMode] = useState('graph');  // 'graph' | 'list'

  // Where the playhead currently sits, in clip-local seconds. Used as
  // the time for the second seed key and for "add key at playhead".
  const localT = Math.max(0, Math.min(clip.duration, flowTime - clip.start));

  const writeChannels = (next) => {
    onPatchClip({ channels: Object.keys(next).length ? next : null });
  };

  const patchChannel = (name, channel) => {
    const next = { ...channels };
    const linkedAlive = channel?.keys?.length;
    const splitAlive = channel?.split && channel.perComp
      && Object.values(channel.perComp).some((c) => c?.keys?.length);
    if (linkedAlive || splitAlive) next[name] = channel;
    else delete next[name];
    writeChannels(next);
    if (selectedKey?.name === name) {
      const targetKeys = (channel?.split && selectedKey.comp)
        ? (channel.perComp?.[selectedKey.comp]?.keys || [])
        : (channel?.keys || []);
      if (selectedKey.idx >= targetKeys.length) setSelectedKey(null);
    }
  };

  const seedValueForChannel = (name) => {
    if (name === 'position') return { x: basePose?.x ?? 0, y: basePose?.y ?? 0 };
    if (name === 'scale')    return { x: basePose?.scaleX ?? 1, y: basePose?.scaleY ?? 1 };
    if (name === 'rotation') return basePose?.rotation ?? 0;
    if (name === 'alpha')    return typeof basePose?.alpha === 'number' ? basePose.alpha : 1;
    if (name === 'tint')     return basePose?.tint || { r: 1, g: 1, b: 1 };
    return 0;
  };

  const toggleChannel = (name) => {
    if (enabled.has(name)) {
      patchChannel(name, null);
      return;
    }
    const seed = seedValueForChannel(name);
    const keys = [{ t: 0, v: seed, out: 'linear' }];
    if (localT > 0.001 && localT < clip.duration - 0.001) {
      keys.push({ t: localT, v: seed, out: 'linear' });
    } else {
      keys.push({ t: clip.duration, v: seed, out: 'linear' });
    }
    patchChannel(name, { keys });
  };

  const patchKeyAt = (name, idx, patch, comp = null) => {
    const ch = channels[name];
    if (!ch) return;
    // Split channel: operate on the per-comp scalar key list instead of
    // ch.keys. Component must be provided by the caller (selectedKey.comp).
    if (ch.split && comp) {
      const subKeys = ch.perComp?.[comp]?.keys || [];
      let nextSub = { keys: subKeys };
      if ('v' in patch) nextSub = setKeyValue(nextSub, idx, patch.v);
      if ('t' in patch) nextSub = moveKeyTime(nextSub, idx, patch.t);
      if ('out' in patch) nextSub = setKeyOut(nextSub, idx, patch.out);
      patchChannel(name, {
        ...ch,
        perComp: { ...(ch.perComp || {}), [comp]: { keys: nextSub.keys } }
      });
      return;
    }
    let next = ch;
    if ('v' in patch) next = setKeyValue(next, idx, patch.v);
    if ('component' in patch) next = setKeyComponent(next, idx, patch.component, patch.componentValue);
    if ('t' in patch) next = moveKeyTime(next, idx, patch.t);
    if ('out' in patch) next = setKeyOut(next, idx, patch.out);
    patchChannel(name, next);
  };

  const deleteKey = (name, idx) => {
    const ch = channels[name];
    if (!ch) return;
    const next = removeChannelKey(ch, idx);
    patchChannel(name, next.keys.length ? next : null);
  };

  const addKeyAtPlayhead = (name) => {
    const ch = channels[name] || { keys: [] };
    const currentV = ch.keys.length ? evalChannel(ch, localT) : seedValueForChannel(name);
    const next = insertOrUpdateKey(ch, localT, currentV, { out: 'linear' });
    patchChannel(name, next);
  };

  return (
    <div className="scene-channels-editor">
      <div className="scene-tween-chips">
        <span className="scene-field-group-sub">animate:</span>
        {CHANNEL_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={'scene-chip' + (enabled.has(name) ? ' on' : '')}
            onClick={() => toggleChannel(name)}
            title={enabled.has(name)
              ? `Stop animating ${name} (deletes all of its keys)`
              : `Animate ${name}. Once enabled, scrub the timeline + drag the sprite (or edit transform fields) and the keyframe records automatically.`}
          >
            {CHANNEL_LABEL[name] || name}
          </button>
        ))}
      </div>

      {!enabled.size && (
        <div className="scene-empty" style={{ padding: '8px 0', fontSize: 10 }}>
          enable a channel above. once enabled, scrub the timeline and
          drag the sprite (or edit transform fields) — keyframes record
          automatically at the playhead.
        </div>
      )}

      {enabled.size > 0 && (
        <div className="scene-channels-viewtoggle">
          <button
            type="button"
            className={'scene-chip scene-chip--xs' + (viewMode === 'graph' ? ' on' : '')}
            onClick={() => setViewMode('graph')}
            title="Show every channel's keys on one absolute-value graph"
          >
            graph view
          </button>
          <button
            type="button"
            className={'scene-chip scene-chip--xs' + (viewMode === 'list' ? ' on' : '')}
            onClick={() => setViewMode('list')}
            title="Show per-channel keys tables (good for typing exact values)"
          >
            list view
          </button>
        </div>
      )}

      {viewMode === 'graph' && enabled.size > 0 && (
        <ClipGraphEditor
          clip={clip}
          flowTime={flowTime}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          onPatchChannel={patchChannel}
          curveRef={curveRef}
        />
      )}

      {viewMode === 'list' && [...enabled].map((name) => (
        <ChannelBlock
          key={name}
          name={name}
          channel={channels[name]}
          clipDuration={clip.duration}
          localT={localT}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          onPatchKeyAt={patchKeyAt}
          onDeleteKey={deleteKey}
          onAddKeyAtPlayhead={addKeyAtPlayhead}
          curveRef={curveRef}
        />
      ))}

    </div>
  );
}

function ChannelBlock({ name, channel, clipDuration, localT, selectedKey, onSelectKey, onPatchKeyAt, onDeleteKey, onAddKeyAtPlayhead, curveRef }) {
  // Split channels are intentionally graph-view-only — the per-component
  // tables would crowd the inspector. Show a small hint instead.
  if (channel?.split) {
    return (
      <div className="scene-channel-block">
        <div className="scene-channel-head">
          <span className="scene-channel-label">{name}</span>
          <span className="scene-channel-meta">split — edit in graph view</span>
        </div>
      </div>
    );
  }
  const keys = channel?.keys || [];
  const layout = channelLayout(name);
  const isVec2 = layout === 'vec2';
  const isRgb = layout === 'rgb';
  const isRotation = name === 'rotation';
  const isAlpha = name === 'alpha';
  return (
    <div className="scene-channel-block">
      <div className="scene-channel-head">
        <span className="scene-channel-label">{CHANNEL_LABEL[name] || name}</span>
        <span className="scene-channel-meta">{keys.length} key{keys.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          className="scene-btn scene-btn--ghost scene-btn--sm"
          onClick={() => onAddKeyAtPlayhead(name)}
          title={`Add a key for ${name} at the playhead (${localT.toFixed(2)}s)`}
        >
          + key @ {localT.toFixed(2)}s
        </button>
      </div>
      <table className="scene-channel-keys">
        <thead>
          <tr>
            <th>t (s)</th>
            {isVec2 ? (
              <>
                <th>x</th>
                <th>y</th>
              </>
            ) : isRgb ? (
              <th colSpan={3}>tint</th>
            ) : (
              <th>{isRotation ? 'deg' : (isAlpha ? 'alpha' : 'value')}</th>
            )}
            <th>out →</th>
            <th aria-label="delete" />
          </tr>
        </thead>
        <tbody>
          {keys.map((k, i) => {
            const isLast = i === keys.length - 1;
            const isSelected = selectedKey?.name === name && selectedKey.idx === i;
            const showCurve = isSelected && !isLast;
            return (
              <tr key={i} className={'scene-channel-row' + (isSelected ? ' selected' : '')}>
                <td>
                  <DragNumberField
                    label=""
                    value={Number(k.t.toFixed(3))}
                    step={0.01}
                    min={0}
                    max={clipDuration}
                    onChange={(v) => onPatchKeyAt(name, i, { t: Math.max(0, Math.min(clipDuration, v)) })}
                  />
                </td>
                {isVec2 ? (
                  <>
                    <td>
                      <DragNumberField
                        label=""
                        value={Number((k.v?.x ?? 0).toFixed(3))}
                        step={name === 'scale' ? 0.01 : 1}
                        onChange={(v) => onPatchKeyAt(name, i, { component: 'x', componentValue: v })}
                      />
                    </td>
                    <td>
                      <DragNumberField
                        label=""
                        value={Number((k.v?.y ?? 0).toFixed(3))}
                        step={name === 'scale' ? 0.01 : 1}
                        onChange={(v) => onPatchKeyAt(name, i, { component: 'y', componentValue: v })}
                      />
                    </td>
                  </>
                ) : isRgb ? (
                  <td colSpan={3}>
                    <input
                      type="color"
                      value={tintToHex(k.v)}
                      onChange={(e) => onPatchKeyAt(name, i, { v: hexToTint(e.target.value) })}
                      className="scene-channel-color"
                      title={`rgb(${Math.round((k.v?.r ?? 1) * 255)}, ${Math.round((k.v?.g ?? 1) * 255)}, ${Math.round((k.v?.b ?? 1) * 255)})`}
                    />
                  </td>
                ) : (
                  <td>
                    {isRotation ? (
                      <DragNumberField
                        label=""
                        value={Number(((k.v * 180) / Math.PI).toFixed(2))}
                        step={1}
                        suffix="°"
                        onChange={(v) => onPatchKeyAt(name, i, { v: (v * Math.PI) / 180 })}
                      />
                    ) : isAlpha ? (
                      <DragNumberField
                        label=""
                        value={Number(k.v.toFixed(3))}
                        step={0.01}
                        min={0}
                        max={1}
                        onChange={(v) => onPatchKeyAt(name, i, { v: Math.max(0, Math.min(1, v)) })}
                      />
                    ) : (
                      <DragNumberField
                        label=""
                        value={Number(k.v.toFixed(3))}
                        step={1}
                        onChange={(v) => onPatchKeyAt(name, i, { v })}
                      />
                    )}
                  </td>
                )}
                <td>
                  {isLast ? (
                    <span className="scene-channel-out-last">—</span>
                  ) : (
                    <button
                      type="button"
                      className={'scene-channel-out-btn' + (isSelected ? ' is-active' : '')}
                      onClick={() => onSelectKey(isSelected ? null : { name, idx: i })}
                      title="Click to edit the curve from this key to the next"
                    >
                      <CurveThumbnail value={k.out || 'linear'} size={26} />
                    </button>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="scene-icon-btn"
                    onClick={() => onDeleteKey(name, i)}
                    title="Delete this key"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Inline CurveEditor — appears directly below the selected row */}
      {selectedKey?.name === name && !((selectedKey.idx ?? -1) >= keys.length - 1) && (() => {
        const idx = selectedKey.idx;
        if (idx == null || idx >= keys.length - 1) return null;
        return (
          <div ref={curveRef} className="scene-channel-curve scene-channel-curve--inline">
            <div className="scene-channel-curve-head">
              <span>{name} · curve key {idx + 1} → {idx + 2}</span>
              <button
                type="button"
                className="scene-icon-btn"
                onClick={() => onSelectKey(null)}
                title="Close curve editor"
              >
                ✕
              </button>
            </div>
            <CurveEditor
              value={keys[idx].out || 'linear'}
              onChange={(spec) => onPatchKeyAt(name, idx, { out: spec })}
            />
          </div>
        );
      })()}
    </div>
  );
}
