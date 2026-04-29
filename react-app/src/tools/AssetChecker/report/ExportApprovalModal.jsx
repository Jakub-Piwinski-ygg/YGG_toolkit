import { useMemo, useState } from 'react';
import { planExport, recomputeConflicts, buildZip } from '../engine/exportToUnity.js';

export function ExportApprovalModal({ entries, settings, log, onClose }) {
  const [items, setItems] = useState(() => planExport(entries, settings));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [filter, setFilter] = useState('changed');  // 'all' | 'changed' | 'conflict'

  const stats = useMemo(() => {
    const changed = items.filter((it) => it.ruleHits.length > 0).length;
    const conflict = items.filter((it) => it.conflict).length;
    const willRename = items.filter((it) => it.apply && !it.conflict && it.ruleHits.length > 0).length;
    return { total: items.length, changed, conflict, willRename };
  }, [items]);

  const ruleGroups = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!it.ruleHits.length) continue;
      for (const r of it.ruleHits) {
        if (!m.has(r)) m.set(r, 0);
        m.set(r, m.get(r) + 1);
      }
    }
    return [...m.entries()];
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'changed') return items.filter((it) => it.ruleHits.length > 0);
    if (filter === 'conflict') return items.filter((it) => it.conflict);
    return items;
  }, [items, filter]);

  const toggleApply = (idx) => {
    setItems((arr) => {
      const next = arr.slice();
      next[idx] = { ...next[idx], apply: !next[idx].apply };
      return recomputeConflicts(next);
    });
  };

  const setAll = (val) => {
    setItems((arr) => recomputeConflicts(arr.map((it) => (it.ruleHits.length ? { ...it, apply: val } : it))));
  };

  const onConfirm = async () => {
    setBusy(true);
    setProgress('preparing…');
    try {
      const blob = await buildZip(items, settings, (p) => setProgress(p));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${settings.projectName || 'UnityExport'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log(`Exported ${items.length} files → ${settings.projectName || 'UnityExport'}.zip`, 'ok');
      onClose();
    } catch (e) {
      log(`Export failed: ${e.message}`, 'err');
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div className="ac-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="ac-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ac-modal-head">
          <div className="ac-modal-title">Review export — {stats.total} files</div>
          <button className="ac-modal-close" onClick={onClose} disabled={busy}>×</button>
        </div>

        <div className="ac-modal-stats">
          <span>{stats.changed} affected by rules</span>
          <span>{stats.willRename} will be renamed</span>
          <span className={stats.conflict ? 'ac-modal-conflict' : ''}>{stats.conflict} conflicts</span>
        </div>

        {ruleGroups.length > 0 && (
          <div className="ac-modal-groups">
            {ruleGroups.map(([rule, count]) => (
              <span key={rule} className="ac-modal-pill">{rule}: {count}</span>
            ))}
          </div>
        )}

        <div className="ac-modal-toolbar">
          <div className="ac-modal-filters">
            <label><input type="radio" checked={filter === 'changed'} onChange={() => setFilter('changed')} /> Changed</label>
            <label><input type="radio" checked={filter === 'conflict'} onChange={() => setFilter('conflict')} /> Conflicts</label>
            <label><input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> All</label>
          </div>
          <div className="ac-modal-bulk">
            <button className="btn" onClick={() => setAll(true)} disabled={busy}>Apply all</button>
            <button className="btn" onClick={() => setAll(false)} disabled={busy}>Reject all</button>
          </div>
        </div>

        <div className="ac-modal-table">
          <div className="ac-modal-row ac-modal-header">
            <span>✓</span>
            <span>Original</span>
            <span>→ Target</span>
            <span>Rules</span>
          </div>
          {visible.length === 0 ? (
            <div className="ac-modal-empty">No items match this filter.</div>
          ) : visible.map((it) => {
            const idx = items.indexOf(it);
            const hasRename = it.ruleHits.length > 0;
            const target = it.apply && !it.conflict ? it.renamedTarget : it.originalTarget;
            return (
              <div key={idx} className={`ac-modal-row${it.conflict ? ' ac-modal-row-conflict' : ''}`}>
                <span>
                  {hasRename ? (
                    <input
                      type="checkbox"
                      checked={it.apply && !it.conflict}
                      disabled={it.conflict || busy}
                      onChange={() => toggleApply(idx)}
                    />
                  ) : '·'}
                </span>
                <span className="ac-modal-path">{it.entry.relPath}</span>
                <span className="ac-modal-path">{target}{it.conflict && ' ⚠'}</span>
                <span className="ac-modal-hits">{it.ruleHits.join(', ') || '—'}</span>
              </div>
            );
          })}
        </div>

        <div className="ac-modal-actions">
          {busy ? (
            <span className="ac-modal-progress">{progress}</span>
          ) : (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={onConfirm} disabled={stats.conflict > 0 && stats.willRename === 0 && stats.conflict === stats.changed}>
                Build ZIP ({stats.total} files)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
