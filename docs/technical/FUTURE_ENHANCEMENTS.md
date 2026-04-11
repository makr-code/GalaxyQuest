# GalaxyQuest — Future Enhancements & Vision

> Strukturierter Ausblick auf geplante Verbesserungen, offene Fragen und die Langzeit-Vision.  
> **Status:** Living Document — nach jeder Implementierung aktualisieren.  
> Abgeschlossene Items: siehe Abschnitt "Abgeschlossene Enhancements (Archiv)" am Ende.  
> Detaillierter Implementierungsstatus: [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md)  
> Sprint-Planung: [ROADMAP.md](ROADMAP.md)

---

## Legende

| Symbol | Bedeutung |
|---|---|
| 🎯 | Hohe Priorität — nächste Implementierung |
| 💡 | Gute Idee, mittlere Priorität |
| 🔭 | Langfristig / Forschungsphase |
| ❓ | Design-Entscheidung erforderlich |

---

## Kurzfristig (nächste 8 Wochen)

Diese Items sind im nächsten Sprint direkt umsetzbar und haben hohen Gameplay-Impact.

### Wirtschaft & Produktion

- 🎯 **Wirtschaft Tier-2/Tier-3 Produktionsketten**: Rohstoff → Zwischenprodukt → Endprodukt im Colony-Tick verdrahten (`api/economy.php`, `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`)
- 🎯 **Pop-Satisfaction-System**: `economy_pop_classes.satisfaction_index` befüllen, an Güterverbrauch koppeln, Shortage/Starvation-Events triggern (`docs/technical/WAVE_17_IMPLEMENTATION_PLAN.md` Phase 1.1)
- 🎯 **Policy-Enforcement**: War-Economy-Policy, Autarkie, Merkantilismus vollständig durchsetzen (`api/economy.php`)
- 🎯 **Manufacturing-Bottleneck-Warnungen**: Visuelles Feedback im Frontend bei Produktionsengpässen

### Kriegssystem

- 🎯 **War-Frontend Completion**: War-Intelligence-Panel, War-Goal-Score im Frontend, Counter-Offer-UI vervollständigen (`docs/technical/GAP_TODO.md` B-1)
- 🎯 **War-Goal-Score sichtbar**: Backend trackt, Frontend zeigt derzeit "unknown" — UI-Kopplung nötig

### Piraten

- 🎯 **Piraten-Kontrakte & Konsequenzmechanik**: Tributbeziehungen, Verhandlungen, Raid-Eskalation (`docs/technical/GAP_TODO.md` B-3)
- 🎯 **Standing-Decay-Sichtbarkeit**: Backend liefert Wert, Frontend zeigt Änderungen/Decay-Rate noch nicht

### Infrastruktur

- 🎯 **CI/CD Pipeline**: GitHub Actions mit PHPUnit + Vitest + Playwright Smoke (kein Automatismus vorhanden)
- 🎯 **DB-Migration-Tooling**: Versioniertes Migrationssystem statt manueller SQL-Anwendung

---

## Mittelfristig (8–20 Wochen)

Tiefere Gameplay-Mechaniken und strategische Systeme.

### Diplomatie

- 🎯 **Diplomatic Plays: 4-Phasen-Eskalationsmodell**: Proposal → Counter → Mobilization → Resolution (`docs/gamedesign/GAMEPLAY_DATA_MODEL.md`)
- 🎯 **Trust/Threat als getrennte Diplomatie-Achsen**: Trust (aus Abkommen-Einhaltung), Threat (aus Militärstärke) unabhängig von `standing`
- 💡 **NPC-Diplomatiereaktionen**: NPC-Fraktionen reagieren auf Kriegserklärungen und Friedensverträge
- 💡 **Internal Factions**: Approval + Support-gewichteter Stabilitätsdruck

### Wirtschaft (Zielmodell)

- 💡 **Regionale Marktdynamik**: `MarketRegion` + `MarketQuotes` mit regionaler Preisbildung (α-Formel)
- 💡 **Colony Goods Flow**: `colony_goods_flow`-Tabelle live berechnen, Logistics Routes
- 💡 **Economy-Telemetrie-Snapshots**: Makro-Wirtschaftsdashboard für Spieler

### Exploration & Situations

- 🎯 **Anomalien & Relics**: Entdeckung, Untersuchung, Tech-Fragmente als Belohnungen
- 🎯 **Situations-Framework (Stellaris-inspiriert)**: Mehrstufige Incidents mit Lösungsansätzen, dynamische Konsequenzen
- 💡 **Weitere World-Scenarios**: Über Iron Fleet Global Council hinaus (2+ neue Szenarien)

### Militär

- 💡 **Fleet Supply & Readiness**: Supply Range, Maintenance Drain, Readiness-Combat-Faktor aus GAMEPLAY_DATA_MODEL
- 💡 **War Exhaustion & Status-Quo**: Erschöpfungs-Schwellwert erzwingt Waffenstillstand
- 💡 **Alliance Wars N-vs-M**: Mehrere Allianzen in einem Krieg

### Kolonien & Bevölkerung

- 💡 **Population Strata vollständig**: Workers/Specialists/Elites mit Migration/Resettlement zwischen Kolonien
- 💡 **Colony Buildings 3D-Frontend**: Isometrische WebGPU-Darstellung vollständig verdrahtet

### Siegpfade

- 🎯 **Wirtschafts-Siegpfad**: Galactic Market Dominanz (X% Marktanteile aller Gütertypen)
- 🎯 **Wissenschafts-Siegpfad**: Alle Forschungs-Meilensteine erreicht
- 🎯 **Diplomatie-Siegpfad**: Galaktische Liga — Mehrheit der Fraktionen verbündet
- 🎯 **Dominanz-Siegpfad**: Militärische Hegemonie (X% aller bewohnten Systeme)

---

## Langfristig (20–30 Wochen)

Content, Onboarding und technische Exzellenz für den Launch.

### Onboarding & Content

- 🎯 **Tutorial/Onboarding-Prolog (narrativ, 5-stufig)**: Interaktiver fraktionsspezifischer Prolog (`docs/gamedesign/ONBOARDING_PROLOGUE_DESIGN.md`)
- 🎯 **Faction Introduction Flow**: Herald-NPC führt durch Fraktionsaufstieg (`docs/gamedesign/FACTION_INTRODUCTION.md`)

### Endgame

- 💡 **Endgame-Krisen**: Zeitgesteuerte galaktische Events (Precursor-Erwachen, Void Entity, Grey Goo)
- 🔭 **Megastructures**: Dyson Sphere, Ring World, Gravity Well Generator, Ansible Array (Alliance-Level)

### Technische Qualität

- 💡 **Internationalisierung (i18n)**: Vollständiges Sprachsystem (Deutsch + Englisch), alle UI-Strings ausgelagert
- 💡 **WebSocket für Echtzeit-Multiplayer**: Ablösung von SSE durch bidirektionales WebSocket für Chat und Echtzeit-Updates
- 💡 **ThemisDB vollständige Migration** (Phase 1–6): Schema-Mapping, LLM-Migration, Graph-Modell, Vector/RAG, LoRA-Pipeline, Security (`docs/technical/THEMISDB_MIGRATION_ROADMAP.md`)
- 🎯 **JS-Refactoring Phase 2–4**: Domain-Subtrees, API-Modularisierung (`docs/technical/JS_REFACTOR_ZIELSTRUKTUR_TODO.md`)
- 🎯 **Selection Unification**: Alle 6 Phasen (`docs/technical/SELECTION_UNIFICATION_TODO.md`)
- 🎯 **Template System Migration**: Mustache-Migration für PHP/JS (`docs/technical/TEMPLATE_SYSTEM_DESIGN.md`)

### UI & UX

- 🎯 **UI/UX-Überarbeitung**: Responsives Design, konsistente Darstellung über alle Windows
- 💡 **Sound & Musik**: Vollständiges Audio-Design (SFX + Soundtrack via GQAudioManager)
- 🎯 **Production Deployment**: HTTPS, Secrets Management, Ollama im Production-Modus
- 🎯 **Load-Testing**: 100+ gleichzeitige Spieler simulieren

---

## Visionary / Post-Launch

Items die über den Launch hinaus die Langzeit-Retention und Community sichern.

| Feature | Beschreibung |
|---|---|
| 🔭 Galaxy-Seasons | Periodischer Reset mit Rankings; Saison-Ende-Belohnungen |
| 🔭 Debris-Field-Mechanik | Ressourcen aus zerstörten Schiffen, sammelbar durch Recycler |
| 🔭 Spy Counter-Intelligence | Eingehende Sonden erkennen und zerstören |
| 🔭 Cross-Galaxy Fleet Routing mit Waypoints | Automatische Routenplanung über mehrere Sprungpunkte |
| 🔭 Commander-Portraits | Generierte Portraits für Flotten-Kommandanten |
| 🔭 Fraktions-Reputationstitel | "Guild Associate", "Pirate Blood Brother" etc. |
| 🔭 Dark Theme / Light Theme Toggle | Benutzer-wählbares Theme |
| 🔭 Mobile-optimierte Dedicated Views | Dedizierte Mobile-UI statt responsivem Fallback |
| 🔭 Mod-Support / Plugin-System | Community-Mods für neue Fraktionen, Gebäude, Events |

---

## Offene Design-Fragen ❓

1. **Alliance-Ressourcenpools**: Sollen Allianzen einen gemeinsamen Vorrat für Megastructures aufbauen können? Oder rein diplomatisch/militärisch?

2. **Galaxy-Reset / Seasons**: Monatlicher Reset mit gespeicherten Rankings (frisch halten), oder persistente Galaxie für immer?

3. **Dark-Matter-Ökonomie**: Derzeit wird DM für FTL-Cooldown-Reset und FTL-Drive-Wechsel ausgegeben. Sollte DM auch Premium-Anführer, Build-Beschleunigung oder kosmetische Skins kaufen können?

4. **Flottengrößen-Limits**: Maximale Flottengröße pro Dispatch, um Late-Game-One-Shot-Empires zu verhindern? Oder Forschung (Computer Tech) hebt das Limit?

5. **Offline-Schutz**: Derzeit nur zeitbasierter Welpenschutz. Sollte es einen Urlaubs-Modus geben, der alle Aktivitäten pausiert? (`vacation_mode`-Spalte existiert, wird nicht durchgesetzt.)

6. **NPC-Fraktions-Territorium**: Sollen Fraktionen Sternsysteme mit NPC-Kolonien besitzen, die Spieler angreifen können? (Erfordert NPC-User-Accounts und Colony-Seeder.)

7. **Diplomatie-Aktionen**: Können Spieler Dark Matter ausgeben, um Standing zu reparieren? Oder Ressourcen als Geschenke senden?

8. **Wirtschafts-Sieg-Threshold**: Wie viel Prozent des galaktischen Marktes muss ein Spieler kontrollieren, um den Wirtschafts-Siegpfad zu gewinnen?

---

## Backlog (ungeordnet — nur offene Items)

- [ ] Debris-Field-Mechanik (Ressourcen aus zerstörten Schiffen, sammelbar durch Recycler)
- [ ] Spy Counter-Intelligence (Chance, eingehende Sonden zu erkennen und zu zerstören)
- [ ] Commander-Portrait / Avatar-Auswahl
- [ ] Fraktions-Reputationstitel (z. B. "Guild Associate", "Pirate Blood Brother")
- [ ] Cross-Galaxy Fleet-Routing mit Waypoints
- [ ] Export der Planetdaten als JSON (für Spieler-Tooling / Spreadsheets)
- [ ] Dark Theme / Light Theme Toggle
- [ ] Internationalisierung (i18n) — Deutsch + Englisch
- [ ] Mobile-optimierte dedizierte Views

---

## Abgeschlossene Enhancements (Archiv)

> Kompakte Liste aller abgeschlossenen Items aus der ursprünglichen FUTURE_ENHANCEMENTS.md.  
> Details sind in den jeweiligen Completion-Dokumenten nachvollziehbar.

### Phase 1 — Core Gameplay Loop ✅
- ✅ User Auth mit CSRF, Session-Schutz, Welpenschutz
- ✅ Prozedurale Galaxie (deterministisch, wissenschaftlich)
- ✅ Colony-Hierarchie: System → Planet → Colony → Buildings (22 Typen in 8 Kategorien)
- ✅ 16 Forschungstechnologien mit Prerequisite-Baum
- ✅ 16+ Schiffstypen, Shipyard-Queue
- ✅ 5 Fleet-Missionen: Attack · Transport · Colonize · Spy · Harvest
- ✅ 3D Newton'sche Flottenbewegung (x/y/z LY, speed_ly/h)
- ✅ Combat mit Tech-Levels, Commander-Skill, Shield-Penetration
- ✅ Population · Food · Happiness · Public Services Economy
- ✅ Rare-Earth-Deposits (endlich, klassenabhängig)
- ✅ Leader-System: Colony Manager · Fleet Commander · Science Director
- ✅ NPC-Fraktionen: Empire · Guild · Collective · Pirates · Precursors
- ✅ Faction-Diplomatie, Trade Offers, Faction Quests, Pirate Raids
- ✅ Achievements (15) mit Dark-Matter-Belohnungen
- ✅ Leaderboard, In-Game-Messaging, Battle Reports, Spy Reports
- ✅ Floating Window Manager (drag, resize, minimize, persist)

### Phase 2 — Depth & Polish ✅
- ✅ Echtzeit-Fleet-Tracking (Progress Bars, Position, Auto-Refresh)
- ✅ Building & Research Queue Countdown Timers
- ✅ Galaxy Map: 2D Sector View mit Colony Markers
- ✅ Espionage Spy Report UI Window
- ✅ Trade Route System (Player-to-Player)
- ✅ Research Prerequisites (4-Tier-Baum)
- ✅ Colony Specialisation Bonuses (6 Colony Types)
- ✅ Recall Fleet: Return Cargo

### Phase 3 — Multiplayer & Social ✅
- ✅ Alliance-System (komplett: Membership, Treasury, Diplomatie, Chat, Shared Intel)
- ✅ Server-Sent Events (SSE) für Echtzeit-Notifications
- ✅ Player-to-Player Trading (Trade Proposals, atomarer Accept-Flow)
- ✅ War-Declarations Backend (80% — Frontend partiell) — in aktiver Weiterentwicklung

### Phase 4 — AI & Simulation Depth ✅
- ✅ NPC-Player-Accounts (Bots) mit kolonie-typ-bewussten Strategien
- ✅ Fleet-Commander Active Decisions (Defensive Recall, Auto-Intercept, Auto-Scout)
- ✅ Dynamic Faction Events (Galactic War, Trade Boom, Pirate Surge)
- ✅ Planetary Events & Colony Events (Solar Flare, Disease, Archaeological Find)

### Phase 5 — Content Expansion ✅
- ✅ Extended Research Tree (+7 Technologies: nano_materials, genetic_engineering, quantum_computing, dark_energy_tap, terraforming_tech, stealth_tech, wormhole_theory)
- ✅ Additional Ship Types: Frigate, Carrier, Mining Drone, Hospital Ship, Science Vessel
- ✅ Wormhole Network (stabile/instabile Wurmlöcher, Beacon-Unlocks, Quest-Rewards)
- ✅ FTL-Drive-System (6 fraktionsspezifische Drives, vollständig implementiert)

### Phase 6 — Technical Quality ✅
- ✅ Security Hardening (Security-Headers, Rate-Limiting, Account-Lockout)
- ✅ Test Coverage (PHPUnit Baseline, Vitest JS Tests, Playwright E2E)
- ✅ API Versioning (`/api/v1/`, `config/api_version.php`, Frontend-Rewrite)
- ✅ Observability (Slow-Query-Logging, Admin-Stats-Endpoint)
- ✅ Mobile / Responsive Layout (WM Mobile Mode, Touch-Ergonomics)

### Weitere abgeschlossene Items
- ✅ Colony-Rename-History-Log
- ✅ Fleet Name / Custom Labels
- ✅ Moon Slots (1 pro Planet, Military Structures)
- ✅ Dark Matter Mine
- ✅ Battle Simulator UI
- ✅ Building Demolish (50% Ressourcen-Refund)
- ✅ Keyboard Shortcuts (B = Buildings, R = Research, etc.)
- ✅ WebGPU-Migration Phase 1–5 (Galaxy3DRenderer, Starfield, HybridPhysics, NPCPathfinding, Hardware-in-Loop CI)
- ✅ Post-Processing alle 5 Phasen (13 Passes)
- ✅ VFX Phase 1–3 (Weapon Fire, Multi-Entity, Debris Destruction)
- ✅ Kolonisierungssystem (Empire Sprawl, Sektoren, Gouverneure, Edikte) — GAP_TODO A-1
- ✅ Empire-Kategorien & Spionage (7 Scores, Spider-Chart, Agenten) — GAP_TODO A-2
- ✅ Colony Buildings Backend (Isometrisch) — GAP_TODO A-3
- ✅ Onboarding-Prolog (5-stufig, passwordlos, fraktionsspezifische Initial-Quests)
- ✅ NPC Chat Sessions (LLM, Summarization, JSON-Persistenz)
- ✅ Iron Fleet Mini-Fraktionen (6 YAML-Specs, IronFleetPromptVarsComposer)
- ✅ TTS-System (Piper, Deutsch, 4 Audio-Kanäle, SSE-Integration)
- ✅ SeamlessZoom Orchestrator (SPATIAL_DEPTH 0–4, zoomToTarget)
- ✅ GQAudioManager (music, sfx, teaser, tts Kanäle, duckMusicForTts)
