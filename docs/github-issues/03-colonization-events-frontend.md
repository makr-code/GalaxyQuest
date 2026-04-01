# [FEATURE] Kolonisierungssystem – Phase D+E: Events, Edikte & Frontend

**Labels:** `feature`, `frontend`, `ui`, `colonization`  
**Milestone:** Kolonisierungssystem v1.0  
**Referenz:** `docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md` – Kapitel 11–13 & 16 Phase D+E  
**Abhängigkeit:** Issue #01 und #02 müssen abgeschlossen sein

---

## Zusammenfassung

Ereignis-Definitionen, Edikt-System und alle Frontend-Komponenten des Kolonisierungssystems: `EmpireStatusBar`, `SectorManagerController`, `FactionDashboardController`, erweiterter `ColonyViewController` und Colony-Gründungs-Wizard.

---

## Akzeptanzkriterien – Phase D: Events & Edikte

### EventSystem-Erweiterungen (`js/engine/game/EventSystem.js`)

- [ ] Neue Journal-Einträge via `defineJournalEntry()`:

  | ID | Titel | Auslöser | Konsequenz |
  |----|-------|----------|-----------|
  | `sprawl_strained` | „Verwaltungskapazität überdehnt" | Sprawl > 120 % AdminCap | Options: Edikt erlassen / Sektor-Autonomie erhöhen |
  | `sprawl_crisis` | „Imperiumskrise: Überdehnung kritisch" | Sprawl > 150 % | Options: Kolonie aufgeben / Vasall anbieten |
  | `faction_protest` | „Protestwelle: [Fraktion] unzufrieden" | Tension > 50 für eine Fraktion | Options: Edikt erlassen / ignorieren |
  | `faction_strike` | „Streik in Kolonie [Name]" | Tension > 70 | Fabrik-Output −20 % für 10 Ticks |
  | `governor_assassination` | „Gouverneur ermordet" | Tension > 85 (Zufalls-Trigger) | Sektor ohne Gouverneur für 30 Ticks |
  | `civil_war_warning` | „Bürgerkrieg droht" | GlobalTension > 95 | Options: Notstand ausrufen / Konzessionen |
  | `colony_phase_up` | „[Kolonie] wird zur Siedlung" | `colony:phase_up`-Event | Happiness +10 für 30 Ticks |
  | `pioneer_spirit` | „Pioniergeist: Kolonie [Name] wächst" | Phase 2 erreicht | +10 Pops sofort, Happiness +20/30 Ticks |
  | `resource_discovery` | „Rohstoff-Entdeckung auf [Kolonie]" | 5 %-Zufallschance/100 Ticks ab Phase 1 | +2 Ore/Food/Research permanent |

- [ ] Krisen-Situations-Framework (Stufe I–IV):
  - `CRISIS_STAGE_I` (Tension 30–50): Protestevents, UI-Warnung
  - `CRISIS_STAGE_II` (Tension 51–70): Streiks, Produktionsverlust
  - `CRISIS_STAGE_III` (Tension 71–85): Attentat-Risiko, Gouverneur-Events
  - `CRISIS_STAGE_IV` (Tension 86–100): Bürgerkriegs-Situation, Rebellionsflotten

### Edikte (5 Empire-Edikte)

Implementiert via `api/colonization.php?action=activate_edict`:

| Edikt-Typ | Kosten/Tick | Effekt | Faction-Bonus |
|-----------|-------------|--------|---------------|
| `ADMINISTRATIVE` | 50 Credits | +15 AdminCap | Konservative +5 Satisfaction |
| `MILITARY_BUILDUP` | 80 Credits | +10 % Fleet Power | Expansionisten +5 Satisfaction |
| `SCIENCE_DRIVE` | 60 Credits | +15 % Research Speed | Progressisten +5 Satisfaction |
| `EXPANSION_MANDATE` | 40 Credits | Colony Ship −20 % Build Time | Expansionisten +8 Satisfaction |
| `STABILITY_PROTOCOLS` | 70 Credits | Tension −5 / Tick, +10 Happiness | Konservative +8, Expansionisten −3 |

---

## Akzeptanzkriterien – Phase E: Frontend-UI (`js/game.js`)

Alle Komponenten verwenden den bestehenden **GQUI-Fluent-Builder** (`window.GQUI`). Kein `innerHTML`.

### EmpireStatusBar

- [ ] Kompakte Sprawl-Anzeige in der Hauptnavigation (Header-Bereich):
  - Sprawl-Wert / AdminCap (z.B. `47 / 50`)
  - Farbiger Fortschrittsbalken: Grün (≤100 %), Gelb (101–150 %), Rot (>150 %)
  - Klick öffnet Sprawl-Detailpanel
  - Pulsieren-Animation bei Sprawl > 150 %
- [ ] Aktualisierung via `GET api/colonization.php?action=sprawl_status`

### SectorManagerController

- [ ] Schwebendes Fenster (WindowManager-Integration), aufrufbar via Menüpunkt „Sektoren"
- [ ] Sektorliste: Name, Gouverneur, Autonomie-Stufe, Approval-Rating, Steuerertrag
- [ ] Aktionen pro Sektor: Autonomie setzen, Gouverneur zuweisen, Hauptstadt wechseln
- [ ] Neuen Sektor erstellen: Name + initiale Systeme auswählen (Galaxy-Map-Picker)
- [ ] Verwaltungskapazitäts-Zusammenfassung unten: Total AdminCap, Beiträge je Sektor

### FactionDashboardController

- [ ] Panel mit drei Fraktions-Karten (Expansionisten / Konservative / Progressisten):
  - Tensions-Balken (0–100, farbkodiert)
  - Satisfaction vs. Dissatisfaction-Werte
  - Aktueller Krisen-Stufe-Indikator (I–IV)
  - „Beruhigen"-Aktionsbutton (öffnet Edikt-Auswahl)
- [ ] Aktualisierung via `GET api/colonization.php?action=faction_tensions`

### ColonyViewController – Erweiterungen

- [ ] Neuer **„Distrikte"**-Tab neben bestehenden Tabs:
  - Zeigt 5 Distrikt-Slots (anfangs gesperrt, ab Phase 2 verfügbar)
  - Distrikt-Typen auswählbar (Industrial / Agricultural / Research / Urban)
  - Slot-Bau-Animation
- [ ] **Phase-Indikator** in Colony-Header: Phasenname + Progress zu nächster Phase
- [ ] **Energie-Balance-Anzeige**: Icon ⚡ + aktueller Wert (positiv grün, negativ rot)
- [ ] **Strata-Anzeige**: Bevölkerungsschichten-Übersicht (wie im EconomySimulation-System)
- [ ] Aktualisierung via `GET api/colonization.php?action=colony_detail&colony_id=X`

### Colony-Gründungs-Wizard

- [ ] Mehrstufiger Modal-Dialog (4 Schritte):
  1. **System auswählen** – zeigt verfügbare gescannte Systeme mit Ressourcen-Vorschau
  2. **Kolonietyp wählen** – 6 Basis-Typen mit Vor-/Nachteilen
  3. **Sektor zuordnen** – bestehenden Sektor wählen oder neuen erstellen
  4. **Bestätigung** – Kosten-Übersicht (200 Prod + 100 Credits + 50 Food), Sprawl-Vorschau
- [ ] „Zurück"-Navigation zwischen Schritten
- [ ] Sprawl-Warnung wenn Founding Sprawl > 160 % AdminCap erhöhen würde
- [ ] POST `api/colonization.php?action=found_colony` bei Bestätigung

### Sprawl-Heatmap (`js/galaxy-renderer-core.js`)

- [ ] Neue Overlay-Schicht `sprawl_heatmap`:
  - Systeme werden eingefärbt nach Sprawl-Beitrag (Blau → Gelb → Rot)
  - Toggle via `setOverlay('sprawl_heatmap', true/false)`
  - Sektor-Grenzen als gestrichelte Linien einblenden
- [ ] Integration in bestehende Overlay-Infrastruktur (`setFtlInfrastructure`-Pattern)

---

## Technische Hinweise

- GQUI-API: `GQUI.div()`, `GQUI.btn()`, `GQUI.span()`, `GQUI.input()` – kein `innerHTML`
- WindowManager für schwebende Panels verwenden (wie ShipyardController)
- Sprawl-Update-Intervall: alle 10 Sekunden (kein Live-Polling)

---

## Playwright-Integrationstests

- [ ] `tests/e2e/colonization-wizard.spec.js`:
  - `testWizardAllSteps()` – alle 4 Schritte durchlaufen
  - `testWizardSprawlWarning()` – Warnung erscheint bei 162 % Sprawl
  - `testWizardCancel()` – kein Zustand verändert

---

## Estimate

**~1.5 Wochen** (Events ~1 Woche + Frontend ~2 Wochen, parallel möglich)
