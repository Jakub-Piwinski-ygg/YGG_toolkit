// InspectorPanel — right panel with properties of the selected layer and,
// when a clip is selected on the timeline, properties of that clip.

import { useEffect, useMemo, useRef, useState } from 'react';
import { hasPortraitOverride, resolveTransform } from '../engine/orientationManager.js';
import { CURVE_PRESETS } from '../engine/sceneModel.js';
import {
  bakePathToKeyCount,
  CHANNEL_DEFS,
  CHANNEL_NAMES,
  channelLayout,
  clipLocalSeconds,
  evalChannel,
  insertOrUpdateKey,
  isPathChannel,
  maxChannelKeyTime,
  moveKeyTime,
  removeKey as removeChannelKey,
  setKeyComponent,
  setKeyOut,
  setKeyValue
} from '../engine/animation/keyframes.js';
import { ChannelSubplot, ClipGraphEditor } from './ClipGraphEditor.jsx';
import { CurveEditor, CurveThumbnail } from './CurveEditor.jsx';
import { DragNumberField } from './DragNumberField.jsx';
import { ColorPicker } from '../../../components/ColorPicker.jsx';
import { NumberField } from '../../../components/NumberField.jsx';
import { SpinnerSection, SpinnerClipSection, spinnerClipDurationAction } from './SpinnerInspectorSections.jsx';
import { normalizeSpinnerConfig } from '../engine/spinner/spinnerModel.js';
import { normalizeWinSeqConfig, findWinSeqFlow, winSeqFlowDuration } from '../engine/winseq/winseqModel.js';

const BLEND_OPTIONS = ['normal', 'additive', 'screen', 'multiply'];
const CURVES = CURVE_PRESETS;

/**
 * Single segmented toggle that replaces the old separate "loop" checkbox and
 * "hold last frame after end" checkbox. A clip is either:
 *   - Loop  → animation repeats for the clip's duration (clip.loop = true)
 *   - Hold  → animation plays once and freezes on its last frame
 *             (clip.loop = false)
 * In both modes the post-clip pose is held (clearAfterEnd = false) — the old
 * "snap back to setup pose" behaviour is dropped in favour of this one switch.
 * Loop is the default for new clips (seeded from the layer's "loop animation").
 */
function LoopHoldToggle({ clip, patchClip }) {
  const isLoop = clip.loop !== false;
  return (
    <div
      className="scene-loophold"
      role="group"
      title="Loop: the animation repeats for the clip's duration. Hold last frame: it plays once and freezes on its final frame until the next clip."
    >
      <button
        type="button"
        className={`scene-loophold-btn${isLoop ? ' on' : ''}`}
        onClick={() => patchClip({ loop: true, clearAfterEnd: false })}
      >
        ↻ loop
      </button>
      <button
        type="button"
        className={`scene-loophold-btn${!isLoop ? ' on' : ''}`}
        onClick={() => patchClip({ loop: false, clearAfterEnd: false })}
      >
        ⏸ hold last frame
      </button>
    </div>
  );
}

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

/** Human label for an asset in the source-swap dropdown. */
function assetLabel(a) {
  const name = a?.meta?.originalName || String(a?.src || '').split(/[\\/]/).pop() || a?.id || '?';
  const tag = a?.type === 'spine' ? '◆ ' : a?.type === 'video' ? '▶ ' : '';
  return `${tag}${name}`;
}

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
  onFlowAction,
  defaultTangentMode = 'auto',
  onSwapAsset,
  onSwapAssetFromBrowserId,
  onPatchAsset,
  onEditSpinner,
  onEditWinSeq,
  onEditSceneSetup,
  onGenerateWinSeqTimelines,
  onGenerateSpinnerTimeline,
  wagerPreview = null,
  onSetWagerPreview,
  studioMode = 'animate'
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

  // Effective base transform for the active orientation. For an inherited
  // portrait this is the CENTRE-REMAPPED landscape transform (matches what the
  // viewport renders), so the inspector never disagrees with the canvas.
  const t = resolveTransform(layer, orientation, scene.stage);

  // x / y are shown relative to the stage CENTRE (0,0 = centre) while the model
  // keeps a top-left origin — convert on display and on edit. (PLAN_2026-07 M8)
  // Only top-level layers live in stage space, so only they show x/y relative to
  // the stage centre. A child's x/y is PARENT-local (0,0 = parent origin) and a
  // win-number stores a bone-relative offset — both keep a 0,0 origin.
  const stageDims = scene.stage.orientations[orientation] || { w: 0, h: 0 };
  const centreOrigin = asset?.type !== 'winnumber' && !layer.parentId;
  const cx = centreOrigin ? stageDims.w / 2 : 0;
  const cy = centreOrigin ? stageDims.h / 2 : 0;

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

  // While recording, the transform fields show the LIVE evaluated value at
  // the playhead (not the base pose) for any channel that's animated — so the
  // field follows your edit instead of snapping back to base, and "what you
  // set is the key". Channels not animated fall back to the base pose.
  const liveLocalT = recordingClip ? clipLocalSeconds(recordingClip, flowTime, { clampPastEnd: true }) : 0;
  const animValue = (name) => {
    if (!recordingClip) return null;
    const ch = recordingChannels?.[name];
    if (!ch) return null;
    const animated = ch.keys?.length
      || (ch.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length))
      || isPathChannel(ch);
    if (!animated) return null;
    return evalChannel(ch, liveLocalT, name);
  };
  const posLive = animValue('position');
  const scaleLive = animValue('scale');
  const rotLive = animValue('rotation');
  const alphaLive = animValue('alpha');
  const tintLive = animValue('tint');
  const disp = {
    x: posLive?.x ?? t.x,
    y: posLive?.y ?? t.y,
    scaleX: scaleLive?.x ?? (t.scaleX ?? 1),
    scaleY: scaleLive?.y ?? (t.scaleY ?? 1),
    rotation: typeof rotLive === 'number' ? rotLive : t.rotation,
    alpha: typeof alphaLive === 'number' ? alphaLive : (typeof t.alpha === 'number' ? t.alpha : 1),
    tint: tintLive || t.tint || { r: 1, g: 1, b: 1 }
  };

  return (
    <div className="scene-panel scene-panel--right">
      <div className="scene-panel-head">inspector</div>

      {/* Scene Setup root re-edit — top of the inspector, setup mode only. */}
      {asset?.type === 'empty' && asset.sceneSetup && studioMode === 'setup' && onEditSceneSetup && (
        <button
          type="button"
          className="scene-btn scene-btn--primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => onEditSceneSetup(selectedLayerId)}
          title="Re-open the Scene Setup wizard to change the background / frame / animations, then rebuild this scene"
        >
          ✎ edit scene setup
        </button>
      )}

      {/* Spinner re-edit — top of the inspector, setup mode only. */}
      {asset?.type === 'spinner' && studioMode === 'setup' && onEditSpinner && (
        <button
          type="button"
          className="scene-btn scene-btn--primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => onEditSpinner(selectedLayerId)}
          title="Re-open the setup wizard to edit the grid, symbols, timing & initial board, then rebuild this spinner"
        >
          ✎ edit spinner in setup wizard
        </button>
      )}
      {asset?.type === 'spinner' && studioMode === 'setup' && onGenerateSpinnerTimeline && (
        <button
          type="button"
          className="scene-btn"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => onGenerateSpinnerTimeline(selectedLayerId)}
          title="Regenerate the full-spin timeline (start → spin → stop → present win) from the current recipe — replaces the one auto-generated for this spinner"
        >
          ↻ regenerate full-spin timeline
        </button>
      )}

      {/* Win-sequence re-edit — top of the inspector, setup mode only. */}
      {asset?.type === 'winseq' && studioMode === 'setup' && onEditWinSeq && (
        <button
          type="button"
          className="scene-btn scene-btn--primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => onEditWinSeq(selectedLayerId)}
          title="Re-open the setup wizard to adjust the skeleton, tier mapping & generated flows, then rebuild this object"
        >
          ✎ edit win sequences in setup wizard
        </button>
      )}
      {asset?.type === 'winseq' && studioMode === 'setup' && onGenerateWinSeqTimelines && (
        <button
          type="button"
          className="scene-btn"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => onGenerateWinSeqTimelines(selectedLayerId)}
          title="Regenerate one timeline per win sequence (small, medium, big …) from the current recipe — replaces the ones auto-generated for this object"
        >
          ↻ regenerate win-sequence timelines
        </button>
      )}

      {/* Win-number child — locked bone follower; edit opens its parent's wizard on the Number step. */}
      {asset?.type === 'winnumber' && (
        <>
          <div className="scene-spinner-meta" style={{ marginBottom: 8 }}>
            🔒 Win-number display — follows a bone on its win sequence. Its offset
            &amp; scale below are applied on top of the bone follow.
          </div>
          {studioMode === 'setup' && onEditWinSeq && layer.parentId && (
            <button
              type="button"
              className="scene-btn scene-btn--primary"
              style={{ width: '100%', marginBottom: 8 }}
              onClick={() => onEditWinSeq(layer.parentId, 'number')}
              title="Re-open the win-sequence wizard on the Number step to change the font, bone, currency, spacing…"
            >
              ✎ edit number…
            </button>
          )}
        </>
      )}

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

      <div
        className="scene-field scene-source-field"
        title="Swap the animated object's source. Pick an existing asset, or drag one from the Assets panel here. Keeps the animation; scale resets to 1:1."
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-ygg-asset-id')) {
            e.preventDefault();
            e.currentTarget.classList.add('drop-hover');
          }
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drop-hover')}
        onDrop={(e) => {
          e.currentTarget.classList.remove('drop-hover');
          const id = e.dataTransfer.getData('application/x-ygg-asset-id');
          if (id) { e.preventDefault(); onSwapAssetFromBrowserId?.(layer.id, id); }
        }}
      >
        <span>source</span>
        <select
          value={layer.assetId}
          onChange={(e) => onSwapAsset?.(layer.id, e.target.value)}
        >
          {scene.assets.map((a) => (
            <option key={a.id} value={a.id}>{assetLabel(a)}</option>
          ))}
        </select>
      </div>

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
          label="x" prop="x" value={disp.x - cx} step={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.position}
          onChange={(v) => onPatchTransform(layer.id, { x: v + cx })}
        />
        <TransformField
          label="y" prop="y" value={disp.y - cy} step={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.position}
          onChange={(v) => onPatchTransform(layer.id, { y: v + cy })}
        />
        <TransformField
          label="scale x" prop="scaleX" value={disp.scaleX} step={0.01} min={0.01}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.scale}
          onChange={(v) => onPatchTransform(layer.id, { scaleX: v })}
        />
        <TransformField
          label="scale y" prop="scaleY" value={disp.scaleY} step={0.01} min={0.01}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.scale}
          onChange={(v) => onPatchTransform(layer.id, { scaleY: v })}
        />
        <TransformField
          label="rotation" prop="rotation"
          value={(disp.rotation * 180) / Math.PI} step={1} suffix="°"
          recording={!!recordingClip} hasChannel={!!recordingChannels?.rotation}
          onChange={(v) => onPatchTransform(layer.id, { rotation: (v * Math.PI) / 180 })}
        />

        <TransformField
          label="alpha" prop="alpha"
          value={disp.alpha}
          step={0.01} min={0} max={1}
          recording={!!recordingClip} hasChannel={!!recordingChannels?.alpha}
          onChange={(v) => onPatchTransform(layer.id, { alpha: Math.max(0, Math.min(1, v)) })}
        />

        <ColorField
          label="tint"
          value={disp.tint}
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

      {asset?.type === 'spine' && !selectedClip && (
        <SpineSection
          layer={layer}
          descriptor={assetDescriptors[asset.id]}
          onPatchLayer={onPatchLayer}
        />
      )}
      {asset?.type === 'video' && (
        <VideoSection layer={layer} onPatchLayer={onPatchLayer} />
      )}
      {asset?.type === 'spinner' && (
        <SpinnerSection asset={asset} onPatchAsset={onPatchAsset} />
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
          descriptor={(asset?.type === 'spine' || asset?.type === 'winseq') ? assetDescriptors[asset.id] : null}
          onPatchFlow={onPatchFlow}
          onFlowAction={onFlowAction}
          defaultTangentMode={defaultTangentMode}
          spinnerConfig={asset?.type === 'spinner' ? normalizeSpinnerConfig(asset.spinner) : null}
          winseqConfig={asset?.type === 'winseq' ? normalizeWinSeqConfig(asset.winseq) : null}
          onPatchAsset={onPatchAsset}
          wagerPreview={wagerPreview}
          onSetWagerPreview={onSetWagerPreview}
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
        <ColorPicker value={hex} onChange={(nextHex) => onChange(hexToTint(nextHex))} title="Pick a tint colour" />
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
      <label className="scene-field">
        <span>default mix (s)</span>
        <NumberField
          step={0.05} min={0}
          value={Number((spine.defaultMix || 0).toFixed(3))}
          title="Skeleton-wide mix (crossfade) duration, mirroring Unity's SkeletonDataAsset 'Default Mix'. Used wherever a clip doesn't set its own mix. 0 = hard cuts."
          onChange={(v) => setSpine({ defaultMix: v })}
        />
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
function ClipSection({ scene, layer, asset, basePose, track, clip, flowTime, selectedKey, onSelectKey, descriptor, onPatchFlow, onFlowAction, defaultTangentMode = 'auto', spinnerConfig = null, winseqConfig = null, onPatchAsset, wagerPreview = null, onSetWagerPreview }) {
  const patchClip = (patch) => {
    const nextTracks = (scene.flow?.tracks || []).map((tr) =>
      tr.id === track.id
        ? {
            ...tr,
            clips: tr.clips.map((c) => {
              if (c.id !== clip.id) return c;
              const nc = { ...c, ...patch };
              // Don't let a duration/start edit shrink the clip past its keys.
              const maxKeyT = maxChannelKeyTime(c.channels);
              if (maxKeyT > 0 && Number(nc.duration) < maxKeyT) {
                const rightEdgePreserved =
                  Object.prototype.hasOwnProperty.call(patch, 'start') &&
                  Object.prototype.hasOwnProperty.call(patch, 'duration') &&
                  Math.abs((c.start + c.duration) - (patch.start + patch.duration)) < 1e-3;
                nc.duration = maxKeyT;
                if (rightEdgePreserved) nc.start = Math.max(0, (c.start + c.duration) - nc.duration);
              }
              return nc;
            })
          }
        : tr
    );
    onPatchFlow?.({ ...(scene.flow || {}), tracks: nextTracks });
  };

  const animations = descriptor?.animations || [];
  const isSpine = asset?.type === 'spine';
  const isSpinner = asset?.type === 'spinner';
  const isWinSeq = asset?.type === 'winseq';
  // Win-number layers are bone-driven (pos/scale/rot locked), but their COLOUR
  // can be keyframed — expose only the alpha + tint channels so artists can add
  // fade in/out without fighting the bone follow.
  const isWinNumber = asset?.type === 'winnumber';
  const channelNames = isWinNumber ? ['alpha', 'tint'] : CHANNEL_NAMES;
  const supportsChannels = asset?.type === 'png' || asset?.type === 'pngSequence' || isWinNumber;
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  const mixDuration = Number.isFinite(Number(clip.mixDuration)) ? Number(clip.mixDuration) : null;
  const resolvedAnim = isSpine ? (clip.anim || layer.spine?.defaultAnimation || '') : '';
  const rawAnimDuration = resolvedAnim ? Number(descriptor?.animationDurations?.[resolvedAnim]) : NaN;
  const hasAnimDuration = Number.isFinite(rawAnimDuration) && rawAnimDuration > 0;
  const cycleDuration = hasAnimDuration ? (rawAnimDuration / Math.max(0.01, speed)) : null;

  // Win-sequence clip: which flow plays + the hang-on-idle toggle. Durations
  // come from the live skeleton via the asset descriptor (same source spine
  // clips use), so the "set duration" math matches what the runtime plays.
  const winseqFlows = isWinSeq ? (winseqConfig?.sequences || []) : [];
  const winseqDurations = descriptor?.animationDurations || {};
  const winseqHang = clip.winseq?.hangOnLastIdle === true;
  const winseqFlow = isWinSeq ? findWinSeqFlow(winseqConfig, clip.winseq?.sequenceId) : null;
  const winseqClipDuration = winseqFlow
    ? Math.max(0.05, winSeqFlowDuration(winseqFlow, winseqDurations, { hangOnLastIdle: winseqHang }))
    : null;

  const patchWinSeq = (patch, opts = {}) => {
    const nextPayload = { sequenceId: clip.winseq?.sequenceId ?? null, hangOnLastIdle: winseqHang, ...patch };
    const flow = findWinSeqFlow(winseqConfig, nextPayload.sequenceId);
    const next = { winseq: nextPayload };
    // Recalculate the clip length so it reflects the (possibly end-less) flow.
    if (opts.refit && flow) {
      next.duration = Math.max(0.05, winSeqFlowDuration(flow, winseqDurations, { hangOnLastIdle: nextPayload.hangOnLastIdle }));
      next.autoFitDuration = false;
    }
    patchClip(next);
  };

  const setClipAnimation = (nextAnimRaw) => {
    const nextAnim = nextAnimRaw || null;
    const nextResolved = nextAnim || layer.spine?.defaultAnimation || null;
    const patch = { anim: nextAnim };
    // Always snap the clip length to the freshly-picked animation so the
    // timeline reflects the selection without a manual "Match anim time" click.
    if (nextResolved) {
      const d = Number(descriptor?.animationDurations?.[nextResolved]);
      if (Number.isFinite(d) && d > 0) patch.duration = Math.max(0.05, d / speed);
    }
    patch.autoFitDuration = false;
    patchClip(patch);
  };

  // What to render in the clip header — gives users a fast hint at what
  // the clip does without opening the channels block.
  const animatedChannels = supportsChannels
    ? channelNames.filter((n) => clip.channels?.[n]?.keys?.length || isPathChannel(clip.channels?.[n]))
    : [];
  const headerLabel = isSpine
    ? (clip.anim || '(setup pose)')
    : isWinSeq
      ? (winseqFlow?.label || clip.winseq?.sequenceId || '(no flow)')
      : (animatedChannels.length ? animatedChannels.join(' · ') : 'static');

  // "Set clip duration = computed time" action — moved to the very top of the
  // clip section (above name) so it's always one click away for spine/spinner.
  const durationAction = isSpinner
    ? spinnerClipDurationAction(spinnerConfig, clip)
    : isWinSeq && winseqClipDuration
      ? { duration: winseqClipDuration,
          label: winseqHang ? 'Set time (hang on idle)' : 'Set full sequence time',
          title: winseqHang
            ? 'Set clip duration to the chained sequence WITHOUT the final _end (holds on the last idle)'
            : 'Set clip duration to the full chained sequence (one cycle of every animation)' }
      : (isSpine && hasAnimDuration)
        ? { duration: cycleDuration, label: 'Match anim time',
            title: 'Set clip duration to one animation cycle at current speed' }
        : null;

  return (
    <div className="scene-field-group scene-clip-section">
      <div className="scene-field-group-head">
        clip · {headerLabel}
        <span className="scene-pill scene-pill--clip">on {track.layerId === layer.id ? layer.name : '(other layer)'}</span>
      </div>

      {/* Spine: the per-clip animation picker sits at the very top — it's the
          first thing you set on a new clip. The cycle-match button + loop/hold
          toggle follow it so the most-used controls are grouped together. */}
      {isSpine && (
        <label className="scene-field">
          <span>animation</span>
          <select value={clip.anim ?? ''} onChange={(e) => setClipAnimation(e.target.value)}>
            <option value="">— layer default —</option>
            {animations.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      )}

      {isSpine && (
        <label className="scene-field">
          <span>track</span>
          <NumberField step={1} min={0} max={64} int
            value={Number.isFinite(Number(clip.track)) ? Math.floor(Number(clip.track)) : 0}
            title="Spine AnimationState track index. Higher number draws on top of (overrides) lower ones; clips on different tracks play together (mix). Decoupled from the timeline row."
            onChange={(v) => patchClip({ track: v })} />
        </label>
      )}

      {isWinSeq && (
        <>
          <label className="scene-field">
            <span>sequence</span>
            <select
              value={clip.winseq?.sequenceId ?? (winseqFlows[0]?.id || '')}
              onChange={(e) => patchWinSeq({ sequenceId: e.target.value || null }, { refit: true })}
            >
              {!winseqFlows.length && <option value="">— no flows —</option>}
              {winseqFlows.map((f) => <option key={f.id} value={f.id}>{f.label} · {f.id}</option>)}
            </select>
          </label>
          <label className="scene-field scene-field--check">
            <input
              type="checkbox"
              checked={winseqHang}
              onChange={(e) => patchWinSeq({ hangOnLastIdle: e.target.checked }, { refit: true })}
            />
            <span>hang on last idle (drop the _end — waits for player tap in-game)</span>
          </label>
          {winseqFlow && (
            <div className="scene-clip-anim-meta">
              <span className="scene-clip-anim-meta-text">
                {winseqFlow.steps.length} steps · {winseqHang ? 'ends on idle' : 'plays _end'} ·
                {' '}{winseqClipDuration ? winseqClipDuration.toFixed(2) : '—'}s
              </span>
            </div>
          )}
          {winseqConfig?.number && (() => {
            // wagerPreview is scoped to a single winseq asset (T10) — only
            // treat it as active when it was set FOR this asset, so a preview
            // left over from a different win-sequence doesn't show here.
            const previewForThis = wagerPreview?.forAssetId === asset.id ? wagerPreview.wager : null;
            return (
              <>
                <div className="ss-insp-sep" />
                <label className="scene-field">
                  <span title="Preview-only — the count-up number re-evaluates at this wager without touching the authored value">
                    preview wager
                  </span>
                  <DragNumberField
                    value={previewForThis ?? winseqConfig.number.wager}
                    step={0.1} min={0}
                    onChange={(v) => onSetWagerPreview?.({ wager: v, forAssetId: asset.id })}
                  />
                </label>
                {previewForThis != null && previewForThis !== winseqConfig.number.wager && (
                  <div className="ss-insp-actions">
                    <button
                      type="button"
                      className="scene-btn scene-btn--sm"
                      title="Write this wager into the win sequence's authored number config"
                      onClick={() => {
                        onPatchAsset?.(asset.id, { winseq: { ...asset.winseq, number: { ...asset.winseq?.number, wager: previewForThis } } });
                        onSetWagerPreview?.(null);
                      }}
                    >
                      Apply as authored wager
                    </button>
                    <button
                      type="button"
                      className="scene-btn scene-btn--sm scene-btn--ghost"
                      onClick={() => onSetWagerPreview?.(null)}
                    >
                      Revert preview
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {isSpine && (
        hasAnimDuration ? (
          <div className="scene-clip-anim-meta">
            <span className="scene-clip-anim-meta-text">
              anim: {Number(rawAnimDuration.toFixed(3))}s · cycle @ speed: {Number(cycleDuration.toFixed(3))}s
            </span>
          </div>
        ) : (
          <div className="scene-empty" style={{ padding: '6px 12px', fontSize: 10 }}>
            animation duration unavailable — run the scene once so Spine metadata can load
          </div>
        )
      )}

      {isSpine && (
        <LoopHoldToggle clip={clip} patchClip={patchClip} />
      )}

      <label className="scene-field">
        <span>name</span>
        <input
          type="text"
          value={clip.name || ''}
          placeholder="(auto)"
          onChange={(e) => patchClip({ name: e.target.value || null })}
        />
      </label>

      {/* Non-spine clips: start/duration/speed inline (spine renders them inside
          its grouped "Clip Timing" below, to mirror the Unity inspector order). */}
      {!isSpine && (
        <>
          <DragNumberField label="start" value={clip.start} step={0.01} min={0}
            onChange={(v) => patchClip({ start: Math.max(0, v) })} />
          <DragNumberField label="duration" value={clip.duration} step={0.01} min={0.05}
            onChange={(v) => patchClip({ duration: Math.max(0.05, v), autoFitDuration: false })} />
          {!isSpinner && !isWinSeq && (
            <DragNumberField label="speed" value={speed} step={0.01} min={0.01}
              onChange={(v) => patchClip({ speed: Math.max(0.01, v) })} />
          )}
        </>
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
          defaultTangentMode={defaultTangentMode}
          channelList={channelNames}
        />
      )}

      {!isSpinner && !isSpine && !isWinSeq && (
        <LoopHoldToggle clip={clip} patchClip={patchClip} />
      )}

      {/* Spine clip — grouped to mirror the Unity "Spine Animation State Clip"
          inspector: Clip Timing → Spine Animation State Clip → Mixing Settings. */}
      {isSpine && (
        <>
          <div className="scene-field-group-sub">Clip Timing</div>
          <DragNumberField label="start" value={clip.start} step={0.01} min={0}
            onChange={(v) => patchClip({ start: Math.max(0, v) })} />
          <DragNumberField label="duration" value={clip.duration} step={0.01} min={0.05}
            onChange={(v) => patchClip({ duration: Math.max(0.05, v), autoFitDuration: false })} />
          <label className="scene-field">
            <span>blend in (s)</span>
            <NumberField step={0.01} min={0}
              value={Number((clip.easeIn || 0).toFixed(3))}
              title="Timeline clip blend-in (ease in) duration"
              onChange={(v) => patchClip({ easeIn: v })} />
          </label>
          <label className="scene-field">
            <span>ease out (s)</span>
            <NumberField step={0.01} min={0}
              value={Number((clip.easeOut || 0).toFixed(3))}
              title="Timeline clip blend-out (ease out) duration"
              onChange={(v) => patchClip({ easeOut: v })} />
          </label>
          <label className="scene-field">
            <span>clip in (s)</span>
            <NumberField step={0.01} min={0}
              value={Number((clip.clipIn || 0).toFixed(3))}
              title="Start the animation this many seconds in (skip the head)"
              onChange={(v) => patchClip({ clipIn: v })} />
          </label>
          <DragNumberField label="speed multiplier" value={speed} step={0.01} min={0.01}
            onChange={(v) => patchClip({ speed: Math.max(0.01, v) })} />
          <label className="scene-field">
            <span>time curve</span>
            <select
              value={clip.curve || 'linear'}
              onChange={(e) => patchClip({ curve: e.target.value })}
              title="Master time-remap curve for the Spine animation track time (Scene Studio extra)"
            >
              {CURVES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <div className="scene-field-group-sub">Spine Animation State Clip</div>
          <label className="scene-field scene-field--check">
            <input type="checkbox" checked={clip.dontPause === true}
              onChange={(e) => patchClip({ dontPause: e.target.checked })} />
            <span title="Keep playing when the PlayableDirector pauses. Exported to Unity; the scrub-based web preview has no separate director clock, so this has no live effect.">don't pause with director <em className="scene-export-only">(export only)</em></span>
          </label>
          <label className="scene-field scene-field--check">
            <input type="checkbox" checked={clip.dontEnd === true}
              onChange={(e) => patchClip({ dontEnd: e.target.checked })} />
            <span title="Don't clear the animation when the clip ends">don't end with clip</span>
          </label>
          <label className="scene-field">
            <span>clip end mix out (s)</span>
            <NumberField step={0.01} min={0}
              value={Number((clip.clipEndMixOut || 0).toFixed(3))}
              title="Mix-out duration at the clip's end (Clip End Mix Out Duration)"
              onChange={(v) => patchClip({ clipEndMixOut: v })} />
          </label>

          <div className="scene-field-group-sub">Mixing Settings</div>
          <label className="scene-field scene-field--check">
            <input type="checkbox" checked={clip.defaultMixDuration === true}
              onChange={(e) => patchClip({ defaultMixDuration: e.target.checked })} />
            <span title="Use the skeleton's setup-pose mix (overrides mix (s))">default mix duration</span>
          </label>
          <label className="scene-field scene-field--check">
            <input type="checkbox" checked={clip.useBlendDuration === true}
              onChange={(e) => patchClip({ useBlendDuration: e.target.checked })} />
            <span title="Use the Timeline clip blend for the mix instead of the mix (s) value">use blend duration</span>
          </label>
          <label className="scene-field">
            <span>mix duration (s)</span>
            <input
              type="number" step={0.01} min={0} placeholder="auto"
              disabled={clip.useBlendDuration === true || clip.defaultMixDuration === true}
              value={mixDuration == null ? '' : Number(mixDuration.toFixed(3))}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') { patchClip({ mixDuration: null }); return; }
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 0) patchClip({ mixDuration: n });
              }}
            />
          </label>
          <label className="scene-field scene-field--check">
            <input type="checkbox" checked={clip.holdPrevious === true}
              onChange={(e) => patchClip({ holdPrevious: e.target.checked })} />
            <span title="Blend on top of the previous animation instead of resetting the mix">hold previous</span>
          </label>
          <label className="scene-field">
            <span>event threshold</span>
            <NumberField step={0.05} min={0} max={1}
              value={Number((clip.eventThreshold || 0).toFixed(3))}
              onChange={(v) => patchClip({ eventThreshold: v })} />
          </label>
          <label className="scene-field">
            <span>attachment threshold</span>
            <NumberField step={0.05} min={0} max={1}
              value={Number((clip.attachmentThreshold || 0).toFixed(3))}
              onChange={(v) => patchClip({ attachmentThreshold: v })} />
          </label>
          <label className="scene-field">
            <span>draw order threshold</span>
            <NumberField step={0.05} min={0} max={1}
              value={Number((clip.drawOrderThreshold || 0).toFixed(3))}
              onChange={(v) => patchClip({ drawOrderThreshold: v })} />
          </label>
          <label className="scene-field">
            <span>alpha</span>
            <NumberField step={0.05} min={0} max={1}
              value={Number((clip.alpha == null ? 1 : clip.alpha).toFixed(3))}
              title="Track entry alpha (1 = full strength)"
              onChange={(v) => patchClip({ alpha: v })} />
          </label>
        </>
      )}

      {isSpinner && (
        <SpinnerClipSection config={spinnerConfig} clip={clip} patchClip={patchClip} />
      )}

      {/* Manual duration-match sits at the bottom — duration now auto-fits when
          the animation / sequence / action changes, so this is just an override. */}
      {durationAction && (
        <button
          className="scene-btn scene-clip-duration-action"
          title={durationAction.title}
          onClick={() => patchClip({ duration: Math.max(0.05, durationAction.duration), autoFitDuration: false })}
        >
          {durationAction.label}
        </button>
      )}
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
function PngChannelEditor({ clip, basePose, flowTime, onPatchClip, selectedKey: externalKey = null, onSelectKey: externalOnSelectKey = null, onFlowAction = null, defaultTangentMode = 'auto', channelList = CHANNEL_NAMES }) {
  const channels = clip.channels || {};
  // A channel counts as "enabled" if it has linked keys OR any split
  // sub-list has keys. Split channels store `perComp.x.keys` etc., not
  // `keys` on the root, so we have to check both shapes.
  const enabled = useMemo(() => new Set(Object.keys(channels).filter((n) => {
    const ch = channels[n];
    if (ch?.keys?.length) return true;
    if (ch?.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length)) return true;
    if (isPathChannel(ch)) return true;
    return false;
  })), [channels]);

  // Derive local key selection from external global state (filtered to this clip).
  // Falls back to local state when external is not provided (standalone use).
  const [localKey, setLocalKey] = useState(null);
  // In controlled mode (the real app passes externalOnSelectKey) the global
  // selection is the single source of truth — don't fall back to a stale
  // localKey, or a key stays "selected" after the global one is cleared
  // (e.g. right after a Delete), which then mis-targets the next Delete.
  const selectedKey = externalKey?.clipId === clip.id
    ? { name: externalKey.name, idx: externalKey.idx, comp: externalKey.comp ?? null }
    : (externalOnSelectKey ? null : localKey);

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
    const pathAlive = isPathChannel(channel);
    if (linkedAlive || splitAlive || pathAlive) next[name] = channel;
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
    const tm = defaultTangentMode;
    const keys = [{ t: 0, v: seed, out: 'linear', tm }];
    if (localT > 0.001 && localT < clip.duration - 0.001) {
      keys.push({ t: localT, v: seed, out: 'linear', tm });
    } else {
      keys.push({ t: clip.duration, v: seed, out: 'linear', tm });
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
    const next = insertOrUpdateKey(ch, localT, currentV, { out: 'linear', tm: defaultTangentMode });
    patchChannel(name, next);
  };

  // ── Path mode (P5): position as an on-scene spline + progress(t) curve ──
  const positionIsPath = isPathChannel(channels.position);

  // Seed the spline from the current position keys (sampled) or, lacking any,
  // a short horizontal segment around the base pose so there's something to drag.
  const seedPathPoints = () => {
    const pc = channels.position;
    const pts = [];
    if (pc) {
      const times = [];
      if (pc.keys?.length) {
        for (const k of pc.keys) times.push(k.t);
      } else if (pc.split && pc.perComp) {
        const set = new Set();
        for (const c of Object.values(pc.perComp)) for (const k of (c?.keys || [])) set.add(Number(k.t.toFixed(5)));
        times.push(...[...set].sort((a, b) => a - b));
      }
      for (const t of times) {
        const v = evalChannel(pc, t, 'position');
        if (v) pts.push({ x: v.x, y: v.y, tm: 'auto' });
      }
    }
    if (pts.length < 2) {
      const bx = basePose?.x ?? 0;
      const by = basePose?.y ?? 0;
      return [{ x: bx - 150, y: by, tm: 'auto' }, { x: bx + 150, y: by, tm: 'auto' }];
    }
    return pts;
  };

  const togglePathMode = () => {
    const pc = channels.position;
    if (isPathChannel(pc)) {
      // Let the artist choose the keyframe count = accuracy. Keys are smooth
      // (auto tangents) so a small count still tracks the path nicely.
      const def = String(Math.min(20, Math.max(3, Math.round((clip.duration || 1) * 4))));
      const input = typeof window === 'undefined'
        ? def
        : window.prompt(
          'Flatten path → x/y keyframes.\n'
          + 'How many keyframes? (more = more accurate, fewer = simpler)\n'
          + 'Keys are smooth, so even 3–4 follow the path.',
          def
        );
      if (input === null) return; // cancelled
      const count = Math.max(2, Math.min(400, Math.round(Number(input)) || Number(def)));
      const baked = bakePathToKeyCount(pc, clip.duration, count);
      if (selectedKey?.name === 'position') setSelectedKey(null);
      patchChannel('position', baked.keys?.length ? baked : null);
    } else {
      const hadKeys = pc?.keys?.length || (pc?.split && pc.perComp);
      const ok = typeof window === 'undefined' || window.confirm(
        `Edit position as an on-scene path?\n\n`
        + (hadKeys
          ? `Your current x/y position keys become path control points. `
          : `A starter path is created around the current pose. `)
        + `You shape the trajectory with dials on the scene and a progress(t) curve.\n\n`
        + `Note: switching back later bakes the path into many x/y keyframes.`
      );
      if (!ok) return;
      const points = seedPathPoints();
      const progress = { keys: [
        { t: 0, v: 0, out: 'linear' },
        { t: Math.max(0.05, clip.duration), v: 1, out: 'linear' }
      ] };
      patchChannel('position', { mode: 'path', path: { points, progress, bakeFps: 30 } });
    }
  };

  const setProgressChannel = (nextProg) => {
    const pc = channels.position;
    if (!isPathChannel(pc)) return;
    const keys = (nextProg.keys || []).map((k) => ({ ...k, v: Math.max(0, Math.min(1, k.v)) }));
    patchChannel('position', { ...pc, path: { ...pc.path, progress: { keys } } });
  };

  const setBakeFps = (fps) => {
    const pc = channels.position;
    if (!isPathChannel(pc)) return;
    const f = Math.max(1, Math.min(120, Math.round(Number(fps) || 30)));
    patchChannel('position', { ...pc, path: { ...pc.path, bakeFps: f } });
  };

  // Channels shown in the normal graph/list views — path-mode position is
  // edited via the path UI + on-scene dials instead, so exclude it here.
  const nonPathEnabled = [...enabled].filter((n) => !(n === 'position' && positionIsPath));

  return (
    <div className="scene-channels-editor">
      <div className="scene-tween-chips">
        <span className="scene-field-group-sub">animate:</span>
        {channelList.map((name) => {
          const isPosPath = name === 'position' && positionIsPath;
          return (
            <button
              key={name}
              type="button"
              className={'scene-chip' + (enabled.has(name) ? ' on' : '') + (isPosPath ? ' scene-chip--path' : '')}
              onClick={() => (isPosPath ? togglePathMode() : toggleChannel(name))}
              title={isPosPath
                ? 'Position is in path mode — click to flatten back to x/y keys'
                : enabled.has(name)
                  ? `Stop animating ${name} (deletes all of its keys)`
                  : `Animate ${name}. Once enabled, scrub the timeline + drag the sprite (or edit transform fields) and the keyframe records automatically.`}
            >
              {isPosPath ? '◈ position (path)' : (CHANNEL_LABEL[name] || name)}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={'scene-path-toggle-btn' + (positionIsPath ? ' on' : '')}
        onClick={togglePathMode}
        title={positionIsPath
          ? 'Disable path mode — bake the spline + progress down to plain x/y position keys.'
          : 'Edit position as an on-scene spline (dials on the canvas) driven by a progress(t) curve. Bakes to x/y on export.'}
      >
        {positionIsPath ? '◈ path mode — flatten to x/y' : '◈ edit position as path'}
      </button>

      {positionIsPath && (
        <PathProgressEditor
          pathChannel={channels.position}
          clipDuration={clip.duration}
          flowTime={flowTime}
          clipStart={clip.start}
          defaultTangentMode={defaultTangentMode}
          onChangeProgress={setProgressChannel}
          onChangeBakeFps={setBakeFps}
        />
      )}

      {!nonPathEnabled.length && !positionIsPath && (
        <div className="scene-empty" style={{ padding: '8px 0', fontSize: 10 }}>
          enable a channel above. once enabled, scrub the timeline and
          drag the sprite (or edit transform fields) — keyframes record
          automatically at the playhead.
        </div>
      )}

      {nonPathEnabled.length > 0 && (
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

      {viewMode === 'graph' && nonPathEnabled.length > 0 && (
        <ClipGraphEditor
          clip={clip}
          flowTime={flowTime}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          onPatchChannel={patchChannel}
          curveRef={curveRef}
          defaultTangentMode={defaultTangentMode}
        />
      )}

      {viewMode === 'list' && nonPathEnabled.map((name) => (
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

/**
 * Path-mode editor: a progress(t) graph (reusing the channel subplot, so it
 * gets draggable dots + tangent handles) plus a bake-density slider. The
 * spatial spline itself is laid out with the on-scene dials.
 */
function PathProgressEditor({ pathChannel, clipDuration, flowTime, clipStart, defaultTangentMode, onChangeProgress, onChangeBakeFps }) {
  const [progSel, setProgSel] = useState(null);
  const progress = pathChannel?.path?.progress || { keys: [] };
  const bakeFps = pathChannel?.path?.bakeFps ?? 30;
  const pointCount = pathChannel?.path?.points?.length ?? 0;

  const deleteSelectedProgressKey = () => {
    if (!progSel || typeof progSel.idx !== 'number') return false;
    const next = removeChannelKey(progress, progSel.idx);
    onChangeProgress(next);
    setProgSel(null);
    return true;
  };

  // The progress curve uses LOCAL selection (not the global keyframe system),
  // so wire Delete here. Skip when typing in a field.
  const progSelRef = useRef(progSel);
  progSelRef.current = progSel;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!progSelRef.current) return;
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const sel = progSelRef.current;
      const next = removeChannelKey(progress, sel.idx);
      onChangeProgress(next);
      setProgSel(null);
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true); // capture: run before global
    return () => window.removeEventListener('keydown', onKey, true);
  }, [progress, onChangeProgress]);

  return (
    <div className="scene-path-editor">
      <div className="scene-path-editor-hint">
        {pointCount} point{pointCount === 1 ? '' : 's'} · drag the dials on the scene to shape the path.
        The graph below controls progress along the path over time.
      </div>
      {progSel && (
        <button
          type="button"
          className="scene-btn scene-btn--ghost scene-btn--sm"
          onClick={deleteSelectedProgressKey}
          title="Delete the selected progress key (Del)"
        >
          ✕ delete progress key {progSel.idx + 1}
        </button>
      )}
      <div className="scene-channels-graph">
        <div className="scene-channels-graph-channel">
          <ChannelSubplot
            name="progress"
            channel={progress}
            layout="scalar"
            labelOverride="progress (0→1)"
            clipDuration={clipDuration}
            flowTime={flowTime}
            clipStart={clipStart}
            plotW={280}
            selectedKey={progSel}
            onSelectKey={setProgSel}
            onPatchChannel={(_n, next) => onChangeProgress(next)}
            defaultTangentMode={defaultTangentMode}
          />
        </div>
      </div>
      <label className="scene-field scene-field--inline">
        <span>bake fps</span>
        <NumberField
          min={1}
          max={120}
          step={1}
          int
          value={bakeFps}
          onChange={(v) => onChangeBakeFps(v)}
          title="Samples per second when baking this path to x/y position keys on export"
        />
      </label>
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
                    <ColorPicker
                      value={tintToHex(k.v)}
                      onChange={(nextHex) => onPatchKeyAt(name, i, { v: hexToTint(nextHex) })}
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
