# Scene Studio — status po sesji (2026-07-03)

## Direct QoL round 2 (2026-07-04) — plan w `SCENE_STUDIO_QOL_PLAN.md`

Ponowna weryfikacja kodu wykazała, że część zgłoszonych regresji przetrwała
sesję 2026-07-03; nowy plan (T1–T12) koduje poprawki. Realizacja tematami,
w kolejności z §3 planu.

- **T2 — izolacja kanałów crossfade'u + parytet portretu — UKOŃCZONE ✅.**
  `blendTransforms` (`engine/scenarioBlend.js`) dla kanałów NIE opt-in
  trzymał wartość **B** (przychodzącą) zamiast **A** (wychodzącą/carried) —
  crossfade tylko na alfie i tak przesuwał obiekt w chwili wejścia w okno
  mixu (skok do pozy B przy f=0). Naprawione: nieoptowane kanały trzymają A
  przez całe okno; po zakończeniu crossfade'u przychodzący timeline i tak
  przejmuje kontrolę samodzielnie. Dodatkowo `baseTransform` duplikował
  logikę dziedziczenia orientacji zamiast korzystać z
  `orientationManager.resolveTransform` — w portrecie bez override'u czytał
  surowy landscape zamiast pozy centrowanej względem środka sceny, więc pozy
  A/B w blendzie nie zgadzały się z tym, co faktycznie renderuje edytor.
  `resolveLayerTransform`/`buildBlendedScene` przyjmują teraz `stage` i
  przepuszczają je do `resolveTransform`. 5 nowych testów w
  `scenarioBlend.test.mjs` (alfa-only niezmienia pozycji, parytet portretu).
  Pliki: `engine/scenarioBlend.js`, `engine/scenarioTimeline.js` (przekazanie
  `stage`), `engine/scenarioBlend.test.mjs`.

- **T1 — hold jako domyślny tryb nowych krawędzi + audyt carry — UKOŃCZONE ✅.**
  `connect()` (`engine/scenarioModel.js`) zapisuje teraz na nowej krawędzi
  jawny `transition: { mode: 'hold', … }` zamiast `null` — dotąd świeżo
  połączona krawędź czytała się jako `cut` (przez `transitionDefaults()`),
  więc pose-carry (już zbudowany w sesji 2026-07-03) nigdy się nie
  uruchamiał, dopóki artysta ręcznie nie zmienił trybu. `transitionDefaults()`
  **zostaje** przy `cut` — to jest fallback odczytu dla krawędzi bez ładunku
  transition (stare, zserializowane sceny), więc ich zachowanie się nie
  zmienia (mitygacja z §5 planu). Audyt `layerPoseCarryByNode` potwierdził
  poprawną semantykę hold/crossfade/cut (bez zmian w logice — tylko nowe
  testy). Dodatkowo dopięta integracja z idle timeline'ami trybów
  (`sceneSetupTimelines.js`): hold wchodzi z przeniesioną alfą grupy,
  crossfade genuinie ją blenduje (nie skacze) — generyczny mechanizm carry już
  to obsługiwał, nowe testy tylko domykają kontrakt między obydwoma modułami.
  2 zaktualizowane testy (domyślny tryb zmieniony z cut→hold wymagał
  jawnego `cut` tam, gdzie test tego oczekiwał) + 4 nowe w
  `scenarioModel.test.mjs`/`scenarioTimeline.test.mjs`.
  Pliki: `engine/scenarioModel.js`, `engine/scenarioModel.test.mjs`,
  `engine/scenarioTimeline.test.mjs`.

- **T4 (część 1/2) — deterministyczna pętla domyślnej animacji spine na
  scrubie — UKOŃCZONE ✅.** Spine'owe obiekty renderują się z `autoUpdate =
  false` (`spine.autoUpdate = false` w kilku miejscach `pixiApp.js`) — jedyny
  sposób na ruch to jawne `obj.update(dt)`. Podczas PLAY robi to
  `PixiViewport`'owy `drive()` (realny `dtSec` co klatkę, niezależnie od
  `applyFlowAtTime`), więc domyślna/idle animacja (indeks tracka 0, nigdy nie
  celowany przez żaden klip) leci w czasie rzeczywistym. Na PAUSE/scrub
  `applySpineMultiTrack` woła `obj.update(0)` (Faza E) — dt=0 nigdy nie rusza
  tracka 0, więc idle zamrażał się na pozie z momentu pauzy, inny za każdym
  razem. Nowa **Faza C.5**: gdy `layer.spine.defaultAnimation` jest ustawione
  i żaden klip nigdy nie celuje w indeks 0, trzymamy go jawnie —
  `tr.trackTime = t % duration` (pętla od startu flow, 1×) — deterministyczne
  dla dowolnego seeku. Brak harnessu testowego dla Pixi/Spine runtime
  (`pixiApp.js` nie ma plików `.test.*`) — zweryfikowane przez
  `npm run build` (przechodzi bez błędów) + przegląd kolejności faz
  (nowa faza dopisuje `seen.add(0)` PRZED czyszczącą Fazą D, żeby nie
  zgasić się samą sobie). Wizualna weryfikacja w przeglądarce z prawdziwym
  assetem Spine — TODO, nie wykonana w tej sesji.
  Plik: `engine/pixiApp.js` (`applySpineMultiTrack`).
- **T4 (część 2/2) — kontrakt widoczności "setup pose", zakres:
  spinner/winseq — UKOŃCZONE ✅.** Dwa pytania do użytkownika w tej sesji
  ustaliły zakres: reguła z planu ("brak aktywnego klipu w animate/direct →
  alpha 0") dosłownie zastosowana do KAŻDEGO typu layera zgasiłaby każdy
  statyczny PNG/spine w tle, którego nikt nigdy nie skluczował (typowy
  przypadek w większości scen) — to odwróciłoby udokumentowaną regułę z
  `SCENE_STUDIO.md` §19.2 dla zwykłych obiektów. Zawężone do dokładnie tego,
  co opisuje problem #5 planu: **spinner** (bez żadnego autorowanego klipu
  spinu) i **winseq** (bez żadnego autorowanego flow) renderują się teraz z
  `alpha = 0` w animate/direct, jeśli żaden ich track nie wystartował klipu do
  czasu `t` — `layerHasDrivingClip` (nowy, czysty helper w
  `engine/flowInterpreter.js`, 4 testy). Carry-in board (Direct hold/crossfade,
  T1) nadal liczy się jako "driven" nawet gdy lokalny timeline segmentu nie ma
  własnego klipu. Baked crossfade blend (`buildBlendedScene`, T1/T2) ma pusty
  `flow.tracks` z założenia — oflagowany `scene.__isBakedBlend` i zwolniony z
  bramki, inaczej każdy spinner/winseq znikałby w oknie miksu. Zwykłe PNG/
  spine/video **zachowują dotychczasową regułę** (niesklucza pozycja = base
  pose widoczna) — bez zmiany workflow dla statycznych dekoracji.
  Część reguły dot. **grup trybów** (base/bonus/freespins/pick) świadomie
  odłożona do T6 — to ten sam mechanizm alpha-propagation, plan sam sugeruje
  robić kompozycję alfy raz, nie fragmentarycznie.
  Pliki: `engine/flowInterpreter.js` (+ nowy `flowInterpreter.test.mjs`),
  `engine/pixiApp.js` (spinner/winseq branch w `applyFlowAtTime`),
  `engine/scenarioBlend.js` (`__isBakedBlend` flag + test).

- **T6 — grupy trybów: naprawa propagacji alfy — UKOŃCZONE ✅.** Realny bug,
  nie brak funkcji: warstwy typu `empty` (root Scene Setup + kontenery grup
  trybów Free Spins/Bonus/Pick&Click, tworzone już z sesji 2026-07-03) w ogóle
  nie miały gałęzi w dispatchu `applyFlowAtTime` (`engine/pixiApp.js`) — więc
  ich alfa nigdy nie była odświeżana z klipu podczas animate/direct/scrubu,
  zostawała zamrożona na wartości bazowej wpisanej przez `syncTransforms`
  (0 dla grupy trybu, która akurat nie jest edytowana). Wygenerowane w T1
  timeline'y „<Tryb> Idle" (klucz alfy per grupa) więc **nigdy realnie nie
  działały** poza jednorazowym sync-em. Pixi i tak kaskaduje alfę kontenera
  do dzieci naturalnie (potwierdzone: `buildNode` w `rebuildScene` zagnieżdża
  Pixi-obiekty dzieci pod obiektem rodzica przez `parentId`, prawdziwe drzewo,
  nie płaska lista) — brakowało tylko odświeżania alfy SAMEGO kontenera co
  klatkę. Naprawa: `applyPngChannels` (generyczny, działa na dowolnym typie
  obiektu Pixi) uruchamia się teraz też dla `asset.type === 'empty'`.
  Base Game świadomie **nie** dostaje własnego kontenera (leży bezpośrednio
  pod rootem, zawsze aktywny — decyzja z sesji 2026-07-03, nie zmieniana).
  Brak migracji danych — czysty fix dispatchu runtime, zero zmian w kształcie
  sceny. Jak w T4(1/2): brak harnessu testowego dla `pixiApp.js`; zweryfikowane
  przez `npm run build` + przegląd strukturalny (Pixi-hierarchia potwierdzona
  czytaniem `buildLayerTree`/`buildNode`). Wizualna weryfikacja w przeglądarce
  — TODO.
  Plik: `engine/pixiApp.js` (`applyFlowAtTime`).

- **T5 — model widoczności „oko" (zamiast enable/disable) — UKOŃCZONE ✅.**
  Checkbox w hierarchii zamieniony na przycisk oka (👁/🙈,
  `components/HierarchyPanel.jsx`). Semantyka: `effectiveAlpha =
  min(inspectorAlpha, eyeAlpha)` (eyeAlpha ∈ {0,1}) — zamknięcie oka NIGDY nie
  nadpisuje `layer.transforms.*.alpha`; pole danych `layer.visible` zostaje
  bez zmian, zmienia się tylko jego runtime'owa kompozycja. **Brak ścieżki
  hard-disable**: `pixiApp.js` przestał ustawiać `obj.visible = false` —
  `obj.visible` jest teraz zawsze `true`, a bramkowanie idzie WYŁĄCZNIE przez
  finalną alfę (`gateEyeAlpha()` w `applyFlowAtTime`, analogiczny fix w
  `syncTransforms` i buildzie w `rebuildScene`). To naprawia realny bug:
  wcześniej ukryty obiekt Spine/spinner/winseq CAŁKOWICIE przestawał być
  przetwarzany (wczesny `continue`), więc po ponownym odkryciu pokazywał
  zamrożoną pozę sprzed ukrycia zamiast aktualnego stanu timeline'u.
  **Decyzja użytkownika w tej sesji: zamknięte oko SERIALIZUJE się w
  eksportach jako „start ukryty"** (nie tylko w edytorze). Eksport Unity
  (`unity/exportUnityPackage.js`): `active` GameObjectu jest teraz zawsze
  `true` (był `layer.visible !== false` — twardy SetActive, dokładnie ta
  hard-disable ścieżka, której T5 zabrania), zamknięte oko piecze `alpha = 0`
  w komponent `SpriteRenderer`/`Image`/`CanvasGroup`. Otwarty temat (mały,
  świadomie odłożony — patrz `SCENE_STUDIO.md` §20.12): world-mode GRUPA z
  zamkniętym okiem zeruje tylko WŁASNĄ alfę węzła, nie potomków —
  SpriteRenderer nie ma odpowiednika `CanvasGroup`, więc pełna kaskada
  wymaga mnożenia alfy przodków przy pieczeniu (mały task, nie zgadywany na
  ślepo bez realnego importu do Unity). Brak harnessu testowego dla
  `pixiApp.js`/`exportUnityPackage.js` — zweryfikowane `npm run build` +
  pełny zestaw testów silnika/unity (146 testów, zero regresji) + przegląd
  strukturalny. Wizualna weryfikacja w przeglądarce — TODO (jak T4/T6).
  Pliki: `components/HierarchyPanel.jsx`, `styles/scene-studio.css`,
  `engine/pixiApp.js` (`applyFlowAtTime`, `syncTransforms`, `rebuildScene`),
  `unity/exportUnityPackage.js`, `SCENE_STUDIO.md` §20.12 (nowa sekcja).

- **T3 — przeciąganie klipów na osi czasu: mijanie sąsiada — UKOŃCZONE ✅.**
  Stary `neighbourBounds` blokował ruch klipu na sztywnej ścianie zakotwiczonej
  w POZYCJI STARTOWEJ przeciągania — sąsiad nigdy nie dawał się minąć. Nowy
  pipeline **intent → resolved placement → commit**: podczas przeciągania
  (`onPointerMove`, tryb `move`) klip leci swobodnie za kursorem (jedyne
  ograniczenie to granice sceny `[0, duration]`), tymczasowo nakładając się
  na sąsiadów — to celowe, inwariant braku nakładania egzekwowany jest
  wyłącznie **raz, przy puszczeniu** (`onPointerUp`). Resize (`resizeStart`/
  `resizeEnd`) NIE dostał tej zmiany — nadal blokuje się na sąsiedzie (mijanie
  przez resize to inna, nieproszona semantyka). Czysta logika wydzielona do
  nowego `engine/timelineDragResolve.js` (`neighbourBounds` — nazwana,
  reużywalna wersja starej funkcji; `resolveClipDrop` — nowy iteracyjny
  „de-penetration" resolver: pcha klip poza NAJBARDZIEJ nakładającego się
  sąsiada, kierunek po porównaniu środków, z detekcją cyklu jako
  deterministycznym fallbackiem dla dosłownie niemożliwego do rozwiązania
  „ściśnięcia" między dwoma sąsiadami bliższymi sobie niż własna długość
  przeciąganego klipu). **Pierwsza wersja algorytmu (`neighbourBounds`
  zakotwiczony w POZYCJI UPUSZCZENIA) była błędna — cichy no-op, bo ta
  funkcja z założenia ignoruje sąsiadów faktycznie nakładających się na okno
  kotwicy — złapane przez 3 padające testy przed wysyłką, nie w produkcji.**
  8 testów w nowym `engine/timelineDragResolve.test.mjs` (w tym test
  determinizmu dla przypadku ściśnięcia). Brak harnessu dla samego pointer-
  event wiring w `TimelinePanel.jsx` (żaden istniejący plik testowy) —
  zweryfikowane `npm run build` + pełny zestaw silnika (127 testów). Jak
  poprzednie tematy: **wizualna weryfikacja przeciągania w przeglądarce
  (manual interaction checklist, jak zaleca sam plan) — TODO**, to
  najbardziej ryzykowny temat całego planu (dense pointer logic).
  Pliki: `engine/timelineDragResolve.js` (+ test), `components/TimelinePanel.jsx`.

- **T12 — reużywalna randomizacja wyniku spinu (re-roll) — UKOŃCZONE ✅.**
  `targetBoardForClip` (`engine/spinner/spinnerModel.js`) liczył seed planszy
  outcome jako czystą funkcję `(clip.id, outcome)` — bez sposobu na
  wylosowanie INNEJ planszy w tej samej kategorii progu. Dodany
  `rerollSeed`/`outcomeOverrideReroll` wchodzi do hasha
  (`clip.id::outcome::reroll`), więc „re-roll" to po prostu bump licznika.
  **Priorytet**: override Direct-mode (per-węzeł) > własny `spinner.outcome`
  klipu (NOWA zdolność — dotąd klip timeline'u nie miał progu wyniku wcale,
  tylko `randomResult`/`targetBoard`) > jawnie autorowana plansza > seedowana
  nie-wygrywająca. Trzy powierzchnie, jedna implementacja:
  - **Węzeł reżysera** (`ScenarioInspectorSections.jsx`) — przycisk „🎲
    Re-roll" przy selektorze „Result", bumpuje `entry.spinOutcomeReroll`
    (nowe pole w `entryDefaults()`/`normalizeEntry()`).
  - **Klip spinnera na osi czasu** (`SpinnerInspectorSections.jsx`) — nowy
    selektor „outcome" + „🎲 Re-roll" na `clip.spinner.outcome`/`rerollSeed`
    (checkbox „random result" i target-board grid wyłączone, gdy outcome
    aktywny — jawnie skomunikowane w UI).
  - **Podgląd kreatora** (`SpinnerWizard.jsx`) — selektor + re-roll nad
    „test spin", `buildSpinnerTestClips(config, outcome, rerollSeed)`.
  Przepięte przez cały łańcuch: `resolveSpinnerTrack`/`spinnerResolveKey`
  (nowy param `outcomeReroll` w kluczu memo — inaczej re-roll nie
  wymusiłby ponownego resolve'u), `scenarioTimeline.js`
  (`seg.spinOutcomeReroll`), `SceneStudioInner.jsx`
  (`scene.__spinnerOutcomeReroll`, oba miejsca: `directPreview` i eksport
  wideo), `pixiApp.js`/`spinnerRuntime.js` (`applySpinnerAtTime`).
  8 nowych testów w `spinnerEval.test.js` (w tym: klip-autorowany outcome bez
  override'u Direct, override nadal wygrywa nad klipem, re-roll klipu
  własnym polem, re-roll override'u zmienia planszę I resolve key,
  `buildSpinnerTestClips` niesie payload poprawnie). **Złapana i naprawiona
  po drodze regresja**: dodanie `spinOutcomeReroll` do `entryDefaults()`
  wywaliło istniejący `deepEqual` test w `scenarioModel.test.mjs` — zauważone
  przez pełny przebieg zestawu przed commitem, nie po.
  Pliki: `engine/spinner/spinnerModel.js`, `engine/spinner/spinnerEval.js`,
  `engine/spinner/spinnerRuntime.js`, `engine/scenarioModel.js`,
  `engine/scenarioTimeline.js`, `SceneStudioInner.jsx`,
  `components/ScenarioInspectorSections.jsx`,
  `components/SpinnerInspectorSections.jsx`, `components/SpinnerWizard.jsx`,
  `engine/spinner/spinnerEval.test.js`, `engine/scenarioModel.test.mjs`.

- **T10 — selektor wager w inspektorze win-timeline — UKOŃCZONE ✅.**
  Dotąd wager istniał tylko wewnątrz kreatora (krok Sequences) i był
  ZAWSZE trwały (`winseqConfig.number.wager`) — nie dało się szybko
  podejrzeć „jak wygląda ta sekwencja przy wagerze 100" bez wejścia w
  kreator i trwałej zmiany configu. Nowy **preview-only override**:
  `ClipSection` (`components/InspectorPanel.jsx`) pokazuje pole „preview
  wager" przy zaznaczonym klipie winseq — DragNumberField + przyciski
  „Apply as authored wager" / „Revert preview" pojawiają się tylko gdy
  wartość różni się od autorowanej. Stan efemeryczny w
  `SceneStudioInner.jsx` (`wagerPreview`, resetowany przy zmianie
  zaznaczenia), wpięty do `sceneWithRuntime` jako `scene.winNumberPreview.
  {wager, forAssetId}` — **zakotwiczony do konkretnego assetu winseq**, żeby
  podgląd jednej sekwencji nie przeciekał do innych win-numberów w scenie.
  `winNumberRuntime.applyWinNumberAtTime` dostał nowy param `wagerOverride`
  (podmienia `num.wager` wyłącznie w wywołaniu `winNumberValueAt` — nigdy nie
  dotyka configu), `pixiApp.js` czyta go z `scene.winNumberPreview` z tym
  samym scope-guardem co strona wagi. Reużywa dokładnie ten sam
  `winNumberValueAt` co kreator (SPINNER.md-analogiczna zasada „jedna
  implementacja"). **Złapany i naprawiony w trakcie: zagnieżdżenie
  fragmentów JSX** — pierwsza wersja edycji zostawiła podwójne
  zamknięcie `</></> )}` po wydzieleniu bloku do IIFE, `npm run build`
  złapał to jako błąd parsera esbuild przed testami, nie po.
  Pliki: `components/InspectorPanel.jsx`, `SceneStudioInner.jsx`,
  `engine/winseq/winNumberRuntime.js`, `engine/pixiApp.js`.

- **T11 — eksport WebM: tryb „watch the render" — UKOŃCZONE ✅.**
  Okazało się, że problem #11 nie był brakiem mechanizmu, tylko tym, że
  ISTNIEJĄCY mechanizm był zasłonięty: `PixiViewport.exportVideo()` (już
  wcześniej) rysuje eksport bezpośrednio na TYM SAMYM, żywym `app.canvas` co
  edytor (`app.renderer.resize(outW, outH, 1)` + rendering w miejscu, patrz
  „enter export mode" w `exportVideo`) — sceny NIGDY nie renderowało się
  „w tle" osobno. Jedyny problem: `WebMExportDialog.jsx` renderował się jako
  pełnoekranowy, nieprzezroczysty overlay (`position:fixed; inset:0`)
  zasłaniający cały viewport przez cały czas eksportu, więc live-render był
  fizycznie zakryty własnym oknem dialogowym. Naprawa: nowy toggle „show the
  scene view while exporting" (domyślnie ON, `watchRender`, persystowany w
  localStorage jak reszta ustawień) — kiedy aktywny eksport (`busy`) I
  `watchRender` jest włączony, dialog renderuje się jako mały, nieblokujący
  HUD przypięty w rogu (progress bar + „frame X/Y" + cancel) zamiast
  pełnoekranowego scrim, więc scena (i jej żywy capture) jest w pełni
  widoczna pod spodem. Ustawienia i tak są zablokowane podczas eksportu
  niezależnie od trybu — zmienia się wyłącznie kształt/pozycja overlaya.
  Cancel/retry bez zmian (ten sam handler w obu wariantach). `PixiViewport.jsx`
  **nie wymagał zmian** wbrew wskazaniu w planie — mechanizm „na żywym
  canvasie" już tam był, brakowało tylko nie-zasłaniania go.
  Plik: `components/WebMExportDialog.jsx`.

- **T9 — zaostrzenie detekcji fontu win-number — UKOŃCZONE ✅.**
  `looksLikeFont` (regex po nazwie: win/font/number/num) auto-bindował
  PIERWSZE trafienie po nazwie w `fontPool`, bez żadnej weryfikacji wymiaru —
  PNG nazwany np. „win_bg.png" (tło, nie atlas fontu) wygrywałby cicho.
  Nowa reguła (dwuwarunkowa): kandydat musi PRZEJŚĆ nazwę PONAD tym
  spełniać szerokość **2048px** (8 kolumn × 256px/cell — stała
  `FONT_ATLAS_WIDTH`/`isFontAtlasWidth`, przeniesiona do
  `engine/winseq/winNumberModel.js` dla testowalności; wysokość NIE jest
  sprawdzana — zależy od liczby wierszy glifów). Auto-pick w
  `WinSequenceWizard.jsx` stał się asynchroniczny: dla każdego kandydata
  nazwanego jak font ładuje obrazek (`probeImageDims`, cache po `src`) i
  sprawdza szerokość PRZED związaniem; pierwszy kandydat, który przejdzie
  OBA warunki, wygrywa. Żaden kandydat nie przechodzi → fallback do
  wbudowanego szablonu + **odznaka „⚠ unverified"** w dropdownie przy
  pierwszym kandydacie nazwanym-ale-niezweryfikowanym (plus notka pod
  selectorem) — artysta widzi, że coś wygląda jak font, ale wymaga ręcznego
  potwierdzenia, zamiast cichego złego auto-bindu. 1 nowy test w
  `winNumberModel.test.mjs` (czysty helper `isFontAtlasWidth`) — sam pipeline
  ładowania obrazków w komponencie wizarda nie ma harnessu (async + DOM
  `Image()`), zweryfikowane przez `npm run build` + pełny zestaw (159
  testów, zero regresji).
  Pliki: `engine/winseq/winNumberModel.js` (+ test),
  `components/WinSequenceWizard.jsx`.

- **T7 (część 1/4) — zaostrzenie pewności kandydatów symboli —
  UKOŃCZONE ✅.** Duża część T7 („structured folder preference, stronger
  UI/bg/machine exclusion") okazała się JUŻ zaimplementowana wcześniej
  (`detectSymbolsStructure`, `symbolScore` z bogatym systemem +/− sygnałów w
  `SpinnerWizard.jsx`) — brakującym kawałkiem był wyłącznie **próg pewności**:
  `buildCandidates` wymagał tylko `symbolScore(a) > 0` (dowolny słaby
  pozytywny sygnał, np. samo leżenie w folderze „Blurred" bez żadnej innej
  poszlaki, +4) do cichego dodania do bulk-fill. Nowy
  `SYMBOL_CONFIDENCE_THRESHOLD = 8` (`engine/spinner/symbolMatch.js` —
  `symbolScore`/`isConfidentSymbolMatch` przeniesione tam z komponentu dla
  testowalności) — „fill from assets" bierze tylko pewne trafienia; słabe
  (>0 ale <próg) trafiają do osobnej listy `weakCandidates` pokazanej jako
  ostrzeżenie z nazwami zamiast cichego pominięcia LUB cichego dodania.
  10 nowych testów w `symbolMatch.test.mjs`.
  **Pozostałe 3/4 T7 (kolejność kroków „asset-selection-first", pipeline
  animations-only z auto-generacją blura, „hold last pose" po prezentacji
  wygranej) to projektowanie UX/nowa funkcjonalność, nie bugfix** — nie mają
  jednoznacznej „poprawnej" odpowiedzi wyczytywalnej z kodu tak jak pozostałe
  10 tematów w tej sesji; odłożone do sesji z iteracją wizualną w przeglądarce
  (patrz też T8 poniżej — ta sama kategoria ryzyka).
  Pliki: `engine/spinner/symbolMatch.js` (+ test), `components/SpinnerWizard.jsx`.

- **T8 (część 2/2, dająca się wykonać teraz) — ujednolicenie powłoki
  kreatorów — UKOŃCZONE ✅.** Panel kreatora był JEDYNYM panelem w apce z
  twardo zakodowaną szerokością (`WIZARD_PANEL_W = 460`, stała, bez uchwytu
  resize, bez persystencji) — złamanie tego samego mechanizmu, który już
  obsługuje `leftW`/`rightW`/`timelineH`. Naprawione: `PANEL_SIZES.wizard`
  (`def:460, min:320, max:760`, klucz localStorage), stan `wizardW` +
  uchwyt resize identyczny jak dla panelu inspektora (ten sam
  `beginPanelResize`). **Złapany przy okazji, dokładnie „scena wizard
  currently diverges" z opisu T8**: `SceneSetupWizard.jsx` przyjmował prop
  `embedded` (używany do innej logiki — podłączenia podglądu), ale NIGDY nie
  dokładał klasy `spinner-wizard--embedded` do korzenia — więc renderował się
  z bazowej klasy `.spinner-wizard` (`width: 520px` na sztywno + border/
  shadow/radius w stylu modala) zamiast rozciągać się na 100% szerokości/
  wysokości doku jak Spinner/WinSequence wizard. Jeden dopisek klasy,
  identyczny wzorzec jak w pozostałych dwóch kreatorach.
  **Nie zrobione**: „spinner animation-setup step expands to fill the panel"
  — ten krok to część NIEZBUDOWANEGO jeszcze pipeline'u animations-only z
  T7 (3/4); nie ma czego naprawiać, dopóki ten krok nie istnieje.
  Pliki: `SceneStudioInner.jsx`, `components/SceneSetupWizard.jsx`.

## Live-update refactor — edycje bez pełnego rebuildu Pixi (2026-07-04)

Główny ból UX: zbyt wiele zwykłych edycji (defaulty spine, loop/mute wideo,
timing spinnera, tiery/formatowanie winseq) wywoływało pełny `rebuildScene`.
Plan + inwentarz triggerów: `~/.claude/plans/scene-studio-refactor-minimize-*.md`
(deliverables A–G). Zaimplementowana faza 1+2:

- **Nowy moduł `engine/structuralHash.js`** (czysty, testowalny pod node):
  `sceneStructuralParts/Hash` — hash rebuildu obejmuje TYLKO prawdziwą
  topologię/tożsamość zasobów: canvasy (+ **`activeCanvasId` — bugfix**, wcześniej
  przełączenie aktywnego canvasu nie robiło rebuildu), asset id/type/src
  (src z **długością** w sygnaturze — same 32 znaki data-URL-a to głównie
  wspólny nagłówek), spine/winseq atlas+texture, winnumber parent, kolejność +
  parentage warstw, **`spinnerStructuralSig`** (liczba reels×rows + zestaw
  symboli + spec animacji land/win — czyli TOPOLOGIA kontenerów; rozmiar
  komórki i spacing to geometria, którą `relayoutSpinnerGeometry` przeskalowuje
  na zbudowanych kontenerach NA ŻYWO — maska, offsety, pozycje reelów) i
  **`winseqNumberSig`** (fontSrc/cell/cols/rows/charLayout — glify pieczone w
  `buildWinNumberContainer`; wcześniej `charLayout/cell/cols/rows` W OGÓLE nie
  były w hashu — druga cicha luka). **USUNIĘTE z hashu**: `JSON(l.spine)`,
  `JSON(l.video)`, `spinner.rev`, `winseq.rev` — bumpy rev z kreatorów są od
  teraz obojętne dla rebuildu (persystencja bez zmian). Efekt uboczny: znika
  **podwójny rebuild** po każdym Apply spinnera (`handleSpinnerAnimDurations`
  bumpował rev po pierwszym buildzie → drugi build).
- **Nowy pass `applyRuntimeConfigs(handles, scene, studioMode)`**
  (`engine/pixiApp.js`), wołany na początku cheap-patha we
  `PixiViewport.jsx` (oraz po commit'cie rebuildu, na wypadek edycji w trakcie
  async builda). Strażnicy tożsamości referencji (stan sceny jest immutable) →
  zero pracy, gdy nic się nie zmieniło. Patche na żywo:
  - `layer.spine` → w setup pełny re-apply `applySpineState`
    (anim/loop/skin; jawny reset do skina domyślnego — `applySpineState`
    pomija pusty skin), w animate/direct tylko skin (anim/loop ma Phase C.5,
    defaultMix i tak re-sync per frame);
  - `layer.video` → `loop`/`muted` prosto na HTMLVideoElement;
  - `asset.spinner` → swap `sp.config` + nowa `symbolMap` + `resolveKey=null`
    (timing/blur/strips/board/events/seed/direction/perReel re-resolwują się
    przy następnym `applySpinnerAtTime`); w setup re-poza planszy `t=0`;
  - `asset.winseq` → swap `__winseq.config` (tiery/setupPose) + reset
    `__wsCache`; w setup re-apply `applyWinSeqSetupPose`.
  Swap jest POMIJANY, gdy sygnatura strukturalna się różni (taka edycja i tak
  zbumpowała hash — rebuild w kolejce; live-patch niezgodnego grida na żywe
  reelViews crashowałby pętlę komórek).
- **Deps**: cheap-path effect dostał `scene.assets` (edycje samego asseta —
  np. kreator winseq — nie zmieniają tożsamości `scene.layers`); memo hashu
  dostał `scene.canvases` + `scene.activeCanvasId`.
- **Diagnostyka**: `window.__sceneStudioDiag` = `{ rebuilds, livePatches,
  lastRebuildMs, lastReason }`; przy każdym rebuildzie diff części hashu
  (`diffStructuralParts`, wykrywa też czysty reorder) + przyczyny spoza hashu
  (manual refresh / workspace root / remount) → `console.info` (dev) i `onDiag`
  (`?debug=1`). Kryterium akceptacji: edycje z listy „LIVE" nie ruszają
  licznika `rebuilds`.
- **Ręczny refresh bez zmian**: przycisk „refresh assets" (`refreshNonce`)
  pozostaje jedyną ścieżką cache-bust + wymuszonego rebuildu.

**Runda review (agenci A–D, 8 kątów) — naprawione przed zamknięciem sesji:**
- swap configu spinnera gubił zmierzone długości animacji land/win (żyły tylko
  w zbudowanym configu — preview kreatora nigdy ich nie persystuje) → carry-over
  durations przy swapie;
- strażnik strukturalny porównywał z poprzednim RAW configiem zamiast z
  sygnaturą, z którą obiekt FAKTYCZNIE zbudowano (`sp.structSig`/`ws.numSig`
  stemplowane przy buildzie) — odporność na upadły/wyprzedzony rebuild;
- wyczyszczenie `defaultAnimation` w pauzie animate zostawiało pozę zamrożoną
  w połowie fade'u 0.1s (Phase D pod `update(0)`) → snap-clear slotu
  `__default__` z pustą animacją 0s;
- edycja samego `defaultMix` nie rusza już skeletonu (pop pozy przy pauzie) —
  patch pozy tylko gdy zmienił się anim/loop/skin;
- włączenie `loop` na wideo, które już się SKOŃCZYŁO, restartuje odtwarzanie
  (stary rebuild wołał `play()`; samo `loop=true` nie wznawia);
- **kreator spinnera: debounce 150ms przywrócony dla pól STRUKTURALNYCH**
  (liczba reels/rows + zestaw symboli) — po uśmierceniu `rev` w hashu
  drag-scrub tych pól rebuildowałby per klawisz (ryzyko crasha rapid-rebuild
  Pixi v8, §20.10); cała reszta (cellW/cellH/spacing → live relayout geometrii,
  timing/blur/board → live patch) omija debounce i działa od razu;
- diagnostyka: przyczyny rebuildu akumulują się do commitu builda (wyprzedzone
  buildy nie fałszują `lastReason`); fast-path tożsamości sceny w
  `applyRuntimeConfigs` (bez budowy Map per tick playbacku); nieaktualne
  komentarze o „rev → rebuild" zaktualizowane (WinSequenceWizard,
  handleSpinnerAnimDurations).

Nowy test `engine/structuralHash.test.mjs` (17 checków: co NIE jest
strukturalne — transformy/flow/spine/video/runtime spinnera i winseq — i co
JEST: src/atlas/reorder/reparent/canvas/grid/glify/parent). Wszystkie suity
silnika + build zielone. **Wizualna weryfikacja w przeglądarce (edycja
defaultów spine w setup, timing spinnera w kreatorze, tiery winseq na żywo) —
TODO, nie wykonana w tej sesji.**

Pliki: `engine/structuralHash.js` (+ test, nowe), `engine/pixiApp.js`,
`engine/spinner/spinnerRuntime.js` (rawRef), `components/PixiViewport.jsx`,
`components/SpinnerWizard.jsx` (bakedStruct), `components/WinSequenceWizard.jsx`
(komentarz), `SceneStudioInner.jsx` (komentarz).

## T7 (2–4/4) — pipeline animations-only dla symboli spinnera (2026-07-04)

Po teście poprzedniej sesji użytkownik doprecyzował: kreator ma domyślnie
proponować **animacje jako główny workflow** (pomijając statyczny art), z
idle/landing pozą = pierwsza klatka animacji landing (fallback win), a po
prezentacji wygranej symbol **trzyma ostatnią policzoną pozę** zamiast
wracać do statyku. Zaimplementowane:

- **Model (`engine/spinner/spinnerModel.js`)**: nowe, **jawne** pole
  `symbol.animOnly` (domyślnie `false`). Celowo NIE wywnioskowane z braku
  `assetId` — symbol bez statyku w trakcie authoringu (albo istniejący
  fixture testowy) nie może po cichu włączyć timingu „trzymaj wygraną w
  nieskończoność". Złapane przez 3 padające testy regresji przed commitem
  (`makeDurConfig`'s fixture'y nie mają `assetId` z powodów niepowiązanych z
  T7 — dokładnie ten przypadek, którego `animOnly` jako jawna flaga ma
  unikać).
- **Ewaluator (`engine/spinner/spinnerEval.js`)**: `isAnimOnlySymbol(id)` po
  `symMap.get(id).animOnly === true` — dla takich symboli okno „win" nie ma
  górnej granicy (`winEnd = Infinity`), więc `cellState` zostaje `'win'`, aż
  ten reel znów zacznie się kręcić (`speed > EPS_V`, warunek już istniejący).
  Spine z `loop:false` naturalnie zamraża się na ostatniej klatce (wbudowane
  zachowanie AnimationState), `loop:true` po prostu pętli się w spoczynku —
  oba wyniki są poprawną interpretacją „trzymaj policzoną pozę".
- **Runtime (`engine/spinner/spinnerRuntime.js`)**: `bakeSpinePoseTexture` —
  dla symbolu bez `assetId`, ale z rozwiązywalną animacją land/win typu
  `spine`, buduje TYMCZASOWY obiekt Spine (przez istniejącą fabrykę
  `createSpineContainer`), pozuje go na klatce 0, i **piecze prawdziwą
  teksturę** przez `renderer.generateTexture()` (+ wariant blur przez
  `pixi.js`'s `BlurFilter`) — wstawioną do TEJ SAMEJ mapy `textures`, którą
  normalnie wypełniają statyczne PNG-i. Zero zmian w pętli per-klatkowej:
  `cell.staticSprite.texture = texPair.tex` po prostu dostaje upieczoną
  teksturę zamiast załadowanego PNG-a.
  **Świadomie odrzucona alternatywa**: żywy, stale-aktualizowany obiekt Spine
  per komórka idle. Pula nakładek land/win jest CELOWO ograniczona (≤12
  instancji — koszt renderowania Spine per-instancję), a komórek w spoczynku
  na typowej planszy jest więcej niż 12 — pieczenie do tekstury to jedyne
  podejście skalujące się do „każda spoczywająca komórka".
- **Kreator (`components/SpinnerWizard.jsx`)**: nowa `autoFillFromAnimations`
  — jeden symbol na plik Spine (konwencja „jeden rig = land+win w środku"),
  statyk dobierany PO NAZWIE jako opcjonalne wzbogacenie
  (`findStaticForSymbol`, odwrotność istniejącego `findSpineForSymbol`).
  To nowy, **PIERWSZY/primary** przycisk w kroku Symbols (statyki zdegradowane
  do drugiego, ghost-button). **Auto-uruchamia się przy otwarciu świeżego
  kreatora** (bez `existingConfig`, bez ręcznie dotkniętych symboli), gdy
  wykryto assety Spine — ten sam wzorzec „auto-suggest, pozwól nadpisać" co
  auto-pick fontu w `WinSequenceWizard`.
  **Nie zrobione z T7**: literalna zamiana kolejności kroków (Grid↔Symbols) —
  użytkownik po doprecyzowaniu skupił się na DOMYŚLNYM PIPELINE, nie na
  numeracji kroków, więc to zostało tak jak jest; „auto-generate blur" z
  oryginalnego opisu planu zaimplementowane jako prosty `BlurFilter` z
  pixi.js (nie pełny pipeline ImageMagick app'u, jak w innych Art Tools) —
  wystarczające do podglądu web, gorszej jakości niż ręcznie robiony blur.
- **⚠ ZNANA LUKA — parytet Unity**: eksporter Unity (`unity/exportUnityPackage.js`)
  już gracefully obsługuje `sym.assetId === null` (`staticGuid: null`), więc
  export się NIE wywali — ale strona C# (`YggSpinner.cs`) nie ma odpowiednika
  „upiecz teksturę z pozy Spine'a" ani „trzymaj ostatnią pozę po wygranej" —
  symbol animations-only pokaże się poprawnie w web preview, ale w Unity
  runtime prawdopodobnie nie będzie miał żadnej statycznej tekstury spoczynkowej
  w ogóle. Wymaga osobnej sesji nad C#, świadomie nie zgadywane na ślepo.

3 nowe testy w `spinnerEval.test.js` (`animOnly` default/preserved + hold-win
behavior kontrastowany z symbolem zwykłym w tym samym configu). 131 testów
silnika, 27 unity, zero regresji. Brak harnessu dla `bakeSpinePoseTexture`
(Pixi renderer, `generateTexture`, `BlurFilter`) — zweryfikowane wyłącznie
przez `npm run build` i przegląd strukturalny; **wizualna weryfikacja w
przeglądarce (czy pieczona tekstura się poprawnie centruje/skaluje względem
komórki) — TODO, nie wykonana w tej sesji.**

Pliki: `engine/spinner/spinnerModel.js`, `engine/spinner/spinnerEval.js` (+
test), `engine/spinner/spinnerRuntime.js`, `engine/pixiApp.js` (przekazanie
`renderer` do `buildSpinnerObject`), `components/SpinnerWizard.jsx`.

## Poprawki po testach użytkownika (2026-07-04, po sesji T1–T9)

Dwa realne bugi zgłoszone po ręcznym przetestowaniu poprzedniej sesji:

- **Spinner/winseq znów ZAWSZE widoczne (cofnięcie części T4).** Zaimplementowana
  wcześniej reguła „brak klipu → alpha 0 w animate/direct" była błędną
  interpretacją wyjątku z planu — w praktyce **kasowała planszę spinnera w
  Director za każdym razem, gdy węzeł jeszcze nie zaczął spinu** (typowy stan:
  węzeł wejściowy przed pierwszym stopSpin). Użytkownik jednoznacznie
  potwierdził po teście: spinner/winseq mają być **wyjątkiem od JAKIEJKOLWIEK
  reguły „niesterowany = niewidoczny"** — zawsze pokazują realną planszę
  (initial/carried/wylądowaną), we WSZYSTKICH trybach, bez wyjątku. Usunięte:
  bramka alfy w `applyFlowAtTime` dla `spinner`/`winseq`, martwy już
  `layerHasDrivingClip` (`engine/flowInterpreter.js` + jego plik testowy —
  usunięte, nieużywane nigdzie indziej), flaga `__isBakedBlend`
  (`scenarioBlend.js`, istniała wyłącznie dla tej bramki).
- **Spine w setup mode naprawdę animuje idle, nie tylko na scrubie.** Osobny,
  nieprzetestowany wcześniej bug: `applyFlowAtTime` (gdzie siedział Phase C.5,
  fix na deterministyczny idle-loop) **nigdy nie jest wołane w trybie setup**
  — jedyny mechanizm animujący Spine'a w ogóle to `PixiViewport`'owa pętla
  `drive()` (realny `obj.update(dtSec)` co klatkę), bramkowana warunkiem
  `runtime.playing !== false` — a w setup `flowState.playing` domyślnie jest
  `false` (nie ma czego „grać"), więc spine zamrażał się na pozie z buildu.
  Naprawa: `drive()` tika Spine'y bez warunku play/hold, kiedy
  `studioMode === 'setup'` — setup pokazuje żywy, zapętlony podgląd domyślnej
  animacji niezależnie od stanu odtwarzania timeline'u (który w setup i tak
  nie istnieje).

Pliki: `engine/pixiApp.js`, `components/PixiViewport.jsx`,
`engine/scenarioBlend.js` (+ test), `engine/flowInterpreter.js` (usunięcie
`layerHasDrivingClip` + jego pliku testowego). 128 testów silnika (było 132 —
4 usunięte razem z martwym kodem), 27 unity, zero regresji.

## Direct: hold/crossfade pose carry + outcome spinów + QoL transportu — UKOŃCZONE ✅ (2026-07-03)

Duża sesja QoL wg punch-listy użytkownika (10 punktów + zgłoszony bug hold/crossfade).

- **Pose carry (bugfix)** — `hold` w Direct zachowywał się jak `cut`: po
  przełączeniu segmentu obiekty wracały do pozy z setupu, bo preview budował się
  wyłącznie z nadchodzącego timeline'a. Nowy `layerPoseCarryByNode`
  (`engine/scenarioTimeline.js`, analogia do carry planszy spinnera) foldem po
  walk-u zapisuje pozę (transform-channels) każdej klatkowanej warstwy na KOŃCU
  segmentu; segmenty wchodzące przez `hold`/`crossfade` dziedziczą te pozy
  (wpieczone jako bazowe transformy — klucze nadchodzącego timeline'a nadal
  wygrywają), `cut` świadomie resetuje. `buildBlendedScene` blenduje OD pozy
  carry (nowy parametr `carryPoses` + `baseOverride` w `resolveLayerTransform`),
  więc crossfade nie skacze po oknie miksu. Wpięte w `directPreview` (single +
  blend) i eksport wideo scenariusza. Ograniczenie (udokumentowane): crossfade
  blenduje tylko kanały transformacji — stan animacji spine/spinner/winseq jest
  zamrożony w oknie overlapu. Testy: 6 nowych w `scenarioTimeline.test.mjs`,
  3 w `scenarioBlend.test.mjs`.
- **Outcome spinów per węzeł** — nowe `entry.spinOutcome`
  (`default`/`noWin`/`smallWin`/`bigWin`/`wildWin`) + selektor „Spin outcome"
  w inspektorze węzła (pokazuje się, gdy timeline stopuje spinner;
  `spinnerStopInfo` w `scenarioModel.js`). Plansze z seedowanych generatorów
  (`generateOutcomeBoard` w `spinnerModel.js`): smallWin = dokładnie jedna
  wygrana 3–5 bębnów (70% low), bigWin = 2–3 długie kombinacje high z 2-wysokimi
  stackami, wildWin = 3–5 wildów domykających kilka kombinacji. Klasyfikacja
  symboli **po nazwach** (`classifySymbols`): wild = nazwa zawiera „wild",
  low = token l/lo/low (L1, lo_2, low ace), high = h/hi/high; fallback po
  kolejności listy. `evalWaysWins(board, wildId)` — wild substytuuje w run-ach,
  komórki wildów dołączają do wygranej i grają WŁASNĄ animację wygranej
  (winCells czytają symbol z planszy + dedupe). Override jedzie przez
  `resolveSpinnerTrack`/`spinnerResolveKey`/`applySpinnerAtTime`
  (`scene.__spinnerOutcome`) ORAZ przez carry plansz, więc kolejne węzły trzymają
  wymuszony wynik. `wildWin` wyszarzone bez symbolu „wild". 7 nowych testów
  w `spinnerEval.test.js`. TODO eksport: odbicie generatorów w `YggSpinner.cs`.
- **Transport / klawiatura** — globalna **spacja jest kontekstowa**: preview
  wizarda (nowy `wizardPreviewControlsRef`) → playhead Direct → flow animate;
  w setupie nic (dotąd przełączała UKRYTY flow). Strzałki ←/→ tylko w animate.
  **⏮ „jump to start"** na wszystkich trzech timeline'ach (animate
  `TimelinePanel`, preview win-seq, transport grafu Direct — nowa akcja
  `seekStart` zachowująca stan odtwarzania). Pasek preview win sequences ma
  **drag-scrub** z pointer capture (dotąd tylko klik).
- **Highlight grającego segmentu** — scrubber Direct dostaje `is-current` +
  pulsujące `is-running` na segmencie pod playheadem (dane były — `curNodeId`).
- **Fullscreen fit** — `fitToStage()` w imperatywnym ref `PixiViewport`
  (przepis z refitu przy zmianie orientacji), wołane po `fullscreenchange`
  (podwójny rAF na osadzenie layoutu) przy wejściu I wyjściu. ResizeObserver
  celowo nie fituje — zwykłe resize'y paneli nie niszczą pan/zoomu artysty.
- **Chained ＋ w Direct** — `addTimelineNodeChained` (`scenarioModel.js`):
  pierwszy węzeł na prawo od Startu, kolejne na prawo od ostatnio dodanego
  (fallback: najbardziej prawy / Start), wyrównane do rzędu; geometria węzłów
  wyeksportowana z modelu (`SCENARIO_TL_W`…), panel importuje. Widok grafu
  **panuje tweenem** (280 ms ease-out) do nowego węzła — także przy drag-dropie;
  kółko/wciśnięcie myszy anuluje tween. Nowy węzeł od razu zaznaczony.
- **Ikony typów w hierarchii** — `layerTypeIcon(asset)` (`sceneModel.js`):
  🎬 root scene-setupu / 📁 pusta grupa / 🎰 spinner / 🏆 winseq / 🔢 winnumber /
  🦴 spine / 🖼 png (◻ dla generowanego placeholdera data-URL) / 🎞 video /
  📽 pngSequence. Render między checkboxem widoczności a nazwą.
- **Scene Setup: tryby na alfie + idle timeline'y** — grupy trybów (Free Spins /
  Bonus / Pick&Click) tworzone teraz `visible:true` + **alpha 0** (visible
  zostaje czystym togglem edycyjnym; kanał alpha jest animowalny → crossfade'y
  trybów w Direct). Wizard generuje po jednym timeline **„<Tryb> Idle"** (2 s,
  jeden klucz alpha na grupę: własna 1, reszta 0; `engine/sceneSetupTimelines.js`,
  tag `generatedBy: rootLayerId`, regeneracja przy re-edycji wizarda). Stare
  sceny bez migracji — `visible:false` działa jak dotąd; upgrade przez ponowne
  przejście wizarda. 3 testy w `sceneSetupTimelines.test.mjs`.

Notatka sesji (EN): `brain/50-Sessions/Session 2026-07-03 Scene Studio Direct QoL.md`.

| Warstwa | Plik |
|---|---|
| Pose carry (fold + semantyka cut/hold/crossfade) | `engine/scenarioTimeline.js` (`layerPoseCarryByNode`) |
| `baseOverride`, `carryPoses`, `bakeCarriedPoses` | `engine/scenarioBlend.js` |
| Konsumpcja carry + `__spinnerOutcome` + eksport | `SceneStudioInner.jsx` (`directPreview`, `makeVideoFrameProvider`) |
| Generatory outcome + `classifySymbols` + wild-aware eval | `engine/spinner/spinnerModel.js` |
| Outcome w resolve/key/winCells | `engine/spinner/spinnerEval.js`, `spinnerRuntime.js`, `pixiApp.js` |
| `entry.spinOutcome` + `spinnerStopInfo` + chained add | `engine/scenarioModel.js` |
| Selektor outcome + nowe opisy trybów przejść | `components/ScenarioInspectorSections.jsx` |
| ⏮/Space/scrub-highlight/focus-tween | `components/ScenarioGraphPanel.jsx`, `TimelinePanel.jsx`, `WinSequenceWizard.jsx`, `SceneStudioInner.jsx` |
| `fitToStage()` | `components/PixiViewport.jsx` |
| Ikony hierarchii | `engine/sceneModel.js` (`layerTypeIcon`), `components/HierarchyPanel.jsx` |
| Idle timeline'y setupu | `engine/sceneSetupTimelines.js` (+ test) |
| Style (scrubber highlight, ikona typu) | `styles/scene-studio.css` |


## Spine: tracki per-klip + miksowanie animacji — UKOŃCZONE ✅ (2026-06-30)

Spine'owy obiekt może grać kilka animacji naraz na osobnych trackach Spine
(AnimationState). Dotąd timeline mapował **wiersz → indeks tracka po pozycji w
tablicy**, więc miks był ukryty, priorytet odwrotny do intuicji (górny wiersz =
indeks 0 = najniższy priorytet), a eksport Unity po cichu gubił multi-track.

- **`clip.track`** (nowe pole, indeks AnimationState, domyślnie 0, cap 64) —
  ustawiany per-klip, **odsprzężony od wiersza timeline**. Klipy na różnych
  numerach **miksują się**; wyższy numer rysuje się na wierzchu (natywna
  semantyka Spine, bez inwersji w UI).
- **`applySpineMultiTrack`** przepisane na *gather-then-apply* kluczowane indeksem:
  aktywny klip per indeks (kolizja → wygrywa **niżej** położony wiersz), potem
  „hold last frame" per indeks (aktywny bije hold), czyszczenie slotów 0s snap
  (deterministyczny scrub) vs 0.1s fade (slot bez klipu). Zachowane mix/alpha/
  ease/clipIn/trackTime/hold.
- **Eksport Unity naprawiony** — `spineCuesForLayer` ustawia `trackIndex: clip.track`
  (wcześniej każdy cue szedł na 0 mimo wsparcia w YAML/C#).
- **UI**: badge „T#" na klipie (po lewej, przed nazwą) + pole „track" w inspektorze
  (pod dropdownem animacji); „New Clip" ghost na **każdym** wierszu zaznaczonego
  obiektu (fix: dało się dodać klip tylko do najwyższego); ghost pustego tracka
  pokazuje od razu „＋ New Clip" (tworzy track + klip naraz); przyciski **▲/▼**
  do przesuwania tracków nad/pod inne (`moveTrack`); „Match anim time" zjechało
  na dół inspektora (duration auto-fituje się teraz samo). **Bez migracji** —
  stare sceny z 2+ wierszami na jednym Spine collapsują na track 0.

Notatka sesji (EN): `brain/50-Sessions/Session 2026-06-30 Scene Studio Spine Tracks.md`.

| Warstwa | Plik |
|---|---|
| Pole `clip.track` (walidacja, cap 64) | `engine/sceneModel.js` |
| Dispatch per-indeks (gather-then-apply) | `engine/pixiApp.js` (`applySpineMultiTrack`, `spineTrackIndex`) |
| `trackIndex` w cue eksportu | `unity/bake.js` (`spineCuesForLayer`) |
| Badge T#, ghost per-wiersz, ghost-track New Clip, ▲/▼ | `components/TimelinePanel.jsx` |
| Pole „track" + przeniesione „match anim time" | `components/InspectorPanel.jsx` |
| Style badge/stepper + linia ciała klipu | `styles/scene-studio.css` |

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

## Sesja (2026-07-04) — Spinner wizard: kolejność kroków, defaulty timingu, symbol scale, ujemny spacing, fix bugu outcome test-spinu

Pięć zmian zgłoszonych przez artystów (`react-app/SPINNER.md` §4 + schemat
grida/klipu). Wszystkie zweryfikowane wobec aktualnego kodu przed
implementacją (3 przebiegi Explore + 1 Plan); pełny plan wykonania:
`~/.claude/plans/spinner-wizard-step-reorder-squishy-waterfall.md`.

### Zrobione ✅
- **Kolejność kroków kreatora** — otwiera się teraz na **Symbols** (krok 1),
  **Grid** drugi (Timing → Review bez zmian) — zgodnie z pierwotnym designem
  §4 (`① symbols → ② grid → …`), od którego as-built (2026-06-12) odbiegał.
  `canNext`/`goToStep` są kluczowane nazwą kroku, nie indeksem — reorder bez
  dodatkowych zmian logiki.
- **Nowe defaulty timingu dla nowego spinnera** — `startDuration` 0.4→0.25s,
  `spinSpeed` 12→30 komórek/s, `stopDuration` 0.6→0.35s, `minSpinTime`
  1.0→0.5s (`defaultSpinnerTiming()`); istniejące spinnery zachowują zapisane
  wartości. Zmirrorowane w `SpinnerConfigData` (C#).
- **`grid.symbolScale`** (domyślnie 1, zakres 0.05–10) — jednolite
  skalowanie renderowanego symbolu (static/blur/spine) wewnątrz komórki,
  niezależnie od jej rozmiaru. Live-patch bez rebuildu Pixi: `cellC.scale`
  (środek komórki, statyki/blur są jej dziećmi) + nowy param `scale` w
  `useSpineOverlay` (overlay Spine'a NIE jest dzieckiem `cellC`, siedzi w
  osobnej warstwie `fx` w bezwzględnych współrzędnych planszy — wymagał
  jawnego skalowania). Wykluczony ze `spinnerStructuralSig` (ten sam kubeł co
  cellW/cellH/spacing — geometria, nie topologia). Parytet Unity:
  `SpinnerConfigData.symbolScale`, `cell.sTr/bTr.localScale` oraz
  `DriveOverlay`'s `tr.localScale`.
- **Ujemny spacing gridu** — `spacingX`/`spacingY` mogą być ujemne (komórki
  stykają się lub nachodzą), sclampowane tak, by pitch (cell+spacing) nie
  spadł poniżej 1px: `min = -(cellW-1)` / `-(cellH-1)`. Nic więcej tego nie
  zakładało nieujemności (eval spinnera pracuje w jednostkach komórek, nie
  pikseli; relayout gridu już reaguje generycznie na zmianę spacingu).
- **Fix bugu**: dropdown "Result" (np. "no win") w test-spinie kreatora był
  ignorowany. Przyczyna: `normalizeSpinnerClipPayload`'s gałąź `stopSpin`
  zwracała stały zestaw kluczy, który po cichu gubił `outcome`/`rerollSeed`
  przy normalizacji klipu — `targetBoardForClip` nigdy ich nie widział i
  spadał na generyczną planszę. Dodatkowo fallback (`generateNonWinningBoard`)
  był wywoływany bez `wildId`, więc wild-substytuowana wygrana mogła
  "przeciekać" do planszy "no win" mimo wild-aware evaluacji wygranych.
  Naprawione w trzech miejscach tej samej klasy bugu: `normalizeSpinnerClipPayload`
  (przenosi `outcome`/`rerollSeed`), `targetBoardForClip`'s fallback i
  `normalizeSpinnerConfig`'s regen `initialBoard` (oba dostają `wildId` z
  `classifySymbols`). Bake do Unity (`bake.js`) też naprawiony — dla klipów z
  `outcome` bez `targetBoard` rozwiązuje realną planszę przez
  `targetBoardForClip` zamiast eksportować `targetBoard: null`.
- **Testy** — 8 nowych w `spinnerEval.test.js`: round-trip normalizacji
  outcome/rerollSeed, regresja przez `normalizeTrack` (zamyka lukę — istniejące
  testy T12 karmiły `resolveSpinnerTrack` surowymi klipami, omijając
  normalizację, dlatego bug przeszedł niezauważony), wild-awareness fallbacków
  (100 seedów każdy), determinizm, schemat gridu (symbolScale clamp,
  ujemny spacing + inwariant pitch), snapshot `defaultSpinnerTiming()`.
  Wszystkie suity Scene Studio zielone (166 testów: `node --test` po całym
  `src/tools/SceneStudio/`).

| Plik | Co zmienione |
|------|-------------|
| `engine/spinner/spinnerModel.js` | grid: `symbolScale` + ujemny spacing clamp; `defaultSpinnerTiming()`; `normalizeSpinnerClipPayload` (stopSpin outcome/rerollSeed); `targetBoardForClip` + `normalizeSpinnerConfig` initialBoard (wildId-aware fallback) |
| `engine/spinner/spinnerRuntime.js` | `symbolScale` destructure + `cellC.scale.set`; `useSpineOverlay` nowy param `scale` |
| `components/SpinnerWizard.jsx` | kolejność `STEPS`/`STEP_LABELS` + initial step; state/field/threading `symbolScale`; spacing min `1-cellW`/`1-cellH` |
| `unity/csharp.js` | `SpinnerConfigData.symbolScale` + timing defaults; `cell.sTr/bTr.localScale` i `DriveOverlay` scale |
| `unity/bake.js` | `configJson.symbolScale`; outcome-driven stopSpin → `targetBoardForClip` gdy `targetBoard` puste |
| `engine/spinner/spinnerEval.test.js` | 8 nowych testów + fix nieaktualnego komentarza (0.4s→0.25s) |

## Sesja 2 (2026-07-04) — Spinner: realny fix "no win", parytet bluru animOnly, Result steruje planszą wprost

Artysta zgłosił, że mimo poprzedniej sesji: (1) "no win" dalej czasem ląduje na
wygranej, (2) blur symboli animOnly wygląda "dziwnie", (3) chce, by wybór
Result od razu aktualizował siatkę planszy + podgląd, a Spin tylko odgrywał tę
samą planszę. Pełna diagnoza (3 równoległe agenty Explore) przed
implementacją — zobacz `~/.claude/plans/spinner-wizard-outcome-blur-rework-prompt.md`
(brief przygotowany dla nowej sesji, ale wykonany w tej samej sesji na
prośbę użytkownika: "ok try to fix this stuff").

### Zrobione ✅

- **Realny fix "no win"** — `generateNonWinningBoard` (spinnerModel.js) nigdy
  nie weryfikowało własnego postconditionu: przy 2 symbolach (minimum
  kreatora) i większej liczbie wierszy greedy fix-up reelu 2 potrafił
  wyczerpać pulę "bezpiecznych" zamienników i po cichu zwrócić PLANSZĘ Z
  WYGRANĄ. Empirycznie: 40% re-rolli failowało na konfiguracji 2
  symbole/3×5. Naprawione deterministycznym ostatnim rzutem: jeden
  wewnętrzny reel jednolicie symbolem X, następny jednolicie SYMBOLEM Y —
  żaden kandydat nie osiąga progu wygranej niezależnie od reszty planszy,
  działa nawet przy 2 symbolach. Nowy sweep-test (2–6 symboli × 3 liczby
  reelów × 3 liczby wierszy × 100 seedów) pokrywa dokładnie tę lukę, której
  nie łapały dotychczasowe fixtury.
- **Parytet bluru symboli animOnly (T7)** — `bakeSpinePoseTexture` używało
  generycznego, izotropowego `BlurFilter` z pixi.js zamiast tego samego
  kierunkowego motion-bluru WASM co zwykłe symbole (udokumentowany,
  świadomy skrót z sesji T7 — "lower quality than the hand-made blur").
  Wyodrębniono `blurCanvasWasm`/`blurCanvasFallback` (niski poziom, działa na
  dowolnym canvasie) ze `spinnerBlur.js`, dzielone teraz przez statyczne
  symbole ORAZ bake animOnly — ten sam posed frame (pierwsza klatka land,
  fallback win) co dotychczasowy sharp-bake, wyciągnięty przez
  `renderer.extract.canvas`, przepuszczony przez identyczny łańcuch
  WASM/canvas-ghost.
- **Result steruje planszą wprost** — wybór Result (lub re-roll) w kroku
  Review teraz SYNCHRONICZNIE liczy konkretną planszę
  (`generateOutcomeBoard`/`generateWinningBoard`) i zapisuje ją w
  `initialBoard` — siatka `BoardGridEditor` i podgląd na żywo (w spoczynku)
  aktualizują się natychmiast, bez konieczności spinowania. `Spin` (dawniej
  "test spin") niesie teraz jawny `targetBoard` (dokładnie tę planszę, która
  już jest widoczna) zamiast `outcome`/`rerollSeed` — animacja nie może już
  wylądować na czymś innym niż podgląd. `buildSpinnerTestClips` dostał 4.
  parametr `targetBoard` (opcjonalny, nadpisuje outcome). Ręczna edycja
  komórki nadal działa, po prostu przestaje pasować do etykiety Result.
- **Testy**: 3 nowe w `spinnerEval.test.js` (sweep postconditionu,
  wild-blind edge case przy 1 symbolu, explicit `targetBoard` w
  `buildSpinnerTestClips`). Pełna suita Scene Studio: **169 testów, wszystkie
  zielone**.

### Bez pokrycia testami (wymaga ręcznej weryfikacji w przeglądarce)

`bakeSpinePoseTexture`'s blur bake dotyka DOM/Pixi/`window._Magick` — brak
harnessu testowego, tak jak poprzednio (ten sam brak co przy sharp-bake).
**Nie było możliwe zweryfikowanie wizualnie** — brak narzędzia do sterowania
przeglądarką w tym środowisku. Wymagana ręczna kontrola w `npm run dev`:
wygląd bluru animOnly vs. zwykłych symboli, natychmiastowa aktualizacja
siatki/podglądu po wyborze Result, oraz że Spin ląduje dokładnie na
pokazanej planszy.

| Plik | Co zmienione |
|------|-------------|
| `engine/spinner/spinnerModel.js` | `generateNonWinningBoard` deterministyczny fallback; `buildSpinnerTestClips` param `targetBoard` |
| `engine/spinner/spinnerBlur.js` | wyodrębnione `blurCanvasWasm`/`blurCanvasFallback` (niski poziom, dzielone) |
| `engine/spinner/spinnerRuntime.js` | `bakeSpinePoseTexture` używa kierunkowego bluru zamiast `BlurFilter` |
| `components/SpinnerWizard.jsx` | `applyOutcomeBoard`; Result/re-roll → `initialBoard`; Spin → explicit `targetBoard`; przeorganizowany UI kroku Review |
| `engine/spinner/spinnerEval.test.js` | 3 nowe testy |

## Sesja 3 (2026-07-04) — Spinner: progress bar generowania bluru, zawsze widoczne sigma/feather, większy panel kreatora

Artysta zgłosił, że przy pierwszym użyciu symbole nie renderowały się w
podglądzie (prawdopodobnie generowanie blurów w tle bez informacji o
postępie), poprosił o pasek postępu, upewnienie się że blur startuje TYLKO
po jawnym kliknięciu, możliwość wyboru sigma/feather oraz (zgłaszane już
wcześniej) większy panel kreatora — miniatury symboli zajmowały tylko
ułamek szerokości panelu.

### Zrobione ✅

- **Pasek postępu przy generowaniu blurów** — `generateBlurs` aktualizuje
  teraz stan przyrostowo (po `symbol.id`, nie przez nadpisanie całej listy
  na końcu partii — bezpieczniejsze i widoczne od razu) i czeka jedną
  klatkę (`requestAnimationFrame`) przed każdym symbolem, żeby pasek
  postępu i podgląd Pixi zdążyły się przemalować zamiast wyglądać na
  zawieszone przez cały czas trwania partii. Prawdziwe wykonanie w tle
  (Web Worker) odrzucone — wspólny łańcuch WASM `window._Magick` pisze do
  STAŁYCH nazw plików tymczasowych używanych też przez każde inne wywołanie
  ImageMagick w aplikacji, więc równoległe wywołania kolidowałyby ze sobą —
  musi zostać sekwencyjne niezależnie od miejsca wykonania.
- **Generowanie bluru pozostaje w 100% na jawne kliknięcie** — zweryfikowane,
  że `generateBlurs` nigdy nie było wywoływane automatycznie (tylko z
  przycisku), ale panel z suwakami sigma/feather był ukrywany, gdy żaden
  symbol nie potrzebował bluru — dodano drugi przycisk **"↻ regenerate all"**
  (przelicza blur dla WSZYSTKICH symboli bieżącymi ustawieniami,
  nadpisując istniejące), a panel z suwakami jest teraz zawsze widoczny gdy
  są jakiekolwiek symbole ze statykiem.
- **Większy panel kreatora + miniatury** — domyślna szerokość panelu
  kreatora (dzielona przez wszystkie kreatory, `PANEL_SIZES.wizard`)
  460→620px; miniatury podglądu symbolu (static/blur/land/win) były na
  sztywno 44px niezależnie od szerokości panelu — teraz 76px, siatka
  zawija się (`flex-wrap`) przy wąskim panelu; lista symboli
  `max-height` 260→420px, żeby więcej symboli mieściło się bez scrolla.

### Bez pokrycia testami

Czysto UI/CSS — brak logiki do pokrycia w `node --test`; pełna suita Scene
Studio (169 testów) nadal zielona (regresja wykluczona, nie dodano nowych
testów bo nie ma tu nic do testowania jednostkowo). **Wizualna weryfikacja
w przeglądarce nie została wykonana** — brak narzędzia do sterowania
przeglądarką w tym środowisku.

| Plik | Co zmienione |
|------|-------------|
| `components/SpinnerWizard.jsx` | `generateBlurs` przyrostowy + `blurProgress`; zawsze widoczny panel sigma/feather + "regenerate all" |
| `SceneStudioInner.jsx` | `PANEL_SIZES.wizard.def` 460→620 |
| `styles/scene-studio.css` | `.spinner-blur-progress*` (nowe); `.spinner-sym-previews`/`.spinner-thumb-box` większe + `flex-wrap`; `.spinner-sym-list` `max-height` 260→420 |

## Sesja 4 (2026-07-04) — Spinner: fix regresji wydajności bluru animOnly, prawdziwe ustawienia sigma/feather

Artysta zgłosił dwa problemy: (1) panel bluru/sigma/feather w ogóle się nie
pojawia przy pracy z symbolami tylko-animacyjnymi ("fill from animations"),
(2) po wypełnieniu symboli z animacji podgląd czeka wiele sekund zanim się
pokaże. Punkt 2 to realna regresja wprowadzona w Sesji 2 tego dnia: fix
kierunkowego bluru dla symboli animOnly zamienił tani filtr Pixi na
**5-krokowy łańcuch WASM ImageMagick wykonywany SYNCHRONICZNIE w trakcie
budowania sceny** — kilka symboli animOnly potrafiło zablokować podgląd na
kilka sekund, zanim cokolwiek się wyrenderowało.

### Zrobione ✅

- **Fix regresji wydajności** — `bakeSpinePoseTexture` podzielone na dwie
  fazy: szybki, blokujący bake tekstury "sharp" (jedno `generateTexture`,
  bez WASM) — pokazywany NATYCHMIAST (jako tymczasowy zamiennik dla obu
  slotów tex/blurTex), oraz osobna, NIEBLOKUJĄCA kolejka
  (`queueBlurBake`) na właściwy kierunkowy blur WASM, podmieniana w
  `textures` Map gdy gotowa (Map czytana na żywo co klatkę, więc podmiana
  działa bez rebuildu). Kolejka jest WSPÓLNA i ściśle sekwencyjna (jeden
  moduł-poziomu `Promise` łańcuch) — równoległe wywołania WASM Magick
  pozostają niebezpieczne (stałe nazwy plików tymczasowych, dzielone przez
  KAŻDE wywołanie ImageMagick w aplikacji), więc kolejka serializuje bez
  blokowania wywołującego.
- **Prawdziwe, trwałe ustawienia sigma/feather** — dodano `blur.sigma`/
  `blur.feather` do schematu configu (`defaultSpinnerBlur`,
  `normalizeSpinnerConfig`), dzielone przez OBA mechanizmy bluru: generację
  PNG dla symboli statycznych (przyciski w kreatorze) ORAZ automatyczny bake
  w runtime dla symboli animOnly (bez przycisku — po prostu używane przy
  następnym przebuildzie). Panel z suwakami w kreatorze pokazuje się teraz
  zawsze, gdy jest jakikolwiek symbol (wcześniej wymagał symbolu ze
  statykiem) — usunięto osobny, nietrwały stan `blurSigma`/`blurFeather`,
  suwaki edytują teraz bezpośrednio `blur.sigma`/`blur.feather` (ten sam
  obiekt, który już był persystowany).
- **Testy**: 1 nowy w `spinnerEval.test.js` (default + clamp `blur.sigma`/
  `feather`). Pełna suita: **170 testów, wszystkie zielone**.

### Bez pokrycia testami

Sam bake i jego timing (Pixi/WASM/DOM) nie mają harnessu testowego — jak
poprzednio. **Nie zweryfikowano wizualnie ani czasowo** (brak narzędzia do
sterowania przeglądarką) — wymagana ręczna kontrola: podgląd powinien pokazać
symbole animOnly niemal natychmiast (sharp texture), blur powinien "dogonić"
chwilę później bez zauważalnego zacinania.

| Plik | Co zmienione |
|------|-------------|
| `engine/spinner/spinnerModel.js` | `blur.sigma`/`blur.feather` w schemacie (`defaultSpinnerBlur`, `normalizeSpinnerConfig`) |
| `engine/spinner/spinnerRuntime.js` | `bakeSpinePoseTexture` rozdzielone na `bakeSpinePoseSharpTexture` (blokujące, szybkie) + `queueBlurBake` (kolejka w tle) |
| `components/SpinnerWizard.jsx` | usunięty stan `blurSigma`/`blurFeather` (teraz `blur.sigma`/`blur.feather`); panel widoczny dla dowolnego symbolu, nie tylko statycznego |
| `engine/spinner/spinnerEval.test.js` | 1 nowy test |

## Sesja 5 (2026-07-04) — Spinner: dwa kolejne bugi bluru (ładowanie obrazu w kreatorze, ekstrakcja canvasu dla animOnly)

Artysta zgłosił, że mimo Sesji 4: (1) w workflow tylko-animacyjnym nadal brak
bluru w ogóle, (2) `generateBlurs` w kreatorze pokazuje progress, ale
statyczne miniatury bluru nigdy się nie pojawiają — nawet "match blur"
(dopasowanie po nazwie pliku, bez przetwarzania obrazu) nie pomaga.

### Zrobione ✅

- **Realny, przedwcześniejszy bug w `generateBlurs`** — assety zeskanowane z
  folderu projektu (`browserPool`, `_fromBrowser`) mają w `src` SUROWĄ ścieżkę
  względną, nie URL nadający się do wczytania — `el.src = asset.src`
  (przypisanie wprost do `<img>`) cicho failowało (`onerror` → catch →
  `console.warn`, progress i tak kończył się "sukcesem" bez wyniku). Ten sam
  problem `SymbolThumb` już rozwiązuje przez `resolveAssetFile(src,
  rootHandle)` — `generateBlurs` teraz robi to samo przed wczytaniem obrazu.
  To błąd sprzed tej sesji (nie regresja z dzisiejszych zmian), ale leżał
  dokładnie na ścieżce kodu, którą dziś przerabialiśmy.
- **Wzmocniona ekstrakcja canvasu dla bluru animOnly** —
  `deps.renderer.extract.canvas(inst.container)` ekstrahowało z SUROWEGO,
  nie podpiętego do sceny kontenera; zmienione na ekstrakcję z już
  wygenerowanej tekstury `sharp` (`extract.canvas(sharp)`) — bardziej
  niezawodne wymiary/bounds, skoro `generateTexture` już potwierdził że ten
  render działa. Nie mam pewności czy to był FAKTYCZNY root cause zgłoszonego
  "brak bluru w ogóle" (brak możliwości debugowania w przeglądarce), ale to
  ściśle bezpieczniejsza zmiana bez wad.

### Bez pokrycia testami / bez weryfikacji

Obie zmiany dotykają DOM/Pixi/plików projektu — brak harnessu testowego.
**Nie zweryfikowano wizualnie** (brak narzędzia do sterowania przeglądarką).
Jeśli blur animOnly nadal nie działa po tej sesji, warto sprawdzić konsolę
przeglądarki pod kątem `[SceneStudio] spinner idle-pose blur bake failed` —
`queueBlurBake`'s `.catch` loguje tam każdy błąd.

| Plik | Co zmienione |
|------|-------------|
| `components/SpinnerWizard.jsx` | `generateBlurs` rozwiązuje `src` przez `resolveAssetFile` dla assetów spoza sceny |
| `engine/spinner/spinnerRuntime.js` | `bakeSpinePoseSharpTexture` ekstrahuje canvas z `sharp` (Texture), nie z surowego kontenera |

## Sesja 6 (2026-07-04) — Spinner: blur symboli statycznych 4x wolniejszy niż trzeba — downsample przed blurem

Artysta: blur symboli statycznych działa (Sesja 5 naprawiła ładowanie), ale
jest wolny. Prośba: przeskalować w dół (np. 4x) przed puszczeniem łańcucha
WASM, potem wyświetlać w spinnerze w poprawnym (oryginalnym) rozmiarze.

### Zrobione ✅

- **Downsample 4x przed blurem** (`spinnerBlur.js`) — `makeBlurredSymbolWasm`/
  `makeBlurredSymbolCanvas` teraz skalują wyrenderowany canvas komórki w dół
  o `BLUR_DOWNSAMPLE=4` PRZED puszczeniem łańcucha WASM/canvas-ghost — 16x
  mniej pikseli, więc każdy z 5 kroków WASM (motion-blur, feather mask,
  alpha extract/multiply, composite) i encode/decode PNG między nimi jest
  odpowiednio tańszy. `sigma`/`feather` skalowane w dół proporcjonalnie
  (promień w pikselach musiałby inaczej wyglądać 4x silniej po
  przeskalowaniu z powrotem w górę). Wynikowy PNG zostaje w mniejszym
  rozmiarze — BEZ ponownego upsample'u w generatorze.
- **Kompensacja rozmiaru przy wyświetlaniu** (`spinnerRuntime.js`) —
  `blurSprite.scale` liczone teraz z rzeczywistego stosunku wymiarów tekstur
  (`tex.width/blurTex.width`, analogicznie Y) zamiast sztywnego `1` — działa
  transparentnie dla każdego rozmiaru bluru: nowego zmniejszonego, starych
  pełnorozmiarowych PNG-ów, i tekstury animOnly (tam stosunek = 1, bez
  zmiany).
- **Parytet Unity** (`unity/csharp.js`) — ten sam problem dotyczyłby exportu:
  wariant UI (`Image`) rozmiarowuje komórkę bluru wg WŁASNEGO natywnego
  rozmiaru sprite'a bluru (`SetNativeSize`) — zmienione na rozmiarowanie wg
  sprite'a STATYCZNEGO (z `preserveAspect=false` rozciąga mniejszy blur do
  właściwego rozmiaru). Wariant World (`SpriteRenderer`) — nowe pola
  `CellView.blurScaleX/Y` liczone przy podmianie tekstury (stosunek
  `static.rect.width/blur.rect.width`), mnożone przez `symbolScale` w
  `bTr.localScale` co klatkę — bez tego blur renderowałby się 4x mniejszy w
  świecie.

### Bez pokrycia testami / bez weryfikacji

`spinnerBlur.js` operuje na DOM canvas/Image — zero pokrycia w `node --test`
(jak zawsze dla tego pliku). Zmiany w `csharp.js` to string templates
generowanego C# — nie mam jak skompilować/uruchomić w Unity. **Nie
zweryfikowano wizualnie ani czasowo** — wymagana ręczna kontrola: czy blur
faktycznie generuje się szybciej, czy wygląda podobnie po przeskalowaniu w
górę (30×30 z domyślnego 120×120 to sporo utraconej rozdzielczości, choć dla
kierunkowego rozmycia bez ostrych krawędzi powinno być niezauważalne).

| Plik | Co zmienione |
|------|-------------|
| `engine/spinner/spinnerBlur.js` | `BLUR_DOWNSAMPLE=4`, `downsampleCanvas`; oba entry pointy skalują przed blurem, sigma/feather skalowane proporcjonalnie |
| `engine/spinner/spinnerRuntime.js` | `blurSprite.scale` liczone z realnego stosunku wymiarów tekstur |
| `unity/csharp.js` | UI: `SetNativeSize(bTr, staticSprite)`; World: `CellView.blurScaleX/Y` + zastosowanie w `bTr.localScale` |

## Sesja 7 (2026-07-04) — Spinner: PRAWDZIWY root cause "bluru nigdzie nie widać" — `resolveAssetUrl` nie obsługiwało `blob:`

Artysta: generowanie bluru jest teraz szybsze, ale wygenerowany blur **nigdy
się nie pokazuje** — ani w podglądzie kreatora, ani w timeline, ani w
director/Direct mode. To był fundamentalny bug, nie coś związanego z
downsample'em z Sesji 6.

### Root cause (znaleziony)

`resolveAssetUrl` (`engine/persist.js`) — WSPÓLNY resolver assetów używany
przez KAŻDY typ zasobu w Scene Studio (spine skel/atlas/texture, zwykłe PNG
warstwy, spinner statics/blur) — obsługiwał specjalnie tylko `data:` URL-e:

```js
if (src.startsWith('data:')) return { url: src };
if (!rootHandle) return null;
// ... traktuje src jako ścieżkę względną w folderze projektu
```

Wygenerowany blur PNG (`generateBlurs` w kreatorze) ma `src` w postaci
`URL.createObjectURL(blob)` — czyli `blob:...`, NIE `data:...`. Taki URL
wpadał w gałąź "traktuj jako ścieżkę względną", oczywiście nigdy nic takiego
nie znajdowała, `resolveAssetUrl` zwracał `null`. `spinnerRuntime.js`'s
`load()` na `null` cicho zwraca `null`, a `textures.set(sym.id, { tex,
blurTex: blurTex || tex || Texture.WHITE })` **fallbackuje `blurTex` na
`tex`** — czyli sprite bluru dostawał DOKŁADNIE TĘ SAMĄ, nierozmytą
teksturę co statyk. Zero błędu w konsoli, zero wizualnej różnicy — blur
"działał" (crossfade alpha), tylko pokazywał identyczny obrazek po obu
stronach. To dotyczyło KAŻDEGO wygenerowanego/blob:-owego assetu w całej
aplikacji, nie tylko bluru spinnera — po prostu spinner jest jedynym
miejscem, które akurat generuje blob:-owe PNG-i w locie.

### Zrobione ✅

- **Fix w `resolveAssetUrl`** — rozszerzone o `blob:` i `https?:` (regex
  `/^(data:|blob:|https?:)/`), zwraca URL wprost bez próby traktowania go
  jako ścieżki plikowej. Naprawia blur spinnera ORAZ każdy przyszły
  przypadek generowanego/zdalnego assetu w Scene Studio.
- **Nowe testy** — `engine/persist.test.mjs` (nowy plik, 3 testy): data:/
  blob:/http(s): rozwiązują się bezpośrednio bez `rootHandle`; względne
  ścieżki nadal wymagają `rootHandle`; nie-string `src` zwraca `null`.
  Pełna suita: **173 testy, wszystkie zielone**.

### Bez weryfikacji

**Nie zweryfikowano wizualnie w przeglądarce** (brak narzędzia). To jednak
najbardziej precyzyjnie zdiagnozowany fix z całej dzisiejszej serii — czysta
logika (nie DOM/Pixi), pokryta testem jednostkowym, więc pewność co do
poprawności jest wysoka mimo braku wizualnej weryfikacji.

| Plik | Co zmienione |
|------|-------------|
| `engine/persist.js` | `resolveAssetUrl` rozpoznaje `blob:`/`https?:` jako bezpośrednio ładowalne URL-e, nie tylko `data:` |
| `engine/persist.test.mjs` | nowy plik, 3 testy |
