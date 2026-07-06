// Scene Studio — Scene Setup wizard: per-game-mode "idle" timelines.
//
// The wizard scaffolds one empty group per enabled feature mode (Free Spins /
// Bonus / Pick&Click) under the scene root, gated by group ALPHA (base content
// hangs directly under the root and is always on). These generators emit one
// timeline per game mode — "<Mode> Idle" — that poses every feature group's
// alpha for that mode: 1 for its own group, 0 for the rest. Playing (or
// crossfading into) an idle timeline in Direct mode therefore sets the whole
// scene to that mode, and a crossfade edge eases the alphas.
//
// Raw prebuilt-timeline shape (ids are backfilled by addPrebuiltTimelines):
//   { name, tracks: [{ layerId, clips: [{ start, duration, channels }] }] }

export const SCENE_SETUP_IDLE_DURATION = 2; // seconds — scrub/hold-friendly pose
export const SCENE_SETUP_AUX_DURATION = 1.5; // seconds — splash/transition default
const SCENE_SETUP_PHASES = ['begin', 'idle', 'end'];
const PHASE_DEFAULT = { begin: 0.35, idle: 0.9, end: 0.35 };

const HINT_TOKENS = {
  splash: ['splash', 'preload'],
  intro: ['intro', 'in', 'show', 'start'],
  outro: ['outro', 'out', 'hide', 'close', 'end']
};
const PHASE_TOKENS = {
  begin: ['begin', 'start', 'intro', 'in', 'show', 'open'],
  idle: ['idle', 'loop', 'hold', 'wait'],
  end: ['end', 'outro', 'out', 'hide', 'close', 'finish']
};

function alphaClip(value, duration) {
  return {
    start: 0,
    duration,
    channels: { alpha: { keys: [{ t: 0, v: value }] } }
  };
}

/**
 * @param {Array<{key:string,label:string,layerId:string}>} modeGroups
 *        One entry per game mode; each mode has its own group layer.
 * @param {Array<{key:string,label:string,layerId:string}>} [allGroups=modeGroups]
 *        Every gate group that should be posed by mode idles. This can include
 *        splash / transition groups, which should be forced to alpha 0 unless
 *        the timeline explicitly targets them.
 * @returns raw timeline entries for addPrebuiltTimelines (empty when the
 *          setup has no feature groups — there is nothing to gate).
 */
export function buildSceneSetupIdleTimelines(modeGroups, allGroups = modeGroups) {
  const modes = (modeGroups || []).filter((m) => m?.layerId);
  const gates = (allGroups || []).filter((m) => m?.layerId);
  if (!modes.length || !gates.length) return [];
  return (modeGroups || []).map((m) => ({
    name: `${m.label} Idle`,
    generatedMeta: { source: 'sceneSetup', kind: 'modeIdle', modeKey: m.key || null },
    tracks: gates.map((g) => ({
      layerId: g.layerId,
      // A single key at t=0 holds for the whole clip — a static pose that a
      // Direct-mode crossfade can blend from/to.
      clips: [alphaClip(g.key === m.key ? 1 : 0, SCENE_SETUP_IDLE_DURATION)]
    }))
  }));
}

/**
 * Build one timeline per splash/transition group, each posing gate alphas so
 * only the target group is visible.
 *
 * @param {Array<{key:string,label:string,layerId:string,type?:string}>} auxGroups
 * @param {Array<{key:string,label:string,layerId:string}>} allGroups
 */
export function buildSceneSetupAuxTimelines(auxGroups, allGroups) {
  const aux = (auxGroups || []).filter((g) => g?.layerId);
  if (!aux.length) return [];
  return aux.map((target) => ({
    name: target.label,
    generatedMeta: {
      source: 'sceneSetup',
      kind: target.type || 'aux',
      modeKey: target.key || null,
      phase: target.phase || null,
      contentLayerId: target.contentLayerId || null
    },
    // Aux timelines are local by design: they only author the target group's
    // own alpha gate (show this group) plus the content animation track. They
    // do NOT force every other mode/aux group to alpha 0.
    tracks: [
      { layerId: target.layerId, clips: [alphaClip(1, SCENE_SETUP_AUX_DURATION)] },
      ...((target.contentLayerId && target.contentKind === 'spine')
        ? [{
          layerId: target.contentLayerId,
          clips: resolveSceneSetupPhaseClips(
            target.contentAnimations || [],
            target.contentDurations || {},
            target.phase || 'intro'
          )
        }]
        : [])
    ]
  }));
}

function hasToken(name, token) {
  return new RegExp(`(^|[^a-z])${token}([^a-z]|$)`, 'i').test(name);
}

function scoreAnim(name, phase, hint) {
  const n = String(name || '').toLowerCase();
  let sc = 0;
  for (const tok of PHASE_TOKENS[phase] || []) if (hasToken(n, tok) || n.includes(tok)) sc += 30;
  for (const tok of HINT_TOKENS[hint] || []) if (hasToken(n, tok) || n.includes(tok)) sc += 18;
  if (phase !== 'idle' && (hasToken(n, 'idle') || n.includes('loop'))) sc -= 22;
  if (phase === 'begin' && (hasToken(n, 'outro') || hasToken(n, 'hide') || hasToken(n, 'end'))) sc -= 25;
  if (phase === 'end' && (hasToken(n, 'intro') || hasToken(n, 'start') || hasToken(n, 'show'))) sc -= 25;
  return sc;
}

function pickAnim(anims, phase, hint, used) {
  let best = null;
  let bestScore = -Infinity;
  for (const a of anims) {
    const s = scoreAnim(a, phase, hint) - (used.has(a) ? 4 : 0);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

export function resolveSceneSetupPhaseClips(animations = [], durations = {}, hint = 'intro') {
  const anims = Array.isArray(animations) ? animations.filter(Boolean) : [];
  if (!anims.length) {
    let t = 0;
    return SCENE_SETUP_PHASES.map((phase) => {
      const clip = {
        start: t,
        duration: PHASE_DEFAULT[phase],
        anim: null,
        loop: false,
        autoFitDuration: false
      };
      t += clip.duration;
      return clip;
    });
  }
  const used = new Set();
  const begin = pickAnim(anims, 'begin', hint, used) || anims[0]; used.add(begin);
  const idle = pickAnim(anims, 'idle', hint, used) || anims.find((a) => a !== begin) || begin; used.add(idle);
  const end = pickAnim(anims, 'end', hint, used) || anims.find((a) => a !== idle) || idle;
  const phases = { begin, idle, end };
  let t = 0;
  return SCENE_SETUP_PHASES.map((phase) => {
    const anim = phases[phase] || anims[0];
    const raw = Number(durations?.[anim]);
    const duration = Number.isFinite(raw) && raw > 0 ? raw : PHASE_DEFAULT[phase];
    const clip = { start: t, duration: Math.max(0.05, duration), anim, loop: false, autoFitDuration: false };
    t += clip.duration;
    return clip;
  });
}
