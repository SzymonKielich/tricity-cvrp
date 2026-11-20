# Metryki SharedDrop

Plan bazowy odtwarza pierwotne trasy sklepów z danych Hedyla. Kolejność wizyt pochodzi z `hedyla_baseline_assignments.csv`. Symulacja zakłada wyjazd o początku okna pierwszej dostawy i dodaje czasy z macierzy, korekty ruchu oraz obsługę zamówień. Dane źródłowe zawierają okna dostaw. W planie współdzielonym wyświetlane czasy to harmonogram OR-Tools.

| Ekran i metryki | Źródło i sposób obliczenia |
|---|---|
| **Overview** · sklepy, zamówienia i pojazdy | `backend/main.py` liczy pojazdy i sklepy przez `Dataset`. Uczestnicy mają flagę `platform_participant=1` w CSV sklepów. Licznik zamówień filtruje CSV zamówień według dnia i zakresu sklepów. Pojazdy są liczone dla całego zbioru źródłowego. |
| **Overview** · dystans, emisje, koszty, punktualność, wykorzystanie | Plan współdzielony pochodzi z raportu zapisanego scenariusza o tym samym dniu i zakresie. Plan bazowy pochodzi z `GET /api/baseline`. Obie strony używają `backend/reports.py`. |
| **Studio** · parametry i przebieg | `backend/models.py` przygotowuje konfigurację modelu. Limity dzienne i wagi trafiają do `solver/hedyla_opt.py`. Zegar wykonania w Studio mierzy czas od zapisanej daty startu do końca wykonania lub do chwili bieżącej. Licznik kontroli liczy wiersze raportu walidatora zapisane przez `backend/worker.py`. |
| **Studio i Comparison** · pokrycie | Liczba zamówień z zakończonych tras i rozmiar wejściowego zakresu danego scenariusza. `backend/reports.py` agreguje dane tras, a `solver/validate_solution.py` niezależnie sprawdza pokrycie, unikalność obsługi i ograniczenia. Niepełne wyniki nadal pokazują pokrycie i trasy. Studio pokazuje również identyfikatory nieobsłużonych zamówień. |
| **Comparison i pozostałe ekrany** · dystans, pusty przebieg, emisje | `enrich_route` sumuje odcinki między kolejnymi przystankami, włącznie z wyjazdem i powrotem. Odległości są w km i pochodzą z `hedyla_distance_matrix.csv`. Pusty przebieg sumuje odcinki z zerową masą na pokładzie. Emisje to km × współczynnik pojazdu w kg CO₂e/km z `hedyla_vehicles.csv`. |
| **Comparison i pozostałe ekrany** · koszty | Raport sumuje km × stawka EUR/km oraz stawkę stałą EUR z `hedyla_vehicles.csv`. Plan bazowy nalicza stawkę stałą na każdą trasę sklepu. Plan współdzielony nalicza ją na użyty pojazd i dzień. Walidator sprawdza limit jednej trasy na pojazd dziennie. Koszt na dostarczone zamówienie to łączny koszt modelowany podzielony przez liczbę obsłużonych zamówień. |
| **Comparison** · punktualność i czas | Punktualność dostawy to udział obsłużonych zamówień, dla których początek obsługi przypada w oknie dostawy. Punktualność odbioru wymaga początku i końca obsługi w oknie sklepu. Godziny tras sumują od wyjazdu do powrotu. Czas oczekiwania sumuje przerwy między szacowanym dojazdem a planowanym początkiem obsługi. Dla planu bazowego punktualność odbioru i oczekiwanie nie mają wartości źródłowej. |
| **Comparison i Impact** · masa, objętość i rodzaj pojazdu | Wykorzystanie limitu to średnia ważona odległością, obejmująca puste odcinki. Dla każdego odcinka raport mnoży procent wykorzystania właściwego limitu przez km, następnie dzieli sumę przez wszystkie km. Rozkład floty liczy trasy według klasy pojazdu na wszystkich wybranych dniach. |
| **Comparison i Impact** · grupowanie i zmiany | Licznik grupowanych zamówień obejmuje trasy obsługujące co najmniej dwa sklepy. `backend/worker.py` wylicza względną zmianę dystansu, emisji i kosztów jako (plan współdzielony − plan bazowy) ÷ plan bazowy × 100%. Różnica wymaga niezerowej wartości odniesienia i pełnego, zwalidowanego planu. |
| **Impact** · koszt i emisje zapisanych planów | `frontend/lib/scenario.ts` wyznacza zbiór niezdominowanych punktów wśród widocznych scenariuszy o tych samych dniach, zakresie i danych. Osie pokazują modelowany koszt w EUR i emisje w kg CO₂e. |
| **Impact** · koszt przydzielony sklepom | `solver/kpis.py` dzieli koszt każdej trasy proporcjonalnie do samodzielnego dystansu zamówienia, przyjętego jako 2 × odległość sklep–cel z macierzy. Następnie sumuje udziały per sklep. Tabela odnosi wynik do kwot źródłowych Hedyla, zaokrąglonych do centów per trasa. Stąd w przykładzie suma sklepowych kwot bazowych to 2 157,16 EUR, a wartość przeliczona z macierzy i stawek dla całego planu to 2 157,14 EUR. |

## Zapisany przykład

Viladecans Balanced pilot z 5 listopada 2026 r. obejmuje 184 zamówienia sklepów uczestniczących.

| Metryka | Plan bazowy | Plan współdzielony |
|---|---:|---:|
| Pokrycie | 184 z 184 | 184 z 184 |
| Dystans | 841,974 km | 473,596 km |
| Emisje modelowane | 81,510 kg CO₂e | 17,303 kg CO₂e |
| Koszt zmienny | 390,14 EUR | 167,91 EUR |
| Koszt stały | 1 767,00 EUR | 323,00 EUR |
| Łączny koszt modelowany | 2 157,14 EUR | 490,91 EUR |
| Sklepowe trasy / pojazdy użyte tego dnia | 73 tras | 15 pojazdów |

Szacowana różnica łącznego kosztu wynosi −77,24%. Model obejmuje stawki przewozowe i pomija koszty koordynacji i obsługi.

## Podgląd na arud

Z katalogu projektu na arud. Polecenie Compose wybiera osobny projekt, wiąże port wyłącznie na loopback i importuje zapisany scenariusz do osobnego wolumenu.

```sh
SHAREDROP_PORT=127.0.0.1:18437 SHAREDROP_SEED_SAMPLE=1 docker compose -p shareddrop-preview up -d --build
```

Tunel z komputera użytkownika.

```sh
ssh -o ExitOnForwardFailure=yes -N -L 127.0.0.1:18437:127.0.0.1:18437 arud
```

- [Wariant CSS z zapisanym scenariuszem](http://127.0.0.1:18437/preview/css?scenario=5c7e08ce-1aa5-4707-86b2-c4451a13e326)
- [Wariant Material UI z zapisanym scenariuszem](http://127.0.0.1:18437/preview/mui?scenario=5c7e08ce-1aa5-4707-86b2-c4451a13e326)

Testy interakcji korzystają z działającej instancji i zapisanego scenariusza.

```sh
cd frontend
SHAREDROP_TEST_URL=http://127.0.0.1:18437 npm run test:e2e -- route-previews
```
