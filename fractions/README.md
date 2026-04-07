# Fraktions-Spezifikationen – Lokale Design Authority

Die `fractions/` Verzeichnisstruktur enthält **zentrale, versionskontrollierbare Definitionen** für alle Spezies und Fraktionen der Kalytherion-Konvergenz sowie deren Nebenfraktionen.

## Struktur

```
fractions/
├── vor_tak/
│   ├── spec.json
│   └── spec.yaml
├── syl_nar/
│   ├── spec.json
│   └── spec.yaml
├── aereth/
│   ├── spec.json
│   └── spec.yaml
├── kryl_tha/
│   ├── spec.json
│   └── spec.yaml
├── zhareen/
│   ├── spec.json
│   └── spec.yaml
├── vel_ar/
│   ├── spec.json
│   └── spec.yaml
└── iron_fleet/               ← Nebenfraktion (NPC-only)
    ├── spec.json
    ├── spec.yaml
    └── mini_factions/
        ├── parade/spec.yaml  ← Parade-Regiment
        ├── pr/spec.yaml      ← Propaganda-Einheit
        ├── tech/spec.yaml    ← Techniker-Gilde
        ├── clan/spec.yaml    ← Clan-Krieger
        ├── archive/spec.yaml ← Archiv-Division
        └── shadow/spec.yaml  ← Schatten-Agenten
```

## Fraktions-Typen

### Hauptfraktionen (Kalytherion-Konvergenz)

Vollständig spielbare Spezies mit `spec.json` + `spec.yaml`, biology/portraiture-Blöcken und vollständiger DB-Integration via `scripts/sync_faction_specs.php`.

### Nebenfraktionen (`faction_tier: "side"`)

NPC-only, nicht spielbar. Erkennbar am `meta`-Block:

```yaml
meta:
  faction_tier: "side"
  faction_tier_label_de: "Nebenfraktion"
  playable: false
  npc_only: true
  canon_note: "Kurze Lore-Notiz zur Einordnung."
```

Nebenfraktionen können **Mini-Fraktionen** unter `mini_factions/<code>/spec.yaml` haben –
thematische Untereinheiten mit eigenem NPC, Stimme (`llm_voice`) und Zitaten (`llm_quotes`).

#### Verfügbare Nebenfraktionen

| Faction-Code  | Anzeigename    | Tier   | Mini-Fraktionen                                          |
|---------------|----------------|--------|----------------------------------------------------------|
| `iron_fleet`  | Eisenflotte    | side   | parade, pr, tech, clan, archive, shadow                  |

## Spezifikations-Format

### Basis-Informationen
- `faction_code` / `species_code`: eindeutiger Code (z.B. `vor_tak`, `iron_fleet`)
- `display_name`: Anzeigename
- `faction_type`: Gesellschafts-Typ (military, spiritual, scientific, archival, espionage, human_military, …)
- `homeworld`: Heimatplanet als String **oder** strukturiertes Objekt (bei Nebenfraktionen)

### Heimatwelt-Block (strukturiert, Nebenfraktionen)

```yaml
homeworld:
  system: "Sonnensystem"
  primary: "Erde"
  planets_de: ["Merkur", "Venus", "Erde", "Mars", "Jupiter", "Saturn", "Uranus", "Neptun"]
```

### Design-Spezifikationen (Portraiture)

#### Farbpaletten (gender-spezifisch)
```json
"biology": {
  "male": {
    "color_primary": "#1a4d2e",
    "color_secondary": "#0d0d0d",
    "color_accent": "#8b6914"
  },
  "female": {
    "color_primary": "#27ae60",
    "color_secondary": "#00ffff",
    "color_accent": "#ffd700"
  }
}
```

#### Portrait-Prompts (für SwarmUI/Ollama)
```json
"portraiture": {
  "base_prompt": "...",
  "male_modifier": "...",
  "female_modifier": "...",
  "material_description": "...",
  "silhouette_description": "..."
}
```

#### Logo/Icon Spezifikation (für Fraktions-Embleme)
```json
"logo": {
  "prompt": "...",
  "description": "..."
}
```

### LLM-Stimme und Zitate

Für alle Fraktionen (Haupt- und Nebenfraktionen) optional, aber empfohlen:

```yaml
llm_voice:
  tone: "Kurze Beschreibung des Gesprächstons"
  speech_style: "Redestil"
  typical_greeting: "Typische Begrüßungsphrase"

llm_quotes:
  - "Zitat 1"
  - "Zitat 2"
```

Diese Felder werden von `IronFleetPromptVarsComposer` (und zukünftigen Composer-Klassen)
dynamisch in LLM-Prompt-Variablen übersetzt.

## Integration in die Character-Generierung

### Ladepriorität

1. **Lokale Dateien** (`fractions/<code>/spec.json`) – primäre Quelle
2. **Datenbank** (`npc_factions` Tabelle) – Fallback
3. **Hardcodiert** – Letzte Notfallrückfallsklausel

### Verwendung in Code

```php
// Lädt Spezifikationen von lokalen Dateien (mit DB-Fallback)
$designs = character_profile_load_species_designs($db, 'vor_tak');

// Generiert Portrait-Prompts mit Faction-Specs
$prompt = character_profile_build_prompt_with_designs($designs, [
    'username' => $username,
    'race' => $race,
    'profession' => $profession,
    'stance' => $stance,
    'is_npc' => $isNpc
]);
```

### LLM-Prompt-Variablen (Nebenfraktionen)

```php
// Erstellt flaches vars-Array aus Base-Spec + Mini-Fraktion
$composer = new IronFleetPromptVarsComposer();
$vars = $composer->compose('shadow', [
    'situation' => 'Verhör',
    'emotion'   => 'kalt',
]);
// Weiterleitung an LlmPromptService::compose()
$result = $promptService->compose($db, 'iron_fleet_npc_dialogue', $vars);
```

## Beispiel: Vor'Tak Spezifikation

**Farbpalette:**
- Männlich: Dunkelgrün `#1a4d2e`, Schwarz `#0d0d0d`, Bronze `#8b6914`
- Weiblich: Smaragd `#27ae60`, Türkis `#00ffff`, Gold `#ffd700`

**Portrait-Modifizierer:**
- Männlich: "Male reptilian alien, massive bone plates, dark green-black scales..."
- Weiblich: "Female reptilian alien, sleek emerald scales, golden highlights..."

**Material:** "Scaly reptilian skin with exposed bone plates, bronze undertones in armor plating"

**Silhouette:** "Broad-shouldered, angular jaw, prominent brow ridge, fierce predatory expression"

## Konsistenz durch Design Authority

Durch die lokale Verwaltung von Fraktions-Spezifikationen wird sichergestellt, dass:

✓ Alle Charaktere derselben Fraktion visuell kohärent wirken  
✓ Die Spezifikationen versionskontrollierbar sind  
✓ Neue Fraktionen einfach hinzugefügt werden können  
✓ Prompts konsistent auf den Design-Spezifikationen basieren  
✓ AI-generierte Inhalte (Portraits, Logos) mit den Designrichtlinien übereinstimmen  
✓ Nebenfraktionen (NPC-only) klar vom spielbaren Kern getrennt sind  

## Wartung

Spezifikationen aktualisieren:

1. YAML-Datei bearbeiten: `fractions/<code>/spec.yaml`
2. JSON-Äquivalent synchronisieren: `fractions/<code>/spec.json`
3. Optional: DB aktualisieren (wird automatisch beim nächsten Seeding aktualisiert)

```bash
# Um alle Spezifikationen (neu) in die DB zu laden:
docker compose exec -T web php scripts/sync_faction_specs.php
```

Neue Nebenfraktion hinzufügen:

1. Verzeichnis anlegen: `fractions/<code>/`
2. `spec.yaml` mit `meta.faction_tier: "side"` und `meta.npc_only: true` erstellen
3. `spec.json` als äquivalentes JSON erstellen
4. Optional: Mini-Fraktionen unter `fractions/<code>/mini_factions/<mini_code>/spec.yaml`
5. LLM-Profile in `config/llm_profiles.yaml` und `config/llm_profiles.json` ergänzen


## Struktur

```
fractions/
├── vor_tak/
│   ├── spec.json
│   └── spec.yaml
├── syl_nar/
│   ├── spec.json
│   └── spec.yaml
├── aereth/
│   ├── spec.json
│   └── spec.yaml
├── kryl_tha/
│   ├── spec.json
│   └── spec.yaml
├── zhareen/
│   ├── spec.json
│   └── spec.yaml
└── vel_ar/
    ├── spec.json
    └── spec.yaml
```

## Spezifikations-Format

Jede Spezies hat ein `spec.json` und äquivalentes `spec.yaml` mit:

### Basis-Informationen
- `species_code`: eindeutiger Code (z.B. `vor_tak`)
- `display_name`: Anzeigename (z.B. `Vor'Tak`)
- `species_type`: Biologie-Klassifikation
- `homeworld`: Heimatplanet
- `faction_type`: Gesellschafts-Typ (military, spiritual, scientific, archival, espionage)

### Design-Spezifikationen (Portraiture)

#### Farbpaletten (gender-spezifisch)
```json
"biology": {
  "male": {
    "color_primary": "#1a4d2e",      // Dominante Farbe für männliche Individuen
    "color_secondary": "#0d0d0d",
    "color_accent": "#8b6914"
  },
  "female": {
    "color_primary": "#27ae60",      // Dominante Farbe für weibliche Individuen
    "color_secondary": "#00ffff",
    "color_accent": "#ffd700"
  }
}
```

#### Portrait-Prompts (für SwarmUI/Ollama)
```json
"portraiture": {
  "base_prompt": "...",              // Basis-Template für alle Charaktere
  "male_modifier": "...",            // Zusatz für männliche Charaktere
  "female_modifier": "...",          // Zusatz für weibliche Charaktere
  "material_description": "...",     // Material/Textur-Hinweise
  "silhouette_description": "..."    // Silhouette/Form-Hinweise
}
```

#### Logo/Icon Spezifikation (für Fraktions-Embleme)
```json
"logo": {
  "prompt": "...",                   // Generierungs-Prompt für Fraktions-Logo
  "description": "..."               // Kurzbeschreibung des Logos
}
```

## Integration in die Character-Generierung

### Ladepriorität

1. **Lokale Dateien** (`fractions/<species_code>/spec.json`) – primäre Quelle
2. **Datenbank** (`faction_species` Tabelle) – Fallback
3. **Hardcodiert** – Letzte Notfallrückfallsklausel

### Verwendung in Code

```php
// Lädt Spezifikationen von lokalen Dateien (mit DB-Fallback)
$designs = character_profile_load_species_designs($db, 'vor_tak');

// Generiert Portrait-Prompts mit Faction-Specs
$prompt = character_profile_build_prompt_with_designs($designs, [
    'username' => $username,
    'race' => $race,
    'profession' => $profession,
    'stance' => $stance,
    'is_npc' => $isNpc
]);
```

## Beispiel: Vor'Tak Spezifikation

**Farbpalette:**
- Männlich: Dunkelgrün `#1a4d2e`, Schwarz `#0d0d0d`, Bronze `#8b6914`
- Weiblich: Smaragd `#27ae60`, Türkis `#00ffff`, Gold `#ffd700`

**Portrait-Modifizierer:**
- Männlich: "Male reptilian alien, massive bone plates, dark green-black scales..."
- Weiblich: "Female reptilian alien, sleek emerald scales, golden highlights..."

**Material:** "Scaly reptilian skin with exposed bone plates, bronze undertones in armor plating"

**Silhouette:** "Broad-shouldered, angular jaw, prominent brow ridge, fierce predatory expression"

## Konsistenz durch Design Authority

Durch die lokale Verwaltung von Fraktions-Spezifikationen wird sichergestellt, dass:

✓ Alle Charaktere derselben Fraktion visuell kohärent wirken  
✓ Die Spezifikationen versionskontrollierbar sind  
✓ Neue Fraktionen einfach hinzugefügt werden können  
✓ Prompts konsistent auf den Design-Spezifikationen basieren  
✓ AI-generierte Inhalte (Portraits, Logos) mit den Designrichtlinien übereinstimmen  

## Wartung

Spezifikationen aktualisieren:

1. Datei bearbeiten: `fractions/<species_code>/spec.json`
2. YAML-Äquivalent synchronisieren: `fractions/<species_code>/spec.yaml`
3. Optional: DB aktualisieren (wird automatisch beim nächsten Seeding aktualisiert)

```bash
# Um alle Spezifikationen (neu) in die DB zu laden:
docker compose exec -T web php scripts/seed_faction_species.php
```
