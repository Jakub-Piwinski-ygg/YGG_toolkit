// Fuzzy symbol ↔ spine ↔ animation name matching for the Spinner wizard.
//
// Real projects mix separators and casing freely: static `Hp_5` ↔ spine
// `Symbols_Hp5` ↔ animation `land_h5`. Everything is matched on a normalized
// form (lowercase, separators stripped) with digit-boundary checks so `hp1`
// never matches `hp10`.

export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Token variants a symbol can appear as: 'Hp_5' → ['hp5', 'h5']. */
export function symbolNameTokens(symName) {
  const n = normName(symName);
  const tokens = [];
  if (n) tokens.push(n);
  const m = n.match(/^([a-z]+?)0*(\d+)$/);
  if (m) {
    const short = m[1][0] + m[2]; // first letter + digits: 'h5'
    if (!tokens.includes(short)) tokens.push(short);
    const noPad = m[1] + m[2];    // strip zero padding: 'hp05' → 'hp5'
    if (!tokens.includes(noPad)) tokens.push(noPad);
  }
  return tokens;
}

/**
 * Boundary-checked containment score of `token` in normalized `hay`.
 * 0 = no match; higher = better (exact > suffix > inner). A token ending in
 * digits must not be followed by another digit (`hp1` ∉ `hp10`).
 */
export function tokenMatchScore(hay, token) {
  if (!hay || !token) return 0;
  let idx = hay.indexOf(token);
  while (idx !== -1) {
    const after = hay[idx + token.length];
    const digitClash = /\d$/.test(token) && after >= '0' && after <= '9';
    if (!digitClash) {
      if (hay === token) return 100;
      if (idx + token.length === hay.length) return 80;
      return 60;
    }
    idx = hay.indexOf(token, idx + 1);
  }
  return 0;
}

/**
 * Score how well a candidate name (spine file) matches a symbol name.
 * 0 = no relation. Longer tokens score higher, so 'hp5' beats 'h5'.
 */
export function spineMatchScore(symName, candidateName) {
  const hay = normName(candidateName);
  let score = 0;
  for (const tk of symbolNameTokens(symName)) {
    const s = tokenMatchScore(hay, tk);
    if (s > 0) score = Math.max(score, s + tk.length);
  }
  // Reverse containment (spine file named tighter than the symbol).
  if (!score && hay && normName(symName).includes(hay)) score = 40;
  return score;
}

/**
 * Pick the actual animation name for land/win from a spine file's animation
 * list: prefer names containing the kind ('land'/'win'), then the best
 * symbol-token match among those. Returns null when nothing fits.
 */
export function pickAnimName(names, kind, symName) {
  if (!Array.isArray(names) || !names.length) return null;
  const tokens = symbolNameTokens(symName);
  const kindCands = names.filter((nm) => normName(nm).includes(kind));
  // Single kind candidate wins even without a symbol token — per-symbol spine
  // files often just have 'land' / 'win'.
  if (kindCands.length === 1) return kindCands[0];
  const pool = kindCands.length ? kindCands : names;
  let best = null;
  let bestScore = 0;
  for (const nm of pool) {
    const hay = normName(nm);
    let score = kindCands.length ? 10 : 0;
    for (const tk of tokens) {
      const s = tokenMatchScore(hay, tk);
      if (s > 0) score += s + tk.length;
    }
    if (score > bestScore) { bestScore = score; best = nm; }
  }
  return bestScore > 0 ? best : null;
}

// ── Symbol-candidate discovery (T7) ──────────────────────────────────────
//
// Separate concern from the above: symbolMatch()/pickAnimName() match a
// KNOWN symbol name against candidate files. This section instead answers
// "does this asset in the project pool even LOOK like a slot symbol at
// all?" — used by the wizard's "fill from assets" bulk auto-populate.

/** The filename with extension/directory stripped. */
export function assetBaseName(asset) {
  const n = asset?.meta?.originalName || asset?.id || '';
  return n.replace(/\.[^.]+$/, '').replace(/.*[/\\]/, '');
}

/** Decode all path segments from asset.src. [] for blob:/data: URLs (no structural path info). */
export function assetPathSegments(asset) {
  const src = String(asset?.src || '');
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return [];
  try {
    const url = new URL(src);
    return url.pathname.split('/').map((s) => decodeURIComponent(s)).filter(Boolean);
  } catch {
    return src.split(/[/\\]/).filter(Boolean);
  }
}

/** Score how likely an asset is a slot symbol (positive = yes, negative = no). */
export function symbolScore(asset) {
  const base = assetBaseName(asset).toLowerCase();
  const segs = assetPathSegments(asset).map((s) => s.toLowerCase());

  let score = 0;
  // Strong negatives: known non-symbol filename prefixes
  if (/^(bg_|fs_|ui_|btn_|machine_|board_|panel_|frame_|logo_|counter_|game_|banner_|overlay_|popup_|base_)/.test(base))
    score -= 10;
  // Positives: "symbol" or "sym" folder in path
  if (segs.some((s) => s.includes('symbol') || s.includes('_sym') || s === 'sym'))
    score += 12;
  // Positives: "static" or "statics" subfolder
  if (segs.some((s) => /^statics?$/.test(s)))
    score += 6;
  // Positives: "blur" subfolder
  if (segs.some((s) => /^blur(red)?$/.test(s)))
    score += 4;
  // Positives: classic slot symbol name patterns (h1–h9, l1–l9, wild, scatter…)
  if (/^(h|l)\d+(_|$)/.test(base)) score += 10;
  if (/^(wild|scatter|bonus|freespin|free_spin|multiplier|ace|king|queen|jack|ten|nine|sym_)/.test(base))
    score += 8;
  // Negatives: non-symbol folder names in path
  if (segs.some((s) => /^(background|backgrounds|bg|machine|logo|buttons?|ui|overlays?)$/.test(s)))
    score -= 8;
  // Negatives: Animations / Spine folder (not a static sprite)
  if (segs.some((s) => /^(anim|animation|animations|spine|spines?)$/.test(s)))
    score -= 6;

  return score;
}

/**
 * T7: a merely-positive score (e.g. +4 from sitting in a "Blurred" folder
 * alone, with no name pattern or symbol-folder signal) isn't enough evidence
 * to auto-create a symbol from with no human look — that's how a stray UI
 * icon that happens to live one folder over from Blurred used to sneak in.
 * Confident auto-fill requires a stronger signal: a real symbol-folder hit
 * (+12), a classic name pattern (+10 / +8), or a combination that clears
 * this bar. Below it (but still > 0) is a "weak match" — surfaced to the
 * artist for a manual look, never silently included in a bulk fill.
 */
export const SYMBOL_CONFIDENCE_THRESHOLD = 8;
export function isConfidentSymbolMatch(score) {
  return score >= SYMBOL_CONFIDENCE_THRESHOLD;
}
