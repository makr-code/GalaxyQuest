# 📊 GalaxyQuest Game Design – Projekt-Struktur

## Dokumentations-Architektur

```
GalaxyQuest (Universum)
│
├─ 🌍 DAS UNIVERSUM (Kosmische Makro-Ebene)
│  ├─ KalytherionKonvergenz (6 Rassen Allianz)
│  │  ├─ 6 Hauptrassen (biologisch diverse)
│  │  ├─ 6 Heimat-Welten (each mit einzigartigen Features)
│  │  ├─ 1 Flaggschiff: Kalytherion Ascendant
│  │  └─ 4 innere Fraktionen (Schildzirkel, Lichtbund, Kernrat, Schattenzirkel)
│  │
│  └─ 13 Externe NPC-Fraktionen (unabhängige Mächte)
│     ├─ Aethernox-Wächter (prä-biologisch)
│     ├─ Khar'Morr-Piraten (Chaos)
│     ├─ Helion-Konföderation (Handel)
│     ├─ Eisenflotte (Menschen + Expansion)
│     ├─ Omniscienta-KI (logisch, amoral)
│     ├─ Myr'Keth-Schwärme (Metallorganismen)
│     ├─ Echos der Leere (Leerenbrutsfragmente)
│     ├─ Ketzer von Verath (Schismatiker)
│     ├─ Architekten des Lichts (Kult)
│     ├─ Nomaden des Rifts (Wandervolk)
│     ├─ Brut der Ewigkeit (Urschwarm)
│     ├─ Schattenkompakt (Spionagenetzwerk) ← neu
│     └─ Genesis-Kollektiv (Post-Biologisch) ← neu
│
├─ 👥 CHARAKTERE (NPCs mit Tiefe)
│  ├─ 6 zentrale NPCs der Konvergenz
│  ├─ 13 Anführer der externen Fraktionen
│  └─ Dutzende Nebencharaktere (Soldaten, Händler, Spione)
│
├─ 📖 KAMPAGNE (6-Akte Story)
│  ├─ Akt 1: Der Riss (Auslöser)
│  ├─ Akt 2: Der Verrat (Konflikt)
│  ├─ Akt 3: Verlorene Welt (Entdeckung)
│  ├─ Akt 4: Ursprung der Leerenbrut (Enthüllung)
│  ├─ Akt 5: Die Spaltung (Fraktions-Krise)
│  ├─ Akt 6: Der Kern der Leere (Finale)
│  └─ 3 Nebenquests (Brutkammer, Nebelmaske, Lichter der Tiefe)
│
├─ 🎨 ART-PRODUCTION
│  ├─ 42 NPC-Portraits (6 Rassen × 2 Geschlechter × 3,5 Varianten)
│  ├─ Welt-Konzept-Arts (6 Planeten)
│  ├─ Schiff-Designs (7 Klassen)
│  ├─ UI-Mockups
│  └─ SD-XL Prompts (alle Rassen, m/w optimiert)
│
└─ 🛠️ ENTWICKLUNG (Roadmap)
   ├─ Phä Phase 1: Content-Foundation (Dialoge, Encounters)
   ├─ Phase 2: Gameplay-Balance (Rep-System, Konsequenzen)
   ├─ Phase 3: Art-Produktion (Portraits, Concepts)
   └─ Phase 4: Tech-Doku (Engine, DB-Schema, API)
```

---

## Files in diesem Projekt

| File | Grösse | Funktion | Status |
|------|--------|----------|--------|
| [`GAMEDESIGN.md`](GAMEDESIGN.md) | 38 KB | 📘 Hauptdokumentation | ✅ Live |
| [`README_GAMEDESIGN.md`](README_GAMEDESIGN.md) | 3 KB | 📋 Übersicht | ✅ Live |
| [`FTL_DRIVE_DESIGN.md`](FTL_DRIVE_DESIGN.md) | ~28 KB | ⚡ FTL-Antriebe: Fraktions-Design + Balancing + Implementierungsplan | ✅ Live |
| [`ECONOMY_DESIGN.md`](ECONOMY_DESIGN.md) | ~40 KB | 💹 Wirtschaftssystem: Produktionsketten, Markt, Pop-Klassensystem (Anno-Prinzip), Roadmap | ✅ Live |
| [`FACTION_INTRODUCTION.md`](FACTION_INTRODUCTION.md) | ~30 KB | 🌌 Spielerstart (Rassenwahl), Fraktionspfade, Isolationspfad (vollständig §11.3) | ✅ Live |
| [`BONUS_MALUS_DESIGN.md`](BONUS_MALUS_DESIGN.md) | ~100 KB | 🎖️ Bonus/Malus-System: alle 13 NPC-Fraktionen, Tier-Modifier, Backend-Spec | ✅ Live |
| [`gamedesign_fractions_backup.md`](../lore/gamedesign_fractions_backup.md) | 170 KB | 🗂️ Vollarchiv (Original, unverändert) | 📦 Archiv |
| [`../lore/gamedesign_fractions.md`](../lore/gamedesign_fractions.md) | — | ⚠️ Tombstone | 🚫 Deprecated – Tombstone lesen |

---

## Nutzungs-Szenario für Entwicklung

### 1. Schnelle Orientierung
→ Lese **README_GAMEDESIGN.md** (3 min)

### 2. Detaillierter Überblick
→ Lese **GAMEDESIGN.md** Inhaltsverzeichnis & Executive Summary (15 min)

### 3. Spezifischer Link-Deep-Dive
- **NPC schreiben?** → Springe zu [Zentrale NPCs](GAMEDESIGN.md#zentrale-npcs)
- **Quest designen?** → Springe zu [Kampagne](GAMEDESIGN.md#kampagne-die-schatten-der-konvergenz)
- **Welt beschreiben?** → Springe zu [Welten und Geographie](GAMEDESIGN.md#welten-und-geographie)
- **Art generieren?** → Springe zu [Prompts](GAMEDESIGN.md#art--und-prompt-guidelines)

### 4. Entwicklungs-Phasen durcharbeiten
→ Folge der [Roadmap](GAMEDESIGN.md#entwicklungs-roadmap) Week für Week

---

## Nächste Hands-On-Schritte

### If Sie **Dialoge schreiben** möchten:
```
1. Wähle einen NPC-Focus (z.B. General Drak'Mol)
2. Lese seinen Charakter-Profil in GAMEDESIGN.md
3. Schreibe Dialog-Tree mit seinen Motivationen & inneren Konflikten
4. Speichere in: docs/dialogs/[NPC-Name].md
```

### If Sie **Quest-Design** machen möchten:
```
1. Wähle einen Akt oder eine Nebenquest
2. Lese die Akt-Beschreibung & "Kern-Konflikt" in GAMEDESIGN.md
3. Schreibe Encounter-Details: Gegner, Schauplatz, Belohnung, Konsequenzen
4. Speichere in: docs/quests/[Akt-Nummer].md
```

### If Sie **Welten beschreiben** möchten:
```
1. Wähle eine Welt (z.B. Drak'Thuun)
2. Lese das "Geographie"-Profil in GAMEDESIGN.md
3. Schreibe Locations, Flora, Fauna, NPCs, Events
4. Speichere in: docs/worlds/[Welt-Name].md
```

### If Sie **Art generieren** möchten:
```
1. Wähle Rasse + Geschlecht
2. Kopiere den Basis-Prompt aus GAMEDESIGN.md
3. Kombiniere mit dem Rassen-Modul (auch in GAMEDESIGN.md)
4. Läufe in SD-XL / SwarmUI
5. Speichere in: gfx/portraits/[Rasse]-[m|w].png
```

---

## Zusammenfassung: Warum die Neustrukturierung wichtig war

### Problem mit dem alten Dokument:
- 5200+ Zeilen fragmentiert über eine einzelne Datei
- Kapitel wiederholten sich 2-3x mit Variationen
- Keine klares Inhaltsverzeichnis
- Redundante NPC-Listen
- Prompts in 3 verschiedenen Formaten
- Keine Entwicklungs-Roadmap
- → Schwer zu navigieren, zu warten, zu erweitern

### Lösung: GAMEDESIGN.md
- ~1800 Linien, klare Hierarchie
- Inhaltsverzeichnis mit direkten Links
- Keine Duplikate (DRY-Prinzip)
- Einheitliche Formatierung
- Klare Markdown-Links zwischen Abschnitten
- Architektur-Diagramm
- Entwicklungs-Roadmap mit Phasen
- → Schnell navigierbar, wartbar, erweiterbar

---

## Design Prinzipien

1. **Single Source of Truth (SSoT):** Ein Dokument, volle Autorität
2. **DRY (Don't Repeat Yourself):** Keine Duplikate
3. **Hierarchisch:** Top-Down-Struktur mit klaren Ebenen
4. **Verlinkt:** Markdown-Querverweise statt Repetition
5. **Modular:** Jeder Abschnitt kann eigenständig erweitert werden
6. **Roadmap-Driven:** Phasen für strukturierte Entwicklung

---

**🎯 Start:** Öff **[GAMEDESIGN.md](GAMEDESIGN.md)** und wähle deinen Focus-Bereich!
