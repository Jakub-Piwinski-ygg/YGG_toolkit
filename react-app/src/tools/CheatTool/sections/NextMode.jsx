import { useState } from 'react';
import { Section } from '../components/Section.jsx';
import { Toggle } from '../components/Toggle.jsx';
import { FieldRow, RangeRow } from '../components/FieldRow.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { BoardGrid } from '../components/BoardGrid.jsx';
import { SymbolPalette } from '../components/SymbolPalette.jsx';
import { BoardSummary } from '../components/BoardSummary.jsx';
import { symColor } from '../lib/symbolColors.js';
import { SymbolAutocompleteInput } from '../components/SymbolAutocompleteInput.jsx';

export function NextModeSection() {
  const {
    nextModeEnabled, setNextModeEnabled,
    nextGameModeName, setNextGameModeName,
    triggerSymbol, updateTriggerSymbol,
    triggerCount, updateTriggerCount,
    nextMultEnabled, setNextMultEnabled,
    nextMultFrom, setNextMultFrom,
    nextMultTo, setNextMultTo,
    nextCounterConditions, addNextCounter, removeNextCounter, updateNextCounter,
    nextOakConditions, addNextOak, removeNextOak, updateNextOak,
    nbBoard, paintNbCell, changeNbReels, changeNbRows, toggleNbMegaways, changeNbReelHeight, clearNbBoard,
    nbManualSymbols, addNbManualSymbol, removeNbManualSymbol, updateNbManualSymbol,
    allSymbols, gameModes, validation
  } = useCheatTool();

  const [brush, setBrush] = useState('');

  const mode = (nextGameModeName || '').trim();
  const showTrigger = mode && !/^base/i.test(mode);

  return (
    <Section icon="→" iconKind="green" title="Next Mode Cheat" subtitle="CHAINING">
      <Toggle checked={nextModeEnabled} onChange={setNextModeEnabled} label="Enable next mode chaining" />
      {!nextModeEnabled ? null : (
        <div className="ct-next-mode-inner">
          <FieldRow label="Target Mode">
            <input
              type="text"
              value={nextGameModeName}
              list="ct-game-modes"
              onChange={(e) => setNextGameModeName(e.target.value)}
              placeholder="e.g. FS1, FS_level_1, base_game..."
            />
          </FieldRow>

          {showTrigger ? (
            <div className="ct-trigger-fields">
              <div className="ct-sub-heading">Trigger (added to symbolsOnBoard)</div>
              <FieldRow label="Trigger Symbol">
                <input
                  type="text"
                  value={triggerSymbol}
                  list="ct-symbol-list"
                  onChange={(e) => updateTriggerSymbol(e.target.value)}
                  placeholder="e.g. Scatter, FS, Bonus"
                />
              </FieldRow>
              <FieldRow label="Trigger Count">
                <input
                  type="number"
                  value={triggerCount}
                  min={0}
                  max={50}
                  onChange={(e) => updateTriggerCount(e.target.value)}
                  className={`ct-num-center${validation.fieldErrors.triggerCount ? ' ct-invalid' : ''}`}
                  title={validation.fieldErrors.triggerCount || ''}
                />
              </FieldRow>
              <div className="ct-hint">Set <code>count = 0</code> to skip trigger.</div>
            </div>
          ) : null}

          <div className="ct-divider" />

          <Toggle checked={nextMultEnabled} onChange={setNextMultEnabled} label="Multiplier constraint in next mode" />
          {nextMultEnabled ? (
            <RangeRow
              label="Win Range"
              fromValue={nextMultFrom}
              toValue={nextMultTo}
              onFromChange={setNextMultFrom}
              onToChange={setNextMultTo}
              fromError={validation.fieldErrors.nextMultFrom}
              toError={validation.fieldErrors.nextMultTo}
            />
          ) : null}

          <div className="ct-divider" />

          <div className="ct-sub-heading">Counter State Conditions</div>
          {nextCounterConditions.map((c) => (
            <div className="ct-counter-row" key={c.id}>
              <input
                type="text"
                value={c.name}
                placeholder="Counter name"
                onChange={(e) => updateNextCounter(c.id, 'name', e.target.value)}
              />
              <input
                type="number"
                value={c.from}
                placeholder="From"
                onChange={(e) => updateNextCounter(c.id, 'from', e.target.value)}
                className={`ct-num-center${validation.fieldErrors[`nextCounter-${c.id}-from`] ? ' ct-invalid' : ''}`}
              />
              <input
                type="number"
                value={c.to}
                placeholder="To"
                onChange={(e) => updateNextCounter(c.id, 'to', e.target.value)}
                className={`ct-num-center${validation.fieldErrors[`nextCounter-${c.id}-to`] ? ' ct-invalid' : ''}`}
              />
              <button className="ct-remove-btn" onClick={() => removeNextCounter(c.id)}>×</button>
            </div>
          ))}
          <button className="ct-add-btn" onClick={addNextCounter}>+ Add counter</button>

          <div className="ct-divider" />

          <div className="ct-sub-heading">OAK in next mode</div>
          {nextOakConditions.map((o) => (
            <div className="ct-sym-count-row" key={o.id}>
              <SymbolAutocompleteInput
                value={o.symbol}
                onChange={(v) => updateNextOak(o.id, 'symbol', v)}
                symbols={allSymbols}
                placeholder="Symbol"
                inputStyle={{ color: symColor(o.symbol) }}
              />
              <input
                type="number"
                value={o.count}
                min={2}
                max={999}
                onChange={(e) => updateNextOak(o.id, 'count', e.target.value)}
                className="ct-num-center"
              />
              <button className="ct-remove-btn" onClick={() => removeNextOak(o.id)}>×</button>
            </div>
          ))}
          <button className="ct-add-btn" onClick={addNextOak}>+ Add OAK in next mode</button>

          <div className="ct-divider" />

          <div className="ct-sub-heading">Board State Conditions</div>
          <SymbolPalette
            symbols={allSymbols}
            active={brush}
            onSelect={setBrush}
            hint="Select symbol (brush) - right click clears cell"
          />
          <div className="ct-board-controls">
            <div className="ct-board-ctrl-group">
              <span className="ct-board-ctrl-label">Reels</span>
              <button className="ct-board-ctrl-btn" onClick={() => changeNbReels(-1)}>−</button>
              <span className="ct-board-ctrl-val">{nbBoard.reels}</span>
              <button className="ct-board-ctrl-btn" onClick={() => changeNbReels(1)}>+</button>
            </div>
            <div className={`ct-board-ctrl-group${nbBoard.megawaysMode ? ' dimmed' : ''}`}>
              <span className="ct-board-ctrl-label">Rows (global)</span>
              <button className="ct-board-ctrl-btn" onClick={() => changeNbRows(-1)}>−</button>
              <span className="ct-board-ctrl-val">{nbBoard.rows}</span>
              <button className="ct-board-ctrl-btn" onClick={() => changeNbRows(1)}>+</button>
            </div>
            <div className="ct-board-ctrl-group inline">
              <label className="ct-toggle" style={{ margin: 0 }}>
                <input type="checkbox" checked={nbBoard.megawaysMode} onChange={toggleNbMegaways} />
                <span className="ct-toggle-slider" />
              </label>
              <span className="ct-board-ctrl-label" style={{ margin: 0 }}>Megaways</span>
            </div>
            <button className="ct-board-clear-btn" onClick={clearNbBoard} style={{ marginLeft: 'auto' }}>Clear</button>
          </div>
          {nbBoard.megawaysMode ? (
            <div className="ct-mw-controls">
              <div className="ct-sub-heading">Height of each reel</div>
              <div className="ct-mw-reel-controls">
                {nbBoard.reelHeights.map((h, i) => (
                  <div key={i} className="ct-mw-reel-ctrl">
                    <span className="ct-mw-reel-label">R{i + 1}</span>
                    <span className="ct-mw-reel-val">{h}</span>
                    <div className="ct-mw-reel-btns">
                      <button className="ct-mw-reel-btn" onClick={() => changeNbReelHeight(i, -1)}>−</button>
                      <button className="ct-mw-reel-btn" onClick={() => changeNbReelHeight(i, 1)}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <BoardGrid board={nbBoard} activeBrush={brush} onPaint={paintNbCell} />
          <BoardSummary grid={nbBoard.grid} />

          <div className="ct-manual-block">
            <div className="ct-sub-heading">Additional symbols (outside grid)</div>
            {nbManualSymbols.map((s) => (
              <div key={s.id} className="ct-manual-row">
                <input
                  type="text"
                  value={s.symbol}
                  placeholder="e.g. Scatter"
                  list="ct-symbol-list"
                  onChange={(e) => updateNbManualSymbol(s.id, 'symbol', e.target.value)}
                  style={{ color: symColor(s.symbol) }}
                />
                <input
                  type="number"
                  value={s.count}
                  min={1}
                  max={999}
                  onChange={(e) => updateNbManualSymbol(s.id, 'count', e.target.value)}
                  className="ct-num-center"
                />
                <button className="ct-remove-btn" onClick={() => removeNbManualSymbol(s.id)}>×</button>
              </div>
            ))}
            <button className="ct-add-btn" onClick={addNbManualSymbol}>+ Add symbol</button>
          </div>
        </div>
      )}
    </Section>
  );
}
