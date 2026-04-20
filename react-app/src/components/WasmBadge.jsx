import { useApp } from '../context/AppContext.jsx';

export function WasmBadge() {
  const { magickReady } = useApp();
  const mode = magickReady ? 'ready' : 'loading';
  const text = magickReady ? 'wasm ready' : 'loading wasm…';
  return (
    <div className={`wasm-badge ${mode}`}>
      <div className="dot" />
      <span>{text}</span>
    </div>
  );
}
