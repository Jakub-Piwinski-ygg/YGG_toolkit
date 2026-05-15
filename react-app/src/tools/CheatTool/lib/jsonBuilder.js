// Pure functions that turn the cheat-tool state into the JSON payload sent to
// the /cheats/find-spin endpoint. Faithful port of buildJSON / toPascal /
// stripEmpty / mergeSymbols from the original cheat-tool.html.

export function mergeSymbols(gridSymbols, manualList) {
  const counts = {};
  gridSymbols.forEach((s) => {
    if (s.symbol) counts[s.symbol] = (counts[s.symbol] || 0) + s.count;
  });
  manualList.forEach((s) => {
    if (s.symbol) counts[s.symbol] = (counts[s.symbol] || 0) + s.count;
  });
  return Object.entries(counts).map(([symbol, count]) => ({ symbol, count }));
}

export function getBoardSymbols(boardGrid) {
  const counts = {};
  boardGrid.forEach((row) =>
    row.forEach((sym) => {
      if (sym) counts[sym] = (counts[sym] || 0) + 1;
    })
  );
  return Object.entries(counts).map(([symbol, count]) => ({ symbol, count }));
}

export function buildJSON(state) {
  const {
    gameId,
    rtpVariant,
    gameModeName,
    jsonIndexEnabled,
    jsonIndexValue,
    multiplierEnabled,
    multFrom,
    multTo,
    boardStateEnabled,
    nextModeEnabled,
    nextGameModeName,
    triggerSymbol,
    triggerCount,
    nextMultEnabled,
    nextMultFrom,
    nextMultTo,
    oakConditions,
    counterConditions,
    transformConditions,
    nextOakConditions,
    nextCounterConditions,
    manualSymbols,
    nbManualSymbols,
    mainBoard,
    nbBoard
  } = state;

  // Root board symbols: visual grid + manual overrides + (if next mode) trigger.
  let rootBoardSymbols = mergeSymbols(getBoardSymbols(mainBoard.grid), manualSymbols);

  if (nextModeEnabled) {
    const sym = (triggerSymbol || '').trim();
    const cnt = parseInt(triggerCount) || 0;
    if (sym && cnt > 0) {
      const idx = rootBoardSymbols.findIndex((s) => s.symbol === sym);
      if (idx === -1) rootBoardSymbols.push({ symbol: sym, count: cnt });
      else rootBoardSymbols[idx] = { ...rootBoardSymbols[idx], count: cnt };
    }
  }

  const nextModeCheat = nextModeEnabled
    ? {
        gameModeName: nextGameModeName,
        multiplierConditions: nextMultEnabled
          ? {
              fromValue: isNaN(nextMultFrom) ? 0 : nextMultFrom,
              toValue: isNaN(nextMultTo) ? 0 : nextMultTo
            }
          : {},
        boardStateConditions: {
          symbolsOnBoard: mergeSymbols(getBoardSymbols(nbBoard.grid), nbManualSymbols)
        },
        counterStateConditions: [
          ...nextCounterConditions.map((c) => ({
            counterName: c.name,
            fromValue: c.from,
            toValue: c.to
          })),
          ...(nbBoard.megawaysMode && nbBoard.reelHeights.length > 0
            ? nbBoard.reelHeights.map((h, i) => ({
                counterName: `NumberOfSymbols${i}`,
                fromValue: h,
                toValue: h
              }))
            : [])
        ],
        specificBoardTransformationCount: [],
        oakWinConditions: nextOakConditions.map((o) => ({
          symbol: o.symbol,
          count: o.count
        })),
        nextModeCheat: null
      }
    : null;

  const megawaysCounters =
    mainBoard.megawaysMode && mainBoard.reelHeights.length > 0
      ? mainBoard.reelHeights.map((h, i) => ({
          counterName: `NumberOfSymbols${i}`,
          fromValue: h,
          toValue: h
        }))
      : [];
  const allCounters = [
    ...counterConditions.map((c) => ({
      counterName: c.name,
      fromValue: c.from,
      toValue: c.to
    })),
    ...megawaysCounters
  ];

  const rootMode = {
    gameModeName,
    ...(jsonIndexEnabled && { jsonIndex: jsonIndexValue }),
    multiplierConditions: multiplierEnabled
      ? {
          fromValue: isNaN(multFrom) ? 0 : multFrom,
          toValue: isNaN(multTo) ? 0 : multTo
        }
      : {},
    boardStateConditions: boardStateEnabled
      ? { symbolsOnBoard: rootBoardSymbols }
      : {},
    counterStateConditions: allCounters,
    specificBoardTransformationCount: transformConditions.map((t) => ({
      transformationTypeName: t.name,
      count: t.count
    })),
    oakWinConditions: oakConditions.map((o) => ({ symbol: o.symbol, count: o.count })),
    nextModeCheat
  };

  return { gameId, rtpVariant, rootGameMode: rootMode };
}

export function toPascal(obj) {
  if (Array.isArray(obj)) return obj.map(toPascal);
  if (obj !== null && typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      const pk = k.charAt(0).toUpperCase() + k.slice(1);
      res[pk] = toPascal(v);
    }
    return res;
  }
  return obj;
}

export function stripEmpty(obj) {
  if (Array.isArray(obj)) return obj.map(stripEmpty);
  if (obj !== null && typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      res[k] = stripEmpty(v);
    }
    return res;
  }
  return obj;
}

// Used by the History list label.
export function describeCheat(pascal) {
  const root = pascal.RootGameMode || {};
  const mode = root.GameModeName || '?';
  const parts = [mode];

  const counters = root.CounterStateConditions || [];
  const mwCounters = counters.filter((c) => c.CounterName?.startsWith('NumberOfSymbols'));
  if (mwCounters.length > 0) {
    const heights = mwCounters.map((c) => c.FromValue);
    const allSame = heights.every((h) => h === heights[0]);
    parts.push(allSame ? `Megaways ${mwCounters.length}×${heights[0]}` : `Megaways [${heights.join(',')}]`);
  }

  const symbols = root.BoardStateConditions?.SymbolsOnBoard || [];
  if (symbols.length > 0) {
    parts.push(symbols.map((s) => `${s.Count}×${s.Symbol}`).join(' '));
  }

  const oak = root.OakWinConditions || [];
  if (oak.length > 0) {
    parts.push(oak.map((o) => `OAK ${o.Count}×${o.Symbol}`).join(' '));
  }

  const mult = root.MultiplierConditions;
  if (mult && (mult.FromValue || mult.ToValue)) {
    parts.push(`mult ${mult.FromValue}–${mult.ToValue}x`);
  }

  const next = root.NextModeCheat;
  if (next) {
    parts.push(`→ ${next.GameModeName}`);
    const nextOak = next.OakWinConditions || [];
    if (nextOak.length > 0) {
      parts.push(`(${nextOak.map((o) => `OAK ${o.Count}×${o.Symbol}`).join(' ')})`);
    }
  }

  return parts.join(' | ');
}

// Used by preset list label.
export function describePreset(data) {
  const f = data?.form || {};
  const parts = [];
  if (f.gameId) parts.push(`#${f.gameId}`);
  if (f.gameModeName) parts.push(f.gameModeName);
  if (f.nextModeEnabled && f.nextGameModeName) parts.push(`→ ${f.nextGameModeName}`);
  if (f.multiplierEnabled) parts.push(`mult ${f.multFrom || 0}–${f.multTo || 0}×`);
  return parts.join(' · ') || '(pusty)';
}

export function syntaxHL(json) {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-num';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-str';
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}
