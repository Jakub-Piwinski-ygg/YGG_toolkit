import { useMemo, useRef, useState } from 'react';
import { isFsAccessSupported } from '../engine/persist.js';

// Folders inside these names are skipped from the UI tree (they exist on
// disk but never contain art the user wants to browse). Matches the same
// skip list used by scanProjectAssets so the tree shape is consistent.
const HIDDEN_DIRS = new Set(['Library', 'Logs', 'Temp', 'obj', 'Build', 'node_modules', '.git', '.idea', '.vs']);

export function AssetBrowserPanel({
  items,
  onAddItem,
  hasRoot = false,
  onPickRoot,
  onPickFolderFallback, // (File[]) => void — called when user picks a folder via webkitdirectory input
  busy = false,
  pickError = null,
  onDismissPickError,
  rootDropSupported = false,
  rootDropHover = false,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop
}) {
  const fallbackInputRef = useRef(null);
  // Build a folder tree from the flat list. Each node: { name, path, children:Map, items:[] }.
  const tree = useMemo(() => buildFolderTree(items), [items]);
  const totalItems = items.length;

  // Default-expanded set. Empty Set means everything is collapsed; we
  // pre-populate root so the user sees the top level immediately and can
  // drill down. Auto-expand a folder when only one path leads to assets.
  const initialExpanded = useMemo(() => {
    const s = new Set(['']);
    autoExpandSingleChild(tree, '', s);
    return s;
  }, [tree]);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [filter, setFilter] = useState('');

  const isOpen = (path) => expanded.has(path);
  const toggle = (path) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const expandAll = () => {
    const next = new Set();
    walkTree(tree, '', (_n, path) => next.add(path));
    setExpanded(next);
  };
  const collapseAll = () => setExpanded(new Set(['']));

  const filterLower = filter.trim().toLowerCase();
  const filtered = filterLower ? filterTree(tree, filterLower) : tree;

  return (
    <div className="scene-panel scene-panel--left scene-panel--assets">
      <div className="scene-panel-head scene-asset-panel-head">
        <span>assets</span>
        {hasRoot && (
          <span className="scene-asset-count">{totalItems}</span>
        )}
      </div>

      {!hasRoot && (
        <div className="scene-workspace-cta">
          <div className="scene-workspace-cta-title">No Workspace Loaded</div>
          <div className="scene-workspace-cta-sub">
            {isFsAccessSupported()
              ? 'Pick your project folder from Explorer.'
              : 'Pick a project folder — Firefox / Safari fallback uses a read-only snapshot (scene.json saves go to Downloads).'}
          </div>
          {isFsAccessSupported() ? (
            <button className="scene-btn scene-btn--primary scene-workspace-cta-btn" onClick={onPickRoot} disabled={busy}>
              {busy ? '⏳ opening picker…' : '📁 load workspace folder'}
            </button>
          ) : (
            <label className={'scene-btn scene-btn--primary scene-workspace-cta-btn' + (busy ? ' scene-btn--disabled' : '')}>
              <input
                ref={fallbackInputRef}
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  // Reset so picking the same folder again triggers a fresh change
                  if (fallbackInputRef.current) fallbackInputRef.current.value = '';
                  if (files.length) onPickFolderFallback?.(files);
                }}
                disabled={busy}
              />
              {busy ? '⏳ loading…' : '📁 load workspace folder'}
            </label>
          )}
          {pickError && (
            <div className="scene-workspace-cta-error">
              <span className="scene-workspace-cta-error-msg">⚠ {pickError}</span>
              <button className="scene-btn scene-btn--ghost" onClick={onDismissPickError}>✕</button>
            </div>
          )}
        </div>
      )}

      {rootDropSupported && (
        <div
          className={'scene-assets-root-drop' + (rootDropHover ? ' active' : '')}
          onDragOver={onRootDragOver}
          onDragLeave={onRootDragLeave}
          onDrop={onRootDrop}
        >
          drop workspace folder here to link root
        </div>
      )}

      {hasRoot && totalItems === 0 && (
        <div className="scene-empty">no png / spine / video files found under root</div>
      )}

      {hasRoot && totalItems > 0 && (
        <>
          <div className="scene-asset-toolbar">
            <input
              className="scene-asset-filter"
              type="text"
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button className="scene-btn scene-btn--ghost" onClick={expandAll} title="Expand all folders">⊞</button>
            <button className="scene-btn scene-btn--ghost" onClick={collapseAll} title="Collapse all">⊟</button>
          </div>
          <div className="scene-asset-tree">
            <FolderNode
              node={filtered}
              path=""
              isOpen={isOpen}
              onToggle={toggle}
              onAddItem={onAddItem}
              forceOpen={!!filterLower}
              depth={0}
            />
          </div>
        </>
      )}
    </div>
  );
}

function FolderNode({ node, path, isOpen, onToggle, onAddItem, forceOpen, depth }) {
  const childrenArr = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
  const items = node.items.slice().sort((a, b) => a.name.localeCompare(b.name));
  const open = forceOpen || isOpen(path) || depth === 0;
  const isRoot = depth === 0;

  return (
    <div className="scene-asset-tree-node">
      {!isRoot && (
        <div
          className="scene-asset-folder-row"
          style={{ paddingLeft: 6 + (depth - 1) * 12 }}
          onClick={() => onToggle(path)}
          title={path}
        >
          <span className="scene-asset-folder-twirly">{(childrenArr.length || items.length) ? (open ? '▾' : '▸') : '·'}</span>
          <span className="scene-asset-folder-icon">📁</span>
          <span className="scene-asset-folder-name">{node.name || '/'}</span>
          <span className="scene-asset-folder-count">{countAssets(node)}</span>
        </div>
      )}
      {open && (
        <>
          {childrenArr.map((child) => (
            <FolderNode
              key={child.path}
              node={child}
              path={child.path}
              isOpen={isOpen}
              onToggle={onToggle}
              onAddItem={onAddItem}
              forceOpen={forceOpen}
              depth={depth + 1}
            />
          ))}
          {items.length > 0 && (
            <ul className="scene-asset-list" style={{ paddingLeft: isRoot ? 4 : 6 + depth * 12 }}>
              {items.map((it) => (
                <li
                  key={it.id}
                  className="scene-asset-row"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/x-ygg-asset-id', it.id);
                  }}
                  onClick={() => onAddItem?.(it)}
                  onDoubleClick={() => onAddItem?.(it)}
                  title={`Drag or click to add ${it.name} to scene`}
                >
                  <span className="scene-asset-kind">{it.type}</span>
                  <span className="scene-asset-name">{it.name}</span>
                  <span className="scene-asset-add">+</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function buildFolderTree(items) {
  const root = { name: '', path: '', children: new Map(), items: [] };
  for (const it of items) {
    const folder = it.folder || '';
    const segments = folder ? folder.split('/').filter((s) => s && !HIDDEN_DIRS.has(s)) : [];
    let cursor = root;
    let curPath = '';
    for (const seg of segments) {
      curPath = curPath ? `${curPath}/${seg}` : seg;
      if (!cursor.children.has(seg)) {
        cursor.children.set(seg, { name: seg, path: curPath, children: new Map(), items: [] });
      }
      cursor = cursor.children.get(seg);
    }
    cursor.items.push(it);
  }
  return root;
}

function autoExpandSingleChild(node, path, set) {
  // Auto-expand single-child chains so the user doesn't have to click
  // through every wrapper directory to see content.
  const kids = Array.from(node.children.values());
  if (kids.length === 1 && node.items.length === 0) {
    set.add(kids[0].path);
    autoExpandSingleChild(kids[0], kids[0].path, set);
  }
}

function walkTree(node, path, visit) {
  visit(node, path);
  for (const child of node.children.values()) walkTree(child, child.path, visit);
}

function countAssets(node) {
  let n = node.items.length;
  for (const child of node.children.values()) n += countAssets(child);
  return n;
}

function filterTree(root, query) {
  const clone = (n) => ({ name: n.name, path: n.path, children: new Map(), items: [] });
  const out = clone(root);

  const visit = (src, dst) => {
    let hit = false;
    for (const item of src.items) {
      if (item.name.toLowerCase().includes(query) || (item.folder || '').toLowerCase().includes(query)) {
        dst.items.push(item);
        hit = true;
      }
    }
    for (const child of src.children.values()) {
      const dstChild = clone(child);
      if (visit(child, dstChild)) {
        dst.children.set(child.name, dstChild);
        hit = true;
      }
    }
    return hit;
  };
  visit(root, out);
  return out;
}
