import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { groupBy } from '../engine/findings.js';

const SEV_ICON = { error: '✕', warn: '!', info: 'i', pass: '✓' };
const SEV_COLOR = { error: '#e85a5a', warn: '#e0a93a', info: '#5aa0e8', pass: '#4cff88' };

function InlinePreview({ kind, url, text, path }) {
  return (
    <motion.div
      key={path + (kind || '')}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      style={{ overflow: 'hidden' }}
      className="ac-inline-preview-wrap"
    >
      <div className="ac-inline-preview">
        {kind === 'image' && url && <img src={url} alt="" className="ac-preview-img" />}
        {kind === 'text'  && <pre className="ac-preview-text">{text}</pre>}
        {kind === 'binary' && <div className="ac-preview-bin">No inline preview for this file type.</div>}
      </div>
    </motion.div>
  );
}

function CollapsibleGroup({ label, list, onSelectFile, selectedFile, previewUrl, previewKind, previewText }) {
  const [open, setOpen] = useState(true);
  const counts = list.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {});
  return (
    <div className={`ac-group ${open ? 'open' : 'closed'}`}>
      <div className="ac-group-head" onClick={() => setOpen((v) => !v)}>
        <span className="ac-group-caret">{open ? '▾' : '▸'}</span>
        <span className="ac-group-label">{label}</span>
        <span className="ac-group-meta">
          {counts.error ? <span className="ac-mini-err">{counts.error} err</span> : null}
          {counts.warn ? <span className="ac-mini-warn">{counts.warn} warn</span> : null}
          {counts.info ? <span className="ac-mini-info">{counts.info} info</span> : null}
          {counts.pass ? <span className="ac-mini-pass">{counts.pass} pass</span> : null}
          <span className="ac-group-count">{list.length}</span>
        </span>
      </div>
      {open && list.map((f) => (
        <FindingRow
          key={f.uid}
          f={f}
          onSelect={onSelectFile}
          selectedFile={selectedFile}
          previewUrl={previewUrl}
          previewKind={previewKind}
          previewText={previewText}
        />
      ))}
    </div>
  );
}

function FindingRow({ f, onSelect, selectedFile, previewUrl, previewKind, previewText }) {
  const [copied, setCopied] = useState(false);
  const sug = f.data?.suggestion;
  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="ac-finding" style={{ borderLeftColor: SEV_COLOR[f.severity] }}>
      <div className="ac-fhead">
        <span className="ac-sev" style={{ background: SEV_COLOR[f.severity] }}>
          {SEV_ICON[f.severity]}
        </span>
        {f.severity === 'pass' && f.data?.passOf && (
          <span
            className="ac-passof"
            style={{ background: SEV_COLOR[f.data.passOf] }}
            title={`If this check failed, it would be a ${f.data.passOf}.`}
          >
            {SEV_ICON[f.data.passOf]}
          </span>
        )}
        <span className="ac-fcat">{f.category}</span>
        <span className="ac-fmsg">{f.message}</span>
      </div>
      {f.hint && <div className="ac-fhint">{f.hint}</div>}
      {sug && (
        <div className="ac-fsuggest">
          <span className="ac-fsuggest-label">Suggested fix</span>
          <span className="ac-fsuggest-from">{sug.from}</span>
          <span className="ac-fsuggest-arrow">→</span>
          <span className="ac-fsuggest-to">{sug.to}</span>
          <span className="ac-fsuggest-reason">({sug.reason})</span>
          <button className="ac-fsuggest-copy" onClick={() => copy(sug.to)}>{copied ? '✓ copied' : '⎘ copy'}</button>
        </div>
      )}
      {f.paths?.length > 0 && (
        <div className="ac-fpaths">
          {f.paths.map((p) => (
            <span
              key={p}
              className={`ac-fpath ${selectedFile === p ? 'sel' : ''}`}
              onClick={() => onSelect?.(p)}
            >{p}</span>
          ))}
        </div>
      )}
      {f.data?.kind === 'matrix' && <Matrix data={f.data} />}
      {f.data?.gauge && <SizeGauge gauge={f.data.gauge} />}
      <AnimatePresence initial={false}>
        {selectedFile && f.paths?.includes(selectedFile) && (
          <InlinePreview
            kind={previewKind}
            url={previewUrl}
            text={previewText}
            path={selectedFile}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Matrix({ data }) {
  return (
    <div className="ac-matrix">
      <div className="ac-matrix-title">{data.title}</div>
      <table>
        <thead>
          <tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => (
              <td key={j} className={String(cell).startsWith('✗') ? 'ac-cell-bad' : (String(cell).startsWith('✓') ? 'ac-cell-ok' : '')}>{cell}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Summary({ summary, sevFilter, onToggleSev }) {
  if (!summary) return null;
  const sizeMB = (summary.totalBytes / 1024 / 1024).toFixed(1);
  const SevCard = ({ sev, label, sevClass }) => {
    const active = sevFilter[sev];
    return (
      <div
        className={`ac-stat ac-stat-clickable ${sevClass} ${active ? 'on' : 'off'}`}
        onClick={() => onToggleSev?.(sev)}
        title={active ? `Hide ${label}` : `Show ${label}`}
      >
        <span className="ac-stat-num">{summary.counts[sev] || 0}</span>
        <span className="ac-stat-lbl">{label}</span>
      </div>
    );
  };
  return (
    <div className="ac-summary">
      {summary.modeLabel && (
        <div className={`ac-mode-badge ac-mode-${summary.mode}`}>
          <span className="ac-mode-dot" />
          <span className="ac-mode-text">{summary.modeLabel}</span>
          {summary.elementRoots?.length > 0 && (
            <span className="ac-mode-detail">{summary.elementRoots.length} element{summary.elementRoots.length === 1 ? '' : 's'}</span>
          )}
        </div>
      )}
      <SevCard sev="error" label="errors" sevClass="ac-stat-err" />
      <SevCard sev="warn"  label="warnings" sevClass="ac-stat-warn" />
      <SevCard sev="info"  label="info" sevClass="ac-stat-info" />
      <SevCard sev="pass"  label="passed" sevClass="ac-stat-pass" />
      <div className="ac-stat"><span className="ac-stat-num">{summary.fileCount}</span><span className="ac-stat-lbl">files</span></div>
      <div className="ac-stat"><span className="ac-stat-num">{sizeMB}MB</span><span className="ac-stat-lbl">total</span></div>
      <div className="ac-stat"><span className="ac-stat-num">{summary.atlasCount}</span><span className="ac-stat-lbl">atlases</span></div>
      <div className="ac-stat"><span className="ac-stat-num">{summary.jsonCount}</span><span className="ac-stat-lbl">spine .json</span></div>
      <div className="ac-stat"><span className="ac-stat-num">{summary.pngCount}</span><span className="ac-stat-lbl">PNGs</span></div>
    </div>
  );
}

function SizeGauge({ gauge }) {
  const pct = Math.max(0, Math.min(100, Math.round(gauge.t * 100)));
  const sizeMB = (gauge.bytes / 1024 / 1024).toFixed(2);
  return (
    <div className="ac-gauge">
      <div className="ac-gauge-track">
        <div className="ac-gauge-pointer" style={{ left: `${pct}%` }}>
          <span className="ac-gauge-pointer-label">{sizeMB}MB</span>
          <span className="ac-gauge-pointer-arrow">▼</span>
        </div>
        <div className="ac-gauge-marker" style={{ left: `${pct}%` }} />
      </div>
      <div className="ac-gauge-legend">
        <span className="ac-gauge-good">≤ {gauge.idealMB}MB pass</span>
        <span className="ac-gauge-bad">≥ {gauge.badMB}MB error</span>
      </div>
    </div>
  );
}

export function ReportView({ findings, summary, onSelectFile, selectedFile, previewUrl, previewKind, previewText, treeFilter, onClearTreeFilter, sevFilter, onToggleSev }) {
  const [view, setView] = useState('severity');
  const [search, setSearch] = useState('');
  const toggleSev = onToggleSev;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const prefix = treeFilter ? (treeFilter.endsWith('/') ? treeFilter : treeFilter + '/') : null;
    return findings.filter((f) => {
      if (!sevFilter[f.severity]) return false;
      if (treeFilter) {
        // include findings whose path equals selection or is below selected folder
        const inScope = (f.paths || []).some((p) =>
          p === treeFilter || p === treeFilter + '/' || p.startsWith(prefix)
        );
        if (!inScope) return false;
      }
      if (!term) return true;
      return (
        f.message.toLowerCase().includes(term) ||
        f.category.toLowerCase().includes(term) ||
        (f.paths || []).some((p) => p.toLowerCase().includes(term))
      );
    });
  }, [findings, sevFilter, search, treeFilter]);

  const grouped = useMemo(() => {
    if (view === 'severity') {
      return [
        ['Errors',   filtered.filter((f) => f.severity === 'error')],
        ['Warnings', filtered.filter((f) => f.severity === 'warn')],
        ['Info',     filtered.filter((f) => f.severity === 'info')],
        ['Passed',   filtered.filter((f) => f.severity === 'pass')]
      ].filter(([, list]) => list.length);
    }
    if (view === 'category') {
      const map = groupBy(filtered, (f) => f.category);
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    if (view === 'file') {
      const map = new Map();
      for (const f of filtered) {
        const key = f.paths[0] || '(no file)';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(f);
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    return [];
  }, [filtered, view]);

  return (
    <div className="ac-report">
      <Summary summary={summary} sevFilter={sevFilter} onToggleSev={toggleSev} />

      {treeFilter && (
        <div className="ac-tree-filter-bar">
          <span className="ac-tree-filter-label">Filtered to:</span>
          <span className="ac-tree-filter-path">{treeFilter}</span>
          <span className="ac-tree-filter-count">{filtered.length} finding{filtered.length === 1 ? '' : 's'}</span>
          <button className="btn ac-tree-filter-clear" onClick={onClearTreeFilter}>✕ clear</button>
        </div>
      )}

      <div className="ac-controls">
        <div className="ac-tabs">
          {['severity', 'category', 'file'].map((v) => (
            <button
              key={v}
              className={`ac-tab ${view === v ? 'active' : ''}`}
              onClick={() => setView(v)}
            >by {v}</button>
          ))}
        </div>
        <span className="ac-controls-hint">Click any count above to toggle.</span>
        <input
          className="ac-search"
          type="search"
          placeholder="search messages / paths…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <div className="ac-empty">
          {findings.length === 0 ? '✓ No findings — looks clean!' : 'No findings match the current filters.'}
        </div>
      )}

      {grouped.map(([groupLabel, list]) => (
        <CollapsibleGroup
          key={groupLabel}
          label={groupLabel}
          list={list}
          onSelectFile={onSelectFile}
          selectedFile={selectedFile}
          previewUrl={previewUrl}
          previewKind={previewKind}
          previewText={previewText}
        />
      ))}
    </div>
  );
}
