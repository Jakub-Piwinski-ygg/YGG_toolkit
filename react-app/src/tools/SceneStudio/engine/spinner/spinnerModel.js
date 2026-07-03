// engine/spinner/spinnerModel.js
//
// Framework-agnostic Spinner (slot reel machine) data model — Phase 5,
// see react-app/SPINNER.md. This module is PURE: no Pixi, no React, no DOM.
// It defines the spinner config schema, seeded generators for strips and
// boards, the "ways" win evaluation, and the per-clip action payload
// normalizer. The deterministic evaluator lives in spinnerEval.js.

import { normalizeCurveSpec } from '../animation/curves.js';

// `presentWin` (§A) is an explicit clip placed AFTER stopSpin that controls
// WHEN winning symbols play their win animation (replacing the auto-fired win
// from the evaluator). It carries a per-reel win stagger.
export const SPINNER_ACTIONS = ['startSpin', 'spin', 'stopSpin', 'presentWin', 'holdResult'];

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
    reelStaggerStop: 0.15,
    /**
     * Minimum at-full-speed spin time (seconds). Used as the duration of the
     * wizard's "test spin" and as the default duration for `spin` action clips
     * added to the timeline.
     */
    minSpinTime: 1.0
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
  // winAnimDuration / landAnimDuration are ONLY a FALLBACK, used when a
  // symbol's real Spine animation length is unknown (0). The win window and
  // the present-win clip's auto duration now prefer each symbol's actual
  // winAnim.duration / landAnim.duration (resolved from the Spine data at
  // build time and persisted on the symbol). The 2.0s fallback keeps a win
  // from visibly cutting off before durations resolve.
  return { winDelay: 0.15, landAnimDuration: 0.5, winAnimDuration: 2.0 };
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
    // Real Spine animation length in seconds, resolved at build time (web
    // runtime / Unity bake) from the referenced animation's data. 0 = unknown
    // (no Spine loaded yet); the evaluator then falls back to events.*AnimDuration.
    const duration = Number.isFinite(Number(a.duration)) && Number(a.duration) > 0 ? Number(a.duration) : 0;
    return {
      kind,
      assetId: a.assetId || null,
      anim: a.anim || null,
      // loop preserved (was dropped before — caused overlay pool key mismatch).
      loop: a.loop !== false,
      // Land/win timing offset in seconds (§B): play the anim this many seconds
      // before (negative) or after (positive) the exact land/win moment. 0 = on land.
      offset: Number.isFinite(Number(a.offset)) ? Number(a.offset) : 0,
      duration
    };
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
      reelStaggerStop: num(t.reelStaggerStop, dt.reelStaggerStop, 0, 10),
      minSpinTime: num(t.minSpinTime, dt.minSpinTime, 0.05, 60)
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
  if (action === 'presentWin') {
    return {
      // 0 = every winning symbol plays at once; >0 = cascade reel-by-reel
      // (reel 0 first, then reel 1 after `reelWinStagger` seconds, …).
      reelWinStagger: p.reelWinStagger != null ? num(p.reelWinStagger, 0, 0, 10) : 0,
      // Optional explicit per-reel win delay (overrides the linear stagger).
      perReelWinDelay: delays(p.perReelWinDelay)
    };
  }
  return {}; // holdResult has no params (yet)
}

// ── Clip-duration helpers (phase 3 §C) ─────────────────────────────────
// Compute the "natural" length for each spinner action clip so the inspector
// can offer a "set duration" button (mirrors the spine "set 1 cycle" button).
// All consume a normalized config (see normalizeSpinnerConfig).

/** Default spin (idle-at-full-speed) clip length, seconds. */
export const SPINNER_DEFAULT_SPIN_DURATION = 2;

/** Largest per-reel delay, falling back to (reels-1)*stagger when unset. */
function maxReelDelay(reels, perReel, stagger) {
  let m = 0;
  for (let r = 0; r < reels; r++) {
    const explicit = Array.isArray(perReel) && Number.isFinite(Number(perReel[r])) ? Number(perReel[r]) : r * stagger;
    if (explicit > m) m = explicit;
  }
  return m;
}

/**
 * startSpin: time until EVERY reel has ramped from rest to full spin speed —
 * the last reel's stagger delay plus the spin-up ramp. At the clip's end the
 * reels are effectively "in spin".
 */
export function spinnerStartSpinDuration(config, perReelStartDelay = null) {
  if (!config) return SPINNER_DEFAULT_SPIN_DURATION;
  const { reels } = config.grid;
  const t = config.timing || {};
  return Math.max(0.05, maxReelDelay(reels, perReelStartDelay, t.reelStaggerStart || 0) + (t.startDuration || 0));
}

/**
 * stopSpin: time until ALL reels have landed AND every symbol's land animation
 * has finished — the last reel's stop delay + decel duration + land-anim length.
 */
export function spinnerStopSpinDuration(config, perReelStopDelay = null) {
  if (!config) return 1;
  const { reels } = config.grid;
  const t = config.timing || {};
  const land = config.events?.landAnimDuration || 0;
  return Math.max(0.05, maxReelDelay(reels, perReelStopDelay, t.reelStaggerStop || 0) + (t.stopDuration || 0) + land);
}

/**
 * presentWin: time until every winning symbol's win animation has finished —
 * the last reel's win delay (stagger·(reels-1) or the explicit per-reel array)
 * plus the win-anim length.
 */
export function spinnerPresentWinDuration(config, reelWinStagger = 0, perReelWinDelay = null) {
  if (!config) return 1;
  const { reels } = config.grid;
  const fallback = config.events?.winAnimDuration || 0;
  // Longest win-anim across symbols: prefer each symbol's real duration,
  // falling back to events.winAnimDuration when unknown (0).
  let maxWinAnim = 0;
  for (const s of config.symbols || []) {
    const d = s.winAnim?.duration > 0 ? s.winAnim.duration : fallback;
    if (d > maxWinAnim) maxWinAnim = d;
  }
  if (maxWinAnim <= 0) maxWinAnim = fallback;
  return Math.max(0.05, maxReelDelay(reels, perReelWinDelay, reelWinStagger || 0) + maxWinAnim);
}

/**
 * One-shot "test spin" clip chain: startSpin → spin (minSpinTime) → stopSpin
 * → presentWin, exactly the cycle the scene timeline plays. Lands a seeded
 * WINNING board so the present-win phase has something to show. Used by the
 * wizard's test-spin preview. Returns { clips, total } with raw (un-normalized)
 * clips — the caller runs them through normalizeTrack before the resolver.
 */
export function buildSpinnerTestClips(config) {
  if (!config) return { clips: [], total: 1 };
  const t = config.timing || {};
  const start = spinnerStartSpinDuration(config);
  const spin = Math.max(0.05, Number(t.minSpinTime) > 0 ? Number(t.minSpinTime) : 1);
  const stop = spinnerStopSpinDuration(config);
  const present = spinnerPresentWinDuration(config);
  const ids = config.symbols.map((s) => s.id);
  const board = generateWinningBoard(ids, config.grid.reels, config.grid.rows, (config.seed ^ 0x7e57) >>> 0);
  const clips = [
    { id: 'ts_start', action: 'startSpin', start: 0, duration: start, spinner: {} },
    { id: 'ts_spin', action: 'spin', start: start, duration: spin, spinner: {} },
    { id: 'ts_stop', action: 'stopSpin', start: start + spin, duration: stop, spinner: { targetBoard: board } },
    { id: 'ts_present', action: 'presentWin', start: start + spin + stop, duration: present, spinner: {} }
  ];
  return { clips, total: start + spin + stop + present };
}

/**
 * Build a single ready-to-use timeline holding the complete spin chain
 * (startSpin → spin → stopSpin → presentWin) for the given spinner layer.
 * Returned as a raw { name, tracks } entry for
 * sceneModel.addPrebuiltTimelines (ids backfilled on normalize).
 */
export function buildSpinnerFullSpinTimeline(layerId, config) {
  const { clips } = buildSpinnerTestClips(config);
  return {
    name: 'spin · full',
    tracks: [{ layerId, clips }]
  };
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

// ── Symbol classification (name-based) ─────────────────────────────────
// Wild / low-pay / high-pay tiers are inferred from symbol NAMES — the studio
// convention: a wild contains "wild", lows carry an l/lo/low token ("L1",
// "lo_3", "low ace"), highs an h/hi/high token ("H2", "hi7"). Symbols matching
// neither fall back to list order (first half low, rest high — royals first).
// Used by the Direct-mode outcome board generators; nothing else changes
// behavior when the convention isn't followed.

const LOW_NAME_RE = /(^|[^a-z])(l|lo|low)(?=[^a-z]|\d|$)/i;
const HIGH_NAME_RE = /(^|[^a-z])(h|hi|high)(?=[^a-z]|\d|$)/i;

/** @returns {{ low: string[], high: string[], wildId: string|null }} */
export function classifySymbols(config) {
  const symbols = config?.symbols || [];
  const wildId = symbols.find((s) => /wild/i.test(s.name))?.id ?? null;
  const rest = symbols.filter((s) => s.id !== wildId);
  const low = [];
  const high = [];
  const unmatched = [];
  for (const s of rest) {
    if (LOW_NAME_RE.test(s.name)) low.push(s.id);
    else if (HIGH_NAME_RE.test(s.name)) high.push(s.id);
    else unmatched.push(s.id);
  }
  // Order-based fallback for unnamed tiers so both pools always cover the set.
  const half = Math.ceil(rest.length / 2) - low.length;
  unmatched.forEach((id, i) => (i < half ? low : high).push(id));
  if (!low.length && high.length) low.push(...high);
  if (!high.length && low.length) high.push(...low);
  return { low, high, wildId };
}

// ── Ways win evaluation ────────────────────────────────────────────────
// v1 win rule (SPINNER.md §5): a symbol wins when it appears on
// WAYS_MIN_COUNT+ consecutive reels starting from reel 0, in any rows.
// With a `wildId`, a wild substitutes for any symbol (display semantics):
// reels count while they contain the symbol OR a wild, and substituting wild
// cells join the win's cells.

/**
 * @param {string[][]} board [reel][row] symbol ids
 * @param {string|null} wildId optional wild symbol id (substitutes for any)
 * @returns {Array<{symbolId, count, cells: Array<{reel, row}>}>}
 */
export function evalWaysWins(board, wildId = null) {
  if (!Array.isArray(board) || !board.length) return [];
  const wins = [];
  // Candidates: reel-0 symbols; when reel 0 holds a wild, reel-1 symbols too
  // (a wild-led line substitutes for them). The wild itself never "wins".
  const candidates = new Set(board[0].filter((id) => id !== wildId));
  if (wildId && board[0].includes(wildId) && board.length > 1) {
    for (const id of board[1]) if (id !== wildId) candidates.add(id);
  }
  const matches = (cell, symbolId) => cell === symbolId || (wildId != null && cell === wildId);
  for (const symbolId of candidates) {
    let count = 0;
    for (let r = 0; r < board.length; r++) {
      if (board[r].some((cell) => matches(cell, symbolId))) count++;
      else break;
    }
    if (count >= WAYS_MIN_COUNT) {
      const cells = [];
      for (let r = 0; r < count; r++) {
        for (let row = 0; row < board[r].length; row++) {
          if (matches(board[r][row], symbolId)) cells.push({ reel: r, row });
        }
      }
      wins.push({ symbolId, count, cells });
    }
  }
  return wins;
}

export function boardHasWin(board, wildId = null) {
  return evalWaysWins(board, wildId).length > 0;
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
export function generateNonWinningBoard(symbolIds, reels, rows, seed, wildId = null) {
  // Wilds substitute for anything, so a guaranteed non-win excludes them.
  if (wildId != null) {
    const filtered = symbolIds.filter((id) => id !== wildId);
    if (filtered.length) symbolIds = filtered;
  }
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

// ── Outcome board generators (Direct-mode per-node overrides) ──────────
// All seeded/deterministic. Tiers + wild come from classifySymbols (name
// convention); every generator validates its post-condition with the
// wild-aware evalWaysWins before returning.

export const SPIN_OUTCOMES = ['default', 'noWin', 'smallWin', 'bigWin', 'wildWin'];

/** Fillers that can never START a win: symbols absent from reel 0. */
function fillCell(board, reel, row, pool, avoid, rand) {
  const reel0 = new Set(board[0].filter(Boolean));
  const safe = pool.filter((id) => !avoid.has(id) && (reel === 0 || !reel0.has(id)));
  const src = safe.length ? safe : pool.filter((id) => !avoid.has(id));
  board[reel][row] = (src.length ? src : pool)[Math.floor(rand() * (src.length ? src : pool).length)];
}

function emptyBoard(reels, rows) {
  return Array.from({ length: reels }, () => new Array(rows).fill(null));
}

/** Place `symbolId` spanning reels 0..count-1; stacks add extra same-reel cells. */
function placeRun(board, symbolId, count, rows, rand, stacks = 0) {
  const cells = [];
  for (let r = 0; r < count; r++) {
    const free = [];
    for (let row = 0; row < rows; row++) if (board[r][row] == null) free.push(row);
    if (!free.length) return null; // grid too dense for this run
    const row = free[Math.floor(rand() * free.length)];
    board[r][row] = symbolId;
    cells.push({ reel: r, row });
    // Occasional 2-high stack on middle reels → "many ways" feel.
    if (stacks > 0 && r > 0 && r < count - 1 && free.length > 1 && rand() < 0.5) {
      const row2 = free.filter((x) => x !== row)[0];
      board[r][row2] = symbolId;
      stacks--;
    }
  }
  return cells;
}

/** One modest win: a single 3..min(5,reels) run of one (mostly low) symbol. */
function generateSmallWinBoard(config, seed) {
  const { reels, rows } = config.grid;
  const { low, high, wildId } = classifySymbols(config);
  const ids = config.symbols.map((s) => s.id).filter((id) => id !== wildId);
  for (let attempt = 0; attempt < 100; attempt++) {
    const rand = mulberry32((seed + attempt * 0x9e3779b9) >>> 0);
    const pool = rand() < 0.7 && low.length ? low : high;
    const sym = pool[Math.floor(rand() * pool.length)];
    const k = Math.min(reels, WAYS_MIN_COUNT + Math.floor(rand() * (Math.min(5, reels) - WAYS_MIN_COUNT + 1)));
    const board = emptyBoard(reels, rows);
    placeRun(board, sym, k, rows, rand);
    const avoid = new Set([sym, wildId].filter(Boolean));
    for (let r = 0; r < reels; r++) {
      for (let row = 0; row < rows; row++) {
        if (board[r][row] == null) fillCell(board, r, row, ids, avoid, rand);
      }
    }
    const wins = evalWaysWins(board, wildId);
    if (wins.length === 1 && wins[0].symbolId === sym && wins[0].count === k) return board;
  }
  return generateWinningBoard(ids, reels, rows, seed);
}

/** Several long high-symbol runs with stacks — an impressive multi-way board. */
function generateBigWinBoard(config, seed) {
  const { reels, rows } = config.grid;
  const { low, high, wildId } = classifySymbols(config);
  const ids = config.symbols.map((s) => s.id).filter((id) => id !== wildId);
  const wantWins = Math.min(rows, 2 + (rows > 2 ? 1 : 0));
  for (let attempt = 0; attempt < 100; attempt++) {
    const rand = mulberry32((seed + attempt * 0x9e3779b9) >>> 0);
    const pool = [...new Set(high.length ? high : low)];
    const board = emptyBoard(reels, rows);
    const placed = [];
    for (let i = 0; i < wantWins && pool.length; i++) {
      const sym = pool.splice(Math.floor(rand() * pool.length), 1)[0];
      const k = Math.max(Math.min(reels, 4), reels - (rand() < 0.5 ? 1 : 0));
      if (placeRun(board, sym, k, rows, rand, 2)) placed.push({ sym, k });
    }
    if (!placed.length) break;
    const avoid = new Set([...placed.map((p) => p.sym), wildId].filter(Boolean));
    for (let r = 0; r < reels; r++) {
      for (let row = 0; row < rows; row++) {
        if (board[r][row] == null) fillCell(board, r, row, ids, avoid, rand);
      }
    }
    const wins = evalWaysWins(board, wildId);
    const minCount = Math.min(reels, 4);
    if (wins.length >= Math.min(wantWins, 2) && wins.every((w) => w.count >= Math.min(minCount, reels))) {
      return board;
    }
  }
  return generateWinningBoard(ids, reels, rows, seed);
}

/** Wild-heavy showcase: several combos completing THROUGH substituting wilds. */
function generateWildWinBoard(config, seed) {
  const { reels, rows } = config.grid;
  const { low, high, wildId } = classifySymbols(config);
  if (!wildId || reels < WAYS_MIN_COUNT) return generateBigWinBoard(config, seed);
  const ids = config.symbols.map((s) => s.id).filter((id) => id !== wildId);
  for (let attempt = 0; attempt < 50; attempt++) {
    const rand = mulberry32((seed + attempt * 0x85ebca6b) >>> 0);
    const board = emptyBoard(reels, rows);
    const mixed = [...new Set([...high, ...low])];
    const combos = [];
    const comboCount = Math.min(rows, 2 + (rand() < 0.5 ? 1 : 0));
    for (let i = 0; i < comboCount && mixed.length; i++) {
      const sym = mixed.splice(Math.floor(rand() * mixed.length), 1)[0];
      const k = Math.min(reels, WAYS_MIN_COUNT + Math.floor(rand() * (reels - WAYS_MIN_COUNT + 1)));
      const cells = placeRun(board, sym, k, rows, rand);
      if (cells) combos.push({ sym, cells });
    }
    if (!combos.length) break;
    // Swap middle-reel combo cells to wilds (never reel 0) so the combos
    // demonstrably complete through substitution. Wilds interact with every
    // combo crossing their reel.
    let wilds = 3 + Math.floor(rand() * 3); // 3..5
    for (const combo of combos) {
      const mid = combo.cells.filter((c) => c.reel > 0 && c.reel < reels - 1);
      for (const c of mid) {
        if (wilds <= 0) break;
        if (rand() < 0.6) { board[c.reel][c.row] = wildId; wilds--; }
      }
    }
    // Any remaining wild budget lands on free middle-reel cells.
    for (let r = 1; r < Math.min(reels - 1, 3) + 1 && wilds > 0; r++) {
      for (let row = 0; row < rows && wilds > 0; row++) {
        if (board[r][row] == null) { board[r][row] = wildId; wilds--; }
      }
    }
    const avoid = new Set([...combos.map((c) => c.sym), wildId]);
    for (let r = 0; r < reels; r++) {
      for (let row = 0; row < rows; row++) {
        if (board[r][row] == null) fillCell(board, r, row, ids, avoid, rand);
      }
    }
    const wins = evalWaysWins(board, wildId);
    const hasWildCells = board.some((col) => col.includes(wildId));
    const wildSubstitutes = wins.some((w) => w.cells.some((c) => board[c.reel][c.row] === wildId));
    if (wins.length >= Math.min(2, rows) && hasWildCells && wildSubstitutes) return board;
  }
  return generateBigWinBoard(config, seed);
}

/**
 * Dispatch a Direct-mode outcome override to its board generator.
 * `outcome` ∈ SPIN_OUTCOMES minus 'default' (callers skip 'default').
 */
export function generateOutcomeBoard(config, outcome, seed) {
  const { reels, rows } = config.grid;
  const ids = config.symbols.map((s) => s.id);
  const { wildId } = classifySymbols(config);
  switch (outcome) {
    case 'noWin': return generateNonWinningBoard(ids, reels, rows, seed, wildId);
    case 'smallWin': return generateSmallWinBoard(config, seed);
    case 'bigWin': return generateBigWinBoard(config, seed);
    case 'wildWin': return generateWildWinBoard(config, seed);
    default: return null;
  }
}

/**
 * The target board a stopSpin clip lands. A Direct-mode `outcome` override
 * wins over everything; then an explicit authored board; otherwise a seeded
 * non-winning board derived from the clip (stable across sessions).
 */
export function targetBoardForClip(config, clip, outcome = null) {
  const payload = clip?.spinner || {};
  const { reels, rows } = config.grid;
  const ids = config.symbols.map((s) => s.id);
  if (outcome && outcome !== 'default' && SPIN_OUTCOMES.includes(outcome)) {
    const seed = (config.seed ^ hash32(`${clip?.id || 'stop'}::${outcome}`)) >>> 0;
    const board = generateOutcomeBoard(config, outcome, seed);
    if (board) return board;
  }
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
