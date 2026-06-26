// engine/winseq/winseqModel.js
//
// Framework-agnostic Win-Sequence data model — Scene Studio Phase 6.
// This module is PURE: no Pixi, no React, no DOM. It defines the
// win-sequence config schema (a single Spine skeleton — win_sequence.json —
// whose animations are mapped to win tiers), the escalation-flow generator,
// the per-clip payload normalizer, and the deterministic flow evaluator that
// the Pixi runtime (winseqRuntime.js) and the wizard preview both drive.
//
// (Phase 2) An optional count-up `number` config rides along on the win-sequence
// config (a bitmap-font win amount that follows a bone) — see winNumberModel.js.
//
// Naming convention (Yggdrasil): animations are `NNx_tier_sub`, e.g.
//   01a_small_begin / 01b_small_idle / 01c_small_end
//   02a_medium_begin … 03a_large_begin … 04a_big_begin …
// The number belongs to the TIER, not its position in a sequence:
//   small=01 medium=02 large=03 big=04 super=05 mega=06 max=07.
// Skipped tiers leave a gap; the rest never renumber. Sub order is
// begin → idle → end.

/**
 * Win tiers in escalation order. `optional` tiers (large, max) are only
 * produced when Design explicitly asks for them, so the wizard leaves them
 * disabled by default even when their animations exist on the skeleton.
 */
// NOTE: circular with winNumberModel.js (it imports our winSeqStepDuration /
// effectiveSteps). Safe — both sides only touch each other's exports at call
// time, never during top-level module evaluation.
import { normalizeWinNumber } from './winNumberModel.js';

export const WIN_TIERS = [
  { key: 'small',  num: '01', label: 'Small',  optional: false },
  { key: 'medium', num: '02', label: 'Medium', optional: false },
  { key: 'large',  num: '03', label: 'Large',  optional: true  },
  { key: 'big',    num: '04', label: 'Big',    optional: false },
  { key: 'super',  num: '05', label: 'Super',  optional: false },
  { key: 'mega',   num: '06', label: 'Mega',   optional: false },
  { key: 'max',    num: '07', label: 'Max',    optional: true  },
];

export const WIN_SUBS = ['begin', 'idle', 'end'];

/** Default seconds for a step whose Spine duration isn't known yet (0). */
export const WINSEQ_DEFAULT_STEP_DURATION = 1.0;

const TIER_BY_KEY = new Map(WIN_TIERS.map((t) => [t.key, t]));
const TIER_ORDER = new Map(WIN_TIERS.map((t, i) => [t.key, i]));

/**
 * Parse a Yggdrasil win-animation name into its parts.
 * `01a_small_begin` → { num:'01', letter:'a', tier:'small', role:'begin' }
 * Returns null when the name doesn't match the convention.
 */
export function parseWinAnimName(name) {
  const m = /^(\d{2})([a-c])_([a-z]+)_(begin|idle|end)$/i.exec(String(name || '').trim());
  if (!m) return null;
  const tier = m[3].toLowerCase();
  if (!TIER_BY_KEY.has(tier)) return null;
  return { num: m[1], letter: m[2].toLowerCase(), tier, role: m[4].toLowerCase() };
}

// ── Fuzzy matching (loosely-named exports) ───────────────────────────────────
// The strict NNx_tier_sub convention is preferred, but real-world skeletons
// often ship looser names ("small win begin", "smallBeginLoop", "win_medium_out").
// We tokenize a name and match a slot when it contains BOTH a tier token and a
// role token — e.g. the "small / begin" slot accepts any anim whose tokens
// include "small" and "begin".

const TIER_TOKENS = {
  small:  ['small'],
  medium: ['medium', 'med'],
  large:  ['large'],
  big:    ['big'],
  super:  ['super'],
  mega:   ['mega'],
  max:    ['max', 'maximum'],
};

const ROLE_TOKENS = {
  begin: ['begin', 'start', 'intro', 'in', 'enter'],
  idle:  ['idle', 'loop', 'hold', 'mid', 'still'],
  end:   ['end', 'out', 'outro', 'finish', 'exit'],
};

/**
 * Split an animation name into lowercase word tokens, breaking on separators
 * (`_ - space`), camelCase boundaries, and letter↔digit boundaries.
 * "01a_small_begin" → ['01','a','small','begin']
 * "smallWinBegin"   → ['small','win','begin']
 */
function tokenizeName(name) {
  return String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')    // letter→digit
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')    // digit→letter
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function tokensMatch(tokens, list) {
  return tokens.some((tok) => list.includes(tok));
}

function fuzzyMatchTierRole(tokens, tierKey, role) {
  return tokensMatch(tokens, TIER_TOKENS[tierKey] || [tierKey])
      && tokensMatch(tokens, ROLE_TOKENS[role] || [role]);
}

/**
 * Map a flat list of animation names onto the tier table. Returns one entry
 * per tier in WIN_TIERS that has at least one matching animation, in
 * escalation order:
 *   { key, num, label, begin, idle, end, present, optional, enabled }
 * `enabled` defaults to (present && !optional) — large/max stay off until the
 * wizard turns them on.
 *
 * Two passes: ① strict NNx_tier_sub names (exact + correctly ordered), then
 * ② fuzzy token matching fills any slot the strict pass left empty, so loosely
 * named exports still auto-map.
 */
export function mapAnimationsToTiers(animNames) {
  const found = new Map(); // tierKey → { begin, idle, end }
  const ensure = (tier) => {
    if (!found.has(tier)) found.set(tier, { begin: null, idle: null, end: null });
    return found.get(tier);
  };

  // Pass 1 — strict convention.
  for (const name of animNames || []) {
    const p = parseWinAnimName(name);
    if (!p) continue;
    const slot = ensure(p.tier);
    if (!slot[p.role]) slot[p.role] = name; // first match wins
  }

  // Pass 2 — fuzzy fill of still-empty slots. A name already used by another
  // slot of the same tier is skipped so begin/idle/end don't collapse onto one.
  const tokenized = (animNames || []).map((name) => ({ name, tokens: tokenizeName(name) }));
  for (const def of WIN_TIERS) {
    const slot = ensure(def.key);
    const used = new Set([slot.begin, slot.idle, slot.end].filter(Boolean));
    for (const role of WIN_SUBS) {
      if (slot[role]) continue;
      const hit = tokenized.find(({ name, tokens }) =>
        !used.has(name) && fuzzyMatchTierRole(tokens, def.key, role));
      if (hit) { slot[role] = hit.name; used.add(hit.name); }
    }
  }

  const out = [];
  for (const def of WIN_TIERS) {
    const slot = found.get(def.key);
    if (!slot) continue;
    const present = !!(slot.begin || slot.idle || slot.end);
    if (!present) continue;
    out.push({
      key: def.key,
      num: def.num,
      label: def.label,
      begin: slot.begin,
      idle: slot.idle,
      end: slot.end,
      present,
      optional: def.optional,
      enabled: present && !def.optional,
    });
  }
  return out;
}

/** Capitalize a tier key for display when no label is stored. */
function tierLabel(key) {
  const def = TIER_BY_KEY.get(key);
  if (def) return def.label;
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

/**
 * Build every escalation flow from a mapped tier list. Each enabled+present
 * tier T gets one flow that climbs from `small` up through every enabled
 * present tier ≤ T, playing each tier's begin → idle, and only the FINAL
 * tier's end (escalation skips intermediate ends). Missing tiers are simply
 * skipped — the chain jumps straight to the next present tier.
 *
 * @returns {Array<{ id, tier, label, steps: Array<{anim, role, tier}> }>}
 */
export function buildWinSeqFlows(tiers) {
  const active = (tiers || [])
    .filter((t) => t && t.enabled && (t.begin || t.idle || t.end))
    .slice()
    .sort((a, b) => (TIER_ORDER.get(a.key) ?? 0) - (TIER_ORDER.get(b.key) ?? 0));

  const flows = [];
  for (let i = 0; i < active.length; i++) {
    const target = active[i];
    const steps = [];
    for (let j = 0; j <= i; j++) {
      const tier = active[j];
      const isFinal = j === i;
      if (tier.begin) steps.push({ anim: tier.begin, role: 'begin', tier: tier.key });
      if (tier.idle)  steps.push({ anim: tier.idle,  role: 'idle',  tier: tier.key });
      if (isFinal && tier.end) steps.push({ anim: tier.end, role: 'end', tier: tier.key });
    }
    if (!steps.length) continue;
    flows.push({
      id: `win_${target.key}`,
      tier: target.key,
      label: target.label || tierLabel(target.key),
      steps,
    });
  }
  return flows;
}

// ── Normalization ──────────────────────────────────────────────────────────

function normalizeTier(t) {
  if (!t || typeof t !== 'object' || !t.key) return null;
  const def = TIER_BY_KEY.get(t.key);
  if (!def) return null;
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return {
    key: def.key,
    num: def.num,
    label: def.label,
    begin: str(t.begin),
    idle: str(t.idle),
    end: str(t.end),
    optional: def.optional,
    present: !!(str(t.begin) || str(t.idle) || str(t.end)),
    enabled: t.enabled === true,
  };
}

/**
 * Normalize a win-sequence config. `sequences` are ALWAYS derived from
 * `tiers` (single source of truth), so a hand-authored / older config with
 * stale sequences self-heals. Returns null when no flow can be produced.
 */
export function normalizeWinSeqConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : []).map(normalizeTier).filter(Boolean);
  const sequences = buildWinSeqFlows(tiers);
  if (!sequences.length) return null;
  return {
    rev: Math.max(1, Math.round(Number(raw.rev) || 1)),
    tiers,
    sequences,
    number: normalizeWinNumber(raw.number),
  };
}

/**
 * Normalize the per-clip payload stored on a win-sequence clip
 * (`clip.winseq`). `sequenceId` picks which flow plays; `hangOnLastIdle`
 * drops the terminal `_end` so the sequence holds on its final idle (the
 * in-game "wait for tap" state) and the clip duration shortens to match.
 */
export function normalizeWinSeqClipPayload(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    sequenceId: typeof p.sequenceId === 'string' && p.sequenceId ? p.sequenceId : null,
    hangOnLastIdle: p.hangOnLastIdle === true,
  };
}

// ── Flow helpers (duration + evaluation) ────────────────────────────────────

/** Drop a trailing `_end` step (used when hangOnLastIdle is set). */
export function effectiveSteps(steps, hangOnLastIdle) {
  if (!hangOnLastIdle || !steps.length) return steps;
  const last = steps[steps.length - 1];
  return last.role === 'end' ? steps.slice(0, -1) : steps;
}

/**
 * Resolve one animation's playback length for sequencing. A single-keyframe
 * Spine animation has a REAL duration of 0 — that's respected (it passes through
 * instantly). The WINSEQ_DEFAULT_STEP_DURATION fallback is used ONLY when the
 * length is genuinely unknown (the anim isn't in the duration map yet, e.g.
 * before the skeleton has loaded) — never to pad a legitimately 0-length anim.
 *
 * Exported so the wizard's preview strip lays out segments with the exact same
 * rule the evaluator + duration math use (otherwise the strip desyncs from the
 * playhead).
 */
export function winSeqStepDuration(anim, durations) {
  if (durations && Object.prototype.hasOwnProperty.call(durations, anim)) {
    const d = Number(durations[anim]);
    if (Number.isFinite(d) && d >= 0) return d;
  }
  return WINSEQ_DEFAULT_STEP_DURATION;
}

function stepDuration(step, durations) {
  return winSeqStepDuration(step.anim, durations);
}

/**
 * Find a flow by id, falling back to the first flow when the id is missing /
 * unknown (so a freshly-added clip still shows something sensible).
 */
export function findWinSeqFlow(config, sequenceId) {
  const flows = config?.sequences || [];
  if (!flows.length) return null;
  return flows.find((f) => f.id === sequenceId) || flows[0];
}

/**
 * Total playback length of a flow (seconds) given a `{ [anim]: seconds }`
 * duration map. When `hangOnLastIdle`, the terminal end step is excluded so
 * the clip ends exactly at the final idle's first cycle.
 */
export function winSeqFlowDuration(flow, durations, { hangOnLastIdle = false } = {}) {
  if (!flow?.steps?.length) return 0;
  const steps = effectiveSteps(flow.steps, hangOnLastIdle);
  let total = 0;
  for (const s of steps) total += stepDuration(s, durations);
  return total;
}

/**
 * Deterministic, scrub-safe evaluation of a flow at clip-local time `t`.
 * Returns the active animation, its local time, and whether it should loop.
 * Idle steps play exactly one cycle in normal mode; in hang mode the final
 * idle loops (the clip holds on it). Returns null for an empty flow.
 *
 * @returns {{ anim:string, animTime:number, loop:boolean, role:string }|null}
 */
export function evaluateWinSeqFlow(flow, durations, t, { hangOnLastIdle = false } = {}) {
  if (!flow?.steps?.length) return null;
  const steps = effectiveSteps(flow.steps, hangOnLastIdle);
  if (!steps.length) return null;
  const local = Math.max(0, Number(t) || 0);
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const d = stepDuration(s, durations);
    const isLast = i === steps.length - 1;
    if (local < acc + d || isLast) {
      const within = local - acc;
      const loop = isLast && hangOnLastIdle && s.role === 'idle';
      const animTime = loop ? Math.max(0, within) : Math.max(0, Math.min(within, d));
      return { anim: s.anim, animTime, loop, role: s.role };
    }
    acc += d;
  }
  // Unreachable (isLast covers the tail), but keep a definite return.
  const last = steps[steps.length - 1];
  return { anim: last.anim, animTime: stepDuration(last, durations), loop: false, role: last.role };
}
