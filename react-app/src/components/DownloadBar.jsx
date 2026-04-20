import { useApp } from '../context/AppContext.jsx';
import { downloadAll } from '../utils/download.js';

export function DownloadBar() {
  const { outputFiles } = useApp();
  if (!outputFiles.length) return null;

  const totalKb = outputFiles.reduce((s, f) => s + f.blob.size, 0) / 1024;

  return (
    <div className="dl-bar">
      <span className="dl-info">
        {outputFiles.length} file{outputFiles.length > 1 ? 's' : ''} · {totalKb.toFixed(0)} KB total
      </span>
      <button className="btn btn-primary" onClick={() => downloadAll(outputFiles)}>
        ↓ DOWNLOAD ALL
      </button>
    </div>
  );
}
