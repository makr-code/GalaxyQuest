# Ollama LLM + Wikipedia RAG Setup

Das GalaxyQuest Glossar nutzt jetzt **Ollama LLM mit Wikipedia RAG** für wissenschaftliche Definitionen.

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

Die `glossary_cache` Tabelle wird beim ersten Zugriff automatisch erstellt:

```php
GET /api/glossary.php?action=generate&term=white_dwarf
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

### `GET /api/glossary.php?action=generate&term=<term_key>`

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

- Wenn Ollama nicht verfügbar: Nutzt statische Definitionen
- Wenn Wikipedia nicht erreichbar: Nutzt Ollama ohne Context (schwächer)
- Wenn LLM timeout: Zeigt statische Definition + Warnung

## Unterstützte Modelle

- **mistral** ⭐ Empfohlen (schnell, 8B)
- `neural-chat` (spezialisiert auf Q&A)
- `llama2` (13B, qualitativ hochwertig)
- `phi` (small, schnell)

```bash
# Alternative Modelle testen:
OLLAMA_MODEL=neural-chat php api/glossary.php?action=generate&term=habitable_zone
```

## Performance

- **Erstmaliger Aufruf**: ~3–8 Sekunden (LLM Inference)
- **Cache Hit**: ~50ms
- **Cache TTL**: 5 Tage
- **Parallel Requests**: OK (Queue-basiert in Ollama)

## Troubleshooting

### "Connection refused"
```bash
# Ollama läuft nicht auf :11434
ollama serve
```

### "Timeout"
```php
// In glossary.php: timeout auf 60s erhöhen
'timeout' => 60
```

### "Invalid JSON from Ollama"
- Andere Modelle testen: `OLLAMA_MODEL=neural-chat`
- Prompt in glossary.php anpassen (line ~120)

### Wikipedia API SSL Error
```php
// In fetch_wikipedia_context(): SSL-Verifizierung deaktivieren
$ctx = stream_context_create([
    'ssl' => ['verify_peer' => false],
    'http' => ['timeout' => 5]
]);
```

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

**Last Updated:** 28. März 2026  
**Status:** ✅ Phase E.1 Complete + RAG Integration
