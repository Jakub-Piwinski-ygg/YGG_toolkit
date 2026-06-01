// InspectorPanel — right panel with properties of the selected layer and,
// when a clip is selected on the timeline, properties of that clip.

import { useMemo, useState } from 'react';
import { hasPortraitOverride } from '../engine/orientationManager.js';
import { CURVE_PRESETS } from '../engine/sceneModel.js';
import {
  CHANNEL_PROPS,
  clipLocalSeconds,
  evalChannel,
  insertOrUpdateKey,
  moveKeyTime,
  removeKey as removeChannelKey,
  setKeyOut,
  setKeyValue
} from '../engine/animation/keyframes.js';
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

export function InspectorPanel({
  scene,
  selectedLayerId,
  selectedClip = null,
  assetDescriptors = {},
  flowTime = 0,
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
          recording={!!recordingClip} hasChannel={!!recordingChannels?.x}
          onChange={(v) => onPatchTransform(layer.id, { x: v })}
        />
        <TransformField
          label="y" prop="y" value={t.y} step={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.y}
          onChange={(v) => onPatchTransform(layer.id, { y: v })}
        />
        <TransformField
          label="scale x" prop="scaleX" value={t.scaleX ?? 1} step={0.01} min={0.01}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.scaleX}
          onChange={(v) => onPatchTransform(layer.id, { scaleX: v })}
        />
        <TransformField
          label="scale y" prop="scaleY" value={t.scaleY ?? 1} step={0.01} min={0.01}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.scaleY}
          onChange={(v) => onPatchTransform(layer.id, { scaleY: v })}
        />
        <TransformField
          label="rotation" prop="rotation"
          value={(t.rotation * 180) / Math.PI} step={1} suffix="°"
          recording={!!recordingClip} hasChannel={!!recordingChannels?.rotation}
          onChange={(v) => onPatchTransform(layer.id, { rotation: (v * Math.PI) / 180 })}
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
          descriptor={asset?.type === 'spine' ? assetDescriptors[asset.id] : null}
          onPatchFlow={onPatchFlow}
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
function TransformField({ label, prop, value, step, min, suffix, recording, hasChannel, onChange }) {
  const indicator = hasChannel ? '◆' : (recording ? '◇' : null);
  return (
    <div className="scene-field-row-wrap">
      <DragNumberField label={label} value={value} step={step} min={min} suffix={suffix} onChange={onChange} />
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
function ClipSection({ scene, layer, asset, basePose, track, clip, flowTime, descriptor, onPatchFlow }) {
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
  const animatedProps = supportsChannels
    ? CHANNEL_PROPS.filter((p) => clip.channels?.[p]?.keys?.length)
    : [];
  const headerLabel = isSpine
    ? (clip.anim || '(setup pose)')
    : (animatedProps.length ? animatedProps.join(' · ') : 'static');

  return (
    <div className="scene-field-group scene-clip-section">
      <div className="scene-field-group-head">
        clip · {headerLabel}
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
function PngChannelEditor({ clip, basePose, flowTime, onPatchClip }) {
  const channels = clip.channels || {};
  const enabled = useMemo(() => new Set(Object.keys(channels)), [channels]);
  const [selectedKey, setSelectedKey] = useState(null); // { prop, idx } | null

  // Where the playhead currently sits, in clip-local seconds. Used as
  // the time for the second seed key and for "add key at playhead".
  const localT = Math.max(0, Math.min(clip.duration, flowTime - clip.start));

  const writeChannels = (next) => {
    onPatchClip({ channels: Object.keys(next).length ? next : null });
  };

  const patchChannel = (prop, channel) => {
    const next = { ...channels };
    if (channel?.keys?.length) next[prop] = channel;
    else delete next[prop];
    writeChannels(next);
    if (selectedKey?.prop === prop) {
      const ks = channel?.keys || [];
      if (selectedKey.idx >= ks.length) setSelectedKey(null);
    }
  };

  const toggleProp = (prop) => {
    if (enabled.has(prop)) {
      patchChannel(prop, null);
      return;
    }
    const seed = basePose?.[prop] ?? 0;
    const keys = [{ t: 0, v: seed, out: 'linear' }];
    if (localT > 0.001 && localT < clip.duration - 0.001) {
      keys.push({ t: localT, v: seed, out: 'linear' });
    } else {
      keys.push({ t: clip.duration, v: seed, out: 'linear' });
    }
    patchChannel(prop, { keys });
  };

  const patchKeyAt = (prop, idx, patch) => {
    const ch = channels[prop];
    if (!ch) return;
    let next = ch;
    if ('v' in patch) next = setKeyValue(next, idx, patch.v);
    if ('t' in patch) next = moveKeyTime(next, idx, patch.t);
    if ('out' in patch) next = setKeyOut(next, idx, patch.out);
    patchChannel(prop, next);
  };

  const deleteKey = (prop, idx) => {
    const ch = channels[prop];
    if (!ch) return;
    const next = removeChannelKey(ch, idx);
    patchChannel(prop, next.keys.length ? next : null);
  };

  const addKeyAtPlayhead = (prop) => {
    const ch = channels[prop] || { keys: [] };
    const currentV = ch.keys.length ? evalChannel(ch, localT) : (basePose?.[prop] ?? 0);
    const next = insertOrUpdateKey(ch, localT, currentV, { out: 'linear' });
    patchChannel(prop, next);
  };

  return (
    <div className="scene-channels-editor">
      <div className="scene-tween-chips">
        <span className="scene-field-group-sub">animate:</span>
        {CHANNEL_PROPS.map((p) => (
          <button
            key={p}
            type="button"
            className={'scene-chip' + (enabled.has(p) ? ' on' : '')}
            onClick={() => toggleProp(p)}
            title={enabled.has(p)
              ? `Stop animating ${p} (deletes all of its keys)`
              : `Animate ${p}. Once enabled, scrub the timeline + edit the value and the keyframe records automatically.`}
          >
            {PROP_META[p].label}
          </button>
        ))}
      </div>

      {!enabled.size && (
        <div className="scene-empty" style={{ padding: '8px 0', fontSize: 10 }}>
          enable a property above. once enabled, scrub the timeline and
          drag the sprite (or edit transform fields) — keyframes record
          automatically at the playhead.
        </div>
      )}

      {[...enabled].map((prop) => (
        <ChannelBlock
          key={prop}
          prop={prop}
          channel={channels[prop]}
          clipDuration={clip.duration}
          localT={localT}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          onPatchKeyAt={patchKeyAt}
          onDeleteKey={deleteKey}
          onAddKeyAtPlayhead={addKeyAtPlayhead}
        />
      ))}

      {selectedKey && channels[selectedKey.prop]?.keys?.[selectedKey.idx] && selectedKey.idx < channels[selectedKey.prop].keys.length - 1 && (
        <div className="scene-channel-curve">
          <div className="scene-channel-curve-head">
            <span>
              {PROP_META[selectedKey.prop]?.label || selectedKey.prop} · curve from key {selectedKey.idx + 1} → {selectedKey.idx + 2}
            </span>
            <button
              type="button"
              className="scene-icon-btn"
              onClick={() => setSelectedKey(null)}
              title="Close curve editor"
            >
              ✕
            </button>
          </div>
          <CurveEditor
            value={channels[selectedKey.prop].keys[selectedKey.idx].out || 'linear'}
            onChange={(spec) => patchKeyAt(selectedKey.prop, selectedKey.idx, { out: spec })}
          />
        </div>
      )}
    </div>
  );
}

function ChannelBlock({ prop, channel, clipDuration, localT, selectedKey, onSelectKey, onPatchKeyAt, onDeleteKey, onAddKeyAtPlayhead }) {
  const meta = PROP_META[prop];
  const keys = channel?.keys || [];
  return (
    <div className="scene-channel-block">
      <div className="scene-channel-head">
        <span className="scene-channel-label">{meta.label}</span>
        <span className="scene-channel-meta">{keys.length} key{keys.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          className="scene-btn scene-btn--ghost scene-btn--sm"
          onClick={() => onAddKeyAtPlayhead(prop)}
          title={`Add a key for ${meta.label} at the playhead (${localT.toFixed(2)}s)`}
        >
          + key @ {localT.toFixed(2)}s
        </button>
      </div>
      <table className="scene-channel-keys">
        <thead>
          <tr>
            <th>t (s)</th>
            <th>{meta.label}</th>
            <th>out →</th>
            <th aria-label="delete" />
          </tr>
        </thead>
        <tbody>
          {keys.map((k, i) => {
            const isLast = i === keys.length - 1;
            const isSelected = selectedKey?.prop === prop && selectedKey.idx === i;
            return (
              <tr key={i} className={'scene-channel-row' + (isSelected ? ' selected' : '')}>
                <td>
                  <DragNumberField
                    label=""
                    value={Number(k.t.toFixed(3))}
                    step={0.01}
                    min={0}
                    max={clipDuration}
                    onChange={(v) => onPatchKeyAt(prop, i, { t: Math.max(0, Math.min(clipDuration, v)) })}
                  />
                </td>
                <td>
                  <DragNumberField
                    label=""
                    value={meta.toDisplay(k.v)}
                    step={meta.step}
                    suffix={meta.unit === '°' ? '°' : undefined}
                    onChange={(v) => onPatchKeyAt(prop, i, { v: meta.fromDisplay(v) })}
                  />
                </td>
                <td>
                  {isLast ? (
                    <span className="scene-channel-out-last">—</span>
                  ) : (
                    <button
                      type="button"
                      className={'scene-channel-out-btn' + (isSelected ? ' is-active' : '')}
                      onClick={() => onSelectKey(isSelected ? null : { prop, idx: i })}
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
                    onClick={() => onDeleteKey(prop, i)}
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
    </div>
  );
}
