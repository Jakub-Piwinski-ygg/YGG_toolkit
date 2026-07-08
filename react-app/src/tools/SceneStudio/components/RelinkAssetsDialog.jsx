// RelinkAssetsDialog — manual recovery for assets whose on-disk path changed.
//
// Auto-relink (persist.relinkSceneAssetsToScan) fixes assets it can match by
// filename. Whatever it can't (a file that was renamed, or a filename that now
// exists in several folders) lands here: the artist picks the exact current
// file to point each broken asset at — from a type-filtered dropdown of the
// live workspace scan — or leaves it unlinked (retried automatically next load).

import { useMemo, useState } from 'react';

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const panelStyle = {
  width: 640, maxWidth: '94vw', maxHeight: '86vh', overflow: 'auto',
  background: 'var(--bg2, #15191f)', border: '1px solid var(--line, #2a313b)',
  borderRadius: 8, padding: '18px 20px', boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
};

const fileNameOf = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

/** Options for one broken asset: scan items of the same type, labelled by folder/name. */
function optionsForType(type, scanItems) {
  // A static (png) may legitimately be re-pointed at any png/video; a spine
  // only at another spine rig.
  const wanted = type === 'spine' ? ['spine'] : ['png', 'video'];
  return scanItems
    .filter((it) => wanted.includes(it.type))
    .map((it) => ({
      id: it.id,
      item: it,
      label: `${it.folder ? it.folder + '/' : ''}${it.type === 'spine' ? it.name : fileNameOf(it.path)}`,
    }));
}

export function RelinkAssetsDialog({ assets, scanItems, onApply, onClose }) {
  // assetId → chosen scan-item id ('' = leave unlinked)
  const [choices, setChoices] = useState({});

  const rows = useMemo(() => assets.map((a) => ({
    asset: a,
    label: a.meta?.originalName || fileNameOf(a.src) || a.id,
    options: optionsForType(a.type, scanItems || []),
  })), [assets, scanItems]);

  const chosenCount = Object.values(choices).filter(Boolean).length;

  const apply = () => {
    const byId = new Map((scanItems || []).map((it) => [it.id, it]));
    const mappings = Object.entries(choices)
      .filter(([, itemId]) => itemId)
      .map(([assetId, itemId]) => ({ assetId, item: byId.get(itemId) }))
      .filter((m) => m.item);
    onApply(mappings);
  };

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panelStyle}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Relink missing assets</div>
        <div style={{ fontSize: 12, color: 'var(--muted, #8a93a3)', marginBottom: 14 }}>
          {assets.length} asset{assets.length !== 1 ? 's' : ''} couldn’t be located in the current workspace.
          Pick the matching file for each, or leave it unlinked — unlinked assets are retried automatically next
          time the project loads.
        </div>

        {rows.map(({ asset, label, options }) => (
          <div key={asset.id} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
            <div style={{ flex: '0 0 210px', minWidth: 0 }}>
              <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>
                {label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={asset.src}>
                <span style={{ textTransform: 'uppercase', marginRight: 6, opacity: 0.7 }}>{asset.type}</span>
                {asset.src}
              </div>
            </div>
            <select
              style={{
                flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 12,
                background: 'var(--bg, #0f1216)', color: 'var(--text, #e6e9ee)',
                border: '1px solid var(--line, #2a313b)', borderRadius: 5,
              }}
              value={choices[asset.id] || ''}
              onChange={(e) => setChoices((prev) => ({ ...prev, [asset.id]: e.target.value }))}
            >
              <option value="">— leave unlinked —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}

        {!rows.some((r) => r.options.length) && (
          <div style={{ fontSize: 12, color: 'var(--warn, #e0b34a)', margin: '10px 0' }}>
            No matching files of these types were found in the workspace — check the picked project folder.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="scene-btn scene-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="scene-btn scene-btn--primary" onClick={apply} disabled={!chosenCount}>
            Relink {chosenCount || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
