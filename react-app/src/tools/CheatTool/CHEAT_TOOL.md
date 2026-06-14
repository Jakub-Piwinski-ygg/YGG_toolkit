# Cheat Tool — Architecture & Extension Guide

The Cheat Tool is a visual builder for the `/cheats/find-spin` API payload
plus an inline runner for `/v2/games/{id}/play` ("Real Spin"). It targets
internal QA workflows and ships in the YGG Toolkit "Cheets" category.

## Where this used to live

Originally implemented as a 4,800-line monolithic HTML file at
`react-app/public/cheat-tool.html` and embedded via `<iframe>`. That file is
**still present** as a reference — the in-app tool no longer uses it. Once
parity is confirmed, it can be deleted.

## React port — directory layout

```
src/tools/CheatTool/
├─ index.jsx                  — main component + meta + datalist
├─ CheatToolContext.jsx       — single source of truth (form state, board, conditions,
│                              env, response, presets, history, builtJson, validation)
├─ cheat-tool.css             — all styles, scoped under .ct-root
├─ CHEAT_TOOL.md              — this file
│
├─ lib/                       — pure helpers, no React
│   ├─ jsonBuilder.js         — buildJSON / toPascal / stripEmpty / mergeSymbols /
│   │                          getBoardSymbols / describeCheat / describePreset / syntaxHL
│   ├─ validation.js          — validateAll({state}) → {ok, errors, fieldErrors}
│   ├─ envs.js                — env routing, buildFetchOptions, getEndpointUrl, proxy port
│   ├─ symbolColors.js        — symColor(sym) memoized lookup; DEFAULT_SYMBOLS
│   └─ playResponse.js        — parsePlayActionsResponse, findSpinSteps,
│                              extractWinPositions, describeCombination,
│                              extractGameModes, extractSymbolsFromConfig,
│                              copyToClipboard
│
├─ components/                — reusable UI primitives
│   ├─ Section.jsx            — card with icon + title + subtitle + collapse
│   ├─ FieldRow.jsx           — labelled input row + RangeRow (from–to)
│   ├─ Toggle.jsx             — orange slider toggle
│   ├─ EnvPills.jsx           — DEV/STAGING/PROD/PROXY/CUSTOM pill row
│   ├─ SymbolPalette.jsx      — paint-mode palette + eraser chip
│   ├─ BoardGrid.jsx          — paint-mode visual grid (drag-paint)
│   └─ BoardSummary.jsx       — symbol-count chips below the board
│
└─ sections/                  — top-level form sections
    ├─ Presets.jsx            — localStorage presets list + save/import/export/clear
    ├─ GameConfig.jsx         — gameId, RTP variant
    ├─ GameMode.jsx           — mode name + json index
    ├─ Multiplier.jsx         — root multiplier range
    ├─ Board.jsx              — paint grid + reels/rows controls + megaways + manual symbols
    ├─ Oak.jsx                — OAK win conditions list
    ├─ Counters.jsx           — counter conditions list (+ megaways auto-preview)
    ├─ Transforms.jsx         — board transformation conditions list
    ├─ Api.jsx                — env pills, proxy config, URL preview, send/cancel/save,
    │                           validation bar
    ├─ NextMode.jsx           — chained next-mode (trigger + multiplier + counters + OAK +
    │                           board + manual symbols)
    ├─ History.jsx            — collapsible request history (localStorage)
    └─ Output.jsx              — right panel: JSON output (Pretty/Minified/PascalCase),
                                response panel (Wynik + Real Spin), status bar
```

## How rendering works

The Cheat Tool sets `meta.fullBleed: true` and `meta.hideOutput: true`. Two
framework-level flags carry the consequences:

- `fullBleed`: `ToolPanel.jsx` skips its "settings" card, RUN/CLEAR row,
  description text and OutputLog. The tool component renders directly as the
  panel content.
- `hideOutput`: `App.jsx` skips the bottom `OutputPanel` entirely for tools
  that don't produce output files.

Other tools that use these flags: Content Browser, Asset Checker, Project
Scaffold, Char Extractor.

## State flow

```
sections/*  ──reads/dispatches──▶  CheatToolContext  ──memos──▶  builtJson, validation, urlPreview
       ▲                                  │
       └──renders──────────────────────────┘
```

- Every section reads via `useCheatTool()`.
- Mutations go through stable callbacks (`addOak`, `paintMainCell`,
  `toggleMainMegaways`, `setEnv`, …) so sections don't need `useEffect`
  to re-register handlers.
- The context derives three memos that drive the right-hand output panel:
  - `builtJson = { data, clean, pascal }` — `clean` strips empties; `pascal`
    is the API-ready shape.
  - `validation = { ok, errors, fieldErrors }` — `fieldErrors[id]` is a
    string; sections read it to highlight invalid inputs.
  - `urlPreview` — the URL that would be POSTed.

## The JSON payload shape

`buildJSON` (in `lib/jsonBuilder.js`) is the only function that produces the
payload. Output (after `stripEmpty` + `toPascal`) looks like:

```jsonc
{
  "GameId": 10857,
  "RtpVariant": 0.94,
  "RootGameMode": {
    "GameModeName": "BaseGame",
    "JsonIndex": 1,                              // only when jsonIndexEnabled
    "MultiplierConditions": {                     // only when multiplierEnabled
      "FromValue": 100, "ToValue": 200
    },
    "BoardStateConditions": {
      "SymbolsOnBoard": [
        { "Symbol": "Hi1", "Count": 3 }
      ]
    },
    "CounterStateConditions": [
      { "CounterName": "spinsLeft", "FromValue": 10, "ToValue": 10 },
      // Auto-appended in megaways mode:
      { "CounterName": "NumberOfSymbols0", "FromValue": 6, "ToValue": 6 }
    ],
    "SpecificBoardTransformationCount": [
      { "TransformationTypeName": "ExpandReels", "Count": 1 }
    ],
    "OakWinConditions": [
      { "Symbol": "Wild", "Count": 5 }
    ],
    "NextModeCheat": {                            // only when nextModeEnabled
      "GameModeName": "FS1",
      "MultiplierConditions": { … },
      "BoardStateConditions": { "SymbolsOnBoard": [ … ] },
      "CounterStateConditions": [ … ],
      "SpecificBoardTransformationCount": [],     // not yet exposed in next mode
      "OakWinConditions": [ … ],
      "NextModeCheat": null
    }
  }
}
```

Notes:
- Empty objects (`{}`) and empty arrays (`[]`) are stripped by `stripEmpty`.
- PascalCase is applied last (`toPascal`).
- The Pretty tab shows `clean` in original camelCase; Minified and PascalCase
  show `pascal`.

## Adding a new condition type (template)

Say we want a new "Modifier" array similar to OAK / Counter / Transform.

1. **Context state** (in `CheatToolContext.jsx`):
   ```js
   const [modifiers, setModifiers] = useState([]);
   const modifierIdRef = useRef(0);
   const addModifier = useCallback(() => setModifiers((xs) => [
     ...xs, { id: modifierIdRef.current++, name: '', value: 0 }
   ]), []);
   const removeModifier = useCallback((id) =>
     setModifiers((xs) => xs.filter((m) => m.id !== id)), []);
   const updateModifier = useCallback((id, field, val) =>
     setModifiers((xs) => xs.map((m) =>
       m.id === id ? { ...m, [field]: field === 'value' ? (parseFloat(val) || 0) : val } : m
     )), []);
   ```
   Add `modifiers, addModifier, removeModifier, updateModifier` to the
   context value and to the `useMemo` dependency that builds `state`.

2. **jsonBuilder** (in `lib/jsonBuilder.js`): destructure `modifiers` from
   `state` and emit it into `rootMode` (or `nextModeCheat`).

3. **Validation** (optional): add a rule in `lib/validation.js`. Use a
   `fieldErrors` key like `modifier-${id}-value` so the row can wire it up
   with the `ct-invalid` class.

4. **Section component**: copy `sections/Transforms.jsx` as a starting point.

5. **Wire it** in `index.jsx`.

6. **(Optional) Preset support**: add the array to `presetSerializeState` and
   `presetApplyState` in the context.

## Adding a new environment

In `lib/envs.js`:
- Add the static base URL to the `STATIC_BASES` constant.
- Add the label to `ENV_LABELS`.

In `components/EnvPills.jsx`:
- Add a new entry to the `PILLS` array.
- Add a matching colour rule in `cheat-tool.css`
  (`.ct-env-pill.active.newenv { … }`).

If the new env behaves like proxy (intermediates via `X-Target-Url`), branch
on `state.env === 'newenv'` inside `buildFetchOptions`.

## Persistence — what lives in localStorage

| Key | Shape | Set by |
|----|----|----|
| `cheat_tool_presets` | `[{id, ts, name, data}]` | Presets section |
| `cheat_tool_history` | `[{id, ts, label, json}]` | History section |
| `cheat_tool_trigger_config` | `{[gameId]: {symbol, count, userSet:{symbol?:true, count?:true}}}` | Next Mode trigger inputs |
| `cheat_tool_proxy_port` | `"3030"` | API section proxy port input |
| `cheat_tool_play_stake` | `{cashBet, currency}` | Real Spin replay box |

The context auto-syncs presets/history via `useEffect`. Other keys are read
on demand and written through helpers in `lib/envs.js` and the context.

## Game config fetch

`fetchGameConfig` (context) calls `{baseUrl}/v2/games/{gameId}/config` with
`X-Rtp-Variant`. The paytable's `symbolPayouts` populate `allSymbols` (the
palette + datalist). Game modes (best-effort across several known shapes)
populate `gameModes` for the datalist on `gameModeName` / `nextGameModeName`.

If `baseUrl` is empty (env=custom with empty input), the fetch fails fast
with a friendly status message.

## Real Spin tab

Triggered automatically when `/cheats/find-spin` returns `randomNumbers`.
`playWithCheat(rng.join(','), false)` posts to `/v2/games/{id}/play` with
the cheat string, stake from localStorage, and the same proxy/X-Target-Url
plumbing as `sendRequest`.

The response is parsed by `findSpinSteps`, which tries half a dozen common
response shapes and falls back to `parsePlayActionsResponse` for
action-based games (cascade-style cluster pays). Each step becomes a
`{evaluatedBoard, stepWin, wonCombinations}` triple, rendered by `SpinStep`.

## Deferred features (session-2 backlog)

These exist in the original `public/cheat-tool.html` but are **not** in this
React port yet. Each is independently addable.

- **Drag-and-drop on the board grid.** Original supported dragging symbols
  from the palette onto cells, dragging cells between cells, and right-click
  clear. The React port has paint-mode + right-click clear; full drag-drop
  needs a third mode tab and `dragstart` / `dragover` / `drop` wiring in
  `BoardGrid.jsx`.
- **Type-with-autocomplete mode** for the board. Per-cell `<input>` with
  symbol prefix matching, arrow-key navigation through suggestions,
  Tab/Enter to accept.
- **Undo/redo stacks** on both boards. Original keeps two 50-element stacks
  (`mainUndoStack` / `nbUndoStack` + redo siblings). Easiest port: keep a
  ring buffer of board snapshots in context and bind Ctrl+Z / Ctrl+Shift+Z
  via `useKeyboardShortcuts`.
- **Keyboard shortcuts popover** (Ctrl+/). Send (Ctrl+Enter), save to
  history (Ctrl+S), copy JSON (Ctrl+Shift+C), undo/redo.
- **Custom symbol palette coloring** when game config is fetched. Currently
  uses `symColor()` heuristics; original assigned a deterministic palette to
  unknown symbols at fetch time.
- **`Toast` system.** Currently each section renders its own ad-hoc toast.
  A small `CheatToolToastProvider` would unify "Zapisano / Załadowano /
  Skopiowano" feedback.

## Styling conventions

All styles live in `cheat-tool.css` and are scoped under `.ct-root`. To
avoid bleeding into the rest of the toolkit:

- Class names are prefixed `ct-` (or `ic-` for the section-icon variants).
- Local design tokens are declared on `.ct-root`:
  - `--ct-accent` = YGG orange (`var(--accent)`)
  - `--ct-accent2` = cyan (info / secondary)
  - `--ct-accent-purple` = purple (presets / history accent)
  - `--ct-green`, `--ct-red`, `--ct-warn` for semantic states
- Semantic colors are preserved (success=green, danger=red, info=cyan).
  Only the primary brand mapped to orange.

## Layout

`.ct-layout` is a CSS grid `grid-template-columns: 360px 1fr`. The left
column is intentionally narrow for dense form input; the right column owns
the visual weight (JSON output, response, status bar). A media query at
`max-width: 1100px` stacks them.

## Known gotchas

- The cheat tool internally manages its own state (separate from the YGG
  toolkit's `AppContext`). The only crossover is the runner registration —
  done as a no-op so the toolbar dropdown still works.
- React 17+ delegates events at the root, so plain `cell.dispatchEvent` on
  `mousedown` does trigger `onMouseDown` — paint test scripts should use
  `dispatchEvent` with `bubbles: true`.
- Megaways mode marks "trimmed" cells (cells above a reel's height) as
  `null` in the grid, distinct from empty `''`. Paint handlers skip `null`
  cells to keep megaways geometry intact.
