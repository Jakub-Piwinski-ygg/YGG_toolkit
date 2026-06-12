// engine/spinner/spinnerModel.js
//
// Framework-agnostic Spinner (slot reel machine) data model — Phase 5,
// see react-app/SPINNER.md. This module is PURE: no Pixi, no React, no DOM.
// It defines the spinner config schema, seeded generators for strips and
// boards, the "ways" win evaluation, and the per-clip action payload
// normalizer. The deterministic evaluator lives in spinnerEval.js.

import { normalizeCurveSpec } from '../animation/curves.js';

export const SPINNER_ACTIONS = ['startSpin', 'spin', 'stopSpin', 'holdResult'];

/** Minimum consecutive reels (from the left) for a "ways" win. */
export const WAYS_MIN_COUNT = 3;

export const SPINNER_DEFAULT_STRIP_LEN = 28;

// ── Seeded RNG ─────────────────────────────────────────────────────────
// mulberry32 — tiny, deterministic, good enough for board/strip shuffles.
// The same seed must produce the same sequence in the C# port (Milestone B).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string — used to derive per-clip seeds. */
export function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Defaults ───────────────────────────────────────────────────────────

export function defaultSpinnerTiming() {
  return {
    startDuration: 0.4,
    startEase: 'easeIn',
    /** Full spin speed in cells per second. */
    spinSpeed: 12,
    stopDuration: 0.6,
    /** Positional ease of the stop travel (0→1 over the stop duration). */
    stopEase: 'easeOut',
    reelStaggerStart: 0.08,
    reelStaggerStop: 0.15
  };
}

export function defaultSpinnerBounce() {
  return { curve: 'backOut', amplitude: 0.45, durationFrac: 0.4 };
}

export function defaultSpinnerBlur() {
  // Crossfade thresholds in cells/second: fully static at vLo, fully
  // blurred at vHi.
  return { enabled: true, vLo: 4, vHi: 9 };
}

export function defaultSpinnerEvents() {
  return { winDelay: 0.15, landAnimDuration: 0.5, winAnimDuration: 1.0 };
}

// ── Normalization ──────────────────────────────────────────────────────

function num(v, fallback, min = -Infinity, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSymbol(s) {
  if (!s || typeof s !== 'object' || !s.id) return null;
  const anim = (a) => {
    if (!a || typeof a !== 'object') return null;
    const kind = a.kind === 'spine' || a.kind === 'pop' ? a.kind : 'none';
    if (kind === 'none') return null;
    if (kind === 'spine' && (!a.assetId || !a.anim)) return null;
    return { kind, assetId: a.assetId || null, anim: a.anim || null };
  };
  return {
    id: String(s.id),
    name: typeof s.name === 'string' ? s.name : String(s.id),
    assetId: s.assetId || null,
    blurAssetId: s.blurAssetId || null,
    landAnim: anim(s.landAnim),
    winAnim: anim(s.winAnim)
  };
}

/**
 * Normalize a spinner config. Returns null when unusable (no symbols or
 * degenerate grid). Strips and initialBoard are regenerated from the seed
 * when missing or shaped wrong, so a hand-authored partial config is valid.
 */
export function normalizeSpinnerConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const symbols = (Array.isArray(raw.symbols) ? raw.symbols : [])
    .map(normalizeSymbol).filter(Boolean);
  if (!symbols.length) return null;

  const grid = {
    reels: Math.round(num(raw.grid?.reels, 5, 1, 12)),
    rows: Math.round(num(raw.grid?.rows, 3, 1, 10)),
    cellW: num(raw.grid?.cellW, 200, 8, 4096),
    cellH: num(raw.grid?.cellH, 200, 8, 4096),
    spacingX: num(raw.grid?.spacingX, 0, 0, 1024),
    spacingY: num(raw.grid?.spacingY, 0, 0, 1024)
  };

  const seed = (Number.isFinite(Number(raw.seed)) ? Number(raw.seed) : 1) >>> 0;
  const symbolIds = symbols.map((s) => s.id);

  let strips = Array.isArray(raw.strips) ? raw.strips : null;
  const stripsValid = strips
    && strips.length === grid.reels
    && strips.every((st) => Array.isArray(st) && st.length >= grid.rows + 2
      && st.every((id) => symbolIds.includes(id)));
  if (!stripsValid) strips = generateStrips(symbolIds, grid.reels, SPINNER_DEFAULT_STRIP_LEN, seed);

  let initialBoard = Array.isArray(raw.initialBoard) ? raw.initialBoard : null;
  const boardValid = initialBoard
    && initialBoard.length === grid.reels
    && initialBoard.every((col) => Array.isArray(col) && col.length === grid.rows
      && col.every((id) => symbolIds.includes(id)));
  if (!boardValid) initialBoard = generateNonWinningBoard(symbolIds, grid.reels, grid.rows, seed);

  const t = raw.timing || {};
  const dt = defaultSpinnerTiming();
  const b = raw.bounce || {};
  const db = defaultSpinnerBounce();
  const bl = raw.blur || {};
  const dbl = defaultSpinnerBlur();
  const ev = raw.events || {};
  const dev = defaultSpinnerEvents();

  return {
    rev: Math.round(num(raw.rev, 1, 1)),
    symbols,
    grid,
    strips,
    initialBoard,
    seed,
    direction: raw.direction === -1 ? -1 : 1,
    timing: {
      startDuration: num(t.startDuration, dt.startDuration, 0.01, 30),
      startEase: normalizeCurveSpec(t.startEase, dt.startEase),
      spinSpeed: num(t.spinSpeed, dt.spinSpeed, 0.1, 200),
      stopDuration: num(t.stopDuration, dt.stopDuration, 0.01, 30),
      stopEase: normalizeCurveSpec(t.stopEase, dt.stopEase),
      reelStaggerStart: num(t.reelStaggerStart, dt.reelStaggerStart, 0, 10),
      reelStaggerStop: num(t.reelStaggerStop, dt.reelStaggerStop, 0, 10)
    },
    bounce: {
      curve: normalizeCurveSpec(b.curve, db.curve),
      amplitude: num(b.amplitude, db.amplitude, 0, 2),
      durationFrac: num(b.durationFrac, db.durationFrac, 0.05, 1)
    },
    blur: {
      enabled: bl.enabled !== false,
      vLo: num(bl.vLo, dbl.vLo, 0, 200),
      vHi: num(bl.vHi, dbl.vHi, 0.1, 200)
    },
    events: {
      winDelay: num(ev.winDelay, dev.winDelay, 0, 10),
      landAnimDuration: num(ev.landAnimDuration, dev.landAnimDuration, 0.05, 30),
      winAnimDuration: num(ev.winAnimDuration, dev.winAnimDuration, 0.05, 60)
    },
    perReel: Array.isArray(raw.perReel)
      ? raw.perReel.slice(0, grid.reels).map((o) => (o && typeof o === 'object' ? { ...o } : null))
      : []
  };
}

/**
 * Normalize the action-specific payload stored on a spinner clip
 * (`clip.spinner`). `action` decides which keys are meaningful; unknown
 * keys are dropped. The target board, when present, is validated against
 * the grid lazily at resolve time (the config may not be at hand here).
 */
export function normalizeSpinnerClipPayload(action, raw) {
  if (!SPINNER_ACTIONS.includes(action)) return null;
  const p = raw && typeof raw === 'object' ? raw : {};
  const delays = (arr) => (Array.isArray(arr)
    ? arr.map((d) => num(d, 0, 0, 30))
    : null);
  if (action === 'startSpin') {
    return {
      startEase: p.startEase != null ? normalizeCurveSpec(p.startEase, 'easeIn') : null,
      perReelStartDelay: delays(p.perReelStartDelay)
    };
  }
  if (action === 'spin') {
    return {
      spinSpeed: p.spinSpeed != null ? num(p.spinSpeed, null, 0.1, 200) : null,
      rampEase: p.rampEase != null ? normalizeCurveSpec(p.rampEase, 'easeInOut') : null
    };
  }
  if (action === 'stopSpin') {
    const board = Array.isArray(p.targetBoard)
      && p.targetBoard.every((col) => Array.isArray(col) && col.every((id) => typeof id === 'string'))
      ? p.targetBoard.map((col) => col.slice())
      : null;
    return {
      targetBoard: board,
      boardSeed: p.boardSeed != null ? (Number(p.boardSeed) >>> 0) : null,
      stopEase: p.stopEase != null ? normalizeCurveSpec(p.stopEase, 'easeOut') : null,
      stopDuration: p.stopDuration != null ? num(p.stopDuration, null, 0.01, 30) : null,
      perReelStopDelay: delays(p.perReelStopDelay),
      randomResult: p.randomResult === true,
      matchEntrySpeed: p.matchEntrySpeed !== false,
      bounce: p.bounce && typeof p.bounce === 'object'
        ? {
            curve: normalizeCurveSpec(p.bounce.curve, 'backOut'),
            amplitude: num(p.bounce.amplitude, 0.35, 0, 2),
            durationFrac: num(p.bounce.durationFrac, 0.35, 0.05, 1)
          }
        : null
    };
  }
  return {}; // holdResult has no params (yet)
}

// ── Strips & boards ────────────────────────────────────────────────────

/**
 * Generate one reel strip: every symbol appears with equal weight, shuffled,
 * with no two equal symbols adjacent where avoidable (also across the
 * modulo seam).
 */
export function generateStrip(symbolIds, length, rand) {
  const strip = [];
  for (let i = 0; i < length; i++) strip.push(symbolIds[i % symbolIds.length]);
  // Fisher-Yates
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  // Break up adjacent duplicates (incl. the wrap seam) by swapping forward.
  for (let i = 0; i < strip.length; i++) {
    const next = (i + 1) % strip.length;
    if (strip[i] !== strip[next]) continue;
    for (let k = 0; k < strip.length; k++) {
      const cand = (next + 1 + k) % strip.length;
      const candPrev = (cand - 1 + strip.length) % strip.length;
      const candNext = (cand + 1) % strip.length;
      if (strip[cand] !== strip[i]
        && strip[candPrev] !== strip[next] && strip[candNext] !== strip[next]
        && strip[i] !== strip[cand]) {
        [strip[next], strip[cand]] = [strip[cand], strip[next]];
        break;
      }
    }
  }
  return strip;
}

export function generateStrips(symbolIds, reels, length, seed) {
  const out = [];
  for (let r = 0; r < reels; r++) {
    out.push(generateStrip(symbolIds, length, mulberry32((seed ^ hash32(`strip${r}`)) >>> 0)));
  }
  return out;
}

// ── Ways win evaluation ────────────────────────────────────────────────
// v1 win rule (SPINNER.md §5): a symbol wins when it appears on
// WAYS_MIN_COUNT+ consecutive reels starting from reel 0, in any rows.

/**
 * @param {string[][]} board [reel][row] symbol ids
 * @returns {Array<{symbolId, count, cells: Array<{reel, row}>}>}
 */
export function evalWaysWins(board) {
  if (!Array.isArray(board) || !board.length) return [];
  const wins = [];
  const firstReelSymbols = [...new Set(board[0])];
  for (const symbolId of firstReelSymbols) {
    let count = 0;
    for (let r = 0; r < board.length; r++) {
      if (board[r].includes(symbolId)) count++;
      else break;
    }
    if (count >= WAYS_MIN_COUNT) {
      const cells = [];
      for (let r = 0; r < count; r++) {
        for (let row = 0; row < board[r].length; row++) {
          if (board[r][row] === symbolId) cells.push({ reel: r, row });
        }
      }
      wins.push({ symbolId, count, cells });
    }
  }
  return wins;
}

export function boardHasWin(board) {
  return evalWaysWins(board).length > 0;
}

function randomBoard(symbolIds, reels, rows, rand) {
  const board = [];
  for (let r = 0; r < reels; r++) {
    const col = [];
    for (let j = 0; j < rows; j++) col.push(symbolIds[Math.floor(rand() * symbolIds.length)]);
    board.push(col);
  }
  return board;
}

/**
 * Seeded random board guaranteed to have no ways win. Rejection sampling
 * first; if the config makes that unlikely (few symbols, many rows), a
 * greedy fix-up clears reel-2 occurrences of any symbol spanning reels
 * 0..2 — a win needs presence on the first three reels, so breaking the
 * third reel kills every win.
 */
export function generateNonWinningBoard(symbolIds, reels, rows, seed) {
  const rand = mulberry32(seed >>> 0);
  let board = randomBoard(symbolIds, reels, rows, rand);
  for (let attempt = 0; attempt < 200 && boardHasWin(board); attempt++) {
    board = randomBoard(symbolIds, reels, rows, rand);
  }
  if (!boardHasWin(board)) return board;
  if (reels < WAYS_MIN_COUNT) return board; // can't win at all; unreachable here
  const fixReel = WAYS_MIN_COUNT - 1; // reel index 2
  for (let guard = 0; guard < rows * 4 && boardHasWin(board); guard++) {
    const offenders = evalWaysWins(board).map((w) => w.symbolId);
    for (let row = 0; row < rows; row++) {
      if (!offenders.includes(board[fixReel][row])) continue;
      // Prefer a replacement absent from reel 0 — it can never start a win.
      const safe = symbolIds.filter((id) => !board[0].includes(id));
      const pool = safe.length ? safe : symbolIds.filter((id) => !offenders.includes(id));
      if (!pool.length) return board; // pathological config; give up gracefully
      board[fixReel][row] = pool[Math.floor(rand() * pool.length)];
    }
  }
  return board;
}

/**
 * Seeded random board guaranteed to HAVE a ways win — used by the board
 * editor's "randomize (force win)" so artists can preview win animations.
 */
export function generateWinningBoard(symbolIds, reels, rows, seed) {
  const rand = mulberry32((seed ^ 0x5f3759df) >>> 0);
  const board = randomBoard(symbolIds, reels, rows, rand);
  if (boardHasWin(board)) return board;
  const symbolId = symbolIds[Math.floor(rand() * symbolIds.length)];
  const count = Math.min(reels, WAYS_MIN_COUNT + Math.floor(rand() * Math.max(1, reels - WAYS_MIN_COUNT + 1)));
  for (let r = 0; r < count; r++) {
    board[r][Math.floor(rand() * rows)] = symbolId;
  }
  return board;
}

/**
 * The target board a stopSpin clip lands. Explicit board wins; otherwise a
 * seeded non-winning board derived from the clip (stable across sessions).
 */
export function targetBoardForClip(config, clip) {
  const payload = clip?.spinner || {};
  const { reels, rows } = config.grid;
  const ids = config.symbols.map((s) => s.id);
  // randomResult=true: always derive a seeded non-winning board, ignore any saved targetBoard.
  const explicit = payload.randomResult ? null : payload.targetBoard;
  if (Array.isArray(explicit) && explicit.length === reels
    && explicit.every((col) => Array.isArray(col) && col.length === rows
      && col.every((id) => ids.includes(id)))) {
    return explicit;
  }
  const seed = payload.boardSeed != null
    ? payload.boardSeed >>> 0
    : (config.seed ^ hash32(clip?.id || 'stop')) >>> 0;
  return generateNonWinningBoard(ids, reels, rows, seed);
}
