rzeczy do dodania imo:

- jeśli jest auto key, mamy wybrany klip i wyjdziemy aktywnym framem za niego i zmienimy pozycje na scenie tego smaego obiektu -> wtedy klip powinien zostać wydłużony do obecnej klatki i w tej samej klatece powstaje ten key frame do czegokolwiek zostało zmienione na scenie

- poprawa renderu lini ruch - path'u itp:
    - jeśli robimy skalowanie (x,y lub samo x lub samo y) to linia też sie skaluje ruchu też sie sklauje z ruchem
    - małe strzałki co x ruchu w czasie tak żeby zobaczyć koierunek ruchu i w miare jak szybko sie porusza - ta opcja co ile daawac strzałke powinna być też gdzieś do ustawienia
    - na scene jeśli mamy wybrany klip i wyswietla nam sie path i widzmy tam te punkty przy keyframeach to powinno dac sie też to kliknąć i to też powinno przewicąć tam timeline do tego miejsca i dać nam możliwość edycji tego keyframea bezpośrednio

- jęsli przejedziemy timelinem na klip tam gdzie nie maklucza pomiedzy dwoma kluczami i zmienimy mu pozycje/skale to nowy klucz powinien się zrobić albo flat tak jak teraz - tzn linearne przejscia z tych pomiędzy - albo jesli wybierzemy gidzę w opcjach głównych toola (może na górnym frameie) żeby te keyframey robiły się z gładkim przejsciem przez jakiś ease in albo in out <- to własnie do wyboru> -> chce też zeby na scenie miało efekt taki ze linia patch będzie bardziej zaokrąglona - dlatego to sie musi dziać oddzielnie an płaszczyznach x i y a wieć bardziej liczone jako taki faktyczny path podobny do curve baziera czy ogólnei splinó. Cięzki temat ale takie coś jest raczej wymagane do takiego progamru do animacji-
        - w sumie mogło by być ciekawe to żeby te pathy były własnie do edycji w spsób tradycyjny na grpahie curvów ale też na scenie jako własnie takie spline'y 

- na timeline na klipie jak mamy keyframey - żeby chwile od lewej krawędzi było napisane co ten keyframe zminiena
- na timeline sama nazwa klipu (który w staticach jest zbugowany) powinna być na samej górze nad wszystkimi keyframemami
- na timeline jesli to jest klip zwiazany ze spinem to jak jest nazwa na górze to powinno dac sie ją wybrać i to powinien być dropdown animacji tego klipu żeby łatwo się dało to ustawić na timeline
- spacja - start i stop na playerzr
- lewa, prawa strzałka -> zatrzymanie play + przewinięcie o jedną klatke
- alt scroll - góra dół timeline
- żeby dało sie przeciągnąć asset z assetów na scene i żeby on sie tam zrespił jako najznizszy obiekt w hierarchi canvasu

- jak mamy widok landscape i portrait i toggle to obok też powinien być dropdown widoku nakładki tego dzie mamy ten obszar działania- defaultowo jak teraz wyświetla sie za wszystkimi obiektami, inna opcja to to nad wszystkimi obiektami ale w środku jest 100% przezroczyste wiec widzimy gdzie ammy się zmiascić

bugi:

- jak klikniemy na klucz na zminnej to otwira nam sie lokalkna krzywa tego zakresu ale na timeline nie przechodzi nam do tego momentu wiec ciezko jest to dobrze ustalić
    - DODATKOWO i high prio- w sumie fajnie by było że jak wybierzemy to nie pokazuje nam sie tylko krzywa lokalna z tego keframe do nastepnego ALE zamiast tego żeby pkazywała nam sie lokalna krzywa 3 punktów: poprzedniego, wybranego i nastepnego - wtedy można by dokładnie modyfikować dane przejście frame, toznaczy że ten pierwszy i trzecu frame na lokalnym grpahie będzie miał tylko jeden controll point ale ten wybrany czyli na środku będzie miał dwa punkty i wtedy user powinien moc wbrać opcje jak w unity typu smooth - która sutawiała by oba żeby przejscie było gładziutkie przez ustawienie obu diali w jednej płaśzyzne ale w możliwe różnych oodległosciach od punktu na różne złagodzenia z obu stron albo broken żeby edytować każdy oddzilnie i jeszcze może flat czyli badzo prosto - ta sama linia i ta sama odległość obu diali
- jak rozdizelimi pos na x i y to jak wybieramy jeden z keyframów na timeline to sie coś buguje i sie nic nie wybiera, na pojedyńczych to działa dobrze
- na timeline animacje statycznych pngów mają dziwne nazwy, w inspekotrze powinno dac sie nadac nazwe temu klipowi i nad default powinien sie nazywać: nazwa obiektu z canvasu + clip x gdzie x to jest który klip na tym tracku został stworzony
- pod timeline jest jakies puste miejsce - bez sensu timeline powinien iść do samego dołu
- jak scrollujemy timeline to znika nam jego górna część przez co sie nie da chodzić po timelinie

- duże prio - posiadanie stanu strony jest dosyc ciezkie bo gdy mamy właczony scene studio i wyjdziemy np do art tools to cała scena sie niszczy i nie zapisuje - bez sensu na pewno obecny stan powinien być trzymany a nie niszczony popmiedzy przechodzeniem na inne toole, PONAD to sesja też powinna być trzymamna pomiędzy odpaleniem strony i przegladarki (o ile wersja jest ta sama) i też jesli cos sie stanie ze stroną typu przeladowanie lub nowa wersja to powoinno zpaytrac czy chcemy zapisać starą wesjee - podstawa żeby nie zgubić danych, tez przydał by sie ogólnie przycisk nowego projektu i wtedy też powinno zapytać czy zapisać czy usunąć stary


