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
  +61 … +100 →  Tier 4: STRATEGISCHER_PARTNER (Strategic Partner)
```

### Tier-Eigenschaften

| Tier | Name | Farbe (UI) | Icon |
|------|------|-----------|------|
| 0 | FEINDSELIG | Rot `#c0392b` | ☠ |
| 1 | KALT | Orange `#e67e22` | ❄ |
| 2 | NEUTRAL | Grau `#95a5a6` | ◇ |
| 3 | VERBÜNDET | Grün `#27ae60` | ✦ |
| 4 | STRATEGISCHER_PARTNER | Gold `#f1c40f` | ★ |

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

Rückgabe für alle 17 Fraktionen: `faction_id`, `current_tier`, `tier_label`,
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
npc_ai.php (tick)                       │
    └─► sync_faction_tier_modifiers() ──┘
            └─► user_empire_modifiers (INSERT/DELETE)

factions.php (list/claim_quest/accept_trade)
    └─► sync_faction_tier_modifiers()

EventSystem.js (Frontend)
    └─► defineJournalEntry() für Tier-Wechsel-Events

js/game.js (FactionPanel)
    └─► GET /api/factions.php?action=tier_modifiers
    └─► Tier-Badge, Progressbar, Toast, Modal
```

---

*Dieses Dokument wird mit der Implementierung fortgeschrieben.  
Änderungsanträge bitte als Issue mit Label `game-design` einreichen.*
