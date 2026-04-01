# ⚡ GalaxyQuest — FTL Drive Design Document

**Version:** 1.3  
**Status:** Phase 1–5 implementiert (siehe `sql/migrate_vessel_blueprints_v10_ftl_drives.sql`, `v11_ftl_phase4.sql`, `v12_npc_ftl.sql`)  
**Erstellt:** 2026-03-30  
**Basis-Docs:** [GAMEDESIGN.md](GAMEDESIGN.md) · [GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md) · [FUTURE_ENHANCEMENTS.md](../technical/FUTURE_ENHANCEMENTS.md)

---

## Inhaltsverzeichnis

1. [Ziel und Kontext](#1-ziel-und-kontext)
2. [Aktuelles FTL-System (Ist-Zustand)](#2-aktuelles-ftl-system-ist-zustand)
3. [Fraktionsspezifische FTL-Antriebe](#3-fraktionsspezifische-ftl-antriebe)
   - 3.1 Vor'Tak — Kearny-Fuchida Sprungantrieb (BattleTech-Stil)
   - 3.2 Syl'Nar — Resonanz-Gate-Netz
   - 3.3 Vel'Ar — Blinder Quantensprung
   - 3.4 Zhareen — Kristall-Resonanz-Kanal
   - 3.5 Aereth — Alcubierre-Warp
   - 3.6 Kryl'Tha — Schwarmtunnel
4. [BattleTech: Kearny-Fuchida Antrieb — Detailanalyse](#4-battletech-kearny-fuchida-antrieb--detailanalyse)
5. [Balancing-Matrix](#5-balancing-matrix)
6. [Wissenschaftliche Referenzen](#6-wissenschaftliche-referenzen)
7. [Implementierungsplan](#7-implementierungsplan)
   - 7.1 DB-Schema-Erweiterungen
   - 7.2 PHP-Backend-Änderungen
   - 7.3 Frontend-Änderungen
   - 7.4 Migrations-SQL
8. [Offene Entscheidungen](#8-offene-entscheidungen)

---

## 1. Ziel und Kontext

### Problemstellung

Alle sechs Hauptfraktionen der **Kalytherion-Konvergenz** nutzen derzeit dasselbe FTL-System (3D-Newtonian-Flug + Wurmloch-Netz). Das widerspricht der Spielwelt-Lore und verhindert asymmetrisches Gameplay, das durch fraktionsspezifische Stärken und Schwächen entsteht.

### Designziel

Jede Fraktion erhält einen **einzigartigen FTL-Antrieb**, der:

1. Zur Lore und Biologie der Fraktion passt
2. Einen klaren **strategischen Spielstil** fördert
3. **Symmetrische Gesamtmacht** bei asymmetrischen Einzelstärken gewährleistet
4. Mit dem bestehenden Code-Stack inkrementell implementierbar ist

### Inspiration: BattleTech Kearny-Fuchida Drive

Die Battletech-Buchreihe beschreibt einen der realistischsten und strategisch tiefsten FTL-Ansätze der Science-Fiction: Sprungschiffe mit fixierten Sprungpunkten, langen Ladezeiten und einer harten Trennung zwischen Transportinfrastruktur (JumpShip) und Kampfkapazität (DropShip). Dieses Konzept wird als Vorlage für den **Vor'Tak-Antrieb** übernommen.

---

## 2. Aktuelles FTL-System (Ist-Zustand)

### 2.1 Standard-Newtonian-Flug

Alle Flotten nutzen eine **3D-Euklidische Distanzberechnung** (x/y/z in Lichtjahren):

```
Reisezeit = distance_ly / speed_ly_h × 3600 Sekunden
speed_ly_h = ship_speed_units × FLEET_SPEED_FACTOR × GAME_SPEED
FLEET_SPEED_FACTOR = 0.2
```

Die Flotte wird durch das **langsamste Schiff** bestimmt (Bottleneck-Prinzip). Ein Commander mit `skill_navigation` erhöht die Geschwindigkeit.

### 2.2 Wurmloch-Netz (`wormhole_theory` Lv 5)

- **Voraussetzung:** Forschung `wormhole_theory` Level 5 + absolvierter Precursor-Quest
- **Mechanik:** Instantaner Sprung (30 Sekunden Reisezeit) zwischen zwei fixen Endpunkten
- **Kosten:** Stabilität -10, Cooldown 15 Minuten
- **Tabelle:** `wormholes` (stability, cooldown_until, is_active, is_permanent)
- **Status:** ✅ Vollständig implementiert

### 2.3 Lücken im aktuellen System

| Problem | Auswirkung |
|---|---|
| Alle Fraktionen identisch schnell | Kein Anreiz, Fraktion strategisch zu wählen |
| Kein fraktionsspezifischer Cooldown | Keine Konsequenz für häufige Sprünge |
| Kein Carrier/JumpShip-Konzept | BattleTech-Tiefe fehlt |
| Sprungpunkte rein geografisch | Keine taktische Verteidigungskomponente |

---

## 3. Fraktionsspezifische FTL-Antriebe

### 3.1 🦎 Vor'Tak — Kearny-Fuchida Sprungantrieb

**Lore:** Die Vor'Tak nutzen ihre biomechanischen Schiffsstrukturen, um den Raum an vordefinierten Gravitationsnullpunkten zu falten. Sprünge sind ehrenhaft angekündigt — Überraschungsangriffe aus dem Sprung gelten als unehrenhaft.

**Mechanismus (BattleTech K-F):**
- Sprung nur von **Sprungpunkten** aus möglich (Lagrange-Punkte: Zenith/Nadir eines Sternensystems)
- **Maximale Sprungreichweite:** 30 Lichtjahre pro Sprung (absolute Obergrenze)
- **Ladezeit:** Antrieb benötigt nach einem Sprung **72 Stunden** zum Wiederaufladen (via `ftl_cooldown_until` im User-Profil)
- **Sprung selbst:** Instantan (30 Sekunden in-game)
- **Vorteil:** Höchste Truppenkapazität durch JumpShip-Carrier-Konzept (+30% Frachtkapazität)
- **Nachteil:** Sprungpunkte sind vorhersagbar — Feinde können dort warten (neues Scouting-Fenster)

**Spielstil:** Planvolle Großoffensiven, strategisches Positionsspiel, Verteidigungslinien aufbauen

**Einschränkungen:**
- Kein Sprung aus einem System mit aktiver feindlicher Blockade
- Mindest-Distanz für Sprung: > 5 Lichtjahre (kein Intra-System-Sprung)

---

### 3.2 🐙 Syl'Nar — Resonanz-Gate-Netz

**Lore:** Die Syl'Nar verbinden zwei Ozeane durch verschränkte Raumzeit-Topologien. Ihre biolumineszenten Kristall-Resonatoren erzeugen stationäre Portale, durch die Flotten instantan reisen.

**Mechanismus (ER=EPR-inspiriert):**
- Reisen nur zwischen **etablierten Gates** möglich (stationäre Infrastruktur)
- **Gate-Aufbau:** Erfordert ein Scout-Schiff, das normal zum Ziel reist und dann ein Gate installiert
- **Reisezeit durch Gate:** 10 Sekunden (de facto instantan)
- **Vorteil:** Kein Treibstoffverbrauch für Gate-Reisen; nahezu unbegrenzte Reichweite
- **Nachteil:** Gates können von Feinden zerstört werden; Bau kostet 2× Crystal-Ressourcen

**Spielstil:** Infrastruktur-aufbauen, Netzwerk-Verteidigung, Logistik-Dominanz

**Einschränkungen:**
- Maximal **5 aktive Gates** gleichzeitig (erweiterbar durch Forschung)
- Gate-Zerstörung durch feindliche Flotte (neuer Missiontyp: `destroy_gate`)
- Kein direktes Gate zwischen zwei unentdeckten Systemen

---

### 3.3 🦅 Vel'Ar — Blinder Quantensprung

**Lore:** Vel'Ar-Piloten werden jahrelang in der Kalkulation von Raumzeit-Koordinaten trainiert. Ihr Antrieb springt instantan, aber mit einer statistischen Ankunfts-Unschärfe — ein fehlerhafter Sprung bedeutet Verlust.

**Mechanismus (BSG-Stil):**
- **Instantaner Sprung** ohne Infrastruktur, keine Ladezeit
- **Ankunfts-Unschärfe:** ±(Distanz × 0.5%) Lichtjahre vom Ziel; steigt mit Entfernung
  - Beispiel: 100 LY Sprung → ±0,5 LY Streuung
  - Beispiel: 10.000 LY Sprung → ±50 LY Streuung
- **Stealth-Ankunft:** Flotte erscheint im Zielgebiet **für 60 Sekunden unsichtbar** (kein Radar-Event)
- **Vorteil:** Maximale Flexibilität, kein Infrastrukturbedarf, strategische Überraschung
- **Nachteil:** Kann nicht präzise in enge Systeme springen; Risiko von Fehlsprüngen

**Spielstil:** Guerilla-Taktik, Überraschungsangriffe, Spionage-Missionen, schnelle Reaktion

**Einschränkungen:**
- Sprung in bewohnte Systeme: Zusatz-Risiko (5% Wahrscheinlichkeit auf 1–3 Schiffe verloren durch Materialisierungsfehler bei hoher Dichte)
- Kein Sprung mit Frachtkargo > 50% Kapazität (instabile Masse)

---

### 3.4 💎 Zhareen — Kristall-Resonanz-Kanal

**Lore:** Die Zhareen haben entdeckt, dass ihre Kristalle auf kosmische Resonanzknoten reagieren — Punkte im Raum, wo Extradimensionen besonders nah an der normalen Raumzeit liegen. Durch diese Kanäle können Schiffe Distanzen überwinden, ohne physisch zu reisen.

**Mechanismus (String-Theorie-inspiriert):**
- Reisen nur zwischen **kartierten Resonanzknoten** möglich
- **Kartierung:** Spezielle Survey-Mission (neuer Missiontyp `survey_node`) entdeckt Knoten
- **Reisezeit:** 60 Sekunden, unabhängig von Distanz
- **Vorteil:** Massenunabhängig — kein Geschwindigkeitsverlust bei großen Flotten
- **Nachteil:** Neue Systeme erfordern aufwendige Kartierung; Chart-Daten sind handelbar (diplomatische Ressource)

**Spielstil:** Erkundung, Diplomatie, Handel mit Informationen, späte Expansion

**Einschränkungen:**
- Maximal 1 Sprung pro Resonanzknoten alle 30 Minuten (Knoten-Abklingling)
- Survey-Mission dauert 2× normale Reisezeit

---

### 3.5 ✦ Aereth — Alcubierre-Warp

**Lore:** Die Aereth, Humanoide Energiewesen, formen ihre eigene Raumzeit-Krümmungsblase direkt. Ihr Antrieb ist am nächsten an klassischer Science-Fiction-Warp-Technologie, aber in dichten Regionen wesentlich effizienter.

**Mechanismus (Alcubierre + Bussard):**
- **Kontinuierlicher Warp** — keine Sprünge, sondern kontinuierliche Überlichtbewegung
- **Dichte-abhängige Geschwindigkeit:** In galaktischen Kernregionen +50% Geschwindigkeit durch "Plasma-Scoop"
- **Kein Treibstoffverbrauch** in Kernregionen (interstellares Plasma als Brennstoff)
- **Vorteil:** Keine Infrastruktur, kein Cooldown, einfachste Nutzung
- **Nachteil:** In galaktischen Randgebieten -30% Geschwindigkeit; kein Stealth-Vorteil

**Spielstil:** Standard-4X-Expansion, gute Allround-Option, ideal für Einsteiger

**Einschränkungen:**
- Innerhalb von 0,1 LY um Gravitationsmassiv (Neutronenstern, Schwarzes Loch): Warp deaktiviert
- Kein Intra-System-Sprung

---

### 3.6 🪲 Kryl'Tha — Schwarmtunnel

**Lore:** Die Kryl'Tha (insektoide Kollektiv-Intelligenz) nutzen kein einzelnes Schiff für FTL, sondern koordinieren massenhaft kleine Einheiten, die gemeinsam einen biologischen Tunnel durch den Raum bohren.

**Mechanismus:**
- **Schwarmbasiertes FTL:** Kleine Flotten < 10 Schiffe springen schnell; große Flotten langsamer
- **Skalierbare Reisezeit:** `travel_time = base_time × (1 + fleet_size / 10)` — mehr Schiffe = langsamer
- **Kosten:** -10% Schiffshülle nach jedem Sprung (biologischer Verschleiß, regeneriert sich in 2h)
- **Vorteil:** Keine Infrastruktur, kein Treibstoffverbrauch, effizient für kleine Raids
- **Nachteil:** Große Flotten werden signifikant verlangsamt

**Spielstil:** Schwarm-Taktik, viele kleine Angriffe statt weniger großer, schnelle Reaktion

**Einschränkungen:**
- Kein FTL für Flotten > 50 Schiffe (biologisches Limit)
- Nach 3 aufeinanderfolgenden Sprüngen: 1 Stunde Regenerationspause

---

## 4. BattleTech: Kearny-Fuchida Antrieb — Detailanalyse

Der **Kearny-Fuchida Jump Drive (K-F Drive)** aus dem BattleTech-Universum ist das Fundament für den Vor'Tak-Antrieb. Hier eine vollständige Analyse für die Design-Entscheidung:

### 4.1 Funktionsweise im BattleTech-Universum

| Aspekt | BattleTech-Original | GalaxyQuest-Adaption |
|---|---|---|
| **Sprungreichweite** | Exakt 30 Lichtjahre | Max. 30 LY (konfigurierbar via GAME_SPEED) |
| **Sprungpunkte** | Nadir/Zenith eines Sterns (Lagrange L1/L2) | Vordefinierte Systeme mit `is_jump_point = 1` |
| **Ladezeit** | 7–10 Tage (Solar Segel) | 72 Stunden (skaliert via GAME_SPEED) |
| **Sprung selbst** | Instantan | 30 Sekunden |
| **JumpShips** | Unbewaffnet, reine Träger | `carrier` Ship-Typ (neu) |
| **DropShips** | Docken an JumpShips | Flotten docken an Carrier-Flotte |

### 4.2 Warum K-F für Vor'Tak passt

1. **Ehrencodex:** Sprungpunkte sind öffentlich bekannt → Vor'Tak kündigen ihre Ankunft an
2. **Hierarchische Militärstruktur:** JumpShip-Carrier passt zur militärischen Organisationsstruktur
3. **Biomechanik:** Lebende Metalle können einen biologischen Sprungantrieb beherbergen
4. **Strategische Planung:** 72h Ladezeit erzwingt vorausschauende Planung — passt zum taktischen Spielstil

### 4.3 Strategische Tiefe durch Sprungpunkte

Im BattleTech-Universum sind Sprungpunkte **die** taktische Variable: Wer die Sprungpunkte kontrolliert, kontrolliert die Logistikrouten. Für GalaxyQuest bedeutet das:

- **Offensive:** Vor'Tak muss den Sprungpunkt eines feindlichen Systems erreichen (Anreise dauert je nach Systemgröße)
- **Defensive:** Verteidiger können am Sprungpunkt warten und hat strategischen Vorteil
- **Blockade:** Eine Flotte im Orbit eines Sprungpunkts kann Ankünfte abfangen

---

## 5. Balancing-Matrix

### 5.1 Stärken/Schwächen-Übersicht

| Fraktion | Antrieb | Reichweite | Geschwindigkeit | Infrastruktur | Vorhersagbarkeit | Kampfvorteil |
|---|---|---|---|---|---|---|
| **Vor'Tak** | K-F Sprungantrieb | ★★★ (30 LY max) | ★★★ | Keine | ⚠️ Sehr hoch (Sprungpunkte fix) | ★★★★★ (+30% Cargo) |
| **Syl'Nar** | Resonanz-Gates | ★★★★★ | ★★★★★ | ⚠️ Gates nötig | ✅ Niedrig (Gates flexibel) | ★★ (Gates zerstörbar) |
| **Vel'Ar** | Blind-Sprung | ★★★★★ | ★★★★★ | Keine | ✅ Sehr niedrig | ★★★★ (60s Stealth) |
| **Zhareen** | Resonanzkanal | ★★★ (nur Knoten) | ★★★★ | ⚠️ Charts nötig | ✅ Mittel | ★★★ (Charts handelbar) |
| **Aereth** | Alcubierre-Warp | ★★★★ | ★★★★ | Keine | ✅ Mittel | ★★★ (kein Bonus) |
| **Kryl'Tha** | Schwarmtunnel | ★★★★ | ★★★★★ klein / ★★ groß | Keine | ✅ Mittel | ★★★ (Schwarm-Vorteil) |

### 5.2 Balancing-Achsen

**Achse 1: Vorhersagbarkeit ↔ Flexibilität**
- Vor'Tak (maximal vorhersagbar, maximal militärische Stärke) ↔ Vel'Ar (maximal unvorhersagbar, Überraschungsvorteil)

**Achse 2: Infrastruktur ↔ Freiheit**
- Syl'Nar (maximale Infrastruktur, maximale Effizienz) ↔ Aereth (keine Infrastruktur, flexible Mobilität)

**Achse 3: Einzelschiff ↔ Masse**
- Kryl'Tha (optimal bei kleinen Schwärmen) ↔ Vor'Tak (optimal bei großen Truppenmassierungen)

### 5.3 Balancing-Formel (Zielwert)

Jede Fraktion soll in einem 100-Punkte-System auf ca. **100 Punkte** kommen:

| Fraktion | Geschw. | Reichweite | Infrastr.-Risiko | Kampfbonus | Summe |
|---|---|---|---|---|---|
| Vor'Tak | 15 | 10 | 0 | 30+20 Cargo | **~100** |
| Syl'Nar | 30 | 30 | -25 Gates | 25 | **~100** |
| Vel'Ar | 30 | 30 | 0 | 20 Stealth | **~100** |
| Zhareen | 20 | 20 | -10 Charts | 35 Mass | **~100** |
| Aereth | 25 | 25 | 0 | 25 Dichte | **~100** |
| Kryl'Tha | 25+/10- | 25 | 0 | 25 Schwarm | **~100** |

---

## 6. Wissenschaftliche Referenzen

| FTL-Konzept | Wissenschaftliche Grundlage | Verwendung |
|---|---|---|
| Alcubierre-Warp | Miguel Alcubierre (1994), General Relativity Metrics | Aereth |
| ER=EPR-Verschränkung | Maldacena & Susskind (2013), Wormhole = Entanglement | Syl'Nar |
| Kearny-Fuchida Drive | BattleTech (FASA, 1984), fiktiv aber physik-motiviert | Vor'Tak |
| Quantenunschärfe | Heisenberg (1927), Ortsimpuls-Unschärfe | Vel'Ar |
| Calabi-Yau Extradimensionen | String-Theorie, M-Theorie (Witten, 1995) | Zhareen |
| Bussard Ramjet | Robert Bussard (1960), Interstellarer Wasserstoffsscoop | Aereth (Dichte-Bonus) |

Detaillierte wissenschaftliche Referenzen: [SCIENTIFIC_REFERENCES.md](../technical/SCIENTIFIC_REFERENCES.md)

---

## 7. Implementierungsplan

### 7.1 DB-Schema-Erweiterungen

#### a) Spieler-Fraktion / FTL-Typ

Die Spielerwahl der Fraktion wird über das bestehende `race`-Feld in `user_character_profiles` gemacht. Zusätzlich brauchen wir einen FTL-Cooldown pro Spieler:

```sql
-- Migration v10: FTL drive system
ALTER TABLE users
    ADD COLUMN ftl_drive_type VARCHAR(30) NOT NULL DEFAULT 'alcubierre'
        COMMENT 'vor_tak|syl_nar|vel_ar|zhareen|aereth|kryl_tha',
    ADD COLUMN ftl_cooldown_until DATETIME DEFAULT NULL
        COMMENT 'Vor\'Tak K-F recharge cooldown';
```

#### b) Syl'Nar Gates

```sql
CREATE TABLE IF NOT EXISTS ftl_gates (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT NOT NULL,
    galaxy_a      INT NOT NULL,
    system_a      INT NOT NULL,
    galaxy_b      INT NOT NULL,
    system_b      INT NOT NULL,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    health        INT NOT NULL DEFAULT 100,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_gates_a (galaxy_a, system_a),
    INDEX idx_gates_b (galaxy_b, system_b)
) ENGINE=InnoDB;
```

#### c) Zhareen Resonanzknoten

```sql
CREATE TABLE IF NOT EXISTS ftl_resonance_nodes (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT NOT NULL,
    galaxy        INT NOT NULL,
    `system`      INT NOT NULL,
    discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cooldown_until DATETIME DEFAULT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_node (owner_user_id, galaxy, `system`)
) ENGINE=InnoDB;
```

#### d) Sprungpunkte (Vor'Tak)

Sprungpunkte sind systemgebunden. Wir ergänzen die `star_systems`-Tabelle:

```sql
ALTER TABLE star_systems
    ADD COLUMN has_jump_point TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Vor\'Tak K-F jump point available (Lagrange point)';
```

Als Alternative: Sprungpunkte werden durch eine Regel definiert (z.B. alle Systeme mit `star_type IN ('G', 'F', 'K')` haben einen Sprungpunkt) — dann ist keine DB-Änderung nötig.

### 7.2 PHP-Backend-Änderungen

#### a) Neue Hilfsfunktion `get_user_ftl_type()`

Datei: `api/game_engine.php`

```php
/**
 * Returns the FTL drive type for a given user ID.
 * Defaults to 'alcubierre' (Aereth) if not set.
 */
function get_user_ftl_type(PDO $db, int $uid): string {
    $stmt = $db->prepare('SELECT ftl_drive_type FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$uid]);
    return (string)($stmt->fetchColumn() ?: 'alcubierre');
}
```

#### b) FTL-Dispatch-Logik in `api/fleet.php`

In der `send_fleet()`-Funktion, nach der bestehenden Wormhole-Logik, einen neuen Block einfügen:

```php
// ── Faction FTL mechanics ──────────────────────────────────────────────────
$ftlType = get_user_ftl_type($db, $uid);

switch ($ftlType) {

    case 'vor_tak':
        // K-F Jump Drive: cooldown check, max 30 LY, jump-point requirement
        $cooldownRow = $db->prepare('SELECT ftl_cooldown_until FROM users WHERE id=?');
        $cooldownRow->execute([$uid]);
        $cooldownUntil = $cooldownRow->fetchColumn();
        if ($cooldownUntil && strtotime($cooldownUntil) > time()) {
            json_error('K-F Drive recharging until: ' . $cooldownUntil);
        }
        if ($distLy > 30.0) {
            json_error('K-F Drive range exceeded: max 30 LY per jump. Distance: ' . round($distLy, 2) . ' LY');
        }
        // Instantaneous jump
        $travel = 30;
        $speedLyH = 999999.0;
        // Set 72h cooldown (scaled by GAME_SPEED)
        $cooldownSeconds = max(60, (int)(72 * 3600 / GAME_SPEED));
        $db->prepare('UPDATE users SET ftl_cooldown_until = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=?')
           ->execute([$cooldownSeconds, $uid]);
        break;

    case 'syl_nar':
        // Gate network: must have an active gate between origin and target
        $gate = resolve_syl_nar_gate($db, $uid, (int)$origin['galaxy'], (int)$origin['system'], $tg, $ts);
        if (!$gate) {
            json_error('No active Syl\'Nar gate found for this route. Build one first.');
        }
        $travel = 10;
        $speedLyH = 999999.0;
        break;

    case 'vel_ar':
        // Blind quantum jump: instant but with scatter
        $scatter = $distLy * 0.005; // 0.5% of distance as scatter
        // Apply scatter to target coordinates (randomized offset)
        $angle1 = lcg_value() * 2 * M_PI;
        $angle2 = lcg_value() * M_PI;
        $tx += $scatter * sin($angle2) * cos($angle1);
        $ty += $scatter * sin($angle2) * sin($angle1);
        $tz += $scatter * cos($angle2);
        $travel = 30;
        $speedLyH = 999999.0;
        // Stealth flag stored in fleet: use a convention (ships_json meta or separate field)
        // TODO: add stealth_until to fleets table for full implementation
        break;

    case 'zhareen':
        // Crystal resonance channel: check for known resonance node at target
        $node = get_zhareen_node($db, $uid, $tg, $ts);
        if (!$node) {
            json_error('No resonance node charted at target. Send a survey mission first.');
        }
        if ($node['cooldown_until'] && strtotime($node['cooldown_until']) > time()) {
            json_error('Resonance node cooling down until: ' . $node['cooldown_until']);
        }
        $travel = 60;
        $speedLyH = 999999.0;
        // Apply node cooldown (30 min)
        $db->prepare('UPDATE ftl_resonance_nodes SET cooldown_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE id=?')
           ->execute([$node['id']]);
        break;

    case 'aereth':
    default:
        // Standard Alcubierre warp — existing 3D Newtonian logic applies
        // Regional density bonus: inner 3 galaxies get +50% speed
        if ($origin['galaxy'] <= 3) {
            $speedLyH *= 1.5;
            $travel = fleet_travel_time_3d($distLy, $speedLyH);
        }
        // Outer galaxies (7-9) get -30%
        if ($origin['galaxy'] >= 7) {
            $speedLyH *= 0.7;
            $travel = fleet_travel_time_3d($distLy, $speedLyH);
        }
        break;

    case 'kryl_tha':
        // Swarm tunnel: travel time scales with fleet size
        $totalShips = array_sum($shipsToSend);
        $sizeFactor = 1.0 + $totalShips / 100.0;
        if ($totalShips > 50) {
            json_error('Swarm Tunnel overloaded: maximum 50 ships per FTL jump.');
        }
        $travel = (int)($travel * $sizeFactor);
        // Hull damage after jump: applied in resolve_fleet_arrival()
        break;
}
// ── end FTL mechanics ─────────────────────────────────────────────────────
```

#### c) Neue Hilfsfunktionen

In `api/game_engine.php` hinzufügen:

```php
/** Resolve active Syl'Nar gate between origin and target systems. */
function resolve_syl_nar_gate(PDO $db, int $uid, int $gA, int $sA, int $gB, int $sB): ?array {
    $stmt = $db->prepare(
        'SELECT id FROM ftl_gates
          WHERE owner_user_id = ? AND is_active = 1
            AND ((galaxy_a=? AND system_a=? AND galaxy_b=? AND system_b=?)
              OR (galaxy_b=? AND system_b=? AND galaxy_a=? AND system_a=?))
          LIMIT 1'
    );
    $stmt->execute([$uid, $gA, $sA, $gB, $sB, $gA, $sA, $gB, $sB]);
    return $stmt->fetch() ?: null;
}

/** Get a Zhareen resonance node for target system. */
function get_zhareen_node(PDO $db, int $uid, int $galaxy, int $system): ?array {
    $stmt = $db->prepare(
        'SELECT id, cooldown_until FROM ftl_resonance_nodes
          WHERE owner_user_id = ? AND galaxy = ? AND `system` = ? LIMIT 1'
    );
    $stmt->execute([$uid, $galaxy, $system]);
    return $stmt->fetch() ?: null;
}
```

#### d) Kryl'Tha Hüllenmalus bei Ankunft

In `resolve_fleet_arrival()` (ca. Zeile 462 in `fleet.php`):

```php
// Kryl'Tha swarm tunnel hull damage: -10% hull per jump (applied as attack bonus for attacker in battle)
// Stored in fleet metadata for combat resolution
if (get_user_ftl_type($db, $fleet['user_id']) === 'kryl_tha') {
    // Mark fleet as "battle-worn": stored in ships_json meta or separate flag
    // TODO: add hull_damage_pct column to fleets for full implementation
}
```

### 7.3 Frontend-Änderungen

#### a) Flotten-UI: FTL-Status-Anzeige

In der Fleet-Window-Komponente (`js/windows/fleet.js` oder entsprechende Datei):

- **Vor'Tak:** Cooldown-Balken anzeigen (`ftl_cooldown_until` aus User-API)
- **Syl'Nar:** Gate-Liste mit Aufbau-Button
- **Vel'Ar:** Scatter-Radius-Warnung bei langen Sprüngen
- **Zhareen:** Bekannte Resonanzknoten auf der Karte markieren
- **Aereth:** Regionen-Geschwindigkeits-Indikator (Kern/Rand)
- **Kryl'Tha:** Flottengröße-Warnung ab 40 Schiffen

#### b) API-Erweiterung: FTL-Status-Endpoint

Neuer Endpoint in `api/user.php` oder `api/fleet.php`:

```
GET /api/fleet.php?action=ftl_status
```

Response:
```json
{
  "ftl_drive_type": "vor_tak",
  "ftl_cooldown_until": "2026-03-31 05:00:00",
  "ftl_cooldown_remaining_s": 86400,
  "gates": [],
  "resonance_nodes": []
}
```

### 7.4 Migrations-SQL

Datei: `sql/migrate_vessel_blueprints_v10_ftl_drives.sql`

```sql
-- GalaxyQuest migration v10: faction-specific FTL drive system

-- Add FTL drive type and cooldown to users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ftl_drive_type VARCHAR(30) NOT NULL DEFAULT 'alcubierre'
        COMMENT 'ftl drive type: vor_tak|syl_nar|vel_ar|zhareen|aereth|kryl_tha',
    ADD COLUMN IF NOT EXISTS ftl_cooldown_until DATETIME DEFAULT NULL
        COMMENT 'FTL drive cooldown (used by vor_tak K-F recharge)';

-- Syl'Nar gate network
CREATE TABLE IF NOT EXISTS ftl_gates (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT NOT NULL,
    galaxy_a      INT NOT NULL,
    system_a      INT NOT NULL,
    galaxy_b      INT NOT NULL,
    system_b      INT NOT NULL,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    health        INT NOT NULL DEFAULT 100
                  COMMENT 'Gate health 0-100; destroyed at 0',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_gates_a (galaxy_a, system_a),
    INDEX idx_gates_b (galaxy_b, system_b)
) ENGINE=InnoDB;

-- Zhareen resonance node registry
CREATE TABLE IF NOT EXISTS ftl_resonance_nodes (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT NOT NULL,
    galaxy        INT NOT NULL,
    `system`      INT NOT NULL,
    discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cooldown_until DATETIME DEFAULT NULL
                  COMMENT '30-min cooldown per node after use',
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_node (owner_user_id, galaxy, `system`)
) ENGINE=InnoDB;

-- Seed: assign default FTL types based on existing race field in user_character_profiles
UPDATE users u
JOIN user_character_profiles ucp ON ucp.user_id = u.id
SET u.ftl_drive_type = CASE LOWER(ucp.race)
    WHEN 'vor''tak'  THEN 'vor_tak'
    WHEN 'syl''nar'  THEN 'syl_nar'
    WHEN 'vel''ar'   THEN 'vel_ar'
    WHEN 'zhareen'   THEN 'zhareen'
    WHEN 'aereth'    THEN 'aereth'
    WHEN 'kryl''tha' THEN 'kryl_tha'
    ELSE 'alcubierre'
END
WHERE u.ftl_drive_type = 'alcubierre';
```

---

## 8. Offene Entscheidungen

| # | Frage | Optionen | Empfehlung |
|---|---|---|---|
| **OD-1** | Wann wählt der Spieler seine Fraktion/FTL? | a) Bei Registrierung, b) Nach Tutorial, c) Jederzeit änderbar | **b)** Nach Tutorial — Spieler versteht dann die Konsequenzen |
| **OD-2** | Ist der FTL-Typ an die Rasse gebunden oder frei wählbar? | a) Rasse = FTL fest, b) Rasse und FTL unabhängig | **a)** Rasse = FTL für mehr Kohärenz |
| **OD-3** | Wie werden NPC-Fraktionen FTL-typen zugewiesen? | a) Alle NPCs nutzen Aereth (Standard), b) NPCs haben Rassen-spezifisches FTL | ✅ **Implementiert** — Migration v12 + `npc_assign_ftl_drive()` in `npc_ai.php` |
| **OD-4** | Syl'Nar Gates: Werden sie auf der Karte sichtbar für andere Spieler? | a) Nur Besitzer sieht, b) Alle sehen (angreifbar), c) Scouting nötig | **c)** Scouting — bestes Balancing |
| **OD-5** | Vel'Ar Scatter: Wird zufällig ein anderes System gewählt oder nur coords verschoben? | a) Nur Koordinaten, b) Nächstes System zur Scatter-Position | ✅ **Implementiert** — snap via SQL `ORDER BY dist ASC LIMIT 1` in `fleet.php` |
| **OD-6** | Kryl'Tha Hüllenmalus: Wie wird er technisch abgebildet? | a) Im Kampfresolver als Malus, b) Eigene `hull_damage_pct` Spalte | **a)** Kampfresolver-Ansatz — kein neues Schema nötig |
| **OD-7** | Für Vor'Tak: Sind Sprungpunkte eine DB-Tabelle oder eine Berechnungsregel? | a) DB-Tabelle, b) Regel: alle Systeme mit star_type G/F/K | **b)** Berechnungsregel — einfacher zu implementieren |

---

## Prioritäts-Reihenfolge der Implementierung

### Phase 1 — Quick Wins (Keine neuen DB-Tabellen)

| # | Feature | Aufwand | Impact |
|---|---|---|---|
| P1.1 | `ftl_drive_type` Feld in `users` + Seed-Migration | Klein | Hoch |
| P1.2 | Aereth Dichte-Bonus (+50%/-30% nach Galaxy-Zone) | Klein | Mittel |
| P1.3 | Kryl'Tha Schwarm-Skalierung (fleet_size → travel_time) | Klein | Mittel |
| P1.4 | Vel'Ar Blind-Sprung (Scatter-Berechnung in fleet.php) | Mittel | Hoch |

### Phase 2 — Mittelgroße Features (Cooldown-System)

| # | Feature | Aufwand | Impact |
|---|---|---|---|
| P2.1 | Vor'Tak K-F Cooldown (`ftl_cooldown_until` + 30-LY-Check) | Mittel | Sehr hoch |
| P2.2 | FTL-Status-API-Endpoint | Mittel | Mittel |
| P2.3 | Frontend-Cooldown-Anzeige | Mittel | Mittel |

### Phase 3 — Infrastruktur-Features (Neue Tabellen)

| # | Feature | Aufwand | Impact |
|---|---|---|---|
| P3.1 | Syl'Nar Gate-Netz (`ftl_gates` Tabelle + Gate-Build-Mission) | Groß | Sehr hoch |
| P3.2 | Zhareen Resonanzknoten (`ftl_resonance_nodes` + Survey-Mission) | Groß | Hoch |
| P3.3 | Gate-Angriffsmission (`destroy_gate`) | Groß | Mittel |

### Phase 4 — Polishing

| # | Feature | Aufwand | Impact |
|---|---|---|---|
| P4.1 | Vor'Tak JumpShip-Carrier-Konzept (neuer Ship-Typ) | Sehr groß | Mittel |
| P4.2 | Vel'Ar Stealth-Ankunft (UI + Radar-Unterdrückung) | Groß | Hoch |
| P4.3 | Kartenvisualisierung (Gates, Sprungpunkte, Resonanzknoten) | Groß | Hoch |

### Phase 5 — Zugänglichkeit & Polishing ✅ Implementiert (2026-03-30)

| # | Feature | Status |
|---|---|---|
| P5.1 | FTL Drive Selection API (`POST game.php?action=set_ftl_drive`) — erste Wahl kostenlos, Wechsel 200 DM | ✅ |
| P5.2 | Settings-UI: FTL-Drive-Auswahl-Panel mit 6 Fraktionskarten | ✅ |
| P5.3 | OD-5: Vel'Ar Scatter → snap zur nächsten echten `star_system` statt nur Koordinatenversatz | ✅ |
| P5.4 | OD-3: NPC FTL-Typen per Migration v12 + Runtime-Zuweisung in `npc_player_account_tick` | ✅ |
| P5.5 | Dark-Matter-Ausgabe: Vor'Tak Cooldown-Reset via `fleet.php?action=reset_ftl_cooldown` (50 DM) + UI-Button | ✅ |

---

*Dieses Dokument wird laufend aktualisiert. Offene Entscheidungen (Abschnitt 8) sollten vor Beginn von Phase 2 getroffen sein.*
