import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { runAllChecks } from './engine/runChecks.js';
import { entriesFromInput, entriesFromDataTransfer } from './engine/ingest.js';
import { ReportView } from './report/ReportView.jsx';
import { TreeView } from './report/TreeView.jsx';

export const assetCheckerMeta = {
  id: 'assetchecker',
  label: 'Asset Checker',
  small: 'automated tech-art review',
  icon: '🔍',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  desc: 'Drop a full art-output folder. The checker scans folder structure, naming, Spine JSON, atlases, image dimensions, asset coverage and baked-text indicators against a configurable rule set, then groups findings by severity / category / file. Hard constraint: all processing runs locally in your browser — nothing is uploaded.'
};

const BASE = (import.meta?.env?.BASE_URL || './').replace(/\/?$/, '/');

export function AssetCheckerTool() {
  const { log, registerRunner } = useApp();
  const [entries, setEntries] = useState([]);
  const [findings, setFindings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [treeFilter, setTreeFilter] = useState(null);
  const [sevFilter, setSevFilter] = useState({ error: true, warn: true, info: true, pass: false });
  const toggleSev = (s) => setSevFilter((f) => ({ ...f, [s]: !f[s] }));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewKind, setPreviewKind] = useState(null);
  const [previewText, setPreviewText] = useState(null);

  const [configList, setConfigList] = useState([]);
  const [configId, setConfigId] = useState('default');
  const [config, setConfig] = useState(null);
  const [hints, setHints] = useState({});
  const [customConfigName, setCustomConfigName] = useState(null);

  const dropRef = useRef(null);

  // load manifest + default config + hints on mount
  useEffect(() => {
    (async () => {
      try {
        const [m, h] = await Promise.all([
          fetch(BASE + 'configs/manifest.json').then((r) => r.json()),
          fetch(BASE + 'configs/hints.json').then((r) => r.json())
        ]);
        setConfigList(m.configs || []);
        setHints(h || {});
        const def = (m.configs || []).find((c) => c.id === 'default') || (m.configs || [])[0];
        if (def) {
          const cfg = await fetch(BASE + 'configs/' + def.file).then((r) => r.json());
          setConfig(cfg);
        }
      } catch (e) {
        log(`Asset Checker: failed to load config — ${e.message}`, 'err');
      }
    })();
  }, []);

  // register a runner so the toolbar RUN button also runs the checks
  useEffect(() => {
    registerRunner(assetCheckerMeta.id, {
      outName: () => 'asset-check.json',
      run: async () => { await runChecks(); return null; }
    });
    return () => registerRunner(assetCheckerMeta.id, null);
  }, [registerRunner, entries, config]);

  const onPickFolder = (e) => {
    const list = entriesFromInput(e.target.files);
    setEntries(list);
    setFindings([]);
    setSummary(null);
    log(`Loaded ${list.length} files for review.`, 'info');
  };

  const onDrop = async (e) => {
    e.preventDefault();
    dropRef.current?.classList.remove('drag');
    const items = e.dataTransfer.items;
    if (!items?.length) return;
    const list = await entriesFromDataTransfer(items);
    setEntries(list);
    setFindings([]);
    setSummary(null);
    log(`Loaded ${list.length} files for review.`, 'info');
  };

  const onConfigChange = async (id) => {
    setConfigId(id);
    const meta = configList.find((c) => c.id === id);
    if (!meta) return;
    try {
      const cfg = await fetch(BASE + 'configs/' + meta.file).then((r) => r.json());
      setConfig(cfg);
      setCustomConfigName(null);
      log(`Loaded config: ${meta.label}`, 'ok');
    } catch (e) {
      log(`Failed to load config "${id}": ${e.message}`, 'err');
    }
  };

  const onUploadConfig = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const cfg = JSON.parse(await f.text());
      setConfig(cfg);
      setCustomConfigName(f.name);
      log(`Using uploaded config: ${f.name}`, 'ok');
    } catch (err) {
      log(`Invalid config file: ${err.message}`, 'err');
    }
  };

  const runChecks = async () => {
    if (!entries.length) { log('Drop a folder first.', 'err'); return; }
    if (!config) { log('Config not loaded yet.', 'err'); return; }
    setRunning(true);
    setProgress('starting…');
    try {
      const result = await runAllChecks({
        entries,
        config,
        hints,
        onProgress: (s) => setProgress(s)
      });
      setFindings(result.findings);
      setSummary(result.summary);
      log(`Asset check complete: ${result.summary.counts.error || 0} error / ${result.summary.counts.warn || 0} warn / ${result.summary.counts.info || 0} info`, 'ok');
    } catch (e) {
      log(`Check run failed: ${e.message}`, 'err');
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  // File inspection: open preview only. Does NOT touch treeFilter, so the
  // list doesn't re-render and the user's scroll position is preserved.
  const onInspectFile = async (path) => {
    const entry = entries.find((e) => e.relPath === path);
    if (!entry) return; // not a real file (folder path) — ignore
    // Toggle: clicking the same file again closes the preview.
    if (selectedFile === path) {
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewText(null);
      setPreviewKind(null);
      return;
    }
    setSelectedFile(path);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setPreviewText(null);
    setPreviewKind(null);
    const tail = path.split('/').pop() || '';
    if (/\.(png|jpg|jpeg|webp|gif)$/i.test(tail)) {
      setPreviewUrl(URL.createObjectURL(entry.file));
      setPreviewKind('image');
    } else if (/\.(json|atlas|txt|md)$/i.test(tail)) {
      const text = await entry.file.text();
      setPreviewText(text.length > 200_000 ? text.slice(0, 200_000) + '\n… (truncated)' : text);
      setPreviewKind('text');
    } else {
      setPreviewKind('binary');
    }
  };

  // Folder selection in the tree: filter the report to this folder's subtree.
  // Does NOT open a preview.
  const onSelectFolder = (path) => {
    setTreeFilter(path);
  };

  // Tree-row click router: both dirs and files filter the report; files also
  // open an inline preview. Filtering by an exact file path is supported by
  // ReportView's treeFilter logic (it matches paths === treeFilter).
  const onTreeSelect = (path, kind) => {
    setTreeFilter(path);
    if (kind === 'file') onInspectFile(path);
  };

  const clearTreeFilter = () => {
    setTreeFilter(null);
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewText(null);
    setPreviewKind(null);
  };

  const clearAll = () => {
    setEntries([]);
    setFindings([]);
    setSummary(null);
    setSelectedFile(null);
    setTreeFilter(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewText(null);
    setPreviewKind(null);
  };

  return (
    <div className="ac-root">
      <div className="ac-ingest-bar">
        <div
          ref={dropRef}
          className="ac-dropzone"
          onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add('drag'); }}
          onDragLeave={() => dropRef.current?.classList.remove('drag')}
          onDrop={onDrop}
        >
          <label className="ac-pick-label">
            <input
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: 'none' }}
              onChange={onPickFolder}
            />
            📁 Pick folder
          </label>
          <span className="ac-drop-hint">…or drop a folder here ({entries.length} files loaded)</span>
        </div>

        <div className="ac-config-bar">
          <label>Config</label>
          <select value={customConfigName ? '__custom' : configId} onChange={(e) => onConfigChange(e.target.value)} disabled={!!customConfigName}>
            {configList.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            {customConfigName && <option value="__custom">{customConfigName} (uploaded)</option>}
          </select>
          <label className="ac-upload-label">
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={onUploadConfig} />
            ⇪ Upload
          </label>
          {customConfigName && (
            <button className="btn" style={{ fontSize: '.6rem', padding: '.2rem .5rem' }} onClick={() => onConfigChange(configId)}>
              Reset to {configList.find((c) => c.id === configId)?.label || 'default'}
            </button>
          )}
        </div>

        <div className="ac-action-bar">
          <button className="btn btn-primary" disabled={running || !entries.length || !config} onClick={runChecks}>
            {running ? `running… ${progress}` : '▶ Run checks'}
          </button>
          <button className="btn" onClick={clearAll} disabled={running}>Clear</button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="ac-main">
          <div className="ac-sidebar">
            <div className="ac-side-head">Tree</div>
            <TreeView entries={entries} findings={findings} selected={selectedFile} onSelect={onTreeSelect} sevFilter={sevFilter} />
          </div>
          <div className="ac-content">
            <ReportView findings={findings} summary={summary} onSelectFile={onInspectFile} selectedFile={selectedFile} previewUrl={previewUrl} previewKind={previewKind} previewText={previewText} treeFilter={treeFilter} onClearTreeFilter={clearTreeFilter} sevFilter={sevFilter} onToggleSev={toggleSev} />
          </div>
        </div>
      )}
    </div>
  );
}
