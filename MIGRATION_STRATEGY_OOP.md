# GalaxyQuest - OOP und Borders-of-Concern Migration

Status: Entwurf v1 zur direkten Umsetzung
Stand: 28.03.2026
Owner: Core Team (Backend + Frontend)

---

## 1. Zielbild

Die bestehende, funktionale Struktur wird schrittweise in klar getrennte Schichten ueberfuehrt:

1. Presentation Layer
- PHP API Controller (HTTP Input/Output, Auth-Check, Mapping)
- JS UI Layer (DOM, Window Manager, Renderer-Anbindung)

2. Application Layer
- Use Cases / Services pro Kontext
- Orchestrierung von Domain + Repositories

3. Domain Layer
- Entitaeten, Value Objects, Domain-Regeln
- Keine HTTP- oder DB-Abhaengigkeit

4. Infrastructure Layer
- PDO Repositories, Binary/JSON Decoder, externe Adapter
- Technische Implementierungen hinter Interfaces

Wichtig:
- Keine Big-Bang Migration
- Bestehende Endpoints bleiben stabil
- Strangler Pattern: neu daneben, dann Altpfad ersetzen

---

## 2. Scope und Priorisierung

### In Scope

1. Backend PHP Re-Strukturierung nach Kontexten
2. Frontend JS Entkopplung von game.js in Feature-Module
3. Einheitliche Fehler- und Response-Struktur
4. Testbare Interfaces fuer Kernfluesse

### Out of Scope (Phase 1)

1. Vollstaendige Neuimplementierung aller Features
2. DB-Schema-Rewrite
3. Echtzeit-Transport (SSE/WebSocket)

### Prioritaet (Reihenfolge)

1. Galaxy (hoechster technischer Druck)
2. Auth + Session
3. Colony Economy (game/buildings/research/shipyard)
4. Fleet + Combat
5. Messages
6. Factions + Leaders

---

## 3. Bounded Contexts

Definiert und verbindlich:

1. IdentityContext
- Login, Logout, Session, CSRF, User-Profil

2. GalaxyContext
- Stars, Systeme, Cluster, Suchlogik, Systempayload

3. ColonyContext
- Ressourcen, Produktion, Buildings, Shipyard, Research

4. FleetContext
- Missionen, Flugzeiten, Recall, Combat-Resolution

5. DiplomacyContext
- Factions, Standing, Trade Offers, Quests

6. MessagingContext
- Inbox, Read, Send, Delete, User Lookup

7. SharedKernel
- Error Types, Result Envelope, Time, Validation, IDs

---

## 4. Zielstruktur Dateien

## 4.1 Backend (neu)

src/
  Shared/
    Http/
      ApiResponse.php
      ApiError.php
      RequestContext.php
    Support/
      Clock.php
      Uuid.php
      Validator.php
  Identity/
    Domain/
    Application/
    Infrastructure/
    Presentation/
  Galaxy/
    Domain/
    Application/
    Infrastructure/
    Presentation/
  Colony/
    Domain/
    Application/
    Infrastructure/
    Presentation/
  Fleet/
    Domain/
    Application/
    Infrastructure/
    Presentation/
  Diplomacy/
    Domain/
    Application/
    Infrastructure/
    Presentation/
  Messaging/
    Domain/
    Application/
    Infrastructure/
    Presentation/

public/api/
  auth.php
  galaxy.php
  game.php
  buildings.php
  research.php
  shipyard.php
  fleet.php
  factions.php
  leaders.php
  messages.php

legacy/
  api/
  engine/

## 4.2 Frontend (neu)

js/
  app/
    bootstrap.js
    app-state.js
    event-bus.js
  services/
    api-client.js
    network-health.js
    cache-store.js
  features/
    galaxy/
      galaxy-controller.js
      galaxy-state.js
      galaxy-service.js
      galaxy-mappers.js
    colony/
    fleet/
    messages/
    factions/
  renderers/
    galaxy3d/
      galaxy3d-adapter.js
  ui/
    windows/
    components/
  legacy/
    game-legacy-bridge.js

---

## 5. Alt-zu-Neu Mapping (Startpaket)

## 5.1 PHP

1. api/galaxy.php
- Neu:
  - src/Galaxy/Presentation/GalaxyController.php
  - src/Galaxy/Application/GetSystemPayloadService.php
  - src/Galaxy/Application/GetStarsRangeService.php
  - src/Galaxy/Infrastructure/PdoGalaxyRepository.php
  - src/Galaxy/Infrastructure/BinarySystemPayloadEncoder.php

2. api/auth.php
- Neu:
  - src/Identity/Presentation/AuthController.php
  - src/Identity/Application/LoginService.php
  - src/Identity/Application/RegisterService.php
  - src/Identity/Infrastructure/PdoUserRepository.php

3. api/game_engine.php
- Neu:
  - src/Colony/Domain/ProductionCalculator.php
  - src/Fleet/Domain/FlightCalculator.php
  - src/Shared/Support/GameConstants.php

4. api/game.php + buildings.php + research.php + shipyard.php
- Neu:
  - src/Colony/Presentation/ColonyController.php
  - src/Colony/Application/*
  - src/Colony/Infrastructure/PdoColonyRepository.php

5. api/fleet.php
- Neu:
  - src/Fleet/Presentation/FleetController.php
  - src/Fleet/Application/*
  - src/Fleet/Infrastructure/PdoFleetRepository.php

## 5.2 JS

1. js/game.js
- Herausziehen nach:
  - js/features/galaxy/*
  - js/features/colony/*
  - js/features/fleet/*
  - js/features/messages/*

2. js/api.js
- Teilen in:
  - js/services/api-client.js
  - js/services/request-queue.js
  - js/services/network-health.js

3. js/galaxy3d.js
- Kapseln hinter:
  - js/renderers/galaxy3d/galaxy3d-adapter.js

---

## 6. Architekturregeln (verbindlich)

1. Controller duerfen keine SQL-Statements enthalten.
2. Application Services duerfen kein DOM und kein HTTP kennen.
3. Domain kennt keine PDO- oder Fetch-Objekte.
4. Infrastructure implementiert nur Interfaces der Application/Domain.
5. Frontend UI darf nie direkt fetch aufrufen; nur ueber Service Layer.
6. Jede neue Funktion braucht:
- Input Validation
- Typed Mapping
- Error Mapping
- Testfall mindestens fuer Happy Path + 1 Error Path

---

## 7. API- und Error-Standard

Alle Responses folgen einem Envelope:

Success:
{
  "success": true,
  "data": { ... },
  "meta": { "trace_id": "...", "ts": 1710000000000 }
}

Error:
{
  "success": false,
  "error": {
    "code": "GALAXY_SYSTEM_NOT_FOUND",
    "message": "System nicht gefunden",
    "details": { ... }
  },
  "meta": { "trace_id": "...", "ts": 1710000000000 }
}

Fehlercodes (Startset):
1. AUTH_UNAUTHORIZED
2. AUTH_CSRF_INVALID
3. VALIDATION_FAILED
4. GALAXY_RANGE_INVALID
5. GALAXY_SYSTEM_NOT_FOUND
6. NETWORK_UNREACHABLE
7. INTERNAL_ERROR

---

## 8. Migrationsphasen mit Sprintplan

## Phase 0 - Vorbereitung (3-5 Tage)

Tasks:
1. Zielstruktur-Ordner anlegen.
2. Gemeinsame Konventionen in Team-Session festlegen.
3. API Envelope Utility in Shared erstellen.
4. Baseline Regression-Checkliste definieren.

Akzeptanz:
- Shared ApiResponse/ApiError vorhanden.
- Ein Endpoint kann bereits Envelope ausgeben.

## Phase 1 - Galaxy Vertical Slice (1-2 Wochen)

Tasks:
1. Neuer GalaxyController und Services bauen.
2. Bestehende Logik aus api/galaxy.php schrittweise in Service schieben.
3. Binary/JSON Ausgabe ueber klaren Adapter.
4. Frontend galaxy-service.js erstellt und in game.js ueber Bridge integriert.

Akzeptanz:
- Endpoint-Verhalten unveraendert fuer Consumer.
- Drei Kernflows stabil:
  - Sternebereich laden
  - Systemdetails laden
  - Fehlerfallback bei Timeout

## Phase 2 - Identity und Session Slice (3-5 Tage)

Tasks:
1. AuthController + Services.
2. Session/CSRF in Shared RequestContext kapseln.
3. Einheitliche Auth-Fehlercodes.

Akzeptanz:
- login/me/logout/csrf laufen ueber neue Schicht.

## Phase 3 - Colony Slice (2 Wochen)

Tasks:
1. Produktionslogik aus game_engine in Domain-Kalkulatoren aufteilen.
2. colony/buildings/research/shipyard Use Cases trennen.
3. Repositories fuer Colony/Queue.

Akzeptanz:
- Overview, Upgrade, Research, Build stabil.
- Kein SQL in Controllern.

## Phase 4 - Fleet Slice (1-2 Wochen)

Tasks:
1. Flight und Combat in Fleet Domain kapseln.
2. Send/List/Recall Services.
3. Regression fuer Arrival/Recall/Cargo.

Akzeptanz:
- Keine funktionalen Unterschiede fuer Spieler.

## Phase 5 - Messages, Diplomacy, Leaders (1-2 Wochen)

Tasks:
1. Je Kontext eigener Controller + Service + Repository.
2. Frontend Module splitten und game.js weiter entlasten.

Akzeptanz:
- game.js deutlich reduziert.
- Alle bisherigen Fenster funktionieren.

## Phase 6 - Legacy Cleanup (laufend)

Tasks:
1. Nicht mehr genutzte Legacy-Teile markieren.
2. Nach 2 stabilen Releases entfernen.

Akzeptanz:
- Legacy-Bridge minimal.
- Architekturregeln in CI verankert.

---

## 9. Konkreter Umsetzungs-Backlog (copy-paste in Tickets)

## Epic A - Shared Foundation

1. A1: ApiResponse Utility erstellen
- Output: src/Shared/Http/ApiResponse.php
- DoD: success/error Envelope + unit test

2. A2: ApiError + ErrorCode Registry
- Output: src/Shared/Http/ApiError.php
- DoD: Mapping fuer 7 Start-Fehlercodes

3. A3: RequestContext
- Output: src/Shared/Http/RequestContext.php
- DoD: Session user_id, csrf, trace_id

## Epic B - Galaxy Slice

1. B1: GalaxyController Skeleton
2. B2: GetStarsRangeService
3. B3: GetSystemPayloadService
4. B4: PdoGalaxyRepository
5. B5: Binary Encoder Adapter
6. B6: Frontend galaxy-service + Bridge
7. B7: E2E Smoke Test

## Epic C - Frontend Modularisierung

1. C1: js/features/galaxy anlegen
2. C2: ui event handlers migrieren
3. C3: state aus game.js extrahieren
4. C4: renderer adapter einfuehren

---

## 10. Testing- und Qualitaetsstrategie

## 10.1 Backend Tests

1. Unit
- Domain Calculators (deterministische Inputs/Outputs)
- Error Mapper

2. Integration
- Repository gegen Test-DB
- Controller mit Mock RequestContext

3. Contract
- Snapshot fuer JSON/Binary Schema (galaxy)

## 10.2 Frontend Tests

1. Unit
- Mapper, Sorter, Filter, Range-Validator

2. Integration
- API Client Retry/Timeout/Error classification

3. E2E (manuell/automatisiert)
- Login -> Galaxy laden -> System oeffnen -> Fallback bei Netzfehler

---

## 11. CI Gates (ab Phase 1 verpflichtend)

1. Lint Gate
- PHP CS
- JS Lint

2. Test Gate
- Unit + Integration minimum

3. Architektur Gate
- Verbotene Imports (z.B. UI -> direkte API intern)
- Verbotene SQL in Presentation Layer

4. Release Gate
- Smoke Script erfolgreich

---

## 12. Risk Register + Gegenmassnahmen

1. Risiko: Regressionen durch schrittweises Umbauen
- Gegenmassnahme: Vertical Slices + Feature Flags + Snapshot Tests

2. Risiko: Mischzustand zu lange
- Gegenmassnahme: Timebox je Slice, klare Exit-Kriterien

3. Risiko: Team driftet von Regeln ab
- Gegenmassnahme: ADRs + CI Architekturregeln

4. Risiko: Performance sinkt
- Gegenmassnahme: Metriken vor/nach je Slice (p95, payload size)

---

## 13. Rollout- und Rollback-Plan

Rollout:
1. Neuer Slice hinter Config-Flag aktivieren.
2. Zuerst lokal/staging, dann produktiv.
3. Monitoring fuer Error Rate und p95.

Rollback:
1. Flag auf Legacy zurueck.
2. Deployment ohne DB-Rollback sofern Schema kompatibel.

---

## 14. Definition of Done pro Slice

Ein Slice gilt als fertig, wenn:
1. Alle Endpoints des Slices auf neue Schicht umgestellt sind.
2. Keine SQLs in Presentation verbleiben.
3. Error Envelope einheitlich.
4. Smoke-Flows gruen.
5. Dokumentation aktualisiert:
- ARCHITECTURE.md
- ROADMAP.md oder FUTURE_ENHANCEMENTS.md falls relevant

---

## 15. 14-Tage Startplan (praxisnah)

Tag 1-2
1. Shared Foundation + Error Envelope
2. Architekturregeln als Teamentscheid fixieren

Tag 3-5
1. GalaxyController + Service Grundgeruest
2. Erster Endpoint ueber neue Schicht

Tag 6-8
1. Galaxy Sternebereich + Systempayload migrieren
2. Frontend Galaxy Service Bridge anbinden

Tag 9-10
1. Tests und Timeout/Fallback-Hardening
2. Performance Vergleich alt vs neu

Tag 11-12
1. Auth Slice starten
2. Session/CSRF Vereinheitlichung

Tag 13-14
1. Stabilisierung
2. Review + Plan fuer Colony Slice

---

## 16. Entscheidungen (ADR-Liste)

Fuer jede wichtige Entscheidung ein ADR mit:
1. Kontext
2. Entscheidung
3. Alternativen
4. Konsequenzen

Pfadvorschlag:
- docs/adr/ADR-001-error-envelope.md
- docs/adr/ADR-002-galaxy-slice-interfaces.md

---

## 17. Sofort naechster Schritt

Direkt umsetzen in dieser Reihenfolge:
1. Shared ApiResponse + ApiError bauen
2. GalaxyController Skeleton erstellen
3. Eine Route aus api/galaxy.php ueber neuen Service laufen lassen

Wenn diese drei Punkte stehen, ist die Migration praktisch gestartet und messbar.
