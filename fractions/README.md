# Fraktions-Spezifikationen – Lokale Design Authority

Die `fractions/` Verzeichnisstruktur enthält **zentrale, versionskontrollierbare Definitionen** für alle 6 Spezies der Kalytherion-Konvergenz.

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
