# GalaxyQuest - Vessel and Module Blueprint System

Status: draft v0.2
Version: 0.2
Stand: 29.03.2026

---

## 1. Ziel

Dieses Dokument definiert ein neues Vessel/Module-System mit Blueprints.

Spielziel:
1. Schiffe werden nicht mehr nur als starre Typen gebaut, sondern aus Hull + Modulen zusammengesetzt.
2. Shipyards bauen nur Blueprints, die fuer Standort, Tech und Fraktion freigeschaltet sind.
3. Fraktionen (Spieler- und NPC-Seite) beeinflussen verfuegbare Hulls, Module, Kosten und Bauzeit.

Nicht-Ziel (v1):
1. Kein vollstaendiger Retrofit bestehender Kampfsimulation im ersten Schritt.
2. Keine komplette Abschaltung des Legacy-Pfads ueber SHIP_STATS in der ersten Migration.

## 1.1 Implementierungsstand (aktuell)

Bereits als Scaffold umgesetzt:
1. SQL-Migrationen fuer `vessel_hulls`, `module_groups`, `modules`, `hull_module_compatibility`, `vessel_blueprints`, `vessel_blueprint_modules`, `faction_tech_affinities` sowie Hull-Energiebasisfelder (`migrate_vessel_blueprints_v4.sql`).
2. Seed-Daten fuer einen minimalen Starter-Hull und Modulgruppen in `sql/test_vessel_blueprints_seed.sql`.
3. Runtime-Resolver in `api/game_engine.php`, damit synthetische Typen `bp_<id>` bereits Kosten, Cargo, Speed und Kampfwerte liefern koennen.
4. `api/shipyard.php` mit additiven Actions:
- `action=list` liefert jetzt auch `blueprints`.
- `action=list_blueprints` liefert reine Blueprint-Daten.
- `action=list_hulls` liefert Hull-Katalog inkl. `ship_class` und `slot_variation_json`.
- `action=list_modules` liefert modulgruppenweise Moduloptionen fuer ein konkretes Hull/Layout.
- `action=create_blueprint` validiert Hull/Module, kompiliert Snapshot-Werte und speichert einen Spieler-Blueprint.
- `action=build` akzeptiert jetzt zusaetzlich `blueprint_id` und produziert `ships.type = bp_<id>`.
5. `api/fleet.php` nutzt Runtime-Resolver bereits fuer Versand, Preview und Battle-Stats.
6. Shipyard-UI zeigt Hull-Klassen, Layout-Varianten und einen Slot-fuer-Slot-Editor fuer die Blueprint-Erstellung.
7. Hulls und Module koennen bereits ueber `research_req_json`, `build_req_json`/`shipyard_req_json` und Faction-Standing gefiltert sowie serverseitig validiert werden.
8. Ship-Builds laufen jetzt ueber eine echte `ship_build_queue` mit ETA (`queued`/`running`/`done`/`cancelled`) statt Sofortabschluss.
9. Queue-Completion ist in Fleet-Pfaden verdrahtet (Versand, Defender-Combat-Read, Preview/Matchup, Spy-Read), damit fertige Schiffe konsistent ohne vorherigen Shipyard-Refresh gezaehlt werden.

10. `api/shipyard.php` liefert `action=list_vessels` (individuelle Vessel pro Kolonie) und `action=decommission_vessel`; Shipyard-UI zeigt "Docked Vessels"-Panel mit HP-Bar, Stat-Chips und Dekommissionieren-Button.
11. `scripts/recompile_blueprints.php` recompiliert `compiled_stats_json`/`compiled_cost_json`/`compiled_time_secs` fuer alle oder gefilterte Blueprints CLI-sicher (PHP_SAPI-Guard in shipyard.php eingefuehrt).

Noch offen:
1. Feinere UI fuer freie Slot-Reihenfolge, Modulvergleich und gespeicherte Presets. [umgesetzt: swapSlots, updateStatsPreview, Presets via localStorage, renderAffinityChips]
2. Einzelvessel-Runtime (`built_vessels`) statt aggregierter `ships`-Zaehler. [umgesetzt: built_vessels-Tabelle per migrate_vessel_blueprints_v5.sql; spawn_built_vessels() in complete_ship_build_queue; list_vessels + decommission_vessel API; Docked-Vessels-Panel in Shipyard-UI]
3. Datengetriebene Freischaltung ueber echte Fraktions-Mappings aus `fractions/*` statt nur `npc_factions.code`. [umgesetzt: faction_tech_affinities per migrate_vessel_blueprints_v3.sql; Affinity-Chips im Slot-Editor; load_faction_tech_affinities_for_user in compile_shipyard_blueprint]

---

## 2. Ausgangslage (Ist-Stand)

Der aktuelle Build-Stack basiert auf statischen Schiffstypen:

1. `api/shipyard.php`
- `action=list` und `action=build`
- Bau prueft `SHIP_STATS[$type]`, Shipyard-Level und Ressourcen.

2. `api/game_engine.php`
- `const SHIP_STATS` definiert Kosten, Cargo, Speed, Attack, Shield, Hull.
- `ship_cost()`, `ship_speed()`, `ship_cargo()` lesen direkt daraus.

3. SQL-Bestand
- `ships(colony_id, type, count)` speichert aggregierte Schiffsanzahl pro Typ.
- Kein persistentes Modell fuer einzelne Blueprint-Konfigurationen.

4. Fraktionsquellen
- Lore- und Designdaten liegen in `fractions/*/spec.json`.
- NPC-Faktionen liegen in `npc_factions`, `diplomacy`, `trade_offers`.

Konsequenz:
- Hohe Einfachheit, aber keine modulare Schiffsanpassung.
- Fraktionsidentitaet ist bei Schiffen aktuell nur indirekt abgebildet.

---

## 3. Fachmodell

### 3.1 Kernbegriffe

1. Vessel Hull
- Der Grundkoerper eines Schiffs (Klasse, Slot-Profil, Basiswerte).

1a. Ship Class
- Grobe Einsatzklasse eines Hulls, z. B. corvette, frigate, destroyer, cruiser, carrier, dreadnought.
- Bestimmt Balance-Erwartung, Tech-Gating, Fraktionsrollenbild und typische Slot-Spannen.

1b. Slot Layout Variation
- Ein Hull besitzt ein Basis-Slot-Profil und optionale Layout-Varianten.
- Varianten verschieben Slot-Anzahlen pro Modulgruppe, ohne den Hull selbst zu duplizieren.
- Beispiel: Corvette `default` -> 2 weapon / 1 utility; Corvette `interceptor` -> 3 weapon / 0 utility.

2. Module Group
- Funktionsgruppe fuer Slots, zum Beispiel:
  - propulsion
  - power
  - weapon
  - hull
  - shield
  - auxiliary
  - command
  - utility

3. Module
- Konkrete Komponente innerhalb einer Gruppe (z. B. Impulse Drive Mk2).

4. Blueprint
- Reproduzierbare Konfiguration aus Hull + Modulbelegung + Metadaten.

5. Shipyard Capability
- Welche Hull-Tiers, Modulgruppen und Build-Features ein konkreter Shipyard bauen darf.

### 3.2 Designprinzipien

1. Additiv statt Breaking Change.
2. Blueprint soll zu stabilen Laufzeitwerten kompiliert werden (snapshot stats).
3. Fraktions-/Spezies-Boni wirken datengetrieben, nicht hartcodiert pro Schiff.
4. Legacy-Schiffe bleiben waehrend Migration baubar.

---

## 4. Datenmodell (Soll)

## 4.1 Stammdaten

1. vessel_hulls
- id
- code (unique)
- label
- role (scout, combat, logistics, capital, support)
- ship_class (corvette, frigate, destroyer, cruiser, carrier, capital)
- tier
- base_mass
- base_attack
- base_shield
- base_hull
- base_cargo
- base_speed
- base_energy_output
- base_energy_capacity
- base_energy_upkeep
- base_weapon_efficiency
- base_shield_efficiency
- base_attack_energy_share
- slot_profile_json
- slot_variation_json
- research_req_json
- build_req_json
- faction_tag (nullable)
- is_active

2. module_groups
- id
- code (propulsion, power, weapon, hull, shield, auxiliary, ...)
- label
- max_per_hull_default
- is_required

3. modules
- id
- code (unique)
- group_id
- label
- tier
- rarity
- stats_delta_json
- power_draw
- mass_delta
- build_cost_json
- build_time_secs
- research_req_json
- shipyard_req_json
- faction_tag (nullable)
- species_affinity_json (optional)
- is_active

4. hull_module_compatibility
- hull_id
- group_id
- slot_count
- allowed_module_tags_json
- max_module_tier

5. faction_tech_affinities
- faction_code
- module_group_code
- bonus_type (cost_pct, build_time_pct, stat_mult, unlock_tier)
- bonus_value

## 4.2 Blueprint-Daten

1. vessel_blueprints
- id
- user_id (nullable fuer globale Templates)
- code (unique im user scope)
- name
- hull_id
- slot_layout_code
- doctrine_tag (raider, trader, tank, glass_cannon, ...)
- source_type (system, player, faction_reward, npc_drop)
- is_public
- version
- compiled_stats_json
- compiled_cost_json
- compiled_slot_profile_json
- compiled_time_secs
- created_at
- updated_at

2. vessel_blueprint_modules
- blueprint_id
- module_id
- slot_index
- quantity

3. colony_shipyard_unlocks
- colony_id
- unlock_type (hull, module_group, module, blueprint_feature)
- unlock_ref_id
- source (building_level, research, quest, faction_contract)
- unlocked_at

4. ship_build_queue (neu oder Erweiterung)
- id
- colony_id
- blueprint_id (nullable fuer legacy type)
- legacy_type (nullable)
- quantity
- unit_cost_json
- unit_time_secs
- status (queued, running, done, cancelled)
- started_at
- eta

## 4.3 Runtime-/Historien-Daten

1. built_vessels (optional v2)
- id
- owner_user_id
- colony_id
- blueprint_id
- snapshot_stats_json
- hp_state_json
- status (docked, assigned, destroyed)

2. fleet_vessel_assignments (optional v2)
- fleet_id
- built_vessel_id

Hinweis:
v1 kann weiter aggregiert in `ships` zaehlen, indem fuer jeden Blueprint ein synthetischer `type`-Code verwendet wird (`bp_<id>`), bis die Fleet-Logik auf Einzelvessels umgestellt wird.

---

## 5. Build-Flow in Shipyards

## 5.1 Blueprint-Erstellung

1. Spieler waehlt Hull.
2. UI zeigt Schiffsklasse, Basis-Slot-Profil und verfuegbare Layout-Varianten.
3. Spieler waehlt ein Slot-Layout fuer den Hull.
4. UI zeigt erforderliche Modulgruppen und freie Slots fuer genau dieses Layout.
5. Spieler belegt Slots mit verfuegbaren Modulen.
6. Backend validiert:
- Hull aktiv?
- Schiffsklasse und Hull-Tier fuer Standort/Fortschritt erlaubt?
- Slot-Layout auf dem Hull definiert?
- Modul kompatibel mit Hull?
- Slot-Anzahl des gewaehlten Layouts eingehalten?
- Required Groups belegt?
- Research + Shipyard + Fraktionsbedingungen erfuellt?
7. Backend kompiliert Snapshot-Werte und speichert Blueprint.

## 5.2 Produktionslauf

1. `shipyard/build` nimmt `blueprint_id` + `count`.
2. Validierung gegen `colony_shipyard_unlocks`, Research, Ressourcen.
3. Kosten und Zeiten koennen durch Modifikatoren veraendert werden:
- Shipyard-Level
- Leader-Skills (`leaders`)
- Fraktionsstanding (`diplomacy`)
- Event-/Situationsmodifikatoren
4. Queue-Eintrag wird erzeugt.
5. Nach Abschluss:
- v1: Erhoehe `ships.type = bp_<id>`
- v2: Erzeuge `built_vessels` Datensaetze

---

## 6. Abhaengigkeiten und Integrationen

## 6.1 Bestehende Shipyard-Implementierung

Betroffene Stellen:
1. `api/shipyard.php`
- `list` muss legacy und blueprintfaehige Einheiten liefern.
- `build` muss `legacy_type` und `blueprint_id` akzeptieren.

2. `api/game_engine.php`
- `SHIP_STATS` bleibt als Legacy-Fallback bestehen.
- Neue Resolver:
  - `resolve_vessel_stats($typeOrBlueprint)`
  - `resolve_vessel_cost(...)`

3. `api/fleet.php`
- muss synthetische Blueprint-Typen in Kampfrechner/Cargo/Speed verstehen.

## 6.2 Forschung und Tech-Gating

Anbindung an `research` und `RESEARCH_PREREQS`:
1. Hulls und Module deklarieren `research_req_json`.
2. Ein zentraler Gate-Resolver prueft die Bedingungen.
3. Dadurch bleibt das System konsistent mit vorhandener Forschungsprogression.

## 6.3 Fraktionen / fractions

Quellen:
1. `fractions/*/spec.json`: Lore- und Design-Authority.
2. `npc_factions`, `diplomacy`, `trade_offers`: spielmechanische Beziehungen.

Vorgeschlagene Kopplung:
1. Jede Fraktion/Spezies bekommt optionale Affinitaeten auf Modulgruppen.
2. Standing-Schwellen schalten spezielle Module/Hulls frei (Lizenzmodell).
3. Fraktionsquests koennen Blueprints als Reward geben.
4. Trade-Offer koennen Module als Vertragsware enthalten (spaeter v2).

Wichtig:
- Trenne "Lore Fraktion" (fractions) von "NPC Diplomatie Fraktion" (npc_factions), aber erlaube Mapping-Tabelle `faction_code_map` fuer Gameplay-Verknuepfungen.

## 6.4 Leader-/Advisor-System

`leaders` besitzt bereits Rollen und Skillwerte.

Neue Synergien:
1. `advisor` kann Blueprint-Empfehlungen generieren (role-fit).
2. `science_director` reduziert Modul-Forschungskosten.
3. `trade_director` reduziert Importkosten seltener Module.

---

## 7. API-Skizze (neu/erweitert)

1. GET `api/shipyard.php?action=blueprints&colony_id=`
- Liefert baubare Blueprints + Verfuegbarkeit + effektive Kosten.

2. POST `api/shipyard.php?action=create_blueprint`
- Body: `name`, `hull_code`, `modules[]`.

3. POST `api/shipyard.php?action=build`
- Erweiterung:
  - legacy: `type`, `count`
  - neu: `blueprint_id`, `count`

4. GET `api/shipyard.php?action=modules_catalog`
- Katalog gefiltert nach colony/research/faction standing.

5. Optional GET `api/factions.php?action=ship_licenses&faction_id=`
- Zeigt freischaltbare hull/module-Lizenzen.

---

## 8. Migrationstrategie

## Phase 1 - Datenbasis und Legacy-Kompatibilitaet

1. Neue Tabellen anlegen (hulls/modules/blueprints/unlocks).
2. Legacy-Schiffe in Start-Blueprints spiegeln (one-time backfill).
3. Shipyard Build unterstuetzt beide Pfade.

## Phase 2 - Produktivnutzen

1. Blueprint-UI und Modul-Katalog freischalten.
2. Fraktions-Affinitaeten und Standing-Gates aktivieren.
3. Erste Fraktionsspezifische Hulls/Module ausrollen.

## Phase 3 - Vertiefung

1. Fleet/Kampf auf Blueprint-Snapshots (und spaeter Einzelvessels) umstellen.
2. Marketplace und Diplomatie fuer Modulhandel erweitern.
3. Balancing-Telemetrie pro Modulgruppe/Blueprint einbauen.

---

## 9. Balancing-Rahmen

1. Harte Pflichtgruppen je Hull:
- propulsion >= 1
- power >= 1
- hull >= 1

2. Soft-Caps:
- Waffenlast und Schildlast durch Power Budget begrenzen.

3. Metriken fuer Monitoring:
- Build share je Blueprint
- Win/Loss delta je Modulgruppe
- Durchschnittliche Bauzeit/Kosten pro Tier

4. Anti-Meta-Monokultur:
- diminishing returns auf gleiche Modulstapel
- Fraktions-/Doctrinetradeoffs statt linearer Best-in-Slot-Kette

---

## 10. Risiken

1. Komplexitaetssprung in UI und Datenmodell.
2. Legacy/Blueprint-Doppelpfad erzeugt temporaer mehr Wartung.
3. Fractions-Daten sind teils lore-lastig; fuer Balancing braucht es zusaetzliche numerische Felder.

Gegenmassnahmen:
1. Feature-Flags pro API-Endpunkt.
2. Schrittweise Aktivierung pro Fraktion und Hull-Tier.
3. Balancing-Daten in dedizierten Tabellen statt in Freitext-Lore.

---

## 11. Offene Entscheidungen

1. Soll v1 weiterhin nur aggregierte Schiffszaehlung nutzen (`ships`) oder direkt `built_vessels` einfuehren?
2. Wie strikt ist die Trennung zwischen spielbaren Spezies (fractions) und NPC-Faction-Meta?
3. Sollen Module handelbar als Item werden oder nur via Unlock/Lizenz?
4. Wird Refit (Umbau bestehender Schiffe) in v1 benoetigt?

---

## 12. Akzeptanzkriterien fuer einen ersten umsetzbaren Slice

1. Ein Blueprint kann mit Hull + mindestens 3 Modulgruppen gespeichert werden.
2. Shipyard kann Blueprint bauen, wenn Ressourcen und Anforderungen passen.
3. Fraktionsstanding beeinflusst mindestens einen Unlock-Pfad.
4. Legacy-Schiffsbau funktioniert unveraendert weiter.
5. Telemetrie erfasst Blueprint-Bauten und Bauabbrueche.

---

## 13. Kampfsystem - Zielbild

Dieses Kapitel definiert ein kampffaehiges Regelwerk fuer modulare Schiffe inkl. Boni/Mali aus Fraktion, Spezies, Commander/Leader und zufallsgetriebener Varianz.

## 13.1 Designziele

1. Lesbare Kausalitaet: Spieler soll verstehen, warum ein Kampf gewonnen/verloren wurde.
2. Build-Relevanz: Blueprint-Entscheidungen muessen den Ausgang dominant beeinflussen.
3. Kontrollierte Varianz: Zufall erzeugt Spannung, aber keine totale Willkuer.
4. Erweiterbarkeit: Neue Module/Faktionen duerfen das Kernsystem nicht brechen.

## 13.2 Kampfmodell (Rundenbasiert pro Tick)

Vorschlag fuer v1:
1. Kampf wird in diskreten Combat Rounds simuliert (z. B. 6-12 Runden max).
2. Jede Runde hat Phasen:
- Initiative/Targeting
- Energiehaushalt und Allokation (Waffen, Schilde, Utility)
- Angriffswurf und Treffer
- Schaden nach Resistenz/Schilde/Huelle
- Morale/Retreat-Check

Grundidee:
1. Alpha-Strike wird begrenzt (Schadensdeckel pro Runde).
2. Schilde regenerieren nur zwischen Kaempfen oder stark reduziert pro Runde.
3. Rueckzug ist strategisch moeglich, aber mit Verlust-/Interception-Risiko.

## 13.3 Datenmodell fuer Kampfrelevante Werte

Pro Vessel-Snapshot (aus Blueprint kompiliert):
1. offense_profile_json
- kinetic, energy, explosive, electronic_warfare
2. defense_profile_json
- shield_capacity, armor_rating, evasion, point_defense
3. utility_profile_json
- sensor_lock, jam_resist, repair_rate, command_link
4. damage_profile_json
- crit_chance_base, crit_mult_base, accuracy_base

Pro Kampfteilnehmer (Flotte):
1. doctrine_mode (aggressive, balanced, defensive, hit_and_run)
2. commander_context (skills, traits, temporary states)
3. faction_context (standing bonuses, treaty auras)
4. energy_context
- reactor_output
- capacitor_capacity
- weapon_efficiency
- shield_efficiency
- baseline_upkeep
- energy_priority_json (weapon/shield/utility)

---

## 14. Boni/Mali-Stack (Fractions/Race/Commander/Leader)

## 14.1 Reihenfolge der Modifikatoren

Feste Reihenfolge verhindert Exploit-Stacking:
1. Basiswerte aus Hull + Modulen
2. Forschung/Technologie
3. Fraktion/Spezies-Affinitaet
4. Commander-/Leader-Skills
5. Situative Effekte (Terrain, Event, Versorgung, Moral)
6. Zufallsereignisse pro Runde

Regel:
Additive Werte zuerst, multiplikative danach, dann Caps.

## 14.2 Empfohlene Modifier-Typen

1. Flat: `+X` (z. B. +15 Shield)
2. Percent Add: `+Y%` auf Basiswert
3. Percent Mult: `*Z` (z. B. 1.12)
4. Clamp/Cap: min/max Grenzen
5. Conditional: nur bei Bedingungen (z. B. shield < 30%)

## 14.3 Quellen im Detail

1. Fractions / NPC Fraktionen
- Standing-Baender aktivieren Combat Auras:
  - +5 bis +15% auf definierte Modulgruppen
  - oder Resistenz gegen Fraktionstypen

2. Race / Spezies
- Kleine, klare Signaturboni statt Vollasymmetrie.
- Beispiel:
  - Aereth: +energy precision, -kinetic armor
  - Vor'Tak: +hull integrity, -sensor lock

3. Commander / Leader
- `fleet_commander`: initiative, retreat control, crit timing
- `science_director`: module overclock windows
- `advisor`: pre-battle scouting und Counterfit-Hinweise

4. Situation/Logistik
- Treibstoffmangel, Reparaturstatus, intel quality, morale.

---

## 15. Zufallsmodell (Wuerfeln im engeren Sinne)

Zufall soll kontrolliert und reproduzierbar sein.

## 15.1 RNG-Prinzip

1. Deterministischer Seed pro Kampf:
- `seed = hash(battle_id + attacker_id + defender_id + timestamp_bucket)`
2. Pro Runde/Phase eigener Subseed fuer Debug-Replay.
3. Kampfreports speichern Seed + Hauptwuerfe fuer Nachvollziehbarkeit.

## 15.2 Dice-Layer Vorschlag

Trefferwurf mit 2W6-Charakteristik (Glockenkurve statt flachem W20):

1. Attack Score:
$$
A = accuracy + commander\_aim + sensor\_lock - target\_evasion
$$

2. Roll:
$$
R = 2d6 + A
$$

3. Hit-Schwelle:
$$
R \ge T
$$

Vorteil von $2d6$:
1. weniger extreme Ausreisser als bei $1d20$
2. Build- und Skillvorteile bleiben konsistenter spuerbar

## 15.3 Crit/Fumble und Schadensvarianz

1. Crit-Window klein halten (z. B. 5-12% nach Modifikatoren, hard cap 25%).
2. Fumble nur fuer bestimmte Waffentypen oder Jam-Effekte.
3. Schadensstreuung begrenzen, z. B. Basis * [0.9 .. 1.1].

Ziel:
Zufall sorgt fuer Spannung, aber nicht fuer komplette Entwertung guter Builds.

---

## 16. Vergleichbare Systeme (Referenzmuster)

## 16.1 Stellaris (Paradox)

Relevante Muster:
1. Waffen-gegen-Defense-Counter (Shield/Armor/Hull)
2. Tracking vs Evasion als zentrale Trefferlogik
3. Flottenkomposition wichtiger als Einzel-Superunit

Transfer nach GalaxyQuest:
1. Modulgruppen als Counter-Matrix modellieren.
2. Evasion und Targeting getrennt behandeln.

## 16.2 Endless Space 2

Relevante Muster:
1. Taktik-/Battle-Postures vor Kampfstart
2. Rollenorientierte Loadouts mit klaren Tradeoffs

Transfer:
1. doctrine_mode pro Flotte als leichte Taktikebene vor jeder Schlacht.

## 16.3 Master of Orion 2

Relevante Muster:
1. Starkes Ship-Design mit Slot-/Tonnage-Entscheidungen
2. Forschung + Hull-Upgrade als Progressionskern

Transfer:
1. Blueprint-Editor mit klaren Slot-Grenzen und Tier-Gates.

## 16.4 OGame-nahe Modelle

Relevante Muster:
1. Schnelle serverseitige Batch-Simulation
2. Einheitentypen mit klarer Kosten/Nutzen-Struktur

Transfer:
1. Legacy-Kompatibilitaet beibehalten, Combat-Engine aber auf Blueprint-Snapshots erweitern.

---

## 17. Vorschlag fuer ersten Combat Vertical Slice

1. Scope
- Nur 3 Modulgruppen kampfrelevant aktivieren: weapon, shield, propulsion.
- Nur 4 Schadenskanalwerte: kinetic, energy, explosive, ew.

2. Regeln
- 6 feste Runden, kein Mid-Battle Reinforcement.
- Treffer: 2d6-Modell mit Accuracy/Evasion.
- Schaden: channel vs resistance + kleine Streuung.
- Energie: pro Runde harter Energiepool mit Allokation auf Waffen/Schilde.

3. Boni
- Eine Spezies-Affinitaet, ein Fraktionsstanding-Bonus, ein Commander-Skill aktiv.

4. Output
- Erweiterter `battle_report_json` mit Modifier-Breakdown und Dice-Log.

5. Erfolgskriterium
- Spieler kann im Report mindestens 80% des Outcomes auf konkrete Faktoren zurueckfuehren.

---

## 18. Balancing-Leitplanken fuer Zufall

1. RNG-Budget pro Kampf begrenzen (z. B. max 15-20% Outcome-Impact).
2. Keine doppelten Multiplikatoren ohne Cap.
3. Hard Caps fuer Crit, Evasion, Damage Reduction.
4. Matchmaking/Threat-Scoring soll extreme Outlier vermeiden.
5. Telemetrie: Winrate je Blueprint-Cluster, nicht nur je Schiffstyp.

---

## 19. Offene Combat-Entscheidungen

1. Echtzeit-Resolver oder strikt rundenbasiert serverseitig?
2. Vollstaendiges Dice-Log fuer alle Schuesse oder aggregiertes Log pro Runde?
3. Rueckzug deterministisch nach Schwellwert oder mit Wurf?
4. Friendly Fire/Overkill als taktischer Faktor ja/nein?

---

## 20. Konkrete v1-Entscheidung (empfohlen)

Um den ersten Implementierungsschnitt schnell und testbar zu halten, wird fuer v1 festgelegt:

1. Resolver: strikt rundenbasiert und serverseitig.
2. Log-Tiefe: aggregiertes Dice-Log pro Runde (nicht pro Projektil).
3. Rueckzug: Schwellwert + Wurf (teilkontrolliert).
4. Friendly Fire: nein in v1.

---

## 21. Exakte Kampf-Formeln (v1)

## 21.0 Verbindliche Energie-Festlegung (neu)

Alle Waffen und Schutzmassnahmen verbrauchen Energie beim Gebrauch.
Damit sind Schussfrequenz, Schildabsorptionsleistung und effektive Defensivleistung direkt an Energiequelle + Systemeffizienz gekoppelt.

Begriffe pro Runde:
1. `E_gen`: erzeugte Energie aus Reaktor und Boni.
2. `E_store`: verfuegbare Pufferenergie aus Kondensator.
3. `E_upkeep`: Grundverbrauch (Sensorik, Triebwerk, EW, Debuffs).
4. `E_avail`: frei verteilbare Energie.

Formeln:
$$
E_{avail} = clamp(E_{gen} + E_{store} - E_{upkeep}, 0, E_{max})
$$

Allokation je Seite:
$$
E_{weapon} + E_{shield} + E_{utility} \le E_{avail}
$$

Effizienz:
1. `eta_weapon` skaliert nutzbare Waffenenergie.
2. `eta_shield` skaliert nutzbare Schildenergie.
3. Beide entstehen aus Power-Modulen, Forschungsboni, Leadern, Statusdebuffs.

## 21.1 Notation

1. `clamp(x, min, max)` begrenzt einen Wert.
2. `roll_2d6()` liefert 2..12.
3. `rng(seed, key)` liefert deterministische Zufallszahl in [0,1).

## 21.2 Initiative

Fuer jede Seite:
$$
I = base\_initiative + commander\_initiative + doctrine\_initiative + roll\_2d6()
$$

Bei Gleichstand:
1. Hoehere Sensor-Qualitaet gewinnt.
2. Danach Seed-basierter Coinflip.

## 21.3 Trefferchance

Angriffswert:
$$
A = accuracy + tracking + commander\_aim + sensor\_lock
$$

Verteidigungswert:
$$
D = evasion + jam + terrain\_penalty\_to\_attacker
$$

Treffercheck:
$$
H = roll\_2d6() + (A - D)
$$

Hit wenn:
$$
H \ge 8
$$

Zusatzregel:
1. Natuerliche 2 = auto miss.
2. Natuerliche 12 = auto hit.

## 21.4 Kritischer Treffer

Krit-Chance:
$$
P_{crit} = clamp(crit\_base + crit\_mods - anti\_crit\_target, 0.05, 0.25)
$$

Krit-Multiplikator:
$$
M_{crit} = clamp(crit\_mult\_base + crit\_mult\_mods, 1.25, 2.00)
$$

## 21.5 Rohschaden pro Kanal

Fuer jeden Schadenskanal $c \in \{kinetic, energy, explosive, ew\}$:
$$
raw_c = base\_damage_c \cdot (1 + dmg\_add_c) \cdot dmg\_mult_c
$$

Streuung:
$$
spread_c = 0.90 + 0.20 \cdot rng(seed, round|attacker|target|c)
$$

$$
rolled_c = raw_c \cdot spread_c
$$

## 21.5a Feuerrate aus Energie (neu)

Waffe `i` mit `energy_per_shot_i` und nomineller Schusszahl `rof_i`:
$$
shots_i = min\left(rof_i,\left\lfloor \frac{E_{weapon} \cdot eta_{weapon}}{energy\_per\_shot_i} \right\rfloor\right)
$$

Wenn `E_weapon` sinkt, sinken direkte Schuesse/Tick.
Damit wird die Energiequelle zum harten DPS-Limiter.

## 21.6 Schaden nach Resistenz

Effektive Resistenz pro Kanal:
$$
R_c = clamp(resist\_c - penetration\_c, 0.00, 0.80)
$$

Effektiver Kanalschaden:
$$
eff_c = rolled_c \cdot (1 - R_c)
$$

Gesamtschaden vor Crit:
$$
DMG = \sum_c eff_c
$$

Bei Crit:
$$
DMG = DMG \cdot M_{crit}
$$

## 21.6a Schadens-Interaktion nach Waffentyp (verbindlich)

Festlegung fuer v1-Kanalmapping:
1. Energiewaffen -> Kanal `energy`
2. Projektilwaffen -> Kanal `kinetic`

Wirkung auf Verteidigungsschichten:
1. Energiewaffen
- Schilde absorbieren gut.
- Gegen Panzerung/Huelle verheerend.
2. Projektilwaffen
- Gegen Panzerung/Huelle sehr effektiv.
- Von Schilden nur schwer abzuwehren.

Verbindliche Multiplikatoren in v1:
1. Layer-Damage-Multiplikator `M_layer(c, layer)`
- `energy`: shield `0.75`, armor `1.35`, hull `1.15`
- `kinetic`: shield `1.10`, armor `1.30`, hull `1.20`

2. Schild-Abwehr-Effizienz je Kanal `M_absorb(c)`
- `energy`: `1.30`
- `kinetic`: `0.75`

Interpretation:
1. Gegen `energy` sind Schilde besonders effizient (`M_absorb > 1`), dadurch mehr Absorption und weniger Leakage.
2. Gegen `kinetic` sind Schilde ineffizient (`M_absorb < 1`), dadurch mehr Restschaden auf Armor/Hull.

## 21.7 Shield-Armor-Hull-Reihenfolge

1. Schaden geht zuerst in Shield.
2. Rest in Armor/Hull nach Kanalgewichtung.
3. Overflow auf naechste Schicht.

Schild-Absorptionsgrenze pro Runde:
$$
AbsorbCap_c = E_{shield} \cdot eta_{shield} \cdot shield\_absorb\_rate \cdot M_{absorb}(c)
$$

Tatsaechliche Schildabsorption:
$$
Absorb_c = min(ShieldHP, DMG_{in,c}, AbsorbCap_c)
$$

Leakage:
$$
Leak_c = DMG_{in,c} - Absorb_c
$$

Schichtschaden:
$$
DMG_{layer,c} = Leak_c \cdot M_{layer}(c, layer)
$$

Vereinfachung v1:
1. Armor als Damage-Reduction-Layer, Hull als finale HP.

## 21.8 Rueckzugsregel

Rueckzugsversuch erlaubt, wenn mindestens eine Bedingung gilt:
1. Eigene Hull-Integrity <= 35%
2. Eigene effektive Feuerkraft <= 50% vom Gegner

Erfolgschance:
$$
P_{retreat} = clamp(0.35 + nav\_adv + commander\_retreat - enemy\_intercept, 0.10, 0.90)
$$

Wurf mit `rng(...)`; bei Fehlschlag kaempft die Flotte weiter.

---

## 22. Hard Caps und Leitwerte (v1)

1. Evasion hard cap: 65%
2. Damage reduction (gesamt) hard cap: 80%
3. Crit chance hard cap: 25%
4. Crit multiplier hard cap: 2.0
5. Initiative bonus cap aus Leader+Doctrine: +6
6. Genauigkeit floor: mindestens 10% Resttrefferchance nach allen Modifikatoren
7. `eta_weapon` cap: [0.60 .. 1.40]
8. `eta_shield` cap: [0.60 .. 1.40]
9. Maximal in Schilde allokierbare Energie pro Runde: 70% von `E_avail`

Ziel:
Keine unverwundbaren Builds und keine One-Shot-Metadominanz.

---

## 23. Standardisierte Modifier-Keys

## 23.1 Datenstruktur

Jeder Modifier folgt einem einheitlichen Vertrag:

```json
{
  "key": "combat.accuracy.add_pct",
  "scope": "fleet",
  "source_type": "leader",
  "source_ref": "fleet_commander:skill_tactics",
  "operation": "add_pct",
  "value": 0.08,
  "condition": {
    "phase": "opening",
    "channel": "energy"
  },
  "priority": 40
}
```

## 23.2 Empfohlene Key-Familien

1. Accuracy/Hit
- `combat.accuracy.add_flat`
- `combat.accuracy.add_pct`
- `combat.tracking.add_flat`
- `combat.target_evasion.add_flat`

2. Damage
- `combat.damage.kinetic.add_pct`
- `combat.damage.energy.add_pct`
- `combat.damage.explosive.add_pct`
- `combat.damage.all.mult`

3. Defense
- `combat.resist.kinetic.add_pct`
- `combat.resist.energy.add_pct`
- `combat.resist.explosive.add_pct`
- `combat.shield.capacity.add_pct`
- `combat.hull.integrity.add_pct`

4. Crit
- `combat.crit.chance.add_flat`
- `combat.crit.mult.add_flat`
- `combat.anti_crit.add_flat`

5. Control
- `combat.initiative.add_flat`
- `combat.retreat.chance.add_flat`
- `combat.intercept.add_flat`

6. Energy Economy
- `combat.energy.generation.add_flat`
- `combat.energy.generation.add_pct`
- `combat.energy.storage.add_flat`
- `combat.energy.upkeep.add_flat`
- `combat.energy.weapon_efficiency.add_pct`
- `combat.energy.shield_efficiency.add_pct`
- `combat.energy.shield_allocation_cap.add_pct`

## 23.3 Stack-Regeln

1. Gleicher Key + gleiche Quelle stackt nicht doppelt.
2. Additive Aggregation vor Multiplikation.
3. Caps immer nach kompletter Aggregation anwenden.

---

## 24. Battle Report JSON - Schema v1

## 24.1 Pflichtfelder

```json
{
  "battle_id": 123456,
  "version": 1,
  "seed": "a8b7f4...",
  "attacker": {
    "user_id": 10,
    "fleet_id": 345,
    "blueprint_mix": [
      { "blueprint_id": 1001, "count": 24 }
    ]
  },
  "defender": {
    "user_id": 22,
    "fleet_id": 901,
    "blueprint_mix": [
      { "blueprint_id": 2010, "count": 18 }
    ]
  },
  "pre_battle": {
    "modifier_summary": {
      "attacker": [
        { "key": "combat.damage.energy.add_pct", "value": 0.1, "source": "faction:helion_confederation" }
      ],
      "defender": [
        { "key": "combat.hull.integrity.add_pct", "value": 0.12, "source": "race:vor_tak" }
      ]
    },
    "power_rating": {
      "attacker": 1820,
      "defender": 1755
    }
  },
  "rounds": [
    {
      "round": 1,
      "initiative_winner": "attacker",
      "dice": {
        "attacker_hit_roll_avg": 8.7,
        "defender_hit_roll_avg": 7.9,
        "crit_events": 2
      },
      "damage": {
        "attacker_to_defender": {
          "shield": 420,
          "hull": 115,
          "by_channel": { "kinetic": 180, "energy": 290, "explosive": 65, "ew": 0 }
        },
        "defender_to_attacker": {
          "shield": 350,
          "hull": 90,
          "by_channel": { "kinetic": 210, "energy": 140, "explosive": 90, "ew": 0 }
        }
      },
      "state_after": {
        "attacker_hull_pct": 93.4,
        "defender_hull_pct": 89.1
      }
    }
  ],
  "result": {
    "winner": "attacker",
    "retreat": { "attempted": true, "successful": false },
    "losses": {
      "attacker": [
        { "blueprint_id": 1001, "destroyed": 3 }
      ],
      "defender": [
        { "blueprint_id": 2010, "destroyed": 7 }
      ]
    }
  },
  "explainability": {
    "top_factors": [
      { "factor": "energy_damage_bonus", "impact_pct": 22.5 },
      { "factor": "commander_initiative", "impact_pct": 14.2 },
      { "factor": "dice_variance", "impact_pct": 11.1 }
    ]
  }
}
```

## 24.2 Explainability-Ziel

`top_factors` muss die groessten Outcome-Treiber ausweisen.
`dice_variance` wird explizit als Faktor gezeigt, damit Zufall sichtbar aber quantifiziert bleibt.

---

## 25. API-Vertrag fuer Combat-Resolver (v1)

1. POST `api/fleet.php?action=simulate_battle`
- Input: attacker_fleet_id, defender_fleet_id, context flags.
- Output: battle_id + kompakter Report.

2. GET `api/reports.php?action=battle_detail&id=`
- Liefert volles `battle_report_json` inkl. round breakdown.

3. POST `api/fleet.php?action=resolve_battle`
- Persistiert Ergebnis (Verluste, Loot, XP, Diplomatieeffekte).

Idempotenz:
1. `resolve_battle` akzeptiert einen `resolution_token`.
2. Doppeltes Resolve fuer denselben Kampf wird geblockt.

---

## 26. Test- und Balancing-Setup (v1)

1. Deterministische Unit Tests mit fixem Seed fuer Kernformeln.
2. Monte-Carlo-Suite (z. B. 10k Simulationen je Matchup) fuer Winrate-Drift.
3. Guardrails:
- Kein Matchup mit >70% Winrate ueber gleiches Power-Band ohne klaren Counter.
- RNG-Anteil am Outcome median <= 20%.

4. Telemetriefelder pro Kampf:
- blueprint_cluster_attacker/defender
- modifier_total_attack/defense
- dice_variance_index
- outcome_delta_vs_power_rating

## 26.1 Praktischer QA-Workflow (bereits implementiert)

1. Fixture erzeugen:
- `php scripts/seed_combat_probe_fixture.php`

2. Einzel-/Batch-Probe gegen konkrete Ziele:
- `php scripts/combat_batch_probe.php --fleet=<id> --target=<id> --iterations=200 --seed=probe_v1`
- `php scripts/combat_batch_probe.php --fleet=<id> --targets=<id,id,id> --iterations=500 --seed=scan_v1`

3. API-Scan fuer UI/Automation:
- `POST api/fleet.php?action=matchup_scan`
- Body: `attacker_fleet_id`, optional `target_colony_ids[]`, `iterations`, `deterministic_seed`

4. Fixture bereinigen:
- `php scripts/cleanup_combat_probe_fixture.php`
- optional: `php scripts/cleanup_combat_probe_fixture.php --remove-test-mod-links=1`
