# 🤝 GalaxyQuest Traders System — Integration & Implementierung

## Status: In Bearbeitung (Phase E2-E3)

**Version:** 2.0  
**Ziel:** Vollständige Funktionsfähigkeit autonomer NPC-Trader mit Supply/Demand-gesteuerten Handelsrouten

---

## 1. Architektur-Übersicht

### System-Komponenten

```
┌─────────────────────────────────────────────────────────────┐
│ Market Supply/Demand Generator                               │
│ (berechnet Angebot/Nachfrage pro System & Kolonie)          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Trade Opportunity Analyzer                                   │
│ (findet profitable Handelsrouten: Preis-Differenzen)        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ NPC Trader Fleet Manager                                     │
│ (startet Flotten, verwaltet Routen, Lieferungen)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Market Price Adjustment                                      │
│ (Supply/Demand aktualisieren nach Transaktionen)            │
└─────────────────────────────────────────────────────────────┘
```

### Datenflow

```
1. Jede Kolonie produziert + konsumiert → Supply/Demand
2. System aggregiert lokale Supply/Demand
3. Preis = Basis × (Demand/Supply)^0.4 → Price Signals
4. NPC-Trader erkennen Arbitrage-Chancen
5. Trader startet Fleet zu günstiger Quelle
6. Trader kauft dort + liefert zu teurer Destination
7. Markt-Preise passen sich an → Opportunity verschwindet
```

---

## 2. Datenbank-Struktur (neu/erweitert)

### Neue Tabellen

#### `npc_traders` — Trader-Entitäten (Fraktions-Handelsunternehmen)

```sql
CREATE TABLE npc_traders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    faction_id      INT NOT NULL,
    name            VARCHAR(64) NOT NULL,
    user_id         INT NOT NULL,    -- NPC-Benutzer, der die Trader-Flotte steuert
    base_colony_id  INT NOT NULL,    -- Heimatkolonie/Depot
    capital_credits DECIMAL(16,2) NOT NULL DEFAULT 50000,
    
    -- Handelsstatistiken
    total_profit    DECIMAL(16,2) NOT NULL DEFAULT 0,
    active_fleets   INT UNSIGNED NOT NULL DEFAULT 0,
    max_fleets      INT UNSIGNED NOT NULL DEFAULT 3,
    
    -- Handels-Strategie
    strategy        ENUM('profit_max', 'volume', 'stabilize') NOT NULL DEFAULT 'profit_max',
    specialization  VARCHAR(32) DEFAULT NULL,  -- z.B. 'metal', 'luxury'
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (base_colony_id) REFERENCES colonies(id),
    INDEX idx_faction (faction_id),
    INDEX idx_active_fleets (active_fleets)
) ENGINE=InnoDB;
```

#### `trade_opportunities` — Erkannte profitable Routen

```sql
CREATE TABLE trade_opportunities (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    source_system   INT NOT NULL,
    target_system   INT NOT NULL,
    resource_type   VARCHAR(32) NOT NULL,
    
    source_price    DECIMAL(10,4) NOT NULL,
    target_price    DECIMAL(10,4) NOT NULL,
    profit_margin   DECIMAL(5,2) NOT NULL,  -- Prozent
    available_qty   DECIMAL(12,2) NOT NULL, -- verfügbar an Quelle
    
    demand_qty      DECIMAL(12,2) NOT NULL, -- nachgefragt am Ziel
    
    -- Chance (wie lange bleibt Route profitabel?)
    confidence      DECIMAL(4,3) NOT NULL,  -- 0-1.0
    expires_at      DATETIME NOT NULL,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_profit_margin (profit_margin DESC),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB;
```

#### `trader_routes` — Aktive Trader-Routen

```sql
CREATE TABLE trader_routes (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    trader_id       INT NOT NULL,
    fleet_id        INT NOT NULL,          -- Zugewiesene Flotte
    
    source_colony_id    INT NOT NULL,
    target_colony_id    INT NOT NULL,
    resource_type       VARCHAR(32) NOT NULL,
    quantity_planned    DECIMAL(12,2) NOT NULL,
    quantity_acquired   DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    status          ENUM('planning', 'acquiring', 'transit', 'delivering', 'completed') 
                    NOT NULL DEFAULT 'planning',
    
    price_paid      DECIMAL(10,4) NOT NULL DEFAULT 0,
    price_target    DECIMAL(10,4) NOT NULL DEFAULT 0,
    expected_profit DECIMAL(16,2) NOT NULL DEFAULT 0,
    actual_profit   DECIMAL(16,2) DEFAULT NULL,
    
    departure_at    DATETIME,
    arrival_at      DATETIME,
    delivered_at    DATETIME,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trader_id) REFERENCES npc_traders(id) ON DELETE CASCADE,
    FOREIGN KEY (fleet_id) REFERENCES fleets(id),
    FOREIGN KEY (source_colony_id) REFERENCES colonies(id),
    FOREIGN KEY (target_colony_id) REFERENCES colonies(id),
    INDEX idx_trader_status (trader_id, status),
    INDEX idx_fleet (fleet_id)
) ENGINE=InnoDB;
```

#### `market_supply_demand` — Lokale Angebot/Nachfrage pro System

```sql
CREATE TABLE market_supply_demand (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    system_index    INT NOT NULL,
    resource_type   VARCHAR(32) NOT NULL,
    
    -- Lokale Produktion diese Stunde (Units)
    production      DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Lokaler Verbrauch (Units)
    consumption     DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Verfügbar zum Verkauf (Lager)
    available_sell  DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Nachgefragt zum Kauf (Bedarf)
    desired_buy     DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Resultat
    net_balance     DECIMAL(16,2) NOT NULL DEFAULT 0,  -- verfügbar oder fehlend
    
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    PRIMARY KEY (system_index, resource_type),
    INDEX idx_updated (updated_at)
) ENGINE=InnoDB;
```

---

## 3. Backend-API-Erweiterungen

### Datei: `api/traders.php`

Neue REST-Endpoints:

```
GET  /api/traders.php?action=list_traders        → Liste aller Trader + Statistiken
GET  /api/traders.php?action=list_opportunities  → Verfügbare Handels-Chancen
GET  /api/traders.php?action=list_routes         → Aktive Trader-Routen
GET  /api/traders.php?action=market_analysis&system=1  → Supply/Demand eines Systems

POST /api/traders.php?action=create_trader       → Neuen Trader starten
POST /api/traders.php?action=start_route         → Neue Handelsroute initiieren
POST /api/traders.php?action=cancel_route        → Laufende Route abbrechen

-- Admin/Debug:
POST /api/traders.php?action=regenerate_opportunities  → Chancen neu berechnen
POST /api/traders.php?action=process_tick        → Tick-basierte Verarbeitung
```

### Datei: `api/market_analysis.php` (neu)

Supply/Demand-Berechnung:

```php
/**
 * Aggregiere lokale Production + Consumption pro System
 * Basis: Colony Output-Logs der letzten Stunde
 */
function calculate_system_supply_demand($db, int $system_index): array
{
    // 1. Sammle alle Kolonien im System
    // 2. Pro Kolonie: Produktion - Verbrauch = lokale Bilanz
    // 3. Aggregiere: Supply/Demand pro Ressource
    // 4. Speichere in market_supply_demand
}

/**
 * Erkenne profitable Arbitrage-Chancen
 * = Quell-Preis < Ziel-Preis − Transportkosten
 */
function find_trade_opportunities($db): array
{
    // 1. Lade alle Systeme mit Supply/Demand
    // 2. Pro Ressourcen-Typ:
    //    - Finde Systeme mit Überangebot (Seller)
    //    - Finde Systeme mit Nachfrage (Buyer)
    // 3. Berechne Profit = (Ziel-Preis - Quell-Preis) * Menge - Transportkosten
    // 4. Aktualisiere trade_opportunities mit Ranking
}

/**
 * NPC-Trader: Führe regelmäßig Transaktionen aus
 */
function execute_trader_tick($db): void
{
    // 1. Pro aktiver Trader-Route:
    //    - Update Fleet-Status
    //    - Bei Ankunft an Quelle: Kauf
    //    - Bei Transit: Bewegung
    //    - Bei Ankunft Ziel: Verkauf
    // 2. Update Market Prices (Supply/Demand anpassen)
}
```

---

## 4. Frontend UI-Komponenten

### Window: "🤝 Traders Dashboard"

Tabs:
- **Markt-Chancen** — verfügbare Handelsrouten (ranking nach Profit)
- **Aktive Trader** — laufende NPC-Trader mit Profitstatistiken
- **Meine Handelsrouten** — Spieler-Handelsrouten (bestehend, erweitert)
- **System-Analyse** — Supply/Demand Übersicht lokales System

### Widgets
- **Trade Opportunity Card** → Quelle → Ziel (mit Preis-Delta, Gewinn-Prognose)
- **Trader Status** → aktive Flotten, bisheriger Profit
- **Supply/Demand Graph** → lokal + regional (einfache Bar-Charts)

---

## 5. Implementation Roadmap

### Phase 1: Datenbank & Grundstrukturen (2 Tage)
- [ ] DB-Tabellen erstellen
- [ ] API-Grundgerüst (`api/traders.php`)
- [ ] Supply/Demand-Berechnung
- [ ] Opportunity-Finder

### Phase 2: NPC-Trader-Engine (3 Tage)
- [ ] Trader-Entitäten erstellen/verwalten
- [ ] Autonome Flotten starten
- [ ] Tick-basierte Transaktionen
- [ ] Profitabilität tracking

### Phase 3: Frontend-UI (2 Tage)
- [ ] Traders Dashboard Window
- [ ] Trade Opportunity Anzeige
- [ ] Market-Analyse-View

### Phase 4: Polishing & Balance (1-2 Tage)
- [ ] Preisanpassungen testen
- [ ] NPC-Verhalten kalibrieren
- [ ] Performance-Optimierung

---

## 6. Integrationen mit bestehenden Systemen

### `api/market.php` (erweitert)
- Neue Quellen für Supply/Demand (nicht nur Events)
- basierend auf tatsächlicher Production/Consumption

### `api/fleet.php` (erweitert)
- New Fleet Type: `trader_fleet` (mit Cargo-Handling)
- Support für automatische Buy/Sell Transactions

### `api/npc_ai.php` (erweitert)
- `npc_try_trader_mission()` — Trader-Entscheidungslogik

### `api/leaders.php` (erweitert)
- **Trade Director Leader** aktivieren
- Auto-Trader Automation via Leader-Skills

---

## 7. Balancing-Parameter

```php
// Trader-Verhalten
MAX_TRADER_FLEETS_PER_FACTION = 5
TRADER_CAPITAL_PER_FLEET = 10000 Credits
TRADER_STRATEGY_DRIFT = 0.1  // wie oft Strategie wechselt

// Supply/Demand-Schwellen
ARBITRAGE_MIN_MARGIN = 0.15  // 15% minimum Profit
OPPORTUNITY_TTL = 3600  // 1h bis Chance verfällt

// Preisanpassung nach Trader-Aktion
PRICE_IMPACT_MULTIPLIER = 0.02  // wie stark Kauf Preis treibt
```

---

## 8. Tests & Validierung

- [ ] Unit-Tests für Supply/Demand-Berechnung
- [ ] Integration-Tests für Trader-Tick
- [ ] E2E: Trader startet, bewegt Waren, macht Profit
- [ ] Preise passen sich nachweisbar an
- [ ] Keine Race-Conditions in DB

---

## 9. Offene Designfragen

1. **Sollen Spieler direkter mit NPC-Tradervermitteln?** (z.B. Handelsgruppe beitreten)
2. **Können Spieler selbst als "Trader" fungieren** (mit Leader-Bonusse)?
3. **Welche Sicherheitsmechanismen gegen Preismanipulation?**
4. **Wie oft wird Supply/Demand neu berechnet?** (Echtzeit? Alle 10min?)
5. **Sollen schwarze Märkte separat gehandhabt werden?**

---

## 10. Definition of Done

- ✅ DB-Struktur vollständig
- ✅ Supply/Demand wird aktiv berechnet
- ✅ Mindestens 3 NPC-Trader pro Sektor aktiv
- ✅ Preise reagieren nachweisbar auf Trader-Aktivitäten
- ✅ Dashboard zeigt Live-Chancen und Trader-Status
- ✅ Keine DB-Fehler oder Race-Conditions
- ✅ Performance: Trader-Tick <500ms pro 10 Trader
