# Ollama LLM + Wikipedia RAG Setup

Das Glossar enthält statische Definitionen und einen optionalen AI-Generierungspfad mit Ollama und Wikipedia-Kontext. Die AI-Generierung setzt erreichbare Dienste voraus; bei Fehlern bleiben die statischen Definitionen im Frontend verfügbar.

## Quick Start

### 1. Ollama Installation & Setup

```bash
# Install Ollama (von https://ollama.ai)
ollama pull mistral      # oder: ollama pull neural-chat, llama2

# Start Ollama Server (läuft auf http://localhost:11434)
ollama serve
```

### 2. Umgebungsvariablen (optional)

In `.env` oder Systemumgebung setzen:

```bash
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral
```

Falls nicht gesetzt, werden Defaults verwendet.

### 3. Datenbank erweitern

Die `glossary_cache` Tabelle wird durch die Migration
`migrate_glossary_cache_v1.sql` angelegt. Die RAG-Generierung verwendet:

```php
POST /api/glossary.php?action=generate
X-CSRF-Token: <token>
Content-Type: application/json

{"term":"white_dwarf"}
```

## RAG Pipeline

```
Term Query
    ↓
[DB Cache Check] → Nur 5d gültig
    ↓
[Wikipedia API] → Contextual excerpt abrufen
    ↓
[Ollama LLM] → Definition mit Context generieren
    ↓
[Cache] → 5-Tage Speicherung
    ↓
UI: Toggle zwischen Static/AI Definition
```

## Endpoints

### `POST /api/glossary.php?action=generate`

Body: `{"term":"<term_key>"}`. Requires a valid CSRF token. Glossary
definitions are read-only on GET; generation and cache writes use POST.

Generiert eine LLM-Definitionen mit Wikipedia RAG.

**Response:**
```json
{
  "term": "White Dwarf",
  "term_key": "white_dwarf",
  "category": "Stellar Type",
  "short": "...",
  "full": "...",
  "wikipedia_url": "https://...",
  "source": "ollama_rag",
  "generated_at": "2026-03-28T...",
  "tokens_used": 142
}
```

### Fallbacks

- Wenn Ollama oder Wikipedia nicht verfügbar ist, antwortet der Generate-Endpoint mit einem Fehler; er erzeugt keine Definition ohne Wikipedia-Kontext.
- Das Frontend behält die statische Definition bei und zeigt einen Fehlerhinweis, wenn die AI-Generierung fehlschlägt.

## Unterstützte Modelle

- **mistral** ⭐ Empfohlen (schnell, 8B)
- `neural-chat` (spezialisiert auf Q&A)
- `llama2` (13B, qualitativ hochwertig)
- `phi` (small, schnell)

```bash
# Alternative Modelle testen:
curl -X POST http://localhost/api/glossary.php?action=generate \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <token>' \
  -d '{"term":"habitable_zone"}'
```

## Performance

- **Erstmaliger Aufruf**: ~3–8 Sekunden (LLM Inference)
- **Cache Hit**: ~50ms
- **Cache TTL**: 5 Tage
- **Parallel Requests**: GalaxyQuest stellt keine eigene Queue bereit; die Parallelität hängt von der Ollama-Serverkonfiguration ab. Die Laufzeitangaben sind Richtwerte, keine gemessenen Garantien.

## Troubleshooting

### "Connection refused"
```bash
# Ollama läuft nicht auf :11434
ollama serve
```

### "Timeout"
Der aktuelle Ollama-HTTP-Aufruf in `api/glossary.php` hat ein Timeout von 30 Sekunden. Nur bei begründetem Bedarf den HTTP-Timeout dort anpassen; ein Fehler lässt die statische Definition im Frontend bestehen.

### "Invalid JSON from Ollama"
- Andere Modelle testen: `OLLAMA_MODEL=neural-chat`
- Prompt in glossary.php anpassen (line ~120)

### Wikipedia API SSL Error
TLS-Prüfung nicht deaktivieren. Stattdessen System-CA-Zertifikate, DNS, Uhrzeit und ausgehende HTTPS-Verbindung prüfen. Der aktuelle Request nutzt die standardmäßige Zertifikatsprüfung und ein 5-Sekunden-Timeout.

## Frontend UI

### Glossary Modal
- 🟣 Statische Definition + "AI Enhanced" Button
- Klick → Lädt LLM-Version & togglet Anzeige
- Loading-Spinner während Generierung
- Badge "with AI" im Header

### Toggle-Feature
```js
// Nutzer kann anklicken zum Umschalten
Static ↔️ AI-Enhanced Definition
```

## Datenbank Schema

```sql
CREATE TABLE glossary_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    term_key VARCHAR(30) UNIQUE NOT NULL,
    definition_json LONGTEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_termkey (term_key),
    INDEX idx_generated (generated_at)
) ENGINE=InnoDB;

-- Max Cache Size: ~5MB für 1000 Einträge á 5KB
-- Auto-Cleanup: DELETE WHERE generated_at < DATE_SUB(NOW(), INTERVAL 5 DAY)
```

## Wissenschaftliche Referenzen

Jede Definition enthält Links zu:
- 📖 **Wikipedia** – Kontextueller Überblick
- 📄 **ArXiv Papers** – Tiefgreifende Forschung
- 🤖 **LLM-Synthese** – Interdisziplinäre Erklärung

## Fragen?

Siehe: [ARCHITECTURE.md](ARCHITECTURE.md#educational-ui)

---

**Last Updated:** 13. November 2026

**Status:** API- und UI-Vertrag gegen die aktuelle Implementierung geprüft; keine Garantie für erreichbare Ollama-/Wikipedia-Dienste oder Performancewerte.
