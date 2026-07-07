// objectColors.js — single source of truth for the *type-coloured* naming that
// runs through the hierarchy, the animate-mode track labels, and the direct-mode
// scenario nodes / timeline list. Keeping the classification here means every
// surface agrees on "what colour is a spine / static / win / spinner".
//
// The palette intent (matches the request + the tools it mirrors):
//   spine   → orange-red  (like the Spine 2D editor accent)
//   static  → green       (plain art: png / video / png-sequence)
//   win     → gold        (win-sequence + win-number objects); "bigger" win
//                          tiers glow more (see winGlowStrength)
//   spinner → white bold, with a single letter cycling through vivid colours
//             (rendered by SpinnerName — the animation lives in the component)
//   group   → muted       (empty containers / folders)
//
// Timelines carry an origin: a timeline `generatedBy` a layer inherits that
// object's kind; a hand-authored timeline is "user" (its own distinctive hue).

/** Win tiers in escalation order — mirrors WIN_TIERS in winseq/winseqModel.js.
 *  Index drives the gold-glow strength (later tier = brighter, more shine). */
export const WIN_TIER_ORDER = ['small', 'medium', 'large', 'big', 'super', 'mega', 'max'];

/** Vivid "common" colours the spinner name cycles through. One is picked at
 *  random every time the highlight advances (see SpinnerName). */
export const COMMON_COLORS = [
  '#ff4f6a', // red
  '#ff8c42', // orange
  '#ffd23f', // gold
  '#4ecb71', // green
  '#35d0d6', // cyan
  '#5b8cff', // blue
  '#a06bff', // purple
  '#ff6bd6'  // pink
];

/**
 * Classify a scene asset into one of the colour kinds. Statics (real art) are
 * green; the empty-static placeholder is still a static. Empty containers are
 * groups. Returns 'unknown' when there's no asset.
 */
export function assetColorKind(asset) {
  if (!asset) return 'unknown';
  switch (asset.type) {
    case 'spine':   return 'spine';
    case 'spinner': return 'spinner';
    case 'winseq':  return 'win';
    case 'winnumber': return 'win';
    case 'png':
    case 'video':
    case 'pngSequence': return 'static';
    // The Scene-Setup root (🎬) is a real object, coloured purple like its
    // direct-mode timelines; a plain empty (📁) is just a grouping folder.
    case 'empty':   return asset.sceneSetup ? 'setup' : 'group';
    default:        return 'unknown';
  }
}

/** CSS class for a colour kind. Shared by every surface. */
export function kindClass(kind) {
  return kind && kind !== 'unknown' ? `ss-kind-${kind}` : '';
}

/**
 * Classify a *timeline* by its origin. Generated timelines inherit their source
 * object's kind (spinner/win/setup); everything hand-authored is 'user'.
 * Returns { kind, winTier|null }.
 */
export function timelineColorKind(tl) {
  const meta = tl?.generatedMeta;
  const src = meta?.source;
  if (src === 'spinner') return { kind: 'spinner', winTier: null };
  if (src === 'winseq')  return { kind: 'win', winTier: meta.tier || null };
  if (src === 'sceneSetup') return { kind: 'setup', winTier: null };
  if (tl?.generatedBy) return { kind: 'generated', winTier: null };
  return { kind: 'user', winTier: null };
}

/**
 * Gold-glow strength for a win tier, 0..1. Small wins barely glow; a Max win
 * glows hardest. Unknown tiers get a mid strength so they still read as "win".
 */
export function winGlowStrength(tierKey) {
  if (!tierKey) return 0.55;
  const i = WIN_TIER_ORDER.indexOf(tierKey);
  if (i < 0) return 0.55;
  // Ramp 0.35 (small) → 1 (max) across the tier table.
  return 0.35 + (i / (WIN_TIER_ORDER.length - 1)) * 0.65;
}

/** Is a win tier "big" enough to earn the extra shining animation? */
export function isBigWinTier(tierKey) {
  return WIN_TIER_ORDER.indexOf(tierKey) >= WIN_TIER_ORDER.indexOf('big');
}
