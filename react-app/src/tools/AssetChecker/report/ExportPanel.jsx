import { useState } from 'react';
import { ExportApprovalModal } from './ExportApprovalModal.jsx';
import { UnityExportConfigPanel } from '../../../components/UnityExportConfigPanel.jsx';
import { useUnityExport } from '../../../context/UnityExportContext.jsx';

export function ExportPanel({ entries, log }) {
  const { settings } = useUnityExport();
  const [open, setOpen]           = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="ac-export-wrap">
      <button
        className={`ac-export-header-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
        disabled={!entries.length}
      >
        <span>{open ? '▼' : '▶'} 📦 Export to Unity</span>
        <span className="ac-export-header-sub">
          {entries.length ? `${entries.length} files · click to ${open ? 'collapse' : 'configure'}` : 'load files first'}
        </span>
      </button>

      {open && (
        <div className="ac-export-panel">
          <UnityExportConfigPanel />

          <div className="ac-export-actions">
            <button className="btn btn-primary" disabled={!entries.length} onClick={() => setModalOpen(true)}>
              📦 Export to Unity…
            </button>
          </div>
        </div>
      )}

      {modalOpen && (
        <ExportApprovalModal
          entries={entries}
          settings={settings}
          log={log}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
