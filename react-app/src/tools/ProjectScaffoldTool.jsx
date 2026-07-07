import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import { useApp } from '../context/AppContext.jsx';

export const projectScaffoldMeta = {
  id: 'projectscaffold',
  label: 'Project Scaffold',
  small: 'create new project structure',
  icon: '🗂️',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc: 'Design a new slot project as an editable folder tree. Add elements from the palette, expand any folder to nest more subfolders, and tick which leaf folders are required. The scaffold is emitted in the Unity delivery layout — every feature is split across _Game_Export (runtime art), _Source (working files) and _Previews — so it matches what the Asset Checker exports. Download the empty-folder scaffold ZIP, or just the config JSON for reuse.'
};

// ── catalogue ───────────────────────────────────────────────────────────────

const BASE_ELEMENTS = [
  'Background', 'Symbols', 'Machine_Frame', 'Win_Sequence', 'Logo',
  'Splash', 'Preloader', 'Win_Ticker', 'Fonts'
];

const COMMON_ELEMENTS = [
  'BonusGame', 'Total_Win', 'Anticipation_Spin', 'Character',
  'Free_Spin_Counter', 'Buttons', 'Special_Features', 'Coins', 'Multiplier_Counter',
  'Free_Spins_Intro_Outro', 'Bonus_Intro_Outro', 'Pick_a_Prize_Intro_Outro'
];

// Common elements that nest under a shared parent folder. Selecting any of them
// creates the parent group (if absent) with the child inside; selecting another
// adds it to the same existing parent. Each child is a normal leaf feature.
const GROUPED_ELEMENTS = {
  Free_Spins_Intro_Outro:  'Intro_Outro',
  Bonus_Intro_Outro:       'Intro_Outro',
  Pick_a_Prize_Intro_Outro:'Intro_Outro',
  Multiplier_Counter:      'Counters',
  Free_Spin_Counter:       'Counters'
};

// Quick-add leaf folders made of PNG glyph sheets — surfaced under Fonts.
const FONT_PNG_PRESETS = ['Win_Numbers', 'FS_Counter_Numbers', 'Multiplier_Numbers'];

// Presets that pre-fill a subtree (still fully editable afterwards).
const PRESET_DEFS = {
  Fonts: {
    fontVariant: true,
    autoArt: false, // fonts opt out of the standard Export/Source/preview leaf set
    children: [
      { name: 'TTF_Source',    autoArt: false, leafKind: 'any' },
      { name: 'Static_Export', autoArt: false, leafKind: 'png' },
      { name: 'Static_Source', autoArt: false, leafKind: 'any' }
    ]
  }
};

// The standard art substructure auto-attached to every leaf feature folder.
// `path`   = display label / per-node toggle key (the conceptual Export/Source split).
// `bucket` = top-level Unity delivery folder the leaf is routed into.
// `suffix` = sub-folder placed after the feature path inside the bucket.
// `def`    = default spawn+mandatory state. `source` flags the working-file rows.
// NOTE: preview is NOT here — it's a per-folder toggle (see node.preview) routed
// into _Previews/, on for top-level elements and off for nested ones by default.
const ART_SUB_META = [
  { path: 'Export/Animation',        bucket: '_Game_Export', suffix: 'Animations',       rule: 'spineAtLeastOne', def: true, source: false },
  { path: 'Export/StaticArt',        bucket: '_Game_Export', suffix: 'StaticArt',        rule: 'pngAtLeastOne',   def: true, source: false },
  { path: 'Source/AnimationSources', bucket: '_Source',      suffix: 'AnimationSources', rule: 'anyFile',         def: true, source: true },
  { path: 'Source/StaticArt',        bucket: '_Source',      suffix: 'StaticArt',        rule: 'anyFile',         def: true, source: true }
];

const PREVIEW_BUCKET = '_Previews';
const GAME_BUCKET = '_Game_Export';
const PREVIEW_RULE = 'landscapeAndPortraitPng';

const RULE_DESC = {
  spineAtLeastOne:        'at least one valid spine animation (json + atlas + png)',
  pngAtLeastOne:          'at least one PNG',
  anyFile:                'any file',
  landscapeAndPortraitPng:'landscape AND portrait PNG'
};

function defaultArtSubs() {
  const o = {};
  for (const s of ART_SUB_META) o[s.path] = s.def;
  return o;
}

// ── helpers ───────────────────────────────────────────────────────────────

function slugify(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\s/\\]+/g, '_')
    .replace(/[^A-Za-z0-9_\-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pad2(n) { return String(n).padStart(2, '0'); }

let _idSeq = 0;
const uid = () => `n${Date.now().toString(36)}_${(_idSeq++).toString(36)}`;

// Build a tree node. `children` may be strings or option objects.
function makeNode(name, opts = {}) {
  return {
    id: uid(),
    name: slugify(name) || String(name),
    source: opts.source || 'custom',
    autoArt: opts.autoArt !== false,
    leafKind: opts.leafKind || null,
    fontVariant: !!opts.fontVariant,
    template: !!opts.template, // top-level template element → forced `00_` prefix
    preview: !!opts.preview, // a `preview/` subfolder on THIS node (main preview)
    artSubs: defaultArtSubs(),
    children: (opts.children || []).map((c) =>
      typeof c === 'string'
        ? makeNode(c, { source: 'preset' })
        : makeNode(c.name, { ...c, source: 'preset' })
    )
  };
}

// Build a TOP-LEVEL element. Top-level elements get a main preview by default
// (unless they opt out of art structure entirely, e.g. Fonts).
function makePreset(name, source) {
  const def = PRESET_DEFS[name];
  const autoArt = def ? def.autoArt !== false : true;
  return makeNode(name, {
    source,
    autoArt,
    fontVariant: def?.fontVariant,
    children: def?.children,
    preview: autoArt // main preview on by default for normal top-level elements
  });
}

// The reusable template element — a standard leaf (Export/Source art subs +
// preview) forced to the `00_` prefix so it always sorts first as the copy-me
// blueprint for a new feature folder.
function makeTemplateNode(source = 'base') {
  return makeNode('Template', { source, template: true, preview: true });
}

function defaultTree() {
  return [makeTemplateNode('base'), ...BASE_ELEMENTS.map((name) => makePreset(name, 'base'))];
}

// Display name for a top-level node. The template is pinned to `00_`; every
// other top-level element is numbered by its position among NON-template
// siblings, so the template never consumes an index slot.
function topLevelName(node, tree, index) {
  if (node.template) return `00_${node.name}`;
  let seq = 0;
  for (let i = 0; i <= index && i < tree.length; i++) if (!tree[i].template) seq++;
  return `${pad2(seq)}_${node.name}`;
}

// Immutable tree operations -------------------------------------------------

function mapNode(nodes, id, fn) {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.children?.length) return { ...n, children: mapNode(n.children, id, fn) };
    return n;
  });
}

function removeNode(nodes, id) {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children?.length ? { ...n, children: removeNode(n.children, id) } : n));
}

function addChildTo(nodes, parentId, child) {
  return mapNode(nodes, parentId, (n) => ({ ...n, children: [...(n.children || []), child] }));
}

function reorderSiblings(nodes, id, dir) {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const swap = idx + dir;
    if (swap < 0 || swap >= nodes.length) return nodes;
    const next = nodes.slice();
    [next[idx], next[swap]] = [next[swap], next[idx]];
    return next;
  }
  return nodes.map((n) => (n.children?.length ? { ...n, children: reorderSiblings(n.children, id, dir) } : n));
}

function topLevelHasName(nodes, name) {
  const lc = name.toLowerCase();
  return nodes.some((n) => n.name.toLowerCase() === lc);
}

// Walk the tree → flat list of { relPath, rule } leaves in the Unity delivery
// layout. Each leaf carries its FULL feature path (NN_ numbering on top-level +
// every nesting level) so a nested feature like 08_Intro_Outro/Free_Spins_Intro_Outro
// keeps its parents — it is routed to _Game_Export/08_Intro_Outro/Free_Spins_Intro_Outro/…,
// never collapsed into a bare _Game_Export/ bucket. relPath starts with a bucket
// (_Game_Export / _Source / _Previews) and keeps a trailing slash.
function walkTree(tree) {
  const out = [];
  const visit = (node, featureRel, autoInherited, depth, index) => {
    const name = depth === 0 ? topLevelName(node, tree, index) : node.name;
    const feature = featureRel ? `${featureRel}/${name}` : name;
    const eff = autoInherited && node.autoArt !== false;
    const before = out.length;

    // Preview folder for this node (any depth) when ticked → _Previews/<feature>/.
    if (node.preview) out.push({ relPath: `${PREVIEW_BUCKET}/${feature}/`, rule: PREVIEW_RULE });

    if (node.children && node.children.length) {
      // Group folder — no art substructure of its own; recurse into children.
      // Its own bucket folders are created implicitly by descendant leaf paths.
      node.children.forEach((c, i) => visit(c, feature, eff, depth + 1, i));
    } else if (eff) {
      // Leaf feature folder — emit the ticked standard art subfolders, each
      // routed into its configured bucket while preserving the feature path.
      ART_SUB_META.filter((s) => node.artSubs?.[s.path]).forEach((s) =>
        out.push({ relPath: `${s.bucket}/${feature}/${s.suffix}/`, rule: s.rule }));
    } else {
      // Plain leaf folder (fonts variant child, png glyph folder, etc.) → _Game_Export/.
      out.push({ relPath: `${GAME_BUCKET}/${feature}/`, rule: node.leafKind === 'png' ? 'pngAtLeastOne' : 'anyFile' });
    }

    // Nothing emitted (leaf with no art subs and no preview) → bare _Game_Export folder.
    if (out.length === before) out.push({ relPath: `${GAME_BUCKET}/${feature}/`, rule: 'anyFile' });
  };
  tree.forEach((n, i) => visit(n, '', true, 0, i));
  return out;
}

function computePaths(state) {
  const rootSlug = slugify(state.projectName) || 'NewSlot';
  return walkTree(state.tree).map((l) => `${rootSlug}/${l.relPath}`);
}

// ── config JSON ─────────────────────────────────────────────────────────────

const CONFIG_FILENAME = '.ygg-scaffold.json';
const CONFIG_VERSION = 3;

function serializeNode(n) {
  return {
    name: n.name,
    source: n.source,
    autoArt: n.autoArt,
    leafKind: n.leafKind,
    fontVariant: n.fontVariant,
    template: n.template,
    preview: n.preview,
    artSubs: n.artSubs,
    children: (n.children || []).map(serializeNode)
  };
}

function deserializeNode(o) {
  return {
    id: uid(),
    name: o.name,
    source: o.source || 'custom',
    autoArt: o.autoArt !== false,
    leafKind: o.leafKind || null,
    fontVariant: !!o.fontVariant,
    template: !!o.template,
    preview: !!o.preview,
    artSubs: { ...defaultArtSubs(), ...(o.artSubs || {}) },
    children: (o.children || []).map(deserializeNode)
  };
}

function buildConfigJson(state) {
  const mandatory = walkTree(state.tree).map((l) => ({ path: l.relPath.replace(/\/$/, ''), rule: l.rule }));
  const cfg = {
    $schema: 'ygg-scaffold',
    version: CONFIG_VERSION,
    generatedAt: new Date().toISOString(),
    projectName: state.projectName,
    tree: state.tree.map(serializeNode),
    mandatory,
    ruleLegend: RULE_DESC
  };
  return JSON.stringify(cfg, null, 2);
}

function parseConfigJson(text) {
  const cfg = JSON.parse(text);
  if (cfg.$schema !== 'ygg-scaffold') {
    throw new Error('Not a ygg-scaffold config (missing $schema marker).');
  }
  return cfg;
}

// Convert a loaded config into a tree, accepting both the v2 tree format and
// the legacy v1 flat {elements, subfolders} format.
function configToTree(cfg) {
  if (Array.isArray(cfg.tree)) return cfg.tree.map(deserializeNode);
  if (Array.isArray(cfg.elements)) {
    return cfg.elements.map((e) => {
      const isFonts = String(e.name || '').toLowerCase() === 'fonts';
      if (isFonts) return makePreset('Fonts', e.source || 'base');
      const node = makeNode(e.name, { source: e.source || 'custom', preview: true });
      if (e.mandatoryByPath && typeof e.mandatoryByPath === 'object') {
        node.artSubs = { ...defaultArtSubs(), ...e.mandatoryByPath };
        if ('preview' in e.mandatoryByPath) node.preview = !!e.mandatoryByPath.preview;
      }
      return node;
    });
  }
  throw new Error('Config has no tree or elements.');
}

// ── scaffold zip builder ──────────────────────────────────────────────────────

// One scaffold, one layout: <project>/{_Game_Export,_Source,_Previews}/… plus the
// .ygg-scaffold.json config at the project root. Empty folders are stored as
// plain ZIP entries (or seeded with a .gitkeep when requested).
async function buildScaffoldZip(state) {
  if (!state.tree.length) return null;
  const paths = computePaths(state);
  const zip = new JSZip();
  for (const p of paths) {
    const folder = p.replace(/\/+$/, '');
    if (state.addGitkeep) zip.file(folder + '/.gitkeep', '');
    else zip.folder(folder);
  }
  const rootSlug = slugify(state.projectName) || 'NewSlot';
  zip.file(`${rootSlug}/${CONFIG_FILENAME}`, buildConfigJson(state));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── tree row UI ───────────────────────────────────────────────────────────────

function TreeRow({ node, depth, index, autoInherited, underFont, topName, ops }) {
  const eff = autoInherited && node.autoArt !== false;
  const isFont = underFont || node.fontVariant;
  const hasChildren = !!(node.children && node.children.length);
  const isLeaf = !hasChildren;
  const collapsed = ops.isCollapsed(node.id);
  const editing = ops.editId === node.id;
  const addOpen = ops.isAddOpen(node.id);

  // What sits "inside" this node: child nodes, or (for an auto leaf) art subs.
  const expandable = hasChildren || (isLeaf && eff) || true; // every node can host an add-row

  const displayName = depth === 0 ? topName : node.name;

  return (
    <div className="ps-tnode" style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      <div className={`ps-trow${depth === 0 ? ' ps-trow-top' : ''}`}>
        <button
          className="ps-caret"
          type="button"
          onClick={() => ops.toggleCollapse(node.id)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>

        {editing ? (
          <input
            className="ps-edit-input"
            autoFocus
            value={ops.editDraft}
            onChange={(e) => ops.setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ops.commitEdit(node.id);
              if (e.key === 'Escape') ops.cancelEdit();
            }}
            onBlur={() => ops.commitEdit(node.id)}
          />
        ) : (
          <span
            className="ps-tname"
            title="Double-click to rename"
            onDoubleClick={() => ops.startEdit(node.id, node.name)}
          >
            {displayName}
          </span>
        )}

        {node.template && <span className="ps-badge ps-badge-template">template</span>}
        {node.fontVariant && <span className="ps-badge ps-badge-font">fonts</span>}
        {isLeaf && !eff && !node.fontVariant && (
          <span className="ps-badge">{node.leafKind === 'png' ? 'png folder' : 'folder'}</span>
        )}

        <label
          className={`ps-prev${node.preview ? ' ps-prev-on' : ''}`}
          title={depth === 0 ? 'Main preview folder (landscape + portrait). On by default for top-level elements.' : 'Add a preview folder for this individual element (off by default).'}
        >
          <input type="checkbox" checked={!!node.preview} onChange={() => ops.togglePreview(node.id)} />
          <span>preview</span>
        </label>

        {depth === 0 && <span className={`ps-order-tag ps-tag-${node.source}`}>{node.source}</span>}

        <div className="ps-trow-actions">
          <button className="btn ps-arrow" type="button" onClick={() => ops.move(node.id, -1)} title="Move up">↑</button>
          <button className="btn ps-arrow" type="button" onClick={() => ops.move(node.id, 1)} title="Move down">↓</button>
          <button className="btn ps-arrow" type="button" onClick={() => ops.toggleAdd(node.id)} title="Add subfolder">＋</button>
          <button className="btn ps-x" type="button" onClick={() => ops.remove(node.id)} title="Remove">×</button>
        </div>
      </div>

      {!collapsed && (
        <div className="ps-tchildren">
          {/* Art substructure for auto leaves — vertical spawn+mandatory toggles */}
          {isLeaf && eff && (
            <div className="ps-art-list">
              {ART_SUB_META.map((s) => (
                <label key={s.path} className={`ps-art-item${s.source ? ' ps-art-source' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!node.artSubs[s.path]}
                    onChange={() => ops.toggleArtSub(node.id, s.path)}
                  />
                  <code>{s.path}</code>
                  <span className="ps-rule-desc">{RULE_DESC[s.rule]}</span>
                </label>
              ))}
            </div>
          )}

          {/* Child folders */}
          {hasChildren && node.children.map((c, i) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              index={i}
              autoInherited={eff}
              underFont={isFont}
              ops={ops}
            />
          ))}

          {/* Add-subfolder row */}
          {addOpen && (
            <div className="ps-add-sub">
              <input
                className="ps-add-input"
                autoFocus
                placeholder="new subfolder name"
                value={ops.addDraft[node.id] || ''}
                onChange={(e) => ops.setAddDraft(node.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') ops.commitAdd(node.id);
                  if (e.key === 'Escape') ops.toggleAdd(node.id);
                }}
              />
              <button className="btn" type="button" onClick={() => ops.commitAdd(node.id)}>Add</button>
              {isFont && (
                <span className="ps-quick-chips">
                  {FONT_PNG_PRESETS.map((p) => (
                    <button key={p} className="ps-chip" type="button" onClick={() => ops.addPreset(node.id, p, { autoArt: false, leafKind: 'png' })}>
                      + {p}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function ProjectScaffoldTool() {
  const { log, registerRunner } = useApp();

  const [projectName, setProjectName] = useState('NewSlot');
  const [tree, setTree] = useState(defaultTree);
  const [customDraft, setCustomDraft] = useState('');
  const [addGitkeep, setAddGitkeep] = useState(false);
  const [busy, setBusy] = useState(false);

  // Per-node UI state
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [openAdd, setOpenAdd] = useState(() => new Set());
  const [addDraft, setAddDraftMap] = useState({});

  const folderCount = useMemo(() => computePaths({ projectName, tree }).length,
    [projectName, tree]);

  // ----- palette adds -----

  const addTop = (name, source) => {
    const slug = slugify(name);
    if (!slug) return;
    if (topLevelHasName(tree, slug)) { log(`"${slug}" is already a top-level element.`, 'err'); return; }
    setTree((t) => [...t, makePreset(/* preserve preset casing */ name, source)]);
  };

  // Add the reusable 00_Template blueprint — pinned to the top of the tree.
  const addTemplate = () => {
    if (topLevelHasName(tree, 'Template')) { log('00_Template is already in the tree.', 'err'); return; }
    setTree((t) => [makeTemplateNode('base'), ...t]);
  };

  // Add a grouped common element: ensure its shared parent group exists, then
  // nest the child inside it. Adding a second sibling reuses the same parent.
  const addGrouped = (childName, parentName, source) => {
    const childSlug = slugify(childName);
    const parentSlug = slugify(parentName);
    const parent = tree.find((n) => n.name.toLowerCase() === parentSlug.toLowerCase());
    if (parent) {
      if (parent.children?.some((c) => c.name.toLowerCase() === childSlug.toLowerCase())) {
        log(`"${childSlug}" is already inside ${parentSlug}.`, 'err');
        return;
      }
      setTree((t) => addChildTo(t, parent.id, makeNode(childName, { source })));
      return;
    }
    const parentNode = makeNode(parentName, { source });
    parentNode.children = [makeNode(childName, { source })];
    setTree((t) => [...t, parentNode]);
  };

  // Is a grouped child already present under its parent?
  const groupedPresent = (childName) => {
    const parentSlug = slugify(GROUPED_ELEMENTS[childName]);
    const childSlug = slugify(childName);
    const parent = tree.find((n) => n.name.toLowerCase() === parentSlug.toLowerCase());
    return !!parent?.children?.some((c) => c.name.toLowerCase() === childSlug.toLowerCase());
  };

  const addCustomTop = () => {
    const slug = slugify(customDraft);
    if (!slug) return;
    if (topLevelHasName(tree, slug)) { log(`"${slug}" is already in the tree.`, 'err'); return; }
    setTree((t) => [...t, makeNode(slug, { source: 'custom', preview: true })]);
    setCustomDraft('');
  };

  // ----- tree ops object passed to rows -----

  const ops = useMemo(() => ({
    isCollapsed: (id) => collapsed.has(id),
    toggleCollapse: (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),

    editId,
    editDraft,
    startEdit: (id, name) => { setEditId(id); setEditDraft(name); },
    setEditDraft,
    cancelEdit: () => { setEditId(null); setEditDraft(''); },
    commitEdit: (id) => {
      const slug = slugify(editDraft);
      if (slug) setTree((t) => mapNode(t, id, (n) => ({ ...n, name: slug })));
      setEditId(null); setEditDraft('');
    },

    isAddOpen: (id) => openAdd.has(id),
    toggleAdd: (id) => setOpenAdd((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    addDraft,
    setAddDraft: (id, val) => setAddDraftMap((m) => ({ ...m, [id]: val })),
    commitAdd: (id) => {
      const slug = slugify(addDraft[id] || '');
      if (!slug) return;
      setTree((t) => addChildTo(t, id, makeNode(slug, { source: 'custom' })));
      setAddDraftMap((m) => ({ ...m, [id]: '' }));
      setCollapsed((s) => { const n = new Set(s); n.delete(id); return n; }); // ensure parent expanded
    },
    addPreset: (id, name, opts) => {
      setTree((t) => addChildTo(t, id, makeNode(name, { source: 'preset', ...opts })));
      setCollapsed((s) => { const n = new Set(s); n.delete(id); return n; });
    },

    move: (id, dir) => setTree((t) => reorderSiblings(t, id, dir)),
    remove: (id) => setTree((t) => removeNode(t, id)),
    toggleArtSub: (id, path) =>
      setTree((t) => mapNode(t, id, (n) => ({ ...n, artSubs: { ...n.artSubs, [path]: !n.artSubs[path] } }))),
    togglePreview: (id) =>
      setTree((t) => mapNode(t, id, (n) => ({ ...n, preview: !n.preview })))
  }), [collapsed, editId, editDraft, openAdd, addDraft]);

  // ----- load config -----

  const applyConfig = useCallback((cfg) => {
    if (typeof cfg.projectName === 'string') setProjectName(cfg.projectName);
    try {
      const t = configToTree(cfg);
      setTree(t);
      log(`Loaded scaffold config — ${t.length} top-level element(s).`, 'ok');
    } catch (e) {
      log(`Config loaded but tree could not be built: ${e.message || e}`, 'err');
    }
  }, [log]);

  const loadFromFile = useCallback(async (file) => {
    try {
      const text = await file.text();
      applyConfig(parseConfigJson(text));
    } catch (e) {
      log(`Could not load config: ${e.message || e}`, 'err');
    }
  }, [applyConfig, log]);

  const fileInputRef = useRef(null);
  const onLoadClick = () => fileInputRef.current?.click();
  const onLoadChange = async (e) => {
    const f = e.target.files?.[0];
    if (f) await loadFromFile(f);
    e.target.value = '';
  };

  useEffect(() => {
    const onDragOver = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    const onDrop = (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const jsonFile = [...files].find((f) => /\.json$/i.test(f.name));
      if (!jsonFile) return;
      e.preventDefault();
      e.stopPropagation();
      loadFromFile(jsonFile);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [loadFromFile]);

  // ----- downloads -----

  const stateForBuild = () => ({ projectName, tree, addGitkeep });

  const downloadScaffold = async () => {
    if (!tree.length) { log('Add at least one element first.', 'err'); return; }
    setBusy(true);
    try {
      const blob = await buildScaffoldZip(stateForBuild());
      const rootSlug = slugify(projectName) || 'NewSlot';
      triggerBlobDownload(blob, `${rootSlug}_scaffold.zip`);
      log(`Scaffold built: ${folderCount} folder(s).`, 'ok');
    } catch (e) {
      log(`Scaffold build failed: ${e.message || e}`, 'err');
    } finally { setBusy(false); }
  };

  const downloadConfig = () => {
    if (!tree.length) { log('Add at least one element first.', 'err'); return; }
    const json = buildConfigJson(stateForBuild());
    const blob = new Blob([json], { type: 'application/json' });
    const rootSlug = slugify(projectName) || 'NewSlot';
    triggerBlobDownload(blob, `${rootSlug}${CONFIG_FILENAME}`);
    log('Config saved.', 'ok');
  };

  // Toolbar RUN → scaffold ZIP.
  const settingsRef = useRef({});
  settingsRef.current = stateForBuild();
  useEffect(() => {
    registerRunner(projectScaffoldMeta.id, {
      outName: () => `${slugify(settingsRef.current.projectName) || 'NewSlot'}_scaffold.zip`,
      run: async () => buildScaffoldZip(settingsRef.current)
    });
    return () => registerRunner(projectScaffoldMeta.id, null);
  }, [registerRunner]);

  const presentTop = (name) => topLevelHasName(tree, slugify(name));

  return (
    <div className="tool-section ps-root">
      <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onLoadChange} />

      <div className="ps-top-actions">
        <button className="btn" type="button" onClick={onLoadClick}>📂 Load Config</button>
        <span className="ps-hint">…or drop a <code>{CONFIG_FILENAME}</code> anywhere on the page while this tool is open.</span>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Project name</label>
          <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="NewSlot" />
        </div>
        <div className="field">
          <label>Layout</label>
          <div className="ps-inline-check" style={{ cursor: 'default' }}>
            <span><code>{slugify(projectName) || 'NewSlot'}/</code> → <code>_Game_Export</code> · <code>_Previews</code> · <code>_Source</code> · <code>{CONFIG_FILENAME}</code></span>
          </div>
        </div>
      </div>

      <div className="ps-section">
        <div className="ps-section-head">Add element</div>
        <div className="ps-palette">
          <button
            className={`ps-chip ps-chip-template${presentTop('Template') ? ' ps-chip-on' : ''}`}
            type="button"
            onClick={addTemplate}
            disabled={presentTop('Template')}
            title="A blank feature blueprint (Export/Source art + preview), pinned to 00_ — copy it when adding a new folder."
          >
            {presentTop('Template') ? '✓ ' : '+ '}00_Template
          </button>
        </div>
        <div className="ps-palette">
          {BASE_ELEMENTS.map((name) => (
            <button key={name} className={`ps-chip ps-chip-base${presentTop(name) ? ' ps-chip-on' : ''}`} type="button" onClick={() => addTop(name, 'base')} disabled={presentTop(name)}>
              {presentTop(name) ? '✓ ' : '+ '}{name}
            </button>
          ))}
        </div>
        <div className="ps-palette">
          {COMMON_ELEMENTS.map((name) => {
            const grouped = GROUPED_ELEMENTS[name];
            const present = grouped ? groupedPresent(name) : presentTop(name);
            return (
              <button
                key={name}
                className={`ps-chip ps-chip-common${present ? ' ps-chip-on' : ''}`}
                type="button"
                onClick={() => (grouped ? addGrouped(name, grouped, 'common') : addTop(name, 'common'))}
                disabled={present}
                title={grouped ? `Nested inside ${grouped}` : undefined}
              >
                {present ? '✓ ' : '+ '}{name}
              </button>
            );
          })}
        </div>
        <div className="ps-add-row">
          <input
            type="text"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTop(); } }}
            placeholder="custom element name…"
          />
          <button className="btn" type="button" onClick={addCustomTop}>+ Add</button>
        </div>
        <div className="ps-hint">Expand any folder (▾) to nest subfolders inside it. Leaf folders get the standard <code>Export / Source</code> set — tick which ones are required; <code>Export</code> routes to <code>_Game_Export</code>, <code>Source</code> to <code>_Source</code>, and they keep the full feature path. The <b>preview</b> toggle (→ <code>_Previews</code>) is on by default for top-level elements and off for nested ones — enable it only when an individual sub-element needs its own preview. Folders with children become pure groups. Every ticked folder is created <b>and</b> recorded as mandatory.</div>
      </div>

      <div className="ps-section">
        <div className="ps-tree-head">
          <span className="ps-section-head">Project tree ({folderCount} folder{folderCount === 1 ? '' : 's'})</span>
          <div className="ps-tree-actions">
            <button className="btn ps-arrow" type="button" onClick={() => setCollapsed(new Set())} title="Expand all">▾ all</button>
            <button className="btn ps-arrow" type="button" onClick={() => {
              const all = new Set();
              const walk = (nodes) => nodes.forEach((n) => { all.add(n.id); if (n.children?.length) walk(n.children); });
              walk(tree);
              setCollapsed(all);
            }} title="Collapse all">▸ all</button>
          </div>
        </div>
        <div className="ps-tree-wrap">
          {tree.length === 0 ? (
            <div className="ps-empty">(empty — add an element from the palette above)</div>
          ) : (
            tree.map((n, i) => (
              <TreeRow key={n.id} node={n} depth={0} index={i} autoInherited={true} underFont={false} topName={topLevelName(n, tree, i)} ops={ops} />
            ))
          )}
        </div>
      </div>

      <div className="ps-section">
        <label className="ps-check">
          <input type="checkbox" checked={addGitkeep} onChange={(e) => setAddGitkeep(e.target.checked)} />
          <span>Add <code>.gitkeep</code> placeholders in every leaf folder</span>
        </label>
        <div className="ps-hint">Off by default — empty folders are stored as plain ZIP entries. Turn on if your unzip tool drops empty directories.</div>
      </div>

      <div className="action-row">
        <button className="btn btn-primary" type="button" disabled={busy || !tree.length} onClick={downloadScaffold}>
          {busy ? 'building…' : '📦 Download Scaffold'}
        </button>
        <button className="btn" type="button" disabled={!tree.length} onClick={downloadConfig}>
          💾 Download Config
        </button>
        <span className="progress-label">{folderCount} folder(s)</span>
      </div>

      <style>{`
        .ps-section{display:flex;flex-direction:column;gap:.5rem}
        .ps-section-head{font-family:var(--font-mono);font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
        .ps-check{display:flex;align-items:center;gap:.5rem;font-family:var(--font-mono);font-size:.74rem;color:var(--text);cursor:pointer}
        .ps-check input{accent-color:var(--accent)}
        .ps-check code{font-size:.7rem;color:var(--accent2)}
        .ps-inline-check{display:flex;align-items:center;gap:.5rem;font-family:var(--font-mono);font-size:.72rem;color:var(--muted);cursor:pointer;padding:.5rem 0}
        .ps-add-row{display:flex;gap:.5rem;align-items:center}
        .ps-add-row input{flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:.78rem;padding:.45rem .7rem;border-radius:4px;outline:none}
        .ps-add-row input:focus{border-color:var(--accent2)}
        .ps-hint{font-family:var(--font-mono);font-size:.62rem;color:#777;line-height:1.5}
        .ps-empty{font-family:var(--font-mono);font-size:.7rem;color:#555;padding:.5rem 0}
        .ps-top-actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding-bottom:.4rem;border-bottom:1px dashed var(--border);margin-bottom:.4rem}
        .ps-palette{display:flex;flex-wrap:wrap;gap:.35rem}
        .ps-chip{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:.7rem;padding:.3rem .55rem;border-radius:3px;cursor:pointer;line-height:1}
        .ps-chip:hover:not(:disabled){border-color:var(--accent2)}
        .ps-chip:disabled{cursor:default;opacity:.55}
        .ps-chip-base{color:var(--accent)}
        .ps-chip-common{color:var(--accent2)}
        .ps-chip-template{color:#c89bff;border-color:rgba(200,155,255,.4)}
        .ps-chip-on{opacity:.5}
        .ps-tree-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
        .ps-tree-actions{display:flex;gap:.3rem}
        .ps-tree-wrap{background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:.5rem .6rem;max-height:520px;overflow:auto}
        .ps-tnode{display:flex;flex-direction:column}
        .ps-trow{display:flex;align-items:center;gap:.45rem;padding:.22rem .35rem;border-radius:3px;font-family:var(--font-mono);font-size:.74rem;border:1px solid transparent}
        .ps-trow:hover{border-color:var(--border);background:var(--surface)}
        .ps-trow-top{background:var(--surface)}
        .ps-caret{background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;line-height:1;width:1.1rem;padding:0}
        .ps-caret:hover{color:var(--accent2)}
        .ps-tname{color:var(--text);cursor:text;white-space:nowrap}
        .ps-edit-input{background:var(--bg);border:1px solid var(--accent2);color:var(--text);font-family:var(--font-mono);font-size:.72rem;padding:.1rem .35rem;border-radius:3px;outline:none}
        .ps-badge{font-size:.55rem;padding:.08rem .3rem;border-radius:2px;color:#9aa;border:1px solid #333;text-transform:uppercase;letter-spacing:.05em}
        .ps-badge-font{color:#e0a86b;border-color:rgba(224,168,107,.4)}
        .ps-badge-template{color:#c89bff;border-color:rgba(200,155,255,.4)}
        .ps-prev{display:flex;align-items:center;gap:.3rem;margin-left:auto;font-family:var(--font-mono);font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;cursor:pointer;padding:.08rem .35rem;border:1px solid var(--border);border-radius:3px;background:var(--surface2);white-space:nowrap}
        .ps-prev input{accent-color:var(--accent2)}
        .ps-prev-on{color:var(--accent2);border-color:rgba(71,200,255,.4)}
        .ps-order-tag{font-size:.55rem;padding:.1rem .35rem;border-radius:2px;text-transform:uppercase;letter-spacing:.06em;color:#888;border:1px solid #333}
        .ps-tag-base{color:var(--accent);border-color:rgba(255,118,46,.35)}
        .ps-tag-common{color:var(--accent2);border-color:rgba(71,200,255,.35)}
        .ps-tag-custom{color:#9bdc6c;border-color:rgba(155,220,108,.35)}
        .ps-tag-preset{color:#c89bff;border-color:rgba(200,155,255,.35)}
        .ps-trow-actions{display:flex;gap:.2rem;margin-left:.4rem}
        .ps-trow:not(:hover) .ps-trow-actions{opacity:.35}
        .ps-arrow{padding:.1rem .4rem;font-size:.65rem;line-height:1}
        .ps-x{padding:.1rem .45rem;font-size:.8rem;line-height:1;color:var(--muted)}
        .ps-x:hover:not(:disabled){color:var(--accent3);border-color:var(--accent3)}
        .ps-tchildren{display:flex;flex-direction:column;gap:.12rem;margin-left:.55rem;padding-left:.55rem;border-left:1px solid var(--border)}
        .ps-art-list{display:flex;flex-direction:column;gap:.18rem;padding:.25rem 0 .3rem .2rem}
        .ps-art-item{display:flex;align-items:center;gap:.45rem;font-family:var(--font-mono);font-size:.7rem;color:var(--text);cursor:pointer}
        .ps-art-item code{color:var(--accent2);font-size:.68rem;min-width:160px}
        .ps-art-item.ps-art-source code{color:#9aa;opacity:.85}
        .ps-art-item input{accent-color:var(--accent)}
        .ps-rule-desc{font-size:.58rem;color:#777}
        .ps-add-sub{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;padding:.3rem 0 .3rem .2rem}
        .ps-add-input{background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:.7rem;padding:.25rem .5rem;border-radius:3px;outline:none;min-width:160px}
        .ps-add-input:focus{border-color:var(--accent2)}
        .ps-quick-chips{display:flex;gap:.3rem;flex-wrap:wrap}
      `}</style>
    </div>
  );
}
