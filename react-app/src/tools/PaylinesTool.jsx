import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const paylinesMeta = {
  id: 'paylines',
  label: 'Paylines',
  small: 'design & export payline patterns',
  icon: '⊞',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  desc: 'Design payline patterns for slot games. Configure the grid dimensions, number of paylines, and the output symbols (emoji or any text like Unity sprite tags). Click cells to toggle positions. Paste previous output into the import field to restore a saved state.'
};

function buildGrids(num, rows, cols, existing) {
  const next = [];
  for (let p = 0; p < num; p++) {
    const ex = existing?.[p];
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push(!!(ex && ex[r] && ex[r][c]));
      }
      grid.push(row);
    }
    next.push(grid);
  }
  return next;
}

export function PaylinesTool() {
  const [num, setNum] = useState(10);
  const [cols, setCols] = useState(5);
  const [rows, setRows] = useState(4);
  const [lineSym, setLineSym] = useState('🟠');
  const [emptySym, setEmptySym] = useState('⚪️');
  const [grids, setGrids] = useState(() => buildGrids(10, 4, 5, null));
  const [importText, setImportText] = useState('');
  const [copyLabel, setCopyLabel] = useState('⎘ Copy');
  const { log, registerRunner } = useApp();

  const settingsRef = useRef({});
  const output = useMemo(() => grids
    .map((grid) => grid.map((row) => row.map((c) => (c ? lineSym : emptySym)).join('')).join('\n'))
    .join('\n\n'), [grids, lineSym, emptySym]);

  settingsRef.current = { output };

  useEffect(() => {
    setGrids((prev) => buildGrids(num, rows, cols, prev));
  }, [num, rows, cols]);

  useEffect(() => {
    registerRunner(paylinesMeta.id, {
      outName: () => 'paylines.txt',
      run: async () => new Blob([settingsRef.current.output], { type: 'text/plain' })
    });
    return () => registerRunner(paylinesMeta.id, null);
  }, [registerRunner]);

  const toggleCell = (p, r, c) => {
    setGrids((prev) => prev.map((grid, i) => i !== p ? grid : grid.map((row, ri) => ri !== r ? row : row.map((cell, ci) => ci !== c ? cell : !cell))));
  };

  const clearPayline = (p) => {
    setGrids((prev) => prev.map((grid, i) => i !== p ? grid : grid.map((row) => row.map(() => false))));
  };

  const parseImport = () => {
    const text = importText.trim();
    if (!text) { log('⚠ Paste text into the import field first', 'err'); return; }
    if (!lineSym || !emptySym) { log('⚠ Set Line and Empty symbols before parsing', 'err'); return; }

    const blocks = text.split(/\n[ \t]*\n+/).map((b) => b.trim()).filter(Boolean);
    const next = grids.map((g) => g.map((row) => row.slice()));
    let parsed = 0;

    for (let p = 0; p < Math.min(blocks.length, num); p++) {
      const rowsText = blocks[p].split('\n');
      for (let r = 0; r < Math.min(rowsText.length, rows); r++) {
        const rowText = rowsText[r];
        let col = 0, pos = 0;
        while (pos < rowText.length && col < cols) {
          if (rowText.startsWith(lineSym, pos)) {
            next[p][r][col] = true;
            pos += lineSym.length; col++;
          } else if (rowText.startsWith(emptySym, pos)) {
            next[p][r][col] = false;
            pos += emptySym.length; col++;
          } else {
            pos++;
          }
        }
      }
      parsed++;
    }

    if (parsed) {
      setGrids(next);
      log(`✓ Parsed ${parsed} payline${parsed !== 1 ? 's' : ''} from import`, 'ok');
      setImportText('');
    } else {
      log('✗ Nothing matched — check your Line/Empty symbols match the pasted text', 'err');
    }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output).then(() => {
      setCopyLabel('✓ Copied!');
      setTimeout(() => setCopyLabel('⎘ Copy'), 1600);
    });
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.8rem' }}>
        <div className="field">
          <label>Paylines</label>
          <input type="number" min="1" max="200" value={num} onChange={(e) => setNum(Math.max(1, +e.target.value || 1))} />
        </div>
        <div className="field">
          <label>Columns</label>
          <input type="number" min="1" max="20" value={cols} onChange={(e) => setCols(Math.max(1, +e.target.value || 1))} />
        </div>
        <div className="field">
          <label>Rows</label>
          <input type="number" min="1" max="16" value={rows} onChange={(e) => setRows(Math.max(1, +e.target.value || 1))} />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Line symbol</label>
          <input type="text" value={lineSym} onChange={(e) => setLineSym(e.target.value)} placeholder="🟠" />
        </div>
        <div className="field">
          <label>Empty symbol</label>
          <input type="text" value={emptySym} onChange={(e) => setEmptySym(e.target.value)} placeholder="⚪️" />
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.62rem', color: '#555', lineHeight: 1.6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '.4rem .65rem' }}>
        Symbols can be any text — e.g. <span style={{ color: 'var(--accent2)' }}>{'<sprite name="Payline_Line">'}</span> for Unity rich text.
        The visual grid always uses 🟠 / ⚪️; symbols only appear in the text output.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.55rem', alignItems: 'flex-start' }}>
        {grids.map((grid, p) => (
          <div key={p} className="pl-grid-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '.35rem', marginBottom: '.05rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.58rem', color: '#555', minWidth: 20 }}>#{p + 1}</span>
              <span className="pl-clear-x" onClick={() => clearPayline(p)} title="Clear payline">✕</span>
            </div>
            {grid.map((row, r) => (
              <div key={r} style={{ display: 'flex', gap: 1 }}>
                {row.map((cell, c) => (
                  <span
                    key={c}
                    onClick={() => toggleCell(p, r, c)}
                    className="pl-cell"
                    title={`Row ${r + 1}, Col ${c + 1}`}
                  >
                    {cell ? '🟠' : '⚪️'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.63rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Text output</span>
          <button className="btn" onClick={copyOutput} style={{ fontSize: '.6rem', padding: '.22rem .6rem' }}>{copyLabel}</button>
        </div>
        <textarea
          readOnly
          value={output}
          className="pl-textarea"
          style={{ minHeight: 130, maxHeight: '50vh' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.63rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Import — paste saved output to restore
          </span>
          <button className="btn btn-replace" onClick={parseImport} style={{ fontSize: '.6rem', padding: '.22rem .6rem' }}>⇅ Parse</button>
        </div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste previously exported payline text here, then click Parse…"
          className="pl-textarea"
          style={{ minHeight: 80 }}
        />
      </div>
    </>
  );
}
