# angular-compiler-ai — handover (2026-11-03, uzupełniony 2026-11-10)

Dokument startowy dla kolejnej sesji. Talk jest **przyjęty**: NG Poland, 17 listopada 2026, lightning talk 15:05–15:10 (5 minut), Warszawa + online. Strona: https://ng-poland.pl/speaker/2026/rafal-brzoska. Tytuł: **„Veni, Vidi, Compilavi: Teaching AI Agents to Use the Angular Compiler”**. Poprzednia wersja tego dokumentu (sesja z 2 października) jest w historii gita (`git show 172fcb9:SUMMARY.md`).


---

## 0. Stan na 2026-11-10 (czytaj najpierw; sekcje 4.2 i 6 poniżej są częściowo nieaktualne)

**Teza po 83 nagranych przebiegach** (pełna tabela zakresów: [bench/evidence.md](bench/evidence.md)):
- trzyma się: agent z ng-facts jest tańszy (7 z 8 par migracji, 2,2–4,6×), czyta ok. 1/3 kontekstu, a przy pytaniach o kod jest dokładniejszy (5/5 wobec 3/5); Haiku z narzędziem 3/3 poprawnie, bez 1/3;
- wycofane: „agent z grepem przepisuje edycje” (pisze skrypt), „koszt rośnie z repo” (30/120/480 komponentów: płasko), „7× szybciej” (czas ścienny jest losowy: ok. 1 przebieg na 5 wisi na własnym poleceniu agenta, w obu torach), „zawsze przewidywalnie” (raz tor z narzędziem kosztował $0,65);
- poprawione liczby: na starcie jest **700** błędów ngc, nie 1 400 (sędzia liczył każdą diagnostykę NG8002 podwójnie przez dopisek z adresem); skrypty kończą z 700 i 220.

**Nowe w repo:**
- `bench/claude-run.mjs` (wspólny runner), `bench/facts.mjs` (6 pytań o komponent), `scripts/generate-atlas.mjs` + `bench/atlas.mjs` (routowana aplikacja Castra: zasięg rażenia i przegląd dostępności), `bench/experiments.sh` (cała seria), `bench/evidence.mjs` → `bench/evidence.md`;
- `bench/agent.mjs`: `--experiment`, `--features`, `--task discover`, tory `own-codemod` i `tool-v2`, zapis id modelu i wersji CLI, tory domyślnie po kolei;
- `tool/ng-facts.mjs` to wersja 2: `where`, `unrouted`, `check`, przepis inline, blokada zapisu, weryfikacja po `--write`; wersja 1 zamrożona w `bench/tool-v1/`;
- `deck/`: źródła slajdów w repo; `evidence-slides.mjs` (slajdy liczbowe z `results/`), `five-min.mjs` (wersja 5-minutowa + `deck/script.md` z czasami zdań), `render.mjs` (offline HTML i PDF), `illustration-prompt.md` (zlecenia ilustracji dla Gemini).

**Decki:** pełny https://claude.ai/artifact/LUBidgW4YQJHVZdYEq1VZ8 (21 slajdów, zapas od „method”); pięciominutowy z notatkami prelegenta https://claude.ai/artifact/UX1vpPLU8gjRwKs5nroPPz (10 slajdów do mówienia, ok. 4:26, reszta jako zapas).

**Repo:** https://github.com/rbrzoska/ng-poland-2026 (publiczne, od 2026-11-13).

**Otwarte:** „spec” vs „recipe” na slajdach (Rafał nie potwierdził zmiany nazwy); mapa na okładce nadal z albumu; ilustracja „thank you” zawiera rozpoznawalne postaci z Asteriksa (decyzja Rafała); `[repo link]` to placeholder; Cursor CLI niezalogowany, więc brak drugiego harnessu; brak testu na prawdziwym repo; karta komponentu (`describe`) i hook po edycji szablonu niezrobione.

---

## 1. Warunki brzegowe talku (od Rafała)

- 5 minut, **wesoło**, z dowodami, z szybkim demo.
- **Demo offline** — na scenie nie można ryzykować sieci. Agentów nie puszczamy na żywo; pokazujemy nagrania prawdziwych przebiegów (tryb replay, sekcja 5), a tory deterministyczne (find & replace, regex, kompilator + spec, `ngc`, `ng build`) lecą naprawdę, lokalnie.
- Abstrakt na stronie obiecuje: agent z idealnymi instrukcjami i tak „czyta pliki i wypisuje tysiące edycji”; agent z kompilatorem opisuje zmianę w ~10 liniach; „live, measured race … 10× faster at less than half the cost”; dziesięć codziennych zastosowań. **Uwaga:** na regularnym fixture „10× szybciej” z października nie reprodukowało się (sekcja 4.1); na realistycznym fixture mediana z 3 przebiegów to **7,4× czasu, 3,1× kosztu, 7,2× tokenów wyjścia** (sekcja 4.2). Na scenie mówimy liczby z median i słowo „median” na głos.

## 2. Teza (po listopadowych pomiarach)

Agent AI w dużym repo Angulara nie ma za mało inteligencji, tylko za dużo musi przepuścić przez swój kontekst. Kompilator Angulara zna każdy element, binding, wyrażenie i import, więc może (1) odpowiadać na pytania o kod zamiast zrzutów plików, (2) wykonać zmianę opisaną jako dane, deterministycznie, (3) być sędzią. **„The agent decides. The compiler repeats.”** Skill (instrukcje) daje wiedzę; narzędzie zdejmuje z kontekstu pracę. Oba agenty w benchmarku dostają ten sam komplet reguł — różnica to wyłącznie narzędzie.

## 3. Co jest w repo (stan po tej sesji)

| Ścieżka | Co |
|---|---|
| [scripts/generate.mjs](scripts/generate.mjs) | Generator `fixture/` (biblioteka v2, 120 konsumentów v1) i `fixture-expected/` (klucz). **Nowe:** 6 stylów szablonów (canonical, compact z `'…'`, jeden atrybut na linię z `/>` w osobnej linii, `@for`, wyrażenia z `?.` `[]` `()` `&&`, dwa pille w jednej linii) i wabik `<app-pill-legacy>` (stary pill na v1, `<app-pill\b` go łapie). `FEATURES=N`, `OUT=<dir>` |
| [tool/ng-facts.mjs](tool/ng-facts.mjs) | `usages`, `rename-input`, `migrate` na TypeScript AST + `@angular/compiler`. **Nowe:** `!(a && b)` → `a && b` (zdejmowanie nawiasów), białe znaki/nowe linie przed `/>` przy zamianie na treść |
| [tool/specs/pill-v2.migration.json](tool/specs/pill-v2.migration.json) | Migracja Pill v1→v2 jako dane |
| [bench/score.mjs](bench/score.mjs) | Sędziowie: diff liniowy (LCS) **i nowy `semanticScore`** — AST szablonów z kompilatora porównywany element po elemencie (niewrażliwy na formatowanie, sprawdza też `imports` komponentu). `functionallyCorrect = ngc 0 && elementsWrong 0` |
| [bench/run.mjs](bench/run.mjs) | Benchmark deterministyczny → [bench/results.md](bench/results.md) (kolumny AST + „Functionally correct”) |
| [bench/agent.mjs](bench/agent.mjs) | Agenci headless (kosztuje API). **Nowe:** `--runs N`, oba tory równolegle, parsowanie `stream-json`, przechwycenie specyfikacji napisanej przez agenta (Write lub heredoc w Bash), `results/agent-<model>-run-<n>.json`, podsumowanie z medianami i zakresami `results/agent-summary-<model>.json` + `bench/agent-results-<model>.md`, **nagranie strumienia** `results/recordings/*.ndjson` i **patch z edycjami agenta** `*.patch` (do replay) |
| [results/](results/) | Wyniki i nagrania — **commitowane**, bo to dowody i paliwo demo offline |
| [ui/server.mjs](ui/server.mjs) | Serwer UI. **Nowe:** tryb **replay** (odtwarza nagranie najbliższe medianie z przyspieszeniem, nakłada patch agenta, potem prawdziwe `ngc`/diff/build), przechwycenie specyfikacji z logu, metryki AST, zapis ostatniego przebiegu do `results/ui-last-run.json` i odtworzenie po restarcie, `GET /api/results`, `summary`+`restored` w `/api/slides` |
| [ui/public/](ui/public/index.html) | UI: checkbox „Replay recorded agents (offline)” (domyślnie włączony), baner „restored”, kolumny „Elements wrong (AST)” i „Functionally correct”, blok „Spec written by the agent”, werdykt „functionally correct (formatting differs)”; **bez Google Fonts** (offline) |
| [ui/public/slides.js](ui/public/slides.js) | 18 slajdów w UI: wyniki z median (N przebiegów, zakresy), „4 lines. That was the job.” ze specyfikacją agenta, „A green build is not a correct build” (Cezar III.18), „Gallia est omnis divisa in partes tres” z 10 zastosowaniami przed slajdem końcowym |
| [gaul/](gaul/generate.mjs) | **Poboczny scenariusz, nie wchodzi do talku:** mapa Galii z lupą, 120 garnizonów, migracja `TentComponent` v1→v2 (`tool/specs/tent-v2.migration.json`). Zostawione jako eksploracja; grafiki z `gaul/assets/` są użyte w decku (poniżej) |

Komendy:
```bash
npm install
npm run demo                                   # generate + bench deterministyczny, ~6 s
npm run ui                                     # http://localhost:4310 , slajdy /slides
node bench/agent.mjs --runs 3 --model sonnet --budget 3   # agenci, kosztuje (~0,10–0,35 $ na tor)
```
W aplikacji Claude: konfiguracja `getafix-cauldron` w [.claude/launch.json](.claude/launch.json) (port 4310; `gaul-before`/`gaul-after` dla mapy).

## 4. Pomiary (Sonnet, listopad 2026)

### 4.1 Dlaczego fixture musiał się zmienić

Pierwsze dwa listopadowe przebiegi na **starym, regularnym** fixture: agent grep 52 s / 0,26 $ i 47 s / 0,17 $ (w październiku: 623 s / 0,90 $). Model nauczył się pisać sobie jednorazowy skrypt sed/perl zamiast klepać edycje — a regex wystarcza, gdy wszystkie 120 szablonów wygląda identycznie. Różnice u agenta grep to była wyłącznie kolejność w `imports` i formatowanie `Multi-line`. Wniosek: „10×” z października było artefaktem jednego przebiegu i regularnego fixture.

Dlatego fixture dostał 6 stylów i wabik `<app-pill-legacy>` (sekcja 3). Na nim deterministycznie:

| Tor | Linie poprawne / 640 | Złe linie | Błędy ngc | Elementy złe (AST) | Funkcjonalnie |
|---|---:|---:|---:|---:|:---:|
| find & replace | 0 | 1 600 | 700 | 940 | ✗ |
| careful regex | 220 | 280 | 220 | 460 | ✗ |
| **kompilator + spec** | **640** | 0 | **0** | **0** | ✓ — 440 elementów, 2 680 edycji, 170 plików, 80 importów, ~130 ms, 0 decyzji |

### 4.2 Agenci na realistycznym fixture (`bench/agent-results-sonnet.md`, mediany z 3 przebiegów)

| Agent | Czas (ściana) | Tury | Tokeny wejścia | Tokeny wyjścia | Koszt | Funkcjonalnie |
|---|---:|---:|---:|---:|---:|:---:|
| files + grep | **201 s** (59–742) | 13 (10–17) | 428 tys. (296–652) | **5 340** (5 086–7 818) | **0,22 $** (0,18–0,32) | 3/3 ✓ |
| + ng-facts | **27 s** (24–30) | 4 (4–6) | 130 tys. (129–165) | **745** (552–996) | **0,07 $** (0,07–0,08) | 3/3 ✓ |

**7,4× szybciej, 3,1× taniej, 7,2× mniej tokenów wyjścia, 3,3× mniej wejścia** (mediany z 3 przebiegów, 2026-11-03). Przebieg 3 toru grep trwał 742 s, bo agent czekał na własne zawieszone polecenie w tle (CLI wysłało dwa zdarzenia `result`; parser sumuje je i liczy czas do ostatniego — to była poprawka z tej sesji).

Obserwacje:
- **Obaj agenci kończą funkcjonalnie poprawnie** (0 błędów `ngc`, 0 różnic w AST) — także na pułapkach; Sonnet omija `<app-pill-legacy>` i wieloliniowe `/>`. Różnice u agenta grep w diffie liniowym to formatowanie (`Multi-line` w osobnej linii) i kolejność importów. Dlatego sędzią jest AST, nie białe znaki.
- Agent grep ma **dużą wariancję** (55 s → 198 s), bo czasem pisze skrypt, a czasem edytuje ręcznie; agent z narzędziem jest stabilny (20–26 s, 4–6 tur, ~0,07 $).
- **Cały output agenta z narzędziem to specyfikacja** — 4 linie JSON-a (slajd „4 lines. That was the job.”); narzędzie zamienia je w 2 680 edycji w ~130 ms.
- Tokeny wejścia: ~130 tys. vs ~300–650 tys. — agent z narzędziem nie czyta konsumentów, tylko bibliotekę v2 i `migrate --help`.

## 5. Demo na scenie (offline)

1. Przed wyjściem: `npm run ui`, otwórz http://localhost:4310 i `/slides`. Serwer startuje z ostatnim zapisanym przebiegiem (`results/ui-last-run.json`, baner „restored”), więc scoreboard jest widoczny od razu.
2. **Brew the potion** z zaznaczonym „Run Claude agents” i „Replay recorded agents (offline)”: prep (generate, `usages`, baseline 700 błędów) → 6 torów; tory agentów odtwarzają nagranie najbliższe medianie z `results/recordings/` z przyspieszeniem 10× (odstępy przycięte do 1,2 s), log pokazuje narzędzia, myśli, specyfikację; potem patch agenta, prawdziwe `ngc`, diff liniowy, diff AST, `ng build`, porównanie zbudowanych aplikacji i kontrakt. Całość ~2 min; na 5 minut lepiej wystartować przed talkiem i pokazać wynik, a na żywo kliknąć tylko „Open app” i slajdy.
3. Slajdy w UI (`/slides`) czytają mediany z `results/`; deck w Claude Designer jest statyczny (sekcja 6).
4. Bez sieci działa wszystko poza modelem: `claude` nie jest potrzebny w trybie replay; fonty systemowe.

## 6. Deck w Claude Designer

https://claude.ai/artifact/LUBidgW4YQJHVZdYEq1VZ8 — 11 slajdów, pergamin/tusz, `Bangers` + `Nunito Sans` + `JetBrains Mono`, mapa z lupą i wioską (okładka), cztery namioty = cztery pułapki (Totorum, Aquarium, Laudanum, Compendium), ciemny slajd „Ils sont fous, ces agents!”, specyfikacja, wyścig, czterech sędziów, „Gallia est omnis divisa in partes tres” (10 zastosowań), „By Toutatis — it works”. Deck jest prywatny do czasu udostępnienia. Do uzupełnienia ręcznie: `[repo link]` na ostatnim slajdzie, gdy repo będzie publiczne.

Grafiki (`gaul/assets/*.webp`) są własne/wygenerowane, bez oryginalnych kadrów Asteriksa; mapa (`map.webp`) pochodzi z albumu — **przed publikacją repo lub nagraniem podmienić** albo usunąć z decku.

## 7. Decyzje z tej sesji i dlaczego

- **Sędzia AST zamiast normalizacji białych znaków:** porównanie przez `parseTemplate` jest „kompilator jako sędzia” także w ocenie; nadmiarowe, nieużywane importy tylko raportuje (Angular sam tylko ostrzega), brakujące liczy.
- **Replay zamiast live na scenie:** zero ryzyka sieci; uczciwie podpisane w logu („replay · run N recorded … · 10× speed”), a edycje są prawdziwe (patch agenta), więc `ngc`/build/porównanie są prawdziwe.
- **Realistyczny fixture:** nie po to, by agent grep przegrał, tylko żeby regexy przestały być darmowe; Sonnet i tak sobie radzi — i to jest uczciwy wynik, który pokazujemy.
- **Tor „Compiler + spec” podpisany jako „execution only”:** 0,15 s to koszt wykonania gotowej receptury, nie całego zadania — ktoś ją musiał napisać (agent: ~27 s). W UI, slajdach, README i decku ten tor jest opisany jako część, którą agent z ng-facts deleguje, a nie jako zawodnik wyścigu.
- **Mapa Galii (`gaul/`) poza talkiem:** zbyt dużo na 5 minut; grafiki poszły do decku.
- **Schematics:** analiza w `~/projects/ai/analyses/2026-10-02-angular-schematics-vs-ng-facts.md` — `ng update` Angulara działa na tym samym kompilatorze (Tsurge); `ng-facts migrate` to „dynamiczny schematic”, którego recepturą jest JSON od agenta. Nie zastępować, ewentualnie opakować w schematic (1–2 h).

## 8. Znane problemy / ryzyka

- Agent grep ma wariancję 4× między przebiegami; mediana z 3 to minimum, przed talkiem warto dorzucić 2–3 przebiegi (`node bench/agent.mjs --runs 2`), summary i replay podniosą się same.
- `ng build` 5 torów po 2 naraz trwa ~1–2 min — na scenie pokazać gotowy stan.
- Replay wybiera nagranie najbliższe medianie czasu per tor (mogą pochodzić z różnych przebiegów).
- Stan serwera poza `ui-last-run.json` (logi, podglądy) ginie przy restarcie; podglądy wymagają ponownego buildu.
- Panel przeglądarki w aplikacji Claude jest wąski; slajdy skalują się, ale weryfikację wizualną najlepiej robić w pełnym oknie.

## 9. Backlog

1. 2–3 dodatkowe przebiegi agentów przed talkiem; ewentualnie Opus/Haiku dla porównania (`--model`).
2. Tor „skill bez narzędzia” vs „skill + narzędzie” jako jawne nazwy (dziś: oba agenty mają te same reguły w prompcie).
3. `ng-facts diff-api` — szkic specyfikacji z porównania v1/v2, żeby agent czytał jeszcze mniej.
4. Opakowanie `migrate --spec` w schematic (`ng g`/`ng update`).
5. Scenariusz GAUL-112 („pokażcie, gdzie są Rzymianie”) jako przykład codziennego zlecenia z faktami z kompilatora (`slots`, `describe`, `find --input-type`), jeśli talk urośnie powyżej 5 minut.
6. Publikacja repo + link na ostatnim slajdzie; podmiana mapy.

## 10. Jak zacząć nową sesję

1. `npm install`, `npm run demo` — generator, narzędzie i sędziowie.
2. `npm run ui` → sprawdź baner „restored”, kliknij Brew z replay → po ~2 min scoreboard i podglądy; `/slides` → slajd „Results · median of N runs”.
3. Przeczytaj ten plik, [README.md](README.md), `bench/agent-results-sonnet.md`.
4. Przy zmianie generatora: `node scripts/generate.mjs && npm run bench` musi dać 0/0/✓ dla kompilatora; nagrania w `results/recordings/` są związane z fixture — po zmianie generatora patche przestaną pasować i trzeba nagrać przebiegi od nowa.
