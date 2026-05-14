// Symbol → color mapping. Faithful port of SYM_COLOR proxy logic from
// cheat-tool.html. Built as a memoized function so the rest of the code can
// just call symColor(sym) without worrying about caching.

const SYM_COLOR_BASE = {
  Wild: '#00e5ff',
  Scatter: '#00ff9d',
  FS: '#ff4d7c',
  Bonus: '#ffdd44'
};

const SYM_COLOR_PATTERNS = [
  { re: /^(h|hi|high)1$/i, color: '#ffaa40' },
  { re: /^(h|hi|high)2$/i, color: '#ffcc40' },
  { re: /^(h|hi|high)3$/i, color: '#ff8060' },
  { re: /^(h|hi|high)4$/i, color: '#e06030' },
  { re: /^(h|hi|high)5$/i, color: '#cc5020' },
  { re: /^(h|hi|high)6$/i, color: '#aa3010' },
  { re: /^(m|mi|mid)1$/i, color: '#a080ff' },
  { re: /^(m|mi|mid)2$/i, color: '#c090ff' },
  { re: /^(l|lo|low)1$/i, color: '#94a3b8' },
  { re: /^(l|lo|low)2$/i, color: '#7a9ab0' },
  { re: /^(l|lo|low)3$/i, color: '#6080a0' },
  { re: /wild/i, color: '#00e5ff' },
  { re: /scatter/i, color: '#00ff9d' },
  { re: /^fs/i, color: '#ff4d7c' },
  { re: /bonus/i, color: '#ffdd44' }
];

const FALLBACKS = [
  '#ffaa40', '#ffcc40', '#ff8060', '#e06030',
  '#a080ff', '#c090ff', '#94a3b8', '#7a9ab0',
  '#6080a0', '#00e5ff', '#00ff9d', '#ff4d7c'
];

const CACHE = {};

export function symColor(sym) {
  if (!sym || typeof sym !== 'string') return '#fff';
  if (CACHE[sym]) return CACHE[sym];
  if (SYM_COLOR_BASE[sym]) {
    CACHE[sym] = SYM_COLOR_BASE[sym];
    return CACHE[sym];
  }
  for (const { re, color } of SYM_COLOR_PATTERNS) {
    if (re.test(sym)) {
      CACHE[sym] = color;
      return color;
    }
  }
  let hash = 0;
  for (let i = 0; i < sym.length; i++) hash = (hash * 31 + sym.charCodeAt(i)) & 0xffff;
  const color = FALLBACKS[hash % FALLBACKS.length];
  CACHE[sym] = color;
  return color;
}

export const DEFAULT_SYMBOLS = ['Hi1', 'Hi2', 'Hi3', 'Hi4', 'Mi1', 'Mi2', 'Lo1', 'Lo2', 'Lo3', 'Wild', 'Scatter', 'FS'];
