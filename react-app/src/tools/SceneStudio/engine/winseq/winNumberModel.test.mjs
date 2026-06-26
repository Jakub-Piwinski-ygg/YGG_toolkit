// Node test: node winNumberModel.test.mjs
import assert from 'node:assert';
import { buildWinSeqFlows } from './winseqModel.js';
import {
  winNumberValueAt, formatWinNumber, normalizeWinNumber, SMALL_FINAL,
} from './winNumberModel.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// Tiers small,medium,big,super,mega (large + max off → skipped).
const mk = (key, num) => ({
  key, num, optional: false, present: true, enabled: true,
  begin: `${num}a_${key}_begin`, idle: `${num}b_${key}_idle`, end: `${num}c_${key}_end`,
});
const TIERS = [mk('small', '01'), mk('medium', '02'), mk('big', '04'), mk('super', '05'), mk('mega', '06')];
const FLOWS = buildWinSeqFlows(TIERS);
const flow = (id) => FLOWS.find((f) => f.id === id);

// Every step is 1.0s long.
const DUR = {};
for (const t of TIERS) for (const a of [t.begin, t.idle, t.end]) DUR[a] = 1.0;

ok('flows built (small..mega, large skipped)', () => {
  assert.deepEqual(FLOWS.map((f) => f.id), ['win_small', 'win_medium', 'win_big', 'win_super', 'win_mega']);
});

ok('mega flow hits each tier threshold at its boundary (wager 1)', () => {
  const f = flow('win_mega');
  // segments: small[0,2] med[2,4] big[4,6] super[6,8] mega[8,11(+end)]
  near(winNumberValueAt(f, DUR, 0, { wager: 1 }), 0);
  near(winNumberValueAt(f, DUR, 2, { wager: 1 }), 1);    // → medium threshold
  near(winNumberValueAt(f, DUR, 4, { wager: 1 }), 20);   // → big threshold (large skipped)
  near(winNumberValueAt(f, DUR, 6, { wager: 1 }), 40);   // → super threshold
  near(winNumberValueAt(f, DUR, 8, { wager: 1 }), 80);   // → mega threshold
  near(winNumberValueAt(f, DUR, 11, { wager: 1 }), 120); // mega final
});

ok('past-end holds the final value', () => {
  near(winNumberValueAt(flow('win_mega'), DUR, 999, { wager: 1 }), 120);
});

ok('count-up is deterministic / scrub-safe (same t → same value)', () => {
  const f = flow('win_mega');
  const a = winNumberValueAt(f, DUR, 5.37, { wager: 1 });
  const b = winNumberValueAt(f, DUR, 5.37, { wager: 1 });
  near(a, b);
  // and within big's [4,6] ramp 20→40: at t=5 → 30
  near(winNumberValueAt(f, DUR, 5, { wager: 1 }), 30);
});

ok('wager scales the value', () => {
  near(winNumberValueAt(flow('win_mega'), DUR, 11, { wager: 2 }), 240);
});

ok('big flow final = 40 (super threshold)', () => {
  // win_big: small[0,2] med[2,4] big[4,7(+end)] → big ramps 20→40
  near(winNumberValueAt(flow('win_big'), DUR, 7, { wager: 1 }), 40);
});

ok('standalone small win = no count-up (sub-bet final)', () => {
  near(winNumberValueAt(flow('win_small'), DUR, 0, { wager: 1 }), SMALL_FINAL);
  near(winNumberValueAt(flow('win_small'), DUR, 99, { wager: 4 }), SMALL_FINAL * 4);
});

ok('format: currency position (prefix default) + separator', () => {
  // prefix is the default
  assert.equal(formatWinNumber(2137, { currency: '$', decimalSep: '.', decimals: 2 }), '$ 2137.00');
  assert.equal(formatWinNumber(120, { currency: '$', decimalSep: '.', decimals: 2, currencyPosition: 'suffix' }), '120.00 $');
  assert.equal(formatWinNumber(120, { currency: '€', decimalSep: ',', decimals: 2, currencyPosition: 'suffix' }), '120,00 €');
  assert.equal(formatWinNumber(7.5, { currency: 'kr', decimalSep: ',', decimals: 2, currencyPosition: 'prefix' }), 'kr 7,50');
});

ok('normalizeWinNumber: null without font, validates fields', () => {
  assert.equal(normalizeWinNumber({ currency: '$' }), null);
  const n = normalizeWinNumber({ fontSrc: 'a.png', currency: 'zzz', decimalSep: ';', decimals: 9 });
  assert.equal(n.currency, '$');            // invalid → default
  assert.equal(n.currencyPosition, 'prefix'); // default
  assert.equal(n.decimalSep, '.');          // invalid → default
  assert.equal(n.decimals, 4);              // clamped
  assert.equal(n.cols, 8);
  assert.equal(normalizeWinNumber({ fontSrc: 'a.png', currencyPosition: 'suffix' }).currencyPosition, 'suffix');
});

console.log(`\n${pass} win-number model tests passed`);
