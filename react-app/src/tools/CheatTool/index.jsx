import { useEffect } from 'react';
import { CheatToolProvider, useCheatTool } from './CheatToolContext.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { PresetsSection } from './sections/Presets.jsx';
import { GameConfigSection } from './sections/GameConfig.jsx';
import { GameModeSection } from './sections/GameMode.jsx';
import { MultiplierSection } from './sections/Multiplier.jsx';
import { BoardSection } from './sections/Board.jsx';
import { OakSection } from './sections/Oak.jsx';
import { CountersSection } from './sections/Counters.jsx';
import { TransformsSection } from './sections/Transforms.jsx';
import { ApiSection } from './sections/Api.jsx';
import { NextModeSection } from './sections/NextMode.jsx';
import { HistorySection } from './sections/History.jsx';
import { OutputPanel } from './sections/Output.jsx';
import './cheat-tool.css';

export const cheatToolMeta = {
  id: 'cheattool',
  label: 'Cheat Tool',
  small: 'cheats API builder · QA',
  icon: '🎲',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true
};

export function CheatTool() {
  return (
    <CheatToolProvider>
      <CheatToolShell />
    </CheatToolProvider>
  );
}

function CheatToolShell() {
  const { registerRunner } = useApp();
  const { allSymbols } = useCheatTool();

  useEffect(() => {
    registerRunner(cheatToolMeta.id, {
      outName: () => 'cheat.json',
      run: async () => null
    });
    return () => registerRunner(cheatToolMeta.id, null);
  }, [registerRunner]);

  return (
    <div className="ct-root">
      <header className="ct-header">
        <div className="ct-logo">CHEAT<span>API</span> BUILDER</div>
        <div className="ct-badge">QA Tool</div>
        <div className="ct-version">v1.36</div>
      </header>

      <div className="ct-layout">
        <div className="ct-left-panel">
          <PresetsSection />
          <GameConfigSection />
          <GameModeSection />
          <MultiplierSection />
          <BoardSection />
          <OakSection />
          <CountersSection />
          <TransformsSection />
          <NextModeSection />
          <ApiSection />
        </div>
        <div className="ct-right-col">
          <OutputPanel />
        </div>
      </div>

      <div className="ct-history-wrap">
        <HistorySection />
      </div>

      {/* Datalist shared by symbol inputs */}
      <datalist id="ct-symbol-list">
        {allSymbols.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
