import { useEffect, useMemo, useRef, useState } from 'react';
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
  desc: 'Generate the canonical SharePoint / Unity-export folder skeleton for a new slot project. Pick the elements you need (base ones are pre-checked), tick optional common ones, or add your own custom names. Numbering follows the order shown — drag rows up/down to reorder. The ZIP mirrors the same hierarchy the Asset Pipeline checks for: unity_export/NN_Element/{Export/Animation, Export/StaticArt, Source/AnimationSources, preview}.'
};

// Predefined element catalogue. Order here is the default display order; the
// user can reorder via the up/down arrows in the selection list.
const BASE_ELEMENTS = [
  'Background',
  'Symbols',
  'Machine_Frame',
  'Win_Sequence',
  'Logo',
  'Fonts'
];

const COMMON_ELEMENTS = [
  'Bonus_Game',
  'Intro_Outro',
  'Total_Win',
  'Preloader',
  'Transition',
  'Character',
  'Free_Spin_Counter',
  'Buttons'
];

const DEFAULT_SUBFOLDERS = [
  { id: 'exportAnim',   path: 'Export/Animation',        label: 'Export/Animation',        on: true },
  { id: 'exportStatic', path: 'Export/StaticArt',        label: 'Export/StaticArt',        on: true },
  { id: 'sourceAnim',   path: 'Source/AnimationSources', label: 'Source/AnimationSources', on: true },
  { id: 'preview',      path: 'preview',                 label: 'preview',                 on: true }
];

// Per-element overrides — element names whose folder layout differs from the
// canonical Export/Source/preview triple. Matched case-insensitively against
// the element's slug. The override always wins over the user's subfolder
// toggles since these layouts don't map onto the standard set.
const ELEMENT_OVERRIDES = {
  fonts: ['TTF_Source', 'Static_Export', 'Static_Source']
};

// Sanitize a user-typed name into a folder-safe slug. Keeps letters / digits,
// converts spaces and slashes to underscores, strips anything else.
function slugify(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\s/\\]+/g, '_')
    .replace(/[^A-Za-z0-9_\-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Pure path builder — used both by the React preview memo and by the
// registered runner (via settingsRef) so a stale-closure registration
// still produces output reflecting current state.
function computePaths({ projectName, selected, subfolders, includeUnityExport }) {
  const rootSlug = slugify(projectName) || 'NewSlot';
  const out = [];
  const defaultSubs = subfolders.filter((s) => s.on).map((s) => s.path);
  selected.forEach((el, i) => {
    const elFolder = `${pad2(i + 1)}_${el.name}`;
    const base = includeUnityExport
      ? `${rootSlug}/unity_export/${elFolder}`
      : `${rootSlug}/${elFolder}`;
    const override = ELEMENT_OVERRIDES[el.name.toLowerCase()];
    const subs = override || defaultSubs;
    if (subs.length === 0) out.push(base + '/');
    else for (const sub of subs) out.push(`${base}/${sub}/`);
  });
  return out;
}

// Build a folder-tree from the flat list of paths the scaffold produces.
// Each path looks like "Project/unity_export/01_Background/Export/Animation/".
function buildPathTree(paths) {
  const root = { name: '', path: '', children: new Map() };
  for (const raw of paths) {
    const segs = raw.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const path = segs.slice(0, i + 1).join('/');
      if (!node.children.has(seg)) {
        node.children.set(seg, { name: seg, path, children: new Map() });
      }
      node = node.children.get(seg);
    }
  }
  return root;
}

function TreeNode({ node, depth, openMap, toggle }) {
  const childList = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Default everything open (true). Once the user collapses a node it lands
  // in openMap as false.
  const open = openMap[node.path] ?? true;
  const hasChildren = childList.length > 0;
  return (
    <div className="ac-tree-node">
      {node.path !== '' && (
        <div
          className="ac-tree-row"
          style={{ paddingLeft: depth * 12, cursor: hasChildren ? 'pointer' : 'default' }}
          onClick={() => hasChildren && toggle(node.path)}
        >
          <span className="ac-tree-caret">
            {hasChildren ? (open ? '▾' : '▸') : ' '}
          </span>
          <span className="ac-tree-name">{node.name}</span>
        </div>
      )}
      {open && hasChildren && childList.map((c) => (
        <TreeNode
          key={c.path}
          node={c}
          depth={node.path === '' ? 0 : depth + 1}
          openMap={openMap}
          toggle={toggle}
        />
      ))}
    </div>
  );
}

async function buildZipFrom(state) {
  if (!state.selected.length) return null;
  const paths = computePaths(state);
  const zip = new JSZip();
  // Two strategies: a literal .gitkeep file in each leaf (most portable —
  // every unzip tool will recreate the folder), or a bare folder entry via
  // JSZip.folder() (cleaner ZIP, but some unzip tools silently drop empty
  // directory entries on extract).
  for (const p of paths) {
    if (state.addGitkeep) zip.file(p + '.gitkeep', '');
    else zip.folder(p.replace(/\/$/, ''));
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function ProjectScaffoldTool() {
  const { log, registerRunner } = useApp();

  const [projectName, setProjectName] = useState('NewSlot');
  const [includeUnityExport, setIncludeUnityExport] = useState(true);

  // Selection model: array of { name, source } in display order. Source is
  // 'base' | 'common' | 'custom' (used only for the toggle UI).
  const [selected, setSelected] = useState(
    BASE_ELEMENTS.map((name) => ({ name, source: 'base' }))
  );

  const [customDraft, setCustomDraft] = useState('');
  const [subfolders, setSubfolders] = useState(DEFAULT_SUBFOLDERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [addGitkeep, setAddGitkeep] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSelected = (name) => selected.some((s) => s.name === name);

  const toggle = (name, source) => {
    setSelected((prev) => {
      if (prev.some((s) => s.name === name)) return prev.filter((s) => s.name !== name);
      return [...prev, { name, source }];
    });
  };

  const addCustom = () => {
    const slug = slugify(customDraft);
    if (!slug) return;
    if (selected.some((s) => s.name.toLowerCase() === slug.toLowerCase())) {
      log(`"${slug}" is already in the list.`, 'err');
      return;
    }
    setSelected((prev) => [...prev, { name: slug, source: 'custom' }]);
    setCustomDraft('');
  };

  const removeRow = (name) =>
    setSelected((prev) => prev.filter((s) => s.name !== name));

  const move = (idx, dir) => {
    setSelected((prev) => {
      const next = prev.slice();
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const toggleSub = (id) =>
    setSubfolders((prev) => prev.map((s) => (s.id === id ? { ...s, on: !s.on } : s)));

  // Build the list of full ZIP paths the current selection will create.
  const previewPaths = useMemo(
    () => computePaths({ projectName, selected, subfolders, includeUnityExport }),
    [projectName, selected, subfolders, includeUnityExport]
  );

  // Folder tree view of the same paths — re-derived whenever previewPaths
  // changes, so toggling subfolder template / Fonts override / element order
  // updates the tree live.
  const previewTree = useMemo(() => buildPathTree(previewPaths), [previewPaths]);
  const [treeOpen, setTreeOpen] = useState({});
  const toggleTreeNode = (p) =>
    setTreeOpen((m) => ({ ...m, [p]: !(m[p] ?? true) }));
  const expandAll = () => setTreeOpen({});
  const collapseAll = () => {
    // Mark every directory node as closed except the root segment so the
    // user still sees the project name itself.
    const next = {};
    const walk = (node) => {
      if (node.path) next[node.path] = false;
      for (const c of node.children.values()) walk(c);
    };
    walk(previewTree);
    setTreeOpen(next);
  };

  const buildZip = async () => {
    if (!selected.length) {
      log('Select at least one element first.', 'err');
      return null;
    }
    return buildZipFrom({ projectName, selected, subfolders, includeUnityExport, addGitkeep });
  };

  const downloadZip = async () => {
    setBusy(true);
    try {
      const blob = await buildZip();
      if (!blob) return;
      const rootSlug = slugify(projectName) || 'NewSlot';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rootSlug}_scaffold.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      log(`Scaffold ZIP created: ${selected.length} element(s), ${previewPaths.length} folder(s).`, 'ok');
    } catch (e) {
      log(`Scaffold build failed: ${e.message || e}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  // Register a runner so the toolbar RUN button also produces the ZIP and
  // surfaces it in the output panel.
  const settingsRef = useRef({});
  settingsRef.current = { projectName, selected, subfolders, includeUnityExport, addGitkeep };

  useEffect(() => {
    registerRunner(projectScaffoldMeta.id, {
      outName: () => `${slugify(settingsRef.current.projectName) || 'NewSlot'}_scaffold.zip`,
      run: async () => buildZipFrom(settingsRef.current)
    });
    return () => registerRunner(projectScaffoldMeta.id, null);
  }, [registerRunner]);

  return (
    <div className="tool-section ps-root">
      <div className="field-row">
        <div className="field">
          <label>Project name</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="NewSlot"
          />
        </div>
        <div className="field">
          <label>Wrap in unity_export/</label>
          <label className="ps-inline-check">
            <input type="checkbox" checked={includeUnityExport} onChange={(e) => setIncludeUnityExport(e.target.checked)} />
            <span>Yes — root the elements under <code>unity_export/</code></span>
          </label>
        </div>
      </div>

      <div className="ps-section">
        <div className="ps-section-head">Base elements</div>
        <div className="ps-checks">
          {BASE_ELEMENTS.map((name) => (
            <label key={name} className="ps-check">
              <input type="checkbox" checked={isSelected(name)} onChange={() => toggle(name, 'base')} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="ps-section">
        <div className="ps-section-head">Common elements</div>
        <div className="ps-checks">
          {COMMON_ELEMENTS.map((name) => (
            <label key={name} className="ps-check">
              <input type="checkbox" checked={isSelected(name)} onChange={() => toggle(name, 'common')} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="ps-section">
        <div className="ps-section-head">Add custom element</div>
        <div className="ps-add-row">
          <input
            type="text"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            placeholder="e.g. mini_game"
          />
          <button className="btn" type="button" onClick={addCustom}>+ Add</button>
        </div>
        <div className="ps-hint">Spaces &amp; slashes become <code>_</code>, other punctuation is stripped.</div>
      </div>

      <div className="ps-section">
        <div className="ps-section-head">Selection &amp; order ({selected.length})</div>
        {selected.length === 0 && (
          <div className="ps-empty">No elements selected. Tick at least one above.</div>
        )}
        {selected.length > 0 && (
          <div className="ps-order-list">
            {selected.map((el, i) => (
              <div key={el.name} className="ps-order-row">
                <span className="ps-order-num">{pad2(i + 1)}_</span>
                <span className="ps-order-name">{el.name}</span>
                <span className={`ps-order-tag ps-tag-${el.source}`}>{el.source}</span>
                <div className="ps-order-arrows">
                  <button className="btn ps-arrow" type="button" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn ps-arrow" type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1}>↓</button>
                </div>
                <button className="btn ps-x" type="button" onClick={() => removeRow(el.name)} title="Remove">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ps-section">
        <button className="ps-toggle" type="button" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '▼' : '▶'} Subfolder template (per element)
        </button>
        {showAdvanced && (
          <div className="ps-checks ps-subs">
            {subfolders.map((s) => (
              <label key={s.id} className="ps-check">
                <input type="checkbox" checked={s.on} onChange={() => toggleSub(s.id)} />
                <code>{s.label}</code>
              </label>
            ))}
            <div className="ps-hint">Untick a row to omit it from every element. At least one must stay on for nested folders to be created — with none ticked you get only empty element roots.</div>
            <div className="ps-hint">Element overrides: <code>Fonts</code> → <code>TTF_Source</code>, <code>Static_Export</code>, <code>Static_Source</code> (the toggles above are ignored for that one).</div>

            <label className="ps-check" style={{ marginTop: '.4rem' }}>
              <input type="checkbox" checked={addGitkeep} onChange={(e) => setAddGitkeep(e.target.checked)} />
              <span>Add <code>.gitkeep</code> placeholders in every leaf folder</span>
            </label>
            <div className="ps-hint">Off by default — empty folders are stored as plain ZIP folder entries. Turn this on if your unzip tool drops empty directories on extract.</div>
          </div>
        )}
      </div>

      <div className="ps-section">
        <div className="ps-tree-head">
          <span className="ps-section-head">Preview ({previewPaths.length} folder{previewPaths.length === 1 ? '' : 's'})</span>
          <div className="ps-tree-actions">
            <button className="btn ps-arrow" type="button" onClick={expandAll} title="Expand all">▾ all</button>
            <button className="btn ps-arrow" type="button" onClick={collapseAll} title="Collapse all">▸ all</button>
          </div>
        </div>
        <div className="ps-tree-wrap">
          {previewPaths.length === 0 ? (
            <div className="ps-empty">(empty — pick at least one element)</div>
          ) : (
            <div className="ac-tree">
              <TreeNode node={previewTree} depth={0} openMap={treeOpen} toggle={toggleTreeNode} />
            </div>
          )}
        </div>
      </div>

      <div className="action-row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !selected.length}
          onClick={downloadZip}
        >
          {busy ? 'building…' : '📦 Download ZIP'}
        </button>
        <span className="progress-label">{selected.length} element(s) · {previewPaths.length} folder(s)</span>
      </div>

      <style>{`
        .ps-section{display:flex;flex-direction:column;gap:.5rem}
        .ps-section-head{font-family:var(--font-mono);font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
        .ps-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.4rem .9rem}
        .ps-check{display:flex;align-items:center;gap:.5rem;font-family:var(--font-mono);font-size:.74rem;color:var(--text);cursor:pointer}
        .ps-check input{accent-color:var(--accent)}
        .ps-check code{font-size:.7rem;color:var(--accent2)}
        .ps-inline-check{display:flex;align-items:center;gap:.5rem;font-family:var(--font-mono);font-size:.72rem;color:var(--muted);cursor:pointer;padding:.5rem 0}
        .ps-add-row{display:flex;gap:.5rem;align-items:center}
        .ps-add-row input{flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:.78rem;padding:.45rem .7rem;border-radius:4px;outline:none}
        .ps-add-row input:focus{border-color:var(--accent2)}
        .ps-hint{font-family:var(--font-mono);font-size:.62rem;color:#555;line-height:1.5}
        .ps-empty{font-family:var(--font-mono);font-size:.7rem;color:#555;padding:.5rem 0}
        .ps-order-list{display:flex;flex-direction:column;gap:.25rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:.4rem;max-height:240px;overflow-y:auto}
        .ps-order-row{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:.5rem;padding:.3rem .5rem;border-radius:3px;background:var(--surface);border:1px solid transparent;font-family:var(--font-mono);font-size:.74rem}
        .ps-order-row:hover{border-color:var(--border)}
        .ps-order-num{color:var(--muted);font-size:.7rem}
        .ps-order-name{color:var(--text)}
        .ps-order-tag{font-size:.55rem;padding:.1rem .35rem;border-radius:2px;text-transform:uppercase;letter-spacing:.06em;color:#888;border:1px solid #333}
        .ps-tag-base{color:var(--accent);border-color:rgba(255,118,46,.35)}
        .ps-tag-common{color:var(--accent2);border-color:rgba(71,200,255,.35)}
        .ps-tag-custom{color:#9bdc6c;border-color:rgba(155,220,108,.35)}
        .ps-order-arrows{display:flex;gap:.2rem}
        .ps-arrow{padding:.15rem .45rem;font-size:.65rem;line-height:1}
        .ps-x{padding:.15rem .5rem;font-size:.85rem;line-height:1;color:var(--muted)}
        .ps-x:hover:not(:disabled){color:var(--accent3);border-color:var(--accent3)}
        .ps-toggle{background:transparent;border:none;color:var(--muted);font-family:var(--font-mono);font-size:.7rem;cursor:pointer;padding:.2rem 0;text-align:left}
        .ps-toggle:hover{color:var(--text)}
        .ps-subs{margin-top:.4rem}
        .ps-tree-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
        .ps-tree-actions{display:flex;gap:.3rem}
        .ps-tree-wrap{background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:.5rem .6rem;max-height:260px;overflow:auto}
      `}</style>
    </div>
  );
}
