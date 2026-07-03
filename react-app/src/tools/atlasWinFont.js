// atlasWinFont.js — pure helpers for Atlas Packer's "Win Font" mode.
// Maps individually-delivered character sprites (one PNG per glyph) onto the
// Scene Studio win-number atlas layout (8 cols row-major, 256px cells) so the
// output drops straight into the Win Sequence wizard's Number step.
// Layout is single-sourced from the Scene Studio model — never duplicate it.

import { DEFAULT_CHAR_LAYOUT } from './SceneStudio/engine/winseq/winNumberModel.js';

export const WIN_LAYOUT = DEFAULT_CHAR_LAYOUT;
export const WIN_COLS = 8;

/** Index of a glyph in the layout (first occurrence), or -1. */
export function glyphIndex(ch) {
  return typeof ch === 'string' && ch.length ? WIN_LAYOUT.indexOf(ch) : -1;
}

// Word-name aliases (case-insensitive) for characters that can't (or won't)
// appear literally in filenames. Values are glyph chars or layout indices —
// `k`/`r` currency cells (16/17) need indices since 'k'/'r' chars would hit
// the same cells anyway but 'kr_k'/'kr_r' make the intent explicit.
const ALIASES = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  comma: ',',
  dot: '.', period: '.', point: '.', decimal: '.',
  times: 'x', multiplier: 'x', mult: 'x', cross: 'x',
  plus: '+',
  minus: '-', dash: '-', hyphen: '-',
  equals: '=', equal: '=', eq: '=',
  dollar: '$', usd: '$',
  euro: '€', eur: '€',
  ruble: '₽', rouble: '₽', rub: '₽',
  pound: '£', gbp: '£', sterling: '£',
  lira: '₺', try: '₺', tl: '₺',
  rupee: '₹', inr: '₹',
  kr_k: 16, krk: 16,
  kr_r: 17, krr: 17,
  kr: 16, // spans two cells — caller warns; deliver k + r separately
};

const NOISE = new Set(['font', 'win', 'num', 'number', 'char', 'glyph', 'sprite', 'txt', 'text']);

/** Try one candidate token → glyph index, or -1. */
function tokenToIndex(tok) {
  if (!tok) return -1;
  if (tok.length === 1) {
    const exact = WIN_LAYOUT.indexOf(tok); // case-sensitive: k→16 (kr), K→34 (letter)
    if (exact >= 0) return exact;
    const upper = WIN_LAYOUT.indexOf(tok.toUpperCase());
    if (upper >= 0) return upper;
    return -1;
  }
  const alias = ALIASES[tok.toLowerCase()];
  if (alias === undefined) return -1;
  return typeof alias === 'number' ? alias : glyphIndex(alias);
}

/**
 * Detect the glyph index for a sprite filename, or -1 when unmatched.
 * Tries: whole basename → last separator-split token → first token.
 */
export function detectGlyphIndex(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '');
  const whole = tokenToIndex(base);
  if (whole >= 0) return whole;
  const tokens = base.split(/[_\-. ]+/).filter((t) => t && !NOISE.has(t.toLowerCase()));
  if (!tokens.length) return -1;
  const last = tokenToIndex(tokens[tokens.length - 1]);
  if (last >= 0) return last;
  return tokens.length > 1 ? tokenToIndex(tokens[0]) : -1;
}

/**
 * Map files to glyph cells — the single source shared by the settings preview
 * and the runner so they can never disagree.
 * @param {Array<{name:string}>} files
 * @param {Object<string,string>} overrides  fileName → glyph char ('' = skip)
 * @returns {Array<{name, index, glyph, status: 'ok'|'dup'|'none'|'skip'}>}
 *          Duplicates: first file wins; later ones get status 'dup'.
 */
export function buildMapping(files, overrides = {}) {
  const taken = new Set();
  return (files || []).map(({ name }) => {
    const ov = overrides[name];
    let index;
    if (ov === '') index = -2; // explicit skip
    else if (ov) index = glyphIndex(ov);
    else index = detectGlyphIndex(name);
    if (index === -2) return { name, index: -1, glyph: null, status: 'skip' };
    if (index < 0) return { name, index: -1, glyph: null, status: 'none' };
    if (taken.has(index)) return { name, index, glyph: WIN_LAYOUT[index], status: 'dup' };
    taken.add(index);
    return { name, index, glyph: WIN_LAYOUT[index], status: 'ok' };
  });
}
