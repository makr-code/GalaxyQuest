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

## 🚫 NEGATIVE PROMPTS

### Universeller Negativ-Prompt (für alle Rassen)
```
deformed face, ugly face, bad anatomy, extra limbs, extra arms, extra hands,
mutated hands, poorly drawn hands, fused fingers, too many fingers, cross-eyed,
blurry, out of focus, oversaturated, underexposed, overexposed, low quality,
jpeg artifacts, noise, grain, watermark, text, logo, signature, cropped,
bad proportions, clipping, duplicate, tiling, human face, human skin,
too human-looking, mundane, ordinary, boring, generic, western fantasy
```

### Erweiterung: Pro Rasse (falls Probleme)
```
Vor'Tak:    mammal, fur, feathers, soft skin, smooth features
Syl'Nar:    scales, hard shell, solid, opaque, land-based
Aereth:     solid body, opaque, no glow, dark, shadowed
Kryl'Tha:  vertebrate, mammalian, soft, fleshy, smooth
Zhareen:    organic, flesh, skin, opaque, soft
Vel'Ar:     solid body, opaque, hard surface, physical
```

---

## 🔗 LORA-INTEGRATION

LoRA-Adapter ermöglichen **konsistente, charaktertreue** Portraits ohne lange Prompts.
Trainiere einmalig pro Rasse — danach reichen wenige Keywords für hohe Qualität.

### Trigger-Words pro Rasse (nach LoRA-Training)

| Rasse | Trigger-Word | Gewicht | Beispiel-Prompt-Ergänzung |
|---|---|---|---|
| Vor'Tak | `vortak_race` | 0.8–1.0 | `<lora:vortak_lora:0.85>` |
| Syl'Nar | `sylnar_race` | 0.7–0.9 | `<lora:sylnar_lora:0.80>` |
| Aereth | `aereth_race` | 0.7–0.9 | `<lora:aereth_lora:0.80>` |
| Kryl'Tha | `kryltha_race` | 0.8–1.0 | `<lora:kryltha_lora:0.85>` |
| Zhareen | `zhareen_race` | 0.7–0.9 | `<lora:zhareen_lora:0.80>` |
| Vel'Ar | `velar_race` | 0.6–0.8 | `<lora:velar_lora:0.75>` |

### LoRA-Prompt-Format (SwarmUI / ComfyUI)
```
<lora:vortak_lora:0.85>, vortak_race, [weitere Rassen-Details],
[Basis-Foto-Prompt], [NPC-spezifische Details]
```

### SwarmUI API — LoRA-Parameter
```php
$result = swarmui_generate($prompt, [
    'loras'   => ['vortak_lora:0.85'],   // LoRA-Dateiname:Gewicht
    'height'  => 1024,
    'width'   => 720,
]);
```

> Vollständiger Trainings-Guide: siehe `LORA_TRAINING_GUIDE.md`

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

### Prompt-Paket 7: T'Asha (Vor'Tak weiblich – Die strategische Diplomatin)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly female, mature female reptilian alien, sleek emerald-green scales with golden bioluminescent highlights, elegant refined facial structure with smaller refined horn ridges, intricate turquoise and gold patterns across skin, piercing intelligent yellow eyes with complex iris patterns radiating authority and cunning, graceful neck and shoulders, subtle high-rank ceremonial armor detailing integrated into scales, refined feminine reptilian beauty. Ultra-detailed scale texture with golden shimmer, realistic diplomatic lighting, studio portrait with warm key light and cool rim light, shallow depth of field f/2.8, sharp focus on calculating eyes, metallic specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 8: Asha'Vor (Syl'Nar männlich – Der lichtdurchwebte Diplomat)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, strong male cephalopod alien, powerful tentacle ridges and broad cephalopod musculature, deep pulsating bioluminescent patterns in neon cyan and electric violet across skin, wet glossy semi-transparent skin with inner light, deep-set commanding alien eyes with spiraling cosmic swirls of deep indigo, thick flowing tentacle-hair trailing back, presence of spiritual authority and diplomatic gravitas, luminous ripples of inner glow beneath translucent skin. Ultra-detailed bioluminescent skin texture, dramatic studio lighting with luminescent rim light, shallow depth of field f/2.8, sharp focus on commanding cosmic eyes, spectral specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 9: Lyra'Tehn (Aereth weiblich – Die inspirierende Forscherin)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly female, elegant female humanoid energy-based alien, smooth graceful facial contours with luminous golden-white energy patterns flowing beneath semi-transparent skin, warm gentle amber and gold energy coloration radiating curiosity and brilliance, soft diffused internal light creating a halo-like radiance, flowing curves of light alongside subtle geometric structures, large expressive glowing eyes filled with wonder and intelligence, serene confident expression of scientific discovery, delicate energy tendrils brushing along jawline. Ultra-detailed translucent energy-skin texture with warm internal luminescence, soft studio portrait lighting with warm backlighting, shallow depth of field f/2.8, sharp focus on luminous expressive eyes, warm specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 10: Ka'Threx (Kryl'Tha männlich – Der uralte Schwarmälteste)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, ancient weathered male insectoid alien, thick battle-worn chitin armor plates across powerful face and broad shoulders, dark iridescent shell with deep oil-slick reflections in black-green-rust tones, heavy massive mandibles and pronounced jaw structure showing age and dominance, large compound eyes with thousands of amber-red facets glowing with ancient wisdom, segmented facial structures bearing old battle scars and ceremonial clan markings etched into chitin, imposing intimidating elder presence. Ultra-detailed aged chitin texture with iridescent depth and surface damage, harsh dramatic lighting, studio portrait with sharp shadows and deep contrast, shallow depth of field, sharp focus on ancient compound eyes with inner amber glow, metallic chitin specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 11: Myr'Tal (Zhareen weiblich – Die einfühlsame Kristallbewahrerin)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly female, serene female crystalline alien, smooth flowing crystal contours with warm rosy-gold and deep amethyst internal illumination, soft prismatic rainbow light refracting gracefully across translucent crystal surfaces, gentle organic-geometric crystal structures blending curves with faceted planes, perlmut iridescence cascading across crystal skin, warm welcoming radiance emanating from within, large compassionate eyes glowing with amber-rose light and profound empathy, refined crystal beauty with ancient spiritual depth. Ultra-detailed crystal texture with warm internal illumination and soft prismatic highlights, warm contemplative studio lighting, shallow depth of field f/2.8, sharp focus on luminous empathetic eyes, iridescent prismatic specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

### Prompt-Paket 12: Val'Kesh (Vel'Ar männlich – Der undurchdringliche Geheimrat)

```
Photorealistic portrait photo of an alien lifeform, head and shoulders bust portrait, clearly alien, clearly male, imposing male gas-based alien with angular sharp semi-solid biomask, strong pointed geometric mask contours and hard edges projecting authority and inscrutability, internal swirling gas patterns in deep smoke-grey and cold ice-blue hues, pulsing energy veins of pale blue light etched through semi-solid form, suspended alien eyes radiating cold calculation and hidden power, sharp mask features with hard angular edges suggesting concealed threat, ethereal gravitas of a figure who has never been truly understood. Ultra-detailed gas-form texture with cold luminous energy patterns and stark angular mask structure, cold dramatic studio lighting with ice-blue rim light, shallow depth of field, sharp focus on cold calculating suspended eyes, stark icy specular highlights. No props, no background, transparent PNG alpha, cinematic realism.
```

---

## 🛠️ BATCH-GENERIERUNG (für alle 6 Rassen × 2 Geschlechter)

Falls du alle 12 Prompts auf einmal generieren möchtest:

| # | Rasse | Geschlecht | NPC-Name | Prompt-Paket |
|---|-------|-----------|-----------|------------|
| 1 | Vor'Tak | m | General Drak'Mol | Paket 3 |
| 2 | Vor'Tak | w | Stratega T'Asha | Paket 7 |
| 3 | Syl'Nar | m | Licht-Diplomat Asha'Vor | Paket 8 |
| 4 | Syl'Nar | w | Hohepriesterin Vela'Thii | Paket 2 |
| 5 | Aereth | m | Sol'Kaar | Paket 1 |
| 6 | Aereth | w | Forscherin Lyra'Tehn | Paket 9 |
| 7 | Kryl'Tha | w | Kommandantin Zha'Mira | Paket 6 |
| 8 | Kryl'Tha | m | Schwarm-Ältester Ka'Threx | Paket 10 |
| 9 | Zhareen | m | Archivar Kaelor | Paket 5 |
| 10 | Zhareen | w | Kristall-Bewahrerin Myr'Tal | Paket 11 |
| 11 | Vel'Ar | w | Schattenagentin Shy'Nira | Paket 4 |
| 12 | Vel'Ar | m | Geheimrat Val'Kesh | Paket 12 |

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

**Status:** Ready for Art-Generation | Alle 12 Prompts vollständig | Copy-Paste-Ready | LoRA-Training: siehe `LORA_TRAINING_GUIDE.md`

---

## 🌌 SZENEN-PROMPTS (Erweiterung: NPCs in Kontext)

Für NPC-Dialogbilder, Story-Cutscenes oder Social-Cards.
Basis: Bestehender NPC-Prompt + Szenen-Modul ersetzen den neutralen Hintergrund.

### Modul: Kommandoraum (Militär)
```
[NPC-Prompt ohne "no background, transparent PNG alpha"],
dramatic cinematic command bridge background, advanced alien holographic displays
glowing blue, star map projections, tense tactical atmosphere, deep space visible
through panoramic viewport, volumetric light from screens, epic scale, cinematic.
```

### Modul: Diplomatischer Empfangssaal
```
[NPC-Prompt ohne "no background, transparent PNG alpha"],
grand alien diplomatic hall, towering crystalline architecture, ambient ceremonial lighting,
alien delegates visible in soft background bokeh, formal reception atmosphere,
golden light from alien chandeliers, majestic scale, cinematic depth.
```

### Modul: Forschungslabor
```
[NPC-Prompt ohne "no background, transparent PNG alpha"],
advanced alien research laboratory, glowing specimen containers, holographic data streams,
scientific instruments and alien devices, cool blue-white lab lighting,
focus on NPC in foreground, bokeh background detail, discovery atmosphere.
```

### Modul: Raumschiff-Brücke (persönlich)
```
[NPC-Prompt ohne "no background, transparent PNG alpha"],
intimate personal starship bridge, alien pilot seat and controls,
deep space nebula visible through wide cockpit viewport, warm amber
instrument lights, personal space with alien memorabilia, focused character moment.
```

---

## 🔄 VARIATIONEN & ITERATIONS-STRATEGIE

### Für Charakter-Konsistenz über mehrere Generierungen:

1. **Seed fixieren:** Einen guten Seed speichern und für Variationen nutzen
   ```
   Seed: [gespeicherter Seed]
   Denoise: 0.4–0.6 (statt 1.0) → subtile Variationen bei gleichem Charakter
   ```

2. **Img2Img für Anpassungen:**
   ```
   Ausgangsbild → Img2Img → Denoise: 0.3 → 
   "Add combat scars" oder "Change lighting to night"
   ```

3. **LoRA für maximale Konsistenz:**
   - Einmalig 15–20 Basis-Portraits pro NPC generieren
   - LoRA auf diese trainieren (→ `LORA_TRAINING_GUIDE.md`)
   - Ab dann: 3-4 Keywords genügen für perfekt konsistente Portraits

