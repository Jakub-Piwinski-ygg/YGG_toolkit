// engine/winseq/winNumberModel.js
//
// Pure (no Pixi / React / DOM) model for the Win-Sequence count-up NUMBER —
// Scene Studio Phase 6 / Phase 2. A win-number display is a bitmap-font atlas
// (2048×2048, 8×8 grid, 256px/cell) that follows a spine bone and counts up as
// the win sequence escalates. This module owns:
//   • the config schema + normalizer (`normalizeWinNumber`)
//   • the deterministic, scrub-safe count-up value (`winNumberValueAt`)
//   • the display formatter (`formatWinNumber`)
//
// Count-up ladder (×wager, FIXED — confirmed with Design):
//   tier start thresholds  small=0 medium=1 large=10 big=20 super=40 mega=80 max=120
//   each tier segment ramps from its threshold → the next PRESENT tier's threshold;
//   the FINAL tier of a flow ramps to its FLOW_FINAL (medium=10 large=20 big=40
//   super=80 mega=120 max=240). A standalone `win_small` flow has no count-up — it
//   shows a sub-bet final immediately (SMALL_FINAL×wager).

import { winSeqStepDuration, effectiveSteps } from './winseqModel.js';

/** Allowed currency glyphs (rendered from the atlas; `kr` = the k + r glyphs). */
export const WIN_CURRENCIES = ['$', '€', '₽', '£', '₺', '₹', 'kr'];

/** The verified `font_win.png` glyph order (index → glyph), 8 cols row-major. */
export const DEFAULT_CHAR_LAYOUT = '0123456789,.x$€₽kr£₺₹+-=ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Stable sentinel for the built-in template atlas (public/sceneStudio/font_win.png).
 *  Stored in config so it stays portable; resolved to a URL at load time. */
export const TEMPLATE_FONT_ID = '@template:font_win';
export function isTemplateFont(src) { return src === TEMPLATE_FONT_ID; }
/** Resolve the built-in template atlas to a fetchable (base-relative) URL. */
export function templateFontUrl() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return (base.endsWith('/') ? base : base + '/') + 'sceneStudio/font_win.png';
}

/** Tier start thresholds (× wager). */
export const TIER_THRESHOLD = { small: 0, medium: 1, large: 10, big: 20, super: 40, mega: 80, max: 120 };

/** Final value a flow ramps to when that tier is the flow's terminal tier (× wager). */
export const FLOW_FINAL = { medium: 10, large: 20, big: 40, super: 80, mega: 120, max: 240 };

/** Standalone `win_small` shows this immediately (× wager) — no count-up. */
export const SMALL_FINAL = 0.5;

const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Validate / fill a raw number config. Returns null when there is no font
 * texture (the Number step was skipped) — callers treat null as "no number".
 */
export function normalizeWinNumber(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fontSrc = typeof raw.fontSrc === 'string' && raw.fontSrc ? raw.fontSrc : null;
  if (!fontSrc) return null;
  return {
    fontSrc,
    cell: Math.max(1, Math.round(numOr(raw.cell, 256))),
    cols: Math.max(1, Math.round(numOr(raw.cols, 8))),
    rows: Math.max(1, Math.round(numOr(raw.rows, 8))),
    charLayout: typeof raw.charLayout === 'string' && raw.charLayout ? raw.charLayout : DEFAULT_CHAR_LAYOUT,
    letterSpacing: numOr(raw.letterSpacing, 0),
    glyphScale: Math.max(0.01, numOr(raw.glyphScale, 1)),
    baselineOffset: numOr(raw.baselineOffset, 0),
    align: raw.align === 'left' || raw.align === 'right' ? raw.align : 'center',
    currency: WIN_CURRENCIES.includes(raw.currency) ? raw.currency : '$',
    currencyPosition: raw.currencyPosition === 'suffix' ? 'suffix' : 'prefix',
    decimalSep: raw.decimalSep === ',' ? ',' : '.',
    decimals: Math.max(0, Math.min(4, Math.round(numOr(raw.decimals, 2)))),
    boneName: typeof raw.boneName === 'string' && raw.boneName ? raw.boneName : 'TEXT_',
    wager: Math.max(0, numOr(raw.wager, 1)),
  };
}

/** Unique tier keys in a flow, in escalation order (from flow.steps). */
function flowTierSequence(flow) {
  const seq = [];
  for (const s of flow.steps || []) if (!seq.includes(s.tier)) seq.push(s.tier);
  return seq;
}

/**
 * Deterministic, scrub-safe count-up value at clip-local time `localT`.
 * Mirrors the pose evaluator's timing (same `effectiveSteps` + per-step
 * durations) so the number tracks the playhead exactly. Backward scrubbing
 * yields identical values (no accumulated state).
 *
 * @returns {number} the win amount (already × wager)
 */
export function winNumberValueAt(flow, durations, localT, { wager = 1, hangOnLastIdle = false } = {}) {
  if (!flow?.steps?.length) return 0;
  const tiers = flowTierSequence(flow);
  const target = tiers[tiers.length - 1];
  // Standalone small win = no celebration / no count-up: show the final at once.
  if (target === 'small' && tiers.length === 1) return SMALL_FINAL * wager;

  const steps = effectiveSteps(flow.steps, hangOnLastIdle);

  // Per-tier segment { start, dur } along the effective timeline.
  const seg = new Map();
  let acc = 0;
  for (const s of steps) {
    const d = winSeqStepDuration(s.anim, durations);
    const cur = seg.get(s.tier) || { start: acc, dur: 0 };
    cur.dur += d;
    seg.set(s.tier, cur);
    acc += d;
  }
  const total = acc;

  // Value endpoints per tier: from its threshold → the next PRESENT tier's
  // threshold; the terminal tier ramps to its FLOW_FINAL.
  const endpoints = tiers.map((tier, i) => ({
    tier,
    from: (TIER_THRESHOLD[tier] ?? 0) * wager,
    to: (i === tiers.length - 1
      ? (FLOW_FINAL[tier] ?? TIER_THRESHOLD[tier] ?? 0)
      : (TIER_THRESHOLD[tiers[i + 1]] ?? 0)) * wager,
  }));

  const t = Math.max(0, Math.min(numOr(localT, 0), total));
  let value = endpoints.length ? endpoints[endpoints.length - 1].to : 0; // default: at/after end
  for (const e of endpoints) {
    const st = seg.get(e.tier);
    if (!st) continue;
    if (t < st.start) { value = e.from; break; }
    if (t <= st.start + st.dur) {
      const f = st.dur > 0 ? (t - st.start) / st.dur : 1;
      value = e.from + (e.to - e.from) * f;
      break;
    }
  }
  return value;
}

/** Format a value as the display string, e.g. `"$ 120.00"` (prefix, default) or
 *  `"120.00 $"` (suffix). Decimal separator is `.` or `,`. */
export function formatWinNumber(value, num) {
  const decimals = Number.isFinite(num?.decimals) ? num.decimals : 2;
  let s = (Number(value) || 0).toFixed(decimals);
  if (num?.decimalSep === ',') s = s.replace('.', ',');
  const cur = num?.currency || '$';
  return num?.currencyPosition === 'suffix' ? `${s} ${cur}` : `${cur} ${s}`;
}
