# Scene Studio — status po sesji (2026-06-02, sesja 2)

## Zrobione w poprzedniej sesji

### P0 — Trwałość stanu ✅
- **Keep-mounted**: `ToolPanel.jsx` trzyma fullBleed toole (`display:none`) zamiast `key={currentTool}` — Scene Studio + Pixi nie są niszczone przy zmianie toola.
- **Autosave IndexedDB**: nowy moduł `engine/sessionStore.js`, debounce 1s, zapisuje `scene + rootHandle`.
- **Restore banner**: przy starcie strony, jeśli IDB ma sesję z warstwami → baner „Przywróć / Nowa scena".
- **Zgodność wersji**: gdy `$schema` różny → opcja „Pobierz kopię" starej sceny.
- **Przycisk „new"**: w toolbarze z dialogiem Zapisz / Odrzuć / Anuluj.
- **Body class**: `fullbleed-tool-active` na `<body>` tylko gdy tool AKTYWNY.

### P1 — Naprawy i UX timeline ✅
- Sticky ruler, scrollbar sticky na dole, timeline do dołu, clip naming fix, struktura klipu, spine dropdown, fix split x/y selection bug, ROW_H = 40.

### P2 — Sterowanie i skróty ✅
- Spacja play/pause, strzałki krokowe, Alt+scroll, auto-key extend/shift.

### UI/UX polish ✅
- Padding body, channel labels pionowo, naprzemienne paski, alignment pasków.

---

## Zrobione w tej sesji

### Bugi — naprawione ✅

- **[BUG FIX] Kliknięcie klucza w grafie seekuje timeline** — `InspectorPanel.jsx`:
  - Prop `onFlowAction` dodany do `InspectorPanel`, threadowany przez `ClipSection` → `PngChannelEditor`.
  - W `PngChannelEditor.setSelectedKey` oblicza `clip.start + key.t` i woła `onFlowAction('seek', absT)`.
  - `SceneStudioInner.jsx`: przekazuje `onFlowAction={handleFlowAction}` do `<InspectorPanel>`.

- **[BUG FIX] Pole nazwy klipu w inspektorze** — `InspectorPanel.jsx` `ClipSection`:
  - Pole `<input type="text" value={clip.name || ''} placeholder="(auto)" ...>` przed polem start.
  - Zapisuje do `clip.name` (lub `null` gdy pusty string).

### P3 — Scena: motion-path i interakcja ✅

- **[P3] Strzałki kierunku na ścieżce** — `engine/pixiApp.js` `drawMotionPath`:
  - Co ~12% próbek rysuje wypełniony trójkąt wskazujący kierunek ruchu.
  - Zbiera pozycje próbek w tablicy `posSamples` (bez dodatkowych eval).

- **[P3] Klikalne punkty kluczy na ścieżce** — kompletna implementacja:
  - `drawMotionPath` zwraca `{ drawn, keyDots: [{t, x, y, absT}] }` zamiast `boolean`.
  - `drawSelection` propaguje `keyDots` i zwraca je.
  - `PixiViewport.jsx`: `motionKeyDotsRef` zbiera wyniki z obu wywołań `drawSelection`.
    Dodane `onSeekToKey` prop + `onSeekToKeyRef`.
    `attachViewportController` dostaje `getMotionKeyDots` i `onSeekToKey`.
  - `viewportController.js`: w `onMouseDown` przed sprite hit-test — sprawdza czy kliknięto dot (radius 10px screen), jeśli tak: `onSeekToKey(dot.absT)`.
  - `SceneStudioInner.jsx`: `<PixiViewport onSeekToKey={(t) => handleFlowAction('seek', t)}>`.

- **[P3] Drag assetu z panelu na scenę** — `AssetBrowserPanel.jsx` + `SceneStudioInner.jsx`:
  - `<li>` w drzewie assetów: `draggable`, `onDragStart` ustawia `application/x-ygg-asset-id` = `it.id`.
  - `dropRef` useEffect w `SceneStudioInner`: sprawdza `dataTransfer.getData('application/x-ygg-asset-id')` przed obsługą plików; wywołuje `addAssetItemFromBrowser` przez ref (zawsze świeży).

---

## Do zrobienia — następna sesja

### P3 — Scena: motion-path i interakcja

- [ ] **Motion-path skaluje się ze scale** (`drawMotionPath` `pixiApp.js:~470`) — transformacja punktów ścieżki przez concurrent scale value. Opis: pozycja na ścieżce powinna uwzględniać aktualny scale warstwy, żeby path odpowiadał rzeczywistej pozycji obiektu w świecie.
- [ ] **Dropdown nakładki orientacji**: obok toggle landscape/portrait — "za obiektami" (default) vs "nad obiektami (przezroczyste wnętrze)". Zmiana z-order `stageFrame` w `pixiApp.js`.

### P4 — Pełny model tangentów per-klucz
Duży temat, wymaga migracji modelu danych.

- [ ] **Nowy model klucza**: `{ t, v, inTangent, outTangent, mode: 'smooth'|'broken'|'flat'|'linear' }`. Migracja z aktualnego `{ t, v, out }` (per-segment bezier) do per-key tangentów.
- [ ] **`curves.js` / `keyframes.js`**: nowy interpolator który liczy bezier z tangentów pary kluczy (jak Unity/Maya). Zachować backward compat ze starymi scenami.
- [ ] **Edytor 3-punktowy**: kliknięcie klucza w `ClipGraphEditor` pokazuje poprzedni + wybrany + następny key; wybrany ma 2 uchwyty (in/out), skrajne po 1. Tryby smooth/broken/flat.
- [ ] **Globalny toggle ease dla nowych kluczy**: w toolbarze — nowe klucze tworzone z ease-in / ease-in-out / linear.
- [ ] **Zakrzywiona ścieżka na scenie**: `drawMotionPath()` zamiast prostych odcinków między próbkami → cubic spline z tangentów kluczy pozycji.
- [ ] **Edycja spline na scenie**: klikalne uchwyty tangentów bezpośrednio na canvasie Pixi (opcjonalne).

### Pozostałe bugi

- [ ] **Klip spin — dropdown animacji na timeline** — zaimplementowane, wymaga weryfikacji z prawdziwymi danymi Spine.

---

## Kluczowe pliki zmodyfikowane (sesja 2)

| Plik | Co zmienione |
|------|-------------|
| `src/tools/SceneStudio/engine/pixiApp.js` | `drawMotionPath`: strzałki kierunku, zwraca `{ drawn, keyDots }`; `drawSelection`: propaguje i zwraca `keyDots` |
| `src/tools/SceneStudio/engine/viewportController.js` | `onMouseDown`: key-dot hit-test przed sprite hit-test |
| `src/tools/SceneStudio/components/PixiViewport.jsx` | `onSeekToKey` prop, `motionKeyDotsRef`, zaktualizowane wywołania `drawSelection` i `attachViewportController` |
| `src/tools/SceneStudio/SceneStudioInner.jsx` | `onFlowAction` → `InspectorPanel`, `onSeekToKey` → `PixiViewport`, `assetItemsRef`/`addAssetItemFromBrowserRef`, obsługa asset-id w drop handlerze |
| `src/tools/SceneStudio/components/InspectorPanel.jsx` | `onFlowAction` prop threaded, pole nazwy klipu, seek w `PngChannelEditor.setSelectedKey` |
| `src/tools/SceneStudio/components/AssetBrowserPanel.jsx` | `draggable` + `onDragStart` na elementach listy assetów |
