// Findings model — one immutable entry per issue surfaced by a check.
// severity: 'error' | 'warn' | 'info'
// priority: 1 (highest) .. 5 (lowest) — used as secondary sort within severity.
// data: optional structured payload for table rendering (matrices etc.).

let _id = 0;

export function mkFinding({
  ruleId,
  severity = 'warn',
  category,
  priority = 3,
  paths = [],
  message,
  data = null
}) {
  return {
    uid: ++_id,
    ruleId,
    severity,
    category,
    priority,
    paths,
    message,
    data
  };
}

export const SEVERITY_RANK = { error: 0, warn: 1, info: 2, pass: 3 };

export function sortFindings(list) {
  return [...list].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 9;
    const sb = SEVERITY_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return (a.paths[0] || '').localeCompare(b.paths[0] || '');
  });
}

export function groupBy(findings, keyFn) {
  const out = new Map();
  for (const f of findings) {
    const k = keyFn(f);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(f);
  }
  return out;
}
