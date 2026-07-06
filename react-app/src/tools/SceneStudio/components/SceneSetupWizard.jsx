// SceneSetupWizard — build a parented scene skeleton from workspace assets.
//
// Matching is NAME-first: the folder is only a weak secondary signal, because a
// folder like "03_Machine_Frame" would otherwise mark every file inside it
// (logo, ticker, …) as a machine frame. Each slot scores its candidates; the
// best above a threshold is auto-picked and suggestions (◆) sort to the top.
//
// The host (`handleCreateSceneSetup`) turns the returned per-mode selections
// into a parented hierarchy under a single empty "root" object that stores the
// setup config so the wizard can be re-opened from it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultTransformsForNewLayer } from '../engine/sceneModel.js';

// Slot (role) name heuristics — tested against the FILE NAME.
const M = {
  background: /(^|[_\-\s])(bg|background|backdrop|back)([_\-\s]|$|\d)/i,
  logo: /logo/i,
  machine: /(machine|m[_\-]?frame|reel[_\-\s]?frame|frame)/i,
  splash: /(splash|preload(er)?)/i,
  introOutro: /(intro|outro|transition|begin|end)/i,
};
// Game-mode heuristics.
const MODE = {
  freespins: /(free[_\-\s]?spins?|freespin|(^|[_\-\s])fs([_\-\s]|$|\d))/i,
  bonus: /bonus/i,
  pick: /(pick[_\-\s]?(and|&|n)?[_\-\s]?click|(^|[_\-\s])(pnc|pac)([_\-\s]|$))/i,
};
const ANY_MODE = /(bonus|free[_\-\s]?spins?|freespin|(^|[_\-\s])fs([_\-\s]|$|\d)|pick|click)/i;

const SLOT_LABEL = {
  background: 'Background', backgroundAnim: 'Background animation', logo: 'Logo',
  machineFrame: 'Machine frame', machineAnim: 'Machine frame animation',
};
const BASE_SLOTS = [
  { slot: 'background', kind: 'png', match: M.background },
  { slot: 'backgroundAnim', kind: 'spine', match: M.background, optional: true },
  { slot: 'logo', kind: 'png', match: M.logo, optional: true },
  { slot: 'machineFrame', kind: 'png', match: M.machine },
  { slot: 'machineAnim', kind: 'spine', match: M.machine, optional: true },
];
const MODE_SLOTS = [
  { slot: 'background', kind: 'png', match: M.background },
  { slot: 'backgroundAnim', kind: 'spine', match: M.background, optional: true },
  { slot: 'machineFrame', kind: 'png', match: M.machine, optional: true },
  { slot: 'machineAnim', kind: 'spine', match: M.machine, optional: true },
];
const SPLASH_SLOTS = [
  { slot: 'background', kind: 'png', match: M.splash, optional: true, folderMatch: /(^|\/)06[_\-]?splash(\/|$)/i },
  { slot: 'backgroundAnim', kind: 'spine', match: M.splash, optional: true, folderMatch: /(^|\/)06[_\-]?splash(\/|$)/i },
];
const TRANSITION_SLOTS = [
  { slot: 'backgroundAnim', kind: 'spine', match: M.introOutro, optional: true, folderMatch: /(^|\/)08[_\-]?intro[_\-]?outro(\/|$)/i },
  { slot: 'background', kind: 'png', match: M.introOutro, optional: true, folderMatch: /(^|\/)08[_\-]?intro[_\-]?outro(\/|$)/i },
];
const SECTIONS = [
  { key: 'base', mode: null, label: 'Base game', always: true, slots: BASE_SLOTS },
  { key: 'freespins', mode: MODE.freespins, label: 'Free Spins', slots: MODE_SLOTS },
  { key: 'bonus', mode: MODE.bonus, label: 'Bonus Game', slots: MODE_SLOTS },
  { key: 'pick', mode: MODE.pick, label: 'Pick & Click', slots: MODE_SLOTS },
  { key: 'splash', mode: null, label: 'Splash', slots: SPLASH_SLOTS, autoEnable: true },
  { key: 'freespinsIntro', mode: MODE.freespins, label: 'Free Spins Intro', slots: TRANSITION_SLOTS },
  { key: 'freespinsOutro', mode: MODE.freespins, label: 'Free Spins Outro', slots: TRANSITION_SLOTS },
  { key: 'bonusIntro', mode: MODE.bonus, label: 'Bonus Intro', slots: TRANSITION_SLOTS },
  { key: 'bonusOutro', mode: MODE.bonus, label: 'Bonus Outro', slots: TRANSITION_SLOTS },
  { key: 'pickIntro', mode: MODE.pick, label: 'Pick Intro', slots: TRANSITION_SLOTS },
  { key: 'pickOutro', mode: MODE.pick, label: 'Pick Outro', slots: TRANSITION_SLOTS },
];
const roleOf = (sectionKey, slot) => `${sectionKey}:${slot}`;
const PICK_MIN = 70; // score needed to auto-pick / show ◆

// Score a candidate for a slot in a mode. Name match dominates; folder is weak;
// mode mismatch is penalised so a base asset doesn't leak into a Free-Spins slot.
function scoreCandidate(slot, modeRx, cand) {
  const name = (cand.name || '').toLowerCase();
  const folder = (cand.folder || '').toLowerCase();
  let sc;
  if (slot.match.test(name)) sc = 100;
  else if (slot.folderMatch && slot.folderMatch.test(folder)) sc = 85;
  else if (slot.match.test(folder)) sc = 25;
  else return -1;
  if (modeRx) {
    if (modeRx.test(name)) sc += 60;
    else if (modeRx.test(folder)) sc += 12;
    else sc -= 45; // no mode marker → probably a base / other-mode asset
  } else {
    if (/(^|[_\-\s])base([_\-\s]|$|\d)/i.test(name)) sc += 20; // prefer *_base for base game
    if (ANY_MODE.test(name)) sc -= 45; // a mode-specific asset shouldn't fill a base slot
  }
  if (slot.slot === 'background') {
    if (/(^|[_\-\s])(bg|background|preloader[_\-\s]?bg)([_\-\s]|$|\d)/i.test(name)) sc += 30;
    if (/logo/i.test(name)) sc -= 65;
  }
  return sc;
}

export function SceneSetupWizard({ scene, assetItems = [], onClose, onCreate, embedded = false, onPreviewScene, existingConfig = null }) {
  const defaultEnabled = {
    base: true,
    freespins: false,
    bonus: false,
    pick: false,
    splash: false,
    freespinsIntro: false,
    freespinsOutro: false,
    bonusIntro: false,
    bonusOutro: false,
    pickIntro: false,
    pickOutro: false,
  };
  const [name, setName] = useState(existingConfig?.name || '');
  const [enabled, setEnabled] = useState({ ...defaultEnabled, ...(existingConfig?.enabled || {}) });
  const [picks, setPicks] = useState(existingConfig?.picks || {});
  const autoPickedRef = useRef(!!existingConfig);

  const pngPool = useMemo(
    () => assetItems.filter((it) => it.type === 'png')
      .map((it) => ({ kind: 'png', src: it.path, label: it.name, name: it.name, folder: it.folder })),
    [assetItems]
  );
  const spinePool = useMemo(
    () => assetItems.filter((it) => it.type === 'spine')
      .map((it) => ({ kind: 'spine', src: it.jsonPath, atlas: it.atlasPath, texture: it.texturePath, label: it.name, name: it.name, folder: it.folder })),
    [assetItems]
  );
  const poolFor = (kind) => (kind === 'spine' ? spinePool : pngPool);
  const specForSrc = (kind, src) => poolFor(kind).find((p) => p.src === src) || null;

  // Sorted candidate list for a slot: suggested (score ≥ PICK_MIN) first (by
  // score desc), then the rest alphabetically. Each entry carries `suggested`.
  const rankedFor = (section, slot) => {
    const modeRx = section.mode;
    return poolFor(slot.kind)
      .map((c) => ({ c, score: scoreCandidate(slot, modeRx, c) }))
      .sort((a, b) => (b.score - a.score) || a.c.label.localeCompare(b.c.label))
      .map(({ c, score }) => ({ ...c, suggested: score >= PICK_MIN }));
  };

  // Auto-pick best-scoring candidate per slot; auto-enable a mode when it has a
  // clearly mode-specific asset (name matches both the slot AND the mode).
  useEffect(() => {
    if (autoPickedRef.current || (!pngPool.length && !spinePool.length)) return;
    autoPickedRef.current = true;
    const nextPicks = {};
    const nextEnabled = { ...defaultEnabled, base: true };
    for (const section of SECTIONS) {
      for (const slot of section.slots) {
        const scored = poolFor(slot.kind)
          .map((c) => ({ c, score: scoreCandidate(slot, section.mode, c) }))
          .sort((a, b) => b.score - a.score);
        const best = scored[0];
        nextPicks[roleOf(section.key, slot.slot)] = best && best.score >= PICK_MIN ? best.c.src : '';
        if (section.mode && best && slot.match.test((best.c.name || '').toLowerCase()) && section.mode.test((best.c.name || '').toLowerCase())) {
          nextEnabled[section.key] = true;
        } else if (section.autoEnable && best && best.score >= PICK_MIN) {
          nextEnabled[section.key] = true;
        }
      }
    }
    setPicks(nextPicks);
    setEnabled(nextEnabled);
  }, [pngPool, spinePool]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPick = (role, src) => setPicks((p) => ({ ...p, [role]: src }));

  // Resolve every selection into a full spec (or null), grouped per mode.
  const buildModes = () => {
    const modes = {};
    for (const section of SECTIONS) {
      if (!section.always && !enabled[section.key]) { modes[section.key] = null; continue; }
      const roles = {};
      let any = false;
      for (const slot of section.slots) {
        const src = picks[roleOf(section.key, slot.slot)];
        const spec = src ? specForSrc(slot.kind, src) : null;
        roles[slot.slot] = spec ? { kind: spec.kind, src: spec.src, atlas: spec.atlas, texture: spec.texture } : null;
        if (spec) any = true;
      }
      modes[section.key] = any ? roles : (section.always ? roles : null);
    }
    return modes;
  };

  // ── Preview: base composition (background → machine frame) ───────────────────
  useEffect(() => {
    if (!embedded || !onPreviewScene) return;
    const canvasId = scene.activeCanvasId || scene.canvases?.[0]?.id || 'wprev_canvas';
    const assets = [];
    const layers = [];
    const push = (idBase, slot, layerName) => {
      const src = picks[roleOf('base', slot)];
      if (!src) return;
      const kind = BASE_SLOTS.find((s) => s.slot === slot)?.kind || 'png';
      const spec = specForSrc(kind, src);
      if (!spec) return;
      const assetId = `wprev_${idBase}`;
      if (spec.kind === 'spine') assets.push({ id: assetId, type: 'spine', src: spec.src, atlas: spec.atlas, texture: spec.texture, meta: { originalName: layerName } });
      else assets.push({ id: assetId, type: 'png', src: spec.src, meta: { originalName: layerName } });
      layers.push({
        id: `wprev_L_${idBase}`, name: layerName, assetId, canvasId, parentId: null,
        visible: true, blend: 'normal', transforms: defaultTransformsForNewLayer(scene.stage),
        ...(spec.kind === 'spine' ? { spine: { defaultAnimation: null, loop: true, skin: null } } : {}),
      });
    };
    // Match the scene z-order (bottom→top): bg, bg-anim, machine, machine-anim,
    // logo on top.
    push('bg', 'background', 'Background');
    push('bganim', 'backgroundAnim', 'Background Anim');
    push('frame', 'machineFrame', 'Machine Frame');
    push('machineanim', 'machineAnim', 'Machine Frame Anim');
    push('logo', 'logo', 'Logo');
    if (!layers.length) { onPreviewScene(null); return; }
    onPreviewScene({
      ...scene, assets, layers,
      timelines: [{ id: 'wprev_tl', name: 'preview', tracks: [], markers: [], nodes: [], edges: [] }],
      activeTimelineId: 'wprev_tl',
      flow: { tracks: [], markers: [], nodes: [], edges: [] },
    });
  }, [embedded, onPreviewScene, picks, scene]); // eslint-disable-line react-hooks/exhaustive-deps

  const canCreate = !!picks['base:background'] || !!picks['base:machineFrame'] || !!picks['base:backgroundAnim'];
  const handleCreate = () => {
    const modes = buildModes();
    if (!modes.base || !Object.values(modes.base).some(Boolean)) return;
    onCreate?.({ name: name.trim() || 'Scene', modes, setup: { name: name.trim(), picks, enabled } });
  };

  const emptyWorkspace = !pngPool.length && !spinePool.length;

  return (
    <div className={'spinner-wizard scene-setup-wizard' + (embedded ? ' spinner-wizard--embedded' : '')}>
      <div className="spinner-wizard-head">
        <strong>🎬 Scene Setup</strong>
        <button type="button" className="scene-btn scene-btn--ghost" onClick={onClose}>✕</button>
      </div>

      <div className="spinner-wizard-body">
        <label className="scene-field">
          <span>scene name</span>
          <input type="text" value={name} placeholder="Scene" onChange={(e) => setName(e.target.value)} />
        </label>

        {emptyWorkspace && (
          <div className="scene-spinner-meta" style={{ color: 'var(--err,#f88)' }}>
            No PNG / Spine files found in the workspace — link a project folder first.
          </div>
        )}

        {SECTIONS.map((section) => {
          const on = section.always || enabled[section.key];
          return (
            <div key={section.key} className="scene-setup-section">
              <div className="scene-field-group-head">
                {section.always ? (
                  <span>{section.label}</span>
                ) : (
                  <label className="scene-setup-section-toggle">
                    <input type="checkbox" checked={!!enabled[section.key]}
                      onChange={(e) => setEnabled((p) => ({ ...p, [section.key]: e.target.checked }))} />
                    <span>{section.label}</span>
                  </label>
                )}
              </div>
              {on && section.slots.map((slot) => {
                const role = roleOf(section.key, slot.slot);
                const ranked = rankedFor(section, slot);
                return (
                  <label key={role} className="scene-field">
                    <span>{SLOT_LABEL[slot.slot]}{slot.optional ? '' : ' *'}</span>
                    <select value={picks[role] || ''} onChange={(e) => setPick(role, e.target.value)}>
                      <option value="">— none —</option>
                      {ranked.map((c) => (
                        <option key={c.src} value={c.src}>{c.label}{c.suggested ? ' ◆' : ''}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          );
        })}

        <div className="scene-spinner-meta">
          ◆ = suggested by filename. Creates one parent object holding the scene;
          every mode (including Base Game) gets its own group. Alternate modes,
          splash, and transition groups are created hidden and can be auto-timed.
        </div>
      </div>

      <div className="spinner-wizard-foot">
        <button type="button" className="scene-btn scene-btn--ghost" onClick={onClose}>cancel</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="scene-btn scene-btn--primary" disabled={!canCreate} onClick={handleCreate}
          title={canCreate ? 'Create the scene' : 'Pick at least a background or machine frame'}>
          {existingConfig ? 'Rebuild scene' : 'Create scene'}
        </button>
      </div>
    </div>
  );
}
