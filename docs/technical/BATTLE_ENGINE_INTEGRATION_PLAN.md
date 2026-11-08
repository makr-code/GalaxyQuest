# Schlachtensystem: Produktionsintegration und LLM-NPC-Steuerung

Stand: 2026-11-07. Status: **Implementierungsplan, noch keine Freigabe der
neuen Kampfregeln**. Abschnitt 8 dokumentiert die inzwischen implementierten
Produktionsgrundlagen; die weiteren Phasen bleiben Zielplanung.

## 1. Ziel

Eine serverautoritative Gefechtsdomäne für:

- NPC gegen Spieler und Spieler gegen NPC.
- Spieler gegen Spieler.
- NPC gegen NPC, auch ohne geöffneten Browser.

Alle Kombinationen verwenden dieselben Bestands-, Befehls-, Schaden-,
Rückzugs- und Ergebnisregeln. Nur die Herkunft der Entscheidungen unterscheidet
sich. Three.js/WebGPU stellt den vom Server veröffentlichten Zustand dar.
Ein LLM darf Absichten vorschlagen, aber weder Treffer noch Verluste, Beute,
Schiffsbestände, Bewegungskosten oder Sieg bestimmen.

Die [QA-Szenen und Videos](./HERO_BATTLE_IMPLEMENTATION.md#battle-video-archive)
sind visuelle Referenzen und Regressionstest-Fixtures, keine Kampfregeln.
Die fünfminütige Aufnahme bestimmt insbesondere nicht die Spieldauer.

## 2. Verifizierter Ausgangspunkt vor B0/B1

Diese Tabelle dokumentiert die Ausgangslage der Planung. Der implementierte
Fortschritt von Kampfkern und gemeinsamem Flottenstart steht in Abschnitt 8.

| Oberfläche | Heute vorhanden | Integrationsbedarf |
|---|---|---|
| [Flottenankunft](../../api/fleet.php) | `process_fleet_arrival_locked()` sperrt die fällige Flotte; `handle_fleet_arrival()` ruft bei `attack` direkt `resolve_battle()` auf | Opt-in Angriff in persistenten Encounter überführen; dieselbe Ankunft nie zweimal verarbeiten |
| [Gefechtsauflösung](../../api/fleet.php) | Kolonie als Ziel, Verteidigung aus deren Schiffsbestand; Technologie, Kommandant, Energiebudget, Modifikatoren, Seed, Verluste, Beute, Bericht und Rückkehr | Rechenregeln zunächst unverändert extrahieren; echte Phasen und Gruppen anschließend als neue Regelversion einführen |
| [Spieler-Flottenstart](../../api/fleet.php) | `send_fleet()` prüft Eigentum, PvP und Anfängerschutz sowie mehrere Transitregeln | Gemeinsame Policy und Bestandsbuchung statt zweier divergierender Startwege |
| [NPC-Flottenstart](../../api/game_engine.php) | `launch_fleet_for_user()` bucht reale Schiffe und Fracht; eigener Start-/Reiseweg | Keine Angriffserweiterung über diesen Weg, bevor Schutz-, Kosten-, Lock- und Transitparität hergestellt ist |
| [NPC-Spielerkonten](../../api/npc_ai.php) | `control_type = npc_engine`, reale Kolonien; automatische Kolonisations- und Transportmissionen | Kriegsziele, reale Angriffe, Encounter-Beitritt und taktische Befehle fehlen im untersuchten Flottenaktionspfad |
| [Fraktions-LLM](../../api/npc_llm_controller.php) | Fraktions-/Spielerkontext, strukturierte Antwort, Cooldown, begrenzte Aktionen | Der heutige Kontext ist keine NPC-Flottenidentität; neuer beobachtungsbasierter Kampfauftrag erforderlich |
| [Piratenraid](../../api/npc_ai.php) | `maybe_pirate_raid()` entzieht Ressourcen direkt und erzeugt Nachrichten; explizit keine reale Flotte | Nicht als Encounter, Welle oder noch ausstehender Angriff wiederverwenden; getrennte Migration entscheiden |
| [LLM-Queue](../../api/npc_ai_decision_queue.php), [Worker](../../scripts/process_npc_ai_decision_queue.php) | Claims, Tokens, Wiederholungen und Workerabschluss; Worker ruft bestehenden Fraktionscontroller auf | Infrastruktur wiederverwenden, aber Kampfentscheidung von Effektanwendung trennen und Claimprüfung mit Befehlsannahme atomar verbinden |
| [SSE](../../api/events.php), [VFX-Bridge](../../js/engine/CombatVfxBridge.js) | Teilnehmerbezogenes `battle_resolved`, Flotten-/Body-ID und aggregierte Rundendrücke | Fortlaufender Encounter-Snapshot und sequenzierte Änderungen; alte Rundendrücke nicht als konkrete Treffer ausgeben |
| [Berichte](../../api/reports.php) | Berichtslesen nur für Angreifer/Verteidiger | Teilnehmerberechtigung auf neuen Encounter übertragen; NPC-vs-NPC nicht öffentlich machen |
| [WebGPU-Pass](../../js/rendering/perspective-space-flight.js) | Hero-Pfad verbindet Schiffe, Depth, Waffen, Damage, Trümmer, HUD und Metriken | Produktions-Presentation von QA-Session und deren Zustandsmutationen entkoppeln |
| [JS-Simulator](../../js/engine/game/BattleSimulator.js) | Eigenständiger lokaler Kampfalgorithmus mit eigenen Stats | Nicht zweite Gameplay-Autorität werden lassen; Nutzung prüfen, als Schätzung kennzeichnen oder auf Server-Preview umstellen |

Quellanker für die erste Umsetzung: `api/fleet.php:116`, `:175`, `:851`,
`:897`, `:1077`, `:1240`, `:1962`; `api/game_engine.php:936`;
`api/npc_ai.php:365`, `:469`, `:773`; `api/npc_llm_controller.php:12`, `:275`;
`scripts/process_npc_ai_decision_queue.php:81`; `api/events.php:243`;
`api/reports.php:120`; `js/rendering/perspective-space-flight.js:1382`.
Die Anker beschreiben diesen Stand, nicht zugesicherte zukünftige Zeilennummern.

## 3. Architektur und Zuständigkeiten

```text
Spielerbefehl ──────────────────────────────┐
Regelbasierter NPC-Controller ──────────────┤
LLM-Vorschlag → Policy-/Schema-Prüfung ─────┤
                                          v
                     gemeinsamer BattleCommandService
                     Identität, Rechte, Revision, Frist
                                          |
                       BattleEncounterService (PHP)
                  Snapshot → fällige Phasen → Persistenz
                                          |
              Ergebnis + Ereignisse + Bestände in DB-Transaktion
                                          |
                 autorisierte Read Models / SSE / Berichte
                                          |
               JS BattleReadModel → BattlePresentation
                                          |
                     Three.js / WebGPU / HUD / Audio
```

### 3.1 On-demand statt Gameplay-Tick

- Encounter speichern `phase_index`, `phase_due_at`, `revision`, Regelversion
  und persistierte Zeitbasis. PHP rechnet nur fällige, endliche Phasen nach.
- Explizite Simulationsmutationen, Flottenankünfte und Befehlsannahme dürfen
  Catch-up auslösen; reines GET/SSE verursacht keine Simulation oder LLM-Aufrufe.
- Vor Annahme eines Befehls werden bereits fällige Phasen abgeschlossen.
  Der Befehl gilt nur für die nächste noch offene Phase, niemals rückwirkend.
- Catch-up hat ein Arbeitslimit. Bei Restarbeit bleibt der Encounter
  unverändert nachvollziehbar offen; Antwort enthält `catch_up_pending`.
  Keine Phasen überspringen und keinen Erfolg trotz unvollständiger Abrechnung.
- NPC-vs-NPC benötigt ebenfalls einen expliziten fällige-Arbeit-Aufruf,
  beispielsweise über den vorhandenen Simulations-CLI-/Worker-Einstieg.
  Ohne solchen Aufruf gibt es keine kontinuierliche Weltaktivität.
  Ein LLM-Worker verarbeitet Entscheidungen, nicht einen neuen Physik-Tick.
- Visuelle 60-Hz-Interpolation bleibt lokal. Sie verändert keine Spielzeit
  und löst keine Schäden oder Bestandsbuchungen aus.

### 3.2 Gemeinsamer Teilnehmervertrag

Ein Encounter hat zunächst genau zwei Seiten und ein versioniertes Ziel.
Jede Seite besitzt Teilnehmer mit realer `user_id`, `controller_kind`
(`human` oder `npc_engine`), zugewiesenen Flotten und stabilen Gruppen-IDs.
Die Serveridentität stammt aus Anmeldung bzw. geprüftem Workerauftrag,
nicht aus einem frei übergebenen `controller_kind` oder `user_id`.

Der erste vertikale Schnitt bleibt **Flotte gegen Kolonie**. Danach wird
Flotte gegen Flotte ergänzt: eigene Standort-/Intercept-Bedingungen,
Bestandsreservierung und Rückkehr beider Flotten, ohne künstliche Zielkolonie.
Beide Varianten tragen dieselbe Encounter-ID und denselben Befehlsvertrag.
Mehrparteien-/Allianzschlachten sind ein späteres Feature, kein MVP-Workaround.

### 3.3 Kampfphasen und Regeln

Empfehlung für den ersten neuen Regelsatz:

1. `assembling`: Ankunft, Teilnehmer-/Bestandsbindung, Vorabaufträge.
2. `engaging`: gleichzeitige Gruppenaktionen aus einem gemeinsamen
   Phasenstart-Snapshot; Initiative darf nicht durch HTTP-Reihenfolge entstehen.
3. `disengaging`: Rückzug hat Dauer, erreichbare Route und regelbasierte
   Restgefährdung; kein sofortiger verschwundener/unverwundbarer Gegner.
4. `resolved`: genau einmal abgerechnetes Ergebnis, Bericht und Rückkehr.
5. `cancelled`: nur vor regulärer Abrechnung, mit expliziter Rückgabe
   reservierter Bestände und protokolliertem Grund.

Die neue Auflösung bekommt maximale Phasenzahl und Endbedingungen
(Vernichtung, Rückzug, Ziel erfüllt, Patt/Zeitlimit).
Phasendauer, Schadensformeln, Flankenvorteile, Reservenkosten und
Rückzugsrisiko sind **Balancing-Entscheidungen vor Freigabe von Block B3**.
Keine frei erfundenen Bonusprozente aus der QA-Szene übernehmen.

Kinetik/Energie und vorhandene Budget-/Modifikatorlogik bilden den Ausgangspunkt.
Laser, Photonen, Plasma, Railgun und Raketen sind nicht automatisch sechs
verschiedene Server-Schadenskanäle. Der Katalog ordnet tatsächliche
Schiffs-/Waffen-IDs versioniert an Regeln und visuelle Waffenfamilien zu.

## 4. Bestände, Persistenz und Wiederholbarkeit

Geplantes minimales Schema, Namen vor Migration mit bestehendem Schema abgleichen:

| Tabelle | Inhalt und wichtige Invariante |
|---|---|
| `battle_encounters` | ID, Ort/Zieltyp, Zustand, Regelversion, Revision, Seed, fällige Phase, terminale Abrechnung; eindeutiger Ankunfts-/Auslöseschlüssel |
| `battle_participants` | Encounter, Seite, Nutzer, Flotte/Kolonie, eingefrorene Startzusammensetzung und aktuelle Gruppen; eine Flotte nur in einem offenen Encounter |
| `battle_commands` | Nutzer/Worker, Gruppe, Aktion, offene Zielphase, angenommene Revision, Idempotenzschlüssel, Annahme-/Ablehnungsgrund |
| `battle_events` | Persistierte, pro Encounter eindeutige Sequenz, Phase, Typ, Payload, Sichtbarkeit; atomar mit dem entsprechenden Zustandswechsel |

NPC-Kampfaufträge erweitern die vorhandene Queue nur mit typisiertem Payload,
Encounter/Beobachtungsrevision und Deadline. Keine zweite allgemeine Queue,
kein zweiter Dispatcher ohne nachgewiesenen Bedarf.

Der Legacy-Lebenszyklus wurde vor der Extraktion charakterisiert: Start
reserviert Kolonieschiffe, Kampf bucht nur lokale Verteidigerverluste und
schreibt Angreifer-Ueberlebende in `ships_json`, Rueckkehr bucht diese ein.
Die zusaetzliche Angreiferabbuchung wurde mit Erhaltungstests korrigiert.
Fuer Encounter-Persistenz kommen MySQL-Race-/Retry-Nachweise hinzu;
keine erneute Verlustbuchung oder Schattenbestaende aus dem QA-Code.

- Eine Sperrreihenfolge für beteiligte Nutzer, Kolonien, Flotten und Encounter
  festlegen und mit Economy-/Fleet-Transaktionen abstimmen; sortierte IDs.
- Unter kurzen DB-Transaktionen Reservierung, Verluste, Beute, Bericht,
  Rückkehr und Ereignisse konsistent schreiben. Kein HTTP-/LLM-Aufruf
  unter Bestands- oder Encounter-Sperren.
- Ein Retry derselben Ankunft, Phase, Entscheidung oder HTTP-Anfrage bucht
  niemals erneut. Gleicher Idempotenzschlüssel mit abweichendem Payload: Konflikt.
- Forschungs-, Schiffskatalog-, Commander- und Regelversion zu Beginn speichern.
  Spätere Änderungen dürfen abgeschlossene Phasen nicht neu interpretieren.
- Server-RNG aus gespeichertem Seed und stabilen Phase/Gruppe/Kanal-Schlüsseln.
  Live-Zuschauer erhalten keinen Seed, der künftige Entscheidungen verrät.
- Ein Spielereplay verwendet bereits gespeicherte Zustände/Ereignisse.
  LLM-Antworten werden nie bei Replay erneut generiert.
- Berichte, Achievements, Diplomatie, Quests, Projektionen und Sichtbarkeit
  erhalten genau einmal terminale Änderungen. Faction-ID und NPC-Nutzer-ID
  bleiben unterschiedliche Identitäten.

## 5. Spielerbefehle und API

Geplanter neuer Einstieg: `api/battles.php`; bestehende Fleet-/Report-APIs
bleiben als kompatible Fassaden erhalten.

| Operation | Vertrag |
|---|---|
| GET Snapshot/Änderungen | Nutzerberechtigung und Fog of War prüfen; `revision`, `server_time`, Phase/Frist, sichtbare Gruppen, Sequenzcursor und erlaubte Aktionen |
| POST Befehl | CSRF, serverbestimmter Akteur, `battle_id`, stabile `group_id`, Aktion, optional sichtbare `target_group_id`, Revision und Idempotenzschlüssel |
| POST Simulationsmutation | Intern/autorisiert fällige Phasen begrenzt nachführen; kein frei wählbarer Gewinner oder Client-Zeitstempel |
| GET Abschlussbericht | Teilnehmer oder explizit berechtigter Beobachter; unveränderliche abschließende Ereignis-/Ergebnissicht |

MVP-Aktionen: Zielpriorität, eskortieren, Reserve einsetzen, Rückzug und
Auftrag aufheben. Diese kommen aus dem QA-UX, aber ihre Wirkung wird
serverseitig neu definiert. Deploy ist nur für tatsächlich gebundene Reserven
erlaubt; Verstärkungen benötigen echte Flotten mit autoritativer Ankunft.
Der Server prüft Kampfteilnahme, Gruppenbesitz, Zielbekanntheit, lebende/
verfügbare Einheiten, Phase, Cooldown und Ressourcen-/Transitbedingungen.

UI zeigt zunächst `vorgemerkt`, danach Annahme/Ablehnung und geltende Phase.
Nicht optimistisch Schäden, Rückzug oder Erfolg anzeigen. Konflikte und
veraltete Ziele sind sichtbare Fehler; nach Konflikt autorisierten Snapshot holen.
Abgeschlossene Schlachten bieten Replay-Steuerung, keine echten Befehle.

### PvP-Fairness und Offline-Fälle

- Bestehende PvP-/Anfängerschutzregeln vereinheitlichen und beim geplanten
  Angriff sowie Encounter-Beitritt nach definierter Policy prüfen.
- Gegner sehen keine offenen Befehle, privaten Pläne, versteckten Reserven
  oder LLM-Gründe. Reveal erst bei regelkonformer Phasenauflösung.
- Fristen basieren auf serverseitiger Annahmezeit. Doppelte, verspätete und
  konkurrierende Befehle haben definierte Konflikt-/Prioritätsregeln.
- Ohne Befehl gelten zuvor gespeicherte Doktrin/Aufträge.
  Offline-Spieler bekommen nicht plötzlich fremde LLM-Befehle; ein
  regelbasierter Auto-Admiral ist nur explizit konfiguriert.
- Disconnect, versteckter Tab oder reduzierte Bewegung beenden ausschließlich
  lokale VFX, nicht das Gefecht und nicht die Rückzugsphase.

## 6. LLM-NPC-Vorbereitung

### 6.1 Drei Entscheidungsebenen

1. **Strategie:** Fraktionsziele, Kriegspolitik und Wahl eines erlaubten
   realen Angriffsziels. Seltene, asynchrone LLM-Beratung möglich.
2. **Taktik:** gruppenbasierte Aufträge für die nächste offene Phase.
   Dieselbe Aktionsliste wie Spieler; regelbasierter Controller ist Basis.
3. **Ausführung:** Bewegung, Zielberechtigung, Treffer, Schaden und Rückzug
   allein durch PHP-Regeln; Turret/Mündung/Partikel allein durch Darstellung.

Der existierende Fraktionscontroller bleibt für Handel/Dialog/Piratenaktionen
getrennt. Dessen Vollsnapshot nicht ungefiltert zum neuen Kampfcontroller senden.
Behavior-Script-Vorrang aus dem bestehenden System erhalten; Skript,
regelbasierter NPC und LLM dürfen nicht für dieselbe Gruppe/Phase parallel
widersprüchliche Befehle anwenden.

### 6.2 Begrenzter Beobachtungs- und Antwortvertrag

LLM-Input: NPC-ID/Fraktionsdoktrin, Encounter-ID, offene Phase und Deadline,
Beobachtungsrevision, eigene sichtbare Gruppen/Zustände, bekannte Gegner,
zulässige Ziele/Aktionen, zuletzt veröffentlichte Ergebnisse und Befehlsbudget.
Keine kompletten Userprofile, Credentials, private Chatdaten, gegnerischen
Befehle oder nicht aufgeklärten Bestände. Nur freigegebene Provider.

Beispiel einer **vorgeschlagenen** Antwortform:

```json
{
  "schema_version": 1,
  "battle_id": 812,
  "observation_revision": 7,
  "orders": [
    {
      "group_id": "812:red:reserve",
      "action": "escort",
      "target_group_id": "812:red:convoy"
    }
  ],
  "reason_code": "protect_objective"
}
```

Eigene Eskorte und feindliche Zielpriorität verwenden unterschiedliche
Zielberechtigungen. Ein freier Begründungstext ist Anzeige/Log, keine Regel.
Grenzen vorerst: ein ausstehender LLM-Auftrag pro NPC/Encounter/Phase,
maximal ein Auftrag je kontrollierbarer Gruppe und strikt begrenzte
Antwortgröße. Modell-Konfidenz allein legitimiert keinen Befehl.

### 6.3 Asynchroner Ablauf

1. Encounter-Mutation erzeugt höchstens einen passenden Entscheidungseintrag.
2. Worker claimed Auftrag, erhält minimierten Snapshot und fragt außerhalb
   jeder Spieltransaktion das LLM mit begrenztem Timeout.
3. Antwort strikt parsen; unbekannte Felder/Aktionen, falsche IDs,
   unzulässige Ziele und übergroße Listen explizit ablehnen, nicht auf
   `none` normalisieren und als erfolgreiche Entscheidung verbuchen.
4. Beim Anwenden Claim-Token, NPC-Zugehörigkeit, Deadline, aktuelle offene
   Phase und Beobachtungsrevision erneut prüfen.
5. Annahme über den gemeinsamen Befehlsdienst und Claim-Abschluss in
   derselben kurzen Transaktion; abgelaufener Worker darf keine Wirkung haben.
6. Persistierte angenommene Befehle sind die Replay-Quelle; Modell,
   Prompt-/Schema-Version, Latenz und Ablehnungsgrund intern protokollieren.

LLM-Ausfall, Fristüberschreitung oder veralteter Snapshot verzögern keine
Kampfphase. Der deklarierte regelbasierte Standardauftrag bzw. bestehende
Doktrin gilt weiter; Fallback und Ursache sind explizit geloggt.
Nach der Frist eintreffende Antworten werden verworfen, nicht rückdatiert.
Retries dürfen nur vor Deadline stattfinden und keinen zweiten Effekt erzeugen.

Für NPC-vs-NPC erhalten beide Controller jeweils nur ihre eigene
Beobachtungssicht. Kein allwissender gemeinsamer Prompt. Das LLM dient der
Variabilität und Persönlichkeit, nicht einem versteckten Vorteil gegenüber
Spielern. Circuit Breaker, Kosten-/Tokenbudget und providerweite Parallelität
werden mit vorhandener Queue-/Ollama-Konfiguration abgestimmt.

## 7. Produktionsdarstellung statt QA-Mutation

- `BattleReadModel` in den JS-Domains konsumiert versionierte autorisierte
  Snapshots und Deltas; `BattlePresentation` nutzt bestehende WebGPU-Pässe.
- `HeroBattleSession`, `HeroBattleOrders` und `HeroBattleWaves` bleiben QA.
  Keine Produktionspfade über deren feste Todeszeiten oder zufällige Ziele.
- Der Produktionspfad übernimmt wiederverwendbare Mündungs-, Schild-,
  Waffen-, Damage-, Trümmer- und HUD-Renderer, nicht deren QA-Schadenslogik.
- Stabile Identität: Encounter, Teilnehmer, Flotte, Gruppe und sichtbarer
  Modellslot; Arrayindex aus einer Hero-Szene ist keine Produktions-ID.
- Der heutige Bestand ist nach Schiffstypen aggregiert. MVP-Schäden und
  Ereignisse bleiben deshalb gruppenbasiert. Modellslots repräsentieren
  Schiffsgruppen; visuelle Einzelprojektile sind als illustrativ gekennzeichnet.
- Exakte einzelne Treffer erst dann behaupten, wenn der neue Resolver sie
  ausdrücklich persistiert. Alte Rundendrücke erzeugen keine erfundenen
  Trefferprotokolle oder scheinbar autoritative individuelle Lebensbalken.
- Autoritative Summen für Schild/Hülle, Verluste und Ankünfte stimmen mit
  HUD/Bericht überein; visuelle Interpolation darf keine Zukunft enthüllen.
- Reconnect: Snapshot plus Ereigniscursor; Duplikate verwerfen, Lücken
  ausdrücklich erkennen und nachladen. SSE liefert keine Vollsimulation.
- Legacy `battle_resolved` weiter unterstützen, neuen Encounter bei
  Verbindung nicht zusätzlich als Legacy-Salve doppelt rendern.
- Keine erzwungene Kameraübernahme oder Pause anderer Engine-Navigation.
  UI bleibt Overlay und wird nur für die betrachtete Schlacht aufgebaut.
- Waffen-/Damage-/Trümmerbudgets global zwischen betrachteten Encounters
  koordinieren; nicht pro neuer Schlacht unbeschränkt duplizieren.
  Große Flotten werden visuell aggregiert/LOD-reduziert, nicht aus Gameplay
  auf die QA-Obergrenze von 128 Schiffen begrenzt.

## 8. Umsetzung in abhängigen Blöcken

Die Bloecke sind die Zielplanung. Der folgende Status unterscheidet bereits
implementierte Grundlagen von noch offenen Integrationsschritten.

### Implementierter erster Teil von B0/B1

- [BattleResolver](../../src/Combat/BattleResolver.php) kapselt den reinen,
  controllerunabhaengigen Regelsatz `legacy-v1`: deterministische Zufallswerte,
  Kampfausgang und schiffstypweise Verlust-/Ueberlebendenaufteilung.
- Die bestehenden Funktionen in [fleet.php](../../api/fleet.php) delegieren
  an diesen Kern. Produktionskampf, Vorschau und Matchup-Scan behalten
  Seedverfahren, Formeln, Ergebnisfelder und Berichtsversion 1. Die alten
  Rundenzusammenfassungen bleiben illustrative Druckwerte, keine Kampfphasen.
- Gekoppelter Bestandsfehler behoben: Der Start entfernt entsandte Schiffe
  bereits aus der Ursprungskolonie. Angreiferverluste duerfen dort nicht
  nochmals abgebucht werden. Nur die Ueberlebenden in `fleets.ships_json`
  werden bei der Rueckkehr eingebucht; Verteidigerverluste bleiben lokale
  Kolonieabbuchungen.
- [BattleResolverTest](../../tests/Unit/BattleResolverTest.php) prueft vor
  der Extraktion ermittelte Golden Outputs, beide Schadensmodelle,
  Faktoren/Clamps, deterministische Seeds, Rundung und Bestandserhaltung.
- [BattleInventoryTest](../../tests/Integration/BattleInventoryTest.php)
  fuehrt die echten Resolver-/Rueckkehrfunktionen in einer isolierten
  SQLite-Datenbank aus: Sieg/Niederlage, Human-/NPC-Angreifer, unveraenderte
  Heimatschiffe, Bericht/Ueberlebende und Rollback bei Report-Schreibfehler.
  Externe Profil-/Queue-/Achievement-Helfer sind isoliert; MySQL-Upsertsyntax
  wird fuer SQLite angepasst. Dies ersetzt keinen MySQL-Lock-/Race-Test
  und testet noch nicht die echte Start-API oder NPC-Verteidigerdiplomatie.
- Validierung: 24 gezielte PHPUnit-Tests / 300 Assertions bestanden;
  PHP-Syntax, PHPCS fuer die neuen Dateien und PHPStan fuer Kern plus
  Fleet-Fassade sauber. Der gesamte PHPStan-Lauf meldet 80 Befunde
  ausserhalb der geaenderten Kampfdateien; die bestehende Baseline wurde
  nicht neu generiert. Ein isolierter temporaerer Cache umgeht die
  Schreibrechte des gemeinsam genutzten Repository-Caches.

### Gemeinsamer Start-/Policy-/Transitpfad implementiert

- [fleet_launch.php](../../lib/fleet_launch.php) ist der gemeinsame Dispatch
  fuer [send_fleet](../../api/fleet.php) und
  [launch_fleet_for_user](../../api/game_engine.php). NPCs und autonome
  Commander laufen dadurch ebenfalls durch denselben Pfad; ihre bisherige
  Bool-Schnittstelle bleibt erhalten.
- Bestaetigte Policy: Angriffe auf menschliche Ziele erfordern beim
  Angreifer **und** Ziel PvP-Opt-in. Anfaengerschutz des Angreifers und eines
  menschlichen Ziels verhindert den Start, auch bei NPC-/Commander-Auftraegen.
  Angriffe auf NPC-Ziele behalten die bisherige Spieler-Policy.
  Transporte und andere Nichtangriffsmissionen erhalten keine PvP-Sperre.
- Geprueft wird weiterhin beim Start, nicht mit einer neu eingefuehrten
  Ankunftsregel. Vel'Ar prueft nach Scatter/Snap auch das tatsaechliche Ziel;
  ein urspruengliches NPC-Ziel erlaubt keinen Sprung auf einen geschuetzten
  Menschen.
- Bestehende Fraktionsregeln bleiben zentral: Aereth-Dichtebonus,
  Vor'Tak-Reichweite/Recharge/Carrier-Kapazitaet, Syl'Nar-Gate, Vel'Ar-Snap
  und Stealth, Zhareen-Node-Cooldown sowie Kryl'Tha-Groessenlimit/Huellenmalus.
  NPCs erhalten keine generische Reise als stillen Ersatz. Bestehende
  Wurmlochhelfer sind aus der HTTP-Datei in den gemeinsamen Dispatch verlegt.
- User-/Koloniesperre umfasst nun Ressourcenabgleich, Schiffsqueue,
  Startvalidierung, Cargoabbuchung, bedingte Schiffsreservierung,
  Cooldowns, Flotteninsert und Dirty-Queue. Der Ledger behaelt seine
  User-vor-Kolonie-Reihenfolge und nutzt Savepoints in Caller-Transaktionen.
  Cargo wird gegen frisch abgeglichene Ressourcen geprueft.
- Cacheinvalidierung erfolgt nach erfolgreichem Ledger-Aufruf. Bei einem
  aeusseren Caller-Transaction darf der Caller weiterhin committen/rollbacken;
  Dirty-Queue und Flotte werden mit ihm zurueckgerollt. Cache-Loeschungen
  koennen bereits erfolgen, schreiben jedoch keine uncommitteten Daten.
- Erwartete interne Startablehnungen/DB-Fehler ergeben `false` mit
  `error_log` samt User/Kolonie/Mission/Grund; Programmierfehler werden
  nicht mehr pauschal verschluckt.
- [FleetLaunchTest](../../tests/Integration/FleetLaunchTest.php) fuehrt den
  echten gemeinsamen Dispatch und internen Adapter mit isolierter
  Economy-/Queue-/Katalog-/Cache-Infrastruktur aus. SQLite adaptiert
  lediglich MySQL-Datumsausdruecke, Schema-Metadaten und Parameter-Coercion.
  Abgedeckt: vier Controllerpaare, beide PvP-Flags/Schutz, Fraktionsreisen,
  Wurmlochverbrauch, Scatter-Zielschutz, Carrierkapazitaet, frische Ressourcen,
  Cargo/Schiffsbilanz, Fehler bei Fleet-/Dirty-Insert und aeussere Savepoints.
- Validierung: 135 gezielte Tests / 808 Assertions bestanden, einschliesslich
  bestehender Kampf-, Physik-, ResourceLedger- und OnDemandEconomy-Tests.
  PHPStan fuer beide Adapter und Dispatch sowie PHPCS fuer die neuen
  Dispatch-Dateien sauber. Zusaetzliche gemeinsame Starts mit der echten
  OnDemandEconomy pruefen akzeptierte Fracht gegen Koloniestock,
  persistierten Economystate und Marktprojektion. Fehler im Fleet-/Dirty-
  Insert rollen auch Economyinitialisierung und Marktprojektion zurueck.
  Die Schiffsqueue und Cache-/Dirty-Infrastruktur bleiben in diesen
  SQLite-Tests isoliert. Der gesamte PHPStan-Lauf bleibt bei 80 Befunden
  ausserhalb der geaenderten Kampf-/Startdateien.

### MySQL-Race-/Retry-Abnahme der B0/B1-Grundlagen

- [FleetMySqlConcurrencyTest](../../tests/Integration/FleetMySqlConcurrencyTest.php)
  nutzt eigene zufaellig benannte Datenbanken mit InnoDB und nativen
  Prepared Statements. Testdatenbanken werden nach jedem Fall entfernt;
  laufende Spielbestandsdaten sind nicht Teil der Fixtures.
- Zwei echte PHP-Prozesse starten denselben Schiffsbestand bzw. nutzen
  denselben Vor'Tak-Cooldown. Ein Commit wird per Barrier gehalten;
  `performance_schema.data_lock_waits` weist die wartende Gegenoperation
  nach. Genau ein Start wird angenommen, genau einmal Schiffe/Cargo gebucht.
- Doppelte fällige Kampfankunft und doppelte Rueckkehr laufen jeweils
  konkurrierend durch den echten `process_fleet_arrival_locked`-Pfad.
  Alle vier Controllerpaare sind mit Sieg/Niederlage abgedeckt.
  Report, Nachrichten, Verluste, Beute, Dirty-Eintraege und Rueckkehr bleiben
  einmalig; NPC-Verteidigerdiplomatie wird ueber die echten
  `update_standing`-/Membership-Funktionen einmalig angewendet.
- Ein Worker beendet sich nach erfolgreichem Start, jedoch vor Commit.
  MySQL verwirft die offene Buchung; anschliessender Retry kann genau eine
  Flotte starten. Andere Verbindungen sehen keine uncommitteten Bestaende.
- Trigger erzwingen Fehler bei Fleet-/Dirty-, Report-, Nachrichten- und
  System-Dirty-Inserts. Rollback stellt die vorherigen Zeilen wieder her,
  einschliesslich Cooldown, Verteidigerbeute und NPC-Diplomatie. Retry nach
  einem fehlgeschlagenen Kampf oder einer fehlgeschlagenen Rueckkehr erzeugt
  keine zusaetzlichen terminalen Effekte. Positive Angreiferverluste bleiben
  explizit gegen die Heimatschiffe und Rueckkehrsumme abgesichert.
- Die Fixture isoliert Economy-Catch-up, Bauqueues, Cache-IO, FoW,
  Achievements und Modifikator-/Energiebudgetlieferanten. Schiffsprofile,
  Resolver, Start/Claim/Rueckkehr-SQL, ResourceLedger und Diplomatie bleiben
  echte Repositoryfunktionen; es gibt keine SQLite-Syntaxadaption.
  Dies ist eine DB-Transaktionsabnahme, kein vollstaendiger HTTP-/Gameplay-
  End-to-End-Test aller Infrastrukturhelfer.
- Validiert auf MySQL 8.4 / PHP 8.2: **19 Tests / 750 Assertions**
  einschliesslich zweier vorhandener ResourceLedger-Konkurrenztests,
  ohne PHPUnit-Warnings/Risky-Tests. Die vorhandene gezielte
  SQLite-/Kampf-/On-demand-Matrix bleibt bei **135 Tests / 808 Assertions**
  sauber. PHPCS fuer alle drei neuen Testdateien und Diff-Whitespace sauber.
- Der bestehende MySQL-Schritt in [ci.yml](../../.github/workflows/ci.yml)
  fuehrt die neue Flottenabnahme mit denselben isolierten Testzugangsdaten
  und strengen PHPUnit-Flags aus.

**B0/B1-Grundlagen abgenommen.** B2 beginnt mit persistenten
Auftragsidentitaeten; die folgenden Schritte ersetzen nicht die spaetere
Encounter-Persistenz.

### B2 Teil 1: persistente Start-Idempotenz

- [FleetDispatchReceipt](../../src/Combat/FleetDispatchReceipt.php) und die
  additive [Migration](../../sql/migrate_fleet_dispatch_receipts_v1.sql)
  speichern eine Annahme pro Nutzer und `request_id`. Der bestehende
  User-/Kolonie-Lock serialisiert auch Wiederholungen auf verschiedenen
  Herkunftskolonien. Receipt, Flotte, Ressourcen, Schiffe, Cooldowns und
  Dirty-Queue werden in derselben Transaktion gebucht.
- `request_id` ist optional fuer bestehende Clients; ohne ID bleibt der
  bisherige nicht-idempotente Start erhalten. Gueltig sind 16-128 ASCII-
  Zeichen (`A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, `-`; erstes Zeichen alphanumerisch).
  Eine ID ist auf den authentifizierten/ausfuehrenden Nutzer beschraenkt,
  nicht global und nicht vom Modell als Autoritaet bestimmbar.
- Derselbe Schluessel plus derselbe JSON-Payload liefert die urspruengliche
  `fleet_id`/`arrival_time`-Antwort ohne neue Inventar-, Transit- oder
  Gameplaymutation. Objektfelder werden rekursiv sortiert, Arrayreihenfolge
  und JSON-Werttypen bleiben relevant; die ID selbst gehoert nicht zum Hash.
  Unterschiedlicher Payload mit bereits angenommener ID ergibt HTTP 409.
- Wiederholungen passieren nach aktueller Nutzer-/Kolonie-Eigentumspruefung,
  aber vor erneuter Ship-/Cargo-/FTL-Pruefung. So verhindern bereits
  verbrauchte Schiffe oder gestartete Cooldowns nicht die Wiederholung einer
  verlorenen Bestätigung. Der Rueckgabewert beschreibt den damaligen Start,
  nicht den aktuellen Flottenzustand.
- Receipts haben absichtlich keinen Fleet-Fremdschluessel und bleiben nach
  Kampf/Rueckkehr/Loeschung der Flotte erhalten. Noch keine TTL/Pruning;
  ein abgelaufener Schluessel darf spaeter nicht unbemerkt neu starten.
- [FleetLaunchDomain](../../js/engine/runtime/server-fleet-launch-domain.js)
  und [RuntimeFleetSubmitFlow](../../js/engine/runtime/RuntimeFleetSubmitFlow.js)
  vergeben sichere UUIDs und behalten sie bei fehlender Antwort fuer
  denselben Auftrag. Nach einer Annahme bekommt ein bewusst neuer Auftrag
  eine neue ID. Ein unbekannt bestaetigter Auftrag kann auch mit inzwischen
  kleinerem Inventar wiederholt werden. Der alte `API.sendFleet`-Helper
  nutzt nun den vorhandenen kanonischen `fleet.php?action=send`-Endpunkt
  statt des nicht vorhandenen `send_fleet.php`.
- Frontend-Pending-IDs leben im jeweiligen Domain-/Formhelper und sind
  noch nicht ueber Browserreload oder Shutdown persistiert. NPC-/Commander-
  Aufrufer koennen eine explizite, stabil wiederverwendete Entscheidungs-ID
  an `launch_fleet_for_user` bzw. `npc_launch_fleet` uebergeben. Bestehende
  autonome Aufrufer ohne ID sind weiterhin nicht dedupliziert; deren
  zukuenftiger Encounter-/Commanddienst muss echte Entscheidungsidentitaeten
  liefern, keine aus dem Payload geratenen oder pro Retry neuen IDs.
- Rollout zuerst Migration, dann keyed Clients; keine DDL waehrend des
  Startrequests, kein Fallback auf einen undeduplizierten Start bei
  Schemafehlern. Bei Implementierungsabnahme nur isolierte MySQL-Fixtures
  migriert; lokale Deployment-Abnahme siehe unten.
- Nachweis: 21 MySQL-Tests / 739 Assertions bestanden, inklusive
  konkurrierender keyed Starts, Antwortwiederholung nach Flottenloeschung,
  Payloadkonflikt, Crash vor Commit und Receipt-Insertfehler.
  Ein separater MigrationRunner-Test / 8 Assertions prueft wiederholtes
  Up/SQL, InnoDB, case-sensitive IDs und User-Cascade.
  Die gezielte PHP-Matrix besteht mit 145 Tests / 880 Assertions;
  73 JavaScript-Tests pruefen beide Retry-UX-Pfade und den kanonischen
  API-Endpunkt. PHPStan fuer Receipt und alle Startadapter, PHPCS fuer
  neue/geaenderte Kern-/Dispatch-Testdateien, JS-Lint, Frontend-Build und
  append-only-Migrationshistorie sauber. Gesamt-PHPStan bleibt bei 80
  Befunden ausserhalb der geaenderten Implementierung.

### B2 Teil 2: atomarer Legacy-Encounter implementiert

- [BattleEncounterService](../../src/Combat/BattleEncounterService.php) und
  [Migration](../../sql/migrate_battle_encounters_v1.sql) speichern eine
  stabile Encounter-ID pro realer Angriffsflotte. Ein Encounter hat genau
  zwei Seiten mit serverseitiger `user_id`, `controller_kind` und initialem
  Schiffsbestand. Unbekannte Controlleridentitaeten werden abgelehnt.
- Opt-in ueber `BATTLE_ENCOUNTERS_ENABLED=1`, standardmaessig deaktiviert.
  Migration und InnoDB-Pruefung vor Aktivierung erforderlich. Bei initialer
  Abnahme deaktiviert; lokale Deployment-Abnahme siehe unten. Das ist kein Shadowmodus:
  aktivierte Angriffe buchen dieselben realen Legacy-Effekte wie vorher.
- `resolve_battle()` haelt den bestehenden faelligen Fleet-Claim und sperrt
  bei aktiviertem Journal die Zielkolonie vor dem Verteidigersnapshot.
  Verschiedene Angriffsflotten auf dieselbe Kolonie sehen dadurch nacheinander
  den aktuellen Bestand, nicht beide denselben bereits verbrauchten Bestand.
- `legacy-v1`, bisheriger Seed, Berichtsversion 1, Formeln, Verluste, Beute,
  Diplomatie, Nachrichten, Rueckkehr und Dirty-Publikation bleiben erhalten.
  Journal und alle Effekte committen in derselben Ankunftstransaktion.
  Schreibfehler oder Workerabbruch hinterlassen weder halbe Encounters noch
  doppelte Wirkungen. Ein bereits journalisierter Fleet-Start kann auch bei
  versehentlich zurueckgesetztem `returning` nicht nochmals kaempfen.
- Revision 1 / `resolving` und `encounter_created` sind nur innerhalb der
  Transaktion sichtbar. Revision 2 / `resolved` und `encounter_resolved`
  werden gemeinsam veroeffentlicht. Beide Ereignisse sind sequenziert;
  der komplette unveraenderte Legacy-Bericht wird als Outcome gespeichert.
  Alte Rundendruecke bleiben ausdruecklich illustrativ, keine Trefferphasen.
- Historische Quellen-IDs bleiben nach Flottenrueckkehr erhalten; keine
  Fleet-Fremdschluessel, keine automatische Historienloeschung. Ein geloeschter
  Legacy-Bericht entfernt nicht den gespeicherten Outcome. Retention und
  Kontoloeschung brauchen vor Produktionsaktivierung eine abgestimmte Policy.
- `GET api/fleet.php?action=battle_encounter&encounter_id=...` liefert
  Schema-Version 1, Teilnehmer, Outcome und Ereignisse nur fuer eine
  teilnehmende Nutzeridentitaet. Fremde und unbekannte IDs liefern identisch
  404. Der Zugriff fuehrt keine Simulation aus, auch wenn eine Rueckkehr
  bereits faellig ist. Noch keine UI-/SSE-Discovery oder Observerfreigabe.
- Alle vier Human-/NPC-Paarungen verwenden denselben Pfad. NPC-vs-NPC ist
  ohne Browser ueber den bestehenden expliziten Arrival-Aufruf abgenommen,
  aber es gibt weiterhin keinen neuen Scheduler und keine automatische
  Freigabe von NPC-Kriegsstarts.
- Abnahme: 35 reale MySQL-Tests / 995 Assertions, einschliesslich aller
  vier Paarungen, verschiedener Flotten auf dieselbe Kolonie, doppelter
  Ankunft/Rueckkehr, Workerabbruch vor Commit, letzter Eventwrite,
  fehlender Migration und falschem Storage-Engine. Die gezielte Legacy-
  Regression besteht mit 146 Tests / 890 Assertions. Beide neuen
  Migrationsschnitte bestehen mit 2 MigrationRunner-Tests / 18 Assertions.
  PHPStan fuer Encounter-Service/Fleet-Fassade/Config und PHPCS fuer
  Service/MySQL-Fixtures sauber; Gesamt-PHPStan bleibt bei 80 bestehenden
  Befunden. Compose-Konfiguration und append-only-Historie validiert.
  Der echte versionierte HTTP-Endpunkt weist nicht authentifizierte
  Zugriffe mit 401 ab; Teilnehmer-/404-Vertrag ist gegen MySQL getestet.

### Lokale Deployment-Abnahme am 2026-11-07

- Nach expliziter Freigabe nur `migrate_battle_report_fleet_link_v1.sql`,
  `migrate_fleet_dispatch_receipts_v1.sql` und
  `migrate_battle_encounters_v1.sql` auf die lokale Spiel-Datenbank angewendet.
  Vorher `battle_reports` und `schema_migrations` lokal gesichert.
- Bestehender MigrationRunner mit temporaerem Teilmanifest aus den elf
  tatsaechlich getrackten Migrationen plus diesen drei Dateien verwendet.
  Alle bestehenden Checksums geprueft; keine historische Migration als
  angewendet ausgegeben oder nachtraeglich als Baseline markiert.
  Teilmanifest-Verification: 14 Migrationen; Wiederholung ohne neue Writes.
- Alle vier neuen Tabellen sowie `battle_reports` und Tracking nutzen InnoDB.
  `BATTLE_ENCOUNTERS_ENABLED=1` in der lokalen Umgebung gesetzt und nur
  der Web-Service neu erstellt. Keine aktive Schlacht fuer Smoke-Tests
  gestartet oder reale Bestands-/Kampfwirkung zu Testzwecken erzeugt.
- Nach Restart: `/health/live` liefert 200, Encounter-API ohne Anmeldung 401.
  25 isolierte Legacy-Tests / 316 Assertions und drei gezielte MySQL-Tests /
  45 Assertions erneut bestanden.
- Vollstaendige Deployment-Readiness bleibt gesperrt: 71 andere historische
  Manifestmigrationen sind nicht getrackt, `/health/ready` liefert daher 503.
  Diese wurden ausdruecklich nicht angewendet. Kein Nachweis einer vollstaendig
  migrationsbereiten Installation; keine Aenderung des Readiness-Gates.
  Das lokale Battle-Journal ist aktiviert, keine Produktions-Rolloutfreigabe.

**B2 weiterhin offen:** separat persistierte aktive Encounters mit faelligen
Phasen, Command-/Queue-Identitaeten und eigener Catch-up-Verarbeitung.
Der aktuelle Schnitt ist bewusst ein atomarer Legacy-Encounter, kein bereits
interaktiver Fuenfminutenkampf. Neue Kampfphasen, Spielerbefehle,
LLM-Kampfsteuerung und Produktionsdarstellung sind weiterhin nicht aktiviert.

Lokale Reconciliation fortgesetzt: Die beiden Actor-Migrationen wurden nach
expliziter Schema-/Identitaetspruefung als `adopted` mit separater Provenienz
uebernommen, nicht erneut ausgefuehrt. 44 NPCs und drei Menschen unveraendert;
69 Migrationen bleiben pending, volle Readiness bleibt gesperrt. Verfahren und
Grenzen siehe [DATABASE_MIGRATIONS](./DATABASE_MIGRATIONS.md#verified-actor-history-adoption).

Anschliessend wurden beide Unified-Body-Migrationen mit eigener Provenienz
uebernommen: Der native Katalog bleibt massgeblich, ohne Import unbewohnter
Legacy-Planeten. 566.764 Bodies und 47 Koloniezuordnungen bleiben unveraendert.
Aktueller Stand: 14 ausgefuehrt, vier adoptiert, 67 pending; Readiness bleibt
503. Legacy-v2 ist weiterhin gesperrt, bis Schema-, Seed- und Datenbedingungen
vollstaendig geprueft sind. Siehe
[Body-Adoption](./DATABASE_MIGRATIONS.md#verified-native-body-adoption).

Der vollstaendige Legacy-v2-Audit hat anschliessend 27 Datentabellen mit
205.807 Zeilen geprueft: 306 SQL-Statements im isolierten Replay, keine
Aenderung bestehender Daten. Die unabhaengige Schema-Pruefung zeigt vier
fehlende Quest-Felder, die bereits eine separate pending Migration repariert.
Zusaetzlich muessen modernisierte Typen/Identitaeten, explizite JSON-Eingaben
und ein abweichender Icon-Default im V2-Vertrag behandelt werden. Noch keine
V2-Adoption und keine weitere Live-Migration. Vier gezielte MySQL-Tests /
60 Assertions bestanden; der Generator bleibt unverdrahtet. Nachweis siehe
[vollstaendiger V2-Audit](./DATABASE_MIGRATIONS.md#full-legacy-v2-postcondition-audit-2026-11-07).

Nach separater Freigabe wurde ausschliesslich die vorhandene Quest-Migration
lokal ausgefuehrt: vier Schemafelder repariert, 28 Katalogeintraege und alle
Actor-/Body-Identitaeten unveraendert, vier Vorlagen und leerer Generation-Log.
Kein Generatorstart und kein neues NPC-Verhalten. Die 18 bisherigen
Trackingzeilen bleiben unveraendert; aktueller Stand: 15 ausgefuehrt, vier
adoptiert, 66 pending. Legacy-v2 bleibt offen, volle Readiness bleibt 503.
Siehe [gezielte Quest-Reparatur](./DATABASE_MIGRATIONS.md#approved-local-quest-schema-repair-2026-11-07).

V2-Adoptionsvertrag implementiert: `adopt-v2` prueft den gepinnten
Quelltextvertrag fuer 27 Tabellen/284 Spalten, aktuelle Actor-/Body-Regeln,
vollstaendige Index-/FK-Gruppen, JSON-Eingaben und alle Achievement-Seeds.
Keine historische SQL-Ausfuehrung. Der fehlerhafte Icon-Default bleibt ein
expliziter Blocker; eine additive Default-only-Reparatur ist vorbereitet.
Neue Kampfphasen und NPC-Steuerung bleiben weiterhin deaktiviert.
Verfahren siehe [V2-Adoption](./DATABASE_MIGRATIONS.md#verified-current-legacy-v2-adoption).

Nach eigener Freigabe wurde der Icon-Default lokal repariert und V2 mit
atomarer Provenienz adoptiert, ohne Legacy-SQL-Replay. 32 vorhandene
Faction-Zeilen/Icons, 44 NPCs, drei Menschen und 566.764 Bodies unveraendert.
Alle bisherigen Trackingzeilen und Adoptionsnachweise bleiben erhalten.
Wiederholte V2-Vorschau: null Kandidaten und identische Nachweishashes.
Aktueller Stand: 16 ausgefuehrt, fuenf adoptiert, 65 pending; volle Readiness
bleibt 503. Weitere historische Migrationen sind separat abzugleichen.
Siehe [lokaler V2-Abschluss](./DATABASE_MIGRATIONS.md#approved-local-v2-adoption-deployment-2026-11-07).

Gameplay-/Politik-Historie abgeglichen: Alle zehn Zieltabellen fehlten.
Nach expliziter Freigabe wurden beide Originalmigrationen tatsaechlich
ausgefuehrt, nicht adoptiert. Die bestaetigten Startprofile gelten fuer
alle 47 Accounts; ihre bereits verdrahteten Effektwerte wurden fuer drei
Menschen und 44 NPCs direkt geprueft. 188 interne Faction-Zeilen,
47 Empire-Profile und 94 Civic-Zuordnungen angelegt; keine Situation,
Historie oder Kampfphase gestartet. Bestehende Koloniebestaende,
Actor-Identitaeten und V2-Datennachweis unveraendert.
Vier MySQL-Tests / 89 Assertions bestanden.
Stand: 18 ausgefuehrt, fuenf adoptiert, 63 pending; Readiness bleibt 503.
Nachweis und bestaetigte Profilwirkung:
[Gameplay-/Politik-Deployment](./DATABASE_MIGRATIONS.md#approved-local-gameplaypolitics-deployment-2026-11-07).

Economy-Postbedingungen isoliert geprueft: Elf vorhandene Tabellen stimmen
mit der aus Original-SQL aufgebauten Referenz ueberein; alle 93 Bestandszeilen
bleiben beim Replay erhalten. String-Policies und fraktionale Steuern bleiben
massgeblich; das spaetere `CREATE IF NOT EXISTS` konvertiert sie nicht.
Replay verbraucht dennoch Markt-IDs, und einzelne Marker beweisen keine
vollstaendigen Spaltengruppen. Die drei fehlenden Kategorie-/Spionagetabellen
werden nicht aktiviert: Zeitspalte, Status und Missionstypen der heutigen
APIs passen nicht zum historischen SQL. Keine Live-Ausfuehrung oder Adoption;
Stand unveraendert 18/fuenf/63. Nachweis und offener Freigabeumfang:
[Economy-Audit](./DATABASE_MIGRATIONS.md#economy-postcondition-audit-2026-11-07).

Gepruefte Economy-Adoption implementiert: `adopt-economy` deckt genau die
fuenf Economy-/Policy-/Shortage-Quellen ab. Vollstaendige Schema-/Index- und
Marktschluesselpruefung, gesperrte Zeilenhashes und atomare Fuenfergruppe
verhindern Replay, Markt-ID-Verbrauch und Bestandsaenderungen. Dry-run lokal
mit 93 Zeilen bestanden; noch keine Live-Adoption. Kategorie-/Spionageblock
bleibt ausgeschlossen. 44 fokussierte Tests / 449 Assertions sowie final
152 Runner-/CLI-/Lock-Tests / 672 Assertions bestanden (ueberlappende Selektoren).
Vertrag und Operatorablauf:
[Economy-Adoption](./DATABASE_MIGRATIONS.md#verified-ordered-economy-adoption).

Nach gesonderter Freigabe lokal abgeschlossen: 19 Tabellen gesichert und
persistiertes Backup per SHA-256 bestaetigt; genau fuenf Economy-Historien
atomar adoptiert, kein Original-SQL ausgefuehrt. Scoped Verify: 28 Eintraege,
Wiederholung ohne Kandidaten/Up ohne Arbeit. Alle 93 Economy-Zeilen,
Markt-Sequenzen, modernen Ledger, Actor-/Koloniebestaende und bisherigen
Historiennachweise unveraendert; frischer kompletter V2-Vergleich ebenfalls
identisch. Stand: 18 ausgefuehrt, zehn adoptiert, 58 pending;
Liveness 200, volle Readiness weiter 503. Kategorie-/Spionage bleibt aus.
[Lokaler Economy-Abschluss](./DATABASE_MIGRATIONS.md#approved-local-economy-adoption-deployment-2026-11-07).

Naechster Block nach Scope-Freigabe: Kategorie-/Spionage-Infrastruktur,
keine Aktivierung neuer Spionageregeln. Alle Spionageaktionen inklusive
Empire-Spionagestatus melden nach Auth/Method/CSRF explizit 503 und greifen
nicht auf die DB zu; inkompatible bisherige Missionsmutationen entfernt.
Empire-Score-GETs bleiben reine Berechnung. Keine Mission, Kreditregel,
Tick-/Resolver- oder LLM-Aktivierung. 28 Tests / 127 Assertions bestanden;
Live-Ausfuehrung des unveraenderten dreitabelligen SQL noch separat freizugeben.
[Infrastruktur-Gate](./DATABASE_MIGRATIONS.md#categoryespionage-infrastructure-with-explicit-runtime-gate).

Kategorie-Infrastruktur nach separater Freigabe lokal ausgefuehrt:
vier Bestands-/Historientabellen gesichert und Backup-Hash bestaetigt;
drei leere InnoDB-Tabellen, Scoped Verify 29 Eintraege, Up-Wiederholung leer.
47 Actor-/47 Koloniezeilen und alle bisherigen Nachweise unveraendert.
Live-Abnahme deckte den CLI-Worker-Import in der Empire-API auf; gemeinsame
unveraenderte Score-Formeln nach `lib/empire_scores.php` extrahiert.
API laedt keinen Worker; beide Spionage-APIs unauthentifiziert 401,
authentifizierte Gate-Fixtures 503 ohne DB-Zugriff. 55 Tests / 319 Assertions
bestanden. Stand: 19 ausgefuehrt, zehn adoptiert, 57 pending;
Liveness 200, volle Readiness 503. Auth/RBAC als naechster Historienblock.
[Lokaler Infrastruktur-Abschluss](./DATABASE_MIGRATIONS.md#approved-local-category-infrastructure-deployment-2026-11-07).

Auth-/RBAC-Block vorbereitet: Drei Auth-Quellen haben bereits vollstaendige
Postbedingungen; `adopt-auth` validiert sie mit SQL-abgeleitetem Descriptor,
vollstaendigen Indizes/FK und gesperrten Hash-Snapshots ohne Token-/Kontoaenderung.
Vier RBAC-Tabellen fehlen und benoetigen echte Ausfuehrung; Originalseeds legen
keine Benutzergruppen an und aktivieren keine RBAC-Auswertung. Bestehender
Adminpfad bleibt `users.is_admin`. 105 Tests / 552 Assertions bestanden;
lokaler Auth-Dry-run erfolgreich, Deployment noch gesondert freizugeben.
[Auth-/RBAC-Vertrag](./DATABASE_MIGRATIONS.md#verified-auth-adoption-and-separate-rbac-infrastructure).

Nach separater Freigabe lokal abgeschlossen: Sieben Tabellen gesichert,
persistiertes Backup per SHA-256 bestaetigt; drei Auth-Historien ohne
SQL-Replay atomar adoptiert, danach acht RBAC-Statements tatsaechlich
ausgefuehrt. Scoped Verify 33 Eintraege; Wiederholungen ohne Kandidaten/Arbeit.
47 Accounts, 47 Kolonien, Auth-Material/Sperren und alle alten Historiennachweise
unveraendert. Fuenf Gruppen/sechs Profile/fuenf Links, null Benutzergruppen;
keine Berechtigungsauswertung aktiviert. 105 fokussierte Tests / 552 Assertions
und 148 finale Runner-/CLI-/Auth-Tests / 539 Assertions bestanden
(ueberlappende Selektoren). Stand: 20 ausgefuehrt, 13 adoptiert, 53 pending;
Liveness 200, Readiness 503, Auth-/TOTP-/Admin-GETs unauthentifiziert 401.
[Lokaler Auth-/RBAC-Abschluss](./DATABASE_MIGRATIONS.md#approved-local-authrbac-deployment-2026-11-07).

Kolonisierungsblock als **infrastructure-readonly** vorbereitet:
Fuenf Tabellen und drei Koloniespalten fehlen, daher echte Ausfuehrung statt
Adoption. Alle neun Verwaltungsbefehle nach Auth/POST/CSRF vor Datenbankzugriff
mit 503 gesperrt; GETs bleiben reine Ansichten. Sprawl zaehlt vollstaendige
Galaxy-/System-Koordinaten statt galaxieuebergreifend identischer Systemnummern.
78 Tests / 235 Assertions, gezielte Typ-/Standardpruefung und unveraenderte
SQL-Historie bestaetigt. V2-Rohreplay ist wegen unbedingtem FK nicht wiederholbar;
getracktes Up bleibt ein No-op. Phaseninitialisierung (zwei Phase 1, 45 Phase 0)
und Energie-Platzhalter 0 benoetigen noch separate Deploymentfreigabe.
Keine Gouverneurs-/Ediktkosten, Wachstumsintegration oder periodische Engine aktiviert.
[Kolonisierungs-Audit](./DATABASE_MIGRATIONS.md#colonization-audit-and-read-only-runtime-preparation-2026-11-07).

Nach separater Freigabe ausgefuehrt: Sechs Tabellen gesichert, 47.876-Byte-Backup
persistiert und per SHA-256 bestaetigt. Nur V1/V2 (6 + 19 Statements) ausgefuehrt;
fuenf leere Tabellen, 45 Phase-0-/zwei Phase-1-Kolonien, null Sektoren und
Energie-Platzhalter 0. 47 Konten/Kolonien, Originalbestaende/-zeitstempel,
Gebaeudedaten, 33 alte Trackingzeilen und 13 Adoptionsnachweise unveraendert.
Scoped Verify 35 und Wiederholung ohne Arbeit. Stand: **22 ausgefuehrt,
13 adoptiert, 51 pending**. GETs unter Live-Schema/Read-only-Transaktion
geprueft; echte unauthentifizierte GET/POSTs 401, Liveness 200, Readiness 503.
Keine Verwaltungsbefehle oder neuen Wirtschaftseffekte aktiviert.
[Lokaler Kolonisierungsabschluss](./DATABASE_MIGRATIONS.md#approved-local-colonization-deployment-2026-11-07).

Galaxy-/Orbital-Audit und Deployment (2026-11-08): 25.090 Sternsysteme vollstaendig,
566.764 Koerper, davon 15 ohne Orbit-Projektion; nur diese 15 abgeleiteten Werte
und ihre `updated_at` wurden aktualisiert. Zwei ohne Radiusquelle bleiben bei
Radius NULL/Koordinaten 0. Galaxiemetadaten installiert; additive DECIMAL-
Korrektur liefert exakt 0,15 statt historischem Rundungswert 0,2. Fog of War
unveraendert: exakter Quellchecksum, 47/47 `own`-Kolonien, 37 `stale`.
Backup 85.935 Byte SHA-256-geprueft; scoped Verify 38, Wiederholung ohne
Arbeit, alte Reihen/Adoptionsnachweise unveraendert. Stand: **25 ausgefuehrt,
13 adoptiert, 49 pending**; Liveness 200, Readiness 503.
[Galaxy-/Orbital-Audit](./DATABASE_MIGRATIONS.md#galaxy-geometry-and-visibility-audit-2026-11-08).

| Block | Inhalt | Voraussetzung | Nachweis vor nächstem Block |
|---|---|---|---|
| B0: Baseline/Inventar | Produktionscall-Sites, Transaktionen, Flottenbestand, PvP, Transit und Reports charakterisieren; Golden Fixtures und Conservation Tests | keine | Bestehende Kämpfe reproduziert; Buchungs-/Policy-Abweichungen dokumentiert und nötige gekoppelte Korrekturen abgesichert |
| B1: Gemeinsamer Legacy-Kern | `src/Combat` mit reinem Resolver und gemeinsamem Start-/Policy-Adapter; alte APIs delegieren ohne Balanceänderung | B0 | Alter Resolver und extrahierter Kern liefern gleiche Outputs bei gleichen Inputs; Spieler/NPC starten nicht über divergierende Schutz-/Transitwege |
| B2: Encounter-Persistenz | additive SQL-Migration, Repository, idempotente Reservierung/Ankunft, Ereignisse, terminale Buchung | B1 | NPC-vs-NPC Flotte-vs-Kolonie mit festen Doktrinen, ohne Renderer/LLM; Race/Retry/Crash erzeugt exakt eine Abrechnung |
| B3: Neue Kampfphasen | neuer versionierter Regelsatz, Gruppen, simultane Auflösung, Rückzug, Ziele, Fristen und Catch-up | B2 und Balancingfreigabe | Alle Controllerkombinationen in Domain-Tests; abgeschlossene Phasen unveränderlich; offline identische Ergebnisse |
| B4: Read Model/VFX | `api/battles.php`, SSE-Vertrag, JS-Domain, `BattlePresentation`, Report/HUD/Modelmapping | B3 | NPC-vs-Spieler vertikaler Schnitt mit echten Gruppenständen, echten Verlusten und Reconnect; keinerlei Hero-Schadensmutationen |
| B5: Spieler-/NPC-Befehle | gemeinsame Commands, Overlay, regelbasierter NPC; PvP-Fairness/Offlinefälle | B3; sichtbare Abnahme mit B4 | Human-vs-NPC und Human-vs-Human ändern nur künftige Phasen; identischer Befehlsvertrag; kein Gegnerplan-Leak |
| B6: LLM-Vorschläge | Schema, minimierter Kontext, Queue-Typ, Claim-/Command-Atomizität, Fallback und Audit | B5 | Modell verfügbar/aus/zu spät/ungültig in allen NPC-Kombinationen; kein Doppelauftrag/Doppelschaden |
| B7: Flotte-vs-Flotte | reale Interception, Verstärkungen, zwei Rückwege; Fraktions-/Speziesreisen | B1, B3, B5 | Keine Fake-Kolonie, keine Doppelreservierung, keine QA-Ankunftszeiten; NPC-vs-NPC und PvP end-to-end |
| B8: Rollout | Shadowvergleich, Opt-in, Monitoring, Last-/GPU- und Migrationschecks | B4-B7 | Mehrere Controllerkombinationen mit realer DB; dokumentierter sicherer Rückfall und freigegebene neue Regeln |

Erster zusammenhängender Implementierungsblock: **B0+B1**, nicht direkt
LLM-Prompts oder vollständige Gameplay-Aktivierung. Danach B2 als
rendererunabhängiger NPC-vs-NPC-Integrationstest.

Bereits vorhandene Kernoberflaeche: `src/Combat/BattleResolver.php`.
Weitere geplante Kernoberflächen: `BattleEncounterService.php`, `BattleCommandService.php`,
`BattleEncounterRepository.php`, `BattleObservationBuilder.php`;
LLM-Adapter erst in B6. Bestehende Fleet-/Economy-/Queue-Helfer weiterverwenden.
Keine neue zweite Flottenengine oder allgemeine Eventplattform als Vorbedingung.

## 9. Test- und Freigabematrix

| Bereich | Pflichtfälle |
|---|---|
| Kontrollkombinationen | NPC→Human, Human→NPC, Human→Human, NPC→NPC; Vertauschung der Seiten und keine human-spezifische Voraussetzung im Resolver |
| Bestand/Transaktionen | Null-/einzelne/große Zusammensetzungen, Rundung, keine negativen Bestände, Schiff-/Fracht-Erhaltung, Ankunft doppelt, Rückkehr doppelt, paralleler Start, Fehler vor/nach Event-/Reportwrite |
| Regeln | beide Seiten handeln aus Phasenstart, vernichtete Gruppen feuern ab nächster Phase nicht, Reserven/Schutz/Flanken/Rückzug wirken exakt nach Regelsatz; Patt und Zeitlimit |
| On-demand | ein Catch-up vs. viele Aufrufe, fristgenauer Befehl, verspäteter Befehl, großer Backlog, leerer Worker, keine Simulation durch GET/SSE |
| Berechtigungen | fremde Encounter/Gruppe, gefälschte NPC-ID, PvP deaktiviert, Schutz aktiv, versteckte Ziele, Beobachter, NPC-vs-NPC-Bericht nicht öffentlich |
| Queue/LLM | gültiger Vorschlag, ungültiges JSON, unbekannte Aktion, halluziniertes Ziel, Deadline, veraltete Revision, Claim gestohlen/abgelaufen, Crash zwischen Wirkung/ACK, Retry, Provider aus |
| Renderer | echte IDs/Modelle, HUD zu Aggregaten, bewegte Mündung, Schild 0, Zerstörung, Wellen aus realen Ankünften, reduced motion, versteckter Tab, Reconnect/Duplikate/Lücken, mehrere Encounters |
| Kompatibilität | Legacy-Berichte und SSE, Vorschau/Matchup-Scan, Economy/Transit, Achievements/Quests/Diplomatie, QA und archivierte Videos unverändert |

Vorhandene Tests als Ausgangspunkt:
[FleetReadSideEffectsTest](../../tests/Unit/FleetReadSideEffectsTest.php),
[FleetTrajectoryTest](../../tests/Unit/FleetTrajectoryTest.php),
[NpcAiDecisionQueueTest](../../tests/Unit/NpcAiDecisionQueueTest.php),
[NpcSimulationTickScopeTest](../../tests/Unit/NpcSimulationTickScopeTest.php),
[PirateRaidSimulationTickTest](../../tests/Unit/PirateRaidSimulationTickTest.php),
[VFX-Lifecycle](../../tests/js/combat-vfx-lifecycle.test.js),
[Konvoi-QA](../../tests/webgpu/hero-convoy.test.js).

Neue Domain-/DB-Tests unter `tests/Unit` und `tests/Integration` gemäß
[PHPUnit-Konfiguration](../../phpunit.xml). Kleinste betroffene Suite zuerst,
dann PHPStan/PHPCS und JS-Tests/ESLint/Vite; echte DB-/WebGPU-Abnahme nach
Integration. Kein Headless-GPU-Skip als erfolgreichen Hardwaretest ausgeben.

Messbare Abnahmen:

- Zero Doppelbuchungen und Event-/Reportduplikate in konkurrierenden Tests.
- Gleiche versionierte Inputs und angenommene Befehle ergeben gleiches Ergebnis.
- Invalides/abgelaufenes LLM-Ergebnis verändert den Encounter nie.
- Jeder angenommene Befehl erhält dokumentierte Gültigkeitsphase.
- VFX bleiben innerhalb der vorhandenen globalen Hardcaps; tatsächliche
  GPU-/CPU-Zeit auf benannter Referenzhardware messen. Das QA-Video ist
  kein zertifizierter Performancebeleg für 128 Schiffe oder Multiplayer.

## 10. Einführung und offene Entscheidungen

Neuen Encounter-Regelsatz zunächst standardmäßig deaktivieren; bestehende
Angriffe laufen weiter über die bisherige Regelversion. Shadowmodus schreibt
keine realen Verluste/Beute. Erst isolierte NPC-vs-NPC-Tests, dann opt-in PvE,
anschließend opt-in PvP. LLM bleibt separat abschaltbar.

Rollback betrifft **neue** Encounter. Laufende neue Schlachten müssen mit
ihrem gespeicherten Regelsatz beendet werden; nicht mitten im Kampf in den
Legacy-Resolver schicken. Additive Tabellen und historische Berichte erhalten.

Vor B3/B7/B8 explizit entscheiden:

1. Phasendauer, maximaler Gefechtszeitraum und Vorlauf für menschliche Befehle.
2. Ziel-/Rückzugs-/Flankenregeln einschließlich Kosten und Standarddoktrinen.
3. Zeitpunkte der Schutz-/PvP-Prüfung und Policy für unterwegs geänderten Schutz.
4. Wann Flotte-vs-Flotte ausgelöst wird und welche Verstärkungen beitreten dürfen.
5. NPC-Kriegsfreigabe, begrenzte Aggression und LLM-Budgets.
6. Beobachter-/Allianzsicht und die Auslöser für unbeobachtete NPC-vs-NPC-Arbeit.

Diese Punkte sind keine stillschweigenden Produktiventscheidungen.
Der erste Block kann ohne Vorwegnahme dieser Balancefragen starten.
