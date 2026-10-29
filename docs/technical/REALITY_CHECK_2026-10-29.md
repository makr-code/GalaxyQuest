# GalaxyQuest — Source-Code Reality Check

**Stand:** 29. Oktober 2026  
**Zweck:** Aktueller, evidenzbasierter Überblick über Implementierung, Integration und Verifikation. Dieser Bericht ersetzt keine vollständige Produktabnahme; er trennt sichtbaren Code von zurzeit nicht ausführbar verifizierten Aussagen.

## Kurzurteil

GalaxyQuest ist ein umfangreiches, feature-reiches Spielprojekt mit Backend-, Datenbank-, Frontend-, Rendering- und KI-Komponenten. Der Quellcode belegt, dass viele Systeme implementiert sind. Er belegt für sich allein aber weder einen vollständig integrierten Spielablauf noch Produktionsreife. Eine Gesamt-Prozentzahl wäre mit der aktuellen Evidenz nicht belastbar.

**Arbeitsstatus:** laufende Entwicklung / Integrations- und Verifikationsbedarf.  
**Release-Status:** hier nicht nachgewiesen.

### Lokaler Betriebsstand nach Backend-Reparatur

Die vorhandenen Compose-Container `galaxyquest-web`, `galaxyquest-db` und
`galaxyquest-tts` waren gestoppt und wurden wieder gestartet. Apache ist jetzt
an `127.0.0.1:8081` gebunden; Vite auf Port 8080 leitet PHP-Anfragen dorthin.
MySQL nutzt unveraendert das bestehende persistente Volume und Host-Port 3307.
Mit ausdruecklicher Freigabe wurden nach DB-Sicherung gezielt die Migrationen
fuer Fraktionswelten, Registrierungs-Drafts, Portraits und deren fehlende
Fog-of-War-Voraussetzung angewendet und die konfigurierten Fraktionswelten
angelegt. Keine pauschale Anwendung aller weiteren Migrationen.
Die folgenden historischen Hinweise auf nicht migrierte bestehende
Installationen gelten damit nicht mehr fuer diese lokale Compose-Datenbank.
Direkter und ueber Vite erreichbarer Fraktionskatalog: HTTP 200, vier politische
Fraktionen, sechs Spezies. Im geteilten Browser gelangen Fraktionswahl und
private Systemreservierung bis zur Spezieswahl ohne Registrierungsfehler.
Dies prueft nicht die weiterhin fehlende Tutorial-/E-Mail-Aktivierung.

## Neue Zielvorgabe fuer die Registrierung

Der Nutzer hat den bisherigen Formular-Wizard durch einen **spielbaren Prolog vor
der Kontoaktivierung** als Ziel ersetzt. Massgeblich ist jetzt
[Onboarding-Design v2](../gamedesign/ONBOARDING_PROLOGUE_DESIGN.md#0-massgeblicher-zielablauf-spielbarer-prolog-vor-der-registrierung):
gesprochener Galaxy-Teaser, vier politische Fraktionen, unabhaengige Spezieswahl,
Charakter/Portrait, isoliertes Planeten-Tutorial und erst danach E-Mail mit
Einmal-Startpasswort und Verifikationslink.

Der Formular-Wizard ist jetzt aus dem aktiven Einstieg entfernt. Registrierung
oeffnet einen statisch in HTML vorbereiteten Vollbild-Prolog ueber derselben
WebGPU-Galaxy. Startmenue, Musikbedienung und Status/Logs verschwinden; Back
stoppt Kapitel-Audio und Animationen und stellt beim Verlassen das Menue wieder her.
Vier spoilerfreie Lorekapitel fuehren zu vier politischen Fraktionsvorstellungen,
zentralen Symbolen, sechs unabhaengigen Spezies und einem privaten Charakter-Draft.
Regionen verwenden weiterhin die bestehenden NPC-Hauptwelten als Anker.
Die politische Wahl steht separat im Snapshot; der bestehende `faction_id`-
Fremdschluessel bezeichnet den NPC-/Geographieanker, nicht die Spezies des Spielers.
Eine neue Fraktion verwirft den bisherigen Draft; eine neue Spezies invalidiert
abhaengige Charakter-/Tutorialdaten. Gleiche Wahlen erhalten den Charakter.
Drafts laufen weiterhin nach zwei Stunden ab; dies ist keine endgueltige
Tutorial-Aufbewahrungsregel.

**Mitgefuehrter Registrierungsflug und Dialognavigation:** Alle Teaser- und
Fraktionsvorstellungen besitzen sofort Zurueck/Weiter. Eine manuelle Navigation
beendet alte Sprache und Timer, statt auf deren Abschluss zu warten.
Fraktions-/Spezieswahl und Charakterspeicherung bleiben verpflichtend.
Die DB-Fraktionsgebiete werden schon bei ihrer Vorstellung angeflogen.
Nach Fraktionsbestaetigung wird das private Startsystem reserviert und waehrend
der Spezieswahl gezeigt; der Charakterbildschirm zeigt den reservierten Planeten.
Nach dem Speichern folgt ein expliziter Flug zur privaten Landeplatz-Vorschau.
Back fuehrt denselben Canvas rueckwaerts durch die Massstaebe.
Ein zusaetzlicher nativer WebGPU-Renderpass nutzt dasselbe Device und denselben
Frame-Loop; es entsteht kein zweiter Renderer. Neue Drafts enthalten physische
Sonnen-/Planetendaten aus dem Systemgenerator. Orbitprojektion und Phasen sind
schematisch, Oberflaechengrafik prozedural, kein fertiges Terrain-/Bausystem.
Reduzierte Bewegung setzt die Darstellung unmittelbar. Der Schritt zum noch
fehlenden Tutorial ist sichtbar gesperrt, statt einen Erfolg vorzutaueschen.

**Keine vorzeitige Aktivierung:** `register` und `register_complete` liefern
serverseitig HTTP 503. Auch der alte Service-Abschluss ist gesperrt.
Es gibt keinen neuen User, Login, aktive Kolonie oder Economy-Fortschritt.
Bestehende Logins und Resume bleiben davon unabhaengig.

Gastnarration akzeptiert ausschliesslich serverdefinierte Kapitel-IDs und liefert
bereits vorbereitete MP3-Clips aus dem vorhandenen TTS-Cache. Gaeste koennen weder
Freitext noch Stimmen oder Synthese erzwingen. Vorbereitung mit
`php scripts/render_onboarding_narration.php` bei aktiviertem Piper-/XTTS-Dienst.
Text und Voice-Konfiguration muessen beim Deployment zum vorbereiteten Cache passen.
Fehlende Clips oder blockierte Wiedergabe werden sichtbar gemeldet; der Text
laeuft mit Lesezeit weiter. Kapitelwechsel und Back brechen ausstehende Requests ab.
Der vorhandene authentifizierte TTS-Endpunkt bleibt unveraendert.

**Private Portrait-Anbindung:** Der Charakterbildschirm kann nach dem Speichern
eine Generierung beim vorhandenen SwarmUI-Dienst anfordern. Die Speziesdesigns
liefern die Morphologie; der Generator legt keinen User an. Bildbytes bleiben
in der neuen Tabelle `registration_portraits` und werden nur sessiongebunden
mit `private, no-store` ausgeliefert. Nicht passende Identitaetsrevisionen,
abgelaufene Drafts und fremde Sessions erhalten kein Bild. Neue Charakterdaten
invalidieren ein altes Portrait auch dann, wenn spaeter wieder derselbe Name
eingetragen wird. Temporaere Download-Dateien werden im `finally` entfernt.
Die neue Migration ist im Manifest, wurde aber nicht auf bestehenden
Installationen ausgefuehrt.

Generierungsstatus und Fehler sind persistent. Doppelte laufende Auftraege
werden abgewiesen; drei Versuche je Draft, 30 Sekunden Cooldown und zehn
Auftraege je IP/Stunde begrenzen Gastanfragen. Eine fuenfminuetige Lease macht
abgebrochene Auftraege wieder erkennbar. HTTP-Generierung, keine dauerhafte
Worker-Queue; eine Browsernavigation kann die sichtbare Antwort verwerfen,
ohne eine bereits laufende SwarmUI-Berechnung zu stoppen.

**Noch offen:** Echte Spezies-/Habitatregeln, Boni/Mali,
authoritatives Oberflaechen-Baututorial, Mailversand, Verifikationslink und
Einmal-Startpasswort mit erzwungenem Passwortwechsel. Das Charakterformular meldet
diese Grenze ausdruecklich. Der Game-Guide mit Mock-Fortschritt ist kein Ersatz.
Bestehende Datenbanken wurden nicht migriert.

Verifikation dieses Prolog-Zwischenstands:
- 42 gezielte Vitest-Tests fuer Startmenue, Prolog, Audio-UI, Announcements und
  WebGPU-Kameravorschau bestanden.
- Frische isolierte MySQL-8.4-Datenbank: 83 Assertions fuer politische Fraktionen,
  unabhaengige Spezies, private Charakterdaten, Invalidierung, Reservierung,
  Ablauf, Rate-Limit, private Portraitbytes, konkurrierende/verspaetete Auftraege,
  ungueltige/uebergrosse Bilder und ausbleibende Weltaktivierung bestanden.
- Vite-Produktionsbuild und Syntaxpruefung der betroffenen PHP-Dateien bestanden.
- 22 Chromium-Flows bestanden: 19 Startmenue-/Darstellungspruefungen mit
  API-Mocks sowie drei gegen die isolierte PHP/MySQL-Instanz, darunter ein
  vollstaendiger Browserdurchlauf bis zum persistierten Charakter-Draft.
  Sprachwiedergabe wurde dabei nicht durch echte TTS-Clips nachgewiesen.
- Der Portrait-Erfolgspfad wurde im vorherigen Portrait-Prueflauf mit einer isolierten synthetischen
  SwarmUI-Fixture geprueft: echter PHP-Client, Prompt-/Speziespruefung, Download,
  Bildvalidierung, DB-Speicherung, privater Bildabruf und Invalidierung.
  Die Fixture erzeugt nur ein Testbild, kein KI-Portrait. Der lokale reale
  SwarmUI-Dienst auf Port 7801 war nicht erreichbar; keine visuelle
  KI-Qualitaetsabnahme behauptet. Der deaktivierte Dienst wurde separat als
  sichtbarer HTTP-503-Fehler statt erfolgreichem Platzhalter geprueft.
  Dieser optionale Fixture-Test wurde im aktuellen Flug-Prueflauf ausgelassen.
- Echter WebGPU-Browser: derselbe Galaxy-Canvas bleibt sichtbar, keine weiteren
  Startmenue-Bedienelemente bleiben im Prolog sichtbar.
  Der Registrierungs-Shader kompiliert ohne WGSL-Fehler; Planet und
  Oberflaechenhorizont wurden mit separaten Vorschau-Daten direkt am nativen
  Renderer dargestellt. Das ist getrennt von den API-/UI-Tests zu bewerten,
  kein Nachweis echter Planetenbilder oder eines spielbaren Tutorials.
- Lokaler TTS-Dienst auf Port 5500 war nicht erreichbar. Damit keine echten
  Sprachclips erzeugt und keine gesprochene Lore hoerabgenommen; Textfallback
  und Audio-Lifecycle werden getrennt mit Testdoubles geprueft.

## Was im aktuellen Quellcode nachweisbar ist

| Bereich | Beobachtung im Checkout | Einordnung |
|---|---|---|
| Aktiver Frontend-Einstieg | [`index.html`](../../index.html) lädt `js/main.js` als ES-Modul. Dieser Composition Root lädt Auth und Starfield als Module; die zwölf Domain-Initialisierer starten erst nach erfolgreicher Authentifizierung. | Die aktuelle App-Einstiegsroute ist nicht der frühere `js/runtime/game.js`-Pfad. |
| Startmenü | Schriftzug, Hauptmenü, Inhaltsdialog, Credits und Status-/Logleiste stehen in `index.html`. Login und Dev-Tools verwenden inaktive HTML-Templates und Kaskadenpanels. Registrierung öffnet stattdessen den separaten filmischen Draft-Prolog. | Eine serverseitig bestätigte Session zeigt Resume, startet aber nicht automatisch das Spiel. Browser-Tests verwenden API-Mocks; echte Auth-/Datenbank-Abnahme bleibt separat erforderlich. News und Blog verweisen auf vorhandene Projektinhalte und kennzeichnen fehlende Feeds ausdrücklich. |
| Galaxy-Hintergrund | Das Hauptmenü verwendet ausschließlich WebGPU: zunächst 9000 prozedurale Sterne in vier Spiralarmen, anschließend stufenweise `auth_stars`-Daten in deren gespeicherten Koordinaten. Die Übersicht rotiert, statt den bisherigen Cruise-HUD/Flugtreiber zu starten. | Sichtbare Spirale, fortschreitende Frames, Rotation, Pause durch reduzierte Bewegung und fehlerfreie WGSL-Kompilierung wurden im WebGPU-fähigen Browser geprüft. Ohne WebGPU bleiben Menü und Auth bedienbar; die Statusleiste meldet den fehlenden Hintergrund, ohne einen Legacy-Renderer zu laden. Der lokale Vite-Server führt PHP nicht aus: reale Sterne sind in diesem Lauf nicht nachgewiesen. |
| WebGPU-Migrationsstand | Der Spiel-Boot wählt jetzt explizit WebGPU als Standard. Zoom-Level können unabhängig von einer Three.js-Gegenimplementierung registriert werden; Three.js wird nur noch als expliziter Kompatibilitätspfad für Nicht-WebGPU-Backends ausgewählt. | Der WebGL-Fallback ist weiterhin automatisch verfügbar. Die WebGPU-Level und deren funktionale/visuelle Parität sind noch nicht vollständig Ende-zu-Ende abgenommen. |
| Spiel-Backend | APIs für Auth, Galaxie, Flotten, Wirtschaft, Krieg, Kolonisierung, NPC und weitere Bereiche sind vorhanden. | Dateivorhandensein ist kein Nachweis für erfolgreiches Zusammenspiel mit Datenbank und UI. |
| Rendering | Native WebGPU-Zoom-Renderer sind für Galaxy, System, Planet, Colony und Object Approach vorhanden. Der Gameplay-Boot übergibt den Galaxy-WebGPU-Renderer jetzt als gemeinsames Backend; Zoom-Level beziehen Device und Canvas-Kontext daraus, und der Orchestrator verwendet dessen Frame-Hook statt eines zweiten Renderloops. Object Approach zeichnet seine prozedurale Geometrie in einem zusätzlichen Pass über dasselbe WebGPU-Device und denselben Canvas-Kontext. Three.js-Renderer und separate Viewer bleiben im Repository; der generische `engine/core/WebGPURenderer` ist weiterhin ein Grundgerüst. | Gemeinsame Ownership und Mesh-Pass sind durch gezielte Unit-Tests abgedeckt. Echte Gameplay-Transitions, GPU-Validation und visuelle Parität sind noch nicht verifiziert; Legacy-Entfernung ist offen. |
| AI/LLM und NPC | Ollama-/LLM-Endpunkte und NPC-Integrationen sind vorhanden; die README dokumentiert optionale lokale Nutzung. | Verfügbarkeit und Verhalten externer Laufzeitdienste wurden hier nicht geprüft. |
| Toolchain | `package.json` definiert Vite, Vitest und Playwright sowie Projektabhängigkeiten. | Die frühere README-Aussage „No Build Step“ und „No dependencies“ war nicht mehr zutreffend und wurde aktualisiert. |
| CI | Der Workflow führt Vitest, PHPUnit und einen Playwright-Smoke-Test aus. | Der aktuelle lokale Arbeitsstand wurde nicht durch einen vollständigen CI-Lauf bestätigt. Die Lint-Schritte sind laut Workflow nicht strikt blockierend. |

Der Domain-Bootstrap in `js/main.js` stellt bei fehlenden EventBus-/Repository-Objekten weiterhin Fallbacks bereit und fängt Fehler einzelner Domain-Initialisierer ab, um mit weiteren Domänen fortzufahren. Ein sichtbarer „Ready“-Log darf deshalb nicht allein als Beleg für einen vollständig funktionsfähigen Spielzustand gewertet werden.

## Verifikation in dieser Arbeitskopie

- Branch: `develop`
- HEAD zum Prüfzeitpunkt: `8a053a6` (`2026-08-30`, ComfyUI-Workflow-Änderung)
- Die Arbeitskopie enthielt zahlreiche nicht eingecheckte Änderungen, unter anderem an Auth-, Window-Manager-, NPC-Dialogue-, Rendering- und ComfyUI-Dateien. Der hier beschriebene Checkout war daher kein sauberer Release-Snapshot.
- Vor der Testkorrektur liefen bei einem gezielten Vitest-Lauf drei der vier ausgewählten Dateien erfolgreich: **32 Tests bestanden, ein Test fehlgeschlagen**. Ursache: [`runtime-module-wiring-audit.test.js`](../../tests/js/runtime-module-wiring-audit.test.js) erwartete `js/runtime/game.js`, obwohl der aktive Einstieg `js/main.js` ist.
- Der Wiring-Test wurde auf die aktuelle ES-Modul-Bootsequenz umgestellt. Danach liefen die vier fokussierten Dateien erfolgreich: **33/33 Tests bestanden**.
- Seit der ersten Bestandsaufnahme ist die Auth-/Renderer-Migration auf den Modulpfad umgesetzt: `index.html` lädt Auth und Starfield nicht mehr per klassischen Script-Tags. [`runtime-module-loader.js`](../../js/runtime/runtime-module-loader.js) bildet Auth-, Window-Manager-, Audio- und Renderer-Abhängigkeiten explizit auf bundelbare ES-Module ab. Auth signalisiert `gq:authenticated`; erst danach startet der Domain-Boot.
- Die aktuelle gezielte Verifikation nach der Migration: **43/43 Vitest-Tests bestanden** über fünf Boot-/Window-/Renderer-nahe Dateien. Der Vite-Build ist erfolgreich und enthält separate Chunks für Auth-Runtime-Abhängigkeiten, Window-Manager, Three.js und Renderer.
- Devserver und Produktions-Preview wurden im Browser geöffnet. Beide Seiten erreichten den Auth-Screen; Auth-Status, WM, Renderer und Starfield-Control waren vorhanden, klassische Auth-/Starfield-Script-Tags fehlten, und es wurden keine JavaScript-Fehler im App-Debug-Log festgestellt. E2E mit erfolgreichem Login war mangels PHP-/Datenbank-Stack nicht möglich.
- Die Test-Triage hat fehlerhafte Teststruktur und veraltete Erwartungen korrigiert: fehlende Blockabschlüsse in Economy-/Runtime-/War-Tests, ein nicht definierter Market-Tab-Status im Economy-Renderer, `pops`-Erwartungen trotz des aktuellen `popClasses`-Modells, ein Null-Intensity-Fallback im Ownership-Aura-Pass und Vitest-4-veraltete `done`-Callbacks. Die Bloom-Parameter-Builder lesen unveränderte dynamische Werte nicht mehr vorzeitig aus gecachten Defaults; Float32-Prüfungen verwenden Toleranzen.
- Der letzte vollständige Vitest-Lauf vor dem Startmenü-Umbau war **grün: 115/115 Testdateien und 3294/3294 Tests bestanden**. Die Colony-Buildings-API-Fassade wurde um fünf im Renderer benötigte Methoden ergänzt; der API-Test prüft Endpunkte, HTTP-Methoden und Mutation-Payloads. Die sechs gezielt erneut geprüften Economy-/War-/Rendering-Suites bestanden **400/400 Tests**. Der Normal-Map-Test validiert repräsentative Werte statt hundertertausend einzelner Assertions und bleibt damit unter dem Standard-Timeout.
- Während des Voll-Laufs gibt jsdom weiterhin Meldungen aus, dass `HTMLCanvasElement.getContext` ohne Canvas-Paket nicht implementiert ist; diese Meldungen verursachen aktuell keine fehlgeschlagenen Tests. Sie sind kein Nachweis für Canvas-Verhalten in einem echten Browser.
- `npm run vite:build` war nach der Migration und erneut nach der Test-Triage erfolgreich. Die Konfiguration wurde in `vite.config.mjs` umbenannt; der Build läuft seitdem ohne die vorherige ESM-/CommonJS-Warnung. Im früheren Browser-Preview gab es keine App-JavaScript-Fehler; beobachtet wurden die bereits bestehende NPC-Dialogue-Abhängigkeitswarnung und ein fehlendes `favicon.ico` (404).
- Nach der Landingpage-Änderung war `npx vite build` erfolgreich. Vier gezielte Renderer-/Loader-/Wiring-Testdateien bestanden; der anschließende Voll-Lauf bestand **3280/3280 Tests**.
- Im Docker-served Browser blieben Login und Registrierung sichtbar, WebGPU wurde als aktives Backend gemeldet und alle drei `auth_stars`-Requests wurden erfolgreich beantwortet. Die geladene Szene endete mit 685 realen Sternen. Nach Korrektur der Treiberwahl bewegten sich Kamera und Pan-Werte; die Flugzeit und Geschwindigkeit stiegen fortlaufend. Es wurde kein erfolgreicher Login- oder Gameplay-Flow behauptet.
- Beim aktuellen Browser-Recheck war der WebGPU-Renderer bereit und zeichnete Frames, aber `setAuthVisible()` hatte wegen eines falschen `resolveGameSection()`-Fallbacks die `#wm-galaxy-section` mit `.hidden` ausgeblendet. Damit hatten Galaxy-Host und Canvas jeweils `0×0` CSS-Pixel. `#wm-galaxy-section` ist die gemeinsame Hintergrund-Stage, nicht das Spiel-UI; beide Auth-UI-Auflösungen schließen sie nun als Game-Sektion aus. Zusätzlich wurde der nicht unterstützte WebGPU-Primitive-Topology-Wert `point-list` durch instanzierte, runde Stern-Quads ersetzt. Nach Reload im lokalen Vite-Browser: Stage/Host/Canvas jeweils **1060×728 CSS-Pixel**, Canvas-Backing **1325×910**, WebGPU aktiv, **1200** prozedurale Sterne, Frame-Tick steigend, keine Browser-Fehler. Der lokale Vite-Server liefert für `auth_stars` HTML statt JSON, daher keine Aussage über reale Galaxiedaten aus diesem Lauf.
- Für den Auth-/Galaxy-Fehler bestanden drei gezielte Vitest-Dateien mit **6/6 Tests**; `npm run vite:build` und `git diff --check` über die betroffenen Dateien waren erfolgreich.
- Nach dem Startmenü-Umbau bestanden sechs gezielte Vitest-Dateien mit **24/24 Tests** und [`start-screen.spec.js`](../../tests/e2e/start-screen.spec.js) mit **7/7 Chromium-Tests**. Abgedeckt sind Lazy-Login, Formularreset, vier Registrierungsschritte inklusive API-Fehler, gültige und abgelaufene Resume-Sessions, explizite Übergabe an den bisherigen Shell-Boot, 2FA-Abbruch/Wiederöffnung, sichtbarer Login-Fortschritt und Escape-Sperre während einer Anfrage, mobile Inhaltsdialoge/Logs und fehlendes WebGPU ohne Legacy-Nachladen. Die Auth-API wird dabei gemockt; diese Tests belegen keinen vollständigen Gameplay-Ablauf gegen PHP/MySQL.
- Der Produktionsbuild (`npm run vite:build`) bestand nach dem Umbau. Die bestehenden backendabhängigen Browser-Tests öffnen jetzt zunächst den Login-Menüpunkt beziehungsweise Resume; ihre Test-Discovery wurde geprüft, sie wurden hier nicht gegen PHP ausgeführt. Die letzte vollständige Vitest-Suite stammt weiterhin aus der vorherigen Phase.
- Browser-Recheck des neuen Hauptmenüs: **9000 Sterne**, aktives WebGPU, steigender Frame-Zähler, sichtbare rotierende Spirale auf einem **1064×674 CSS-Pixel** großen Canvas, pausierende Rotation bei reduzierter Bewegung und **keine WGSL-Kompilierungsfehler**. Gameplay-Window-Hosts werden auf der Auth-Seite ausgeblendet. Die Menü-Animationseinstellung kann die Systemvorgabe ausdrücklich überschreiben; Audio verwendet den vorhandenen gemeinsamen AudioManager. Bei PHP-HTML statt API-JSON erscheint ein Sessionprüfungsfehler statt eines vermeintlichen erfolgreichen Logins.
- Nachkorrektur des Hintergrunds: CSS-Fläche und GPU-Clear sind schwarz. Ein eigener sichtbarer Hinweis sowie die Statusleiste unterscheiden prozedurale Ladepunkte ausdrücklich von DB-Samples. Nichtleere DB-Samples ersetzen die Ladepunkte vollständig, sie werden nicht mit ihnen vermischt. Bei leerer oder fehlgeschlagener API bleibt die prozedurale Ansicht entsprechend gekennzeichnet. Die Rotation läuft jetzt mit negativem Winkel (in dieser Projektion im Uhrzeigersinn), damit die nach außen zu positiven Winkeln gewundenen Lade-Spiralarme nachlaufen statt vorauseilen. Das bleibt eine beschleunigte, starre Menüanimation, keine physikalische Simulation oder Auswertung der DB-Rotationsmetadaten.
- Diese Nachkorrektur bestand **17/17 fokussierte Unit-Tests**, den Produktionsbuild und **9/9 Chromium-UI-Tests**. Die beiden neuen Browserfälle prüfen schwarze CSS-Flächen, Datenquellenhinweise und vollständigen Punktaustausch mit API-/Renderer-Testdoubles (der separate Testbrowser bietet kein WebGPU). Im zusätzlichen WebGPU-fähigen Browser wurden schwarzer Hintergrund, 9000 als prozedural gekennzeichnete Punkte und die negative Winkeländerung eines echten GPU-Frames bestätigt. Echte DB-Daten wurden dabei nicht geladen.
- Die prozedurale Ladegalaxie verwendet jetzt einen separaten, testbaren Generator: warmer Zentralbulge, radial abfallende exponentielle Scheibenverteilung, vier logarithmische Spiralarme mit 18 Grad Pitch, gaußverteilte Streuung mit nach außen abnehmender physischer Armbreite und eine diffuse Zwischenarm-Population. Größe, Farbton und Leuchtstärke variieren; additive weiche Sternprofile erzeugen das helle Zentrum. Diese visuellen Eigenschaften sind keine gemessenen DB-/Spektraldaten. Die bestätigte starre Menürotation bleibt bestehen; DB-Samples ersetzen weiterhin die komplette Ladeansicht. Außerhalb des Menümodus bleiben Standardfarbe, Punktgröße und Alpha-Blending erhalten.
- Verifikation dieser Gestaltung: **13/13 Tests in vier fokussierten Vitest-Dateien**, **9/9 Chromium-UI-Tests** und Produktionsbuild bestanden. Statistische Tests prüfen Oberflächendichte, lichtgewichtete warme Zentralfarbe und schmalere äußere Arme. Der echte WebGPU-Browser zeigte 9000 Instanzen mit fehlerfrei kompiliertem WGSL; eine Pixelmessung des Canvas bestätigte ein deutlich helleres Zentrum (mittlere RGB-Helligkeit ca. 128/255 gegenüber ca. 1,16/255 in einem äußeren Ring). Die UI-Tests bleiben API-/teilweise Renderer-gemockt.
- Login inklusive 2FA öffnet nun als nichtmodales Kaskadenpanel direkt rechts neben dem Login-Button, mit passendem transparentem Verlauf und eckiger Kontur. Bis 900 CSS-Pixel Bildschirmbreite wird es im Layout direkt darunter eingefügt und schiebt die übrigen Menüpunkte nach unten. Register und Dev bleiben modale Dialoge. Erneuter Klick, Escape, Close oder Interaktion außerhalb schließen das Login-Panel; laufende Auth-Anfragen verhindern weiterhin das Schließen oder Umschalten. Der Button meldet seinen Zustand über `aria-expanded`, der Fokus kehrt beim Schließen zurück. Zehn Chromium-Flows mit API-Mocks einschließlich Desktop-/Mobilposition, 2FA und laufendem Login sowie der Produktionsbuild bestanden; das Desktop-Panel wurde zusätzlich visuell im Browser geprüft.
- Anschließend wurde derselbe Kaskadenpfad auf Register, News, Blog, Settings und Dev erweitert. Die frühere Beschränkung auf Login ist damit aufgehoben. Nur ein Panel ist gleichzeitig offen; Resume bleibt eine direkte Aktion. Elf Chromium-Flows einschließlich aller Desktop-/Mobilpositionen waren vor der Announcement-Erweiterung grün.
- Serverankündigungen sind als separates, schließbares Overlay im HTML vorhanden. Beim Start werden aktive Nachrichten öffentlich geladen. Neue IDs öffnen das Overlay einmal pro Browserprofil (localStorage); bekannte Nachrichten bleiben über **Server messages** aufrufbar. Eine laufende Formulareingabe wird nicht unterbrochen; zurückgestellte Meldungen können nach Schließen des Panels erscheinen. Schließen bestätigt keine Spielberechtigung und sperrt weder Login noch Resume. Fehler, leere Nachrichtenlisten und fehlender lokaler Speicher werden ausdrücklich gemeldet; keine Demo-Nachrichten werden erzeugt.
- Verifikation nach beiden Erweiterungen: **16/16 Vitest-Tests**, **12/12 Chromium-Flows mit API-Mocks**, **4/4 isolierte PHPUnit-Tests mit 19 Assertions** für persistente Speicherung, Validierung, Sortierung und Zurückziehen. PHP-Syntax und Produktionsbuild sind geprüft. PHP-Tests liefen mit dem vorhandenen PHP-8.2-Containerimage, ohne Netzwerk und ohne bestehenden Datenbankserver. Echte Admin-/CSRF-HTTP-Aufrufe und die MySQL-Migration wurden hier nicht gegen den laufenden Projektstack ausgeführt.

### Serverankündigungen betreiben

- Vor Nutzung muss [`migrate_server_announcements_v1.sql`](../../sql/migrate_server_announcements_v1.sql) über den bestehenden Migrationsprozess angewendet werden. Die Migration ist am Ende des [`migrations_manifest.php`](../../config/migrations_manifest.php) registriert; sie wurde **nicht** auf die bestehende Datenbank angewendet. Ohne Tabelle meldet die API einen Fehler, keine erfolgreiche leere Liste.
- `GET /api/v1/server_announcements.php?action=list` ist öffentlich und liefert `{ success: true, announcements: [...] }` mit höchstens 50 aktiven Meldungen, neueste zuerst. Alle veröffentlichten Inhalte sind ausdrücklich öffentlich, auch vor Login.
- `POST /api/v1/server_announcements.php?action=publish` benötigt eine bestehende Adminsession und `X-CSRF-Token`. JSON: `{ "title": "…", "message": "…", "severity": "important" }`. Erlaubte Schweregrade: `important`, `maintenance`, `critical`. Titel maximal 160 UTF-8-Bytes, Text maximal 10000 Bytes; beide dürfen nicht leer sein.
- `POST /api/v1/server_announcements.php?action=withdraw` verwendet dieselben Schutzmaßnahmen und JSON `{ "id": 123 }`. Zurückgezogene Meldungen bleiben gespeichert, werden aber nicht mehr öffentlich ausgeliefert. Inhaltliche Änderungen werden als neue Meldung veröffentlicht und die alte zurückgezogen, damit die neue ID wieder angezeigt wird.
- Meldungstexte werden ausschließlich als Text dargestellt, nicht als HTML. Der Lesestatus gilt für das Browserprofil, nicht serverseitig pro Account. Laden erfolgt beim Seitenstart sowie manuell über **Refresh messages**, nicht als Echtzeit-Push. Bei deaktiviertem localStorage ist dauerhafte Einmalanzeige nicht möglich; die Oberfläche meldet das.
- Veröffentlichung und Zurückziehen erfolgen derzeit über die geschützte API, nicht über einen neuen Admin-Editor.
- Die Flugkorrektur verhindert, dass die Auth-Seite den geteilten Three.js-Kameratreiber mit der nativen WebGPU-Kamera verwendet: deren Position ist ein einfaches Objekt ohne `clone()`-Methode. Die lokale Bezier-Flight-Implementierung übernimmt diesen Fall.
- Der Zoom-Bootstrap übergibt nun unabhängig vom Qualitätsprofil `webgpu` als Renderer-Hinweis. Das Registry-Verhalten wurde so erweitert, dass WebGPU-only-Level registriert werden können; fehlt bei einem Nicht-WebGPU-Backend eine explizite Three.js-Kompatibilitätsklasse, schlägt die Auflösung mit einem konkreten Fehler statt mit einer falschen Auswahl fehl. Die passenden Regressionstests und der vollständige Vitest-Lauf sind grün.
- Der Gameplay-Zoom-Bootstrap erstellt den Galaxy-Renderer jetzt als gemeinsames Backend für den Orchestrator. Galaxy-/System-Level übernehmen dieselbe Instanz; Planet-/Colony-Level leihen deren Device und Canvas-Kontext. Der gemeinsame native Renderloop treibt den Orchestrator über Frame-Hooks an. Der Runtime-Zoom-Boot darf kein zweites Backend über `RendererFactory` erzeugen, wenn die gemeinsame Instanz fehlt. Gezielte Tests prüfen Wiederverwendung und Frame-Hook-Cleanup; Browser-Transitions und GPU-Validation nach dieser Umstellung sind noch nicht verifiziert.
- Object Approach erzeugt Box-, Zylinder-, Polyeder- oder Torus-Geometrie als GPU-Vertex-Buffer und rendert sie nach dem Galaxy-Pass mit `loadOp: load` über die gemeinsame WebGPU-Canvas-Context. Die Fassade delegiert Mesh-Erstellung, Rotation, Rendering und Freigabe an denselben nativen Renderer. Die gezielte Playwright-WGSL-Kompilierungsprüfung für den neuen Shader wurde gestartet, aber wegen fehlendem `navigator.gpu` im Testbrowser übersprungen; eine GPU-/Browser-Abnahme bleibt erforderlich.
- Nach der Single-Renderer- und Object-Mesh-Änderung bestanden die vollständige JavaScript-Suite **115/115 Testdateien und 3294/3294 Tests**; `npm run vite:build` war erfolgreich. Die fokussierten Tests decken zusätzlich ab, dass der Boot das gemeinsame Backend als verpflichtend markiert, die WebGPU-Fassade Device/Kontext/Capabilities/Frame-Hook/Mesh-API weiterreicht und Planet-/Colony-Level weder neue Adapter anfordern noch das geliehene Device zerstören. `git diff --check` über die gesamte Arbeitskopie meldet weiterhin bereits vorhandene Leerzeichen in `index.html`; die Single-Renderer-Dateien selbst sind davon nicht betroffen.
- Nach expliziter Zustimmung wurde der vorhandene Compose-Stack für Backend-Prüfungen gestartet. Die Web-URL antwortete mit HTTP 200, TTS `/health` war erreichbar und MySQL meldete `healthy`. Der vollständige PHPUnit-Lauf bestand **664/664 Tests mit 2492 Assertions**; drei Tests wurden übersprungen. PHPUnit meldete **67 Deprecations**. Die beiden geänderten PHP-Dateien bestanden `php -l`.
- Die Colony-Buildings-Renderer-Aufrufe hatten zuvor keine Methoden im zentralen API-Wrapper. Die fünf Methoden sind nun vorhanden und durch den vollständigen Vitest-Lauf abgedeckt. Ein gezielter PHPUnit-Lauf für `ColonyBuildingsTest` und `ShipDesignerEngineTest` sowie anschließend die vollständige PHPUnit-Suite waren erfolgreich.
- Die bestehende Datenbank wurde nicht migriert. Vor und nach den Unit-Tests waren dort **1 User und 77 Tabellen** vorhanden; die vorhandenen Datensätze wurden nicht verändert. Integration-/Performance-Fixtures verwenden SQLite im Speicher. Die laufende Anwendung wurde nicht durch einen erfolgreichen Login-/Spielablauf oder durch E2E gegen die API verifiziert.
- Bei einer konservativen Legacy-Bereinigung wurden zwei nicht referenzierte Alt-Artefakte entfernt: `RuntimeEconomyController.js.orig` (Quellbackup ohne Referenzen) und `js/legacy/engine-compat.ugl.js.gz` (komprimiertes Artefakt ohne Runtime-/Build-Referenz). Der Quellcode `js/legacy/engine-compat.js` bleibt bestehen, da ein vorhandener Regressionstest ihn direkt lädt.
- Die Auth- und Renderer-Abhängigkeiten sind nun explizit importierte ES-Module; ihre alten Quell-Dateien bleiben vorerst an ihren bisherigen Orten, damit keine großen Umzüge mit der Verhaltensmigration vermischt werden. Nicht in der Modul-Allowlist enthaltene Einträge aus einem optionalen `__GQ_BOOT.gameScripts`-Altmanifest verwenden weiterhin den klassischen Script-Loader. Der Renderer enthält außerdem weiterhin den Legacy-WebGPU-Facade als Kompatibilitäts-Adapter.
- PHP ist auf dem Host nicht verfügbar; die Backend-Prüfungen liefen im vorhandenen Docker-Web-Container mit PHP 8.2.33. PHPUnit ist damit lokal verifiziert, jedoch nicht die Datenbankmigrationen auf einer frischen, isolierten MySQL-Instanz oder ein erfolgreicher Login-/E2E-Spielablauf. Die bestehenden Xdebug-Konfigurationshinweise im Container wurden durch die Tests sichtbar, verursachten aber keine Testfehler.
- Der vorhandene CI-Workflow startet den Playwright-Smoke-Test `view-flow.spec.js`. Der im Arbeitsverzeichnis vorhandene zusätzliche Auth-/Overlay-Test wird durch diesen Workflow nicht automatisch ausgeführt.
- `git diff --check` meldete außerdem vorhandene Leerzeichen am Zeilenende in der geänderten `index.html`; diese UI-Arbeitsänderungen wurden nicht angepasst.

## Musiksteuerung auf der Startseite

- Zwei eigene prozedural synthetisierte Melodic-Trance-Drafts wurden ergänzt: [`Aurora_Transit.mp3`](../../music/Aurora_Transit.mp3) mit 128 BPM und [`Quantum_Horizon.mp3`](../../music/Quantum_Horizon.mp3) mit 132 BPM, jeweils **5:00 Minuten**, Stereo, 44,1 kHz und 192 kbit/s. Synthese mit eigenem Bass-/Arpeggio-/Pad-/Drumpattern und Intro, Hauptteilen, Break, Aufbau und Ausklang; keine externen Samples oder nachgeahmten Referenzmelodien. ID3-Metadaten kennzeichnen sie als prozedurale Drafts. Die technische Prüfung ersetzt keine musikalische Hörabnahme.
- Beide MP3s vollständig per FFmpeg dekodiert: jeweils 300 Sekunden, integrierte Lautheit ca. -16,05 LUFS, gemessene True Peaks nach MP3-Kodierung -1,09 bzw. -0,98 dBTP, keine gemeldeten längeren Stilleabschnitte. Der lokale Katalog liefert nun **fünf Titel**; beide neuen Dateien antworten mit HTTP 200. Der Browser-Integrationsflow für echten Katalog, erreichbare Dateien und Titelwechsel bestand mit allen fünf Einträgen.

- Kleines statisches HTML-Overlay oben rechts mit aktuellem Titel, Play/Pause, vorherigem/nächstem Titel und globaler Stummschaltung. Auf schmalen Bildschirmen bleibt Platz oberhalb des Schriftzugs; beim Spielstart wird es mit der Startseite ausgeblendet.
- [`start-music-player.js`](../../js/network/start-music-player.js) verwendet denselben AudioManager wie Auth und Spiel, ohne zweite Audioinstanz. Zustandsereignisse aktualisieren Titel, Buttons und Settings-Stummschaltung. Die vorhandene Gestenfreigabe ignoriert direkte Player-Interaktionen, damit der erste Play-Klick nicht versehentlich sofort wieder pausiert.
- Die vorhandene Track-API liefert die Playlist; bei deren Ausfall bleibt der bisherige, protokollierte Titel-Fallback erhalten. Ladefehler und abgewiesene Wiedergabe erscheinen im Overlay. Browser-Autoplay-Regeln werden nicht umgangen.
- Verifikation: **15 fokussierte Vitest-Tests**, **13 Chromium-Startseitenflows mit API-Mocks** und Produktionsbuild bestanden. Der neue Browserfall prüft Desktop-/Mobilposition und Bedienung mit gemeinsamem Audio-Testdouble; eine zusätzliche lokale Browserprüfung bestätigte das Overlay mit dem realen AudioManager. Der lokale Vite-Server ersetzt keine echte PHP-Track-API-Abnahme. Die schon vorhandenen Whitespace-Befunde im NPC-Abschnitt von `index.html` bleiben unverändert.
- Playlist-Nachkorrektur: Der lokale Vite-Server lieferte auf `api/audio.php?action=list` zuvor PHP-Quelltext, keine JSON-Antwort. Der Auth-Loader fiel deshalb auf einen einzigen Ersatztitel zurück. [`vite.config.mjs`](../../vite.config.mjs) stellt nun ausschließlich im Devserver einen dateibasierten Audio-/SFX-Katalog unter der Legacy- und versionierten Audio-Route bereit; andere PHP-Endpunkte werden dadurch nicht ausgeführt. Im Deployment bleibt die vorhandene PHP-API zuständig. Beide Kataloge wurden mit den drei tatsächlich vorhandenen Musikdateien abgeglichen; alle drei Mediendateien waren lokal erreichbar. Keine hardcodierte Drei-Titel-Playlist.
- Der Auth-Loader prüft HTTP-Erfolg, Antwortstruktur und eine nichtleere Playlist mit zehn Sekunden Timeout. Bei Fehler bleibt der vorhandene Ersatztitel nutzbar, aber das Overlay kennzeichnet ihn ausdrücklich als Ersatz. URL-kodierte Leerzeichen werden im sichtbaren Titel dekodiert. **15 Vitest-Tests, 15 Chromium-Flows und Produktionsbuild** bestanden nach der Korrektur. Der neue Integrationsflow nutzt den echten lokalen Katalog und realen AudioManager und prüft vollständige Playlist, Titelwechsel und ausbleibende Katalogwarnung; übrige Auth-APIs bleiben gemockt. Die PHP-Katalogausgabe wurde separat mit PHP 8.2 ohne Netzwerk geprüft; Versionierungsroute, SFX-Katalog, HTTP 400 und HTTP 405 zusätzlich direkt gegen den Devserver.

## Fraktionshauptwelten als Setup-Voraussetzung

Der spielintegrierten Registrierung wird ein echter Welt-Setup-Schritt vorgeschaltet. Fraktionsnamen und eine zufällig erzeugte NPC-Kolonie reichen nicht als räumlicher Ausgangspunkt.

- [`faction_homeworlds.json`](../../config/faction_homeworlds.json) definiert explizite System-/Planetenpositionen für alle **19 Lore-Fraktionen**, darunter die sechs spielbaren Fraktionen. Die sechs Hauptweltnamen stammen aus den vorhandenen Specs. Ihre Positionen sind **vorläufige, konfigurierbare Draft-Platzierungen**, keine nachträglich behaupteten Lore-Koordinaten.
- Nomadische, verteilte oder nichtplanetare NPC-Fraktionen erhalten ausdrücklich `outpost`-Stützpunkte. Damit werden weder der Riss noch ein Hive-Schiff zu einer angeblich kanonischen Planetenhauptwelt umgedeutet. Auch die Eisenflotten-Platzierung namens Erde verwendet vorerst den vorhandenen prozeduralen Generator, **kein rekonstruiertes Sonnensystem**.
- Bereits vorhandene zusätzliche DB-/PvE-Fraktionen erhalten deterministische Stützpunkte, soweit noch kein Weltlink existiert. Im isolierten Setup mit Standard-PvE-Konfiguration entstanden insgesamt **32 Fraktionswelten**: 19 Lore-Fraktionen, fünf bestehende Standardfraktionen und acht prozedurale PvE-Fraktionen.
- [`FactionHomeworldSeeder.php`](../../lib/FactionHomeworldSeeder.php) erzeugt reale, nicht einloggbare Engine-Besitzer (`control_type=npc_engine`, `auth_enabled=0`), astronomische Körper, Kolonien, Gebäude, Forschung, Schiffe und eigene Systemsichtbarkeit. `faction_homeworlds` verbindet Fraktion, Besitzer und Kolonie dauerhaft; `npc_faction_memberships` hält die Zugehörigkeit weiterer Setup-NPCs.
- Vor der zusätzlichen NPC-Besiedlung werden je Fraktionswelt zwei räumlich benachbarte, unbesiedelte Systeme mit kolonisierbaren Planeten vorbereitet. Entfernungen verwenden die dreidimensionalen Generator-Koordinaten, nicht aufeinanderfolgende Systemnummern. Zusätzliche NPCs beginnen nahe ihrer Fraktionswelt; andere Planeten werden nicht pauschal einer Fraktion zugewiesen.
- Wiederholung füllt weder verbrauchte Schiffe noch Ressourcen auf und verschiebt keine bestehenden Welten. Fehlende Sternsystem-Caches werden unter Erhalt der planetaren Rohstofflager rekonstruiert; freie Nachbarsysteme werden bei Bedarf weiter vorbereitet. Belegte Zielpositionen, geänderte Besitzer oder abweichende konfigurierte Positionen führen zu einem sichtbaren Fehler; ein Umzug erfordert eine ausdrückliche Migration. Besitzer, Kolonie, Startausstattung und Weltlink werden pro Fraktion atomar angelegt.
- Der Setup-NPC-Pfad verwendet nicht mehr das entfernte `users.is_npc`. Für frische Installationen wird die inkompatible Legacy-`migrate_v2.sql` nicht mehr vor den bereits aktuellen Basisschema-Markern eingeplant.

### Ausführung

Die neue [`migrate_faction_homeworlds_v1.sql`](../../sql/migrate_faction_homeworlds_v1.sql) ist am Manifestende registriert und Bestandteil des expliziten CLI-Setups. Sie wurde **nicht auf die bestehende Entwicklungsdatenbank angewendet**.

```text
php setup.php --dry-run --homeworlds-only
php setup.php --homeworlds-only
```

`--homeworlds-only` erwartet eine zuvor migrierte Datenbank. Es führt keinen globalen 25000-System-Warmup aus, bereitet aber die benötigten Welt-/Nachbarsysteme vor. `--skip-npc-seed` unterdrückt nur zusätzliche NPC-Accounts, nicht die obligatorischen Fraktionsbesitzer. `--migrations-only` erzeugt keine Startwelten oder zusätzlichen NPC-Kolonien. Ein normaler Setup-Lauf erledigt Migrationen, globalen Warmup, Fraktionswelten und danach zusätzliche Identitäten/NPCs.

### Verifikation und Grenze

- **4 fokussierte PHPUnit-Tests, 121 Assertions** mit PHP 8.2 und einer eigens gestarteten, netzisolierten **MySQL-8.4-Testinstanz** bestanden. Geprüft: vollständige/kolonisierbare Konfiguration, räumliche Trennung, persistente Ausstattung und Koordinaten, neutrale Planeten, idempotente Wiederholung, Sternsystem-Cache-Rekonstruktion ohne Lagerreset, Kollisionsschutz, Umzugsverweigerung, Transaktionsrollback bei erzwungenem Schiffsfehler und der tatsächliche `--homeworlds-only`-CLI-Pfad.
- Zusätzlich frische CLI-Installation mit `php setup.php --skip-bootstrap --npc-count=6` auf einer leeren Wegwerf-Datenbank erfolgreich: 32 Fraktionswelten, zwei Standard-Spieler und sechs zusätzliche NPCs. Wiederholte CLI-Läufe verwendeten bestehende Fraktionswelten/NPCs weiter. Der globale Warmup aller 25000 Systeme wurde in dieser Prüfung ausdrücklich ausgelassen.
- Keine bestehende Datenbank, kein Compose-Projektvolume und keine Zugangsdaten wurden übernommen. Der temporäre Testserver wurde nach der Prüfung entfernt.
- **Noch nicht umgesetzt:** dynamische Spieler-Randweltenvergabe, private Registrierungs-Draftobjekte mit zweistündiger Planetenbelegung, Fraktions-/Spezies-/Spielstil-UI, Startgebietszoom und Tutorial-Übergabe. Der bisherige Registrierungsablauf bleibt bestehen. Diese Setup-Welten bilden jetzt die belastbaren DB-Anker für den folgenden Registrierungsschritt.

## Was offen bleibt

1. **JavaScript-Tests:** die letzte vollständige Vitest-Suite vor dem Startmenü-Umbau war grün; die aktuellen Startmenü-/Renderer-Regressionsprüfungen sind separat grün. Vor einer Release-Abnahme Vollsuite erneut ausführen und Browser-/Canvas-Verhalten separat validieren.
2. **Backend-Integration:** Gesamten kanonischen Migrationslauf und API-Verträge sowie Login-/Spielablauf Ende zu Ende prüfen. Der oben beschriebene frische CLI-Setup-Pfad und die Fraktionswelt-Migration wurden inzwischen isoliert gegen echtes MySQL geprüft; das ersetzt keine vollständige API-/Gameplay-Abnahme.
3. **Build-/Browser-Integration:** den produktiven Deploy-Pfad gegen PHP/API prüfen.
4. **Browser-Integration:** E2E- und Auth-/Overlay-Flows nach erfolgreichem Login gegen einen laufenden Stack ausführen; den zusätzlichen Regressionstest bei erfolgreichem Lauf in CI aufnehmen.
5. **Boot-Zuverlässigkeit:** Domain-Fehler im Bootstrap dürfen nicht unbemerkt in einen Erfolgseindruck münden; Fehlzustände sollten für Nutzer und Tests klar erkennbar sein.
6. **Legacy-Abbau:** verbleibende optionale klassische Boot-Manifeste/Script-Loader sowie den Renderer-Facade einzeln migrieren und erst nach erfolgreichen Regressionstests entfernen.
7. **Statusdokumentation:** Die älteren Prozentwerte und Feature-Checklisten sind Snapshots und sollten einzeln gegen aktuelle Tests und integrierte Flows geprüft werden, bevor sie als Fortschrittsmessung genutzt werden.

## Empfohlene Reihenfolge

1. Eine frische, isolierte MySQL-Testinstanz bereitstellen und Migrationen, erfolgreichen Login, Auth-/Overlay-Regression sowie E2E ausführen; nicht gegen das persistierte Entwicklungs-Volume migrieren.
2. Vitest nach weiteren relevanten Änderungen vollständig ausführen; jsdom-Canvas-Limitierungen nicht als Browserverifikation werten. Die PHPUnit-Suite erneut ausführen, wenn PHP-Änderungen anstehen.
3. Den Produktions-Deploy-Pfad gegen die PHP/API-Laufzeit prüfen.
4. Die verbleibenden optionalen Legacy-Boot-Scripts und Renderer-Facade schrittweise migrieren und nach Regressionstest-Erfolg entfernen.
5. Erst danach die Produktstatus-Checklisten anhand von definierten Akzeptanzkriterien aktualisieren; keine pauschale Fertigstellungsquote ohne messbare Definition verwenden.

## Historische Statusdokumente

- [Implementierungs-Audit](IMPLEMENTATION_AUDIT.md) — Snapshot vom 31. Juli 2026.
- [Systemstatus Piraten/Wirtschaft/Krieg](IMPLEMENTATION_STATUS_SUMMARY.md) — Snapshot vom 31. Juli 2026.
