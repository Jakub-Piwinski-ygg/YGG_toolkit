// Faithful port of the response parsers from cheat-tool.html — used to render
// the "Wynik" tab and "Real Spin" tab. These are pure: they take API JSON,
// return data structures the renderer components consume.

export function extractWinPositions(combo) {
  if (!combo || typeof combo !== 'object') return [];
  const candidates = [
    combo.positions, combo.Positions,
    combo.winningPositions, combo.WinningPositions,
    combo.cells, combo.Cells,
    combo.winningCells, combo.WinningCells,
    combo.path, combo.Path,
    combo.coords, combo.Coords
  ];
  const arr = candidates.find((c) => Array.isArray(c) && c.length > 0);
  if (!arr) return [];
  return arr
    .map((p) => {
      if (typeof p !== 'object' || p === null) return null;
      const reel = p.reel ?? p.Reel ?? p.column ?? p.Column ?? p.col ?? p.Col ?? p.x ?? p.X;
      const row = p.row ?? p.Row ?? p.y ?? p.Y ?? p.position ?? p.Position;
      if (reel === undefined || row === undefined) return null;
      return { reel: parseInt(reel), row: parseInt(row) };
    })
    .filter(Boolean);
}

export function describeCombination(combo) {
  if (!combo) return '';
  const symbol =
    combo.symbol?.symbolCode ?? combo.Symbol?.SymbolCode ??
    combo.symbolCode ?? combo.SymbolCode ??
    combo.symbol ?? combo.Symbol ?? '';
  const count =
    combo.count ?? combo.Count ?? combo.symbolCount ?? combo.SymbolCount ??
    combo.kind ?? combo.Kind ?? null;
  if (symbol && count) return `${symbol} ×${count}`;
  if (symbol) return String(symbol);
  return '';
}

export function findSpinSteps(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data?.spin?.steps, data?.Spin?.Steps,
    data?.gameRound?.spin?.steps, data?.GameRound?.Spin?.Steps,
    data?.result?.spin?.steps, data?.Result?.Spin?.Steps,
    data?.spinResult?.steps, data?.SpinResult?.Steps,
    data?.steps, data?.Steps,
    Array.isArray(data) ? data : null
  ];
  const found = candidates.find((c) => Array.isArray(c) && c.length > 0);
  if (found) return found;
  const actionSteps = parsePlayActionsResponse(data);
  if (actionSteps && actionSteps.length > 0) return actionSteps;
  return null;
}

function findCommonSymbolAtPositions(board, positions) {
  const cells = board.cells ?? board.Cells ?? [];
  if (!cells.length || !positions.length) return null;
  const syms = positions
    .map((p) => {
      const cell = cells.find((c) => {
        const pos = c.position ?? c.Position;
        return pos && (pos.x ?? pos.X) === p.reel && (pos.y ?? pos.Y) === p.row;
      });
      return cell?.symbol?.symbolCode ?? cell?.Symbol?.SymbolCode ?? null;
    })
    .filter(Boolean);
  if (!syms.length) return null;
  const counts = {};
  syms.forEach((s) => {
    counts[s] = (counts[s] || 0) + 1;
  });
  const nonWild = Object.keys(counts).filter((s) => s !== 'Wild' && s !== 'Scatter');
  if (nonWild.length > 0) {
    nonWild.sort((a, b) => counts[b] - counts[a]);
    return nonWild[0];
  }
  return syms[0];
}

function buildStepFromBoard(board, combos, stepWin) {
  const cells = board?.cells ?? board?.Cells ?? [];
  let maxX = -1, maxY = -1;
  cells.forEach((c) => {
    const pos = c.position ?? c.Position;
    if (!pos) return;
    const x = pos.x ?? pos.X;
    const y = pos.y ?? pos.Y;
    if (x !== undefined) maxX = Math.max(maxX, x);
    if (y !== undefined) maxY = Math.max(maxY, y);
  });
  const reels = Array.from({ length: maxX + 1 }, () => ({
    cells: Array.from({ length: maxY + 1 }, () => ({ symbol: { symbolCode: '·' } }))
  }));
  cells.forEach((c) => {
    const pos = c.position ?? c.Position;
    if (!pos) return;
    const x = pos.x ?? pos.X;
    const y = pos.y ?? pos.Y;
    if (x === undefined || y === undefined) return;
    reels[x].cells[y] = {
      symbol: { symbolCode: c.symbol?.symbolCode ?? c.Symbol?.SymbolCode ?? '?' }
    };
  });
  return { evaluatedBoard: { reels }, stepWin, wonCombinations: combos };
}

export function parsePlayActionsResponse(data) {
  const results = data?.results ?? data?.Results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const allSteps = [];

  for (const result of results) {
    const actions = result?.clientData?.actions ?? result?.ClientData?.Actions;
    if (!Array.isArray(actions)) continue;

    const board = new Map();
    let pendingCombos = [];
    let pendingStepWin = 0;
    let boardInitialized = false;

    const boardKey = (x, y) => `${x},${y}`;
    const applyCells = (cells) => {
      cells.forEach((c) => {
        const pos = c.position ?? c.Position;
        if (!pos) return;
        const x = pos.x ?? pos.X;
        const y = pos.y ?? pos.Y;
        const sym = c.symbol?.symbolCode ?? c.Symbol?.SymbolCode ?? '?';
        board.set(boardKey(x, y), sym);
      });
    };

    const snapshotBoard = () => {
      const cells = [];
      board.forEach((symCode, key) => {
        const [x, y] = key.split(',').map(Number);
        cells.push({ position: { x, y }, symbol: { symbolCode: symCode } });
      });
      return { cells };
    };

    const flushStep = () => {
      if (!boardInitialized) return;
      const stepBoard = snapshotBoard();
      const combosWithSymbols = pendingCombos.map((c) => ({
        ...c,
        symbol: c.symbol || findCommonSymbolAtPositions(stepBoard, c.positions)
      }));
      allSteps.push(buildStepFromBoard(stepBoard, combosWithSymbols, pendingStepWin));
      pendingCombos = [];
      pendingStepWin = 0;
    };

    for (const action of actions) {
      const t = action.$type ?? action.type ?? action.Type;
      if (!t) continue;

      if (t.endsWith('NewSpin') || t.endsWith('Respin') || t.endsWith('Reevaluate')) {
        flushStep();
        board.clear();
        const newCells = action.board?.cells ?? action.Board?.Cells ?? [];
        applyCells(newCells);
        boardInitialized = true;
      } else if (t.endsWith('PresentWinCombination')) {
        const winningCells = action.winningCells ?? action.WinningCells ?? [];
        const winObj = action.win ?? action.Win;
        if (winningCells.length > 0 && winObj) {
          const positions = winningCells
            .map((c) => ({ reel: c.x ?? c.X, row: c.y ?? c.Y }))
            .filter((p) => p.reel !== undefined && p.row !== undefined);
          pendingCombos.push({
            combinationPayout:
              winObj.amountNormalizedToBet ?? winObj.AmountNormalizedToBet ??
              winObj.amount ?? winObj.Amount ?? 0,
            symbol: null,
            count: positions.length,
            positions
          });
        }
      } else if (t.endsWith('PresentIntermediateWin')) {
        const winObj = action.win ?? action.Win;
        if (winObj) {
          pendingStepWin =
            winObj.amountNormalizedToBet ?? winObj.AmountNormalizedToBet ??
            winObj.amount ?? winObj.Amount ?? pendingStepWin;
        }
      } else if (t.endsWith('PresentModeWin')) {
        if (pendingCombos.length > 0 && pendingStepWin === 0) {
          const winObj = action.modeWin ?? action.ModeWin;
          if (winObj) pendingStepWin = winObj.amountNormalizedToBet ?? winObj.amount ?? 0;
        }
      } else if (t.endsWith('SymbolsRemove')) {
        flushStep();
        const positions = action.positions ?? action.Positions ?? [];
        positions.forEach((p) => board.delete(boardKey(p.x ?? p.X, p.y ?? p.Y)));
      } else if (t.endsWith('SymbolsSet')) {
        const cells = action.cells ?? action.Cells ?? [];
        applyCells(cells);
      } else if (t.endsWith('BoardCascade')) {
        const changes = action.positionChanges ?? action.PositionChanges ?? [];
        const moves = changes.map((c) => {
          const from = c.from ?? c.From;
          const to = c.to ?? c.To;
          const fx = from.x ?? from.X, fy = from.y ?? from.Y;
          const tx = to.x ?? to.X, ty = to.y ?? to.Y;
          return { fx, fy, tx, ty, sym: board.get(boardKey(fx, fy)) };
        });
        moves.forEach((m) => board.delete(boardKey(m.fx, m.fy)));
        moves.forEach((m) => {
          if (m.sym !== undefined) board.set(boardKey(m.tx, m.ty), m.sym);
        });
      } else if (t.endsWith('FillEmptyCells')) {
        const cells = action.cells ?? action.Cells ?? [];
        applyCells(cells);
      }
    }
    flushStep();
  }
  return allSteps;
}

export function extractBoardReels(step) {
  if (!step) return null;
  const board =
    step.evaluatedBoard ?? step.EvaluatedBoard ??
    step.board ?? step.Board ??
    step.finalBoard ?? step.FinalBoard;
  if (!board) return null;
  return board.reels ?? board.Reels ?? null;
}

export function extractGameModes(data) {
  const candidates = [
    data.gameModes, data.GameModes,
    data.modes, data.Modes,
    data.gameConfiguration?.gameModes, data.GameConfiguration?.GameModes,
    data.configuration?.gameModes, data.Configuration?.GameModes
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c
        .map((m) => m.name ?? m.Name ?? m.gameModeName ?? m.GameModeName ?? m)
        .filter((s) => typeof s === 'string');
    }
  }
  return [];
}

export function extractSymbolsFromConfig(data) {
  const paytable = data.paytable ?? data.Paytable;
  const symPayouts = paytable?.symbolPayouts ?? paytable?.SymbolPayouts ?? [];
  return symPayouts.map((s) => s.symbol ?? s.Symbol).filter(Boolean);
}

export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}
