# Copilot Instructions — GalaxyQuest

Diese Datei gilt für alle Python-Komponenten in GalaxyQuest.
Sie folgt dem Standard aus `makr-code/RespoTemplate-Python`.

---

## Python-Coding-Standards (3.11+)

- **Typing**: Alle öffentlichen Funktionen erhalten vollständige Type Hints.
  Verwende `type | None` (Python 3.10+ Union-Syntax), nicht `Optional[type]`.
- **Async**: Alle I/O-Operationen (HTTP, Dateisystem, Subprozesse) über
  `async/await`. Blocking-Operationen immer via `run_in_threadpool` ausführen.
- **HTTP-Client**: `httpx` mit explizitem Timeout. Kein `urllib.request`.
- **Validation**: `pydantic.BaseModel` an API-Grenzen; `dataclass` für interne Strukturen.
- **Config**: `pydantic-settings` mit `.env`-Fallback. Kein `os.getenv()` im App-Code.
- **Logging**: `structlog` mit strukturierten Key-Value-Events. Kein `print()`, kein `logging.basicConfig`.
- **Ressourcen**: `with` / `async with` für alle I/O-Ressourcen.
- **Fehlerbehandlung**: Spezifische Exception-Typen; kein nacktes `except Exception`.
- **Globaler Zustand**: Mutable globals nur mit `asyncio.Lock` absichern.

## Toolchain

| Tool | Befehl | Zweck |
|------|--------|-------|
| Lint | `ruff check tts_service/ scripts/` | Muss sauber laufen |
| Format | `ruff format --check tts_service/ scripts/` | Muss sauber laufen |
| Typen | `mypy tts_service/main.py` | Keine neuen Fehler |
| Security | CodeQL Python (`.github/workflows/codeql-python.yml`) | Keine High/Critical-Findings |

## Python-Komponenten in diesem Repo

| Verzeichnis | Beschreibung |
|-------------|-------------|
| `tts_service/` | FastAPI TTS Microservice (Piper / Coqui XTTS) |
| `scripts/trellis2_*.py` | CLI-Tools für 3D-Asset-Generierung (TRELLIS2) |
| `scripts/prepend_trigger.py` | LoRA Dataset Helper |

## Dockerfile-Standards (nach RespoTemplate-Python)

- Multi-stage Build (builder + runtime)
- Non-root User (`useradd` + `USER`)
- `PYTHONUNBUFFERED=1` + `PYTHONDONTWRITEBYTECODE=1`
- `HEALTHCHECK` mit `curl -f /health`
- `curl` im Runtime-Image für den Health Probe

## Architekturprinzipien

- Dependency Injection statt globaler Singletons.
- YAGNI – keine Abstraktionen ohne konkreten Nutzen.
- Kleine, fokussierte Funktionen mit klaren Ein- und Ausgaben.
- `Protocol` für Interfaces – Domänenlogik frei von Infrastruktur-Imports.
