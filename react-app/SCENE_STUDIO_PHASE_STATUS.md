# Scene Studio — status po sesji (2026-06-02, sesja 2)

## Win Sequences — Faza 1 (web + timeline) — UKOŃCZONA ✅ (2026-06-26)

Drugi obiekt budowany kreatorem w Scene Studio (po Spinnerze). **Faza 1 = autoring
web + runtime na osi czasu**; **Faza 2 (przyszłość) = eksport Unity `.unitypackage`**
(`YggWinSequence`), analogicznie do podziału Spinner Phase 5 → fazy Unity. Build
zielony, 15/15 testów modelu. Pełna specyfikacja: `react-app/WIN_SEQUENCES.md`.

- **Sesja 2026-06-24** — dokument projektowy + czysty model (`engine/winseq/winseqModel.js`)
  + runtime oparty o Spine (`engine/winseq/winseqRuntime.js`). Parsowanie animacji
  `NNx_tier_sub`, generowanie eskalacyjnych **flowów** (od `small`, każdy tier
  `begin → idle`, tylko końcowy `end`), normalizacja/derywacja sekwencji, ewaluacja
  flow (krok + czas lokalny), sumowanie długości, `hangOnLastIdle`, `large`/`max`
  bramkowane (domyślnie off). Pierwszy render web + na osi czasu.
- **Sesja 2026-06-25** — kreator (`components/WinSequenceWizard.jsx`): pobranie tripletu
  szkieletu, auto-mapowanie tierów **+ ręczne dropdowny begin/idle/end per tier**,
  generowanie flowów, pasek-transport podglądu w panelu. Dopracowanie modelu + pełny
  zestaw 15 testów (`winseqModel.test.mjs`): pojedyncza klatka respektowana (bez
  doklejania do 1s), fallback nieznanej animacji, pętla końcowego idle w trybie hang.
- **Sesja 2026-06-26** — kreatory **przeniesione z toolbara do lewego stacka** (pod
  hierarchią, nad workspace) — `StudioToolbar.jsx` / `SceneStudioInner.jsx`
  (`.scene-wizards-panel`). Bramka „No Workspace Loaded" (wyszarzenie + wymuszone
  centralne ładowanie gdy brak roota, `WorkspaceLockOverlay.jsx`). Tryb kreatora
  domyślnie ustawia widok sceny na **frame behind** (zapis/przywrócenie poprzedniego
  trybu nakładki przy zamknięciu), żeby podglądany obiekt nie był wyszarzany ramką
  „in front". Faza 1 ogłoszona ukończoną.

Notatka sesji (EN): `brain/50-Sessions/Win Sequences Phase 1.md`.

| Warstwa | Plik |
|---|---|
| Czysty model (tiery, parse, flowy, normalize, eval, długości) | `engine/winseq/winseqModel.js` (+ `.test.mjs`, 15/15) |
| Runtime Pixi (Spine, scrub-safe `setAnimation + trackTime`) | `engine/winseq/winseqRuntime.js` |
| Build/apply/reset/hash/onAssetReady | `engine/pixiApp.js` |
| `clip.winseq` + typ assetu `winseq` | `engine/sceneModel.js` |
| Kreator (fetch szkieletu + mapa tierów + gen flow + podgląd) | `components/WinSequenceWizard.jsx` |
| Panel-launcher kreatorów (lewy stack) | `SceneStudioInner.jsx` (`.scene-wizards-panel`) |
| Handlery create/edit/update + render | `SceneStudioInner.jsx` |
| Inspektor klipu (flow picker, hang, set-duration, re-edit) | `components/InspectorPanel.jsx` |
| Etykieta klipu + flow picker + domyślna długość | `components/TimelinePanel.jsx` |

---

## Redesign ścieżki keyframe + głęboki zoom + skalowalne panele (2026-06-15) ✅

Trzy bramkowane fazy z `SCENE_STUDIO_KICKOFF.md`, każda zweryfikowana na żywo przez
użytkownika przed kolejną (build zielony). Working tree, niezacommitowane.

- **Faza 1 — redesign ścieżki keyframe + stabilne id kluczy (`kid`).** Każdy keyframe
  ma teraz stabilne `kid` (stempel idempotentny w `deriveFlowGraph`, nowe klucze w
  `insertOrUpdateKey`; prefiksy `k…`/`kf…` bez kolizji, przeżywa save/load). `kid` jest
  kanoniczną tożsamością zaznaczenia; cache `idx` jest **re-derywowany z kid** po każdej
  zmianie sceny (koniec glitcha "trzeba kliknąć ponownie"). `transformClipKeys` mapuje
  czasy i **sortuje swobodnie** (bez clampu) → zaznaczony zestaw przechodzi przez
  sąsiadów. Zaznaczony klip **rozwija się** (duże wiersze per-kanał + górny wiersz "all"
  w stylu Unity, który przeciąga wszystkie klucze danego czasu); niezaznaczone klipy
  **spłaszczają się** do jednego diamentu na czas. Drag-stabilny pointer-capture
  (stały porządek DOM po kid + summary kluczowany po zbiorze kid).
- **Faza 2 — zoom + dynamiczna długość.** Max zoom 360 → **1440 px/s** (~4× głębiej),
  kółko multiplikatywne. `niceTimeStep` dobiera krok linijki wg zoomu/fps (etykiety
  gęstnieją `1s → 0.5s → 0.25s`); `buildGridlines` rysuje trzy poziomy — sekundy,
  pod-sekundy (.25/.5/.75) i **per-frame** (gdy klatka ≥7px). **Dynamiczna długość
  timeline**: flaga `stage.manualDuration` — wpisanie długości = ręczne; inaczej efekt
  auto-dopasowuje długość do treści (rośnie przy wyciąganiu klipu, kurczy się do
  ostatniego klipu), przycisk „auto" wraca do auto-fit. Klipy do capu 300s (`dragMax`).
  ⚠️ Istniejące sceny ładują się w trybie auto (długość skacze do treści do czasu
  ręcznego przypięcia).
- **Faza 3 — panele + przyciski trybu + auto-load.** **Skalowalne panele** (drag,
  zapis w localStorage): wysokość timeline (cap by viewport ≥160px), szerokość
  inspektora (rośnie w lewo, min = 300), szerokość hierarchii/workspace (rośnie w prawo,
  min = 260) — `beginPanelResize` na listenerach window, paski `.scene-resize-handle`.
  **Przyciski Setup/Animate** w stylu Spine: większe, z ikonami patyczaka (T-poza /
  bieg) + etykieta. **Auto-load** poszerzony o `<name>.project.json` (kanoniczny
  `project.json` nadal preferowany).
- **ODŁOŻONE — overlay device-view (C).** Pominięte na życzenie użytkownika; kod Pixi
  (`loadDeviceGuideTexture`, sprite `deviceGuide`) nietknięty; mapowanie guide→stage
  (cover vs biały safe-rect) do potwierdzenia.

Notatka sesji (EN): `brain/50-Sessions/Session 2026-06-15 Scene Studio Keyframe Track
Redesign Zoom and Panels.md`.

## Phase 4 — eksport WebM (2026-06-14) ✅

Pierwszy eksporter web-media (poza Unity): aktywny timeline 0→duration renderowany
deterministycznie do pliku `.webm` (build zielony, zweryfikowane w przeglądarce przez
użytkownika).

- **`engine/webmExport.js`** — czysty rejestrator: `pickWebmMime()` (próba vp9→vp8→webm),
  `recordCanvasFrames()` używa `canvas.captureStream(0)` + ręczne `track.requestFrame()`
  na `MediaRecorder`, tempo do zegara ściennego (`1000/fps` na klatkę) → poprawny czas
  trwania; kooperacyjne anulowanie (`signal.aborted`).
- **`PixiViewport.exportWebM()`** — tryb eksportu: zatrzymuje ticker + RAF (`exportingRef`),
  chowa ramkę sceny i overlay selekcji, ustawia tło na nieprzezroczyste, zmienia rozmiar
  renderera do natywnej rozdzielczości sceny × scale przy `resolution 1`, renderuje
  0→duration deterministycznie (`applyFlowAtTime(t)` → `app.render()` → `requestFrame()`).
  Wszystko przywracane w `finally` (anulowanie/błąd nie psuje edytora). Spine seekowany
  po `trackTime` (deterministycznie), tick dt wyłączony na czas capture.
- **`WebMExportDialog.jsx`** — fps (15/24/30/60), jakość (4/8/16 Mbps), rozdzielczość
  (100/50/25%), kolor tła (nieprzezroczyste), pasek postępu, anuluj, auto-download;
  ustawienia w localStorage. Przycisk **▶ webm** w `StudioToolbar` obok ⇪ unity.
- **Ograniczenia (świadome):** tylko nieprzezroczyste (brak alfy); warstwy wideo mogą
  nie być klatkowo-dokładne; **hero-PNG i sekwencja PNG nadal NIE zrobione.**

## Project / Scenes / Timelines + Setup-Animate (2026-06-14) ✅

Spine-2D-style workflow + bogatszy model dokumentu (build + wszystkie testy zielone,
nowe `engine/projectModel.test.mjs` + `unity/perTimeline.test.mjs`):

- **Phase 1 — Timeline UX.** Scrub TYLKO na linijce (ruler), nie na ciele lane.
  Multi-select klipów: zwykły klik = pojedynczy, ctrl/⌘ = toggle, shift = zakres w
  obrębie tracka, marquee (rubber-band) na pustym lane. Grupowe przesuwanie zaznaczonych
  klipów (wspólny deltaT, clamp per sąsiad). Usuwanie klipów klawiszem Delete (priorytet:
  keyframe → klip[y]); przycisk ✕ na klipie usunięty. `TimelinePanel.jsx`,
  `SceneStudioInner.jsx` (`selectedClipIds`).
- **Phase 2 — Setup vs Animate.** Toggle w `StudioToolbar`. Setup: ukryta linijka,
  playhead=0, edycja → poza domyślna (per orientacja), pixiViewport pomija `applyFlowAtTime`.
  Animate: auto-key ON → keyframes; auto-key OFF → edycja ulotna (nic nie commituje,
  obiekt wraca do wyliczonej pozy). Usunięty stary fall-through pisania bazowej pozy
  gdy klip zaznaczony a auto-key OFF.
- **Phase 3 — Project / Scenes / Variants + multi-timeline.** `ygg-project/1` + scena
  `ygg-scene/2` z `timelines[]` zamiast `flow`. Wspólna pula assetów na poziomie projektu.
  Wiele scen (przełączanie bez utraty edycji), warianty (`variantOf`, copy-as-variant).
  `engine/projectModel.js`, model timeline w `engine/sceneModel.js` (`activeTimeline`,
  `syncFlowToActiveTimeline`, `setActiveTimeline`, `addTimeline`…), `persist.js`
  (`saveProject`/`loadProjectFromHandle`/`loadProjectFromFile`: manifest + plik-na-scenę
  w trybie folderu, inline w trybie download). `SceneStudioInner` trzyma `project` i
  materializuje scenę roboczą; `flow` = żywe lustro aktywnej osi. Migracja v1→v2 i
  legacy `scene.json` → 1-scenowy projekt. Selektor osi czasu w `TimelinePanel`,
  scena/wariant w `StudioToolbar`.
- **Phase 4 — Unity export per timeline.** Jeden `.anim` na (canvas × timeline); seed
  GUID zawiera `timelineId`, więc re-export zachowuje GUID-y istniejących osi (merge),
  a nowa oś dodaje nowy klip (add). Deskryptor `ygg-unity-scene/2` z tablicą `timelines[]`
  (per-oś `clipGuid` + spine/spinner cues); `spineCues`/`spinnerCues` na górze = oś
  podstawowa (back-compat). `YggSceneTimelineBuilder.cs` dokłada `AnimationTrack` na każdą
  dodatkową oś (ładuje klip po GUID, additive). `exportUnityPackage.js`, `csharp.js`.

---

## Spinner Unity — Phase 5 round 5 (2026-06-14) ✅

Trzy potwierdzone builds z `next phase spinner unity phase5.md` (build + 49 testów zielone):

- **§A "present win" clip** — nowa akcja `presentWin` (po `stopSpin`) steruje, KIEDY
  wygrywające symbole grają animację wygranej (zamiast auto `winDelay`). Per-reel
  `reelWinStagger` (0 = naraz, >0 = kaskada reel 0→1→…) + opcjonalny `perReelWinDelay`.
  Ewaluator: `winStartByReel[]` na każdy stop (`spinnerEval.js`); brak klipu →
  stare auto-zachowanie. Przeniesione do Unity: `bake.js` (czyta zagnieżdżone
  `c.spinner` — wcześniej czytał płasko i GUBIŁ target board/delays), `csharp.js`
  (`SpinnerClipData`/`ResolveTrack`/`EvaluateInternal`, `YggSpinnerClip`/Track/mixer,
  timeline builder). UI: `SpinnerInspectorSections.jsx` + `spinnerPresentWinDuration`.
- **§B jeden mask maszyny + natywne 1:1** — symbole renderują się w natywnych px
  (220px zostaje 220px, wychodzi poza komórkę); usunięty fit-shrink. Jeden mask
  (RectMask2D / SpriteMask) obejmuje `Statics+Blurs`; `Fx` POZA maskiem (animacje
  wychodzą poza maszynę). Hierarchia: `Board > Mask > Statics/Blurs` + `Fx`.
  `spinnerRuntime.js`, `prefab.js#spinnerBakedDocs`, `csharp.js`
  (`NewMaskContainer`/`SetNativeSize`, bez `FitScale`; legacy prefab fallback).
- **§C runtime API** — `YggSpinner.SetResultBoard(string[][])` + `Spin()`/`Spin(board)`
  napędzają cykl spin→stop→present-win z własnego zegara (`Update()`), bez Timeline;
  wygrane liczone z wstrzykniętej planszy. Dokumentacja w `SPINNER.md` §6.

---


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

---

## Sesja (2026-06-13) — Spinner → Unity export, phase 2 + import fix

Pełna specyfikacja: `next phase spinner unity phase2.md` (zrobione) i
`next phase spinner unity phase3.md` (następny krok). Skrót:

### Zrobione ✅ (zweryfikowane realnym importem do Unity)
- **Spinner control track na Timeline** — nowy gated runtime assembly
  `Ygg.SceneStudio.Runtime.Timeline` z `YggSpinnerTrack` / `YggSpinnerClip`
  (osobny plik!) / `YggSpinnerMixerBehaviour`. Mixer woła `SetClips` + `Evaluate`,
  więc scrubowanie Timeline rusza bębnami w edit mode. Builder
  (`TryBuildSpinnerTrack`) tworzy track z `spinnerCues` z deskryptora.
- **Spine clip parity round 1** — `holdPrevious`/`useBlendDuration`/`clipIn`/
  `alpha` w schemacie klipu, inspektorze, web playbacku i eksporcie.
- **Auto-build Timeline → opt-in** (`autoBuildTimeline`, domyślnie false) +
  głośne ostrzeżenie gdy brak spine-timeline.
- **Pakowanie `blob:`** (blur PNG z wizarda) w `bytesForSrc`.
- **Fixy po imporcie**: `YggSpinnerClip` przeniesiony do własnego pliku
  (`No script asset` → klip się nie deserializował), `ResolveTrack` /
  `StripAt` / `EvalWaysWins` zabezpieczone przed indeksami poza zakresem.

### Następny krok → `next phase spinner unity phase3.md`
Animacje land/win symboli (Spine) w web + Unity (teraz nie grają, jest
niechciany proceduralny scale-punch), offset czasu land anim, przyciski
„set duration" dla klipów spinnera, Spine clip parity round 2 (pełne pola
Spine Animation State Clip), bugi: phantom starting animation + domyślny mix.

| Plik (sesja spinner-unity) | Co zmienione |
|------|-------------|
| `unity/csharp.js` | `yggSpinnerClipSource`/`yggSpinnerTrackSource`, `runtimeTimelineAsmdefSource`, `TryBuildSpinnerTrack`, gating auto-build, bounds-guards w `ResolveTrack`, parity `SpineCue`/`FireSpineCue`/`TryBuildSpineTracks` |
| `unity/exportUnityPackage.js` | emit nowych skryptów+asmdef, `autoBuildTimeline`, `blob:` w `bytesForSrc` |
| `unity/prefab.js` | `autoBuildTimeline`/`spinnerHandledByTimeline` + nowe pola spine cue w `scenePlayerYaml` |
| `unity/bake.js` | nowe pola w `spineCuesForLayer` |
| `engine/sceneModel.js` | nowe pola klipu w `normalizeClip` |
| `engine/pixiApp.js` | honorowanie holdPrevious/clipIn/alpha/useBlendDuration |
| `engine/spinner/spinnerRuntime.js` | proceduralny pop fallback (do USUNIĘCIA w phase 3) |
| `components/InspectorPanel.jsx` | pola parity spine clip |
| `unity/spinnerTrack.test.mjs` | nowe testy codegenu (36 pass) |

---

## Sesja (2026-06-13) — Spinner → Unity export, phase 3 (animacje symboli + parity round 2)

Pełna specyfikacja + status: `next phase spinner unity phase3.md`. Wszystko
zaimplementowane, build + 41 testów zielone; generowany C# wymaga weryfikacji
importem do Unity (§A3 runtime overlay = największe ryzyko).

### Zrobione ✅
- **§A1** — usunięty niechciany proceduralny scale-punch (web `spinnerRuntime.js`
  + Unity `YggSpinner.Evaluate`). Land/win = tylko animacje Spine.
- **§A2** — `normalizeSymbol` zachowuje `loop` (bug klucza puli overlayów) + niesie
  `offset`; web overlay honoruje loop + offset. Render w przeglądarce do weryfikacji.
- **§A3** — symbol land/win spine triplety eksportują się (`usedAssetIds`);
  `symbolAnimBindings` (spineName/anim/loop/offset + SkeletonDataAsset) serializowane
  w `YggSpinner`; `YggSpineAutoWire.WireSpinnerOverlays` przypisuje SkeletonDataAsset
  po nazwie; `YggSpinner` spawnuje + steruje pulą overlayów w `Fx` (refleksja,
  play-mode, try/catch — degraduje zamiast crashować).
- **§B** — per-symbol offset czasu land/win (wizard + model + web + Unity).
- **§C** — przyciski "set duration" dla klipów spinnera (spin-up / 2s idle /
  until-all-landed) — helpery w `spinnerModel.js`.
- **§D** — pełne pola Spine Animation State Clip (easeIn/out, defaultMixDuration,
  dontPause, dontEnd, clipEndMixOut, *Threshold) w schemacie/inspektorze/eksporcie;
  **§D1 fix mix**: builder wymusza defaultMixDuration=false + useBlendDuration=false
  + jawne mixDuration (domyślnie 0).
- **§E** — warstwy spine sterowane timeline NIE mają starting animation (prefab +
  autowire, gate `spineHasCues`); builder dodaje wiodący pusty klip "hold".
- **§F** — domyślny mix spine = 0 (snap) w eksporcie + runtime `FireSpineCue`.

### Do weryfikacji w Unity
§A3 runtime overlay (refleksja `New*GameObject` + `AnimationState`), nazwy
`template.*` w spine-timeline, render web overlayów.

| Plik (sesja phase 3) | Co zmienione |
|------|-------------|
| `engine/spinner/spinnerRuntime.js` | usunięty punch; overlay honoruje loop + offset |
| `engine/spinner/spinnerModel.js` | `loop`/`offset` w anim; helpery duration (§C) |
| `unity/csharp.js` | `YggSpinner` overlay pool (BuildOverlays/DriveOverlay), `SpinnerSymbolAnimBinding`, parity `SpineCue`/`TryBuildSpineTracks` mix-fix + ease + hold-clip, `FireSpineCue` mix=0, `spineAutoWire` §E + `WireSpinnerOverlays` |
| `unity/exportUnityPackage.js` | eksport symbol spine tripletów; `animBindings`; `spineHasCues` |
| `unity/prefab.js` | `symbolAnimBindings` + nowe pola spine cue; starting-anim gate |
| `unity/bake.js` | parity round 2 pola w `spineCuesForLayer` |
| `engine/sceneModel.js` | parity round 2 pola w `normalizeClip` |
| `components/InspectorPanel.jsx` | UI parity round 2 |
| `components/SpinnerInspectorSections.jsx` | przyciski "set duration" |
| `components/SpinnerWizard.jsx` | inputy offsetu land/win |
| `unity/spinnerTrack.test.mjs` | testy phase 3 (41 pass) |
