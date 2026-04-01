# GalaxyQuest - Datenmodell und Spielemechanik

Status: umsetzungsreif
Version: 1.0
Stand: 28.03.2026

---

## 1. Ziel des Dokuments

Dieses Dokument definiert ein belastbares Zielmodell fuer:

1. das fachliche Datenmodell (Domain + relationale Persistenz)
2. die Kern-Spielemechanik (Makro- und Mikro-Loops)
3. die Umsetzungsschritte fuer bestehende GalaxyQuest-Features

Designprinzip:
- Kombination aus Anno-typischen Produktionsketten,
- Victoria-typischer Markt- und Gesellschaftsdynamik,
- Ascendancy-typischer 4X Expansion/Forschung/Diplomatie.

Das Modell ist auf die bestehende Architektur abgestimmt und kann inkrementell umgesetzt werden.

---

## 2. Externe Leitmuster (Recherche-Synthese)

## 2.1 Anno-Muster, die wir uebernehmen

1. Mehrstufige Versorgungsketten statt isolierter Einzelproduktion
2. Bevoelkerungsstufen mit Bedarfen und Freischaltungen
3. Regionale Spezialisierung + Handelsrouten als Kern der Expansion
4. Attraktivitaets-/Umweltspannungsfeld als Gegengewicht zu Industrieoptimierung

## 2.2 Victoria-3-Muster, die wir uebernehmen

1. Gueterfluss und Preisbildung als Makroregler fuer Wirtschaft
2. Soziooekonomische Gruppen (abgespeckt) statt nur globale Happiness-Zahl
3. Diplomatie vor Krieg: Eskalationsphasen, Verhandlungen, Drohkulissen
4. Politische Konsequenzen von Oekonomie (Steuern, Legitimitaet, Stabilitaet)

## 2.3 Ascendancy-Muster, die wir uebernehmen

1. Starker Planet-/Systemfokus mit lokalen Spezialisierungen
2. 4X-Rhythmus: Explore, Expand, Exploit, Exterminate, plus Diplomatie
3. Forschungsfunds und Anomalien als Beschleuniger/Varianzfaktor
4. Sternennetz + Reichweiten-/Korridorlogik fuer strategische Bewegung

## 2.4 Weitere 4X-Referenzen (Master of Orion usw.)

### Master of Orion II: Battle at Antares

Uebernehmen:
1. Mehrere Planeten pro System mit unterschiedlicher Eignung und Spezialisierung
2. Klarer Tradeoff zwischen Nahrung, Industrie und Forschung auf Kolonieebene
3. Kombinierbare Siegpfade (militaerisch, diplomatisch, Sonderziel)

Nicht uebernehmen:
1. Zu hohe Mikromanagement-Last pro Tick

### Master of Orion III

Uebernehmen:
1. Makrosteuerungsidee mit delegierbaren Routinen (Governor/Automatisierung)
2. Senate-/Resolution-Logik als diplomatische Metaebene

Explizit vermeiden (Design-Lektion):
1. Intransparente Automatisierung ohne verstaendliche Erklaerung
2. Unzuverlaessige KI-Ausfuehrung gegen Spielerintention
3. UI-Overload ohne priorisierte Entscheidungsoberflaechen

### Stellaris

Uebernehmen:
1. Ereignisketten und Endgame-Krisen gegen Late-Game-Stagnation
2. Empire-Identitaet ueber Ethos/Civics als systemische Modifikatoren
3. Hyperlane-/Korridordenken fuer strategische Flottenprojektion
4. Situations-Framework mit Progress, Stages, Approaches und klaren Endzustaenden
5. Trust/Threat als getrennte Diplomatieachsen statt eindimensionaler Standing-Zahl
6. War Exhaustion + Status-Quo-Mechanik fuer begrenzte, glaubhafte Kriegsenden

Konkreter Transfer nach GalaxyQuest:
1. Defizite als Situation statt sofortiger Globalstrafe:
- jedes kritische Defizit startet einen mehrstufigen Incident mit 2-3 Gegenstrategien
- jede Strategie hat Kosten (z. B. weniger Forschung, mehr upkeep, geringere Zufriedenheit)
- Abschluss erzeugt zeitlich befristete Nachwirkungen (Recovery-Modifier)

2. Interne Politik als messbares System:
- Factions mit approval (0..100), support (machtgewichtet), issue-set
- policies und diplomatische Haltung geben plus/minus auf Approval
- niedrige Approval drueckt direkt auf Produktivitaet/Stabilitaet statt nur Flavor

3. Pop-Wohlfahrt als harter Produktionsfaktor:
- housing deficit und amenities deficit senken Stabilitaet nachvollziehbar
- strata-gewichtete Zustimmung bestimmt Stabilitaetsbonus/-malus
- Migration/Resettlement folgt sichtbaren Pull-Faktoren

4. Diplomatie als Vertragsmatrix:
- pacts mit upkeep und Mindestvertrauen
- Trust waechst mit Kooperation, zerfaellt bei Krieg/Rivalitaet
- Threat steigt bei Aggression und bildet Gegenkoalitionen

5. Kriegsabschluss ohne Alles-oder-Nichts:
- War Exhaustion pro Seite
- nach Schwellwert + Frist kann Status Quo erzwungen werden
- Territoriale Effekte aus Claims + Besetzung klar getrennt von Kriegsziel

6. Markt- und Lagerlogik fuer Krisenresilienz:
- harte Lagerlimits je Ressourcentyp
- automatischer Handel mit Min/Max-Preisgrenzen
- Marktgebuehren als Balancing-Hebel gegen triviales Arbitrage-Spiel

Nicht uebernehmen:
1. Regel- und Tooltip-Overhead durch zu viele parallel aktive Sondersysteme
2. DLC-aehnliche Systemzersplitterung ohne konsistente Core-Loops

### Endless Space 2

Uebernehmen:
1. Asymmetrische Fraktionsidentitaeten als Replay-Treiber
2. System-/Planet-Anomalien mit Chancen-/Risikocharakter
3. Politische Stroemungen/Gesetze als Bruecke zwischen Oekonomie und Diplomatie

---

## 2.5 Separation of Concerns (Architekturleitlinie)

Die Weiterentwicklung von GalaxyQuest folgt einer klaren Schichtentrennung:

1. Datenmodell/SQL:
- additive Migrationen, keine Breaking-Rewrites
- Kontexttabellen pro Fachbereich (z. B. LLM-Profile, Request-Logs, Situationen)

2. Backend PHP:
- Controller/Endpoint: HTTP + Auth + CSRF
- Application Service: Orchestrierung und Regeln
- Repository/Infrastructure: DB/Datei-Zugriff

3. Konfiguration (YAML/JSON):
- YAML als Autorenformat
- JSON als Runtime-Quelle fuer performante und robuste Einlesung

4. Frontend JS/HTML:
- API-Service-Schicht statt direkter Logikvermischung
- UI bindet nur auf stabile Endpoint-Vertraege

Konkreter v1-Vertical-Slice:
- SQL: `sql/migrate_llm_soc_v1.sql`
- YAML/JSON: `config/llm_profiles.yaml`, `config/llm_profiles.json`
- Backend: `api/llm.php`, `api/llm_soc/*`
- Frontend: `js/api.js`, `js/game.js` (Settings-Panel fuer Profile)

---

## 3. Ziel-Gameplay in einem Satz

Der Spieler baut ein interstellares Wirtschafts- und Machtgeflecht aus spezialisierten Kolonien auf, stabilisiert Gesellschaft und Markt, und setzt Flotten sowie Diplomatie situationsabhaengig ein, um in einem persistierenden 4X-Universum Dominanz zu erreichen.

---

## 4. Fachliches Datenmodell (Domain)

## 4.1 Aggregate und Verantwortungen

1. PlayerEmpire
- Eigentum: User, Fraktionenstandings, globale Policies, Forschung
- Invarianten: User hat genau ein Homeworld-Cluster, niemals negative Premiumwaehrung

2. StarSystem
- Eigentum: Sternparameter, Planetenliste, Kontrollstatus
- Invarianten: system_index pro galaxy eindeutig

3. Planet
- Eigentum: Klassenparameter, Deposits, Habitability, Hazard
- Invarianten: Position in System eindeutig, Deposits nie unter -1 (nur Sonderfall unendlich)

4. Colony
- Eigentum: Lager, Workforce, Produktionsnetz, Wohlfahrt, Build Queues
- Invarianten: colony gehoert zu genau einem user + einem planet

5. MarketRegion
- Eigentum: Angebot/Nachfrage pro Gut, Preis, Handelsvolumen
- Invarianten: Preis innerhalb konfigurierter Min/Max-Bounds

6. Fleet
- Eigentum: Komposition, Auftrag, Route, Cargo, Zustand
- Invarianten: entweder outbound oder returning, nicht beides

7. DiplomacyState
- Eigentum: bilateral standing, pacts, active diplomatic plays
- Invarianten: pro (actor,target) genau ein aktiver standing-Snapshot pro Tick

8. ResearchState
- Eigentum: Tech-Level, aktive Projekte, Modifikatoren
- Invarianten: Tech-Level monoton steigend

---

## 4.2 Relationales Zielmodell (SQL-nah)

Hinweis: bestehende Tabellen bleiben erhalten, neue Tabellen werden additiv eingefuehrt.

### Bestehende Kerntabellen (bleiben)

1. users
2. star_systems
3. planets
4. colonies
5. buildings
6. research
7. ships
8. fleets
9. factions
10. user_faction_standing

### Neue/erweiterte Tabellen (v1)

1. goods
- id, key, category, base_price, mass, perish_rate, strategic_flag

2. market_regions
- id, key, galaxy_index, scope (galaxy|sector|empire)

3. market_quotes
- market_region_id, goods_id, buy_price, sell_price, supply, demand, volume_24h, updated_at

4. colony_goods_flow
- colony_id, goods_id, produced_per_h, consumed_per_h, imported_per_h, exported_per_h

5. population_strata
- colony_id, stratum (workers, specialists, elites), size, literacy, radicalization, loyalty

6. colony_needs
- colony_id, need_key, fulfillment_ratio, shortage_ticks

7. logistics_routes
- user_id, source_colony_id, target_colony_id, mode (auto|manual), capacity_per_h, priority, active

8. diplomatic_plays
- id, actor_user_id, target_type, target_id, goal, phase, deadline_at, war_triggered

9. colony_modifiers
- colony_id, modifier_key, source, value, expires_at

10. anomalies
- id, system_id, anomaly_type, discovered_by_user_id, state, reward_payload_json

11. empire_policies
- user_id, policy_key, level, enacted_at

12. telemetry_economy_snapshots
- user_id, ts, gdp_proxy, total_supply, total_demand, inflation_index, war_pressure

---

## 4.3 Schlüsselbeziehungen

1. Ein User steuert mehrere Colonies.
2. Jede Colony ist auf genau einem Planet.
3. Planets gehoeren zu genau einem StarSystem.
4. MarketRegion aggregiert mehrere Colonies.
5. Goods werden in Colony produziert/verbraucht und ueber LogisticsRoutes verschoben.
6. Diplomacy wirkt auf Fleet-Zugang, Handel und Standing.

---

## 5. Kernmechaniken

## 5.1 Primary Loop (10-30 Minuten)

1. Bedarfsluecken analysieren (Food, Energy, Industriegoods, Militaergoods)
2. Produktion/Import priorisieren
3. Build/Research/Fleet-Auftraege setzen
4. Logistik und Marktpreise beobachten
5. Diplomatische Risiken absichern oder bewusst eskalieren
6. Kurzfristige Events loesen (Raid, Defizit, Anomalie)

## 5.2 Secondary Loop (60-180 Minuten)

1. Neue Systeme erschliessen und kolonisieren
2. Kolonien spezialisieren (Mining, Industry, Science, Agri, Military)
3. Handelsnetz robust machen (Redundanz, Route-Prioritaeten)
4. Flottenpositionen als Abschreckung oder Projektion nutzen

## 5.3 Long Arc Loop (Session-uebergreifend)

1. Tech-Durchbrueche
2. Fraktionsblockbildung und langfristige Pact-Struktur
3. Oekonomische Hegemonie in Marktregionen
4. Siegpfade: Wirtschaft, Wissenschaft, Diplomatie, Dominanz

---

## 6. Mechanikmodule im Detail

## 6.1 Wirtschaft und Gueterfluss

### Produktionsketten

1. Rohstoffe: metal, crystal, deuterium, rare_earth, food
2. Zwischenprodukte: alloys, electronics, fuel_cells, medical_supplies
3. Endprodukte: fleet_modules, luxury_goods, defense_systems

### Produktionsformel (pro Colony, pro Gut)

produced = base_rate
  * building_level_factor
  * workforce_factor
  * happiness_factor
  * energy_factor
  * policy_factor
  * terrain_or_planet_modifier

### Verbrauchsformel

consumed = population_needs + industry_input + fleet_maintenance + policy_upkeep

### Preisbildung (pro MarketRegion)

price_t+1 = clamp(
  price_t * (1 + alpha * (demand - supply) / max(1, supply)),
  min_price,
  max_price
)

Empfehlung:
- alpha initial 0.03
- Preisupdates alle 60s oder beim major tick

---

## 6.2 Gesellschaft und Stabilitaet (Victoria-light)

Jede Colony hat Strata:
1. workers
2. specialists
3. elites

Jede Strata besitzt:
- size
- loyalty
- radicalization
- literacy

Ableitungen:
1. productivity_bonus aus loyalty und literacy
2. unrest_risk aus radicalization + shortages + tax_pressure
3. migration_pressure aus unemployment + housing + security

Globaler Colony-Stabilitaetsindex:

stability = w1*happiness + w2*public_services + w3*need_fulfillment - w4*radicalization

Schwellwerte:
1. stability < 35: Streiks/Production Penalty
2. stability < 20: Aufstandsevents

---

## 6.3 Expansion und Planetenspezialisierung (Ascendancy-light)

Planet-Attribute steuern Spezialisierung:
1. deposit profile
2. habitability score
3. hazard profile (radiation, temperature extremes)
4. orbital capacity

Spezialisierungstypen:
1. Extractor World
2. Forge World
3. Agri World
4. Research World
5. Bastion World

Jeder Typ:
- +2 starke Boni
- -1 Tradeoff

Beispiel:
Forge World
- +20% intermediate goods
- +15% ship component throughput
- -10% happiness (pollution strain)

---

## 6.4 Diplomatie und Eskalation (Diplomatic Play)

Phasenmodell:
1. Proposal
2. Counter Demands
3. Mobilization Window
4. Resolution (Deal oder War)

Inputs:
1. standing
2. military_power_delta
3. market_dependency
4. ally_commitments

Outputs:
1. treaty
2. sanctions
3. war_state

Krieg ist nicht erste Option, sondern Endpunkt einer gescheiterten Verhandlungskette.

---

## 6.5 Flotten, Reichweite, Versorgung

Bestehendes 3D-Flugsystem bleibt Kern.

Ergaenzungen:
1. Supply Range:
- Flotte ausserhalb Reichweite erhaelt readiness/morale penalties

2. Maintenance Drain:
- fuel + spare_parts Verbrauch pro Stunde

3. Fleet Readiness:
- beeinflusst effective combat strength

combat_power_effective = base_power * readiness * commander_bonus * tech_bonus

---

## 6.6 Forschungssystem

Vier Baeume:
1. Industry
2. Science
3. Logistics
4. Military

Mechanik:
1. Shared research points (empire-wide)
2. Optional fokussierte Programmlinien pro Colony
3. Breakthrough-Chance via anomalies/relics

Anomalien liefern:
1. tech fragments
2. unique modifiers
3. map intel

---

## 6.7 Rassen-, Regierungs- und Fraktionsmodell (Stellaris-inspiriert)

Ziel:
1. Empire-Identitaet ueber Spezies + Regierungsform + Civics
2. Interne Fraktionen als dynamische Stabilitaets- und Produktionsachse
3. Laufende Boni/Mali statt statischer Startwerte

Bausteine:
1. Species Profile:
- bestimmt Baseline-Modifier (z. B. +Rohstoffoutput, -Nahrungsoutput, +Popwachstum)

2. Government Form:
- bestimmt Autoritaetsstil und Kern-Tradeoffs
- Beispiel: Republic = mehr Wohlfahrt, weniger Bruttoproduktivitaet

3. Civics (0-2 aktiv):
- Feintuning des Reichsprofils
- optional an Regierungsform gebunden

4. Internal Factions:
- approval (0..100) + support (machtgewichtet)
- erzeugen Druck auf Wirtschaft/Bevoelkerungsdynamik

Dynamische Effektmatrix (runtime):
1. resource_output_mult
2. food_output_mult
3. pop_growth_mult
4. happiness_flat
5. public_services_flat
6. research_speed_mult
7. fleet_readiness_mult

Factions als dynamischer Druck:
1. gewichteter Approval-Score aus support * approval
2. niedriger Score erzeugt Happiness-Malus
3. hoher Score erzeugt moderaten Happiness-Bonus
4. issue-spezifische Fraktionen (industrialists, scientists, civic_union, security_bloc)
  geben zusaetzliche, kontextabhaengige Boni/Mali

Konkrete Runtime-Folge bei aktivem `faction_unrest`:
1. resource_output_mult sinkt (basisabhaengig von stage/progress)
2. food_output_mult sinkt
3. happiness_flat sinkt deutlich
4. public_services_flat sinkt
5. approach-Tradeoff:
- `repression`: bessere fleet_readiness, staerkere Happiness-Strafe
- `reforms`: weniger soziale Strafe, aber staerkerer Output-Verlust
- `conciliation`: mittlere Variante

---

## 7. Eventmodell

## 7.1 Event-Typen

1. EconomicEvent (shortage, boom, strike)
2. SecurityEvent (raid, sabotage, unrest)
3. ScienceEvent (anomaly, breakthrough)
4. DiplomacyEvent (offer, threat, alliance request)

Erweiterung aus Stellaris-Situationslogik:
5. SituationEvent (staged incidents mit progress und approach)

## 7.2 Verarbeitung

1. Trigger Condition geprueft
2. Event in queue
3. Player Choice oder auto resolve
4. Effekt als colony_modifiers oder standing-change persistiert

### 7.3 Situation-Framework (neu)

Ein SituationEvent besitzt:
1. type (shortage, revolt, anomaly, diplomatic_crisis, AI_incident)
2. progress (0..100)
3. stage (I..IV)
4. approaches[] (spielerwaehlbare Strategien)
5. monthly_deltas (ressourcen, stabilitaet, output, threat, trust)
6. completion_outcome und fail_outcome

Regel:
1. stage-Wechsel triggern Event-Choices
2. ab kritischer Stage wird Ansatzwechsel gesperrt (Commitment-Moment)
3. Abschluss erzeugt 3-10 Jahre Modifier (Recovery oder Trauma)

Beispiele:
1. Energiekrise:
- Ansatz A: Forschung kuerzen, Wirtschaft stabilisieren
- Ansatz B: Notkredite, Fraktionsmalus
- Ansatz C: Rationierung, Stabilitaetseinbruch

2. Kolonieunruhen:
- Progress steigt bei niedriger Stabilitaet, Arbeitslosigkeit, Mangellage
- Progress sinkt durch Garnison, oeffentliche Dienste, Policy-Anpassung

---

## 8. Balancing-Rahmen

## 8.1 Leitwerte

1. Kein exponentieller Snowball ohne Gegenkraefte
2. Defizitphasen sollen spielbar, aber spuerbar sein
3. Expansion muss Logistikdruck erzeugen
4. Krieg muss wirtschaftlich teuer sein

## 8.2 Wichtige Balancing-Hebel

1. alpha der Preisformel
2. upkeep fuer High-Tier-Flotten
3. policy upkeep
4. unrest thresholds
5. route capacity limits
6. trust decay/growth rates
7. threat generation/decay rates
8. war exhaustion growth + status-quo timer
9. situation progress multipliers je Krisentyp

---

## 9. Umsetzung in GalaxyQuest (inkrementell)

## Phase A - Fundament (2-3 Wochen)

1. goods + market_regions + market_quotes einziehen
2. colony_goods_flow ableiten
3. erste Preisbildung aktivieren (nur Anzeige + kleine Effekte)
4. situation_states + faction_approval_history via `sql/migrate_gameplay_model_v1.sql`

Akzeptanz:
- Jede Colony zeigt Produktion/Verbrauch je Gut.
- Galaxy/Overview zeigt regionale Preisindikatoren.

## Phase B - Gesellschaftsmodul (2 Wochen)

1. population_strata + colony_needs
2. stability index einbauen
3. negative Events bei Mangellagen

Akzeptanz:
- Mangellage fuehrt reproduzierbar zu Produktivitaetsverlust.

## Phase C - Diplomatic Plays (2 Wochen)

1. diplomatic_plays Tabelle + API
2. 3-Phasen-Flow im UI
3. War als letzter Schritt

Akzeptanz:
- Mindestens ein diplomatischer Konflikt ohne Krieg abschliessbar.

## Phase D - Supply + Fleet Readiness (1-2 Wochen)

1. readiness und maintenance in fleet tick
2. supply penalties ausser Reichweite

Akzeptanz:
- gleiche Flotte kaempft je nach Versorgung unterschiedlich stark.

## Phase E - Anomalien und Breakthroughs (1 Woche)

1. anomalies + rewards
2. Tech-Fragmente in Forschung integrieren

Akzeptanz:
- mindestens drei Anomalietypen spielbar.

---

## 10. API-Schnittstellen (neue Endpunkte)

1. GET api/market.php?action=quotes&region_id=...
2. GET api/colony.php?action=goods_flow&colony_id=...
3. GET api/colony.php?action=population&colony_id=...
4. POST api/diplomacy.php?action=play_start
5. POST api/diplomacy.php?action=play_offer
6. POST api/diplomacy.php?action=play_resolve
7. GET api/anomalies.php?action=list&galaxy=...&system=...
8. POST api/anomalies.php?action=exploit
9. GET api/situations.php?action=list&status=active|all
10. POST api/situations.php?action=start
11. POST api/situations.php?action=set_approach
12. POST api/situations.php?action=tick
13. POST api/situations.php?action=resolve
14. GET api/politics.php?action=catalog
15. GET api/politics.php?action=status
16. POST api/politics.php?action=configure
17. GET api/politics.php?action=presets
18. POST api/politics.php?action=apply_preset

### 10.1 Tick-Pseudocode (Situations)

```text
for each active_situation in user_scope:
  elapsed_h = (now - last_tick_at) / 3600
  base_rate = monthly_deltas.progress_per_hour or 1.0
  approach_mult = monthly_deltas.approach_multipliers[current_approach] or 1.0
  progress_delta = elapsed_h * base_rate * approach_mult

  progress = clamp(progress + progress_delta, 0, 100)
  new_stage = stage_from_progress(progress)

  if new_stage != old_stage:
    write situation_stage_log

  if new_stage >= 3:
    approach_locked = true

  if progress >= 100:
    status = resolved
    apply completion_outcome modifiers
  else if progress <= 0 and progress_delta < 0:
    status = failed
    apply fail_outcome modifiers
  else:
    status = active

  persist(progress, stage, status, lock_state, last_tick_at)
```

Stage mapping:
1. Stage I: 0-24
2. Stage II: 25-49
3. Stage III: 50-79
4. Stage IV: 80-100

---

## 10.3 NPC / PvE Controller (LLM-Integrated)

Ziel:
1. Nichtspieler-Fraktionen erhalten eine adaptive, aber kontrollierte Entscheidungslogik.
2. LLM-Output bleibt strikt durch regelbasierte Guardrails begrenzt.
3. Bei LLM-Fehlern faellt das System auf die klassische deterministische NPC-Logik zurueck.

### Runtime-Flow

1. `overview` triggert `npc_ai_tick(...)`.
2. Pro Fraktion versucht `npc_pve_llm_controller_try(...)` genau eine Entscheidung.
3. Decision wird normalisiert und validiert (Action-Whitelist, Confidence, Standing-Delta).
4. Erlaubte Aktionen werden ausgefuehrt:
- `trade_offer`
- `raid` (nur Pirate)
- `diplomacy_shift`
- `send_message`
- `none`
5. Bei `handled=false` greift die bestehende deterministic fallback branch in `npc_faction_tick(...)`.

### Guardrails

1. Action-Whitelist (`none|trade_offer|raid|diplomacy_shift|send_message`)
2. Confidence-Floor (`NPC_LLM_CONTROLLER_MIN_CONFIDENCE`)
3. Standing-Delta Clamp (`-8..8`)
4. Fraktionstyp-Regeln (z. B. Raid nur fuer Pirate)
5. Cooldown pro User+Fraktion ueber Decision-Log-Timestamps

### Datenmodell (diagnostics)

Tabelle: `npc_llm_decision_log`

Wesentliche Felder:
1. `user_id`, `faction_id`, `faction_code`
2. `action_key`, `confidence`
3. `standing_before`, `standing_after`
4. `status`, `executed`, `error_message`
5. `reasoning`, `raw_output`, `created_at`

Observability-Hinweis:
Fuer schnelle Aggregatabfragen (Dashboard/QA) koennen zusaetzliche Indizes per
`sql/migrate_npc_pve_controller_v2.sql` aktiviert werden.

### API

1. `GET api/npc_controller.php?action=status`
2. `GET api/npc_controller.php?action=summary&hours=24&faction_id=0`
3. `GET api/npc_controller.php?action=decisions&limit=20&faction_id=0`
4. `POST api/npc_controller.php?action=run_once`

Hinweis:
`run_once` ist fuer Debug/QA gedacht und erzwingt einen NPC-Tick unabhaengig vom normalen 5-Minuten-Overview-Cooldown.

---

## 11. UI/UX-Anpassungen

1. Overview:
- Neue Widgets fuer Marktpreis, Defizite, Stabilitaet

2. Galaxy Window:
- Systemkarte zeigt Spezialisierungs-Empfehlung + Anomaliehinweise

3. Colony Window:
- Production Sankey light (Input -> Throughput -> Output)
- Strata/Needs Panel

4. Diplomacy Window:
- Diplomatic-Play Timeline + Risk Meter

---

## 12. Telemetrie und KPIs

Pro Session erfassen:
1. mediane Defizitdauer je Gut
2. Anteil Zeit in kritischer Stabilitaet
3. Anzahl diplomatischer Konflikte mit/ohne Krieg
4. Marktvolatilitaetsindex
5. Durchschnittliche Flotten-Readiness bei Kampfbeginn

Ziel:
- datengetriebenes Balancing statt Bauchgefuehl.

---

## 13. Risiken und Gegenmassnahmen

1. Risiko: Zu hohe Komplexitaet frueh
- Gegenmassnahme: Feature Flags pro Modul

2. Risiko: Performance bei Tick-Berechnung
- Gegenmassnahme: Delta-Updates + aggregierte market ticks

3. Risiko: UI-Ueberladung
- Gegenmassnahme: Progressive Disclosure (Basic/Advanced Panels)

---

## 14. Definition of Done

Fuer jedes Mechanikmodul gilt:
1. Datenmodell migriert und dokumentiert
2. API-Endpunkte mit Fehlercodes vorhanden
3. UI fuer Kerninteraktion vorhanden
4. mindestens 1 Integrationstest + 1 Lasttestpfad
5. Balancing-Konfig parameterisiert in config

---

## 15. Referenzhinweise

Dieses Design orientiert sich an oeffentlich bekannten Mechanikmustern aus:
1. Anno-Reihe (Versorgungsketten, Einwohnerbedarfe, Handelsnetz)
2. Victoria 3 (Marktdynamik, gesellschaftliche Gruppen, diplomatische Eskalation)
3. Ascendancy (planetare Spezialisierung, 4X-Rhythmus, Forschungsfunds)
4. Master of Orion II (Mehrplaneten-Systeme, Kolonie-Tradeoffs, multiple Siegpfade)
5. Master of Orion III (Makrosteuerung mit Delegation; negative Referenz fuer UX/Automation)
6. Stellaris (Krisen- und Eventketten, Empire-Identitaet, Korridorstrategie)
7. Endless Space 2 (Fraktionsasymmetrie, Anomalien, Politik/Law-System)

Hinweis:
- Das Dokument uebernimmt keine Assets, keinen Code und keine proprietaeren Regelwerke,
  sondern nur abstrahierte Designprinzipien auf Systemeebene.
