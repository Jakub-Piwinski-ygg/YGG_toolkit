// Node test: node winseqModel.test.mjs
import assert from 'node:assert';
import {
  parseWinAnimName, mapAnimationsToTiers, buildWinSeqFlows,
  normalizeWinSeqConfig, winSeqFlowDuration, evaluateWinSeqFlow, findWinSeqFlow,
} from './winseqModel.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

// ── name parsing ────────────────────────────────────────────────────────────
ok('parse valid name', () => {
  assert.deepEqual(parseWinAnimName('01a_small_begin'), { num: '01', letter: 'a', tier: 'small', role: 'begin' });
  assert.deepEqual(parseWinAnimName('06c_mega_end').tier, 'mega');
});
ok('reject junk', () => {
  assert.equal(parseWinAnimName('idle'), null);
  assert.equal(parseWinAnimName('01a_unknown_begin'), null);
});

// Full skeleton: small,medium,big,super,mega (large+max present too)
const ALL = [
  '01a_small_begin', '01b_small_idle', '01c_small_end',
  '02a_medium_begin', '02b_medium_idle', '02c_medium_end',
  '03a_large_begin', '03b_large_idle', '03c_large_end',
  '04a_big_begin', '04b_big_idle', '04c_big_end',
  '05a_super_begin', '05b_super_idle', '05c_super_end',
  '06a_mega_begin', '06b_mega_idle', '06c_mega_end',
  '07a_max_begin', '07b_max_idle', '07c_max_end',
];

ok('map tiers, large/max default off', () => {
  const tiers = mapAnimationsToTiers(ALL);
  assert.equal(tiers.length, 7);
  const en = Object.fromEntries(tiers.map((t) => [t.key, t.enabled]));
  assert.equal(en.small, true);
  assert.equal(en.large, false); // optional → off by default
  assert.equal(en.max, false);
  assert.equal(en.big, true);
});

ok('small flow = begin→idle→end', () => {
  const tiers = mapAnimationsToTiers(ALL);
  const flows = buildWinSeqFlows(tiers);
  const small = flows.find((f) => f.id === 'win_small');
  assert.deepEqual(small.steps.map((s) => s.anim), ['01a_small_begin', '01b_small_idle', '01c_small_end']);
});

ok('medium escalates from small (no small end)', () => {
  const tiers = mapAnimationsToTiers(ALL);
  const flows = buildWinSeqFlows(tiers);
  const med = flows.find((f) => f.id === 'win_medium');
  assert.deepEqual(med.steps.map((s) => s.anim), [
    '01a_small_begin', '01b_small_idle', '02a_medium_begin', '02b_medium_idle', '02c_medium_end',
  ]);
});

ok('big skips large when large disabled', () => {
  const tiers = mapAnimationsToTiers(ALL); // large off
  const flows = buildWinSeqFlows(tiers);
  const big = flows.find((f) => f.id === 'win_big');
  assert.deepEqual(big.steps.map((s) => s.anim), [
    '01a_small_begin', '01b_small_idle',
    '02a_medium_begin', '02b_medium_idle',
    '04a_big_begin', '04b_big_idle', '04c_big_end',
  ]);
});

ok('big includes large when large enabled', () => {
  const tiers = mapAnimationsToTiers(ALL).map((t) => (t.key === 'large' ? { ...t, enabled: true } : t));
  const flows = buildWinSeqFlows(tiers);
  const big = flows.find((f) => f.id === 'win_big');
  assert.deepEqual(big.steps.map((s) => s.anim), [
    '01a_small_begin', '01b_small_idle',
    '02a_medium_begin', '02b_medium_idle',
    '03a_large_begin', '03b_large_idle',
    '04a_big_begin', '04b_big_idle', '04c_big_end',
  ]);
});

ok('only present tiers chain (missing large skipped naturally)', () => {
  const partial = ['01a_small_begin', '01b_small_idle', '01c_small_end', '04a_big_begin', '04b_big_idle', '04c_big_end'];
  const tiers = mapAnimationsToTiers(partial);
  const flows = buildWinSeqFlows(tiers);
  const big = flows.find((f) => f.id === 'win_big');
  assert.deepEqual(big.steps.map((s) => s.anim), ['01a_small_begin', '01b_small_idle', '04a_big_begin', '04b_big_idle', '04c_big_end']);
});

// ── duration + evaluation ────────────────────────────────────────────────────
const cfg = normalizeWinSeqConfig({ tiers: mapAnimationsToTiers(ALL) });
const durations = Object.fromEntries(ALL.map((n) => [n, n.endsWith('_idle') ? 2 : 1]));

ok('config normalizes + derives sequences', () => {
  assert.ok(cfg);
  assert.ok(cfg.sequences.length >= 4);
});

ok('flow duration sums one cycle each', () => {
  const med = findWinSeqFlow(cfg, 'win_medium');
  // begin1 idle2 begin1 idle2 end1 = 7
  assert.equal(winSeqFlowDuration(med, durations), 7);
});

ok('hangOnLastIdle drops the end', () => {
  const med = findWinSeqFlow(cfg, 'win_medium');
  assert.equal(winSeqFlowDuration(med, durations, { hangOnLastIdle: true }), 6);
});

ok('evaluate picks the right step + local time', () => {
  const med = findWinSeqFlow(cfg, 'win_medium');
  // timeline: [0,1) small_begin, [1,3) small_idle, [3,4) medium_begin, [4,6) medium_idle, [6,7) medium_end
  assert.equal(evaluateWinSeqFlow(med, durations, 0.5).anim, '01a_small_begin');
  assert.equal(evaluateWinSeqFlow(med, durations, 2.0).anim, '01b_small_idle');
  let e = evaluateWinSeqFlow(med, durations, 4.5);
  assert.equal(e.anim, '02b_medium_idle');
  assert.equal(Number(e.animTime.toFixed(2)), 0.5);
  assert.equal(evaluateWinSeqFlow(med, durations, 6.5).anim, '02c_medium_end');
});

ok('hang mode loops the final idle past its window', () => {
  const med = findWinSeqFlow(cfg, 'win_medium');
  const e = evaluateWinSeqFlow(med, durations, 100, { hangOnLastIdle: true });
  assert.equal(e.anim, '02b_medium_idle');
  assert.equal(e.loop, true);
});

ok('single-frame (0-duration) anim is respected, not padded to 1s', () => {
  const med = findWinSeqFlow(cfg, 'win_medium');
  // small_idle is a single-frame anim → real duration 0 (present in the map).
  const d0 = { ...durations, '01b_small_idle': 0 };
  // begin1 idle0 begin1 idle2 end1 = 5 (was 7 with idle=2)
  assert.equal(winSeqFlowDuration(med, d0), 5);
});

ok('genuinely-unknown anim falls back to the default', () => {
  const med = findWinSeqFlow(cfg, 'win_medium');
  const partial = { '01a_small_begin': 1 }; // others absent → fallback 1.0 each
  // begin1 + idle1 + begin1 + idle1 + end1 = 5
  assert.equal(winSeqFlowDuration(med, partial), 5);
});

console.log(`\n${pass} win-sequence model tests passed.`);
