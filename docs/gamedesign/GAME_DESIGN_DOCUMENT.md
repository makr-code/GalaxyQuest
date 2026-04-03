# GalaxyQuest — Game Design Document

Version: 1.0  
Status: Produktionsreife Design-Basis  
Datum: 2026-04-02  
Genre: Persistent 4X Space Strategy (Browser + Live-Backend)

---

## 1. Vision

GalaxyQuest ist ein langfristiges 4X-Strategiespiel, in dem Spieler ein Sternenreich aufbauen, wirtschaftlich absichern, diplomatisch positionieren und militärisch behaupten. Die Kernfantasie lautet:

- Ich beginne mit einer Kolonie und forme daraus ein Imperium.
- Jede Entscheidung hat sichtbare Folgen in Wirtschaft, Stabilität, Forschung und Konflikt.
- Das Universum lebt weiter, auch wenn ich offline bin.

Designziel ist ein System, das tief genug für Experten ist, aber durch klare UI-Signale und handlungsorientierte Empfehlungen auch für neue Spieler steuerbar bleibt.

---

## 2. Design-Prinzipien

1. Transparenz vor Komplexität
- Zahlen, Zustände und Konsequenzen müssen nachvollziehbar sein.
- Kritische Risiken werden proaktiv angezeigt.

2. Entscheidungen mit Trade-offs
- Jedes Wachstum erzeugt neue Engpässe (Energie, Nahrung, Logistik, Sicherheit).
- Es gibt keine universell beste Build-Order.

3. Makro vor Mikromanagement
- Der Spieler trifft Richtungsentscheidungen, nicht jeden Tick.
- Quick-Actions, Automationshilfen und Vorschauen reduzieren Klicklast.

4. Emergenz vor Skript
- Factions, Events, Diplomatie und Kriege erzeugen dynamische Geschichten.
- Systeme greifen ineinander statt isoliert zu funktionieren.

5. Live-Game-Tauglichkeit
- Skalierbare Serverlogik, robuste API-Verträge, telemetry-fähige Balance.
- Iterative Erweiterbarkeit ohne harte Rewrites.

---

## 3. Zielgruppen

Primary:
- Spieler von Stellaris, X4, Victoria 3, OGame, Anno-Ökonomie-Style.
- Motivation: Planung, Optimierung, Aufbau, Diplomatie, langfristiger Fortschritt.

Secondary:
- Gelegenheitsspieler mit Fokus auf "kurze Sessions, dauerhafter Fortschritt".

---

## 4. Core Gameplay Loop

1. Sammeln und Stabilisieren
- Ressourcenfluss sichern (Metal, Crystal, Deuterium, Food, Energy).

2. Ausbauen und Spezialisieren
- Kolonien in Rollen entwickeln (Mining, Industrial, Research, Military, Balanced).

3. Forschen und Freischalten
- Systeme, Schiffe, Upgrades, Infrastruktur und politische Optionen erweitern.

4. Interagieren
- Handel, Diplomatie, Fraktionen, Allianzen, Konflikte.

5. Dominieren oder Absichern
- Expansion, Verteidigung, Krieg, Einflusszonen, Siegpfade.

Meta-Loop:
- Neue Tools erzeugen neue Optimierungsräume und neue strategische Risiken.

---

## 5. Spielsysteme

### 5.1 Kolonie- und Bausystem

- Kolonie besitzt Kapazitäten, Population, Happiness, Public Services und Event-Kontext.
- Gebäude definieren Produktionsraten, Kosten, Upgrade-Pfade, Spezialeffekte.
- Zentrale Balanceachsen:
  - Energieunterdeckung reduziert Effektivität.
  - Nahrungsmangel destabilisiert Wachstum.
  - Überfüllte Lager blockieren Wertschöpfung.

Erwarteter Spielerzustand:
- Frühes Spiel: Kapazität und Grundversorgung.
- Midgame: Spezialisierung und Netzwerkoptimierung.
- Lategame: Synergie, Redundanz, Kriegswirtschaft.

### 5.2 Wirtschafts- und Flusssystem

- Wirtschaft ist ein Flussmodell: Quellen, Senken, Puffer, Transport.
- Jede Ressource braucht:
  - Produktionsquellen (Gebäude, Events, Boni).
  - Verbrauchssenken (Population, Infrastruktur, Flotten, Bau).
  - Speicher und Transferpfade (lokal/galaktisch).

UI-Ziel:
- Zustand in 3 Sekunden erfassbar:
  - Wo produziere ich?
  - Wo verliere ich?
  - Welche Kolonie ist Flaschenhals?

### 5.3 Forschung und Technologie

- Forschung dient als Strukturgeber für mittelfristige Ziele.
- Unlocks beeinflussen Wirtschaft, Militär, Mobilität, Diplomatie.
- Forschungsentscheidungen sind Build-definierend, nicht nur lineare Power-Steigerung.

### 5.4 Flotten, Bewegung und Krieg

- Flotten sind mobile Machtprojektion (Angriff, Verteidigung, Transport, Spy, Colonize, Harvest).
- FTL-Logik erzeugt räumliche Identität und strategische Distanzkosten.
- Kriegssystem verbindet taktische Gefechte mit strategischer Erschöpfung.

### 5.5 Diplomatie, Fraktionen und Politik

- Beziehungen verändern Handel, Sicherheit, Zugänge und Eskalationskosten.
- Fraktionsidentitäten schaffen asymmetrische Spielstile.
- Politik wirkt als Multiplikator auf Wirtschaft und Konfliktrisiko.

### 5.6 Event- und Situationssystem

- Events sind nicht nur Flavor, sondern echte Entscheidungsstressoren.
- Situationen bündeln mehrere Signale in priorisierte Handlungsempfehlungen.
- Ziel: Relevante Spannung statt Notification-Spam.

---

## 6. UX- und Informationsdesign

Designrichtlinien:

1. Zustand statt Rohzahl
- Beispiel: GROWING, STABLE, DECLINING, CRISIS.

2. Proaktive Warnungen
- Risiken werden vor dem Schadenseintritt sichtbar.

3. Vorschau vor Commitment
- Upgrades, Bauentscheidungen und strategische Aktionen zeigen Impact vor Bestätigung.

4. Actionability
- Jede Warnung sollte eine direkte Folgetaste besitzen (Fix, Fokus, Auto +1, Markt, Transport).

5. Hierarchie
- Globales Lagebild -> Kolonie-Detail -> Gebäude-/Flotten-Mikroebene.

---

## 7. Progression und Retention

Kurzfristig (Session):
- Sichtbarer Fortschritt durch Upgrades, Queues, kleine Risiken, unmittelbare Lösungen.

Mittelfristig (Tage/Wochen):
- Technologische Sprünge, neue Rollen je Kolonie, Handels-/Sicherheitsnetz.

Langfristig (Monate):
- Imperiumsidentität, geopolitische Position, Allianz-/Kriegsresultate, Prestigeziele.

Retention-Treiber:
- Offline-Fortschritt mit sinnvollen Zusammenfassungen.
- Daily-relevante Entscheidungen statt Pflicht-Klicks.
- Ereignisse, die Planung belohnen, nicht nur Reaktionszeit.

---

## 8. Balancing-Rahmen

Primäre Balancing-Metriken:

- Resource Sustainability Ratio pro Ressource
- Colony Crisis Frequency
- Upgrade ROI Window
- Time-to-Recovery nach Defizit
- Kriegskosten vs. Beute
- APM-Belastung pro Fortschrittseinheit

Balancing-Regeln:

- Keine Hardlocks ohne Gegenmaßnahme.
- Defizite sollen spürbar, aber reversibel sein.
- "Gewinnen" über einen Kanal muss Gegenkosten in einem anderen erzeugen.

---

## 9. Content-Strategie

Content-Säulen:

1. Wirtschaftscontent
- Neue Gebäude, Produktionsmethoden, Wirtschaftsereignisse.

2. Strategischer Content
- FTL-Varianten, Handelsrouten, Konfliktziele, Fraktionsdiplomatie.

3. Narrative Systems
- Eventketten, Geheimnisse, Sektorstorys, Entscheidungskonsequenzen.

4. Competitive/Ladder Content
- Saisonziele, soft resets, Meta-Challenges, Allianz-Wertungen.

---

## 10. Technische Produktziele

- Serverautoritatives Simulationsmodell.
- API-First-Featureentwicklung mit klaren Action-Contracts.
- UI-Komponenten müssen inkrementell erweiterbar bleiben.
- Testbarkeit:
  - API-Smoke
  - System-Smoke
  - Regressionssuite
- Telemetrie zur Balance-Validierung im Live-Betrieb.

---

## 11. Roadmap (Designseitig)

Phase 1: Clarity Layer (fertig/nahe fertig)
- Proaktive Warnungen
- Upgrade-Previews
- Bessere Zustandsdarstellung

Phase 2: Economic Clarity
- Wirtschaftsfluss-Ansichten
- Flaschenhalsdiagnostik
- Transfer-/Markt-Empfehlungen

Phase 3: Command Layer
- Situations-Dashboard
- Timeline/Scheduling
- Prioritäts- und Deadline-Management

Phase 4: Strategic Depth
- Erweiterte Kriegsziele
- Diplomatische Sanktionen/Boni
- Fraktionsspezifische asymmetrische Mechaniken

Phase 5: Live Operations
- Saisonmodell
- Meta-Progression
- Eventbetrieb und content cadence

---

## 12. Erfolgskriterien

Produktziele:

- Spieler erkennen Hauptprobleme ohne externe Tools.
- Entscheidungspfad von Signal -> Aktion <= 2 Interaktionen.
- Wirtschaftliche Defizite sind früh sichtbar und sinnvoll lösbar.
- Mid-/Lategame bleibt strategisch statt rein numerisch.

Metrikziele (Beispiel):

- +20% Session-zu-Session Rückkehr im Midgame.
- -30% Abbruchrate nach Defizitspitzen.
- +15% Nutzung strategischer Systeme (Trade, Fleet-Orders, Diplomatie).

---

## 13. Risiken und Gegenmaßnahmen

1. Feature-Überladung
- Gegenmaßnahme: progressive Freischaltung, klare Prioritäts-UI.

2. Balance-Instabilität
- Gegenmaßnahme: telemetry-basierte Tuning-Zyklen, konservative Defaults.

3. UI-Komplexität
- Gegenmaßnahme: einheitliche Muster (Panels, Warnungen, Preview, Quick Actions).

4. Micromanagement-Spirale
- Gegenmaßnahme: Automationsoptionen mit transparenten Regeln.

---

## 14. Fazit

GalaxyQuest sollte sich wie ein lebendiges Imperiums-Simulationsspiel anfühlen: strategisch tief, aber operativ klar. Das Design priorisiert sichtbare Kausalität, handlungsorientierte UX und systemische Verzahnung. Damit entsteht ein Spiel, das sowohl für Planer als auch für Story-getriebene Spieler langfristig tragfähig ist.
