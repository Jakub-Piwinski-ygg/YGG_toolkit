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

## Zrobione w sesji 3

### P3 — finalizacja ✅

- **[P3] Motion-path → parent-chain transform** — `drawMotionPath` w `pixiApp.js`:
  - Sygnatura rozszerzona o `obj, contentRoot`.
  - `toWorld(p)` = `localToContent(obj.parent, p.x, p.y, contentRoot)` gdy warstwa ma zagnieżdżonego parenta; no-op dla top-level.
  - Wszystkie sample-pointy i key-doty przechodzą przez `toWorld` przed rysowaniem.
  - `drawSelection` przekazuje `obj` i `contentRoot` do `drawMotionPath`.

- **[P3] Dropdown nakładki stage frame** — `StudioToolbar.jsx` + `pixiApp.js` + `PixiViewport.jsx` + `SceneStudioInner.jsx`:
  - `drawStageFrame` przyjmuje `overlayMode='behind'|'above'`; gdy `'above'` pomija ciemny fill.
  - Nowy eksport `setStageFrameZOrder(viewport, stageFrame, content, overlayMode)` przestawia child-order.
  - `PixiViewport`: nowy prop `overlayMode`, `overlayModeRef`, `useEffect` na mode-change → `setStageFrameZOrder` + `requestRender`.
  - `StudioToolbar`: nowy prop `overlayMode/onSetOverlayMode`, `<select class="scene-toolbar-select">` obok przycisku orientacji.
  - `SceneStudioInner`: `useState('behind')` → przekazane do toolbar i viewport.
  - CSS: `.scene-toolbar-select` — styled to match `.scene-btn`.

---

## Zrobione w sesji 4

### P4 — Pełny model tangentów per-klucz ✅

Model danych — **dual-path, lossless, nie-destrukcyjny**. Stare sceny (klucze bez
`tm`) animują się bit-w-bit identycznie; nowy model wchodzi tylko gdy klucz ma `tm`.

- **[P4] Nowy model klucza** — `keyframes.js` / `sceneModel.js`:
  - Opcjonalne pola: `tm` (`'auto'|'flat'|'linear'|'free'|'broken'`) + `ti`/`to`
    (slopy w jednostkach-wartości na sekundę, kształt jak `v`). `out` (legacy bezier) ZACHOWANY.
  - `normalizeChannelKey` parsuje/waliduje `tm`/`ti`/`to` per layout (scalar/vec2/rgb).
- **[P4] Interpolator Hermite** — `curves.js` (`hermite`, `easingEndpointSlopes`) + `keyframes.js`:
  - Segment a→b jest Hermite gdy `a.tm` LUB `b.tm` istnieje; inaczej legacy `curveEval(a.out)`.
  - Resolvery slopów per tryb (`auto`=Catmull-Rom, `flat`=0, `linear`=secant, `free`=mirror `to`, `broken`=`ti`/`to`).
  - Mieszany styk legacy↔tangent: brakujący slope seedowany numerycznie z legacy krzywej → ciągłość.
  - Per-komponent dla vec2/rgb (x i y mają własne slopy).
  - Helpery mutacji: `effectiveSlopes`, `setKeyTangentMode` (seeduje przy promocji), `setKeyTangentSlope` (drag → broken/free).
- **[P4] Edytor 3-punktowy** — `ClipGraphEditor.jsx`:
  - Wybrany klucz: 2 przeciągalne uchwyty (in/out) w value-space subplot; sąsiedzi: po 1 jasnym uchwycie (kontekst).
  - Drag uchwytu liczy slope z geometrii (px↔value↔slope, konwersja deg dla rotacji), promuje segment do Hermite (seed z legacy → bez skoku). Smooth/legacy klucz → `free` (mirror); flat/linear/broken → `broken`.
  - `TangentControls`: chipy trybów smooth/flat/linear/broken; dla kluczy legacy nadal pokazuje stary edytor bezier (`CurveEditor`) póki artysta nie wejdzie w model tangentów.
  - CSS: `.scene-graph-tan*`, `.scene-tangent-modes`, `.scene-tangent-hint`.
- **[P4] Globalny toggle ease nowych kluczy** — `StudioToolbar.jsx` + `SceneStudioInner.jsx`:
  - `scene-toolbar-select` (smooth/flat/linear, default `auto`). Stan `defaultEase` + `defaultEaseRef`.
  - `insertOrUpdateKey` przyjmuje `opts.tm`; stemplowane na WSZYSTKICH nowych kluczach: auto-key (transform/drag), `+key`, enable-channel seed, plot-click insert. Istniejące klucze nietknięte.
  - Threadowane: `SceneStudioInner → InspectorPanel → ClipSection → PngChannelEditor → ClipGraphEditor → ChannelSubplot`.
- **[P4] Zakrzywiona ścieżka na scenie** — bez zmian w kodzie: `drawMotionPath` próbkuje `evalChannel` ≈80×/s, więc spline pojawia się automatycznie gdy interpolator robi Hermite.

Testy jednostkowe interpolatora + mutacji: 14/14 i 12/12 przeszły (legacy bit-identyczne, flat=smoothstep, linear=prosta, vec2 per-comp, mode-switch seeduje, drag round-trip). Build czysty, app ładuje się bez błędów konsoli, oba selecty toolbara renderują.

### Klip spin — ✅ zweryfikowane z prawdziwymi danymi Spine (sesja 5).

---

## Sesja 5 (w toku) — P5: tryb ścieżki na scenie (path + progress, bake na eksport)

**Założenie**: opcjonalny tryb gdzie pozycja jest sterowana przestrzennym splajnem
(diale na scenie) + osobną krzywą `progress(t)` liczoną po **długości łuku**
(stała prędkość, progress kształtuje przyspieszanie). Edytujesz jako path, ale
przy **eksporcie** zapieka się do zwykłych krzywych x/y (silnik nie liczy arc-length).
Decyzje użytkownika: **bake tylko przy eksporcie** + **konfigurowalna gęstość (suwak fps)**.

### ✅ P5.1 — matma splajnu (`engine/animation/pathSpline.js`, nowy plik)
- Splajn 2D z punktów (`{x,y,tm,ti,to}`): auto (Catmull-Rom→Bézier), linear (proste), broken/free (uchwyty offsetowe).
- Tablica długości łuku (LUT), cache po identyczności tablicy `points` (WeakMap → auto-invalidacja).
- `getPathSpline(points)` → `{ totalLength, pointAtFraction(f), tangentAtFraction(f) }`. Test: 11/11.

### ✅ P5.2 — model + interpreter (`keyframes.js`, `sceneModel.js`, `pixiApp.js`)
- `channels.position.mode='path'` + `path:{ points, progress:{keys}, bakeFps }`.
- `keyframes.js`: `isPathChannel()`, gałąź path w `evalChannel` (live: `progress(t)`→arc-length→punkt), `bakePathToKeys(channel, duration, fps)` → liniowe klucze vec2 na eksport.
- `sceneModel.js`: `normalizePathChannel`/`normalizePathPoint` (walidacja, clamp progress 0..1, default fps=30, ≥2 punktów). Test normalize: 10/10.
- `pixiApp.js`: `drawMotionPath` rysuje path-mode bezwarunkowo (sampluje evalChannel); `applyPngChannels` stosuje path-mode pozycję w odtwarzaniu (gate o `isPathChannel`).
- `InspectorPanel`: wykrywanie path-mode w chipach „animate" + nagłówku klipu.
- Interpreter/motion-path/eksport czytają path jak zwykły kanał vec2 — bez specjalnej wiedzy poza `evalChannel`.

### ✅ P5.3 — UI inspektora (`InspectorPanel.jsx`, `ClipGraphEditor.jsx`)
- Toggle „◈ edit position as path (scene)" — seeduje ścieżkę z aktualnych kluczy pozycji (próbkowanie) lub z bazowej pozy (krótki odcinek). Wyłączenie = bake do x/y (flatten).
- W trybie path: wykresy x/y ukryte; pokazany wykres `progress(t)` (reuse `ChannelSubplot` → przeciągalne punkty + uchwyty tangentów) + pole „bake fps".
- `patchChannel` rozszerzone o path-alive; eksport `ChannelSubplot` z ClipGraphEditor.

### ✅ P5.4 — diale na scenie (`pixiApp.js`, `viewportController.js`, `PixiViewport.jsx`, `SceneStudioInner.jsx`)
- `drawMotionPath` w trybie path rysuje diale punktów (żółte) + linie i gałki uchwytów tangentów (niebieskie); zwraca `pathHandles` (świat) razem z `keyDots`.
- `drawSelection` zwraca teraz `{ keyDots, pathHandles }`; `PixiViewport` zbiera `pathHandlesRef` + prop `onPathEdit`.
- `viewportController`: hit-test diali przed sprite (radius 10px, bias do uchwytów), drag → `onPathEdit({kind,index,x,y})` w parent-local (konwersja z world). RAF + kursor.
- `SceneStudioInner.handlePathEdit`: point → przesuwa punkt; out-drag → `free` (mirror) lub `broken`; in-drag → `broken` (seed `to` z auto). Historia: coalescing 250ms = 1 undo na drag.

### ✅ P5.5 — bake przy eksporcie (`persist.js`)
- `bakePathsForExport(scene)` w `saveScene`: dla każdego path-mode position dorzuca zapieczone liniowe klucze x/y (wg `bakeFps`) OBOK źródła `path`. Silnik czyta `keys` (proste x/y, bez arc-length); toolkit przy reloadzie woli `path` (re-edytowalne).
- Fix `normalizeChannels`: path-mode position ma pierwszeństwo — generyczna pętla nie nadpisuje go zapieczonymi `keys` (guard `if (out[name]) continue`).

> **P5 ukończone.** Testy: geometria 11/11, eval+bake 11/11, normalize 10/10, mutacje 12/12,
> export+round-trip 6/6. Build czysty, app renderuje stabilnie.
>
> Jak używać: zaznacz klip PNG → w inspektorze włącz „◈ edit position as path" →
> przeciągaj żółte diale (punkty) i niebieskie gałki (tangenty) na scenie, kształtuj
> tempo wykresem `progress(t)`. Eksport (save scene.json) zapiecze to do zwykłych x/y.

### Poprawki UX + bugfixy (sesja 5, po feedbacku)

- **[UX] Toggle path większy + confirm** — `InspectorPanel`: `scene-path-toggle-btn` pełnej szerokości, wyróżniony, tuż nad grafami pozycji. `togglePathMode` pyta `confirm()` w obie strony (przy włączeniu ostrzega, że powrót zapiecze dużo kluczy; przy spłaszczeniu podaje ~liczbę kluczy wg fps).
- **[FEATURE] Auto-key dodaje punkt ścieżki** — `handlePatchTransform`: gdy pozycja jest path-mode i nagrywamy, przeciągnięcie sprite'a w danym czasie wstawia (lub przesuwa pobliski) gładki punkt `auto` na ścieżce we frakcji = `progress(localT)`. Helpery `pointArcFractions` + `insertOrUpdatePathPoint` w `pathSpline.js`. Test 11/11.
- **[BUG] Delete nie usuwa już klipu** — usunięty osobny handler Delete/Backspace w `TimelinePanel` (klip kasujesz tylko ✕ na klipie).
- **[BUG] Delete kasował zły klucz / potem klip** — `PngChannelEditor`: w trybie kontrolowanym (jest `externalOnSelectKey`) selekcja NIE wraca do nieaktualnego `localKey`, więc po skasowaniu klucza nic nie zostaje zaznaczone (poprzednio „następny" pozostawał i drugi Delete leciał na klip).
- **[BUG] Delete klucza progresu (path)** — `PathProgressEditor` ma własny capture-handler Delete + przycisk „✕ delete progress key N" (krzywa progresu używa lokalnej selekcji, więc globalny system jej nie obsługiwał).

### Poprawki UX (sesja 5, runda 2)

- **[UX] Przycisk path mniejszy** — `inline-block`, jedna linijka (`white-space:nowrap` + ellipsis), padding `5px 12px`, font 11px. Krótsze etykiety: „◈ edit position as path" / „◈ path mode — flatten to x/y".
- **[FEATURE] Wybór dokładności przy spłaszczaniu** — `bakePathToKeyCount(channel, duration, count)` (klucze rozłożone równo w czasie, tangenty `auto` → mała liczba kluczy i tak śledzi ścieżkę). Flatten pyta `prompt()` o liczbę klatek (domyślnie ~`duration*4`, clamp 2..400) zamiast sztywnych ~50 z fps. Test 9/9.

### Bugfix (sesja 5, runda 3)

- **[BUG] Resize klipu nie wypycha już kluczy poza klip** — `maxChannelKeyTime(channels)` w `keyframes.js` (max `t` po linked/split/progress). Guard w obu funkcjach `patchClip` (TimelinePanel = drag na timeline, InspectorPanel = pola start/duration): `duration` nie może zejść poniżej najdalszego klucza; przy resize lewej krawędzi (start+duration zmieniają się, prawa krawędź stała) `start` jest przeliczany, żeby prawa krawędź została na miejscu. Test 5/5.

### Sesja 5, runda 4 — UX kluczy

- **[FEATURE] „+" klip dziedziczy stan brzegowy** — `seedChannelsFromClipEdge(clip, side)` w `TimelinePanel`: dodanie klipu „+" z lewej tworzy klip trzymający stan **startu** wybranego klipu (punkt A), z prawej — stan **końca** (punkt B). Dotyczy wszystkich animowanych kanałów (position incl. path → ewaluowane do zwykłego klucza, scale, rotation, alpha, tint). `addClipToTrack` przyjmuje `extraChannels`. Test 11/11.
- **[FIX] Top-pola transformu = source of truth podczas nagrywania** — `InspectorPanel`: gdy klip nagrywa, pola x/y/scale/rot/alpha/tint pokazują **wartość ewaluowaną w playhead** (nie bazową pozę), więc pole podąża za edycją zamiast „odskakiwać" do bazy. To naprawia „bardzo ciężko ustawić alfę / klucz źle ustawiony" — teraz co wpiszesz, to ląduje w kluczu i pole to odzwierciedla. (`animValue` per kanał + `disp` zamiast `t` w polach.)

### Sesja 5, runda 5 — zarządzanie scenami + podmiana obiektu

- **[FEATURE] Skaner scen + dropdown** — `persist.js`: `scanProjectScenes(rootHandle)` (przechodzi wszystkie `*.json`, parsuje, waliduje jako sceny) + `loadSceneByRelPath`. `SceneStudioInner`: `availableScenes`/`currentSceneRel`, skan po wybraniu roota, przełączanie sceny z popupem „Zapisz/Odrzuć/Anuluj" (`sceneSwitchPending`), „＋ new scene" w obrębie projektu. `StudioToolbar`: `<select>` scen obok open/save.
- **[FEATURE] Socket podmiany obiektu na warstwie** — `InspectorPanel`: pole „source" (dropdown wszystkich assetów sceny → reassign `layer.assetId`) + drop-target na DnD z panelu Assets (`application/x-ygg-asset-id`). Działa dla PNG (statyk) i Spine (skeleton). `applyAssetSwapToLayer`: zachowuje pozę i animację (klipy są na tracku), **resetuje scale do 1:1**, resetuje spine defaults / video defaults wg typu. DnD z assetów tworzy asset jeśli go nie ma (dedupe po src). Test 11/11.

### Odłożone (opcjonalne, sesja 6)
- [ ] Podmiana obiektu przeciąganiem **ze sceny** (sprite na sprite) — teraz: dropdown + DnD z panelu Assets.
- [ ] Dodawanie/usuwanie punktów ścieżki na scenie ręcznie (dbl-click dodaj / alt-click usuń) — teraz punkty przybywają przez auto-key (drag sprite'a), a istniejące przesuwasz dialami.
- [ ] Chipy trybu tangentu per-punkt ścieżki na scenie (auto/broken/free) — teraz: drag uchwytu out=free, in=broken.

---

## Kluczowe pliki zmodyfikowane (sesja 4)

| Plik | Co zmienione |
|------|-------------|
| `engine/animation/curves.js` | `hermite()`, `easingEndpointSlopes()` (numeryczna estymacja slopów krańcowych dowolnego easingu) |
| `engine/animation/keyframes.js` | model tangentów: resolvery slopów, Hermite w `evalScalarKeys`/`evalChannel`, `effectiveSlopes`, `setKeyTangentMode`, `setKeyTangentSlope`, `insertOrUpdateKey` z `opts.tm` |
| `engine/sceneModel.js` | `normalizeChannelKey` waliduje `tm`/`ti`/`to`; `normalizeTangentSlope` |
| `components/ClipGraphEditor.jsx` | uchwyty tangentów in/out + sąsiedzi, drag→slope, `TangentControls` (chipy trybów), thread `defaultTangentMode` |
| `components/InspectorPanel.jsx` | thread `defaultTangentMode`; seed/`+key` stemplują `tm` |
| `components/StudioToolbar.jsx` | select `defaultEase` (smooth/flat/linear) |
| `SceneStudioInner.jsx` | stan `defaultEase`+ref; `insertOrUpdateKey({tm})` we wszystkich ścieżkach tworzenia kluczy |
| `styles/scene-studio.css` | `.scene-graph-tan*`, `.scene-tangent-modes`, `.scene-tangent-hint` |

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
