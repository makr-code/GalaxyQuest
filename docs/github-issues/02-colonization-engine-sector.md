# [FEATURE] Kolonisierungssystem – Phase B+C: ColonySimulation & SectorSimulation

**Labels:** `feature`, `frontend`, `engine`, `colonization`  
**Milestone:** Kolonisierungssystem v1.0  
**Referenz:** `docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md` – Kapitel 5–10 & 16 Phase B+C  
**Abhängigkeit:** Issue #01 (DB & Backend) muss abgeschlossen sein

---

## Zusammenfassung

Erweiterung von `js/engine/game/ColonySimulation.js` um Energy-Ressource, Wachstumsphasen, neue Gebäudetypen und Bevölkerungsschichten (Strata). Neues Modul `js/engine/game/SectorSimulation.js` für Sektor-Verwaltung und AdminCap-Beiträge.

---

## Akzeptanzkriterien – Phase B: ColonySimulation-Erweiterungen

### Neue Konstanten & Enums

- [ ] `BuildingType`-Enum um folgende Typen erweitern:
  - `SOLAR_ARRAY` – +3 Energy, 25 Prod + 3 Ticks, ab Phase 1
  - `WATER_PROCESSOR` – −10 % Hunger-Rate, 30 Prod + 10 Ore, ab Phase 1
  - `ENERGY_GRID` – +5 Energy, +10 % Produktionsbonus wenn Energie positiv, Phase 2
  - `INSTITUTE` – +15 Research + Anomaly-Chance, 100 Prod + 50 Credits, Phase 3 (benötigt 2× LAB)
  - `SENATE_CHAMBER` – +10 AdminCap, 80 Prod + 40 Credits, Phase 3
  - `PLEASURE_DOME` – +15 Happiness, −5 GlobalTension, Phase 2
  - `IMMIGRATION_CENTER` – +20 % Pop-Growth, Phase 2
  - `XENOBIOLOGY_LAB` – +5 Research + Fertility-Info, Phase 2
  - `REFINERY` – +2× Metal-Konversion, Phase 2 (benötigt FACTORY)
  - `SHIPYARD_COMPLEX` – +20 % Schiffbaugeschwindigkeit, Phase 3 (benötigt SPACEPORT)
  - `ORBITAL_STATION` – +8 Defence + Flottenstützpunkt, Phase 3
  - `DISTRICT_INDUSTRIAL`, `DISTRICT_AGRICULTURAL`, `DISTRICT_RESEARCH`, `DISTRICT_URBAN` – je 20 Prod, 3 Ticks

- [ ] `ColonyType`-Enum um folgende Typen erweitern (zusätzlich zu bestehenden 6):
  - `FORGE_WORLD` – +3× Metal-Output, 0.5× Pop-Growth
  - `GARDEN_WORLD` – +3× Food, +20 % Fertility
  - `ECUMENOPOLIS` – +5× Credits, 2× Pop-Kapazität, −50 % Nahrungseffizienz
  - `RING_WORLD` – +10× alle Outputs (Endgame-Typ, extrem teuer)

- [ ] `COLONY_PHASE`-Enum einführen:
  ```js
  export const COLONY_PHASE = { OUTPOST: 0, SETTLEMENT: 1, COLONY: 2, DEVELOPED: 3, CORE: 4 };
  ```
  Phase-Übergänge basieren auf Bevölkerungs-Schwellenwerten: 500 / 2000 / 8000 / 25000 Pops

- [ ] `COLONIZATION_CONFIG`-Objekt als zentrale Konfigurations-Quelle:
  ```js
  export const COLONIZATION_CONFIG = {
    BASE_ADMIN_CAP: 50,
    SYSTEM_SPRAWL: 1.0,
    COLONY_SPRAWL: 0.5,
    FLEET_SPRAWL: 0.3,
    SPRAWL_STRAINED: 1.01,
    SPRAWL_OVERSTRETCHED: 1.21,
    SPRAWL_CRISIS: 1.51,
    SPRAWL_DISSOLUTION: 2.01,
    // ... alle 20+ Konstanten aus Design-Dokument
  };
  ```

### Colony-Klasse – Erweiterungen

- [ ] `Colony`-Klasse um `energyBalance`, `phase`, `sectorId` erweitern
- [ ] `Colony.computeYield()` um `energyBalance`-Berechnung erweitern (SOLAR_ARRAY/ENERGY_GRID)
- [ ] `Colony.maxBuildingSlots` dynamisch: `phase × 3 + floor(size / 3)`
- [ ] `Colony.advancePhase()` – Phasen-Aufstieg bei Pop-Schwelle auslösen, `colony:phase_up`-Event feuern
- [ ] `Colony.serialize()` / `Colony.fromSnapshot()` um neue Felder erweitern

### ColonySimulation – Erweiterungen

- [ ] `ColonySimulation.tick()` – Sprawl-Malus-Anwendung (aus `opts.sprawlMalus`):
  - `resource_output_mult` auf alle Colony-Yields anwenden
  - Bei Malus > 0.30: Zufalls-Unruhe-Event einleiten
- [ ] `ColonySimulation.foundColony(systemId, opts)` – neue Kolonie in Phase 0 erstellen, `colony:founded`-Event
- [ ] `ColonySimulation.setPhase(id, phase)` – Phase manuell setzen (Admin/Test)
- [ ] `COLONY_SHIP`-Eintrag in `BattleSimulator.SHIP_STATS`:
  ```js
  COLONY_SHIP: { hull: 150, shield: 0, attack: 0, speed: 0.6, rapid_fire: {}, size: 'large' }
  ```

### Tests

- [ ] Vitest-Tests in `tests/js/colony-simulation-extended.test.js`:
  - `testPhaseAdvancement()` – Pop-Schwelle löst Phase-Up aus
  - `testEnergyBalance()` – SOLAR_ARRAY addiert +3 Energy
  - `testSprawlMalusApplied()` – 130 %-Malus senkt Yield um 15 %
  - `testNewBuildingTypes()` – SENATE_CHAMBER gibt +10 AdminCap
  - `testColonyShipInBattleSimulator()` – COLONY_SHIP hat attack=0

---

## Akzeptanzkriterien – Phase C: SectorSimulation (neues Modul)

- [ ] `js/engine/game/SectorSimulation.js` erstellen und aus `js/engine/index.js` exportieren:

### Sector-Klasse
```js
class Sector {
  constructor(id, name) { /* id, name, governorId, capitalColonyId, autonomyLevel, taxRate, approvalRating */ }
  calcAdminCapContribution()  // AdminCap-Beitrag basierend auf Autonomie
  calcSprawlReduction()       // Sprawl-Reduktion durch Autonomie (0–40 %)
  tick(colonySnapshots)       // Approval-Rating basierend auf Colony-Happiness
  serialize()
  static fromSnapshot(data)
}
```

### SectorSimulation-Klasse
```js
class SectorSimulation {
  assignGovernor(sectorId, governorId, adminBonus)
  setAutonomy(sectorId, level)     // 0–100, validiert gegen AUTONOMY_STEPS
  calcTotalAdminCap(sectors)       // Σ aller Sektor-Beiträge
  tick(sectors, colonies)          // Approval-Updates, Governor-Effekte
  addSystem(sectorId, systemId)
  removeSystem(sectorId, systemId)
}
```

- [ ] `AUTONOMY_STEPS` – Konstante mit AdminCap-Entlastung und Tax-Rate je Autonomie-Stufe (0/25/50/75/100 %)
- [ ] Vitest-Tests in `tests/js/sector-simulation.test.js`:
  - `testAutonomySprawlReduction()` – 50 % Autonomie → −20 % Sprawl
  - `testGovernorAdminBonus()` – Level-3-Gouverneur → +12 AdminCap
  - `testApprovalTick()` – Happy Colony → Approval +1/Tick

---

## Abhängigkeiten

- Setzt Issue #01 (DB + `api/colonization.php`) voraus
- Blockiert: Issue #03 (Frontend: EmpireStatusBar, SectorManagerController)

---

## Estimate

**~1.5 Wochen** (ColonySimulation ~1 Woche + SectorSimulation ~0.5 Wochen)
