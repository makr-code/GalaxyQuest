# GalaxyQuest — Game Design Document (Economy Focus)

Version: 1.0  
Status: Design-Spezifikation fuer Umsetzung und Balancing  
Datum: 2026-04-02  
Scope: Wirtschafts-Gameplay, Flow-Transparenz, Spielerentscheidungen

---

## 1. Zielbild

Dieses Dokument definiert, wie sich die Wirtschaft in GalaxyQuest anfuehlen und verhalten soll:

- Verstaendlich in wenigen Sekunden
- Tief genug fuer langfristige Optimierung
- Robust gegen Defizit-Spiralen
- Spielrelevant fuer Expansion, Krieg, Diplomatie und Forschung

Der Fokus liegt auf der Frage:
Wie wird aus "Rohstoffe sammeln" ein strategisches Oekosystem aus Quellen, Senken, Pufferung und Logistik?

---

## 2. Design-Ziele

1. Clarity
- Spieler sehen sofort, ob ein Imperium wirtschaftlich stabil oder kritisch ist.

2. Causality
- Jede Veraenderung (Upgrade, Event, Krieg, Trade) muss oekonomisch nachvollziehbar sein.

3. Trade-offs
- Spezialisierung bringt Effizienz, erzeugt aber Abhaengigkeiten.

4. Recovery
- Krisen sind hart, aber immer loesbar durch sichtbare Gegenmassnahmen.

5. Actionability
- Das UI liefert nicht nur Diagnose, sondern direkt passende Aktionen.

---

## 3. Wirtschaftliches Kernmodell

### 3.1 Grundgleichung pro Ressource

$$
\text{Nettofluss} = \text{Produktion} - \text{Verbrauch} + \text{Import} - \text{Export} + \text{Eventeffekte}
$$

Ressourcen sind nur dann "gesund", wenn Nettofluss und Lagerentwicklung zusammen positiv oder kontrolliert stabil sind.

### 3.2 Wirtschaftsebenen

1. Kolonie-Ebene
- Produktionsgebäude, Pop-Bedarf, lokale Lagergrenzen

2. Imperiums-Ebene
- Querschnitt aller Kolonien, Defizitausgleich, Spezialisierungsmatrix

3. Galaktische Ebene
- Handel, Routenrisiko, politische Stoerungen, Kriegsdruck

### 3.3 Wirtschaftszustaende

- SURPLUS: Nachhaltiger Ueberschuss, aktiv nutzbar fuer Wachstum
- BALANCED: Stabil ohne Reserven
- STRAINED: Defizit durch Puffer kaschiert
- CRITICAL: Defizit + schrumpfende Restzeit

---

## 4. Spieler-Loop (Economy)

1. Diagnose
- Wo ist Defizit? Welche Kolonie ist Bottleneck?

2. Entscheidung
- Produktion steigern, Verbrauch senken, transferieren, handeln oder priorisieren

3. Umsetzung
- Upgrade, Queue, Trade, Transport, Policy

4. Kontrolle
- Preview pruefen, Laufzeit und ROI bewerten

5. Iteration
- Nachsteuerung anhand neuer Fluesse und Events

---

## 5. UX-Spezifikation (Economy)

### 5.1 Signalhierarchie

1. Kritische Risiken zuerst
- Energieausfall, Nahrungskrise, Lagerstau

2. Defizit mit Zeitbezug
- "Noch X Stunden bis kritischer Schwelle"

3. Direkte Handlung
- "Fix", "Auto +1", "Transport", "Markt" neben dem Signal

### 5.2 Economy Flow Ansicht (C2)

Die Economy-Flow-Ansicht ist das zentrale Diagnosewerkzeug.

Muss anzeigen:
- Total Production pro Ressource
- Total Consumption pro Ressource
- Empire Balance
- Pro Kolonie: Produktion, Verbrauch, Netto, Lagerstand
- Farbcodierung nach Risiko

Soll zusaetzlich erhalten:
- Top-3 Bottlenecks
- Top-3 Ueberschuesse
- Empfohlene naechste Aktion

### 5.3 Economy Interaction Pattern

- Click auf Kolonie-Zeile springt in Detail-/Build-View
- Click auf Defizit-Hinweis oeffnet passenden Aktionsdialog
- Preview vor jeder kostenrelevanten Entscheidung

---

## 6. Content und Systeme

### 6.1 Ressourcenkategorien

- Basis: Metal, Crystal, Deuterium, Food, Energy
- Strategisch: Rare Earth, Dark Matter
- (Optional Ausbau) Zwischenprodukte fuer spaetere Ketten

### 6.2 Wirtschaftliche Rollen von Kolonien

- Extractor Hub
- Industrial Forge
- Research Core
- Agri-Support
- Military Logistics
- Hybrid/Balanced

Designregel:
Je klarer die Rolle, desto hoeher die Effizienz, aber desto hoeher das Abhaengigkeitsrisiko.

### 6.3 Defizit-Folgen

- Energie-Defizit: Produktionsmalus
- Nahrungs-Defizit: Happiness- und Wachstumsverlust
- Lagerstau: verlorener potenzieller Output
- Dauerdefizit: erhoehte Krisenwahrscheinlichkeit

---

## 7. Entscheidungs-Engine (Empfehlungen)

### 7.1 Prioritaetslogik

Prioritaet A:
- Defizite mit kurzer Time-to-Failure

Prioritaet B:
- Defizite mit hoher Systemwirkung (Energie/Food)

Prioritaet C:
- Effizienzverluste durch Lagerstau oder Overcap

### 7.2 Empfehlungstypen

- Build: "Solar Plant +1"
- Redistribute: "Transport von Kolonie X zu Y"
- Trade: "Buy Food, Sell Crystal"
- Policy: "Temporarily reduce military upkeep"

---

## 8. KPIs fuer Balancing

### 8.1 Spieler-KPIs

- Time to detect crisis
- Time to execute fix
- Crisis recovery time
- Anteil proaktiver statt reaktiver Entscheidungen

### 8.2 System-KPIs

- Deficit Frequency pro Ressource
- Economy Collapse Rate
- Average Empire Balance by phase
- Upgrade ROI Realization Rate

### 8.3 UX-KPIs

- Nutzung Economy Flow View
- Klickrate auf Quick-Actions
- Fehlklick-/Abbruchrate in Wirtschafts-UI

---

## 9. Balancing-Leitplanken

1. Keine unsichtbaren Strafen
- Jeder Malus muss im UI begruendet werden.

2. Kein unaufhaltsamer Todessog
- Mindestens zwei valide Recovery-Pfade pro Krisentyp.

3. ROI muss sinnvoll bleiben
- Spaete Upgrades duerfen teurer, aber nicht gefuehlt sinnlos sein.

4. Defizit darf kurzzeitig legitim sein
- Gezielte Risk-Plays sollen moeglich bleiben.

---

## 10. Implementierungsphasen

Phase E1 (bestehend/nahe):
- Warnings + Upgrade Preview + Economy Flow Basis

Phase E2:
- Top Bottleneck Panel
- Time-to-Failure Prognose
- Aktionsempfehlungen mit Confidence-Score

Phase E3:
- Situation Dashboard (wirtschaftliche Prioritaeten)
- Timeline fuer Defizit- und Queue-Ereignisse

Phase E4:
- Erweiterte Logistik- und Routenintelligenz
- Politische Wirtschaftsmodi

---

## 11. Risiken und Gegenmassnahmen

Risiko: Information Overload
- Gegenmassnahme: Progressive Disclosure (Summary -> Drilldown)

Risiko: Falsche Empfehlungen
- Gegenmassnahme: Empfehlung mit Begruendung + Alternativen

Risiko: Reine Spreadsheet-Wirkung
- Gegenmassnahme: Visuelle Fluesse, Zustandslabels, klare Narrativ-Events

Risiko: Meta kippt in einen dominanten Build
- Gegenmassnahme: Patchbare Koeffizienten + Telemetrie

---

## 12. Abnahmekriterien

Funktional:
- Spieler kann Defizitursache in <= 10 Sekunden identifizieren
- Spieler kann aus der Diagnoseansicht direkt handeln

Qualitativ:
- Entscheidungen fuehlen sich strategisch statt administrativ an
- Wirtschaft ist stabilisierbar ohne externe Tabellen

Messbar:
- Sinkende Defizitabbrueche
- Steigende Nutzung von Preview- und Flow-Ansichten
- Hoehere Session-Retention im Midgame

---

## 13. Kurzfazit

Die Wirtschaftsvision von GalaxyQuest ist ein strategisches Flussmodell mit klaren Signalen, harten Trade-offs und direkter Handlungsfaehigkeit. Das System soll nicht nur korrekt rechnen, sondern den Spieler aktiv zu besseren Entscheidungen fuehren.
