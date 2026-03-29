# GalaxyQuest Roadmap (Engine-Fokus)

Diese Datei ist die operative Schritt-fuer-Schritt-Roadmap fuer die aktuelle 3D-Engine- und Datenpipeline-Arbeit.

## Aktueller Stand

- Shared WebGL Canvas fuer Auth und Game ist umgesetzt.
- Camera-Driver Hook im Renderer-Core ist vorhanden.
- Shared Flight Driver und Shared Physics sind eingefuehrt.
- Homeworld-Targeting nach Login/Register ist angebunden.

## Arbeitsmodus

- Es wird immer nur ein Schritt gleichzeitig als `in-progress` bearbeitet.
- Nach Abschluss wird der Schritt auf `done` gesetzt.
- Jeder Schritt liefert ein pruefbares Ergebnis (Code + kurzer Testnachweis).

---

## Phase 0 - Stabilisieren und Aufraeumen

Ziel: Drift und versteckte Fehlerquellen entfernen.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| P0.1 | Script-Versionen und Loader-Pfade vereinheitlichen | done | Keine veralteten Includes im aktiven Pfad |
| P0.2 | Camera-Driver-Fehler sichtbar loggen (kein Silent Fail) | done | Reproduzierbare Warn-/Fehlerlogs |
| P0.3 | Legacy-/Duplikatmodule markieren und Ladepfad bereinigen | done | Dokumentierte Deprecation-Liste |
| P0.4 | Kleines Engine-Debug-Overlay (fps/frame time/draw calls) | done | Laufendes Overlay im Dev-Modus |

Definition of Done (Phase 0):
- Es gibt keinen aktiven Pfad mehr mit alten Script-Versionen.
- Driver-Fehler sind im Log nachvollziehbar.

---

## Phase 1 - Renderer in Module schneiden

Ziel: Monolithische Renderer-Logik in klare Verantwortlichkeiten aufteilen.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| P1.1 | `Galaxy3DRenderer` in Teilmodule trennen (SceneGraph, Camera, Interaction, LOD, RenderLoop) | done | GalaxyCameraController extrahiert; Renderer delegiert alle Camera-Ops |
| P1.2 | Stabile Fassade fuer Renderer-API definieren | done | Legacy-Aliase (cameraDriver/cameraDriverConsumesAutoNav/_cameraDriverRoll) entfernt; reine Delegation ueber cameraCtrl |
| P1.3 | Einheitliches Driver-Interface (`onAttach`, `update`, `onDetach`, `priority`) | done | validateDriver + standardisierte Driver-Felder (consumeAutoNav/updateControls/priority) aktiv |
| P1.4 | Sauberes Camera-Takeover (Blend intern/externe Steuerung) | done | Weiches Takeover via blendFrames im GalaxyCameraController |

Definition of Done (Phase 1):
- Renderer-Core ist deutlich kleiner.
- Camera-Driver wird in Auth und Game einheitlich verwendet.

---

## Phase 2 - Datenpipeline vertraglich absichern

Ziel: Renderdaten ueber stabile, versionierte DTOs liefern.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| P2.1 | Render-Bootstrap-Endpoint definieren | done | `api/galaxy.php?action=bootstrap` liefert initial_range, capabilities und render_schema_version |
| P2.2 | `render_schema_version` in allen relevanten Endpunkten | done | In galaxy.php fuer bootstrap/stars/search/star_info/system-json und als Binary-Header gesetzt |
| P2.3 | DataAdapter mit Validation im Frontend einbauen | done | `GQRenderDataAdapter` validiert bootstrap/stars und normalisiert Nutzdaten |
| P2.4 | Fehlerklassen vereinheitlichen (network/auth/schema/stale) | done | `classifyRenderError` im Adapter + konsistente UI/Logs im Galaxy-Load-Pfad |

Definition of Done (Phase 2):
- Frontend erzeugt keine improvisierten Fallback-Objekte mehr.
- Alle Render-Endpunkte liefern eine Schema-Version.

---

## Phase 3 - Asset- und Ressourcenpipeline

Ziel: Texturen, Geometrien, Materialien und Lichtprofile als wiederverwendbare Pipeline.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| P3.1 | `TextureManager` mit Cache/LRU/Fallbacks | done | `js/texture-manager.js` eingefuehrt und im Renderer/Auth-Lader integriert |
| P3.2 | `GeometryManager` mit Shared Cache/Instancing-Kandidaten | done | `js/geometry-manager.js` eingefuehrt; Vessel-Geometrien laufen ueber Shared-LRU + Instancing-Kandidaten |
| P3.3 | `MaterialFactory` (PBR-Profile, Emissive/Bloom) | done | `js/material-factory.js` eingefuehrt und in Fleet/Facility/Installations/Planet-Fallback verdrahtet |
| P3.4 | `LightRigManager` fuer Auth/Galaxy/System/Cinematic | done | `js/light-rig-manager.js` eingefuehrt; Renderer schaltet Profile bei System/Galaxy-View um |
| P3.5 | Asset-Manifest-Versionierung (`assets_manifest_version`) | done | API/Adapter liefern und validieren `assets_manifest_version` inkl. Binary-Header |

Definition of Done (Phase 3):
- Cache-Hits sind messbar vorhanden.
- Materialien/Lichter folgen zentralen Profilen statt Einzel-Setup.

---

## Phase 4 - Physik und Navigation vereinheitlichen

Ziel: Ein Navigation- und Flugmodell fuer Auth und Ingame.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| P4.1 | Physikpfad in Ingame-Kamera-Cinematics voll integrieren | done | Ingame-Cinematics nutzen den gemeinsamen Space-Flight-Driver (Home/Search/QuickNav) |
| P4.2 | `TrajectoryPlanner` (Steering + Gravity + Approach/Brake) | done | Gemeinsamer Planner steuert Steering, Gravity, Approach und Brake im Flight-Driver |
| P4.3 | Navigation-States definieren (`idle`, `acquire`, `cruise`, `approach`, `brake`) | done | Shared Flight-Driver fuehrt explizite Zustandsmaschine und liefert State im Telemetriepfad |
| P4.4 | Einheitliches Telemetrie-Schema fuer Flugdaten | done | Kanonisches Schema (phase, targetId, targetLabel, progress, distance, eta, speed, speedRaw) mit Validierung und Normalisierung |

Definition of Done (Phase 4):
- Homeworld-Cinematic nutzt in Auth und Game denselben Planner.
- Doppelte Flugalgorithmen sind entfernt.

---

## Phase 5 - Performance, QA und Gates

Ziel: Regressionssichere Weiterentwicklung mit messbaren Budgets.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| P5.1 | Performance-Budgets definieren (fps, frame time, draw calls, memory) | done | Klare Zielwerte mit Baseline-Metriken für Desktop (59-60 FPS, 16.5-17.5ms frame time) |
| P5.2 | Contract-Tests fuer DTOs | done | Schemas für Bootstrap, System, Flight-Telemetry mit automatischen Validierungen |
| P5.3 | Integrationstests fuer Camera-Driver/Takeover | done | 38 Unit-Tests für Lifecycle, Telemetrie, State-Maschine, Error-Handling |
| P5.4 | Regressionstests fuer LOD/Streaming bei grossen Datensaetzen | done | 18 Regressions-Tests für LOD-Profile, Draw-Calls, Memory, Streaming |
| P5.5 | Graceful Degradation fuer schwache Hardware | done | Auto-Qualitaetsprofile fuer Low-End-Hardware reduzieren Pixel-Ratio, Cache-Groessen und Core-FX |

Definition of Done (Phase 5):
- Baseline-Benchmark ist dokumentiert.
- Harte Regressions-Gates sind aktiv.

---

## Parallelspur - Backend-Ausbau

Ziel: Serverseitige Vorverarbeitung und Streaming verbessern.

| ID | Aufgabe | Status | Ergebnis |
|---|---|---|---|
| B1 | Chunk-Streaming erweitern (Priority/Prefetch) | done | `stars`-Endpoint unterstuetzt `priority`/`prefetch`/`chunk_hint`; Frontend nutzt critical foreground + background prefetch |
| B2 | Optionale serverseitige LOD/Cluster-Vorberechnung | done | `stars`-Endpoint unterstuetzt `cluster_preset`/`cluster_lod`; Server liefert preset-basierte Clusterlisten |
| B3 | Asset-Metadaten-Endpunkte ergaenzen | done | Neuer Endpoint `api/galaxy.php?action=asset_meta` liefert versionierte Asset-Metadaten (render/planet_textures/clusters/ships) |
| B4 | Opt-in Performance-Telemetrie-Endpunkt | done | Neuer Endpoint `api/perf_telemetry.php?action=ingest` + UI-Opt-In (`perftelemetry on/off/status/send`) und periodischer Sender |

---

## Reihenfolge fuer die naechsten Arbeitstage

1. Phase 0 komplett abschliessen.
2. Phase 1 mit CameraController-Extraktion starten.
3. Phase 2 DTO-Vertraege und DataAdapter umsetzen.
4. Phase 3 Ressourcenmanager schrittweise einfuehren.
5. Phase 4 Navigation vereinheitlichen.
6. Phase 5 als dauerhaften Gate-Prozess etablieren.

---

## Fortschrittsprotokoll

- 2026-03-29: Roadmap als operative Engine-Version angelegt.
- 2026-03-29: P0.1 done — preloadAssets planet-textures/model_registry p48→p49; dynamische Loader galaxy-renderer-core p76→p83.
- 2026-03-29: P0.2 done — Camera-Driver-Fehler (onAttach/onDetach/update/invalid-driver) loggen via GQLog.
- 2026-03-29: P0.3 done — Deprecated: auth-galaxy-background-controller, auth-galaxy-animation-profile, auth-galaxy-renderer-profile, auth-galaxy-star-distribution, galaxy3d.js, benchmark-v3.js, post-effects.js.
- 2026-03-29: P0.4 done — Debug-Overlay in galaxy-renderer-core eingebaut. Toggle via window.GQEngineDebug.toggle() oder GQ_DEBUG_OVERLAY=true.
- 2026-03-29: P1.1 done — GalaxyCameraController (js/galaxy-camera-controller.js) extrahiert.
  Renderer delegiert setCameraDriver/clearCameraDriver/hasCameraDriver/getCameraPose/applyCameraPose/_updateCameraDriver vollständig.
- 2026-03-29: P1.2 done — Legacy-Aliase (this.cameraDriver, this.cameraDriverConsumesAutoNav, this._cameraDriverRoll) aus galaxy-renderer-core.js entfernt.
  Alle Methoden delegieren ohne Fallback an GalaxyCameraController. Render-Loop: roll-Fallback=0, updCtrl-Fallback=true.
- 2026-03-29: P1.3 done — Driver-Interface formalisiert via GalaxyCameraController.validateDriver(driver).
  setDriver uebernimmt consumeAutoNav/updateControls aus opts oder Driver; priority wird normalisiert.
- 2026-03-29: P1.4 done — Camera-Takeover-Blending in GalaxyCameraController integriert.
  blendFrames (default 14) interpoliert position/target/roll beim Driver-Uebergang.
- 2026-03-29: P2.1 done — Render-Bootstrap-Endpoint eingefuehrt (`api/galaxy.php?action=bootstrap`).
  Frontend nutzt `API.galaxyBootstrap(...)` vor `galaxyStars(...)`; `stars`-Antwort traegt jetzt `render_schema_version`.
- 2026-03-29: P2.2 done — `render_schema_version` ueber relevante Render-Endpunkte vereinheitlicht.
  Enthalten in `bootstrap`, `stars`, `search`, `star_info`, system-JSON sowie Header `X-GQ-Render-Schema-Version` fuer Binary.
- 2026-03-29: P2.3 done — Frontend-DataAdapter eingefuehrt (`GQRenderDataAdapter` in js/api.js).
  Adapter validiert `bootstrap`/`stars`, normalisiert Felder und kennzeichnet Schema-Kompatibilitaet.
- 2026-03-29: P2.4 done — Fehlerklassen vereinheitlicht: `network`, `auth`, `schema`, `stale`.
  Galaxy-Load-Flow in game.js nutzt die Klassifikation fuer konsistente Meldungen und Warn-Logs.
- 2026-03-29: P3.1 done — `GQTextureManager` als zentrale Texture-Pipeline eingefuehrt.
  Planet- und prozedurale Texturen laufen ueber LRU/Fallback/Dispose in `js/texture-manager.js`; Renderer delegiert vollstaendig.
- 2026-03-29: P3.2 done — `GQGeometryManager` als Shared-Cache fuer Vessel-Geometrien integriert.
  Renderer nutzt nun zentralen Geometry-Cache mit LRU und Tracking fuer Instancing-Kandidaten.
- 2026-03-29: P3.3 done — `GQMaterialFactory` fuer konsistente PBR-Profile eingefuehrt.
  Fleet-, Facility- und Installationsmaterialien sowie Planet-Fallback laufen ueber zentrale Materialprofile.
- 2026-03-29: P3.4 done — `GQLightRigManager` fuer umschaltbare Lichtsets integriert.
  Renderer nutzt zentrale Lichtprofile (`galaxy`/`system`) mit automatischem Umschalten beim View-Wechsel.
- 2026-03-29: P3.5 done — Asset-Manifest-Versionierung vertraglich eingebaut.
  `api/galaxy.php` liefert `assets_manifest_version` (inkl. Binary-Header), Frontend-Adapter validiert und Game-Load-Pfad propagiert die Manifest-Version.
- 2026-03-29: P4.1 done — Ingame-Kamera-Cinematics auf gemeinsamen Physik-Flight-Path gehoben.
  Homeworld-Fokus, Search-Jump und QuickNav-Favoriten verwenden jetzt zentral `runPhysicsCinematicFlight(...)` mit `GQSpaceCameraFlightDriver` statt isolierter Sonderpfade.
- 2026-03-29: P4.2 done — TrajectoryPlanner in den Shared Flight-Driver integriert.
  `js/trajectory-planner.js` liefert Steering/Gravity/Approach/Brake-Logik; `js/space-camera-flight-driver.js` nutzt Planner primär mit Legacy-Fallback.
- 2026-03-29: P4.3 done — Navigation-States im Shared Flight-Driver formalisiert.
  Explizite States (`idle`, `acquire`, `cruise`, `approach`, `brake`) werden zentral gesetzt und konsistent über Telemetrie exponiert.
- 2026-03-29: P4.4 done — Einheitliches Telemetrie-Schema für Flugdaten definiert.
  Neues Modul `js/space-flight-telemetry-schema.js` mit kanonischem Schema (phase, targetId, targetLabel, progress, distance, eta, speed, speedRaw).
  SpaceCameraFlightDriver nutzt schema.normalize() und schema.validate() für konsistente Telemetrie-Struktur.
  Alle 3 Boot-Pfade (gameScripts, preloadAssets, inline scripts) synchronisiert.
- 2026-03-29: P5.1 done — Performance-Budget mit messbaren Zielwerten definiert.
  Neues Modul `js/performance-budget.js` mit `createMonitor(renderer, opts)`, Baseline-Metriken für Desktop (59-60 FPS, 16.5-17.5ms, 2000-3200 draw calls).
  Thresholds für Regressions-Gates: FPS >= 50, FrameTime <= 25ms, DrawCalls <= 5000, Memory <= 350MB.
  Monitor sammelt rollierende Fenster (60 Samples) und bietet getMetrics(), getStatus(), report(), serialize() APIs.
- 2026-03-29: P5.2 done — Contract-Tests für API-DTOs definiert.
  Neues Modul `js/api-contracts.js` mit Validatoren für Bootstrap, System, und Flight-Telemetry DTOs.
  Jede Validierungsfunktion prüft Typ, erforderliche Felder und Wertebereiche. Violations werden mit Details protokolliert.
  Integriert an Boot-Punkt (nach api.js) für frühe Fehler detektion.
- 2026-03-29: P5.3 done — Integration-Tests für Flight-Driver Lifecycle und Telemetrie-Konsistenz.
  Neues Modul `js/flight-driver-integration-tests.js` mit 38 Test-Cases (32 Zeilen per Test durchschnittlich).
  Tests prüfen: Driver Interface, State Machine (idle/acquire/cruise/etc), Telemetrie-Schema-Compliance, Lifecycle Hooks (onAttach/onDetach), Error-Handling, Graceful Degradation.
  Test Runner mit `createRunner()` → `runAll()`, `runTest(name)`, JSON-Serialisierung für Backend-Logging.
  - 2026-03-29: P5.4 done — Regressions-Tests für LOD/Streaming bei großen Datensätzen.
    Neues Modul `js/regression-tests-lod-streaming.js` mit 18 Test-Cases in 8 Kategorien.
    Tests prüfen: LOD-Profil-Erkennung (ultra/high/medium/low), Draw-Call-Stabilität, Memory-Drucktests, Streaming-Latenz, Culling-Effektivität, Regressions-Schwellen, Graceful Degradation, Stresstests (1k/10k/50k Systeme).
    Runner mit async Test-Execution, Timeout-Handling, Retry-Mechanik, JSON-Serialisierung für CI/CD-Integration.
- 2026-03-29: P5.5 done — Graceful Degradation fuer schwache Hardware.
  Renderer-Config erkennt nun Low-/Mid-/High-/Ultra-Hardwareprofile und leitet daraus Pixel-Ratio, Antialiasing, Cache-Groessen und FX-Freigaben ab.
  Der Galaxy-Renderer uebernimmt diese Profile zentral; Game-Settings respektieren Auto-Core-FX fuer Low-End-Geraete, ohne manuelle Ueberschreibungen zu verlieren.
- 2026-03-29: B1 done — Chunk-Streaming um Priority/Prefetch erweitert.
  `api/galaxy.php?action=stars` akzeptiert nun `priority`, `prefetch` und `chunk_hint`, liefert Request-/Prefetch-Metadaten und passt Full-Density-Materialisierung prioritaetsabhaengig an.
  Frontend ruft Foreground-Ladevorgaenge mit `critical` und Hintergrund-Hydration als `background`+`prefetch` auf.
- 2026-03-29: B2 done — Optionale serverseitige LOD/Cluster-Vorberechnung eingebaut.
  `api/galaxy.php?action=stars` akzeptiert jetzt `cluster_preset` (`auto|low|medium|high|ultra`) und `cluster_lod`.
  Der Server waehlt ein Preset (bei `auto` anhand Priority/Prefetch), liefert `cluster_preset_selected` und preset-basierte Clusterlisten ohne zusaetzliche Frontend-Berechnung.
- 2026-03-29: B3 done — Asset-Metadaten-Endpunkt erweitert.
  `api/galaxy.php?action=asset_meta` liefert versionierte Metadaten fuer `render`, `planet_textures`, `clusters` und `ships`.
  Bootstrap exponiert den Endpoint in `endpoints.asset_meta` und als Capability `asset_metadata`; Frontend nutzt `API.galaxyAssetMeta(...)`.
- 2026-03-29: B4 done — Opt-in Performance-Telemetrie-Endpunkt implementiert.
  Neuer Endpoint `api/perf_telemetry.php?action=ingest` akzeptiert nur explizites Opt-In (`opt_in: true`) und persistiert normierte Renderer-Metriken.
  Frontend erweitert um `API.perfTelemetry(...)`, periodischen Sender (2min, nur bei Opt-In) und UI-Console-Steuerung via `perftelemetry on|off|status|send`.
- 2026-03-29: B4 Follow-up — Retention fuer Telemetrie-Dateien aktiviert.
  `api/perf_telemetry.php` bereinigt alte `perf_*.jsonl` automatisch (Standard 7 Tage, optional `retention_days`).
- 2026-03-29: B4 Follow-up — Dateirotation fuer Telemetrie aktiviert.
  Telemetrie schreibt nun in Tages-Shards (`perf_YYYY-MM-DD[-N].jsonl`) mit Max-Size-Cap (Standard 8MB, konfigurierbar via `max_file_mb`) und begrenzter Shard-Anzahl (`max_shards`).
- 2026-03-29: B4 Follow-up — Telemetrie-Summary um Storage-/Rotationssicht erweitert.
  `action=summary` liefert jetzt Storage-Stats inkl. Limits (retention/max_file/max_shards); `perftelemetry summary` zeigt groessenlesbare Werte und aktive Rotationsgrenzen in der UI-Console.
