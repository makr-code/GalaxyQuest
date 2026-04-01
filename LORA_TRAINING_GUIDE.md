# 🎯 GalaxyQuest – LoRA Training Guide

**Version:** 1.0  
**Status:** Produktionsreif  
**Erstellt:** 2026-04-01  
**Voraussetzung:** `ART_PROMPTS_SDXL.md` (Basis-Prompts), `ART_QUICKSTART.md` (SDXL-Setup)  
**Ziel:** Konsistente, charaktertreue NPC-Portraits für alle 6 GalaxyQuest-Rassen

---

## Inhaltsverzeichnis

1. [Was ist LoRA & warum brauchen wir es?](#1-was-ist-lora--warum-brauchen-wir-es)
2. [Tools & Voraussetzungen](#2-tools--voraussetzungen)
3. [Dataset-Anforderungen pro Rasse](#3-dataset-anforderungen-pro-rasse)
4. [Trainings-Konfigurationen](#4-trainings-konfigurationen)
5. [Per-Rasse Trigger-Words & Parameter](#5-per-rasse-trigger-words--parameter)
6. [Training-Workflow Schritt für Schritt](#6-training-workflow-schritt-für-schritt)
7. [LoRA in SwarmUI verwenden](#7-lora-in-swarmui-verwenden)
8. [LoRA in der GalaxyQuest-API](#8-lora-in-der-galaxyquest-api)
9. [Qualitätsbewertung & Iteration](#9-qualitätsbewertung--iteration)
10. [Erweiterte Techniken](#10-erweiterte-techniken)
11. [Troubleshooting](#11-troubleshooting)
12. [Dateistruktur & Versionierung](#12-dateistruktur--versionierung)

---

## 1. Was ist LoRA & warum brauchen wir es?

**LoRA** (Low-Rank Adaptation) ist eine Feinabstimmungs-Technik für Diffusion-Modelle.
Anstatt das komplette SDXL-Modell zu trainieren (Hunderte GB, Wochen), trainiert LoRA
nur eine kleine Anpassungsschicht (~50–300 MB) die das Basismodell für ein spezifisches
Konzept spezialisiert.

### Problem ohne LoRA

Ohne LoRA beschreibt man Charaktere mit langen, fragilen Prompts:
```
# Jedes Mal 200+ Wörter, trotzdem inkonsistente Ergebnisse:
"massive bone plates across shoulders and head, dark green-black iridescent scales,
 broad masculine facial structure, intense yellow predatory eyes with slit pupils,
 battle scars and ridges, subtle bronze metallic armor details..."
```

Resultat: Jedes Portrait sieht anders aus — General Drak'Mol erscheint als
fünf verschiedene Reptilienwesen.

### Lösung mit LoRA

Nach einmaligem Training:
```
# 5 Wörter genügen für konsistente Ergebnisse:
"<lora:vortak_lora:0.85> vortak_race male portrait, confident commander"
```

Resultat: Drak'Mol erkennt man sofort in jedem generierten Bild.

### GalaxyQuest-Ziel

| Ohne LoRA | Mit LoRA |
|---|---|
| 12 verschiedene Vo'Tak-Gesichter | 1 klar erkennbarer Vor'Tak-Typ |
| Langer, fragiler Prompt | Kurzer, stabiler Prompt |
| Inkonsistente Texturen/Farben | Konsistente Rassen-Ästhetik |
| ~200 Wörter/Prompt | ~20 Wörter/Prompt |
| Schwer skalierbar (neue NPCs) | Einfach: +1 Zeile für neuen NPC |

---

## 2. Tools & Voraussetzungen

### Option A: Kohya SS (Empfohlen — maximale Kontrolle)

**Installation:**
```powershell
# Windows
git clone https://github.com/bmaltais/kohya_ss.git
cd kohya_ss
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python gui.py
```

**Voraussetzungen:**
- NVIDIA GPU: mindestens RTX 3060 12GB (empfohlen: RTX 3080+ oder RTX 4070+)
- Python 3.10+
- CUDA 11.8 oder 12.1
- ~10 GB freier RAM

### Option B: OneTrainer (Einsteigerfreundlich — GUI-first)

**Installation:**
```powershell
git clone https://github.com/Nerogar/OneTrainer.git
cd OneTrainer
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python scripts/train_ui.py
```

**Vorteile:**
- Vollständige GUI ohne JSON-Konfiguration
- Integrierte Datensatz-Vorschau
- Automatisches Caption-Tools

### Option C: SwarmUI LoRA Training (Einfachste — in SwarmUI integriert)

SwarmUI enthält ab Version 0.9+ ein integriertes LoRA-Training-Backend.

```
SwarmUI → Models Tab → Train New LoRA
→ Wähle Basis-Modell: sd_xl_base_1.0
→ Lade Dataset-Ordner
→ Setze Trainings-Parameter
→ Train
```

### Hardware-Anforderungen

| GPU | Batch Size | Training-Zeit pro LoRA |
|---|---|---|
| RTX 3060 12GB | 1 | ~60 min |
| RTX 3080 10GB | 2 | ~35 min |
| RTX 4070 Ti 12GB | 4 | ~20 min |
| RTX 4090 24GB | 8 | ~10 min |
| Ohne GPU (CPU only) | 1 | ~8–12 Stunden |

---

## 3. Dataset-Anforderungen pro Rasse

### Minimum-Anforderungen

| Datensatz-Größe | Qualität | Trainings-Ergebnis |
|---|---|---|
| 5–10 Bilder | Akzeptabel | Grundlegendes Rassen-Konzept |
| **15–25 Bilder** | **Empfohlen** | **Gute Konsistenz, erkennbare Merkmale** |
| 30–50 Bilder | Professionell | Sehr hohe Konsistenz, alle Winkel |
| 50+ Bilder | Maximal | Near-perfekte Charakter-Lock |

### Bild-Vielfalt (pro Rasse)

Um Überanpassung zu vermeiden, braucht das Dataset **Variationen** in:

| Kategorie | Empfohlene Verteilung | Beispiel |
|---|---|---|
| Kamerawinkel | 40 % frontal, 30 % ¾, 20 % Profil, 10 % von unten/oben | Verschiedene Perspektiven |
| Beleuchtung | 40 % Studio, 30 % dramatisch, 20 % ambient, 10 % schlecht | Natürliche Varianz |
| Mimik | 50 % neutral, 30 % emotional, 20 % extrem | Ausdrucks-Robustheit |
| Hintergrund | 60 % neutral/transparent, 40 % In-World-Szenen | Kontext-Generalisierung |
| Geschlecht | Pro Rassen-LoRA: 50/50 oder separat trainieren | Je nach Ziel |

### Workflow: Dataset aus ART_PROMPTS_SDXL.md generieren

```
Phase 1: Basis-Portraits (10 Bilder pro Geschlecht)
  → ART_PROMPTS_SDXL.md Rassen-Modul + Basis-Foto-Prompt
  → Seed: -1 (zufällig), Steps: 30, CFG: 7.5
  → Speichern in: datasets/[Rasse]/raw/

Phase 2: Variations-Portraits (5–10 weitere)
  → Modifizierte Prompts: andere Winkel, Beleuchtung, Mimik
  → Speichern in: datasets/[Rasse]/raw/

Phase 3: Qualitäts-Filterung
  → Schlechte Bilder manuell löschen (< 4/5 Qualität)
  → Nur die besten 15–25 behalten

Phase 4: Captions
  → Für jedes Bild: [trigger_word], [kurze Beschreibung]
  → Automatisch via WD14 Tagger oder manuell
```

### Empfohlene Ordner-Struktur

```
datasets/
├── vortak/
│   ├── raw/           ← Alle generierten Rohdaten
│   │   ├── vortak_m_01.png
│   │   ├── vortak_m_01.txt  ← Caption: "vortak_race, male reptilian alien..."
│   │   └── ...
│   ├── filtered/      ← Nur qualitativ hochwertige Bilder
│   └── augmented/     ← Optional: gespiegelt, zugeschnitten
├── sylnar/
├── aereth/
├── kryltha/
├── zhareen/
└── velar/
```

### Caption-Format

Für jedes `.png` eine gleichnamige `.txt` Datei:

```
# datasets/vortak/filtered/vortak_m_03.txt
vortak_race, male reptilian alien, dark green scales, bone plates,
yellow slit eyes, strong jaw, battle scars, bronze armor details
```

**Wichtig:** Trigger-Word (`vortak_race`) immer an **erster Stelle**.

---

## 4. Trainings-Konfigurationen

### Kohya SS — SDXL LoRA Konfiguration

```json
{
  "pretrained_model_name_or_path": "path/to/sd_xl_base_1.0.safetensors",
  "train_data_dir":                "path/to/datasets/vortak/filtered",
  "output_dir":                    "path/to/loras/output",
  "output_name":                   "vortak_lora_v1",
  "save_model_as":                 "safetensors",

  "resolution":                    "1024,1024",
  "batch_size":                    2,
  "max_train_epochs":              15,
  "learning_rate":                 "0.0004",
  "lr_scheduler":                  "cosine_with_restarts",
  "lr_warmup_steps":               100,

  "network_module":                "networks.lora",
  "network_dim":                   32,
  "network_alpha":                 16,

  "optimizer_type":                "AdamW8bit",
  "mixed_precision":               "bf16",
  "gradient_checkpointing":        true,
  "gradient_accumulation_steps":   1,

  "save_every_n_epochs":           5,
  "clip_skip":                     2,
  "max_token_length":              225,

  "sdxl":                          true,
  "no_half_vae":                   true,
  "cache_latents":                 true,
  "cache_latents_to_disk":         false
}
```

### OneTrainer — Empfohlene Einstellungen (GUI)

```
Model Type:          SDXL
Base Model:          sd_xl_base_1.0.safetensors
Training Method:     LoRA
Network Rank (Dim):  32
Network Alpha:       16
Learning Rate:       4e-4
Scheduler:           cosine with restarts
Warmup Steps:        100
Batch Size:          2
Epochs:              15
Resolution:          1024
Mixed Precision:     BF16
Optimizer:           AdamW8bit
Caption Dropout:     0.05
```

### Schnell-Referenz: Parameter-Bedeutung

| Parameter | Wert | Bedeutung |
|---|---|---|
| `network_dim` | 32 | Größe der LoRA-Matrizen (höher = mehr Kapazität, aber größere Datei) |
| `network_alpha` | 16 | Skalierungsfaktor (typisch: 50 % von dim) |
| `learning_rate` | 0.0004 | Wie schnell das Modell lernt (zu hoch → Überanpassung) |
| `max_train_epochs` | 15 | Trainingsiterationen (mehr = spezifischer, weniger = genereller) |
| `clip_skip` | 2 | SDXL-Standard: 2 (besser für nicht-fotografische Konzepte) |

---

## 5. Per-Rasse Trigger-Words & Parameter

### 🦎 Vor'Tak

```
Trigger-Word:    vortak_race
LoRA-Dateiname:  vortak_lora_v1.safetensors
Empf. Gewicht:   0.80–0.95
Besonderheiten:  Starke Textur-Dominanz (Schuppen) → etwas höheres Gewicht
Dim/Alpha:       32/16
Trainings-Bilder: 20–25 (Schuppen-Textur-Varianz wichtig)
```

**Test-Prompt nach Training:**
```
<lora:vortak_lora_v1:0.85> vortak_race male, portrait, commanding general
```

---

### 🐙 Syl'Nar

```
Trigger-Word:    sylnar_race
LoRA-Dateiname:  sylnar_lora_v1.safetensors
Empf. Gewicht:   0.70–0.85
Besonderheiten:  Biolumineszenz schwer zu lernen → mehr Bilder empfohlen
Dim/Alpha:       32/16 (oder 64/32 für höhere Qualität)
Trainings-Bilder: 20–30 (Biolumineszenz-Varianz entscheidend)
```

**Test-Prompt nach Training:**
```
<lora:sylnar_lora_v1:0.80> sylnar_race female, portrait, wise priestess
```

---

### 🔥 Aereth

```
Trigger-Word:    aereth_race
LoRA-Dateiname:  aereth_lora_v1.safetensors
Empf. Gewicht:   0.70–0.85
Besonderheiten:  Transparenz und Energieeffekte → niedrigeres Gewicht verhindert Übersteuerung
Dim/Alpha:       32/16
Trainings-Bilder: 15–20
```

**Test-Prompt nach Training:**
```
<lora:aereth_lora_v1:0.80> aereth_race male, portrait, brilliant scientist
```

---

### 🦗 Kryl'Tha

```
Trigger-Word:    kryltha_race
LoRA-Dateiname:  kryltha_lora_v1.safetensors
Empf. Gewicht:   0.80–1.00
Besonderheiten:  Chitin-Strukturen sehr spezifisch → hohes Gewicht nötig
Dim/Alpha:       32/16
Trainings-Bilder: 20–25 (verschiedene Chitin-Reflektionswinkel)
```

**Test-Prompt nach Training:**
```
<lora:kryltha_lora_v1:0.90> kryltha_race female, portrait, warrior commander
```

---

### 💎 Zhareen

```
Trigger-Word:    zhareen_race
LoRA-Dateiname:  zhareen_lora_v1.safetensors
Empf. Gewicht:   0.70–0.90
Besonderheiten:  Kristall-Prismatik komplex → Dim 64 wenn Qualität wichtig
Dim/Alpha:       32/16 (Standard) oder 64/32 (Premium)
Trainings-Bilder: 20–25 (viele Licht-Brechungswinkel)
```

**Test-Prompt nach Training:**
```
<lora:zhareen_lora_v1:0.85> zhareen_race male, portrait, melancholic archivist
```

---

### 🌫️ Vel'Ar

```
Trigger-Word:    velar_race
LoRA-Dateiname:  velar_lora_v1.safetensors
Empf. Gewicht:   0.60–0.80
Besonderheiten:  Gas-Körper sehr abstrakt → niedrigstes Gewicht vermeidet Artefakte
Dim/Alpha:       32/16
Trainings-Bilder: 20–30 (Gas-Wirbel-Varianz kritisch)
```

**Test-Prompt nach Training:**
```
<lora:velar_lora_v1:0.75> velar_race female, portrait, shadow agent
```

---

## 6. Training-Workflow Schritt für Schritt

### Phase 1: Dataset vorbereiten (30–60 min pro Rasse)

```powershell
# 1. Dataset-Ordner erstellen
mkdir datasets\vortak\raw
mkdir datasets\vortak\filtered

# 2. Portraits generieren (SwarmUI oder CLI)
#    → 20 Bilder aus ART_PROMPTS_SDXL.md Vor'Tak-Modul
#    → Verschiedene Seeds, Winkel, Beleuchtungen

# 3. Bilder manuell prüfen
#    → Schlechte löschen (Deformierungen, falsche Farben)
#    → Mindestens 15 hochwertige behalten

# 4. Gefilterte Bilder nach /filtered/ kopieren
copy datasets\vortak\raw\*.png datasets\vortak\filtered\
```

### Phase 2: Auto-Captioning mit WD14 Tagger (empfohlen)

```python
# Mit Kohya SS integriert: Interrogate-Tab
# Oder separat:
pip install wd14-tagger
python -m wd14_tagger \
  --input_dir datasets/vortak/filtered/ \
  --output_dir datasets/vortak/filtered/ \
  --thresh 0.35

# Danach: Trigger-Word manuell zu jeder Caption hinzufügen
python scripts/prepend_trigger.py datasets/vortak/filtered/ "vortak_race"
```

**Hilfsskript `scripts/prepend_trigger.py`:**
```python
#!/usr/bin/env python3
import os, sys

def prepend_trigger(directory, trigger_word):
    for fn in os.listdir(directory):
        if fn.endswith('.txt'):
            path = os.path.join(directory, fn)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            if not content.startswith(trigger_word):
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(f"{trigger_word}, {content}")
                print(f"Updated: {fn}")

if __name__ == '__main__':
    prepend_trigger(sys.argv[1], sys.argv[2])
```

### Phase 3: Training starten (Kohya SS)

```powershell
# Kohya SS via GUI starten
python gui.py

# Oder direkt:
python train_network.py \
  --pretrained_model_name_or_path "models/sd_xl_base_1.0.safetensors" \
  --train_data_dir "datasets/vortak/filtered" \
  --output_dir "loras/output" \
  --output_name "vortak_lora_v1" \
  --resolution "1024,1024" \
  --batch_size 2 \
  --max_train_epochs 15 \
  --learning_rate 4e-4 \
  --lr_scheduler cosine_with_restarts \
  --network_module networks.lora \
  --network_dim 32 \
  --network_alpha 16 \
  --optimizer_type AdamW8bit \
  --mixed_precision bf16 \
  --gradient_checkpointing \
  --save_every_n_epochs 5 \
  --sdxl \
  --no_half_vae \
  --cache_latents
```

### Phase 4: Ergebnis testen

```
# In SwarmUI:
1. Extra Networks → LoRA → vortak_lora_v1 auswählen
2. Gewicht auf 0.85 setzen
3. Test-Prompt: "<lora:vortak_lora_v1:0.85> vortak_race male portrait"
4. Ergebnis mit Referenz-Bild vergleichen
```

### Phase 5: LoRA deployen

```powershell
# LoRA in SwarmUI-Modelle kopieren
copy loras\output\vortak_lora_v1.safetensors "C:\SwarmUI\Models\Lora\"

# LoRA für GalaxyQuest-API verfügbar machen
copy loras\output\vortak_lora_v1.safetensors "C:\SwarmUI\Models\Lora\gq\"
```

---

## 7. LoRA in SwarmUI verwenden

### Inline-Syntax (Prompt)

```
<lora:vortak_lora_v1:0.85> vortak_race male, portrait, general
```

Mehrere LoRAs kombinieren:
```
<lora:vortak_lora_v1:0.80> <lora:combat_lighting:0.40>
vortak_race male, dramatic portrait, battle-worn general
```

### Extra Networks Tab (SwarmUI GUI)

```
1. SwarmUI → Extra Networks → LoRA
2. vortak_lora_v1 anklicken
3. Gewicht im Schieberegler: 0.85
4. Wird automatisch dem Prompt vorangestellt
```

### SwarmUI API (Programmatisch)

SwarmUI unterstützt LoRAs über den `lora` Parameter in der API:

```json
{
  "session_id": "...",
  "prompt": "vortak_race male portrait, general commanding",
  "model": "OfficialStableDiffusion/sd_xl_base_1.0.safetensors",
  "loraweights": [
    {"model": "gq/vortak_lora_v1", "weight": 0.85}
  ],
  "width": 720,
  "height": 1024,
  "steps": 30,
  "cfgscale": 7.5
}
```

---

## 8. LoRA in der GalaxyQuest-API

### `swarmui_client.php` — LoRA-Generierung

Der SwarmUI-Client unterstützt LoRA-Adapter als `loras` Array in den Options:

```php
// Einzelne LoRA
$result = swarmui_generate(
    "vortak_race male portrait, commanding general",
    [
        'loras'  => ['gq/vortak_lora_v1:0.85'],
        'width'  => 720,
        'height' => 1024,
        'negativeprompt' => 'deformed face, bad anatomy, too human-looking',
    ]
);

// Mehrere LoRAs kombinieren
$result = swarmui_generate(
    "vortak_race male portrait, battle scene",
    [
        'loras'  => [
            'gq/vortak_lora_v1:0.80',
            'gq/combat_lighting:0.40',
        ],
        'width'  => 720,
        'height' => 1024,
    ]
);

if ($result['ok']) {
    swarmui_download_image($result['image_path'], 'gfx/portraits/Vor\'Tak_Drak\'Mol_m.png');
}
```

### Konfigurations-Konstanten (`config/config.php`)

```php
// LoRA-Pfad innerhalb der SwarmUI-Modell-Struktur
define('SWARMUI_LORA_PATH',      'gq/');

// Standard-Gewichte pro Rasse
define('LORA_WEIGHT_VORTAK',     0.85);
define('LORA_WEIGHT_SYLNAR',     0.80);
define('LORA_WEIGHT_AERETH',     0.80);
define('LORA_WEIGHT_KRYLTHA',    0.90);
define('LORA_WEIGHT_ZHAREEN',    0.85);
define('LORA_WEIGHT_VELAR',      0.75);
```

### Hilfsfunktion: Rassen-Portrait generieren

```php
/**
 * Generiert ein NPC-Portrait mit dem passenden LoRA-Adapter.
 *
 * @param  string $race      Rasse: 'vortak'|'sylnar'|'aereth'|'kryltha'|'zhareen'|'velar'
 * @param  string $gender    Geschlecht: 'male'|'female'
 * @param  string $npcName   NPC-Name für Dateiname
 * @param  string $extraDesc Zusätzliche Portrait-Beschreibung
 * @return array             swarmui_generate() Ergebnis
 */
function gq_generate_npc_portrait(
    string $race,
    string $gender,
    string $npcName,
    string $extraDesc = ''
): array {
    $loraWeights = [
        'vortak'  => LORA_WEIGHT_VORTAK,
        'sylnar'  => LORA_WEIGHT_SYLNAR,
        'aereth'  => LORA_WEIGHT_AERETH,
        'kryltha' => LORA_WEIGHT_KRYLTHA,
        'zhareen' => LORA_WEIGHT_ZHAREEN,
        'velar'   => LORA_WEIGHT_VELAR,
    ];
    $negativePrompt = 'deformed face, bad anatomy, extra limbs, fused fingers, '
        . 'blurry, watermark, text, too human-looking, generic, mundane';

    $weight   = $loraWeights[$race] ?? 0.80;
    $loraName = SWARMUI_LORA_PATH . $race . '_lora_v1';
    $trigger  = $race . '_race';
    $prompt   = trim("{$trigger} {$gender} portrait" . ($extraDesc ? ", {$extraDesc}" : ''));

    return swarmui_generate($prompt, [
        'loras'          => ["{$loraName}:{$weight}"],
        'negativeprompt' => $negativePrompt,
        'width'          => 720,
        'height'         => 1024,
        'steps'          => 30,
        'cfgscale'       => 7.5,
    ]);
}
```

---

## 9. Qualitätsbewertung & Iteration

### Bewertungs-Kriterien pro Portrait

| Kriterium | Gewicht | Prüfung |
|---|---|---|
| Rassen-Erkennbarkeit | 30 % | Ist die Rasse klar erkennbar ohne Prompt? |
| Konsistenz mit anderen Portraits | 25 % | Sieht es aus wie die gleiche Spezies? |
| Textur-Qualität | 20 % | Schuppen / Chitin / Kristall detailreich? |
| Gesichts-Anatomie | 15 % | Keine Deformierungen, korrekte Augen |
| Allgemeine Bildqualität | 10 % | Scharf, gut belichtet, keine Artefakte |

### Bewertungs-Score-System

```
5/5 ✨ Perfekt   → direkt verwenden
4/5 ✅ Gut       → verwenden, optional verfeinern
3/5 ⚠️ Akzeptabel → nur wenn besseres fehlt
2/5 ❌ Schwach   → nicht verwenden, neu generieren
1/5 💀 Fehlerhaft → löschen
```

### Wenn LoRA-Ergebnisse nicht gut sind

**Problem: Rasse zu wenig erkennbar (Score < 3)**
```
→ LoRA-Gewicht erhöhen: 0.85 → 0.95
→ Trigger-Word stärker betonen: "clearly vortak_race, very alien, non-human"
→ Mehr Trainingsbilder (besonders mit extremen Rassen-Merkmalen)
→ Trainings-Epochen erhöhen: 15 → 20
```

**Problem: Gesicht deformiert**
```
→ LoRA-Gewicht reduzieren: 0.85 → 0.70
→ Negative Prompt erweitern: "bad face anatomy, deformed eyes"
→ Steps erhöhen: 30 → 35
→ Anderen Sampler probieren: DPM++ 2M Karras → DPM++ SDE Karras
```

**Problem: Zu wenig Varianz (alle Portraits gleich)**
```
→ Seed randomisieren (-1)
→ CFG Scale reduzieren: 7.5 → 6.5
→ LoRA-Gewicht leicht reduzieren: 0.85 → 0.75
→ Dataset-Vielfalt prüfen (zu wenig Winkel/Beleuchtungs-Varianz?)
```

**Problem: Überanpassung (alle sehen aus wie Training-Bilder)**
```
→ Trainings-Epochen reduzieren: 15 → 10
→ Learning Rate reduzieren: 4e-4 → 2e-4
→ Caption Dropout erhöhen: 0.05 → 0.10
→ Dataset-Größe erhöhen (mehr Vielfalt)
```

---

## 10. Erweiterte Techniken

### 10.1 Character LoRA (Individuelle NPCs)

Für maximale Konsistenz bei wichtigen NPCs (z.B. General Drak'Mol):

```
Dataset: 15–20 Bilder des spezifischen Charakters
Trigger:  "draksmol_npc" (charakter-spezifisch)
LoRA:     draksmol_lora_v1.safetensors

Verwendung:
  <lora:vortak_lora_v1:0.60> <lora:draksmol_lora_v1:0.90>
  draksmol_npc, vortak_race male, commanding general portrait
```

Das Rassen-LoRA (niedriges Gewicht) gibt die Basis-Textur,
das Charakter-LoRA (hohes Gewicht) fixiert das spezifische Gesicht.

### 10.2 Style LoRA (Konsistenter Art-Style)

Für konsistenten visuellen Stil über alle Portraits:

```
Dataset: 30–50 Bilder im gewünschten Stil (z.B. cinematic sci-fi portrait)
Trigger:  "gq_art_style"
Gewicht:  0.30–0.50 (immer in Kombination mit Rassen-LoRA)

Verwendung:
  <lora:vortak_lora_v1:0.85> <lora:gq_art_style:0.40>
  vortak_race male portrait
```

### 10.3 LoRA Merging (Kombinierte Stile)

Zwei LoRAs können mit `mergemodels` zu einem zusammengeführt werden:

```powershell
# Kohya SS merge_lora.py
python merge_lora.py \
  --models_dir "loras/" \
  --save_to "loras/vortak_cinematic_merged.safetensors" \
  --models "vortak_lora_v1.safetensors=0.7:gq_art_style.safetensors=0.3" \
  --device cuda
```

### 10.4 Textual Inversion (Leichtgewichtige Alternative)

Für einfache Konzept-Einbettungen ohne GPU-Training:

```
1. SwarmUI → Train → Textual Inversion
2. Dataset: 5–10 Bilder
3. Token: "<vortak>"
4. Trainingszeit: ~10 min (auch auf CPU machbar)
5. Verwendung: "<vortak> male portrait"
```

**Nachteil:** Weniger präzise als LoRA, aber keine GPU nötig.

### 10.5 DreamBooth (Maximale Charakter-Lock)

Für absolute Konsistenz bei Hauptcharakteren (Story-Cutscenes):

```
Methode:       DreamBooth LoRA
Dataset:       20–30 Bilder eines Charakters
Trainingszeit: ~45–90 min
Ergebnis:      Nahezu perfekte Reproduzierbarkeit
Nachteil:      Größere LoRA-Datei (150–300 MB statt 50 MB)
```

---

## 11. Troubleshooting

### Training schlägt fehl

| Fehlermeldung | Ursache | Lösung |
|---|---|---|
| `CUDA out of memory` | Zu wenig VRAM | `batch_size 2 → 1`, `gradient_checkpointing=true` |
| `NaN loss detected` | Learning Rate zu hoch | `4e-4 → 2e-4 → 1e-4` |
| `Cannot find image file` | Falscher Pfad | Pfade prüfen, Backslash/Forward-Slash |
| `No captions found` | `.txt` Dateien fehlen | Caption-Tool erneut ausführen |
| `Resolution mismatch` | Bild nicht 1024×1024 | Bilder auf 1024 skalieren/zuschneiden |

### LoRA lädt nicht in SwarmUI

```
Problem: LoRA erscheint nicht in Extra Networks
Lösung:
  1. SwarmUI neu starten (Models-Cache refresh)
  2. LoRA in korrektem Verzeichnis: Models/Lora/
  3. Format prüfen: .safetensors (nicht .pt oder .ckpt)
  4. SwarmUI → Settings → Refresh Models Button
```

### API gibt Fehler zurück

```php
// Fehler: "SwarmUI returned no images"
// Ursache: LoRA-Datei nicht gefunden oder falscher Pfad

// Lösung: LoRA-Pfad in swarmui_generate() debuggen
$debug = swarmui_list_models();
var_dump($debug['models']);  // Verfügbare Modelle anzeigen
// → LoRA muss in 'Lora/' Unterverzeichnis gelistet sein
```

---

## 12. Dateistruktur & Versionierung

### Empfohlene Ordnerstruktur

```
GalaxyQuest/
├── datasets/               ← Trainings-Daten (NICHT ins Git!)
│   ├── vortak/
│   │   ├── raw/
│   │   ├── filtered/
│   │   └── augmented/
│   ├── sylnar/ ...
│   └── [weitere Rassen]/
│
├── loras/                  ← Fertige LoRA-Modelle
│   ├── output/             ← Trainings-Ausgabe (NICHT ins Git!)
│   └── releases/           ← Finale, getestete LoRAs
│       ├── vortak_lora_v1.safetensors
│       ├── vortak_lora_v1.json          ← Metadaten
│       ├── sylnar_lora_v1.safetensors
│       └── [weitere LoRAs]/
│
├── scripts/
│   └── prepend_trigger.py  ← Caption-Vorbereitung
│
└── gfx/portraits/          ← Generierte Portraits (selektiv ins Git)
    ├── Vor'Tak/
    ├── Syl'Nar/
    └── ...
```

### .gitignore Ergänzungen

```gitignore
# LoRA Training Daten (zu groß für Git)
datasets/
loras/output/

# Nur fertige LoRAs explizit tracken (mit Git LFS)
# loras/releases/*.safetensors
```

### Git LFS für LoRA-Dateien (Optional)

```bash
# Git LFS initialisieren
git lfs install
git lfs track "*.safetensors"
git add .gitattributes

# LoRA commiten
git add loras/releases/vortak_lora_v1.safetensors
git commit -m "Add: Vor'Tak race LoRA v1 (32dim, 15ep)"
```

### LoRA Metadaten (JSON pro LoRA)

```json
// loras/releases/vortak_lora_v1.json
{
  "name":          "vortak_lora_v1",
  "race":          "Vor'Tak",
  "trigger_word":  "vortak_race",
  "base_model":    "sd_xl_base_1.0",
  "network_dim":   32,
  "network_alpha": 16,
  "epochs":        15,
  "dataset_size":  22,
  "training_tool": "Kohya SS",
  "recommended_weight": 0.85,
  "weight_range":  [0.70, 1.00],
  "created":       "2026-04-01",
  "version":       "1.0",
  "notes":         "Gut für Portraits und Halbkörper. Szenen mit LoRA-Gewicht 0.75 verwenden."
}
```

---

## Anhang: Schnell-Referenz Checkliste

### Training starten (Minimalversion)

```
[ ] 1. Dataset: 15–25 gefilterte Bilder in datasets/[rasse]/filtered/
[ ] 2. Captions: .txt Datei pro Bild, beginnt mit Trigger-Word
[ ] 3. Tool: Kohya SS oder OneTrainer gestartet
[ ] 4. Config: SDXL, Dim 32, Alpha 16, LR 4e-4, 15 Epochen
[ ] 5. Training starten (~20–60 Min je nach GPU)
[ ] 6. Bestes Checkpoint-LoRA auswählen (aus Epoch 10 / 15 / 20)
[ ] 7. In SwarmUI testen mit Standard-Test-Prompt
[ ] 8. Gewicht optimieren (0.70–1.00 testen)
[ ] 9. In Models/Lora/gq/ deployen
[ ] 10. swarmui_generate() mit loras-Parameter testen
```

### LoRA-Verwendung (Minimalversion)

```
[ ] LoRA-Datei in SwarmUI Models/Lora/ vorhanden
[ ] Prompt: "<lora:rasse_lora_v1:0.85> rasse_race gender portrait"
[ ] Negativer Prompt: "deformed, bad anatomy, too human"
[ ] Steps: 30, CFG: 7.5, Resolution: 720×1024
[ ] Ergebnis mit Original-Portrait vergleichen
[ ] Bei Qualitätsproblemen: Gewicht anpassen ±0.10
```

---

**Status:** Vollständiger Produktions-Guide | LoRA-Training bereit | API-Integration dokumentiert  
**Nächster Schritt:** Dataset für Vor'Tak generieren → Training starten → Ergebnis validieren  
**Referenzen:** `ART_PROMPTS_SDXL.md` (Basis-Prompts) · `ART_QUICKSTART.md` (SwarmUI-Setup) · `api/swarmui_client.php` (API-Integration)
