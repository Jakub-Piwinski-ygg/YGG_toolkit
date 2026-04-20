import { useApp } from '../context/AppContext.jsx';

export function FileList() {
  const { inputFiles, removeFile } = useApp();
  return (
    <>
      <div className="file-list">
        {inputFiles.map((f) => (
          <div className="file-item" key={f.name}>
            <span className="fname">{f.name}</span>
            <span className="fsize">{(f.file.size / 1024).toFixed(0)}k</span>
            <span className="fremove" onClick={() => removeFile(f.name)}>
              ✕
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.65rem', color: '#555', textAlign: 'center' }}>
        {inputFiles.length
          ? `${inputFiles.length} file${inputFiles.length > 1 ? 's' : ''} loaded`
          : ''}
      </div>
    </>
  );
}
