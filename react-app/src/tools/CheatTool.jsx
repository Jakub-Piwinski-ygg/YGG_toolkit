import { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const cheatToolMeta = {
  id: 'cheattool',
  label: 'Cheat Tool',
  small: 'cheats API builder · QA',
  icon: '🎲',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  desc: 'Cheat API Builder v1.36 — visual JSON builder for the /cheats/find-spin endpoint. Configure game mode, board state, OAK win conditions, multiplier ranges, counters, transformations and chained next-mode triggers; preview the request payload (Pretty / Minified / PascalCase) and send it directly to DEV-02, STAGING, PROD or a local proxy. Includes presets, request history, undo/redo, megaways support, and per-symbol palette autocomplete. The tool is self-contained inside the frame — use its own buttons; the RUN button below has no effect here.'
};

export function CheatTool() {
  const { registerRunner, log } = useApp();

  useEffect(() => {
    registerRunner(cheatToolMeta.id, {
      outName: () => 'cheat.json',
      run: async () => {
        log('Cheat Tool: use the embedded panel buttons (Send Request / Copy / Download).', 'info');
        return null;
      }
    });
    return () => registerRunner(cheatToolMeta.id, null);
  }, [registerRunner, log]);

  const src = `${import.meta.env.BASE_URL}cheat-tool.html`;

  return (
    <div className="cheattool-frame-wrap">
      <iframe
        title="Cheat Tool"
        src={src}
        className="cheattool-frame"
      />
    </div>
  );
}
