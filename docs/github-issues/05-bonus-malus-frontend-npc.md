# [FEATURE] Bonus/Malus-System – Phase 3–5: Frontend, Events & NPC-Verhalten

**Labels:** `feature`, `frontend`, `ui`, `npc`, `diplomacy`, `bonus-malus`  
**Milestone:** Bonus/Malus-System v1.0  
**Referenz:** `docs/gamedesign/BONUS_MALUS_DESIGN.md` – Kapitel 8, 9, 10 & 13 Phase 3–5  
**Abhängigkeit:** Issue #04 (DB & Backend) muss abgeschlossen sein

---

## Zusammenfassung

Frontend-Anzeige der Tier-Modifikatoren im Fraktions-Panel, Journal-Events für Tier-Wechsel und erweitertes NPC-Verhalten abhängig vom Reputations-Tier.

---

## Akzeptanzkriterien – Phase 3: Frontend-UI (`js/game.js`)

Alle Komponenten verwenden den **GQUI-Fluent-Builder** (`window.GQUI`). Kein `innerHTML`.

### Tier-Badge & Progressbar im Fraktions-Panel

- [ ] Für jede Fraktion in der Fraktionsliste anzeigen:
  - **Tier-Badge**: Icon + Tierbezeichnung (z.B. `✦ VERBÜNDET`) in Fraktionsfarbe
  - **Stehungs-Fortschrittsbalken**: aktueller Standing + Markierung des nächsten Tier-Schwellenwerts
  - Tooltip beim Hover: „Nächster Tier ab +61 Stehung (+16 erforderlich)"
  - Tooltip beim Hover auf Badge: Liste der aktiven Modifikatoren dieser Fraktion
- [ ] Daten laden via `GET api/factions.php?action=list` (erweitertes Format aus Issue #04)

### Modifier-Übersichtstabelle (Statistik-Panel)

- [ ] Neuer Abschnitt „Aktive Fraktions-Modifikatoren" im Empire-Statistiken-Panel:
  - Tabelle: Modifier-Schlüssel | Gesamtwert | Quellen (z.B. „Vor'Tak T3 +8 %, Kryl'Tha T0 −5 %")
  - Farbkodierung: positive Werte grün, negative rot
  - Schaltfläche „Details" öffnet vollständige Modifier-Aufschlüsselung nach Fraktion
- [ ] Daten via `GET api/factions.php?action=tier_modifiers`

### Toast-Benachrichtigung bei Tier-Wechsel

- [ ] Toast-Nachricht erscheint wenn sich `current_tier` einer Fraktion ändert:
  - Tier-Aufstieg: `„✦ Vor'Tak: Tier NEUTRAL → VERBÜNDET"` (grüner Toast, 5 s)
  - Tier-Abstieg: `„❄ Kryl'Tha: Tier NEUTRAL → KALT"` (oranger Toast, 5 s)
  - Liste der neuen aktiven Modifier in kleinem Untertext
- [ ] Polling alle 30 Sekunden auf `api/factions.php?action=list`, Vergleich mit gecachtem Tier

### Warndialog bei Tier-0-Wechsel (FEINDSELIG)

- [ ] Modaler Dialog bei Tier-Wechsel in Tier 0:
  - Titel: `„⚠ Achtung: [Fraktion] ist nun FEINDSELIG"`
  - Text: Mali-Auflistung, Hinweis auf `attack_on_sight`-Verhalten
  - Schaltflächen: „Diplomatie starten" (öffnet Diplomatie-Panel) | „Schließen"
- [ ] Dialog erscheint zusätzlich zum Toast, nicht anstelle davon

### Galaktischer Druckindikator im Dashboard

- [ ] Kompakter Indikator in der Hauptnavigation (neben Sprawl-Anzeige aus Issue #03):
  - Zeigt `total_pressure` als numerischen Wert + Tendenzpfeil (↑/↓/→)
  - Farbkodierung: Grün (< 5), Gelb (5–15), Rot (> 15)
  - Klick öffnet Detailansicht mit Druck pro Fraktion
- [ ] Daten via `GET api/politics.php?action=status`

---

## Akzeptanzkriterien – Phase 4: Ereignis-Integration (`js/engine/game/EventSystem.js`)

- [ ] `EventType.DIPLOMATIC` zum bestehenden `EventType`-Enum hinzufügen
- [ ] Journal-Einträge für Tier-4-Errungenschaften (je 1 Eintrag pro Hauptfraktion, 6 Einträge):
  - ID-Schema: `tier4_[faction_code]` (z.B. `tier4_vor_tak`)
  - Titel: `„Strategischer Partner: [Fraktion]"`
  - Beschreibung: Fraktion-spezifischer Lore-Text (1–2 Sätze)
  - Typ: `EventType.DIPLOMATIC`
- [ ] Journal-Einträge für Tier-0-Krisen (je 1 Eintrag, 6 Einträge):
  - ID-Schema: `tier0_[faction_code]`
  - Titel: `„[Fraktion] erklärt uns zur Bedrohung"`
  - Konsequenz-Optionen: Diplomatie-Angebot senden | Ignorieren | Gegenaktion
- [ ] Galaktische Ereignisse in `api/npc_ai.php` mit Tier-Verschiebungen verknüpfen:
  - Event `galactic_summit` erhöht Stehung bei allen Tier-2-Fraktionen um +5
  - Event `piracy_wave` senkt Stehung bei Tier-0-Fraktionen um −3

---

## Akzeptanzkriterien – Phase 5: NPC-Verhaltens-Erweiterung (`api/npc_ai.php`)

### Tier-0: FEINDSELIG-Aktionen

- [ ] `attack_on_sight = true` für NPC-Flotten Tier-0-Fraktionen:
  - Wenn Spieler-Flotte in System mit Tier-0-Fraktion eintritt → automatischer Kampfauftrag für NPC-Flotten dieser Fraktion
  - Nur für NPCs mit `aggression >= 5` aktiv
- [ ] Blockade-Aktion (alle 30 Ticks, wenn Tier 0 seit > 10 Ticks):
  - NPC-Flotte patrouilliert nächstes System des Spielers
  - System gilt als „blockiert" → Trade-Routes −50 % Credits
- [ ] Propagandafeldzug (einmalig bei Tier-0-Eintritt):
  - Senkt Stehung des Spielers bei 2 neutralen Fraktionen um −5

### Tier-4: STRATEGISCHER_PARTNER-Aktionen

- [ ] Flottenverstärkung (alle 50 Ticks, bei Tier 4):
  - NPC-Fraktion sendet temporäres Unterstützungsgeschwader (3–5 Schiffe) in eigenes System
  - Flotte bleibt 20 Ticks als Wächter
- [ ] Technologietausch (einmalig bei Tier-4-Eintritt):
  - NPC teilt zufälligen Forschungsbaum-Knoten (Research-Punkte-Bonus +50 RP)
  - Journal-Event `tier4_tech_share`
- [ ] Handelsprivileg:
  - Tier-4-Fraktionen bieten +20 % Handelsrouten-Ertrag an (automatisch aktiv)

### Balancing & Tests

- [ ] Tier-0-Druck darf nicht stapeln: max. 1 Blockade-Flotte pro Tier-0-Fraktion gleichzeitig
- [ ] Tier-4-Verstärkung: max. 2 unterstützende Flotten gleichzeitig total (alle Fraktionen)
- [ ] Unit-Tests in `tests/php/npc_behavior_test.php`:
  - `testAttackOnSightTriggered()` – Tier 0 + aggression ≥ 5 → Kampfauftrag
  - `testTier4FleetReinforcement()` – nach 50 Ticks Verstärkungsflotte vorhanden
  - `testPropagandaReducesThirdPartyStanding()` – Stehung bei 2 Fraktionen −5

---

## Technische Hinweise

- Toast-Komponente: Bestehende `setStatus()`-API in GQUI erweitern oder neues `GQUI.toast()`
- Polling-Strategie: 30-Sekunden-Intervall, Zustand im `game.js`-State gecacht
- `EventType`-Enum: Rückwärtskompatibel erweitern – bestehende Tests dürfen nicht brechen

---

## Estimate

**~1.5 Wochen** (UI ~0.5 Woche + Events ~0.5 Woche + NPC-Verhalten ~0.5 Woche)
