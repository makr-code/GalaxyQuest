# JS Refactor Zielstruktur und TODO (GalaxyQuest)

## Ziel
Dieses Dokument beschreibt die Soll-Struktur fuer das JavaScript-Frontend und einen konkret priorisierten Refactor-Plan.

Hauptziele:
- Monolithen in klar getrennte Runtime- und Domain-Module zerlegen.
- Doppelte Command-Logik zusammenfuehren.
- Verantwortlichkeiten trennen: UI, Orchestrierung, Netzwerk, Renderer, Domain.
- Regressionen vermeiden durch kleine, testbare Schritte.

## Aktuelle Hotspots (Ist)

### 1) Runtime-Monolith
- Datei: `js/runtime/game.js`
- Problem: Zu viele Verantwortlichkeiten in einer IIFE (UI, State, Commands, Renderer-Steuerung, Audio, Datenfluesse).

### 2) Command-Duplikation
- Datei: `js/runtime/game.js`
- Problem: Mindestens zwei if-Ketten fuer Console-Commands (globale UI-Console + Message-Console) mit aehnlicher Parsing- und Fehlerlogik.

### 3) Renderer-Kern als grosse Klasse
- Datei: `js/rendering/galaxy-renderer-core.js`
- Problem: Kamera, Picking, Cluster, System-Szene, VFX und Telemetrie eng gekoppelt.

### 4) API-Mix aus Transport + Adaptern + Session
- Datei: `js/network/api.js`
- Problem: Queue, Retry, Caching, Schema-Adapter und Session-Verhalten in einem Modul.

### 5) Auth-Boot als God-Flow
- Datei: `js/network/auth.js`
- Problem: UI-State, Script-Loader, Audio-Priming, Reachability und 2FA in einem grossen Ablauf.

## Soll-Architektur (Zielstruktur)

### A) Runtime-Schicht (Orchestrierung)
Pfad: `js/runtime/`

Regel:
- Runtime-Dateien koordinieren nur noch.
- Keine breite Business-Logik mehr in Runtime-IIFEs.
- Jede Runtime-Funktion delegiert an klar benannte Module.

Soll-Dateien:
- `js/runtime/game.js` (nur Composition Root, Wiring, Guardrails)
- `js/runtime/wm.js` (Window-Management)
- `js/runtime/audio.js` (Audio Runtime Glue)

### B) Runtime-Module (Features)
Pfad: `js/engine/runtime/`

Regel:
- Je Feature eine Datei mit klarer API (`configure*Runtime`, `run*`, `render*` etc.).
- Keine versteckten Side-Effects ausser explizit dokumentiert.

Soll-Cluster:
- `Console/Commands`
  - `RuntimeUiConsoleDispatcher.js`
  - `RuntimeUiConsoleCommandRegistry.js`
  - `RuntimeMessageConsoleDispatcher.js`
- `Galaxy UI`
  - `RuntimeGalaxyWindowUi.js`
  - `RuntimeGalaxyOverlayControls.js`
  - `RuntimeMinimapUi.js`
- `Settings`
  - `RuntimeSettingsController.js`
  - `RuntimeThemeSettingsUi.js` (teilweise bereits vorhanden/verbunden)
- `Data Views`
  - `RuntimeOverviewView.js`
  - `RuntimeMessagesView.js`
  - `RuntimeIntelView.js`

### C) Renderer-Schicht
Pfad: `js/rendering/`

Regel:
- Renderer-Core orchestriert Subsysteme statt alles selbst zu implementieren.

Soll-Subsysteme:
- `camera/`
  - `GalaxyCameraController.js`
  - `GalaxyInputController.js`
- `cluster/`
  - `GalaxyClusterOverlay.js`
  - `GalaxyClusterPicking.js`
- `system/`
  - `SystemSceneBuilder.js`
  - `SystemPlanetPresentation.js`
- `telemetry/`
  - `RenderTelemetryBridge.js`

### D) Netzwerk-Schicht
Pfad: `js/network/`

Regel:
- Trennung nach technischer Verantwortung.

Soll-Dateien:
- `api-transport.js` (fetch, retries, timeout, errors)
- `api-queue.js` (priorisierung, backpressure)
- `api-cache.js` (GET cache, invalidierung)
- `api-schema-adapters.js` (payload adaptation/normalization)
- `api-session.js` (session expiry hooks, redirect triggers)
- `api.js` (kleine Facade nach aussen)

### E) Auth-Schicht
Pfad: `js/network/`

Soll-Dateien:
- `auth-shell.js` (entrypoint orchestration)
- `auth-boot-assets.js` (script/package preload)
- `auth-ui-state.js` (modals, preload panel, tab flow)
- `auth-audio.js` (title track, warmup, unlock)
- `auth-reachability.js` (probe/retry/backoff)
- `auth-2fa.js` (challenge flow)

## Modulkonventionen

### API-Konvention
- Runtime-Module exportieren:
  - `configureXRuntime(deps)`
  - `runX(...)` oder `renderX(...)`
- Keine harte Abhaengigkeit auf globale Variablen ohne Guard.
- Defensive Checks bei Runtime-Wiring beibehalten.

### Namenskonvention
- Runtime-Module: `Runtime<Feature>.js`
- Renderer-Subsysteme: `Galaxy<Subsystem>.js` oder `System<Subsystem>.js`
- Network intern: `api-<topic>.js`

### Abhaengigkeiten
- Immer von Runtime zu Engine/Domain, nicht umgekehrt.
- UI-Renderer-Abhaengigkeit nur ueber explizite Adapter/Callbacks.

## Refactor TODO (priorisiert)

## Phase 1: Schnellster Risikoabbau (kurzfristig)

1. UI-Console Command Registry einfuehren.
- Ziel: if-Kette in einen Command-Dispatcher ueberfuehren.
- Scope:
  - neue Registry (`register`, `resolve`, `run`)
  - vorhandene Commands einhaengen ohne Verhaltensaenderung
- DoD:
  - gleiches User-Output-Verhalten
  - unknown/help handling unveraendert

2. Message-Console Dispatcher extrahieren.
- Ziel: Parsing/Validierung/Antworten aus Message-View herausziehen.
- Scope:
  - eigener Runtime-Command-Dispatcher fuer inbox/read/delete/msg
- DoD:
  - alle Message-Console Commands funktionieren unveraendert

3. Gemeinsame Command-Utilities bauen.
- Ziel: Duplikate fuer Parsing, Usage-Meldungen, Error-Formatting entfernen.
- Scope:
  - `splitCommand`, `requireArg`, `formatUsageError` o.ae.
- DoD:
  - weniger Copy/Paste in beiden Consolen

## Phase 2: Game Runtime weiter zerlegen (mittelfristig)

4. Galaxy-Window Rendering in Feature-Module schneiden.
- Ziel: `renderGalaxyWindow` in kleinere Einheiten aufteilen.
- Scope:
  - Overlay Controls
  - Hover/System-Detail Panels
  - Health/Diagnostic UI
- DoD:
  - `renderGalaxyWindow` nur orchestrierend

5. Minimap in eigenes Runtime-Modul auslagern.
- Ziel: Projection, Interactions, Draw-Loop trennen.
- DoD:
  - keine direkte Minimap-Logik mehr im Runtime-Hauptfile

6. SettingsController in Runtime-Teilmodule aufspalten.
- Ziel: Audio, Theme, UserMenu, RuntimeApply trennen.
- DoD:
  - Settings-Hauptcontroller <= 30-40% der heutigen Groesse

## Phase 3: Renderer-Kern modularisieren (mittelfristig)

7. Cluster-Overlay Subsystem extrahieren.
- Ziel: Aura/Picking/Bounds aus dem Core herausloesen.
- DoD:
  - Core ruft nur noch `clusterOverlay.update(...)` auf

8. System-Szene Builder extrahieren.
- Ziel: Planet/Facility/Fleet-Erzeugung in dediziertes Modul.
- DoD:
  - klarer Build-Pfad ohne direkte Vermischung mit Input/Kamera

9. Camera + Input Controller trennen.
- Ziel: Bewegungs-/Transitionslogik vom Rendering entkoppeln.
- DoD:
  - Core kennt nur camera-controller API

## Phase 4: Netzwerk und Auth konsolidieren (spaeter)

10. `api.js` in interne Teilmodule aufteilen.
- Ziel: Transport/Queue/Cache/Schema klar trennen.
- DoD:
  - `api.js` ist nur Facade

11. Auth-Flow in Teilmodule schneiden.
- Ziel: Boot, UI-State, Reachability, 2FA getrennt testbar.
- DoD:
  - `auth.js` wird zu kleinem shell-entrypoint

## Nicht-Ziele (wichtig)
- Kein Big-Bang-Rewrite.
- Keine gleichzeitige Aenderung von Verhalten + Architektur in einem Schritt.
- Keine Boot-Reihenfolge ohne Script-Manifest-Update in `index.html`.

## Qualitaetsgates pro Schritt

Pflicht vor Merge:
1. Keine neuen Editor-Errors in geaenderten Dateien.
2. Relevante Unit-Tests gruen.
3. Manuelle Smoke-Checks:
- UI-Console Commands (help/open/msg/term/transitions/perftelemetry)
- Message-Console Commands (help/inbox/read/delete/msg)
- Galaxy window + hover + minimap
4. Manifest-Sync:
- Neue Runtime-Skripte in beiden Arrays in `index.html`:
  - `gameScripts`
  - `preloadAssets`

## Technischer Arbeitsmodus
- Immer kleine contiguous extracts (1 Responsibility pro Schritt).
- Nach jeder Extraktion: wiring + quick smoke + tests.
- Bei Konflikten in langen Dateien: grosse eindeutige Replace-Blocs statt mehrfacher kleiner ambiger Patches.

## Beispiel-Backlog (konkret naechste 5 Tickets)
1. Ticket: RuntimeUiConsoleCommandRegistry anlegen und UI-Console umhaengen.
2. Ticket: RuntimeMessageConsoleCommandDispatcher extrahieren.
3. Ticket: Gemeinsame Command-Parsing Utils einfuehren.
4. Ticket: Minimap Runtime-Modul extrahieren.
5. Ticket: Galaxy Overlay Controls extrahieren.

## Akzeptanzkriterien fuer "Refactor erfolgreich"
- `js/runtime/game.js` deutlich kleiner und als orchestrierende Datei lesbar.
- Kein doppelter Command-Flow mehr in `game.js`.
- Renderer-Core nutzt Subsysteme statt monolithischer Methoden.
- API/Auth-Schicht in testbare, fokussierte Module getrennt.
- Keine Regressionen in Kern-Smokes und Unit-Tests.
