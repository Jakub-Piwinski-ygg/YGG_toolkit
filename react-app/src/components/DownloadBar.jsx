import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { downloadAllZip } from '../utils/download.js';

export function DownloadBar() {
  const { outputFiles, replaceFilesWithOutput, log } = useApp();
  const [zipping, setZipping] = useState(false);
  if (!outputFiles.length) return null;

  const totalKb = outputFiles.reduce((s, f) => s + f.blob.size, 0) / 1024;

  const handlePromote = () => {
    const n = outputFiles.length;
    replaceFilesWithOutput();
    log(`↻ promoted ${n} output${n > 1 ? 's' : ''} to working dir`, 'info');
  };

  const handleDownloadAll = async () => {
    if (zipping) return;
    setZipping(true);
    try {
      await downloadAllZip(outputFiles, 'ygg-output.zip');
      log(`↓ zipped ${outputFiles.length} file${outputFiles.length > 1 ? 's' : ''} → ygg-output.zip`, 'ok');
    } catch (e) {
      log(`ZIP failed: ${e.message || e}`, 'err');
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="dl-bar">
      <span className="dl-info">
        {outputFiles.length} file{outputFiles.length > 1 ? 's' : ''} · {totalKb.toFixed(0)} KB total
      </span>
      <button
        className="btn"
        onClick={handlePromote}
        title="Move outputs to working file list for chained processing"
      >
        ↻ → WORKING DIR
      </button>
      <button className="btn btn-primary" onClick={handleDownloadAll} disabled={zipping}>
        {zipping ? '⏳ ZIPPING…' : '↓ DOWNLOAD ALL (ZIP)'}
      </button>
    </div>
  );
}
