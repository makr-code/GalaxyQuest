# 🚀 SD-XL Art-Generation – Quick-Start Guide

**Für:** Stable Diffusion XL über SwarmUI  
**Ziel:** Generiere die 6 zentrale NPCs als Portraits

---

## 1️⃣ Setup (One-Time)

### SwarmUI Vorbereitung
```
1. SwarmUI starten
2. Settings → Model Manager
3. Downloade: "Stable Diffusion XL 1.0" 
4. Downloade: "sdxl.vae" (für bessere Farben)
5. Lade Modelle
```

### Folder erstellen
```powershell
mkdir c:\VCC\GalaxyQuest\gfx\portraits
mkdir c:\VCC\GalaxyQuest\gfx\portraits\generated
```

---

## 2️⃣ Generation – Schritt für Schritt

### Schritt 1: SwarmUI öffnen
```
Text-to-Image → "Simple"
```

### Schritt 2: Settings konfigurieren
```
Model: sd_xl (oder xl_turbo für schnell)
VAE: sdxl.vae
Sampler: DPM++ 2M Karras
Steps: 30
CFG Scale: 7.5 (für Portraits)
Width: 720
Height: 1024
Seed: -1 (random)
```

### Schritt 3: Prompt einfügen & generieren

#### Test 1: Sol'Kaar (Aereth männlich)
**Prompt:** (aus `ART_PROMPTS_SDXL.md` → Prompt-Paket 1)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, male humanoid energy-based alien, angular crystalline facial structure, intense glowing energy core visible within semi-transparent skin, sharp light refractions and refracted geometry across face, cool white-blue energy coloration with silver undertones, sharp edged masculine features, piercing bright energy eyes crackling with intelligence, subtle electric tendrils around edges. Ultra-detailed skin or material texture, realistic lighting, studio portrait photography style with soft key light, subtle rim light, shallow depth of field f/2.8, sharp focus on face and eyes, natural specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

**Dann:** `Generate` Button klicken

---

## 3️⃣ Qualitäts-Check

### Checkliste pro Portrait:

- [ ] **Gesichtszüge:** Sind die Merkmale deutlich alien (nicht zu menschlich)?
- [ ] **Geschlecht:** Ist das Geschlecht eindeutig erkennbar?
- [ ] **Farbe:** Entsprechen die Farben dem Design? (z.B. Aereth = weiß-blau)
- [ ] **Fokus:** Ist das Gesicht scharf und die Augen im Fokus?
- [ ] **Hintergrund:** Ist der Hintergrund clean/transparent?
- [ ] **Beleuchtung:** Gut beleuchtete Studio-Qualität?

### Wenn **✅ alles super:** → Speichern
### Wenn **❌ nicht gut:** → Adjustments machen

---

## 4️⃣ Wenn die Qualität nicht passt – Fixes

### Problem 1: "Sieht zu menschlich aus"
**Fix:** Füge am Anfang hinzu:
```
clearly non-human alien, otherworldly features, exotic alien anatomy, 
```

### Problem 2: "Unklar welches Geschlecht"
**Fix:** Verstärke das Geschlecht-Modul:
```
**MÄNNLICH:** "strong masculine jaw, broad shoulders, tough features"
**WEIBLICH:** "delicate feminine contours, soft features, graceful neck"
```

### Problem 3: "Hintergrund ist nicht transparent"
**Fix:** Schreibe deutlicher:
```
absolutely no background, zero background, pure transparent space, 
clean blank background, PNG alpha channel, transparent PNG
```

### Problem 4: "Augen sind verformt"
**Fix:** 
- Reduziere Steps auf 28 statt 30
- Nutze neuer VAE
- Oder füge hinzu: `"beautiful detailed eyes, perfect eye anatomy"`

---

## 5️⃣ Generation Batch – Die 6 zentralen NPCs

Generiere diese in dieser Reihenfolge:

### 🔥 **Aereth** (am einfachsten – Energiewesen)
- [ ] **Sol'Kaar** (m): Packet 1 (oben)
- [ ] **Lyra'Tehn** (w): Aereth-Modul (weiblich) aus ART_PROMPTS_SDXL.md

### 🐙 **Syl'Nar** (mystisch & schön)
- [ ] **Vela'Thii** (w): Packet 2 (oben)
- [ ] **Asha'Vor** (m): Syl'Nar-Modul (männlich) aus ART_PROMPTS_SDXL.md

### 🦎 **Vor'Tak** (imposant)
- [ ] **Drak'Mol** (m): Packet 3 (oben)
- [ ] **T'Asha** (w): Vor'Tak-Modul (weiblich) aus ART_PROMPTS_SDXL.md

### 🦗 **Kryl'Tha** (insektoid)
- [ ] **Zha'Mira** (w): Packet 6 (oben)
- [ ] **Ka'Threx** (m): Kryl'Tha-Modul (männlich) aus ART_PROMPTS_SDXL.md

### 💎 **Zhareen** (kristallin)
- [ ] **Kaelor** (m): Packet 5 (oben)
- [ ] **Myr'Tal** (w): Zhareen-Modul (weiblich) aus ART_PROMPTS_SDXL.md

### 🌫️ **Vel'Ar** (geheimnisvoll)
- [ ] **Shy'Nira** (w): Packet 4 (oben)
- [ ] **Val'Kesh** (m): Vel'Ar-Modul (männlich) aus ART_PROMPTS_SDXL.md

**Total:** 12 Prompts = ~45 Minuten bei Steps:30

---

## 6️⃣ Speichern & Organizen

### Nach jeder erfolgreichen Generation:

```powershell
# 1. SwarmUI → Download/Save Button
# 2. Speichern unter:
#    gfx/portraits/[Rasse]_[Name]_[m|w].png

# Beispiele:
gfx/portraits/Aereth_Sol'Kaar_m.png
gfx/portraits/Syl'Nar_Vela'Thii_w.png
gfx/portraits/Vor'Tak_Drak'Mol_m.png
```

### Optional: Mit Git verwalten
```powershell
cd c:\VCC\GalaxyQuest
git add gfx/portraits/
git commit -m "Add: NPC portraits generated with SD-XL"
```

---

## 7️⃣ Tipps & Tricks

### Schnelle Wiederholungen ohne Neugenerierung:
**Wenn ein Ergebnis gut aber nicht perfekt ist:**
```
→ "Refine" oder "Upscale" Option in SwarmUI nutzen
→ Oder: Seed speichern und mit Steps:35 nochmal generieren
```

### Multiple Varations schnell testen:
```
1. Prompt speichern
2. Seed zurücksetzen (-1)
3. Generate 3x drücken
4. 3 verschiedene Portraits = good/ok/bad
5. Best one speichern
```

### Farben optimieren:
- Aereth zu dunkel? → Füge hinzu: `"bright glowing"`
- Zhareen zu hell? → Füge hinzu: `"deep sophisticated glow"`
- Vel'Ar zu klar? → Füge hinzu: `"mysterious ethereal haze"`

---

## 8️⃣ Timeframe

| Schritt | Zeit |
|---------|------|
| Setup (one-time) | 5 min |
| 1 Portrait generieren & verfeinern | 5-10 min |
| Qualitäts-Check | 2 min |
| Speichern | 1 min |
| **Pro Portrait Durchschnitt** | **7-8 min** |
| **Alle 12 NPCs** | **~90 Minuten** |

---

## ✅ Checkliste zum Starten

- [ ] SwarmUI installiert & Models downloaded
- [ ] `gfx/portraits/` Folder erstellt
- [ ] `ART_PROMPTS_SDXL.md` geöffnet
- [ ] Erste Prompt (Sol'Kaar) zum Copy-Pasten bereit
- [ ] Settings in SwarmUI konfiguriert
- [ ] Ready to Generate! 🚀

---

**Starten?** → Copy Prompt-Paket 1 & Gen-Button drücken!
