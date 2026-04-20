import { WasmBadge } from './WasmBadge.jsx';
import { useApp } from '../context/AppContext.jsx';
import { ART_TOOLS } from '../tools/registry.js';

export function Header() {
  const { setCurrentTool, inputFiles, resetOutputs, log, clearLog } = useApp();

  const handleRestart = () => {
    resetOutputs();
    clearLog();
    log('— restarted — loaded files preserved —', 'info');
  };

  return (
    <header>
      <div className="header-logo">
        <a href="https://yggdrasilgaming.com">
          <img
            src="https://yggdrasilgaming.com/w/files/2020/07/symbol.png"
            alt="Yggdrasil Gaming Logo"
            style={{ width: 70, display: 'block' }}
          />
        </a>
        <div>
          <h1>YGG&nbsp;&nbsp;&nbsp;TOOLKIT</h1>
          <span className="subtitle">
            {ART_TOOLS.map((t, i) => (
              <span key={t.meta.id}>
                <span className="subtitle-link" onClick={() => setCurrentTool(t.meta.id)}>
                  {t.meta.label.toLowerCase()}
                </span>
                {i < ART_TOOLS.length - 1 && ' · '}
              </span>
            ))}
          </span>
        </div>
      </div>
      <div className="header-right">
        <WasmBadge />
        <button
          className="restart-btn"
          title="Restart toolkit — loaded files are preserved"
          onClick={handleRestart}
        >
          ↻ restart
        </button>
      </div>
    </header>
  );
}
