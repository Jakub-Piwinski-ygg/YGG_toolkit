import { useState } from 'react';
import { Section } from '../components/Section.jsx';
import { BoardGrid } from '../components/BoardGrid.jsx';
import { SymbolPalette } from '../components/SymbolPalette.jsx';
import { BoardSummary } from '../components/BoardSummary.jsx';
import { Toggle } from '../components/Toggle.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { symColor } from '../lib/symbolColors.js';

// Visual board grid. Paint mode only — drag-drop + type-with-autocomplete are
// deferred to a follow-up session (see CHEAT_TOOL.md "Deferred features").
export function BoardSection() {
  const {
    boardStateEnabled,
    setBoardStateEnabled,
    mainBoard,
    paintMainCell,
    changeMainReels, changeMainRows,
    toggleMainMegaways, changeMainReelHeight,
    clearMainBoard,
    manualSymbols, addManualSymbol, removeManualSymbol, updateManualSymbol,
    allSymbols
  } = useCheatTool();
  const [brush, setBrush] = useState('');

  return (
    <Section
      icon="▦"
      iconKind="orange"
      title="Board State Conditions"
      subtitle="VISUAL GRID"
      collapsible
      defaultOpen
    >
      <Toggle checked={boardStateEnabled} onChange={setBoardStateEnabled} label="Enable board state constraint" />
      {!boardStateEnabled ? null : (
        <>
      <SymbolPalette
        symbols={allSymbols}
        active={brush}
        onSelect={setBrush}
        hint="Select symbol (brush) - right click clears cell"
      />

      <div className="ct-board-controls">
        <div className="ct-board-ctrl-group">
          <span className="ct-board-ctrl-label">Reels</span>
          <button className="ct-board-ctrl-btn" onClick={() => changeMainReels(-1)}>−</button>
          <span className="ct-board-ctrl-val">{mainBoard.reels}</span>
          <button className="ct-board-ctrl-btn" onClick={() => changeMainReels(1)}>+</button>
        </div>
        <div className={`ct-board-ctrl-group${mainBoard.megawaysMode ? ' dimmed' : ''}`}>
          <span className="ct-board-ctrl-label">Rows (global)</span>
          <button className="ct-board-ctrl-btn" onClick={() => changeMainRows(-1)}>−</button>
          <span className="ct-board-ctrl-val">{mainBoard.rows}</span>
          <button className="ct-board-ctrl-btn" onClick={() => changeMainRows(1)}>+</button>
        </div>
        <div className="ct-board-ctrl-group inline">
          <label className="ct-toggle" style={{ margin: 0 }}>
            <input type="checkbox" checked={mainBoard.megawaysMode} onChange={toggleMainMegaways} />
            <span className="ct-toggle-slider" />
          </label>
          <span className="ct-board-ctrl-label" style={{ margin: 0 }}>Megaways</span>
        </div>
        <button className="ct-board-clear-btn" onClick={clearMainBoard} style={{ marginLeft: 'auto' }}>Clear</button>
      </div>

      {mainBoard.megawaysMode ? (
        <div className="ct-mw-controls">
          <div className="ct-sub-heading">Height of each reel</div>
          <div className="ct-mw-reel-controls">
            {mainBoard.reelHeights.map((h, i) => (
              <div key={i} className="ct-mw-reel-ctrl">
                <span className="ct-mw-reel-label">R{i + 1}</span>
                <span className="ct-mw-reel-val">{h}</span>
                <div className="ct-mw-reel-btns">
                  <button className="ct-mw-reel-btn" onClick={() => changeMainReelHeight(i, -1)}>−</button>
                  <button className="ct-mw-reel-btn" onClick={() => changeMainReelHeight(i, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <BoardGrid board={mainBoard} activeBrush={brush} onPaint={paintMainCell} />
      <BoardSummary grid={mainBoard.grid} />

      <div className="ct-manual-block">
        <div className="ct-sub-heading">Additional symbols (outside grid)</div>
        {manualSymbols.map((s) => (
          <div key={s.id} className="ct-manual-row">
            <input
              type="text"
              value={s.symbol}
              placeholder="e.g. Scatter"
              list="ct-symbol-list"
              onChange={(e) => updateManualSymbol(s.id, 'symbol', e.target.value)}
              style={{ color: symColor(s.symbol) }}
            />
            <input
              type="number"
              value={s.count}
              min={1}
              max={999}
              onChange={(e) => updateManualSymbol(s.id, 'count', e.target.value)}
              className="ct-num-center"
              placeholder="Count"
            />
            <button className="ct-remove-btn" onClick={() => removeManualSymbol(s.id)}>×</button>
          </div>
        ))}
        <button className="ct-add-btn" onClick={addManualSymbol}>+ Add symbol</button>
      </div>
        </>
      )}
    </Section>
  );
}
