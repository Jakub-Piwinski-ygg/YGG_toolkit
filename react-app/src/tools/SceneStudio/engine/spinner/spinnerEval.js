// engine/spinner/spinnerEval.js
//
// Deterministic spinner evaluator — Phase 5, see react-app/SPINNER.md §2.
// PURE module: no Pixi, no React, no DOM, no Date/random. Everything is a
// function of (config, track clips, t); this file is the portable contract
// that the Pixi runtime renders and that YggSpinner.cs re-implements 1:1
// for the Unity export.
//
// Model: per reel, scroll s(t) in CELLS, monotonically increasing while
// spinning. Row j shows the symbol at absolute strip index floor(s)+j —
// modulo strip lookup behind an "absolute overlay" map that pins the
// initial board (abs 0..rows-1) and each stopSpin's target board (abs
// finalScroll..finalScroll+rows-1). Absolute indices never wrap, so
// consecutive stops can't collide.
//
// Direction note: scroll s always INCREASES while spinning, in both spin
// directions. `config.direction` only decides how visual rows map onto
// strip indices: for direction −1 (symbols move up) visual row j shows
// abs index floor(s)+j; for direction +1 (symbols move down, the default)
// the window is vertically mirrored — visual row j shows
// floor(s)+(rows−1−j) — so increasing s renders as downward travel and
// the boards you author are exactly the boards you see, top-to-bottom.
//
// The track resolves into per-reel SEGMENT lists over absolute scene time:
//   const — constant speed (covers idle, stagger waits, sustained spin,
//           gap bridging between clips, and the infinite tail)
//   ramp  — v0 → v1 over full duration d with ease E (speed profile;
//           scroll uses the ease's integral via LUT). A segment may end
//           before d elapses — that's a truncated startSpin, and the next
//           clip stitches from the exact exit state.
//   decel — positional ease B covering D cells over dsEff seconds, landing
//           on an integer scroll, with an additive bounce window at the end.

import { curveEval } from '../animation/curves.js';
import { SPINNER_ACTIONS, targetBoardForClip, evalWaysWins, classifySymbols } from './spinnerModel.js';

const LUT_N = 256;
const EPS_V = 1e-6;

// ── Curve LUTs (value + cumulative integral) ───────────────────────────

const _lutCache = new Map();

/**
 * Build (or fetch) the sampled value table and cumulative trapezoid
 * integral of a curve spec. Deterministic and frame-rate independent —
 * the C# port uses the same N and the same trapezoid rule.
 */
export function curveLUT(spec) {
  const key = typeof spec === 'string' ? spec : JSON.stringify(spec);
  let lut = _lutCache.get(key);
  if (lut) return lut;
  const vals = new Float64Array(LUT_N + 1);
  const integ = new Float64Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) vals[i] = curveEval(spec, i / LUT_N);
  for (let i = 1; i <= LUT_N; i++) {
    integ[i] = integ[i - 1] + (vals[i - 1] + vals[i]) / 2 / LUT_N;
  }
  lut = { N: LUT_N, vals, integ };
  _lutCache.set(key, lut);
  return lut;
}

function lutLerp(arr, N, p) {
  const x = Math.max(0, Math.min(1, p)) * N;
  const i = Math.min(N - 1, Math.floor(x));
  const fr = x - i;
  return arr[i] + fr * (arr[i + 1] - arr[i]);
}

/** ∫₀^p E(u) du via the cumulative trapezoid table. */
export function lutIntegral(lut, p) { return lutLerp(lut.integ, lut.N, p); }

/** E(p) via the value table (matches what the integral integrates). */
export function lutValue(lut, p) { return lutLerp(lut.vals, lut.N, p); }

/**
 * dE/dp at p — the EXACT derivative of the piecewise-linear interpolation
 * lutValue performs (constant per LUT cell). Using the same discretization
 * everywhere keeps entry-speed matching at stop boundaries exact instead of
 * "two different slope estimates disagree by a hair".
 */
export function lutDeriv(lut, p) {
  const N = lut.N;
  const i = Math.min(N - 1, Math.max(0, Math.floor(Math.max(0, Math.min(1, p)) * N)));
  return (lut.vals[i + 1] - lut.vals[i]) * N;
}

// ── Per-reel timing (Layer-2 defaults + Layer-3 sparse overrides) ──────

export function reelTiming(config, r) {
  const o = config.perReel?.[r] || {};
  const t = config.timing;
  return {
    startDuration: o.startDuration ?? t.startDuration,
    startEase: o.startEase ?? t.startEase,
    spinSpeed: o.spinSpeed ?? t.spinSpeed,
    stopDuration: o.stopDuration ?? t.stopDuration,
    stopEase: o.stopEase ?? t.stopEase
  };
}

// ── Segment construction ───────────────────────────────────────────────

function pushConst(segments, st, tEnd) {
  if (!(tEnd > st.t)) return;
  segments.push({ kind: 'const', t0: st.t, t1: tEnd, s0: st.s, v0: st.v });
  if (Number.isFinite(tEnd)) {
    st.s += st.v * (tEnd - st.t);
    st.t = tEnd;
  }
}

function pushRamp(segments, st, tEnd, v1, d, ease) {
  if (!(tEnd > st.t) || !(d > 0)) return;
  const lut = curveLUT(ease);
  const seg = { kind: 'ramp', t0: st.t, t1: tEnd, s0: st.s, v0: st.v, v1, d, ease };
  segments.push(seg);
  const p = Math.min(1, (tEnd - st.t) / d);
  st.s = seg.s0 + seg.v0 * (tEnd - st.t) + (v1 - seg.v0) * d * lutIntegral(lut, p);
  st.v = seg.v0 + (v1 - seg.v0) * lutValue(lut, p);
  st.t = tEnd;
}

function pushDecel(segments, st, D, dsEff, easePos, bounce) {
  const tEnd = st.t + dsEff;
  segments.push({
    kind: 'decel', t0: st.t, t1: tEnd, s0: st.s, v0: st.v,
    D, ds: dsEff, easePos, bounce: bounce || null
  });
  st.s += D;
  st.v = 0;
  st.t = tEnd;
}

/**
 * Entry slope of the positional stop ease — taken from the same LUT
 * derivative the evaluator uses, so matched entry speed is exact, then
 * clamped to sane values (a near-flat-start curve would otherwise demand
 * absurd travel distances).
 */
function stopEntrySlope(easePos) {
  return Math.max(0.25, Math.min(6, lutDeriv(curveLUT(easePos), 0)));
}

// ── Resolve chain ──────────────────────────────────────────────────────

/**
 * Cheap stable key for memoizing a resolve. Recompute the resolve whenever
 * this changes (clip edits, config edits) — no event wiring needed.
 * `startBoard` (direct-mode carry-in — see resolveSpinnerTrack) is part of the
 * key so a spinner re-resolves when a preceding scenario segment hands off a
 * different landed board.
 */
export function spinnerResolveKey(config, track, startBoard = null, outcome = null) {
  return JSON.stringify([
    config.rev, config.seed, config.grid, config.timing, config.bounce,
    config.blur, config.events, config.perReel, config.direction,
    (track?.clips || []).map((c) => [c.id, c.start, c.duration, c.action, c.spinner]),
    startBoard,
    // Direct-mode outcome override + the name-derived wild id (symbol names
    // aren't otherwise in the key, but they decide wild substitution).
    outcome,
    classifySymbols(config).wildId
  ]);
}

/** The action track = the first track carrying any spinner-action clip. */
export function pickSpinnerActionTrack(tracks) {
  for (const tr of tracks || []) {
    if ((tr.clips || []).some((c) => SPINNER_ACTIONS.includes(c.action))) return tr;
  }
  return (tracks && tracks[0]) || null;
}

/** True when `board` is a valid symbolId[reels][rows] matrix for this grid. */
function isValidBoard(config, board) {
  const { reels, rows } = config.grid;
  return Array.isArray(board) && board.length === reels
    && board.every((col) => Array.isArray(col) && col.length === rows);
}

/**
 * Walk a spinner track's action clips in order and produce per-reel segment
 * lists, the absolute symbol overlay, and the land/win event table.
 *
 * Gap semantics: between clips the reel CONTINUES at its exit speed (so the
 * small gaps the timeline's adjacent-add can leave never break continuity);
 * an explicit freeze is authored with `holdResult`. After the last clip the
 * final dynamics continue forever (landed reels stay landed, an unstopped
 * spin keeps spinning).
 *
 * `startBoard` (optional): the pre-spin board the reels show before the first
 * clip, replacing `config.initialBoard`. Direct-mode scenario playback threads
 * the board a spinner landed on in a preceding timeline segment through here so
 * the reels HOLD their result across a timeline hand-off instead of snapping
 * back to the authored initial board.
 *
 * `outcome` (optional): a Direct-mode per-node result override ('noWin' /
 * 'smallWin' / 'bigWin' / 'wildWin') — every stopSpin clip then lands a board
 * generated for that outcome instead of its authored/seeded one.
 */
export function resolveSpinnerTrack(config, track, startBoard = null, outcome = null) {
  const { reels: R, rows } = config.grid;
  const wildId = classifySymbols(config).wildId;
  const segments = Array.from({ length: R }, () => []);
  const overlayAbs = Array.from({ length: R }, () => new Map());
  const state = Array.from({ length: R }, () => ({ s: 0, v: 0, t: 0 }));
  const stops = [];
  const clipMeta = [];

  // Visual row j ↔ strip-window offset (mirrored for downward scroll).
  const rowOffset = (j) => (config.direction === 1 ? rows - 1 - j : j);

  const seedBoard = isValidBoard(config, startBoard) ? startBoard : config.initialBoard;
  for (let r = 0; r < R; r++) {
    for (let j = 0; j < rows; j++) overlayAbs[r].set(rowOffset(j), seedBoard[r][j]);
  }

  const clips = (track?.clips || [])
    .filter((c) => c && SPINNER_ACTIONS.includes(c.action))
    .slice()
    .sort((a, b) => a.start - b.start);

  for (const clip of clips) {
    const tA = clip.start;
    const tB = clip.start + clip.duration;
    const payload = clip.spinner || {};
    const meta = { clipId: clip.id, action: clip.action, perReel: [] };

    let target = null;
    if (clip.action === 'stopSpin') target = targetBoardForClip(config, clip, outcome);
    const landAt = new Array(R).fill(null);

    for (let r = 0; r < R; r++) {
      const st = state[r];
      const rt = reelTiming(config, r);
      const entry = { s: st.s, v: st.v };
      pushConst(segments[r], st, tA); // bridge any gap at exit speed

      if (clip.action === 'startSpin') {
        const delay = payload.perReelStartDelay?.[r] ?? r * config.timing.reelStaggerStart;
        pushConst(segments[r], st, tA + delay);
        const ease = payload.startEase ?? rt.startEase;
        const rampEnd = Math.min(tB, st.t + rt.startDuration);
        pushRamp(segments[r], st, rampEnd, rt.spinSpeed, rt.startDuration, ease);
        pushConst(segments[r], st, tB);
      } else if (clip.action === 'spin') {
        const vmax = payload.spinSpeed ?? rt.spinSpeed;
        if (Math.abs(st.v - vmax) > EPS_V) {
          // Ramp the remainder: a startSpin cut short exits below vmax and
          // we lerp up over a proportional slice of the start duration —
          // scroll continuity is exact by construction.
          const frac = Math.abs(1 - st.v / vmax);
          const dr = Math.max(0.05, rt.startDuration * frac);
          const ease = payload.rampEase ?? 'easeInOut';
          pushRamp(segments[r], st, Math.min(tB, st.t + dr), vmax, dr, ease);
        }
        pushConst(segments[r], st, tB);
      } else if (clip.action === 'stopSpin') {
        const delay = payload.perReelStopDelay?.[r] ?? r * config.timing.reelStaggerStop;
        pushConst(segments[r], st, tA + delay); // keep spinning until this reel's turn
        const easePos = payload.stopEase ?? rt.stopEase;
        const ds = payload.stopDuration ?? rt.stopDuration;
        const bounce = payload.bounce ?? config.bounce;
        const v0 = st.v;
        const minCells = rows + 2;
        let sFinal, dsEff;
        if (v0 < 0.01) {
          // Stop from (near) rest — degenerate authoring; still land a board.
          sFinal = Math.ceil(st.s) + minCells;
          dsEff = ds;
        } else {
          const slope0 = stopEntrySlope(easePos);
          const dRaw = v0 * ds / slope0;
          sFinal = Math.max(Math.ceil(st.s + dRaw), Math.ceil(st.s) + minCells);
          dsEff = payload.matchEntrySpeed !== false
            ? (sFinal - st.s) * slope0 / v0
            : ds;
        }
        const D = sFinal - st.s;
        pushDecel(segments[r], st, D, dsEff, easePos, bounce);
        st.s = sFinal; // exact integer landing (kill float residue)
        for (let j = 0; j < rows; j++) overlayAbs[r].set(sFinal + rowOffset(j), target[r][j]);
        landAt[r] = st.t;
        pushConst(segments[r], st, tB);
      } else { // holdResult — explicit freeze
        st.v = 0;
        pushConst(segments[r], st, tB);
      }

      meta.perReel.push({ entry, exit: { s: st.s, v: st.v }, endsAt: st.t });
    }

    if (clip.action === 'stopSpin') {
      const allLandedAt = Math.max(...landAt);
      const wins = evalWaysWins(target, wildId);
      const autoWinStart = allLandedAt + config.events.winDelay;
      // A substituting wild cell plays the WILD's own win anim (the cell's
      // visible symbol), not the substituted symbol's. Dedupe cells shared by
      // several wild-bridged wins.
      const winCellSeen = new Set();
      const winCells = [];
      for (const w of wins) {
        for (const c of w.cells) {
          const k = `${c.reel}:${c.row}`;
          if (winCellSeen.has(k)) continue;
          winCellSeen.add(k);
          winCells.push({ ...c, symbolId: target[c.reel][c.row] });
        }
      }
      stops.push({
        clipId: clip.id,
        target,
        landAt,
        allLandedAt,
        winCells,
        // Scalar base (auto = all reels land then winDelay). winStartByReel
        // carries the per-reel win timing the cell evaluator actually reads;
        // a presentWin clip later overrides both (see below). winExplicit
        // distinguishes "author placed a presentWin clip" from the auto path.
        winStartAt: autoWinStart,
        winStartByReel: new Array(R).fill(autoWinStart),
        winExplicit: false
      });
    } else if (clip.action === 'presentWin' && stops.length) {
      // §A: the win plays when the author placed this clip, not the auto
      // winDelay. Bind it to the most recent stop and stagger reel-by-reel.
      const stop = stops[stops.length - 1];
      const stagger = payload.reelWinStagger || 0;
      stop.winStartByReel = stop.winStartByReel.map(
        (_, r) => clip.start + (payload.perReelWinDelay?.[r] ?? r * stagger)
      );
      stop.winStartAt = Math.min(...stop.winStartByReel);
      stop.winExplicit = true;
    }
    clipMeta.push(meta);
  }

  for (let r = 0; r < R; r++) pushConst(segments[r], state[r], Infinity);

  return { segments, overlayAbs, stops, clipMeta };
}

// ── Evaluation ─────────────────────────────────────────────────────────

function evalSegment(seg, t) {
  const tau = t - seg.t0;
  if (seg.kind === 'const') {
    return { s: seg.s0 + seg.v0 * tau, v: seg.v0, bounceOffset: 0 };
  }
  if (seg.kind === 'ramp') {
    const lut = curveLUT(seg.ease);
    const p = Math.min(1, tau / seg.d);
    return {
      s: seg.s0 + seg.v0 * tau + (seg.v1 - seg.v0) * seg.d * lutIntegral(lut, p),
      v: seg.v0 + (seg.v1 - seg.v0) * lutValue(lut, p),
      bounceOffset: 0
    };
  }
  // decel — positional ease over the whole travel
  const lut = curveLUT(seg.easePos);
  const p = Math.min(1, tau / seg.ds);
  let bounceOffset = 0;
  const b = seg.bounce;
  if (b && b.amplitude > 0) {
    const pw = 1 - b.durationFrac;
    if (p >= pw) {
      const q = (p - pw) / b.durationFrac;
      bounceOffset = b.amplitude * (curveEval(b.curve, q) - q);
    }
  }
  return {
    s: seg.s0 + seg.D * lutValue(lut, p),
    v: seg.D * lutDeriv(lut, p) / seg.ds,
    bounceOffset
  };
}

function segmentAt(segments, t) {
  // Few segments per reel — linear scan is fine and allocation-free.
  for (let i = segments.length - 1; i >= 0; i--) {
    if (t >= segments[i].t0) return segments[i];
  }
  return segments[0] || null;
}

/** Symbol id at an absolute strip index (overlay first, modulo strip after). */
export function stripAt(config, resolved, reel, absIdx) {
  const ov = resolved.overlayAbs[reel].get(absIdx);
  if (ov != null) return ov;
  const strip = config.strips[reel];
  const L = strip.length;
  return strip[((absIdx % L) + L) % L];
}

/**
 * The single deterministic entry point. Returns, per reel:
 *   scroll      — s(t) in cells (float)
 *   baseIndex   — floor(scroll); row j shows abs index baseIndex + j
 *   frac        — scroll − baseIndex, the sub-cell offset
 *   speed       — cells/second at t
 *   blurMix     — 0 static … 1 fully blurred
 *   bounceOffset— additive display offset in cells (stop settle hump)
 *   cells       — rows + 2 entries, gridRow −1 … rows, each with
 *                 { gridRow, symbolId, state, stateT } where state is
 *                 'idle' | 'spinning' | 'landing' | 'win'
 *
 * Pure: same (config, resolved, t) → same result, any call order.
 */
export function evaluateSpinner(config, resolved, t) {
  const { reels: R, rows } = config.grid;
  const { blur, events } = config;
  const out = { t, reels: [] };

  // Per-symbol land/win animation lengths (seconds), resolved from the real
  // Spine data at build time. 0 = unknown → fall back to events.*AnimDuration.
  // Built once per evaluate; the window length below is per-symbol, not a fixed
  // config default, so a 3s win plays for 3s and a 1s win stops at 1s.
  const symMap = resolved.__symMap || (resolved.__symMap = new Map(
    (config.symbols || []).map((s) => [s.id, s])
  ));
  const winDurOf = (id) => {
    const d = symMap.get(id)?.winAnim?.duration;
    return d > 0 ? d : events.winAnimDuration;
  };
  const landDurOf = (id) => {
    const d = symMap.get(id)?.landAnim?.duration;
    return d > 0 ? d : events.landAnimDuration;
  };

  for (let r = 0; r < R; r++) {
    const seg = segmentAt(resolved.segments[r], t);
    const { s, v, bounceOffset } = seg
      ? evalSegment(seg, t)
      : { s: 0, v: 0, bounceOffset: 0 };
    const baseIndex = Math.floor(s);
    const frac = s - baseIndex;
    const speed = Math.abs(v);
    const blurMix = blur.enabled
      ? Math.max(0, Math.min(1, (speed - blur.vLo) / Math.max(1e-6, blur.vHi - blur.vLo)))
      : 0;

    // Latest stop whose landing (for this reel) is in the past.
    let stop = null;
    for (let i = resolved.stops.length - 1; i >= 0; i--) {
      if (resolved.stops[i].landAt[r] != null && t >= resolved.stops[i].landAt[r]) {
        stop = resolved.stops[i];
        break;
      }
    }

    const cells = [];
    for (let j = -1; j <= rows; j++) {
      const stripRow = config.direction === 1 ? rows - 1 - j : j;
      const symbolId = stripAt(config, resolved, r, baseIndex + stripRow);
      let cellState = speed > EPS_V ? 'spinning' : 'idle';
      let stateT = 0;
      if (speed <= EPS_V && stop && j >= 0 && j < rows) {
        const winStart = stop.winStartByReel ? stop.winStartByReel[r] : stop.winStartAt;
        // Window length is the WINNING SYMBOL's real win-anim length (fallback
        // events.winAnimDuration) — different symbols hold 'win' for different
        // amounts of time, never cut to a fixed default.
        const inWin = t >= winStart
          && t < winStart + winDurOf(symbolId)
          && stop.winCells.some((c) => c.reel === r && c.row === j);
        if (inWin) {
          cellState = 'win';
          stateT = t - winStart;
        } else if (t < stop.landAt[r] + landDurOf(symbolId)) {
          cellState = 'landing';
          stateT = t - stop.landAt[r];
        }
      }
      cells.push({ gridRow: j, symbolId, state: cellState, stateT });
    }

    out.reels.push({ scroll: s, baseIndex, frac, speed, blurMix, bounceOffset, cells });
  }
  return out;
}

/**
 * The board CURRENTLY VISIBLE (rows × reels of symbolIds) at time `t`. Used by
 * direct-mode scenario playback to snapshot the board a spinner ends a timeline
 * segment on, so the next segment can seed from it (see resolveSpinnerTrack's
 * `startBoard`). Sampled at a settled time it returns the landed board.
 *
 * @returns {Array<Array<string|null>>} board[reel][row]
 */
export function spinnerVisibleBoard(config, resolved, t) {
  const { reels: R, rows } = config.grid;
  const res = evaluateSpinner(config, resolved, t);
  const board = Array.from({ length: R }, () => new Array(rows).fill(null));
  for (let r = 0; r < R; r++) {
    for (const cell of res.reels[r].cells) {
      if (cell.gridRow >= 0 && cell.gridRow < rows) board[r][cell.gridRow] = cell.symbolId;
    }
  }
  return board;
}
