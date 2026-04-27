// Suggest a cleaner / convention-compliant filename for naming-rule violations.
// Pure name-only — never operates on parent folders.

export function suggestCleanName(name) {
  if (!name) return null;
  // split off extension to lowercase it independently
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';

  let s = base
    .replace(/\s+/g, '_')
    .replace(/[()\[\]{}]/g, '')
    .replace(/[^A-Za-z0-9_\-.]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const out = ext ? `${s}.${ext.toLowerCase()}` : s;
  return out === name ? null : out;
}

export function suggestRemoveSuffix(name, suffix) {
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const lower = base.toLowerCase();
  const suf = suffix.toLowerCase();
  if (!lower.endsWith(suf)) return null;
  const trimmed = base.slice(0, base.length - suffix.length).replace(/[\s_\-]+$/, '');
  return trimmed + ext;
}

export function suggestLowercaseExt(name) {
  const m = name.match(/\.([^.]+)$/);
  if (!m) return null;
  if (m[1] === m[1].toLowerCase()) return null;
  return name.slice(0, -m[1].length) + m[1].toLowerCase();
}

export function suggestPrefix(name, prefixes) {
  if (!prefixes?.length) return null;
  const lower = name.toLowerCase();
  if (prefixes.some((p) => lower.startsWith(p.toLowerCase()))) return null;
  // pick the first prefix as the canonical one
  const wanted = prefixes[0];
  // avoid double-underscoring
  const sep = wanted.endsWith('_') || /^[a-z]+$/i.test(wanted) ? '' : '_';
  return wanted + sep + name;
}
