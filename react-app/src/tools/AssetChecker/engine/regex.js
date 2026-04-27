// Compile a config-supplied regex string. Supports a leading `(?i)` to mean
// case-insensitive, since JS doesn't allow inline flag groups.
export function compileRegex(pattern) {
  if (pattern == null) return null;
  let src = String(pattern);
  let flags = '';
  // strip a leading (?i) / (?im) / (?s) etc. inline-flag group and convert to JS flags
  const m = src.match(/^\(\?([imsux]+)\)/);
  if (m) {
    for (const f of m[1]) if ('imsu'.includes(f)) flags += f;
    src = src.slice(m[0].length);
  }
  try {
    return new RegExp(src, flags);
  } catch (e) {
    throw new Error(`Bad regex "${pattern}": ${e.message}`);
  }
}

// Match a folder/file name against an "expected" name with tolerance for
// numeric / ordering prefixes like "01_Preloader" ≡ "Preloader".
export function normalizeFolderName(name) {
  return String(name || '').replace(/^[0-9]+[_\-\s]+/, '').toLowerCase();
}

export function folderMatches(actual, expected) {
  if (!actual || !expected) return false;
  const a = String(actual).toLowerCase();
  const e = String(expected).toLowerCase();
  if (a === e) return true;
  return normalizeFolderName(a) === normalizeFolderName(e);
}
