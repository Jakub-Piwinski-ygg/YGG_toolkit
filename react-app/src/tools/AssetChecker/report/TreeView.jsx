import { useMemo, useState } from 'react';

// Build a folder tree with finding counts per node.
function buildTree(entries, findings) {
  const empty = () => ({ error: 0, warn: 0, info: 0, pass: 0 });
  const root = { name: '', path: '', kind: 'dir', children: new Map(), counts: empty() };
  for (const e of entries) {
    let node = root;
    const segs = e.segments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const path = segs.slice(0, i + 1).join('/');
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          name: seg,
          path,
          kind: i === segs.length - 1 ? 'file' : 'dir',
          children: new Map(),
          counts: empty()
        });
      }
      node = node.children.get(seg);
    }
  }
  // tally findings up the tree
  for (const f of findings) {
    for (const p of f.paths || []) {
      const segs = p.split('/').filter(Boolean);
      let node = root;
      node.counts[f.severity] = (node.counts[f.severity] || 0) + 1;
      for (const s of segs) {
        if (!node.children.has(s)) break;
        node = node.children.get(s);
        node.counts[f.severity] = (node.counts[f.severity] || 0) + 1;
      }
    }
  }
  return root;
}

function Node({ node, depth, selected, onSelect, openMap, toggle, sevFilter }) {
  if (!node.children) return null;
  const childList = [...node.children.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const open = openMap[node.path] ?? depth < 1;
  const flags = sevFilter || { error: true, warn: true, info: false, pass: false };
  const badges = [
    flags.error && node.counts.error > 0 && { cls: 'err',  n: node.counts.error },
    flags.warn  && node.counts.warn  > 0 && { cls: 'warn', n: node.counts.warn },
    flags.info  && node.counts.info  > 0 && { cls: 'info', n: node.counts.info },
    flags.pass  && node.counts.pass  > 0 && { cls: 'pass', n: node.counts.pass }
  ].filter(Boolean);
  return (
    <div className="ac-tree-node">
      {node.path !== '' && (
        <div
          className={`ac-tree-row ${selected === node.path ? 'sel' : ''}`}
          style={{ paddingLeft: depth * 12 }}
          onClick={() => {
            if (node.kind === 'dir') toggle(node.path);
            onSelect?.(node.path);
          }}
        >
          <span className="ac-tree-caret">
            {node.kind === 'dir' ? (open ? '▾' : '▸') : ' '}
          </span>
          <span className="ac-tree-name">{node.name}</span>
          {badges.map((b) => (
            <span key={b.cls} className={`ac-tree-badge ${b.cls}`}>{b.n}</span>
          ))}
        </div>
      )}
      {open && node.kind === 'dir' && childList.map((c) => (
        <Node key={c.path} node={c} depth={node.path === '' ? 0 : depth + 1} selected={selected} onSelect={onSelect} openMap={openMap} toggle={toggle} sevFilter={sevFilter} />
      ))}
    </div>
  );
}

export function TreeView({ entries, findings, selected, onSelect, sevFilter }) {
  const [openMap, setOpenMap] = useState({});
  const tree = useMemo(() => buildTree(entries, findings), [entries, findings]);
  const toggle = (p) => setOpenMap((m) => ({ ...m, [p]: !(m[p] ?? false) }));
  return (
    <div className="ac-tree">
      <Node node={tree} depth={0} selected={selected} onSelect={onSelect} openMap={openMap} toggle={toggle} sevFilter={sevFilter} />
    </div>
  );
}
