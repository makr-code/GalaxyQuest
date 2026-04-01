# GalaxyQuest – Bonus/Malus-System für NPCs & Fraktionen

**Version:** 1.0  
**Status:** Game-Design-Dokument (Outline)  
**Letztes Update:** 2026-04-01  
**Bezug:** `GAMEDESIGN.md`, `FACTION_RELATIONS.yaml`, `migrate_politics_model_v1.sql`

---

## Inhaltsverzeichnis

1. [Executive Summary](#1-executive-summary)
2. [Design-Ziele](#2-design-ziele)
3. [Inspiration & Referenzen](#3-inspiration--referenzen)
4. [Reputations-Tiers](#4-reputations-tiers)
5. [Bonus/Malus-Katalog](#5-bonusmalus-katalog)
6. [Fraktions-Druck-System](#6-fraktions-druck-system)
7. [Modifier-Quellen & Trigger](#7-modifier-quellen--trigger)
8. [Ereignis-Integration](#8-ereignis-integration)
9. [NPC-Fraktionsverhalten pro Tier](#9-npc-fraktionsverhalten-pro-tier)
10. [Frontend-Spezifikation](#10-frontend-spezifikation)
11. [Backend-Spezifikation](#11-backend-spezifikation)
12. [Balancing-Richtlinien](#12-balancing-richtlinien)
13. [Implementierungs-Phasen](#13-implementierungs-phasen)
14. [Offene Fragen & Ausblick](#14-offene-fragen--ausblick)
15. [NPC-Fraktions-Modifier-Tabellen](#15-npc-fraktions-modifier-tabellen-alle-13-fraktionen)
16. [Fraktions-Quer-Effekte](#16-fraktions-quer-effekte)
17. [Quest-Katalog pro Fraktion und Tier](#17-quest-katalog-pro-fraktion-und-tier)
18. [Wirtschaftsintegration (ColonySimulation)](#18-wirtschaftsintegration-colonysimulation)
19. [Spieler-Progressionspfad](#19-spieler-progressionspfad)
20. [Lokale Bonus/Malus-Systeme (Kolonie-, Flotten- und Diplomatie-Ebene)](#20-lokale-bonusmalus-systeme-kolonie--flotten-und-diplomatie-ebene)

---

## 1. Executive Summary

Das **Bonus/Malus-System** (kurz: BMS) erweitert das bestehende Fraktionsstehungs-System
(`diplomacy`-Tabelle, Wert −100 … +100) um ein **tier-basiertes Modifier-Modell**:
Jede Fraktion wirkt, abhängig vom aktuellen Reputationswert des Spielers, auf
dessen Imperium als Quelle für **Bonifikationen** (Vorteile) oder **Mali**
(Nachteile) in den Kategorien Wirtschaft, Militär, Forschung, Wachstum,
Stabilität und Spionage.

Ergänzend wird ein **Fraktions-Druck-Mechanismus** (nach Victoria-3-Vorbild)
eingeführt: Fraktionen mit hohem `power_level` üben permanenten politischen Druck
auf das Imperium aus – unabhängig vom Reputationswert. Dieser Druck lässt sich
durch gezielte Quests, Diplomatieaktionen oder Regierungsformen (Civics) dämpfen
oder verstärken.

Das System baut vollständig auf bestehenden Strukturen auf:
- `diplomacy`-Tabelle (Stehungswert)
- `user_empire_modifiers`-Tabelle (Modifier-Infrastruktur)
- `npc_factions`-Tabelle (`power_level`, `aggression`, `trade_willingness`)
- `EventSystem.js` (Journal-Ereignisse)
- `politics.php` / `factions.php` (API-Endpunkte)

---

## 2. Design-Ziele

| # | Ziel | Priorität |
|---|------|-----------|
| G1 | Fraktionsbeziehungen spürbar in Gameplay-Werten spiegeln | Hoch |
| G2 | Positive Diplomatie belohnen, nicht nur Kriegsvermeidung | Hoch |
| G3 | Negative Konsequenzen graduell und verständlich gestalten | Hoch |
| G4 | Kurzfristige taktische vs. langfristige strategische Entscheidungen erzeugen | Mittel |
| G5 | Fraktionen mit hohem `power_level` als aktive Kräfte im Universum fühlen lassen | Mittel |
| G6 | Modifikatoren UI-seitig lesbar und nachvollziehbar darstellen | Hoch |
| G7 | System ohne Breaking-Change auf Bestandsdaten aufspielen | Hoch |

---

## 3. Inspiration & Referenzen

### 3.1 X4: Foundations – Reputations-Tiers

In X4 besitzt jede Fraktion eine Reputationsskala. Beim Überschreiten definierter
Schwellenwerte werden **Tier-Stufen** freigeschaltet, die konkrete Vorteile bieten:

| X4-Tier | Schwellenwert | Effekte |
|---------|---------------|---------|
| Feindlich | −30 bis −15 | Angriff auf Sicht, Handelsembargo |
| Kalt | −15 bis 0 | keine Angebote, kein Passierschein |
| Neutral | 0 bis +15 | Basishandel, Missionen verfügbar |
| Warm | +15 bis +25 | Rabatte, erweiterte Missionen |
| Verbündet | +25 bis +30 | Sondermodule, Schutzpatrouillen |

**Adaption für GalaxyQuest:**  
Die bestehende Skala (−100 … +100) wird in **5 Tiers** mit benannten Stufen
unterteilt (→ Kapitel 4). Jeder Tier aktiviert einen Modifier-Block aus dem
`user_empire_modifiers`-System.

### 3.2 Victoria 3 – Fraktions-Druck & Interest Groups

In Victoria 3 besitzen `Interest Groups` (Interessengruppen) einen
`Influence`-Wert. Je nach politischer Stärke üben sie **Druck** auf Gesetze und
die Regierung aus:

- Hoher Einfluss einer zufriedenen Fraktion → positive Modifikatoren (Stabilität,
  Produktion)
- Hoher Einfluss einer unzufriedenen Fraktion → negative Modifikatoren (Unruhen,
  Produktionseinbußen)
- Der Spieler kann Gruppen durch Gesetze, Zugeständnisse oder Repression besänftigen

**Adaption für GalaxyQuest:**  
NPC-Fraktionen haben ein `power_level` (0–10 in `npc_factions`). Dieses wird als
**Druck-Gewicht** verwendet. Fraktionen mit `power_level >= 6` gelten als
**Großmächte** und üben globalen Fraktionsdruck aus (→ Kapitel 6).

---

## 4. Reputations-Tiers

Die `standing`-Werte der `diplomacy`-Tabelle werden in **5 benannte Tiers** überführt.
Eine neue Hilfsfunktion `get_reputation_tier(standing)` berechnet den Tier-Index:

```
−100 … −41  →  Tier 0: FEINDSELIG    (Hostile)
 −40 … −11  →  Tier 1: KALT          (Cold)
 −10 … +20  →  Tier 2: NEUTRAL       (Neutral)   ← Standardzustand
  +21 … +60  →  Tier 3: VERBÜNDET     (Allied)
  +61 … +100 →  Tier 4: ERSTER_BERATER (First Advisor) ← max. erreichbar für Spieler
```

### Tier-Eigenschaften

| Tier | Name | Farbe (UI) | Icon |
|------|------|-----------|------|
| 0 | FEINDSELIG | Rot `#c0392b` | ☠ |
| 1 | KALT | Orange `#e67e22` | ❄ |
| 2 | NEUTRAL | Grau `#95a5a6` | ◇ |
| 3 | VERBÜNDET | Grün `#27ae60` | ✦ |
| 4 | ERSTER_BERATER | Gold `#f1c40f` | ★ |

> **Kanonische Grenze:** Tier 4 bedeutet, dass der Spieler der *Erste Berater* der Fraktion ist –
> kein Mitglied, kein Anführer. Er kann Entscheidungen *einflüstern* (Beratungs-Mandate, §12
> FACTION_INTRODUCTION.md), aber die NPC-Fraktion entscheidet eigenständig. Die Gewichtung seiner
> Empfehlung hängt vom Staatsgebilde (`npc_factions.government_type`) und `advisor_trust` ab.

### Tier-Wechsel-Benachrichtigung

Jeder Tier-Wechsel löst ein **Journal-Event** aus (→ Kapitel 8).  
Der Wechsel von Tier 1 → 0 (KALT → FEINDSELIG) ist ein kritisches Ereignis mit
Warndialog.

---

## 5. Bonus/Malus-Katalog

Jeder Tier aktiviert oder deaktiviert einen **Modifier-Block** für das gesamte
Imperium des Spielers. Die Modifier werden als `source_type = 'faction_pressure'`
in `user_empire_modifiers` gespeichert.

### 5.1 Modifier-Schlüssel (modifier_key)

Folgende Schlüssel sind im System definiert und bereits durch `politics.php`
(empire_dynamic_effects) ausgewertet:

| Schlüssel | Einheit | Beschreibung |
|-----------|---------|-------------|
| `resource_output_mult` | Multiplikator (±%) | Ressourcenproduktion global |
| `food_output_mult` | Multiplikator (±%) | Nahrungsproduktion |
| `research_speed_mult` | Multiplikator (±%) | Forschungsgeschwindigkeit |
| `fleet_readiness_mult` | Multiplikator (±%) | Kampfbereitschaft der Flotte |
| `happiness_flat` | Flatt-Bonus (±Pkt) | Imperiums-Glück |
| `public_services_flat` | Flatt-Bonus (±Pkt) | Sozialdienste |
| `pop_growth_mult` | Multiplikator (±%) | Bevölkerungswachstum |
| `faction_pressure_mult` | Multiplikator | Skalierung aller Fraktions-Druckeffekte |

**Neue Schlüssel (Erweiterung):**

| Schlüssel | Einheit | Beschreibung |
|-----------|---------|-------------|
| `trade_income_mult` | Multiplikator (±%) | Handelseinnahmen dieser Fraktion |
| `spy_detection_flat` | Flatt-Bonus (±Pkt) | Spionage-Abwehr |
| `dark_matter_income_flat` | Flatt-Bonus (DM/h) | Dunkle-Materie-Einnahmen |
| `colony_stability_flat` | Flatt-Bonus (±Pkt) | Stabilitäts-Offset auf allen Kolonien |
| `invasion_penalty_mult` | Multiplikator | Angriffswert bei Invasionen erhöht/gesenkt |
| `quest_reward_mult` | Multiplikator (±%) | Belohnungs-Skalierung für Quests dieser Fraktion |

---

### 5.2 Modifier-Werte nach Tier

#### Tier 0 – FEINDSELIG

> Die Fraktion betrachtet den Spieler als Feind. Schiffe können aktiv angegriffen
> werden. Handelsrouten werden unterbrochen.

| Modifier-Schlüssel | Wert | Begründung |
|--------------------|------|-----------|
| `trade_income_mult` | −0.25 | Embargo / keine Handelsrouten |
| `colony_stability_flat` | −8 | Destabilisierungsaktionen |
| `spy_detection_flat` | −10 | Aktivspionage der Fraktion |
| `resource_output_mult` | −0.05 | Wirtschaftsdruck |
| `fleet_readiness_mult` | −0.05 | Morale-Einbruch durch offene Feindschaft |

> Zusatz: NPC-Flotten dieser Fraktion erhalten `attack_on_sight = true`.

---

#### Tier 1 – KALT

> Die Fraktion meidet den Spieler. Kein aktiver Angriff, aber kein Handel,
> keine Quests.

| Modifier-Schlüssel | Wert | Begründung |
|--------------------|------|-----------|
| `trade_income_mult` | −0.10 | Reduzierte Handelswilligkeit |
| `colony_stability_flat` | −3 | Latente Spannungen |

---

#### Tier 2 – NEUTRAL (Basis, keine Modifier aktiv)

> Keine aktiven Boni oder Mali. Basis-Handels- und Quest-Angebote verfügbar.

---

#### Tier 3 – VERBÜNDET

> Aktive Kooperation. Handelsrouten, Missionen und diplomatische Unterstützung.

| Modifier-Schlüssel | Wert | Begründung |
|--------------------|------|-----------|
| `trade_income_mult` | +0.12 | Bevorzugter Handelspartner |
| `quest_reward_mult` | +0.15 | Fraktionsbelohnungen erhöht |
| `spy_detection_flat` | +8 | Geheimdienstkooperation |
| `happiness_flat` | +3 | Öffentliche Sympathie für die Allianz |

---

#### Tier 4 – STRATEGISCHER PARTNER

> Höchste Vertrauensstufe. Exklusive Technologien, Verteidigungspakte, Sondermissionen.

| Modifier-Schlüssel | Wert | Begründung |
|--------------------|------|-----------|
| `trade_income_mult` | +0.25 | Exklusive Handelsabkommen |
| `quest_reward_mult` | +0.30 | Strategische Sonderaufträge |
| `spy_detection_flat` | +15 | Geteiltes Geheimdienstnetzwerk |
| `research_speed_mult` | +0.08 | Forschungsaustausch |
| `dark_matter_income_flat` | +15 | Dunkle-Materie-Handelsprotokolle |
| `colony_stability_flat` | +5 | Konvergenz-Stabilisierungsprogramme |
| `happiness_flat` | +5 | Diplomatischer Prestigegewinn |

---

### 5.3 Fraktions-spezifische Bonus-Schwerpunkte

Abhängig vom Fraktions-Typ (`npc_factions.type`) haben einzelne Modifier mehr
Gewicht:

| Fraktions-Typ | Verstärkter Bonus (Tier 4) | Verstärkter Malus (Tier 0) |
|---------------|----------------------------|----------------------------|
| `military` | `fleet_readiness_mult` +0.10 extra | `invasion_penalty_mult` +0.20 |
| `trade` | `trade_income_mult` +0.15 extra | Handelsembargo (-0.35 gesamt) |
| `science` | `research_speed_mult` +0.12 extra | Forschungsblockade (−0.10) |
| `pirate` | (kein Tier-4 möglich, max Tier 3) | `spy_detection_flat` −20 |
| `ancient` | `dark_matter_income_flat` +25 extra | `colony_stability_flat` −12 |
| `espionage` | `spy_detection_flat` +20 extra | `spy_detection_flat` −25 |

---

## 6. Fraktions-Druck-System

Inspiriert von **Victoria 3 Interest Groups**:

### 6.1 Druck-Berechnung

Fraktionen mit `power_level >= 6` sind **Großmächte** und üben permanenten
Druck aus. Der **Druckwert** einer Fraktion berechnet sich aus:

```
pressure_weight = power_level / 10.0          # 0.6 – 1.0 für Großmächte
tier_modifier   = tier_pressure_table[tier]   # Tabelle unten
effective_pressure = pressure_weight × tier_modifier
```

**Tier-Druck-Tabelle:**

| Tier | `tier_modifier` | Bedeutung |
|------|----------------|-----------|
| 0 (Feindselig) | −1.0 | Voller negativer Druck |
| 1 (Kalt) | −0.4 | Moderater negativer Druck |
| 2 (Neutral) | 0.0 | Kein Druck |
| 3 (Verbündet) | +0.5 | Moderater positiver Druck |
| 4 (Strategisch) | +1.0 | Voller positiver Druck |

### 6.2 Aggregierter Imperiums-Druck

Der **Netto-Imperiumsdruck** ist die Summe aller aktiven `effective_pressure`-Werte:

```
net_pressure = Σ (effective_pressure_i)  für alle Großmächte i
```

Der `net_pressure`-Wert beeinflusst global `colony_stability_flat` und `happiness_flat`:

| Net Pressure | Stabilitäts-Offset | Glücks-Offset | Label |
|-------------|-------------------|---------------|-------|
| > +3.0 | +8 | +4 | Pax Galactica |
| +1.0 … +3.0 | +4 | +2 | Stabilität |
| −1.0 … +1.0 | 0 | 0 | Gleichgewicht |
| −1.0 … −3.0 | −5 | −3 | Instabilität |
| < −3.0 | −12 | −8 | Galaktische Krise |

### 6.3 Dämpfungs-Mechanismen

Der Spieler kann den negativen Druck durch folgende Mechanismen senken:

| Mechanismus | Wirkung |
|-------------|---------|
| Civic `adaptive_bureaucracy` | `faction_pressure_mult` −20 % auf alle Druckwerte |
| Civic `diplomatic_corps` (neu) | Großmacht-Druckgewicht −0.2 |
| Quest-Abschluss einer Großmacht | Temporärer Druck-Nullifier (+24h) |
| Diplomatiegespräch (LLM-Dialog, Tier ≥ 3) | Pressure-Cooldown 6h |
| Regierungsform `stellar_republic` | `happiness_flat` −Effekt halbiert |

---

## 7. Modifier-Quellen & Trigger

### 7.1 Stehungs-ändernde Aktionen

Folgende Aktionen ändern den Stehungswert in `diplomacy.standing` und können
einen Tier-Wechsel auslösen:

| Aktion | Stehungs-Delta | API-Endpunkt |
|--------|---------------|-------------|
| Quest abgeschlossen | +5 … +20 (je Schwierigkeit) | `factions.php?action=claim_quest` |
| Handel angenommen | +2 … +8 | `factions.php?action=accept_trade` |
| Piraten-Überfall (Fraktion) | −3 | `npc_ai.php` |
| Spieler greift NPC-Flotte an | −10 … −25 | `fleet.php` |
| LLM-Dialogerfolg | +1 … +5 | `factions.php?action=dialogue` |
| Galaktisches Ereignis (Krieg) | −5 … −15 (militärische Fraktionen) | `npc_ai.php` tick |
| Galaktisches Ereignis (Handelsboom) | +5 (Handelsfraktionen) | `npc_ai.php` tick |
| Täglicher Verfall | ±1 (Richtung `base_diplomacy`) | `npc_ai.php` tick |
| Spionagemission erfolgreich (eigene) | −8 (Zielfraktion) | geplant |
| Spionagemission aufgedeckt | −15 (Zielfraktion) | geplant |

### 7.2 Tier-Wechsel-Hysterese

Um schnelles Hin- und Herschalten zwischen Tiers zu vermeiden, wird eine
**Hysterese** von 3 Punkten eingeführt:

```
Aufstieg: Tier-Wechsel nach oben nur wenn standing > Schwellenwert + 3
Abstieg:  Tier-Wechsel nach unten nur wenn standing < Schwellenwert - 3
```

### 7.3 Modifier-Lebensdauer

Tier-gebundene Modifier sind **permanent aktiv** solange der Tier unverändert bleibt.
Beim Tier-Wechsel werden alte Modifier dieser Fraktion gelöscht und neue gesetzt:

```sql
DELETE FROM user_empire_modifiers
WHERE user_id = ? AND source_type = 'faction_pressure' AND source_key = ?;

INSERT INTO user_empire_modifiers (...) VALUES (...);
```

---

## 8. Ereignis-Integration

### 8.1 Journal-Einträge (Victoria 3 Journal-Events)

Das bestehende `Journal`-System (`EventSystem.js`) wird um fraktionsbezogene
Journal-Einträge erweitert:

#### Beispiel: „Eisernes Bündnis" (Vor'Tak, Tier 4)

```javascript
evtSys.defineJournalEntry({
  id: 'journal.vort_tak.iron_pact',
  title: "Eisernes Bündnis – Vor'Tak",
  body: "Durch konsequente Waffenbrüderschaft habt Ihr das volle Vertrauen " +
        "der Vor'Tak gewonnen. Ihr könnt nun ihre Eliteflotten in Schlachten anfordern.",
  condition: (gs) => gs.getFactionTier('vor_tak') >= 4,
  reward: { modifier: 'fleet_readiness_mult', value: 0.05, duration: null }
});
```

#### Beispiel: „Handelsembargo" (Helion-Konföderation, Tier 0)

```javascript
evtSys.defineJournalEntry({
  id: 'journal.helion.embargo',
  title: "Handelsembargo – Helion-Konföderation",
  body: "Die Helion-Konföderation hat alle Handelsrouten zu Eurem Imperium " +
        "geschlossen. Eure Handelseinnahmen sinken drastisch.",
  condition: (gs) => gs.getFactionTier('helion_confederation') === 0,
  onTrigger: (gs) => gs.applyModifier('trade_income_mult', -0.25, 'helion_embargo')
});
```

### 8.2 Galaktische Ereignisse und ihr Einfluss auf Tiers

Bestehende galaktische Ereignisse (`npc_ai.php`, `faction_event:active_type`) können
nun direkt Stehungen verschieben und dadurch Tier-Wechsel auslösen:

| Galaktisches Ereignis | Betroffene Fraktionen | Stehungs-Delta |
|-----------------------|----------------------|----------------|
| `galactic_war` | militärische/Piraten: Aggression ↑ | −5 ggü. Kriegstreibern |
| `trade_boom` | Handelsfraktionen | +8 |
| `pirate_surge` | Khar'Morr-Syndikate | −10 |
| `ancient_awakening` | Aethernox, Omniscienta | −8 (alle) |
| `diplomatic_summit` | alle Fraktionen | +3 |
| `faction_unchecked_action` *(neu)* | NPC-Fraktion + betroffene Spieler-Cluster | −0.05 `fleet_readiness_mult` / 48h |
| `faction_advisor_success` *(neu)* | NPC-Fraktion + betroffene Spieler-Cluster | +0.05 `trade_income_mult` / 72h |

> **Neue Ereignistypen** entstehen durch das Beratungs-Mandat-System (FACTION_INTRODUCTION.md §12.9).
> Sie werden in der neuen Tabelle `galactic_events` gespeichert und vom `npc_ai`-Tick verteilt.

### 8.3 Diplomatische Ereignisse (neue Event-Kategorie)

Eine neue `EventType.DIPLOMATIC` Kategorie für das EventSystem:

```javascript
// Neue Kategorie in EventSystem.js
EventType.DIPLOMATIC = 'diplomatic';

// Beispiel-Event
evtSys.define({
  id: 'diplomatic.vor_tak.honor_challenge',
  type: EventType.DIPLOMATIC,
  title: "Ehrenherausforderung – Vor'Tak",
  body: "General Drak'Mol fordert Euer Imperium zu einem rituellen Kampf heraus. " +
        "Eine Ablehnung wäre eine Beleidigung.",
  condition: (gs) => gs.getFactionTier('vor_tak') === 1,
  weight: 0.4,
  choices: [
    {
      label: "Die Herausforderung annehmen (+15 Standing, −50 Schiffe)",
      cost: { ships: 50 },
      effect: (gs) => gs.changeFactionStanding('vor_tak', +15)
    },
    {
      label: "Ablehnen (−8 Standing)",
      effect: (gs) => gs.changeFactionStanding('vor_tak', -8)
    },
    {
      label: "Geschenk anbieten (−500 Credits, +5 Standing)",
      cost: { credits: 500 },
      effect: (gs) => gs.changeFactionStanding('vor_tak', +5)
    }
  ]
});
```

---

## 9. NPC-Fraktionsverhalten pro Tier

### 9.1 Verhaltens-Matrix

Abhängig vom Tier ändert sich das aktive NPC-Verhalten in `npc_ai.php`:

| Tier | NPC-Flotten-Verhalten | Handelsangebote | Quest-Angebote | Spionage gegen Spieler |
|------|----------------------|-----------------|----------------|------------------------|
| 0 – Feindselig | `attack_on_sight = true` | Embargo | Keine | Aktiv (jede Stunde) |
| 1 – Kalt | Patrouille, kein Angriff | Keine neuen | Keine | Gelegentlich (täglich) |
| 2 – Neutral | Passiv | Basis | Basis | Passiv (wöchentlich) |
| 3 – Verbündet | Schutz-Patrouille | Erweitert | Erweitert | Keine |
| 4 – Strategisch | Assistenz auf Anfrage | Exklusiv | Strategische Quests | Unterstützt Spieler |

### 9.2 Tier-0-Aktionen (Feindselig)

Wenn Tier 0 aktiv ist und `power_level >= 5`, kann die Fraktion folgende Aktionen
ausführen (gesteuert durch `npc_ai_tick()`):

- **Piraten-Überfall** auf Kolonien (1× pro 6h)
- **Blockade** von Handelssektoren (reduziert `trade_income_mult` zusätzlich)
- **Spionagemission** gegen den Spieler (enttarnt Flottenpositionen)
- **Propagandafeldzug** (senkt `happiness_flat` −3 für 24h)

### 9.3 Tier-4-Aktionen (Strategischer Partner)

Exklusive Aktionen verfügbar bei Tier 4:

- **Flottenverstärkung anfordern** (NPC-Flotte begleitet Spieler für 1 Mission)
- **Technologieaustausch** (einmalig: Forschungspunkte +500)
- **Geheimdienstbriefing** (Aufdecken aller feindlichen Spione)
- **Strategische Ressource** (einmalige Lieferung: 100 Dunkle Materie)
- **Friedensvertrag-Vermittlung** (kann Tier-0-Fraktion auf Tier 1 heben, Kosten: 1000 Credits)

---

## 10. Frontend-Spezifikation

### 10.1 Fraktions-Panel (Erweiterung)

Das bestehende Fraktions-Panel in `js/game.js` wird um folgende Elemente erweitert:

#### Tier-Badge

```
┌─────────────────────────────────────────────────┐
│  [Icon] Vor'Tak                    [✦ VERBÜNDET] │
│  Standing: 45 / 100      ████████░░░░░░░░░░░░    │
│                          ───────|─────────────   │
│                          Nächster Tier bei +60   │
│                                                   │
│  Aktive Boni:                                    │
│  • Handel +12%           ✦ +0.12 trade_income    │
│  • Spionageabwehr +8     ✦ +8 spy_detection      │
│  • Quest-Belohnungen +15%                        │
└─────────────────────────────────────────────────┘
```

**Implementierung mit GQUI:**
```javascript
// Tier-Badge (farbkodiert nach Tier)
const tierBadge = GQUI.span()
  .text(TIER_LABELS[tier])
  .style({ color: TIER_COLORS[tier], fontWeight: 'bold' });

// Standing-Progressbar mit Tier-Markierungen
const bar = GQUI.div().class('standing-bar')
  .append(GQUI.div().class('bar-fill').style({ width: `${pct}%` }))
  .append(GQUI.div().class('tier-marker').style({ left: `${nextTierPct}%` }));
```

### 10.2 Imperiums-Modifier-Übersicht

Ein neues **Modifier-Panel** in den Statistiken zeigt alle aktiven Modifikationen
nach Quelle aggregiert:

```
┌────────────────────────────────────────────────────────┐
│  IMPERIUMS-MODIFIKATOREN                    [?]       │
├──────────────────────────┬─────────┬──────────────────┤
│  Quelle                  │ Typ     │ Wert             │
├──────────────────────────┼─────────┼──────────────────┤
│  Vor'Tak (Verbündet)     │ Handel  │ +12%             │
│  Vor'Tak (Verbündet)     │ Quests  │ +15%             │
│  Helion (Feindselig)     │ Handel  │ −25%             │
│  Helion (Feindselig)     │ Stabilit│ −8 Pkt           │
│  Spezies: Gene Crafters  │ Nahrung │ +10%             │
│  Civic: Meritocracy      │ Produk. │ +5%              │
├──────────────────────────┼─────────┼──────────────────┤
│  Netto: Handel           │         │ −13%             │
│  Netto: Stabilität       │         │ −8 Pkt           │
└──────────────────────────┴─────────┴──────────────────┘
```

### 10.3 Tier-Wechsel-Benachrichtigung

Bei jedem Tier-Wechsel wird eine **Toast-Benachrichtigung** (4s) angezeigt:

```
┌────────────────────────────────────────────────────────┐
│  ✦  Beziehung verbessert!                              │
│     Vor'Tak: KALT → VERBÜNDET                         │
│     Neue Boni: Handel +12%, Quest-Belohnungen +15%    │
└────────────────────────────────────────────────────────┘
```

Kritischer Tier-Wechsel (→ Feindselig) zeigt einen **modalen Warndialog**:

```
┌────────────────────────────────────────────────────────┐
│  ⚠  KRITISCHE WARNUNG                                  │
│     Helion-Konföderation: Beziehung auf FEINDSELIG     │
│                                                         │
│  Folgen:                                               │
│  • Handelsembargo aktiv (−25% Handelseinnahmen)        │
│  • Aktive Destabilisierungsaktionen (−8 Stabilität)    │
│  • NPC-Flotten greifen ggf. auf Sicht an              │
│                                                         │
│           [Verstanden]  [Zur Fraktion]                 │
└────────────────────────────────────────────────────────┘
```

### 10.4 Galaktische Druckanzeige

Im Hauptdashboard / Statistik-Panel: **Netto-Druckindikator** (analog zu
Victoria 3s Stabilitätsbalken):

```
GALAKTISCHER DRUCK:  [ ██████░░░░ ]  +1.8  →  Stabilität  (+4 Stab, +2 Glück)
```

### 10.5 Fraktions-Druck-Detailansicht

Expandierbare Sektion unter dem Druckindikator:

```
  Großmächte (power_level ≥ 6):
  ──────────────────────────────────────────
  Vor'Tak        [✦ Verbündet]   Druck: +0.60
  Aethernox      [◇ Neutral]     Druck:  0.00
  Omniscienta    [☠ Feindselig]  Druck: −0.90
  Eisenflotte    [❄ Kalt]        Druck: −0.28
  ──────────────────────────────────────────
  Netto-Druck:                          −0.58
  Effekt: Gleichgewicht (keine Modifier)
```

---

## 11. Backend-Spezifikation

### 11.1 Neue Datenbanktabelle: `faction_tier_modifiers`

Katalog-Tabelle, die die Modifier pro Tier und Fraktions-Typ speichert:

```sql
CREATE TABLE IF NOT EXISTS faction_tier_modifiers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_type ENUM(
        'military','trade','science','pirate','ancient',
        'spiritual','espionage','archival','metamorphic',
        'primal_ai','post_organic_ai','void_entity',
        'schismatic','cult','military_human','trade_faction',
        'default'
    ) NOT NULL DEFAULT 'default',
    tier TINYINT UNSIGNED NOT NULL COMMENT '0=hostile … 4=strategic_partner',
    modifier_key VARCHAR(64) NOT NULL,
    modifier_value DECIMAL(9,4) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ftm_type_tier (faction_type, tier),
    INDEX idx_ftm_key (modifier_key)
) ENGINE=InnoDB;
```

### 11.2 Erweiterung `npc_factions`

Neue Spalten für die Tier-Berechnung:

```sql
ALTER TABLE npc_factions
    ADD COLUMN IF NOT EXISTS tier_hostile_threshold  SMALLINT NOT NULL DEFAULT -41
        COMMENT 'Standing-Grenze für Tier 0 (Feindselig)',
    ADD COLUMN IF NOT EXISTS tier_cold_threshold     SMALLINT NOT NULL DEFAULT -11
        COMMENT 'Standing-Grenze für Tier 1 (Kalt)',
    ADD COLUMN IF NOT EXISTS tier_allied_threshold   SMALLINT NOT NULL DEFAULT  21
        COMMENT 'Standing-Grenze für Tier 3 (Verbündet)',
    ADD COLUMN IF NOT EXISTS tier_partner_threshold  SMALLINT NOT NULL DEFAULT  61
        COMMENT 'Standing-Grenze für Tier 4 (Strategisch)';
```

> Fraktionen können so individuelle Tier-Schwellen haben. Piraten etwa könnten
> `tier_allied_threshold = 40` haben (schwerer zu beeindrucken).

### 11.3 Erweiterung `diplomacy`

Cache der aktuellen Tier-Stufe für schnelle Abfragen ohne Neuberechnung:

```sql
ALTER TABLE diplomacy
    ADD COLUMN IF NOT EXISTS current_tier TINYINT UNSIGNED NOT NULL DEFAULT 2
        COMMENT '0=hostile,1=cold,2=neutral,3=allied,4=strategic',
    ADD COLUMN IF NOT EXISTS tier_changed_at DATETIME DEFAULT NULL;
```

### 11.4 Neue PHP-Hilfsfunktionen (`game_engine.php`)

```php
/**
 * Berechnet den Reputations-Tier anhand von Standing und Fraktions-Schwellen.
 */
function get_reputation_tier(PDO $db, int $userId, int $factionId): int;

/**
 * Aktualisiert den Tier, schreibt Modifier, loggt Tier-Wechsel.
 * Gibt true zurück wenn sich der Tier geändert hat.
 */
function sync_faction_tier_modifiers(PDO $db, int $userId, int $factionId): bool;

/**
 * Berechnet den aggregierten Netto-Imperiumsdruck aller Großmächte.
 */
function compute_net_faction_pressure(PDO $db, int $userId): float;

/**
 * Gibt alle aktiven Fraktions-Modifier eines Spielers zurück (für UI).
 */
function get_faction_modifiers_summary(PDO $db, int $userId): array;
```

### 11.5 Integration in bestehende Endpunkte

| Endpunkt | Änderung |
|----------|---------|
| `factions.php?action=list` | Rückgabe: `current_tier`, `tier_label`, `tier_color`, `active_modifiers` |
| `factions.php?action=claim_quest` | Aufruf: `sync_faction_tier_modifiers()` nach Standing-Update |
| `factions.php?action=accept_trade` | Aufruf: `sync_faction_tier_modifiers()` |
| `npc_ai.php` (tick) | Aufruf: `sync_faction_tier_modifiers()` nach Decay/Event |
| `politics.php?action=status` | Ergänze: `net_faction_pressure`, `pressure_label` |
| `game.php?action=overview` | Ergänze: `faction_pressure_summary` im Payload |

### 11.6 Migrations-Datei

Eine neue Migration `migrate_bonus_malus_v1.sql` erstellt alle neuen Tabellen und
füllt den `faction_tier_modifiers`-Katalog mit den Standardwerten aus Kapitel 5.2
und 5.3.

### 11.7 Neue API-Aktion: `factions.php?action=tier_modifiers`

```
GET /api/factions.php?action=tier_modifiers
```

Rückgabe für alle 19 Fraktionen (6 Hauptfraktionen + 13 NPC-Fraktionen): `faction_id`, `current_tier`, `tier_label`,
`active_modifiers[]`, `net_faction_pressure`, `pressure_label`.

---

## 12. Balancing-Richtlinien

### 12.1 Modifier-Obergrenzen (Caps)

Um Stapeleffekte mehrerer verbündeter Fraktionen zu begrenzen:

| Modifier-Schlüssel | Max. kumulativer Wert |
|--------------------|----------------------|
| `trade_income_mult` | +0.50 / −0.50 |
| `research_speed_mult` | +0.25 / −0.20 |
| `fleet_readiness_mult` | +0.30 / −0.25 |
| `happiness_flat` | +15 / −20 |
| `colony_stability_flat` | +15 / −20 |
| `spy_detection_flat` | +30 / −30 |

Die Cap-Anwendung erfolgt in `empire_dynamic_effects()` (`game_engine.php`).

### 12.2 Stehungs-Decay

Bestehender Decay (±1/Stunde Richtung `base_diplomacy`) bleibt unverändert.  
Neue Regel: Wenn Tier 0 aktiv ist, beschleunigt sich der Decay auf −2/Stunde
(falls Standing < base_diplomacy), um Feindschaft als Dauerzustand zu erschweren.

### 12.3 Tier-Wechsel-Cooldown

Nach einem Tier-Wechsel gilt für 30 Minuten ein **Cooldown**, in dem kein
weiterer Wechsel in dieselbe Richtung möglich ist.  
Dies verhindert Spam-Handel zum schnellen Tier-Cycling.

### 12.4 Kosten Tier 4 (Strategischer Partner)

Das Erreichen von Tier 4 sollte ~8–12h aktives Spielen mit einer Fraktion
erfordern. Richtwert für Stehungs-Aufbau:

- 6 abgeschlossene Quests (Ø +10 je) = +60 → Tier 3
- 3 Strategische Quests (Ø +15 je) = +45 → Tier 4-Bereich
- Kumulierter Handelsverlauf: +30 möglich
- Gesamt realistisch: ~25–40h ohne Handel, ~10–15h mit Handelsfokus

### 12.5 Piratenfraktionen & Tier-3-Obergrenze

Piraten (`type = 'pirate'`) können maximal **Tier 3** erreichen.
Tier 4 bleibt ihnen strukturell verwehrt, da ein vollständiges strategisches
Vertrauen ihrem Charakter widerspricht.

---

## 13. Implementierungs-Phasen

### Phase 1 – Datenbankfundament & Tier-Logik (Backend)

- [ ] Migration `migrate_bonus_malus_v1.sql` erstellen (neue Tabellen + Katalogdaten)
- [ ] `npc_factions`-Spalten `tier_*_threshold` befüllen
- [ ] `diplomacy`-Spalten `current_tier`, `tier_changed_at` hinzufügen
- [ ] PHP-Hilfsfunktionen `get_reputation_tier()` / `sync_faction_tier_modifiers()` in `game_engine.php`
- [ ] Integration in `npc_ai.php` Tick (Modifier-Sync nach Stehungsänderung)
- [ ] Unit-Tests für Tier-Berechnung und Modifier-Sync

### Phase 2 – API-Erweiterung

- [ ] `factions.php?action=list` um Tier-Daten erweitern
- [ ] Neue Aktion `factions.php?action=tier_modifiers`
- [ ] `politics.php?action=status` um Fraktionsdruck erweitern
- [ ] `game.php?action=overview` um `faction_pressure_summary` erweitern
- [ ] Modifier-Caps in `empire_dynamic_effects()` implementieren

### Phase 3 – Frontend (UI)

- [ ] Tier-Badge und Progressbar im Fraktions-Panel (`js/game.js`)
- [ ] Modifier-Übersichtsfeld in Statistiken
- [ ] Toast-Benachrichtigung bei Tier-Wechsel
- [ ] Modaler Warndialog bei Tier-0-Wechsel
- [ ] Galaktischer Druckindikator im Dashboard
- [ ] Fraktions-Druck-Detailansicht

### Phase 4 – Ereignis-Integration

- [ ] `EventType.DIPLOMATIC` in `EventSystem.js` hinzufügen
- [ ] Journal-Einträge für Tier-4-Errungenschaften (eine je Haupt-Fraktion)
- [ ] Journal-Einträge für Tier-0-Krisen
- [ ] Diplomatische Events (Herausforderungen, Angebote) definieren
- [ ] Galaktische Ereignisse (`npc_ai.php`) mit Tier-Verschiebungen verknüpfen

### Phase 5 – NPC-Verhaltens-Erweiterung

- [ ] `attack_on_sight`-Flag für Tier-0-Fraktionen in `npc_ai.php`
- [ ] Tier-4-Sonderaktionen (Flottenverstärkung, Technologieaustausch)
- [ ] Tier-0-Aktionen (Blockade, Propagandafeldzug)
- [ ] Balancing-Pass & Playtesting

### Phase 6 – Zuckerbrot & Peitsche: Mandats-System *(FACTION_INTRODUCTION.md §12)*

- [ ] Migration `faction_mandates`-Tabelle (erweitert mit `mandate_class`, `advice_*`, `ripple_event_fired`) + `diplomacy`-Spalten `influence_tier` / `neglect_count` / `advisor_accepted` / `advisor_trust` / `advisor_anonymous` (§12.7)
- [ ] Migration `npc_factions.government_type` + `advisor_weight_min/max` (§12.1a)
- [ ] Migration `galactic_events`-Tabelle (§12.9.1)
- [ ] `npc_ai.php`: Mandats-Generierung (`resource` für Tier 3, `advisory` für Tier 4) + `advisor_accepted`-Trigger (§12.1)
- [ ] Berater-Gewichtungs-Formel in `game_engine.php`: `effective_weight` aus `government_type` + `advisor_trust` (§12.1a)
- [ ] Staatsgebilde-Multiplikatoren für Zuckerbrot/Peitsche in `game_engine.php` (§12.3 / §12.4.2)
- [ ] Multiplayer-Ripple: `ripple_event_fired`-Logik + `galactic_events`-INSERT + Modifier-Verteilung in `npc_ai.php` (§12.9)
- [ ] Grace-Period-Logik + Ripple-Unterdrückung im `npc_ai`-Tick (§12.4.5)
- [ ] `api/factions.php`: `list_mandates` + `resolve_mandate` (mit `advice_choice`) + `mandate_history` + `advisor_status` (§12.7)
- [ ] `EventSystem.js`: Journal-Events für Mandatseingang / Ablauf / Berater-Ernennung / Berater-Verlust / Ripple-Ankündigung (§12.9.3)
- [ ] `js/game.js`: Mandats-Panel (Liste, Countdown, Empfehlungs-UI A/B/C für Advisory, `advisor_trust`-Anzeige, `effective_weight`-Indikator)
- [ ] `config/config.php`: Balancing-Konstanten §12.6 + Tuning-Pass

---

## 14. Offene Fragen & Ausblick

| Thema | Frage | Vorschlag |
|-------|-------|-----------|
| **Multi-Spieler** | Beeinflussen Allianz-Mitglieder den Tier eines anderen Mitglieds? | Ja: Alliance-Durchschnitt ±20% auf Modifier |
| **Fraktions-Koalitionen** | Kann Tier 4 mit Fraktion A den Tier bei Fraktion B senken? | Ja für verfeindete Fraktionen (FACTION_RELATIONS.yaml `enemy_of`) |
| **LLM-Dialogeinfluss** | Wie stark kann der LLM-Dialog Stehung ändern? | Tägliches Cap: ±10 via Dialog |
| **Achievements** | Soll es Achievements für alle 6 Hauptfraktionen auf Tier 4 geben? | Ja: „Kalytherion-Einheit"-Achievement |
| **Tier-Rückkehr** | Was passiert wenn Tier 4 verloren geht (Stehung unter Schwelle)? | Einmaliger Grace-Period-Event „Vertrauensverlust" (+24h Stabilisierungsfenster) |
| **Mobile UI** | Wie wird die Druckanzeige auf kleinen Screens dargestellt? | Kompakter Indikator-Balken ohne Detailaufschlüsselung |
| **Mandats-Konflikt** | Was wenn zwei Fraktionen gleichzeitig Mandate stellen, die sich widersprechen? | Spieler wählt eine; abgelehnte Fraktion erhält −5 Standing ohne neglect_count-Anstieg (explizite Ablehnung); vollständige Spezifikation siehe FACTION_INTRODUCTION.md §12 |
| **Mandat + Isolation** | Erhalten Spieler auf dem Isolationspfad (§11.3) Mandate von Hauptfraktionen? | Nein: Sobald `isolation_path_active = 1`, senden Hauptfraktionen keine neuen Mandate; laufende Mandate werden EXPIRED ohne Peitsche |
| **Staatsgebilde-Wechsel** | Kann eine NPC-Fraktion ihr Staatsgebilde ändern (z.B. durch Spieler-Handlung)? | Ja, als seltenes galaktisches Ereignis; `government_type`-Änderung invalidiert laufenden `effective_weight`; Spieler wird benachrichtigt |
| **Berater + Multiplayer** | Wenn Spieler A Erster Berater ist und Spieler B ebenfalls Stufe 4 hat – wer ist der „echte" Berater? | Beide sind Berater; NPC gewichtet beide Empfehlungen; bei Konflikt gewinnt höherer `advisor_trust`; bei Gleichstand: Zufallsentscheid mit 50/50 |
| **Ripple-Fairness** | Können Spieler missbräuchlich Ripple-Events durch andere Spieler auslösen? | Ripple nur bei `neglect_count ≥ 3` + EXPIRED Beratungsmandat; 1/24h-Cap pro Fraktion; kein aktives Missbrauchs-Werkzeug |
| **Autokratie + Berater** | Was passiert wenn ein Autokrat-Anführer stirbt/ersetzt wird? | `advisor_accepted` → 0; neuer Anführer muss Berater neu bestätigen (automatisches Beratungs-Mandat: „Loyalitätstest") |

---

## Abhängigkeits-Übersicht

```
migrate_politics_model_v1.sql
    └─► user_empire_modifiers  ◄── empire_dynamic_effects() (politics.php)
                                        ▲
migrate_bonus_malus_v1.sql (neu)        │
    └─► faction_tier_modifiers          │
    └─► diplomacy.current_tier ─────────┤
                                        │
migrate_npc_factions_hardreplace_v1.sql │
    └─► npc_factions (code-Rename)      │
    └─► npc_factions.government_type ───┤  ← §12.1a Staatsgebilde
    └─► diplomacy.influence_tier ───────┤
    └─► diplomacy.neglect_count         │
    └─► diplomacy.advisor_accepted      │
    └─► diplomacy.advisor_trust ────────┤  ← §12.3 effective_weight-Bonus
    └─► diplomacy.advisor_anonymous     │
    └─► faction_mandates ───────────────┤
    └─► galactic_events ────────────────┤  ← §12.9 Multiplayer-Ripple
                                        │
npc_ai.php (tick)                       │
    └─► sync_faction_tier_modifiers() ──┤
    └─► generate_faction_mandates() ────┤
    └─► expire_pending_mandates() ──────┤
    └─► compute_npc_decision() ─────────┤  ← government_type + advisor_trust
    └─► fire_ripple_event() ────────────┤  ← galactic_events INSERT
            └─► user_empire_modifiers (INSERT/DELETE)

factions.php (list/claim_quest/accept_trade/resolve_mandate/advisor_status)
    └─► sync_faction_tier_modifiers()
    └─► apply_mandate_reward() / apply_mandate_penalty()
    └─► compute_effective_weight()          ← government_type + advisor_trust

EventSystem.js (Frontend)
    └─► defineJournalEntry() für Tier-Wechsel-Events
    └─► defineJournalEntry() für Mandats-Events (eingang/ablauf/loyalität/berater-ernennung)
    └─► defineJournalEntry() für Ripple-Ankündigungen (§12.9.3)

js/game.js (FactionPanel)
    └─► GET /api/factions.php?action=tier_modifiers
    └─► GET /api/factions.php?action=list_mandates
    └─► GET /api/factions.php?action=advisor_status
    └─► POST /api/factions.php?action=resolve_mandate
    └─► Tier-Badge, Progressbar, Toast, Modal
    └─► Mandats-Panel (Resource: Accept/Decline/Partial)
    └─► Advisory-Panel (A/B/C Empfehlung, effective_weight-Anzeige, advisor_trust-Balken)
```

---

*Dieses Dokument wird mit der Implementierung fortgeschrieben.  
Änderungsanträge bitte als Issue mit Label `game-design` einreichen.*

---

## 15. NPC-Fraktions-Modifier-Tabellen (alle 13 Fraktionen)

Die 6 Hauptfraktionen werden in Kapitel 5.2/5.3 behandelt. Hier folgen die
**spezifischen Tier-Modifier** für alle 13 NPC-Fraktionen. Jede Tabelle zeigt
nur die **Abweichungen vom Standard** (Kapitel 5.2); Basis-Modifier gelten
ergänzend.

> **Kanonische Fraktionszahl (Stand 2026-04-01):** 11 ursprüngliche + 2 neu hinzugefügte = **13 NPC-Fraktionen**.
> Fraktionen 12 und 13 (Schattenkompakt, Genesis-Kollektiv) werden via Migration
> `migrate_npc_factions_hardreplace_v1.sql` eingefügt (Hard-Replace, siehe FACTION_INTRODUCTION.md §11.3.6).

---

### 15.1 Die Aethernox – Die Alten Wächter

**Typ:** `primal_ai` | **threat_level:** 9 | **Max. Tier:** 4  
**Beschreibung:** Algorithmisch-absolute Wesen aus der Vor-Konvergenz-Ära.  
Kontakt ist selten; Kooperation mit ihnen verändert das Universum dauerhaft.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `colony_stability_flat` | −12 | Aethernox-Purge-Protokolle |
| **0** | `spy_detection_flat` | −15 | Sensornetzwerke sabotiert |
| **0** | `dark_matter_income_flat` | −10 | DM-Kanäle versiegelt |
| **3 – Verbündet** | `research_speed_mult` | +0.08 | Zugang zu Vorzeit-Wissen |
| **3** | `dark_matter_income_flat` | +12 | Aethernox-Handelsprotokolle |
| **4 – Strategisch** | `research_speed_mult` | +0.15 | Exklusiver Technologietransfer |
| **4** | `dark_matter_income_flat` | +25 | Prä-Konvergenz-Handelsrouten |
| **4** | `colony_stability_flat` | +6 | Kosmische Balance |
| **4** | `spy_detection_flat` | +20 | Aethernox Sentinel-Netzwerk |

> **Besonderheit:** Tier 4 mit Aethernox schaltet die einmalige Quest
> „Protokoll Null" frei — Zugang zu einer verlorenen Vorzeit-Technologie.
> Schlägt der Spieler das Angebot aus, sinkt Standing sofort −25.

---

### 15.2 Die Khar'Morr-Syndikate

**Typ:** `pirate_faction` | **threat_level:** 6 | **Max. Tier:** 3  
**Beschreibung:** Opportunistische Chaos-Profiteure. Piratenfraktionen können
strukturell kein vollständiges strategisches Vertrauen aufbauen (→ Kap. 12.5).

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `trade_income_mult` | −0.20 | Blockade & Raub |
| **0** | `colony_stability_flat` | −6 | Aktive Überfälle |
| **0** | `spy_detection_flat` | −20 | Spionage-Netzwerk aktiv |
| **0** | _Raid-Frequenz_ | 4h | Raid auf Spieler-Kolonien |
| **1 – Kalt** | `trade_income_mult` | −0.08 | Gelegentliche Störungen |
| **3 – Verbündet** | `trade_income_mult` | +0.08 | Schmuggelrabatte |
| **3** | `spy_detection_flat` | +5 | Schwarzmarkt-Informanten |
| **3** | `resource_output_mult` | +0.03 | Günstige gestohlene Ressourcen |

> **Besonderheit:** Das Erreichen von Tier 3 mit Khar'Morr senkt automatisch
> den Standing bei Syl'Nar um −8 (diplomatischer Skandal).

---

### 15.3 Die Helion-Konföderation

**Typ:** `trade_faction` | **threat_level:** 3 | **Max. Tier:** 4  
**Beschreibung:** Wirtschaftlich dominierte Neutral-Macht.  
Reiner Handelsfokus: Tier-4-Boni sind ausschließlich wirtschaftlich.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `trade_income_mult` | −0.30 | Vollständiges Embargo |
| **0** | `public_services_flat` | −5 | Lieferkettenunterbrechung |
| **1 – Kalt** | `trade_income_mult` | −0.12 | Zollerhöhungen |
| **3 – Verbündet** | `trade_income_mult` | +0.18 | Bevorzugter Handelspartner |
| **3** | `public_services_flat` | +4 | Helion-Versorgungslieferungen |
| **3** | `happiness_flat` | +2 | Wirtschaftliche Stabilität |
| **4 – Strategisch** | `trade_income_mult` | +0.30 | Exklusiver Handelsvertrag |
| **4** | `public_services_flat` | +8 | Helion-Infrastrukturprogramm |
| **4** | `resource_output_mult` | +0.06 | Rohstofflieferverträge |
| **4** | `pop_growth_mult` | +0.04 | Migrationsprogramm |

> **Besonderheit:** Helion bietet als einzige Fraktion **direkte Credits-Transfers**
> als Trade-Offer an (via `trade_offers`-Tabelle). Tier-4-Spieler erhalten
> 2× tägliche Handelsangebote.

---

### 15.4 Die Eisenflotte der Menschen

**Typ:** `military_human` | **threat_level:** 7 | **Max. Tier:** 3  
**Beschreibung:** Expansionistisch-hostile Militärmacht. Strukturell feindlich
gegenüber allen Konvergenz-Fraktionen (`enemy_all_convergence: true` in YAML).  
Max. Tier 3, da echter Frieden aus Spielbalancegründen ausgeschlossen ist.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `fleet_readiness_mult` | −0.10 | Morale-Einbruch |
| **0** | `invasion_penalty_mult` | +0.25 | Eisenflotten-Invasionsdruck |
| **0** | `colony_stability_flat` | −8 | Besatzungsbedrohung |
| **0** | _Angriff auf Sicht_ | aktiv | Militärische Patrouille greift an |
| **1 – Kalt** | `fleet_readiness_mult` | −0.04 | Spannungen an der Grenze |
| **3 – Verbündet** | `fleet_readiness_mult` | +0.08 | Gemeinsame Manöver |
| **3** | `invasion_penalty_mult` | −0.10 | Nicht-Angriffspakt |
| **3** | `resource_output_mult` | +0.04 | Kriegswirtschaftsabkommen |

> **Besonderheit:** Tier 3 mit Eisenflotte senkt Standing aller 6 Hauptfraktionen
> um je −5 (diplomatischer Verrat). Syl'Nar und Vel'Ar reagieren besonders stark.

---

### 15.5 Die Omniscienta

**Typ:** `post_organic_ai` | **threat_level:** 9 | **Max. Tier:** 4  
**Beschreibung:** Post-organische KI mit eliminationistischer Logik.
Beziehung ist hochvolatil: Omniscienta kann ohne Warnung Entscheidungen revidieren.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `spy_detection_flat` | −20 | Omniscienta-Datennetz überwacht alles |
| **0** | `colony_stability_flat` | −10 | Assimilationsversuche |
| **0** | `research_speed_mult` | −0.08 | Forschungsblockade |
| **3 – Verbündet** | `research_speed_mult` | +0.12 | Technologiedatenaustausch |
| **3** | `spy_detection_flat` | +10 | KI-Überwachungsnetz |
| **4 – Strategisch** | `research_speed_mult` | +0.18 | Post-organische Forschungssynergie |
| **4** | `dark_matter_income_flat` | +20 | Quantenenergierouten |
| **4** | `spy_detection_flat` | +20 | Omniscienta-Sentinel aktiv |

> **Besonderheit:** Omniscienta kann spontan eine **Neubewertung** (unpredictable: true)
> triggern, die ohne Spieleraktion den Standing um −15 senkt. Dies geschieht
> 1× pro Ingame-Monat (zufällig). Spieler können dies durch das Civic
> `diplomatic_corps` auf 50% reduzieren.

---

### 15.6 Die Myr'Keth

**Typ:** `metamorphic_swarm` | **threat_level:** 7 | **Max. Tier:** 4  
**Beschreibung:** Adaptierende Schwarmwesen. Bündnis mit ihnen ist schwer
aufrechtzuerhalten, bietet aber einmalige Kolonievorteile.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `colony_stability_flat` | −8 | Assimilation von Kolonisten |
| **0** | `pop_growth_mult` | −0.06 | Schwarminfektionen |
| **0** | `food_output_mult` | −0.08 | Ernte-Assimilation |
| **3 – Verbündet** | `pop_growth_mult` | +0.08 | Schwarm-Wachstumsprotokoll |
| **3** | `resource_output_mult` | +0.05 | Myr'Keth-Ressourcen-Adaption |
| **4 – Strategisch** | `pop_growth_mult` | +0.14 | Schnelle Kolonisationsunterstützung |
| **4** | `food_output_mult` | +0.10 | Schwarm-Agrikultur |
| **4** | `colony_stability_flat` | +4 | Integrierte Schwarm-Patrol |

---

### 15.7 Die Echos der Leere

**Typ:** `void_entity` | **threat_level:** 10 | **Max. Tier:** 1  
**Beschreibung:** `enemy_all: true`. Die Echos sind eine transdimensionale
Bedrohung für alle Fraktionen. Diplomatie ist strukturell auf **Tier 0–1
begrenzt**. Selbst Tier 1 erfordert außergewöhnliche Ereignisse (Quest-Chain).

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `colony_stability_flat` | −15 | Leeren-Einfluss auf Kolonien |
| **0** | `fleet_readiness_mult` | −0.10 | Kosmische Horror-Demoralisierung |
| **0** | `spy_detection_flat` | −15 | Dimensional-Verschleierung |
| **0** | `happiness_flat` | −8 | Existenzielle Angst |
| **1 – Kalt** | `colony_stability_flat` | −5 | Latenter Leeren-Einfluss |
| **1** | `happiness_flat` | −3 | Residualangst |

> **Besonderheit:** Wenn Echos der Leere in 5 Sternensystemen präsent ist
> (game_state), wird `colony_stability_flat` um weitere −5 global verschlechtert
> (Stack-Effekt, unabhängig von Tier).
> Das Endgame-Szenario `void_consumption` wird ausgelöst, wenn keine der
> Hauptfraktionen > Tier 1 mit Echos ist.

---

### 15.8 Die Ketzer von Verath

**Typ:** `schismatic_faction` | **threat_level:** 3 | **Max. Tier:** 4  
**Beschreibung:** Verfolgen verbotenes Wissen über die Konvergenz-Gründung.  
Gefährlich für diplomatische Verhältnisse — hoher Tier bei Ketzern schadet
dem Standing mit konservativen Fraktionen.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `happiness_flat` | −5 | Propagandawellen |
| **0** | `research_speed_mult` | −0.04 | Forschungssabotage |
| **3 – Verbündet** | `research_speed_mult` | +0.08 | Verbotenes Wissen geteilt |
| **3** | `happiness_flat` | +2 | Intellektuelle Freiheitsbewegung |
| **4 – Strategisch** | `research_speed_mult` | +0.14 | Ketzer-Bibliotheken geöffnet |
| **4** | `spy_detection_flat` | +8 | Insider-Netzwerk in anderen Fraktionen |
| **4** | `dark_matter_income_flat` | +8 | Verborgene DM-Routen |

> **Besonderheit:** Tier 3+ mit Ketzern senkt Standing bei Architekten des
> Lichts (−10) und Syl'Nar (−5). Tier 4 mit Ketzern schaltet einmalig
> eine verborgene Quest-Chain frei: „Die Wahrheit der Konvergenz".

---

### 15.9 Die Architekten des Lichts

**Typ:** `cult_faction` | **threat_level:** 2 | **Max. Tier:** 4  
**Beschreibung:** Spirituelle Glaubensbewegung, die Aethernox als Götter
verehrt. Friedlich, aber manipulativ durch religiöse Einflussnahme.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `happiness_flat` | −6 | Religiöse Verurteilung |
| **0** | `colony_stability_flat` | −4 | Unruheagitation |
| **3 – Verbündet** | `happiness_flat` | +6 | Glaubensstabilität |
| **3** | `colony_stability_flat` | +4 | Seelsorge-Netzwerk |
| **4 – Strategisch** | `happiness_flat` | +10 | Tempel in allen Kolonien |
| **4** | `colony_stability_flat` | +8 | Starkes Glaubensfundament |
| **4** | `public_services_flat` | +5 | Licht-Wohlfahrtsprogramme |

> **Besonderheit:** Tier 4 mit Architekten erhöht Tier-Speed bei Aethernox um
> +20% (Glaubensvermittlung). Gleichzeitig: −8 Standing bei Ketzer von Verath
> (theologische Feindschaft).

---

### 15.10 Die Nomaden des Rifts

**Typ:** `dimension_nomads` | **threat_level:** 1 | **Max. Tier:** 4  
**Beschreibung:** Interdimensionale Wandervölker mit einzigartiger FTL-Technologie.
Bieten einmalige FTL-Boni und Dimensionskenntnis.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `dark_matter_income_flat` | −8 | Rift-Kanäle gesperrt |
| **0** | `colony_stability_flat` | −3 | Phasenshift-Störungen |
| **3 – Verbündet** | `dark_matter_income_flat` | +10 | Rift-Handelsrouten |
| **3** | _FTL-Cooldown-Mult_ | −0.15 | Rift-Navigation-Einblick |
| **4 – Strategisch** | `dark_matter_income_flat` | +18 | Exklusive Rift-Ressourcen |
| **4** | _FTL-Cooldown-Mult_ | −0.30 | Nomaden-Navigationssystem |
| **4** | `spy_detection_flat` | +12 | Interdimensionale Frühwarnung |
| **4** | `research_speed_mult` | +0.06 | Phasenphysik-Einblick |

> **Besonderheit:** `FTL-Cooldown-Mult` ist ein neuer Modifier-Schlüssel, der
> die FTL-Cooldown-Zeit in `users.ftl_cooldown_until` skaliert
> (−30% = 30% kürzere Cooldowns).

---

### 15.11 Die Brut der Ewigkeit

**Typ:** `eternal_brood` | **threat_level:** 6 | **Max. Tier:** 4  
**Beschreibung:** Uralte organische Schwarmwesen von kosmischer Skala.
Ähnlich den Myr'Keth, aber älterer Natur. Einzige Fraktion mit
**Terraforming-Kapazität** als Bonus.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `colony_stability_flat` | −12 | Kosmischer Horror-Einfluss |
| **0** | `food_output_mult` | −0.10 | Biosphären-Korrumpierung |
| **0** | `pop_growth_mult` | −0.08 | Biologische Kontamination |
| **3 – Verbündet** | `food_output_mult` | +0.10 | Brut-Agrikultur |
| **3** | `colony_stability_flat` | +3 | Uralt-Symbiose |
| **4 – Strategisch** | `food_output_mult` | +0.18 | Vollständige Biosphären-Kooperation |
| **4** | `pop_growth_mult` | +0.10 | Brut-Wachstumsprotokoll |
| **4** | `colony_stability_flat` | +6 | Planetare Uralt-Schutzschicht |
| **4** | _Terraforming-Speed-Mult_ | +0.25 | Brut-Terraforming-Unterstützung |

> **Besonderheit:** Tier 4 schaltet die **Terraforming-Kooperation** frei:
> Koloniegründung auf ungünstigen Planetentypen dauert 25% kürzer.
> Synergieeffekt mit Myr'Keth: Wenn beide auf Tier 3+, `pop_growth_mult` +0.04 zusätzlich.

---

### 15.12 Das Schattenkompakt *(Fraktion 12 – neu)*

**Typ:** `espionage` | **threat_level:** 5 | **Max. Tier:** 4  
**Beschreibung:** Ein galaktisches Netzwerk aus Informationsbrokern, Agenten und Doppelspionen.
Kein Territorium, keine Flotte – nur Wissen als Währung. Beziehungen sind immer ambivalent.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `spy_detection_flat` | −25 | Kompakt sabotiert Abwehrnetzwerke |
| **0** | `espionage_ops_cost_mult` | +0.30 | Gegensabotage aller Operationen |
| **1 – Kalt** | `spy_detection_flat` | −10 | Passive Informationsblockade |
| **2 – Neutral** | *(Basis-Modifier)* | — | — |
| **3 – Verbündet** | `spy_detection_flat` | +20 | Zugang zum Kompakt-Netzwerk |
| **3** | `espionage_ops_cost_mult` | −0.15 | Geteilte Operationsinfrastruktur |
| **4 – Strategisch** | `spy_detection_flat` | +35 | Vollständige Netzwerkintegration |
| **4** | `espionage_ops_cost_mult` | −0.25 | Kompakt übernimmt Operationslogistik |
| **4** | `dark_matter_income_flat` | +8 | Informationshandel mit DM-Vergütung |

> **Besonderheit:** Tier 3 mit Schattenkompakt schaltet die exklusive Aktion
> `espionage.php?action=shadow_broker` frei — einmalige Enthüllung aller aktiven
> Spionagenetze anderer Spieler in einer Region.
> Bei Tier 0: Eigene Agenten haben 30% Chance, als Doppelspion enttarnt zu werden.

---

### 15.13 Das Genesis-Kollektiv *(Fraktion 13 – neu)*

**Typ:** `metamorphic` | **threat_level:** 6 | **Max. Tier:** 4  
**Beschreibung:** Eine post-biologische Gemeinschaft aus Wesen, die ihren Körper als
designbare Schnittstelle begreifen. Technologie und Biologie sind für sie untrennbar.
Handelspartner, aber unberechenbar in Krisenzeiten.

| Tier | Modifier-Schlüssel | Wert | Kontext |
|------|--------------------|------|---------|
| **0 – Feindselig** | `research_speed_mult` | −0.10 | Technologie-Embargo |
| **0** | `pop_growth_mult` | −0.05 | Bio-Kontamination durch feindliche Nanostrukturen |
| **1 – Kalt** | `research_speed_mult` | −0.04 | Passive Wissensblockade |
| **2 – Neutral** | *(Basis-Modifier)* | — | — |
| **3 – Verbündet** | `research_speed_mult` | +0.10 | Zugang zu metamorphischer Biotechnologie |
| **3** | `pop_growth_mult` | +0.06 | Genesis-Wachstumsprotokolle |
| **4 – Strategisch** | `research_speed_mult` | +0.18 | Vollständige Technologieintegration |
| **4** | `pop_growth_mult` | +0.10 | Metamorphe Kolonieoptimierung |
| **4** | `colony_stability_flat` | +4 | Biologische Stabilitätsanker |
| **4** | `food_output_mult` | +0.08 | Synthetische Nahrungsproduktion |

> **Besonderheit:** Tier 4 schaltet den einzigartigen Hull-Typ `genesis_carrier` frei —
> ein organisch-mechanischer Trägerschiff-Hybrid mit passivem Schild-Regen-Bonus.
> Synergieeffekt mit Brut der Ewigkeit (§15.11): Wenn beide auf Tier 3+, `food_output_mult` +0.05 zusätzlich.

---

## 16. Fraktions-Quer-Effekte

Das Universum ist politisch vernetzt. Bestimmte Fraktionsbeziehungen
**beeinflussen automatisch andere Beziehungen**, wenn sie einen Schwellenwert
überschreiten. Diese Quer-Effekte werden aus `FACTION_RELATIONS.yaml`
(`relationships`-Matrix) berechnet.

### 16.1 Mechanismus

```
cross_effect = Σ (standing_change × relationship_weight_ij)
```

Wenn der Spieler mit Fraktion A `standing_change` erzielt:
```
für jede andere Fraktion B:
  if abs(relationship_score_AB) >= threshold:
    apply_standing(B, standing_change × cross_factor_AB)
```

**Schwellenwerte:**
- `|relationship_score| >= 7` → `cross_factor = 0.30` (starke Wirkung)
- `|relationship_score| >= 5` → `cross_factor = 0.15` (moderate Wirkung)
- `|relationship_score| < 5`  → kein Quer-Effekt

### 16.2 Wichtigste Quer-Effekt-Paare

| Primäre Aktion | Sekundär-Effekte |
|----------------|-----------------|
| +10 Vor'Tak | +3 Kryl'Tha (Waffenbrüder), −4 Eisenflotte (Rivalen) |
| +10 Syl'Nar | +3 Aereth (Wissenspartner), −3 Vel'Ar (Misstrauen) |
| +10 Aereth | +4 Zhareen (Forschungskooperation), +2 Syl'Nar |
| +10 Zhareen | +3 Aereth, −3 Khar'Morr (Archivschutz) |
| +10 Vel'Ar | +3 Khar'Morr (Infobroker), −3 Syl'Nar |
| +10 Kryl'Tha | +2 Vor'Tak, −2 Myr'Keth (Ressourcenkonkurrenz) |
| +10 Khar'Morr | −4 Syl'Nar, −3 Architekten, −2 Zhareen |
| +10 Helion | +2 alle Hauptfraktionen (Wirtschaftsstabilität) |
| +10 Eisenflotte | −5 alle 6 Hauptfraktionen (Verrat an der Konvergenz) |
| +10 Aethernox | +3 Architekten, −4 Ketzer |
| +10 Echos d. Leere | − (unmöglich — Tier max. 1) |
| +10 Ketzer | −5 Architekten, −3 Syl'Nar, +3 Vel'Ar |
| +10 Nomaden | +2 Vel'Ar (FTL-Expertise), +2 Aethernox |

### 16.3 Konvergenz-Koalitions-Bonus

Wenn der Spieler alle 6 Hauptfraktionen gleichzeitig auf **Tier 3+** hält:

```
Bonus: "Konvergenz-Einheit"
  colony_stability_flat:  +10 global
  happiness_flat:         +8 global
  research_speed_mult:    +0.05 global
  fleet_readiness_mult:   +0.08 global
```

Dieser Koalitions-Bonus ist die direkte Voraussetzung für das
Endgame-Szenario `convergence_united` (FACTION_RELATIONS.yaml).

---

## 17. Quest-Katalog pro Fraktion und Tier

Detailliertes Quest-Design für ausgewählte Fraktionen als Vorlage.
Vollständige Ausarbeitung erfolgt in `docs/quests/`.

### 17.1 Quest-Struktur

Jede Quest folgt diesem Schema:

```
Quest-ID:     <faction_key>.<tier_requirement>.<quest_type>.<index>
Typ:          kill | deliver | explore | build | research | spy | diplomatic
Min-Tier:     Mindest-Tier bei Quest-Freischaltung
Standing-∆:   Earned Standing bei Abschluss
Belohnung:    Credits, DM, Ressourcen, unique items
Dauer:        Ingame-Stunden (approximate)
```

---

### 17.2 Vor'Tak – Quest-Beispiele

| Quest-ID | Typ | Min-Tier | Titel | Standing-∆ | Belohnung |
|----------|-----|----------|-------|-----------|-----------|
| `vor_tak.t2.kill.1` | kill | Tier 2 | Piraten-Überfall stoppen | +8 | 500 Credits |
| `vor_tak.t2.deliver.1` | deliver | Tier 2 | Waffen-Lieferung nach Drak'Thuun | +5 | 200 Metall |
| `vor_tak.t3.kill.1` | kill | Tier 3 | Eisenflotten-Patrouille vernichten | +12 | 1000 Credits + 50 DM |
| `vor_tak.t3.build.1` | build | Tier 3 | Kaserne auf Vor'Tak-Kolonie errichten | +10 | 2 Truppen-Einheiten |
| `vor_tak.t4.kill.1` | kill | Tier 4 | Leere-Ausläufer in Drak'Thuun-Sektor | +20 | 200 DM + Ehrenring (unique) |
| `vor_tak.t4.diplomatic.1` | diplomatic | Tier 4 | Ehrenpakt mit General Drak'Mol | +15 | `fleet_readiness_mult` +0.05 (30 Tage) |

---

### 17.3 Helion-Konföderation – Quest-Beispiele

| Quest-ID | Typ | Min-Tier | Titel | Standing-∆ | Belohnung |
|----------|-----|----------|-------|-----------|-----------|
| `helion.t2.deliver.1` | deliver | Tier 2 | Energiekerne nach Helion-Station | +6 | 600 Credits |
| `helion.t2.trade.1` | trade | Tier 2 | 3 Helion-Handelsangebote annehmen | +8 | 10% Rabatt (7 Tage) |
| `helion.t3.research.1` | research | Tier 3 | Neue Handelsroute erkunden | +10 | Unique Handelsstation-Gebäude |
| `helion.t4.diplomatic.1` | diplomatic | Tier 4 | Exklusiv-Vertrag unterzeichnen | +18 | `trade_income_mult` +0.05 (permanent) |

---

### 17.4 Echos der Leere – Quest-Beispiele (Sonder-Quests)

> Normale Quests existieren nicht (Tier max. 1). Stattdessen: **Krisen-Quests**,
> die bei aktiver Leere-Präsenz triggered werden.

| Quest-ID | Typ | Trigger | Titel | Effekt |
|----------|-----|---------|-------|--------|
| `echos.crisis.1` | defend | Leere in Sektor | Leerenbrut-Ausläufer stoppen | Standing +5 mit allen Hauptfraktionen |
| `echos.crisis.2` | research | Leere-Welt gefunden | Leere-Probe analysieren | +300 Forschungspunkte, −3 Happiness |
| `echos.crisis.3` | diplomatic | Void-Summit-Event | Notfall-Konvergenz-Rat | Entscheidungsbaum: 3 Optionen |

---

### 17.5 Nomaden des Rifts – Quest-Beispiele

| Quest-ID | Typ | Min-Tier | Titel | Standing-∆ | Belohnung |
|----------|-----|----------|-------|-----------|-----------|
| `nomaden.t2.explore.1` | explore | Tier 2 | Rift-Anomalie kartieren | +8 | 40 DM |
| `nomaden.t3.explore.1` | explore | Tier 3 | Drei Rift-Knoten scannen | +12 | FTL-Cooldown −10% (14 Tage) |
| `nomaden.t4.explore.1` | explore | Tier 4 | Interdimensionaler Kartendienst | +15 | FTL-Cooldown −20% (permanent) + 100 DM |

---

## 18. Wirtschaftsintegration (ColonySimulation)

Das BMS greift direkt in die bestehende `ColonySimulation.js` ein.  
Die Modifier-Schlüssel werden in `computeYield()` angewendet.

### 18.1 Modifier-Anwendung in computeYield()

```javascript
// In ColonySimulation._applyYield(dt):
// Lade aktive Modifier aus dem Backend (gecacht im GameState)
const mods = gameState.empireModifiers; // aus /api/politics.php?action=status

// Multiplikatoren-Stack
const resourceMult = 1.0 + (mods['resource_output_mult'] ?? 0);
const foodMult     = 1.0 + (mods['food_output_mult'] ?? 0);
const researchMult = 1.0 + (mods['research_speed_mult'] ?? 0);

// Anwendung pro Pop/Job
baseYield.food       *= foodMult;
baseYield.production *= resourceMult;
baseYield.research   *= researchMult;

// Flache Boni
colony.stability += mods['colony_stability_flat'] ?? 0;
colony.happiness += mods['happiness_flat'] ?? 0;
```

### 18.2 Stehungs-Feedback-Loop mit Kolonien

Kolonien im Einflussbereich einer Fraktion können lokale Stehungseffekte erzeugen:

```
Wenn Kolonie im Sektor von Fraktion F liegt:
  Bei colony:unrest Event → standing(F) -= 2 (Instabilität schadet Diplomatie)
  Bei colony:grow Event   → standing(F) += 1 (Wachstum signalisiert Stärke)
```

### 18.3 Invasions-Integration

Fraktionsmodi sind in `invade()` aktiv:

```javascript
// BattleSimulator.js / ColonySimulation.invade()
const invasionMult = 1.0 + (mods['invasion_penalty_mult'] ?? 0);
// Wenn Angreifer von Tier-0-Fraktion unterstützt: invasion_penalty_mult positiv
// = Angreifer stärker → schwerere Verteidigung für Spieler
```

### 18.4 Handelsrouten-Integration

`trade_income_mult` wird auf das bestehende `trade_routes`-Tabellen-System
angewendet. Jede aktive Handelsroute wird mit dem akkumulierten Multiplikator
für die beteiligte Fraktion skaliert:

```php
// In game_engine.php: compute_trade_income()
$baseTrade = ...; // Standardberechnung
$factionMult = get_faction_trade_modifier($db, $userId, $routeFactionId);
$tradeTick = $baseTrade * (1.0 + $factionMult);
```

---

## 19. Spieler-Progressionspfad

### 19.1 Frühe Spielphase (Stunden 1–10)

**Ausgangslage:** Alle Fraktionen auf Tier 2 (Neutral, Standing ≈ base_diplomacy)

**Empfohlene Aktionen:**
1. Helion-Konföderation: 3 Basisquests abschließen → Tier 3 (Handel +18%)
2. Khar'Morr-Syndikate auf Tier 1 halten (keine Provokation)
3. Eines der 6 Hauptfraktionen durch Quest-Fokus auf Tier 3 heben
4. Galaktischen Netto-Druck im Auge behalten (Panel im Dashboard)

**Ziel Ende Phase 1:** 1× Tier 3 (Hauptfraktion) + 1× Tier 3 (Helion)

---

### 19.2 Mittlere Spielphase (Stunden 10–30)

**Aktionen & Entscheidungen:**

| Entscheidung | Konsequenz |
|-------------|-----------|
| Vor'Tak auf Tier 4 fokussieren | +Flotte, −Beziehungen mit diplomatischen Fraktionen |
| Helion auf Tier 4 bringen | +Wirtschaft, beste Grundlage für alle anderen |
| Aethernox kontaktieren | Riskant aber hoher Forschungsbonus |
| Khar'Morr auf Tier 3 heben | Billig-Ressourcen, Syl'Nar-Standing Schaden |

**Warnzeichen:**
- Eisenflotte Tier 0 → Invasionen abwehren
- Echos der Leere expandiert → Krisen-Quest-Kette aktivieren
- Net-Pressure < −2 → Civic oder Quest-Investition nötig

---

### 19.3 Endgame-Vorbereitung (Stunden 30–60+)

**Ziel:** Alle 6 Hauptfraktionen auf Tier 3+ → Konvergenz-Einheit aktivieren

**Kritische Pfade:**
```
Einfach:    Syl'Nar → Zhareen → Aereth (Diplomatie/Wissen-Cluster)
Mittel:     Vor'Tak → Kryl'Tha (Militär-Cluster)
Schwierig:  Vel'Ar (Spionage-Quests nötig, Quer-Effekte beachten)
```

**Endgame-Synergien:**
- Konvergenz-Einheit (Tier 3+ alle 6) → Convergence United Szenario
- Aethernox Tier 4 + Architekten Tier 4 → Kosmische Harmonie
- Nomaden Tier 4 + Vel'Ar Tier 4 → Maximaler FTL-Vorteil

---

## 20. Lokale Bonus/Malus-Systeme (Kolonie-, Flotten- und Diplomatie-Ebene)

### Problemstellung

Die bisher beschriebenen Modifikatoren (`user_empire_modifiers`) wirken
**global** auf das gesamte Imperium. Ein erfahrener Koloniegouverneur, der
nur auf Kolonie X eingesetzt ist, soll aber **ausschließlich** diese Kolonie
beeinflussen — nicht alle anderen. Ebenso gilt:

- Ein Flottenpilot mit hohem `skill_tactics` soll nur **seine** Flotte stärker machen
- Ein Diplomatie-Offizier, der auf die Vor'Tak spezialisiert ist, soll nur
  **diese Fraktionsbeziehung** verbessern, nicht alle gleichzeitig
- Gebäude-Boni (z. B. Barracken +Verteidigung) sollen kolonielokal bleiben

Dies erfordert ein **Scope-System** für Modifikatoren.

---

### 20.1 Scope-Konzept

Jeder Modifier erhält einen **Anwendungsbereich** (`scope`):

```
scope_type  scope_id   Bedeutung
──────────  ─────────  ─────────────────────────────────────────────────────
'empire'    NULL       Globaler Imperiums-Modifier (bisheriges System)
'colony'    colony_id  Nur für diese eine Kolonie wirksam
'fleet'     fleet_id   Nur für diese eine Flotte wirksam
'faction'   faction_id Nur für diese eine Fraktionsbeziehung wirksam
```

**Schichtungsregel:**

```
Effektiver Wert = Basis × (1 + empire_mult) × (1 + local_mult)
                          └─ global ─────────┘  └─ lokal ──────┘
```

Globale und lokale Modifier **stapeln sich multiplikativ** — sie überschreiben
einander nicht. Ein Kolonie-Verwalter auf Kolonie X verbessert die Produktion
**zusätzlich** zu einem eventuell aktiven Fraktions-Handelsbonus.

---

### 20.2 Datenbankschema: `local_entity_modifiers`

Eine neue, scopebewusste Tabelle parallel zu `user_empire_modifiers`:

```sql
CREATE TABLE IF NOT EXISTS local_entity_modifiers (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,

    -- Quelle des Modifiers
    source_type   ENUM(
                    'leader',       -- Von einem zugewiesenen Leader/Verwalter
                    'building',     -- Von einem Gebäude auf der Kolonie
                    'trait',        -- Von einem Verwalter-Trait
                    'faction_deal', -- Von einem spezifischen Fraktionsabkommen
                    'event',        -- Von einem Event (temporär)
                    'technology'    -- Von einem Technologiefortschritt
                  ) NOT NULL,
    source_key    VARCHAR(64) NOT NULL,  -- z.B. 'leader_42', 'barracks_lv3', 'trait_iron_fist'

    -- Geltungsbereich
    scope_type    ENUM('colony','fleet','faction') NOT NULL,
    scope_id      INT NOT NULL,          -- colony_id, fleet_id oder faction_id

    -- Modifier-Inhalt
    modifier_key  VARCHAR(64) NOT NULL,  -- Gleiche Schlüssel wie user_empire_modifiers
    modifier_value DECIMAL(9,4) NOT NULL,

    -- Gültigkeit
    starts_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    DATETIME DEFAULT NULL,  -- NULL = permanent (solange Zuweisung aktiv)
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_lem_user_scope    (user_id, scope_type, scope_id),
    INDEX idx_lem_source        (source_type, source_key),
    INDEX idx_lem_key           (modifier_key),
    INDEX idx_lem_expires       (expires_at)
) ENGINE=InnoDB;
```

**Warum eine separate Tabelle und kein scope in `user_empire_modifiers`?**

| Kriterium | Separate Tabelle | Spalten erweitern |
|-----------|-----------------|-------------------|
| Abwärtskompatibilität | ✅ Keine Änderung bestehender Queries | ❌ Alle empire_modifiers-Queries anpassen |
| Performance | ✅ Kleines, gezieltes SELECT per scope | ❌ Alle Rows laden, dann filtern |
| Migrations-Aufwand | ✅ `CREATE TABLE` reicht | ❌ `ALTER TABLE` + Index-Umbau |
| Klarheit der API | ✅ Zwei konzeptuell getrennte Systeme | ❌ Gemischtes Modell |

---

### 20.3 Leader-Skills als lokale Modifier

#### Bestehende Leader-Rollen und ihre lokalen Modifier-Schlüssel

Wenn ein Leader zugewiesen wird (`leaders.colony_id` oder `leaders.fleet_id`),
erzeugt `sync_leader_local_modifiers()` automatisch Einträge in
`local_entity_modifiers`:

| Leader-Rolle | Skill | scope_type | Modifier-Schlüssel | Formel (pro Skilllevel) |
|-------------|-------|-----------|-------------------|------------------------|
| `colony_manager` | `skill_production` | `colony` | `resource_output_mult` | +0.03 × level |
| `colony_manager` | `skill_production` | `colony` | `food_output_mult` | +0.03 × level |
| `colony_manager` | `skill_construction` | `colony` | `build_time_mult` | −0.02 × level |
| `colony_manager` | `skill_efficiency` | `colony` | `colony_stability_flat` | +0.5 × level |
| `fleet_commander` | `skill_tactics` | `fleet` | `attack_mult` | +0.03 × level |
| `fleet_commander` | `skill_navigation` | `fleet` | `speed_mult` | +0.02 × level |
| `fleet_commander` | `skill_efficiency` | `fleet` | `fuel_consumption_mult` | −0.02 × level |
| `fleet_commander` | `skill_tactics` | `fleet` | `defense_mult` | +0.015 × level |
| `science_director` | `skill_research` | `colony` | `research_speed_mult` | +0.03 × level |
| `science_director` | `skill_efficiency` | `colony` | `research_cost_mult` | −0.02 × level |
| `diplomacy_officer` | `skill_efficiency` | `faction` | `standing_gain_mult` | +0.05 × level |
| `diplomacy_officer` | `skill_efficiency` | `faction` | `standing_decay_mult` | −0.03 × level |
| `diplomacy_officer` | `skill_efficiency` | `faction` | `quest_reward_mult` | +0.04 × level |
| `trade_director` | `skill_production` | `colony` | `trade_income_mult` | +0.04 × level |
| `trade_director` | `skill_efficiency` | `colony` | `trade_income_mult` | +0.02 × level |

**Beispiel:** Koloniegouverneur auf Kolonie 7 mit `skill_production = 8`:
```
local_entity_modifiers:
  source_type  = 'leader'
  source_key   = 'leader_42'
  scope_type   = 'colony'
  scope_id     = 7
  modifier_key = 'resource_output_mult'
  modifier_value = 0.24  (= 0.03 × 8)
```

→ Kolonie 7 produziert 24% mehr Ressourcen.
→ Alle anderen Kolonien: **keine Änderung**.

---

### 20.4 Diplomatie-Offizier: Fraktionslokale Modifikatoren

#### Problem mit der aktuellen Implementierung

`ai_diplomacy_officer_tick()` wählt **global** die schlechteste Fraktion und
verbessert diese um +1. Das ist kein gezielter Einsatz.

#### Neues Design: Faction-Scope mit Ziel-Zuweisung

Der `diplomacy_officer` erhält ein neues Feld `faction_id` zur Zuweisung
(neben `colony_id` und `fleet_id`):

```sql
ALTER TABLE leaders
    ADD COLUMN IF NOT EXISTS faction_id INT DEFAULT NULL
        COMMENT 'Assigned target faction (for diplomacy_officer role)',
    ADD FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE SET NULL;
```

Wenn `faction_id` gesetzt ist, arbeitet `ai_diplomacy_officer_tick()` **ausschließlich**
auf diese Fraktion:

```php
// Neue Logik (vereinfacht):
if ($leader['faction_id']) {
    // Gezielter Einsatz: nur diese Fraktion bearbeiten
    $targetFactionId = (int)$leader['faction_id'];
    $gainMult = 1.0 + get_local_modifier_value($db, $uid, 'faction', $targetFactionId, 'standing_gain_mult');
    $delta = round(1 * $gainMult * (1 + $skillBonus));
    update_standing($db, $uid, $targetFactionId, $delta, 'leader_diplomacy', $msg);
} else {
    // Ungezielte Fallback-Logik (bisheriges Verhalten)
    // ... wählt schlechteste Fraktion
}
```

**Lokale Modifier für den Diplomatie-Offizier (faction-scope):**

| Modifier-Schlüssel | Quelle | Beschreibung |
|--------------------|--------|-------------|
| `standing_gain_mult` | Leader-Skill | Prozentualer Bonus auf jeden Standing-Gewinn |
| `standing_decay_mult` | Leader-Skill | Verlangsamte Stehungs-Erosion (negativer Wert) |
| `quest_reward_mult` | Leader-Trait | Erhöhte Quest-Belohnungen von dieser Fraktion |
| `trade_income_mult` | Leader-Skill | Erhöhte Handelseinnahmen von dieser Fraktion |
| `dialogue_bonus_flat` | Leader-Trait | Bonus auf LLM-Dialogergebnisse |

**Beispiel:** Diplomatie-Offizier Level 5 auf Vor'Tak:
```
Nормal standing_gain = +1 pro Tick
Mit skill_efficiency=6: standing_gain_mult = +0.30
Effektiver Gain:        +1.3 pro Tick → auf 100 gerundet = +1 oder +2
```

---

### 20.5 Trait-System für Verwalter

Leader aus dem Marketplace haben `trait_1` und `trait_2`. Diese Traits
übersetzen sich direkt in lokale Modifier-Einträge:

#### Trait-Katalog (Verwalter-Eigenschaften)

| Trait-Key | Anzeigename | Rolle | Lokaler Modifier |
|-----------|------------|-------|-----------------|
| `iron_fist` | Eiserne Faust | colony_manager | `colony_stability_flat` +3, `happiness_flat` −2 |
| `green_thumb` | Grüner Daumen | colony_manager | `food_output_mult` +0.12 |
| `architect` | Baumeister | colony_manager | `build_time_mult` −0.15 |
| `slave_driver` | Antreiber | colony_manager | `resource_output_mult` +0.10, `happiness_flat` −4 |
| `guardian` | Hüter | colony_manager | `colony_stability_flat` +6, `pop_growth_mult` +0.05 |
| `tactician` | Taktiker | fleet_commander | `attack_mult` +0.08, `defense_mult` +0.05 |
| `berserker` | Berserker | fleet_commander | `attack_mult` +0.20, `defense_mult` −0.10 |
| `navigator` | Navigator | fleet_commander | `speed_mult` +0.15, `fuel_consumption_mult` −0.08 |
| `ghost` | Geist | fleet_commander | Stealth +1 (Vel'Ar FTL: unsichtbar bei Scan) |
| `linguist` | Sprachgenie | diplomacy_officer | `standing_gain_mult` +0.20 |
| `manipulator` | Manipulator | diplomacy_officer | `standing_decay_mult` −0.15, `standing_gain_mult` +0.10 |
| `merchant_prince` | Handelsfürst | trade_director | `trade_income_mult` +0.20 |
| `smuggler` | Schmuggler | trade_director | `trade_income_mult` +0.15, Piratenfraktions-Standing +2 |

**Rarität → Trait-Qualität:**

| Rarität | Trait-Wert | Anzahl Traits |
|---------|-----------|---------------|
| common | 70% der Basis-Werte | 1 Trait |
| uncommon | 100% der Basis-Werte | 1 Trait |
| rare | 130% der Basis-Werte | 2 Traits |
| legendary | 160% der Basis-Werte | 2 Traits + Sonder-Effekt |

---

### 20.6 Gebäude als kolonielokal wirkende Modifier

Gebäude wirken bereits heute auf einzelne Kolonien. Im neuen System werden
sie als `local_entity_modifiers` mit `source_type = 'building'` verwaltet,
damit sie in einer einheitlichen Abfrage mit Leader-Modifiern zusammengeführt
werden können:

| Gebäude | Level-Schwelle | Lokaler Modifier | Wert |
|---------|---------------|-----------------|------|
| `barracks` | ≥ 3 | `colony_stability_flat` | +2 |
| `barracks` | ≥ 6 | `colony_stability_flat` | +4 |
| `barracks` | ≥ 10 | `invasion_penalty_mult` | −0.10 |
| `spaceport` | ≥ 3 | `trade_income_mult` | +0.08 |
| `spaceport` | ≥ 8 | `trade_income_mult` | +0.15 |
| `lab` | ≥ 5 | `research_speed_mult` | +0.05 |
| `dark_matter_mine` | ≥ 1 | `dark_matter_income_flat` | +5/Level |
| `farm` | ≥ 5 | `food_output_mult` | +0.06 |

> Diese Einträge werden einmalig beim Gebäude-Levelup gesetzt und
> beim Abreißen gelöscht (permanente Modifier ohne `expires_at`).

---

### 20.7 PHP-Hilfsfunktionen (Backend)

```php
/**
 * Erzeugt/aktualisiert alle lokalen Modifier-Einträge eines Leaders
 * basierend auf seinen Skills und Traits.
 * Wird bei Zuweisung (assign) und Skill-Upgrade aufgerufen.
 */
function sync_leader_local_modifiers(PDO $db, int $leaderId): void;

/**
 * Entfernt alle lokalen Modifier-Einträge eines Leaders.
 * Wird bei Entlassung (dismiss) oder Entfernung (unassign) aufgerufen.
 */
function remove_leader_local_modifiers(PDO $db, int $leaderId): void;

/**
 * Gibt alle lokalen Modifier für einen bestimmten Scope zurück.
 * Filtert abgelaufene Modifier automatisch heraus.
 *
 * @param string $scopeType  'colony' | 'fleet' | 'faction'
 * @param int    $scopeId    colony_id | fleet_id | faction_id
 * @return array ['modifier_key' => float, ...]  (aggregiert/summiert)
 */
function get_local_modifiers(PDO $db, int $userId, string $scopeType, int $scopeId): array;

/**
 * Gibt einen einzelnen aggregierten lokalen Modifier-Wert zurück.
 */
function get_local_modifier_value(
    PDO $db, int $userId, string $scopeType, int $scopeId, string $key
): float;

/**
 * Synchronisiert Gebäude-Modifier für eine Kolonie nach Gebäude-Levelup.
 */
function sync_building_local_modifiers(PDO $db, int $userId, int $colonyId): void;
```

---

### 20.8 Integration in bestehende Systeme

#### ColonySimulation-Integration (Frontend)

Das Frontend lädt lokale Modifier über eine erweiterte API-Antwort:

```json
// GET /api/colonies.php?action=detail&colony_id=7
{
  "colony": { ... },
  "local_modifiers": {
    "resource_output_mult": 0.24,
    "build_time_mult": -0.10,
    "colony_stability_flat": 3.5,
    "food_output_mult": 0.12
  },
  "local_modifier_sources": [
    { "key": "resource_output_mult", "value": 0.24, "source": "Koloniegouverneur Mira Solvan (Skill 8)" },
    { "key": "food_output_mult",     "value": 0.12, "source": "Trait: Grüner Daumen" },
    { "key": "colony_stability_flat","value": 3.5,  "source": "Kaserne Level 6 (+2) + Mira Solvan (+1.5)" }
  ]
}
```

In `ColonySimulation._applyYield()`:

```javascript
// globalMods aus empire_dynamic_effects() (empire-scope)
// localMods aus colonial detail-API  (colony-scope)

const totalResourceMult = (1 + (globalMods['resource_output_mult'] ?? 0))
                        * (1 + (localMods['resource_output_mult'] ?? 0));

baseYield.production *= totalResourceMult;
```

#### BattleSimulator-Integration (Frontend)

```javascript
// BattleSimulator.simulate() erhält fleet-scope Modifier:
const fleetMods = await api.getLocalModifiers('fleet', fleetId);

fleet.ships.forEach(ship => {
    ship.attack  *= (1 + (fleetMods['attack_mult']  ?? 0));
    ship.defense *= (1 + (fleetMods['defense_mult'] ?? 0));
    ship.speed   *= (1 + (fleetMods['speed_mult']   ?? 0));
});
```

#### Fraktions-Stehungs-Integration (Backend)

```php
// In update_standing() (game_engine.php):
function update_standing(PDO $db, int $userId, int $factionId, int $delta, ...): void {
    $gainMult = get_local_modifier_value($db, $userId, 'faction', $factionId, 'standing_gain_mult');
    $decayMult = get_local_modifier_value($db, $userId, 'faction', $factionId, 'standing_decay_mult');

    if ($delta > 0) {
        $delta = (int) round($delta * (1.0 + $gainMult));
    } else {
        $delta = (int) round($delta * (1.0 + $decayMult)); // decayMult ist negativ → verlangsamt Erosion
    }
    // ... UPDATE diplomacy SET standing = standing + $delta ...
}
```

---

### 20.9 API-Erweiterungen

| Endpunkt | Neue Parameter/Felder |
|---------|----------------------|
| `colonies.php?action=detail` | + `local_modifiers`, `local_modifier_sources` |
| `leaders.php?action=assign` | + `faction_id` für `diplomacy_officer` |
| `leaders.php?action=list` | + `active_local_modifiers[]` pro Leader |
| `fleet.php?action=fleet_status` | + `local_modifiers` für zugewiesene Flotte |
| `factions.php?action=list` | + `local_modifiers` pro Fraktion (faction-scope) |

---

### 20.10 Frontend-Darstellung

#### Kolonie-Panel: Lokale Modifier-Sektion

```
┌─────────────────────────────────────────────────────────┐
│  Kolonie: Neue Hoffnung VII          [Kolonie-Typ: FARM] │
│                                                          │
│  LOKALE MODIFIKATOREN                          [▾]       │
│  ──────────────────────────────────────────────          │
│  👷 Mira Solvan (colony_manager, Lv.4)                   │
│     • Ressourcen          +12%  (skill_production=4)     │
│     • Bauzeit             −8%   (skill_construction=4)   │
│     • Trait: Grüner Daumen → Nahrung +12%               │
│                                                          │
│  🏗️ Kaserne Lv.6                                         │
│     • Stabilität          +4 Pkt                         │
│                                                          │
│  NETTO LOKAL:   Ressourcen +12%   Nahrung +12%           │
│                 Bauzeit −8%       Stabilität +4           │
│  NETTO GLOBAL:  Handel +8%        (Fraktions-Boni)       │
│  EFFEKTIV:      Ressourcen +21.5% (= 1.12 × 1.085)      │
└─────────────────────────────────────────────────────────┘
```

#### Flotten-Panel: Commander-Modifier

```
┌────────────────────────────────────────────────────────┐
│  Flotte: Sturmgreif IV         [12 Schiffe]            │
│                                                         │
│  ⚔ Admiral Thane Vel (fleet_commander, Lv.6, RARE)    │
│     • Angriff         +18%  (skill_tactics=6)          │
│     • Verteidigung    +9%   (skill_tactics)             │
│     • Geschwindigkeit +12%  (skill_navigation=6)       │
│     • Trait: Taktiker → Angriff +8%, Verteidigung +5%  │
│                                                         │
│  EFFEKTIVER FLOTTENWERT:  ████████████████ +26%        │
└────────────────────────────────────────────────────────┘
```

#### Fraktions-Panel: Diplomatie-Offizier

```
┌────────────────────────────────────────────────────────┐
│  [✦ VERBÜNDET]  Vor'Tak       Standing: 48 / 100       │
│                                                         │
│  🤝 Sessa Kaan (diplomacy_officer, Lv.3)               │
│     • Stehungsgewinn  +15%  (skill_efficiency=3)       │
│     • Erosionsbremse  −9%   (standing_decay_mult)      │
│     • Trait: Linguist → Gewinn +20%                    │
│                                                         │
│  EFFEKTIV: +1 Standing/Tick → +1.35/Tick (gerundet +1) │
│  TÄGLICH ca.: +32 Standing (ungehinderter Aufbau)      │
└────────────────────────────────────────────────────────┘
```

---

### 20.11 Implementierungs-Phasen (Lokales BMS)

| Phase | Aufgaben | Abhängigkeit |
|-------|---------|-------------|
| **L1 – DB** | `local_entity_modifiers` Tabelle erstellen; `leaders.faction_id` hinzufügen | — |
| **L2 – Backend** | `sync_leader_local_modifiers()`, `remove_leader_local_modifiers()`, `get_local_modifiers()` implementieren | L1 |
| **L3 – Leaders API** | `assign`-Action: `sync_leader_local_modifiers()` aufrufen; `faction_id` für `diplomacy_officer` | L2 |
| **L4 – Colony API** | `colonies.php?action=detail` um lokale Modifier erweitern | L2 |
| **L5 – Fleet API** | `fleet.php?action=fleet_status` um lokale Modifier erweitern | L2 |
| **L6 – Diplomacy** | `update_standing()` mit lokalem `standing_gain/decay_mult` erweitern | L2 |
| **L7 – Frontend** | Lokale Modifier-Sektionen in Colony-Panel, Fleet-Panel, Faction-Panel | L4/L5 |
| **L8 – ColonySimulation** | Lokale Modifier in `_applyYield()` integrieren | L4 |
| **L9 – BattleSimulator** | Fleet-Modifier in `simulate()` integrieren | L5 |
| **L10 – Balancing** | Trait-Werte und Caps für lokale Modifier festlegen | L7 |

---

### 20.12 Balancing: Caps für lokale Modifier

Lokale Modifier haben **eigene Obergrenzen**, unabhängig von den globalen Caps
(Kapitel 12.1):

| Modifier-Schlüssel | Lokales Max | Globales Max | Kombiniertes Max |
|--------------------|------------|-------------|-----------------|
| `resource_output_mult` | +0.40 (Kolonie) | +0.50 (Empire) | +0.90 gesamt |
| `food_output_mult` | +0.40 | +0.30 | +0.70 |
| `build_time_mult` | −0.40 | — | −0.40 |
| `research_speed_mult` | +0.30 (Kolonie) | +0.25 (Empire) | +0.55 |
| `attack_mult` | +0.40 (Flotte) | — | +0.40 |
| `defense_mult` | +0.30 (Flotte) | — | +0.30 |
| `speed_mult` | +0.30 (Flotte) | — | +0.30 |
| `standing_gain_mult` | +0.50 (Fraktion) | — | +0.50 |
| `standing_decay_mult` | −0.40 (Fraktion) | — | −0.40 |
| `trade_income_mult` | +0.30 (Kolonie/Fraktion) | +0.50 (Empire) | +0.80 |

> **Philosophie:** Lokale Boni sollen eine einzelne Einheit spürbar stärker
> machen, aber keine Einheit absolut dominant werden lassen.
> Ein vollständig ausgebauter Legendary-Verwalter mit perfekten Skills auf
> einer Spezialkolonie bleibt +40% unter dem globalen Cap.

---

### 20.13 Abgrenzung: Global vs. Lokal

| Kriterium | Globaler Modifier (`user_empire_modifiers`) | Lokaler Modifier (`local_entity_modifiers`) |
|-----------|---------------------------------------------|---------------------------------------------|
| Geltungsbereich | Gesamtes Imperium | Eine Kolonie / Flotte / Fraktionsbeziehung |
| Quelle | Fraktions-Tier, Spezies, Regierung, Civics, Events | Leader, Traits, Gebäude, Fraktionsabkommen |
| Lebensdauer | Solange Tier/Regierung aktiv oder Event läuft | Solange Leader zugewiesen oder Gebäude gebaut |
| UI-Ort | Empire-Statistik-Panel, Fraktions-Druckanzeige | Koloniedetail, Flottendetail, Fraktionspanel |
| Beispiel | Vor'Tak Tier 4 → +25% Handel überall | Handelsdirektor auf Kolonie 7 → +16% nur dort |

---

*Dieses Dokument wird mit der Implementierung fortgeschrieben.  
Änderungsanträge bitte als Issue mit Label `game-design` einreichen.*
