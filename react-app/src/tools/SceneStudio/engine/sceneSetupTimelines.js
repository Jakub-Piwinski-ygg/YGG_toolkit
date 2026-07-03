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

/**
 * @param {Array<{key:string,label:string,layerId:string|null}>} modeGroups
 *        One entry per game mode; `layerId` is the mode's group layer
 *        (null for base — base content lives directly under the root).
 * @returns raw timeline entries for addPrebuiltTimelines (empty when the
 *          setup has no feature groups — there is nothing to gate).
 */
export function buildSceneSetupIdleTimelines(modeGroups) {
  const featureGroups = (modeGroups || []).filter((m) => m.layerId);
  if (!featureGroups.length) return [];
  return (modeGroups || []).map((m) => ({
    name: `${m.label} Idle`,
    tracks: featureGroups.map((g) => ({
      layerId: g.layerId,
      clips: [{
        start: 0,
        duration: SCENE_SETUP_IDLE_DURATION,
        // A single key at t=0 holds for the whole clip — a static pose that a
        // Direct-mode crossfade can blend from/to.
        channels: { alpha: { keys: [{ t: 0, v: g.key === m.key ? 1 : 0 }] } }
      }]
    }))
  }));
}
