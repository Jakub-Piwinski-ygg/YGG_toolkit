// Maps the ?tool= URL query param to a tool id and back, so links like
// /?tool=CheatTool or /?tool=AssetChecker deep-link straight to a tool.
//
// Matching is intentionally forgiving: we normalize both the URL value and the
// tool's id / label by lowercasing and stripping non-alphanumeric chars. That
// means /?tool=cheattool, /?tool=CheatTool, /?tool=Cheat-Tool, /?tool=cheat%20tool
// all resolve to the same tool, and every new tool added to the registry works
// automatically with no per-tool config.

const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function resolveToolFromQuery(tools, value) {
  if (!value) return null;
  const want = normalize(value);
  if (!want) return null;
  for (const t of tools) {
    if (normalize(t.meta.id) === want) return t.meta.id;
    if (normalize(t.meta.label) === want) return t.meta.id;
  }
  return null;
}

export function readToolFromUrl(tools) {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return resolveToolFromQuery(tools, params.get('tool'));
}

// Writes ?tool=<id> into the URL without adding a history entry. Uses the tool's
// id as the canonical form so URLs stay stable across label edits.
export function writeToolToUrl(toolId) {
  if (typeof window === 'undefined' || !toolId) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('tool') === toolId) return;
  url.searchParams.set('tool', toolId);
  window.history.replaceState({}, '', url.toString());
}
