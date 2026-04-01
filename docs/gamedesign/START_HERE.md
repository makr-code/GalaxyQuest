# 🚀 GalaxyQuest – Game Design Einstiegspunkt

## Status: ✅ Neustrukturierung abgeschlossen

Die fraktionierte Gamedesign-Dokumentation wurde **konsolidiert, reorganisiert und erweitert** als klare Blaupause für die Entwicklung.

---

## 📚 Dokumentations-Übersicht

### 🎯 Schnell-Navigation

| Bedarf | Lese | Zeit | Zweck |
|--------|------|------|--------|
| **5-Min Überblick** | [`README_GAMEDESIGN.md`](README_GAMEDESIGN.md) | 5 min | Status, Übersicht |
| **Allgemeiner Kontext** | [`GAMEDESIGN.md` ToC](GAMEDESIGN.md#inhaltsverzeichnis) | 15 min | Navigation |
| **Projekt-Architektur** | [`ARCHITECTURE_GAMEDESIGN.md`](ARCHITECTURE_GAMEDESIGN.md) | 10 min | Struktur, Nutzung |
| **Deep-Dive Universum** | [GAMEDESIGN.md](GAMEDESIGN.md) | 1-2h | Vollständiges Lesen |
| **Spielerstart & Fraktionen** | [`FACTION_INTRODUCTION.md`](FACTION_INTRODUCTION.md) | 30 min | Spieler-Einführung, Ruf-System, LORE |

---

## 🎯 Dein nächster Schritt nach Interesse

### 👥 Wenn du **NPCs & Dialoge** schreiben möchtest:
```
1. Öffne GAMEDESIGN.md → "Zentrale NPCs" (oder externe Fraktionen)
2. Wähle einen NPC: 
   - 🦎 General Drak'Mol (Vor'Tak)
   - 🐙 Hohepriesterin Vela'Thii (Syl'Nar)
   - 🔥 Sol'Kaar (Aereth) ← Mit großem Geheimnis
   - 🦗 Kommandantin Zha'Mira (Kryl'Tha)
   - 💎 Archivar Kaelor (Zhareen)
   - 🌫️ Shy'Nira (Vel'Ar)
3. Lese seinen Charakter-Profil & Beziehungs-Netz
4. Schreibe Dialog-Trees mit seinen Motivationen
5. Speichere in: docs/dialogs/[NPC-Name].md
```

### 📖 Wenn du **Kampagnen für Quests** designen möchtest:
```
1. Öffne GAMEDESIGN.md → "Kampagne: Die Schatten der Konvergenz"
2. Wähle einen Akt (1-6) oder eine Nebenquest
3. Lese den Akt-Plot, die Kern-Konflikte, die Entscheidungspunkte
4. Schreibe Encounter-Details:
   - Gegner-Stats & Taktik
   - Schauplatz & Umgebung
   - Objectives & Subgoals
   - Belohnungen & Konsequenzen
5. Speichere in: docs/quests/[Akt-Nummer].md
```

### 🌍 Wenn du **Welten beschreiben & detaillieren** möchtest:
```
1. Öffne GAMEDESIGN.md → "Welten und Geographie"
2. Wähle eine Welt:
   - Drak'Thuun (Vor'Tak) - Vulkanisch, Militär
   - Oon'Vareth (Syl'Nar) - Ozean-Planet, Diplomatie
   - Sol'Ryaan (Aereth) - Plasma-Sturmplanet, Forschung
   - Zyr'Mekar (Kryl'Tha) - Dschungel, Produktion
   - Aeryth'Luun (Zhareen) - Kristall-Wüste, BEDROHT
   - Nira'Voss (Vel'Ar) - Nebel-Planet, Spionage
3. Lese die Basis-Geographie
4. Schreibe Locations, Flora, Fauna, Events, örtliche NPCs
5. Speichere in: docs/worlds/[Welt-Name].md
```

### 🎨 Wenn du **Art generieren** möchtest (SD-XL, SwarmUI):
```
1. Öffne GAMEDESIGN.md → "Art- und Prompt-Guidelines"
2. Kopiere den Basis-Portrait-Prompt
3. Kombiniere mit dem Rassen-Modul (m oder w)
4. Beispiel für weibliche Vor'Tak:
   [BASIS-PROMPT] + [RASSE-MODUL: Vor'Tak-Weiblich]
5. Läufe in SD-XL / SwarmUI mit folgenden Settings:
   - Model: sd-xl-1.0 oder xl-turbo
   - CFG: 7.5-8.5
   - Steps: 25-35
   - Sampler: DPM++ 2M Karras
6. Speichere: gfx/portraits/[Rasse]-[geschlecht].png
```

### 💻 Wenn du **Mechaniken & Gameplay** designen möchtest:
```
1. Lese GAMEDESIGN.md:
   - "Politik und Fraktionen" (Reputation-Systeme)
   - "Kampagne" (Entscheidungs-Konsequenzen)
2. Für Spielerstart & Fraktionseinführung:
   - Lese FACTION_INTRODUCTION.md (vollständiges Konzept + LORE)
3. Definiere:
   - Fraktions-Reputation-Systeme
   - Dialogue-Tree-Strukturen
   - Konsequenzen-Mapping
   - Item/Waffen-Stats
4. Speichere in: docs/mechanics/[System-Name].md
```

---

## 📊 Das Universum auf einen Blick

### 🔗 Die 3 Ebenen

```
Ebene 1: Kalytherion-Konvergenz (6 Rassen + 4 innere Fraktionen)
         ↓
Ebene 2: 6 Heimat-Welten mit lokalem Governance
         ↓
Ebene 3: 7 externe Fraktionen (Piraten, KI, Menschen, etc.)
```

### ⚔️ Der Zentrale Konflikt

- **Externe Bedrohung:** Leerenbrut (trans-dimensional)
- **Externe Invasion:** Eisenflotte (Menschen)
- **Innere Spaltung:** 4 Fraktionen mit gegenteiligen Agendas

### 🎬 Die Kampagne

**6 Akte + 3 Nebenquests**
- Akt 1: Auslöser (Der Riss)
- Akt 2-4: Steigerung & Enthüllung
- Akt 5: Krise (Allianz zerbricht?)
- Akt 6: Finale mit 3 möglichen Enden

---

## 📁 Dateien-Struktur

```
GalaxyQuest/
├─ 📘 GAMEDESIGN.md              ← HAUPTDOKU (38 KB)
├─ 📋 README_GAMEDESIGN.md       ← SCHNELL-START
├─ 📊 ARCHITECTURE_GAMEDESIGN.md ← PROJEKT-INFO
├─ 📄 THIS FILE                  ← EINSTIEGSPUNKT
│
├─ docs/                          ← ZU ERSTELLEN
│  ├─ dialogs/
│  │  ├─ Drak'Mol.md
│  │  ├─ Vela'Thii.md
│  │  └─ ...
│  │
│  ├─ quests/
│  │  ├─ Akt_01_Der_Riss.md
│  │  ├─ Akt_02_Der_Verrat.md
│  │  └─ ...
│  │
│  ├─ worlds/
│  │  ├─ Drak'Thuun.md
│  │  ├─ Oon'Vareth.md
│  │  └─ ...
│  │
│  └─ mechanics/
│     ├─ Reputation_System.md
│     ├─ Dialogue_Trees.md
│     └─ ...
│
└─ gfx/portraits/                ← ZU GENERIEREN
   ├─ Vor'Tak-m.png
   ├─ Vor'Tak-w.png
   ├─ Syl'Nar-m.png
   ├─ Syl'Nar-w.png
   └─ ...
```

---

## 🚀 Entwicklungs-Roadmap (aus GAMEDESIGN.md)

### Phase 1: Content-Foundation (Weeks 1-2)
- [ ] NPC-Profile mit Dialogen erweitern
- [ ] Kampagnen-Akte mit Sequenzen detaillieren
- [ ] Gegener-Stat-Blöcke definieren
- [ ] Item/Waffen-Systems dokumentieren

### Phase 2: Gameplay-Balance (Weeks 3-4)
- [ ] Fraktions-Reputationssystem definieren
- [ ] Dialogue-Tree-Struktur für Entscheidungen
- [ ] Konsequenzen für Spieler-Wahlen mappen
- [ ] Quest-Reward-Struktur balancieren

### Phase 3: Art-Produktion (Weeks 5-6)
- [ ] Alle NPC-Portraits generieren (SD-XL)
- [ ] Welt-Konzept-Arts erstellen
- [ ] UI-Design Mockups
- [ ] Schiff-Designs visualisieren

### Phase 4: Tech-Dokumentation (Weeks 7-8)
- [ ] Engine-Anforderungen spezifizieren
- [ ] Datenbank-Schema definieren
- [ ] API-Contracts etablieren
- [ ] Performance-Budgets setzen

---

## 💡 Was wurde verbessert

| Aspekt | Vorher | Nachher |
|--------|--------|---------|
| **Size** | 5200+ Zeilen | 1800 Zeilen strukturiert |
| **Navigation** | Chaotisch | Inhaltsverzeichnis + Links |
| **Duplikate** | Viele (3-5x) | Keine (DRY) |
| **Format** | Inkonsistent | Einheitliche Markdown |
| **Fraktionen** | Nur 6 Rassen | 6 Rassen + 7 externe |
| **Roadmap** | Keine | 4 Phasen definiert |
| **Prompts** | 3 Versionen | Unified + Modul-System |

---

## 🎯 Los geht's!

**Wähle deinen Fokus:**

1. **NPCs & Dialoge?** → Öffne [GAMEDESIGN.md](GAMEDESIGN.md#zentrale-npcs)
2. **Quests & Kampagne?** → Öffne [GAMEDESIGN.md](GAMEDESIGN.md#kampagne-die-schatten-der-konvergenz)
3. **Weltbau?** → Öffne [GAMEDESIGN.md](GAMEDESIGN.md#welten-und-geographie)
4. **Art & Design?** → Öffne [GAMEDESIGN.md](GAMEDESIGN.md#art--und-prompt-guidelines)
5. **Projekt-Überblick?** → Lese [ARCHITECTURE_GAMEDESIGN.md](ARCHITECTURE_GAMEDESIGN.md)

---

**Status:** ✅ Ready for Development | 🚀 Begin with Phase 1
