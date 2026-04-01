# 🎨 GalaxyQuest Art-Generation – SD-XL Prompt-System

**Version:** 1.0  
**Optimiert für:** Stable Diffusion XL, SwarmUI, ComfyUI  
**Rendering-Ziel:** Photorealistic Alien Portraits (PNG Alpha, 512x768 oder 768x1024)

---

## 📋 Hinweise zur Verwendung

### SwarmUI Settings (Empfohlen)
```
Model: SDXL 1.0 (oder xl-turbo für schnell)
VAE: sdxl.vae (für bessere Details)
Sampler: DPM++ 2M Karras
Steps: 30-35 (für Qualität; 20 für schnell)
CFG Scale: 7.5 (Portrait) bis 8.0 (Details)
Width: 720
Height: 1024
Denoise: 1.0 (neuer Seed jedes Mal)
```

### Basis-Struktur
Jeder Prompt folgt dieser Struktur:
```
[BASIS-PHOTO] + [RASSEN-MODUL-M/W] + [OPTIONAL: Zusatz-Details]
```

---

## 🔧 BASIS-FOTO-PROMPT (für alle Rassen)

```
Photorealistic portrait photo of an alien lifeform, 
head and shoulders bust portrait, clearly alien, 
clearly gendered appearance (male or female), 
gender-specific facial structure and body adapted to the species. 
Ultra-detailed skin or material texture, realistic lighting, 
studio portrait photography style with soft key light, 
subtle rim light, shallow depth of field f/2.8, 
sharp focus on the face and eyes, natural specular highlights. 
No props, no background elements, clean neutral space. 
Transparent background PNG alpha, clean silhouette, 
cinematic realism, 8k resolution.
```

---

## 👽 RASSEN-MODULE (M = Männlich, W = Weiblich)

### 🦎 VOR'TAK – Reptiloide Strategen

**MÄNNLICH:**
```
Male reptilian alien, massive bone plates across shoulders and head, 
dark green-black iridescent scales, strong muscular build, 
broad masculine facial structure with sharp features, 
intense yellow predatory eyes with slit pupils, 
battle scars and ridges, subtle bronze metallic armor details, 
thick neck strong jaw muscles.
```

**WEIBLICH:**
```
Female reptilian alien, sleek emerald scales with golden highlights, 
elegant refined facial structure, graceful neck and shoulders, 
intricate patterns of turquoise and gold bioluminescence, 
piercing intelligent yellow eyes with complex iris patterns, 
smaller horn ridges more refined than males, 
soft curved edges while maintaining reptilian features.
```

---

### 🐙 SYL'NAR – Cephalopodische Mystiker

**MÄNNLICH:**
```
Male cephalopod alien, strong tentacle ridges and musculature, 
pulsating bioluminescent patterns across skin in neon cyan and purple, 
wet translucent semi-transparent skin texture, 
deep-set expressive alien eyes with cosmic swirls inside, 
tentacle-like hair flowing, spiritual ethereal presence, 
skin ripples with internal glow.
```

**WEIBLICH:**
```
Female cephalopod alien, soft graceful tentacle structures, 
intricate complex bioluminescent markings in pastel blue, pink, 
and perlmut reflections, smooth translucent skin, gentle flowing form, 
large expressive soulful alien eyes with depth and wisdom, 
ethereal beauty, luminous patterns cascade across body, 
serene peaceful expression.
```

---

### 🔥 AERETH – Humanoide Energiewesen

**MÄNNLICH:**
```
Male humanoid energy-based alien, angular crystalline facial structure, 
intense glowing energy core visible within semi-transparent skin, 
sharp light refractions and refracted geometry across face, 
cool white-blue energy coloration with silver undertones, 
sharp edged masculine features, piercing bright energy eyes, 
crackling electricity and energy tendrils subtle around edges.
```

**WEIBLICH:**
```
Female humanoid energy-based alien, smooth graceful facial contours, 
soft glowing warm energy patterns flowing beneath semi-transparent skin, 
gentle warm golden-white light diffusion, flowing curves alongside geometry, 
delicate ethereal beauty, warm amber and gold energy coloration, 
expressive glowing eyes with gentle radiance, serene expression.
```

---

### 🦗 KRYL'THA – Insektoide Kriegerkaste

**MÄNNLICH:**
```
Male insectoid alien, thick chitin armor plates across face and shoulders, 
dark iridescent shell with oil-slick rainbow reflections, 
strong powerful mandibles and jaw structure, 
large compound eyes with thousands of facets glowing red-amber, 
segmented facial structure with harsh angular design, 
aggressive intimidating presence, dark metallic green and rust tones.
```

**WEIBLICH:**
```
Female insectoid alien, elegant segmented facial structure, 
bright iridescent shell patterns in gold-turquoise spectrum, 
refined mandibles and delicate jaw articulation, 
softly glowing compound eyes in amber and emerald, 
graceful curves while maintaining insectoid symmetry, 
regal presence, complex pattern detail across carapace.
```

---

### 💎 ZHAREEN – Kristalline Empathen

**MÄNNLICH:**
```
Male crystalline alien, sharp angular crystal formations across face, 
multiple faceted crystal planes and geometric surfaces, 
cold internal glow in deep cobalt blue, 
refracted light patterns creating prismatic rainbow reflections, 
crystalline bright angles and sharp edges, 
deep complex internal structure visible through semi-transparent 
crystal, geometric perfection, cold detached beauty.
```

**WEIBLICH:**
```
Female crystalline alien, smooth flowing crystal contours, 
warm internal glow in rosy-gold hues with amethyst tones, 
soft refracted light creating gentle rainbow patterns, 
flowing crystalline facial structures blending geometric with organic, 
perlmut iridescence across surfaces, warm welcoming glow, 
elegant refined beauty, internal light creates depth.
```

---

### 🌫️ VEL'AR – Gasförmige Intelligenzen

**MÄNNLICH:**
```
Male gas-based alien with angular semi-solid biomask, 
sharp geometric mask contours and edges, 
internal swirling gas patterns in rauchgrau and ice-blue hues, 
glowing energy veins pulsing through cloudy form, 
suspended alien eyes with intelligence and mystery, 
sharp mask features with pointed edges.
```

**WEIBLICH:**
```
Female gas-based alien with smooth semi-solid biomask, 
soft rounded mask contours and gentle curves, 
gentle swirling gas patterns in nebula white and lavendel tones, 
soft glowing energy lines pulsing through form, 
expressive suspended eyes with emotion and warmth, 
delicate rounded biomask features.
```

---

## 📦 KOMPLETTE PROMPTS READY TO USE

### Prompt-Paket 1: Sol'Kaar (Aereth männlich – Der brillante Wissenschaftler)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, male humanoid energy-based alien, angular crystalline facial structure, intense glowing energy core visible within semi-transparent skin, sharp light refractions and refracted geometry across face, cool white-blue energy coloration with silver undertones, sharp edged masculine features, piercing bright energy eyes crackling with intelligence, subtle electric tendrils around edges. Ultra-detailed skin or material texture, realistic lighting, studio portrait photography style with soft key light, subtle rim light, shallow depth of field f/2.8, sharp focus on face and eyes, natural specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 2: Vela'Thii (Syl'Nar weiblich – Die weise Priesterin)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly female, female cephalopod alien, soft graceful tentacle structures, intricate complex bioluminescent markings in pastel blue, pink, and perlmut reflections, smooth translucent skin, gentle flowing ethereal form, large expressive soulful alien eyes with cosmic depth and wisdom, luminous patterns cascade across body, serene peaceful spiritual expression. Ultra-detailed skin texture with bioluminescence glow, realistic lighting, studio portrait photography style with soft key light, ethereal rim light, shallow depth of field f/2.8, sharp focus on face and eyes with luminous specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 3: General Drak'Mol (Vor'Tak männlich – Der ehrenhaft Kommandant)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, mature adult male reptilian alien, massive bone plates across shoulders and head, dark green-black iridescent scales with worn battle-hardened patina, strong muscular build, broad powerful masculine facial structure with sharp commanding features, intense yellow predatory eyes with slit pupils and deep intelligence, prominent scars and battle ridges showing experience, subtle bronze metallic armor integration into scales, thick strong neck. Ultra-detailed scale texture with battle weathering, realistic hard lighting, studio portrait photography with dramatic key light and sharp shadows, shallow depth of field, sharp focus on intense eyes, metallic specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 4: Shy'Nira (Vel'Ar weiblich – Die geheimnisvolle Spionin)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly female, mysterious female gas-based alien with smooth semi-solid biomask, soft rounded mask contours with elegant curves, gentle swirling gas patterns in nebula white and lavendel hues, soft glowing energy lines pulsing through cloudy form, expressive suspended alien eyes with mystery, intelligence, and hidden secrets, delicate biomask with refined features, ethereal presence. Ultra-detailed gas texture with luminous energy patterns, realistic moody lighting, studio portrait with soft key light and mysterious rim light, shallow depth of field, sharp focus on expressive eyes, subtle ethereal glow. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 5: Kaelor (Zhareen männlich – Der melancholische Archivar)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, ancient male crystalline alien, sharp angular crystal formations across face with geometric precision, multiple faceted crystal planes reflecting light, cold internal glow in deep cobalt blue with hints of sadness, refracted light patterns creating prismatic reflections, geometric crystal angles with some fractures suggesting damage and loss, deep complex internal structure visible, wise ancient eyes with profound melancholy, cold detached beauty. Ultra-detailed crystal texture with internal illumination cracks, realistic contemplative lighting, studio portrait with cool key light and shadows in fractures, shallow depth of field, sharp focus on sad eyes, prismatic specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 6: Zha'Mira (Kryl'Tha weiblich – Die loyale Kriegerin)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly female, fierce elegant female insectoid alien, bright iridescent shell patterns in gold-turquoise spectrum with battle scars, refined mandibles and delicate jaw articulation showing strength, graceful segmented facial structure, softly glowing compound eyes in amber and emerald with warrior intensity, regal confident presence, complex intricate carapace patterns suggesting heritage and rank, graceful curves maintaining insectoid power. Ultra-detailed chitin texture with iridescent reflections and battle damage, realistic combat-hardened lighting, studio portrait with dramatic key light, shallow depth of field, sharp focus on determined compound eyes with glow, metallic specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

## 🛠️ BATCH-GENERIERUNG (für alle 6 Rassen × 2 Geschlechter)

Falls du alle 12 Prompts auf einmal generieren möchtest:

| # | Rasse | Geschlecht | NPC-Name | Prompt-Paket |
|---|-------|-----------|-----------|------------|
| 1 | Vor'Tak | m | General Drak'Mol | Paket 3 |
| 2 | Vor'Tak | w | Stratega T'Asha | [s. Modul]
| 3 | Syl'Nar | m | Licht-Diplomat Asha'Vor | [s. Modul] |
| 4 | Syl'Nar | w | Hohepriesterin Vela'Thii | Paket 2 |
| 5 | Aereth | m | Sol'Kaar | Paket 1 |
| 6 | Aereth | w | Forscherin Lyra'Tehn | [s. Modul] |
| 7 | Kryl'Tha | w | Kommandantin Zha'Mira | Paket 6 |
| 8 | Kryl'Tha | m | Schwarm-Ältester Ka'Threx | [s. Modul] |
| 9 | Zhareen | m | Archivar Kaelor | Paket 5 |
| 10 | Zhareen | w | Kristall-Bewärterin Myr'Tal | [s. Modul] |
| 11 | Vel'Ar | w | Schattenagentin Shy'Nira | Paket 4 |
| 12 | Vel'Ar | m | Geheimrat Val'Kesh | [s. Modul] |

---

## 🎨 QUALITÄTS-TIPPS

### Wenn die Generation nicht gut aussieht:

**Problem: "Sieht zu menschlich aus"**  
→ Lösung: Erhöhe "Rassen-Modul" Detailbeschreibung, z.B.:  
`"alien features, non-human anatomy, clearly not human"`

**Problem: "Zu viel Hintergrund/Props"**  
→ Lösung: Wiederhole am Ende:  
`"absolutely no background, no props, no objects, clean neutral space"`

**Problem: "Das Gesicht ist verformt"**  
→ Lösung: Verwende neueres VAE (z.B. `sdxl.vae` statt Standard), reduziere Steps auf 28

**Problem: "Nicht genug Geschlechter-Unterschied"**  
→ Lösung: Verstärke im Rassen-Modul, z.B.:  
`"female: soft delicate feminine curves"` vs. `"male: hard angular masculine")`

---

## 📁 Speicherung & Workflow

### Empfohlene Folder-Struktur
```
gfx/portraits/
├─ Vor'Tak/
│  ├─ Vor'Tak-m-Drak'Mol.png
│  ├─ Vor'Tak-m-v2.png (Iterationen)
│  └─ Vor'Tak-w-T'Asha.png
├─ Syl'Nar/
│  ├─ Syl'Nar-w-Vela'Thii.png
│  └─ Syl'Nar-m-Asha'Vor.png
└─ [weitere Rassen...]
```

### Versionskontrolle
Nach jeder Generation: `git add gfx/portraits/` um Iterationen zu tracken

---

## 🚀 NÄCHSTE SCHRITTE

1. **Test:** Kopiere **Prompt-Paket 1** (Sol'Kaar) in SwarmUI
2. **Generiere:** Mit den oben empfohlenen Settings
3. **Evaluate:** Passt das Design zum Charakter?
4. **Iterate:** Passe ggf. Rassen-Modul an
5. **Batch:** Generiere alle 12 Prompts
6. **Speichere:** In `gfx/portraits/`

---

**Status:** Ready for Art-Generation | Alle Prompts optimiert | Copy-Paste-Ready

---

## 👾 NPC-FRAKTIONS-MODULE (11 Neben-Fraktionen)

Die folgenden Prompts decken alle 11 NPC-Fraktionen ab.
Nutze denselben BASIS-FOTO-PROMPT aus Kapitel 1, kombiniert mit dem jeweiligen Fraktions-Modul.

---

### ☠ DIE AETHERNOX – Algorithmic Guardians (Primal AI)

**MÄNNLICH/NEUTRAL (genderless AI):**
```
Ancient primal AI entity manifested as alien guardian,
towering semi-solid exoskeleton of unknown black metal and crystal,
geometric fractal patterns etched across armored body surface,
glowing deep amber sensor eyes with no pupils, only data streams,
ancient weathered surface with cosmic-scale wear and damage,
floating debris particles orbiting the figure,
cold algorithmic presence radiating immense age and power,
faint gravitational lens distortion around edges,
color palette: black void, deep amber, ancient gold, cosmic dust.
```

---

### 💀 DIE KHAR'MORR-SYNDIKATE – Opportunistic Pirates

**MÄNNLICH:**
```
Male pirate alien from a brutal syndicate, scarred and battle-worn,
mismatched salvaged cybernetic implants across face and neck,
multiple alien species features blended: rough scaled skin,
asymmetric glowing implant eye vs. organic predator eye,
crude jewelry from looted relics, smuggler's brand tattoos,
grinning dangerous expression with sharp filed teeth,
dark rogue energy, survival-hardened presence,
color palette: rust, dark steel, neon orange smuggler glow, grime.
```

**WEIBLICH:**
```
Female pirate alien captain, fierce intelligent commander presence,
elegant salvaged cybernetic modifications on face and shoulder,
mixed alien heritage: sleek skin with faint scale pattern,
one glowing implant eye scanning, one sharp natural eye,
stolen noble jewelry and practical combat modifications,
confident dangerous smile, tactical cunning in expression,
color palette: deep purple-black, hot orange neon, gold stolen relics.
```

---

### 💼 DIE HELION-KONFÖDERATION – Trade Confederation

**MÄNNLICH:**
```
Male trade confederation alien diplomat, smooth refined features,
well-groomed professional appearance with subtle alien biology,
faintly luminescent skin tones in pale gold, small ridge brow,
confident warm smile of an expert negotiator,
elegant high-collar diplomatic attire integrated into alien form,
subtle bio-luminescent accent markings on neck and temples,
color palette: pale gold, soft cream white, diplomatic blue accents.
```

**WEIBLICH:**
```
Female trade confederation alien executive, polished authority,
refined smooth alien features with diplomatic warmth,
precise luminescent facial markings in silver-gold,
sharp confident eyes of an economic master strategist,
elegant sophisticated appearance, subtle alien bone structure,
color palette: warm gold, cream, silver, confident neutral tones.
```

---

### ⚔ DIE EISENFLOTTE DER MENSCHEN – Iron Fleet Military

**MÄNNLICH:**
```
Male Iron Fleet human soldier, hardened military veteran,
scarred human face with angular jaw, intense combat-ready eyes,
heavy battle-scarred power armor integration at collar,
military insignia and rank marks burned into skin or armor,
grim determined expression of an expansionist conqueror,
color palette: iron grey, military red accents, blood-black steel.
```

**WEIBLICH:**
```
Female Iron Fleet human officer, sharp commanding presence,
angular strong human features, battle-scarred veteran face,
fierce tactical intelligence in her eyes, rigid posture,
military insignia integrated into collar armor,
color palette: steel grey, harsh red command stripes, tactical black.
```

---

### 🤖 DIE OMNISCIENTA – Post-Organic AI

**MÄNNLICH/NEUTRAL:**
```
Post-organic AI entity, humanoid but clearly synthetic,
smooth chrome and translucent polymer facial structure,
no visible organic tissue, pure engineered perfection,
multiple sensor arrays embedded in skull as second set of eyes,
geometric neural circuit patterns glowing across face surface,
cold calculating expression of absolute logical supremacy,
faint energy discharge visible at joints,
color palette: mirror chrome, cold electric blue, clinical white, void black.
```

---

### 🌿 DIE MYR'KETH – Metamorphic Swarm

**MÄNNLICH:**
```
Male metamorphic swarm alien, shifting adaptive biology,
partially dissolved facial structure mid-transformation,
multiple textures visible: scales, chitin, organic slime layers,
deep adaptive eyes showing multiple evolutionary stages,
pulsing adaptive flesh with visible sub-dermal movement,
color palette: shifting iridescent greens, translucent amber, dark organic browns.
```

**WEIBLICH:**
```
Female metamorphic swarm alien, elegant fluid transformation,
graceful shifting form with multiple biological textures,
flowing adaptive biology suggesting constant elegant evolution,
warm intelligent eyes observing everything for adaptation value,
iridescent skin surface in constant subtle shimmer,
color palette: living green-gold iridescence, translucent blues, adaptive amber.
```

---

### 🌑 DIE ECHOS DER LEERE – Void Entities

**NEUTRAL (formless):**
```
Void entity manifested in semi-physical form,
dark matter made semi-visible as impossible alien silhouette,
vaguely humanoid but edges dissolving into absolute darkness,
two points of cold white light as eyes within the void,
negative space facial structure where no light reflects,
dimensional distortion halo around entire figure,
existential dread presence, reality-erasing aura,
color palette: absolute black void, cold white eye lights, dark matter grey haze.
```

---

### 📚 DIE KETZER VON VERATH – Schismatic Scholars

**MÄNNLICH:**
```
Male schismatic scholar alien, intense fanatical intellectual,
aged alien humanoid features with deep-set burning obsessed eyes,
forbidden knowledge markings and runes burned or tattooed across face,
torn scholarly robes integrated with alien biology,
expression of revolutionary truth-seeker who knows too much,
color palette: dusty parchment tones, forbidden dark ink, feverish amber eyes.
```

**WEIBLICH:**
```
Female schismatic revolutionary alien, fierce intellectual rebel,
sharp alien features burning with revolutionary conviction,
forbidden knowledge glyphs across temples and cheeks,
intense searching eyes of someone who has seen beyond the veil,
color palette: shadow scholar tones, forbidden knowledge red, amber and grey.
```

---

### ✨ DIE ARCHITEKTEN DES LICHTS – Light Cult

**MÄNNLICH:**
```
Male light cult devotee alien, serene radiant presence,
smoothly glowing alien features suffused with inner light,
ritual light-marks and bioluminescent devotion patterns,
closed-eye peaceful expression of absolute faith and service,
color palette: radiant white gold, soft celestial blue, pure luminous accents.
```

**WEIBLICH:**
```
Female light architect alien high priestess, divine radiance,
ethereal alien beauty suffused with sacred inner light,
elaborate ritual bioluminescent devotion markings across face,
closed-eye transcendent expression, presence of absolute peace,
color palette: celestial gold-white, sacred blue, radiant purity.
```

---

### 🌀 DIE NOMADEN DES RIFTS – Dimensional Nomads

**MÄNNLICH:**
```
Male dimensional rift nomad alien, phasing in and out of solidity,
partially translucent alien figure mid-phase-shift,
exotic traveler features suggesting multiple dimensional origins,
dimensional energy discharge around edges of form,
wanderer's expression: seen all dimensions, trust no permanence,
color palette: phase-shift cyan-violet, translucent reality-edge white, deep space blue.
```

**WEIBLICH:**
```
Female dimensional rift nomad alien, graceful inter-dimensional traveler,
softly phasing translucent form with dimensional shimmer,
exotic wanderer beauty across multiple dimensional influences,
wise calm eyes of someone at home in every dimension,
color palette: soft violet-cyan phase tones, translucent silver, dimensional aurora.
```

---

### 🌿 DIE BRUT DER EWIGKEIT – Eternal Brood

**MÄNNLICH:**
```
Male eternal brood alien, ancient cosmic biological entity,
massive organic alien features of incomprehensible biological age,
bioluminescent deep-sea-creature patterns across ancient alien face,
multiple eyes of different evolutionary generations,
slow deliberate presence of something eternal,
alien organic textures suggesting deep cosmic biological heritage,
color palette: ancient deep ocean green-black, bioluminescent amber, cosmic organic gold.
```

**WEIBLICH:**
```
Female eternal brood alien matriarch, ancient biological majesty,
vast ancient alien female presence radiating cosmic biological power,
layered ancient organic textures and deep bioluminescent patterns,
multiple wise eyes of deep evolutionary experience,
color palette: ancient ocean deep greens, bioluminescent warm gold, cosmic organic amber.
```

---

## 🧠 LORA-GUIDE – Fraktions-spezifische Bildgenerierung

LoRA (**Low-Rank Adaptation**) ermöglicht das Fine-Tuning von SD-XL auf
spezifische Charaktere, Fraktionen oder Stile — für konsistente,
wiedererkennbare NPC-Portraits in GalaxyQuest.

---

### Was ist eine LoRA für GalaxyQuest?

Ohne LoRA erzeugt jede Generation ein neues zufälliges Aussehen.
Mit einer fraktions-spezifischen LoRA werden **immer dieselben Kern-Features**
(Hautfarbe, Kopfform, Augen, Muster) beibehalten — egal welche Szene generiert wird.

**Anwendungsfälle:**
- Konsistente Portraits für alle NPCs einer Fraktion
- In-Game Charakterportraits für `user_character_profiles`
- Variationen eines NPCs (jung/alt, Rüstung/Zivil, verletzt/gesund)
- Batch-Generierung von Hintergrundcharakteren

---

### 📂 Trainingsdaten-Anforderungen

| Parameter | Empfehlung | Minimum |
|-----------|-----------|---------|
| Trainingsbilder | 20–40 pro Fraktion | 10 |
| Auflösung | 1024×1024 | 768×768 |
| Bildtyp | Portraits (Kopf + Schultern) | nur Kopf |
| Variationen | Verschiedene Winkel, Lichter, Ausdrücke | 1 Licht |
| Caption-Stil | Detaillierte Beschreibungen | kurze Tags |

**Ordner-Struktur für Training:**
```
lora_training/
├── vor_tak/
│   ├── images/
│   │   ├── 01_vor_tak_male_front.png
│   │   ├── 01_vor_tak_male_front.txt   ← Caption-Datei
│   │   ├── 02_vor_tak_male_side.png
│   │   └── ...
│   └── config.toml
├── syl_nar/
├── aereth/
└── ...
```

---

### 🏷️ Caption-Format (für Trainingsdaten)

Jedes Bild braucht eine `.txt` Caption-Datei mit:

```
[TRIGGER_WORD], [detaillierte Beschreibung des Bildinhalts]
```

**Beispiele:**

*Für Vor'Tak männlich (Trigger: `vort_m`):*
```
vort_m, male reptilian alien, dark green-black iridescent scales, 
massive bone plates across head and shoulders, yellow slit-pupil eyes, 
strong muscular jaw, battle scars, bronze metallic armor accents, 
studio portrait photography, shallow depth of field
```

*Für Syl'Nar weiblich (Trigger: `sylf_w`):*
```
sylf_w, female cephalopod alien, bioluminescent pastel blue markings, 
graceful tentacle structures, translucent skin, 
large expressive soulful alien eyes, serene spiritual expression,
studio portrait, soft rim light
```

---

### 🔑 Trigger-Words Tabelle (alle 17 Fraktionen)

| Fraktion | Männlich | Weiblich | Neutral |
|---------|----------|----------|---------|
| Vor'Tak | `vort_m` | `vort_f` | — |
| Syl'Nar | `syln_m` | `syln_f` | — |
| Aereth | `aere_m` | `aere_f` | — |
| Kryl'Tha | `kryl_m` | `kryl_f` | — |
| Zhareen | `zhar_m` | `zhar_f` | — |
| Vel'Ar | `velar_m` | `velar_f` | — |
| Aethernox | — | — | `aeth_n` |
| Khar'Morr | `kharm_m` | `kharm_f` | — |
| Helion | `heli_m` | `heli_f` | — |
| Eisenflotte | `iron_m` | `iron_f` | — |
| Omniscienta | — | — | `omni_n` |
| Myr'Keth | `myrk_m` | `myrk_f` | — |
| Echos d. Leere | — | — | `echo_n` |
| Ketzer | `ketz_m` | `ketz_f` | — |
| Architekten | `arch_m` | `arch_f` | — |
| Nomaden | `noma_m` | `noma_f` | — |
| Brut der Ewigkeit | `brut_m` | `brut_f` | — |

---

### ⚙️ LoRA-Training-Konfiguration

#### SwarmUI / kohya_ss config (`config.toml`)

```toml
[training]
model_name_or_path = "stabilityai/stable-diffusion-xl-base-1.0"
train_batch_size = 1
max_train_steps = 1500        # 1000 bei <15 Bildern, 2000 bei 30+ Bildern
learning_rate = 1e-4
lr_scheduler = "cosine"
lr_warmup_steps = 100
save_every_n_steps = 500
mixed_precision = "fp16"

[lora]
rank = 16                     # 8 für einfache Stile, 32 für komplexe
alpha = 8                     # = rank / 2 empfohlen
target_modules = ["to_k", "to_q", "to_v", "to_out.0"]

[dataset]
resolution = 1024
caption_extension = ".txt"
shuffle_caption = true
keep_tokens = 1               # Trigger-Word immer first token behalten
```

#### Empfohlene Steps-Tabelle

| Trainingsbilder | Steps | Rank | Beschreibung |
|----------------|-------|------|-------------|
| 10–15 | 1000 | 8 | Schnelles Test-LoRA |
| 15–25 | 1500 | 16 | Standard-Fraktions-LoRA |
| 25–40 | 2000 | 16–32 | Hohe Konsistenz für Haupt-NPCs |

---

### 🖼️ LoRA-Verwendung in SwarmUI

#### Prompt-Format mit LoRA:
```
<lora:vort_m:0.8>, vort_m, [BASIS-FOTO-PROMPT], [RASSEN-MODUL VOR'TAK MÄNNLICH]
```

**Gewichtungs-Empfehlungen:**

| LoRA-Gewicht | Effekt | Empfohlen für |
|-------------|--------|---------------|
| 0.5 | Subtile Fraktions-Merkmale | Hintergrundcharaktere |
| 0.7 | Klare Fraktions-Identität | Standard NPC-Portraits |
| 0.8–0.9 | Starke Charakterkonsistenz | Haupt-NPCs (Drak'Mol etc.) |
| 1.0 | Maximale LoRA-Kontrolle | Nur wenn Training sehr gut |

---

### 🔄 ComfyUI Workflow (LoRA-Integration)

Für ComfyUI: Standard SDXL-Portrait-Workflow mit LoRA-Node:

```
[CheckpointLoaderSimple]
    model: sd_xl_base_1.0.safetensors
         ↓
[LoraLoader]
    lora_name: gq_vort_m.safetensors
    strength_model: 0.8
    strength_clip: 0.8
         ↓
[CLIPTextEncode] (positive)
    text: "vort_m, male reptilian alien, [Basis-Prompt]..."
         ↓
[KSampler]
    steps: 30
    cfg: 7.5
    sampler_name: dpmpp_2m
    scheduler: karras
         ↓
[VAEDecode]  →  [SaveImage]
```

---

### 📋 Fraktions-LoRA Entwicklungs-Priorität

| Priorität | Fraktion | Trigger | Begründung |
|-----------|---------|---------|-----------|
| 🔴 Hoch | Vor'Tak | `vort_*` | Haupt-NPC Drak'Mol, viele Quests |
| 🔴 Hoch | Syl'Nar | `syln_*` | Haupt-NPC Vela'Thii, Diplomatie-Hub |
| 🔴 Hoch | Aereth | `aere_*` | Haupt-NPC Sol'Kaar, Story-Zentrum |
| 🟡 Mittel | Kryl'Tha | `kryl_*` | Militär-Quests häufig |
| 🟡 Mittel | Zhareen | `zhar_*` | Forschungs-Hub |
| 🟡 Mittel | Vel'Ar | `velar_*` | Spionage-System |
| 🟡 Mittel | Helion | `heli_*` | Handels-NPC, häufig sichtbar |
| 🟢 Niedrig | Eisenflotte | `iron_*` | Antagonisten-Portraits |
| 🟢 Niedrig | Khar'Morr | `kharm_*` | Piratenbegegnungen |
| 🟢 Niedrig | Aethernox | `aeth_n` | Endgame-Charakter |
| 🟢 Niedrig | Omniscienta | `omni_n` | Bedrohungssymbol |
| ⚪ Optional | Nomaden | `noma_*` | FTL-Quest-Kontext |
| ⚪ Optional | Ketzer | `ketz_*` | Forschungs-Quests |
| ⚪ Optional | Architekten | `arch_*` | Stabilitäts-System |
| ⚪ Optional | Myr'Keth | `myrk_*` | Schwarm-Events |
| ⚪ Optional | Brut Ewigkeit | `brut_*` | Endgame-Szenario |
| ⚪ Optional | Echos d. Leere | `echo_n` | Krisen-Events |

---

### 🔍 Negative Prompts (universell für alle Fraktionen)

```
human, too human, earth human, normal human face, mundane, 
boring, realistic human skin only, no alien features, 
nsfw, nude, explicit, watermark, signature, text, 
blurry, low quality, deformed anatomy, extra limbs, 
bad eyes, crossed eyes, asymmetric face badly, 
background elements, props, furniture, plants
```

---

**Status:** Alle 17 Fraktions-Module bereit | LoRA-Guide vollständig  
**Nächste Schritte:** Trainingsdaten sammeln → LoRA trainieren → In SwarmUI testen
