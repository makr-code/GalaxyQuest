# GalaxyQuest — Production-Readiness-Audit

**Stand:** 31. Oktober 2026
**Basis:** Branch `develop`, HEAD `c9fd1e8`. Die Arbeitskopie enthielt 15 geänderte und 5 ungetrackte Dateien, vor allem im Rendering- und Registrierungs-Prolog.
**Umfang:** gesamter Quellcode (PHP-Backend, SQL, JavaScript-Frontend, Python/KI-Dienste, Infrastruktur/CI) und Dokumentation
**Ergebnis:** **Nicht produktionsreif.** Umsetzungsplan: [ROADMAP.md](../../ROADMAP.md)

> Dieser Bericht ergänzt den [Reality Check vom 29.10.2026](REALITY_CHECK_2026-10-29.md).
> Der Reality Check beschreibt, was implementiert ist. Dieser Audit bewertet, was für einen öffentlichen Betrieb fehlt.
> Befunde mit Datei-/Zeilenangabe wurden im Quellcode geprüft. Die Einstufung erfolgt nach Auswirkung im öffentlichen Betrieb.

---

## 1. Methode und Grenzen

| Prüfung | Werkzeug | Ergebnis |
|---|---|---|
| JS-Unit-Tests | `npx vitest run` | **3411/3412 bestanden** (129 Dateien). Ein Fehlschlag in `tests/js/runtime-module-wiring-audit.test.js:56` stammt aus der nicht eingecheckten `index.html`-Änderung (`window.__GQ_AUTH_FORCE_WEBGL`). |
| Produktionsbuild | `npx vite build` | Erfolgreich (1,7 s). Der Chunk `core` umfasst **2,6 MB unminifiziert** (534 KB gzip), `vendor-three` 1,7 MB. Zusätzlich entstehen **8,7 MB Source-Maps** im Auslieferungsartefakt. |
| npm-Abhängigkeiten | `npm audit` | **5 high, 2 moderate** (u. a. `vite` direkt, `ws`, `nanoid`, `form-data`, `source-map-js`). |
| Python-Lint | `ruff check` / `ruff format --check` | **371 Befunde** (303 × W293 Whitespace, 21 × UP006, 15 × F541, 8 × F401 …); 9 Dateien nicht formatiert. |
| CI-Status | `gh run list` + YAML-Parser | Alle `ci.yml`-Läufe seit mindestens 21.10. sind **fehlgeschlagen und enthalten 0 Jobs**. Ursache: ungültiges YAML (siehe CI-01). |
| PHPUnit / E2E | – | **Nicht ausführbar**: Lokal fehlt PHP, der Docker-Daemon war nicht gestartet, und CI ist defekt. Die eingecheckte `.phpunit.result.cache` enthält 29 Defekte aus einem früheren Lauf. |
| Statische Analyse | Code-Review (6 parallele Bereichsprüfungen + manuelle Verifikation) | Siehe Befunde unten. |

**Kennzahlen:** 88 150 Zeilen PHP · 159 073 Zeilen JavaScript in 629 Dateien (ohne Vendor) · 4 855 Zeilen Python · 92 SQL-Dateien · 223 Markdown-Dateien · 641 Commits seit 27.03.2026, davon 367 (57 %) von `copilot-swe-agent` · 99 Remote-Branches · keine Git-Tags.

---

## 2. Gesamtbewertung (Scorecard)

Skala: 1 = kritische Lücken · 2 = deutliche Lücken · 3 = solide Basis mit Nacharbeit · 4 = weitgehend bereit · 5 = produktionsreif

| Dimension | Bewertung | Kernaussage |
|---|:---:|---|
| Sicherheit | **1** | Unauthentifizierte Admin-, Debug- und KI-Endpunkte; JWT ohne Signaturprüfung; Default-Credentials |
| Backend-Architektur | 2 | 131 Endpunktdateien mit `?action`-Switch (bis 121 KB); Bibliotheken im Webroot |
| Spielintegrität (Transaktionen/Ticks) | 2 | Double-Spend möglich; globaler Tick ohne Lock; Tick-on-Read |
| Datenbank & Migrationen | 2 | Vier verschiedene Migrationspfade; 27 von 92 SQL-Dateien fehlen im Manifest |
| Frontend-Architektur | 3 | Modularer ES-Modul-Boot und starke Testbasis, aber drei Renderer-Familien und 648 `window.*`-Globals |
| Frontend-Performance/Build | 2 | Unminifizierter Produktionsbuild mit öffentlichen Source-Maps; 112-MB-GLB im Repository |
| Tests | 3 | JavaScript stark (3 412 Tests); PHP-Status unbekannt; E2E nur mit Mocks |
| CI/CD & Release | **1** | Hauptpipeline läuft nicht; Trigger nur auf `main`; kein Release-Prozess |
| Deployment & Infrastruktur | **1** | Nur Dev-Image (Xdebug); keine Produktionskonfiguration, kein TLS; offene Ports |
| Observability & Betrieb | **1** | Monitoring-Konfiguration nicht funktionsfähig; kein Backup/Restore; kein Error-Tracking |
| Repository-Hygiene | **1** | Session-Cookies, Logs und tausende generierte Artefakte eingecheckt |
| Dokumentation | 2 | Umfangreich, aber widersprüchlich: Statusangaben von 60 % bis „COMPLETE“ |
| Gameplay-/Launch-Vollständigkeit | **1** | Registrierung liefert HTTP 503; kein Mailversand, kein Tutorial; Core Loop nicht E2E verifiziert |
| Legal & Compliance | **1** | Kein Impressum, keine Datenschutzerklärung, keine AGB; kein DSGVO-Self-Service; Asset-Lizenzen ungeklärt |
| KI-Dienste | 2 | Grundlagen vorhanden (Pydantic, HMAC-Worker, non-root TTS), aber TTS ist offen erreichbar und ohne Limits |

---

## 3. Release-Blocker (Kurzliste)

| # | Blocker | Befund |
|---|---|---|
| 1 | Unauthentifizierte Admin-/KI-/Debug-Endpunkte | SEC-01, SEC-03 |
| 2 | Forgebare JWT-Authentifizierung inkl. Admin-Pfad | SEC-02 |
| 3 | CI läuft nicht (ungültiges YAML, falsche Branches) | CI-01 |
| 4 | Double-Spend und doppelte Tick-Ausführung | BE-01, BE-02 |
| 5 | Kein reproduzierbarer Migrationspfad | DB-01, DB-02 |
| 6 | Keine Produktions-Deployment-Konfiguration, kein TLS, offene Dienste | INF-01 … INF-04 |
| 7 | Kein Backup/Restore | DB-06 |
| 8 | Neue Spieler können sich nicht registrieren; kein Mailversand | GAME-01, BE-08 |
| 9 | Core Loop nicht Ende-zu-Ende nachgewiesen | GAME-02 |
| 10 | Rechtliche Pflichtangaben und DSGVO-Funktionen fehlen | LEGAL-01, LEGAL-02 |
| 11 | Eingecheckte Session-Cookies und Credentials | REPO-01, SEC-08 |

---

## 4. Befunde nach Bereich

Schweregrade: 🔴 Kritisch · 🟠 Hoch · 🟡 Mittel · ⚪ Niedrig

### 4.1 Sicherheit (SEC)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| SEC-01 | 🔴 | [api/textures-admin.php](../../api/textures-admin.php) (Z. 15–16), [api/textures-ai.php](../../api/textures-ai.php) (keine Auth-Prüfung in der gesamten Datei), [api/generation_queue_v3.php](../../api/generation_queue_v3.php) (Z. 45), [api/generation_queue_monitor.php](../../api/generation_queue_monitor.php), [api/traders_dashboard.php](../../api/traders_dashboard.php) | Admin-Texturverwaltung mit `// TODO: Add admin authentication check here`; KI-Texturgenerierung ohne Auth; die Generation-Queue übernimmt `user_id` aus dem Body (`?? 1 // Default to user 1 for testing`). Monitor und Dashboard sind ohne Auth erreichbar. Folgen: GPU-Kosten-/DoS-Angriffe, Datenmanipulation, Informationsabfluss. | Sofort Auth/Admin-Guard ergänzen oder Endpunkte entfernen. Zentrale Auth-Middleware einführen (siehe SEC-12). |
| SEC-02 | 🔴 (latent) | [api/auth_helpers.php](../../api/auth_helpers.php) (Z. 20–68), [api/admin_endpoints.php](../../api/admin_endpoints.php) (Z. 22–56, 95–110) | `verifyJWT()` dekodiert nur den Payload und **prüft keine Signatur**. Sobald `JWT_SECRET` gesetzt ist, reicht ein selbst gebautes Token mit `sub=<Admin-ID>` für den Admin-Zugriff. Zusätzlich gibt es einen Dev-Fallback `return $_GET['user_id']`, wenn `APP_ENV !== 'production'`. Er wird derzeit nur zufällig durch einen `TypeError` unter `strict_types` blockiert. DB-Fallback mit `root`/`root`. | JWT-Pfad entfernen oder eine geprüfte Bibliothek mit Signatur-, `alg`-, `iss`- und `aud`-Prüfung nutzen. Dev-Fallback und Credential-Fallbacks löschen. |
| SEC-03 | 🔴 | [api/_debug_db.php](../../api/_debug_db.php), `api/test_post_input.php`, `api/test_ollama.php`, `api/npc_chat_test.php`, `api/game_guide_test.php`, `api/test_queue_fetch.php`; Root: [gen_hash.php](../../gen_hash.php), [debug_error.php](../../debug_error.php), `check_faction_species.php`, `test_wireframe_api.php`, `bootstrap_25k.php` | Debug-Endpunkte im Webroot ohne Auth. `_debug_db.php` legt Schema und Constraints offen. **`gen_hash.php` setzt bei jedem HTTP-Aufruf das Passwort von `testplayer` auf `test123`.** Die `.htaccess` sperrt nur `config/`. `setup.php` ist korrekt CLI-geschützt. | Dateien löschen bzw. nach `scripts/` verschieben. Webroot auf ein `public/`-Verzeichnis begrenzen. |
| SEC-04 | 🟠 | [config/config.php](../../config/config.php) (Z. 24–25), [api/helpers.php](../../api/helpers.php) (Z. 116–125), [api/auth.php](../../api/auth.php) (Z. 84, 300–328) | `APP_ENV` steht standardmäßig auf `dev` (fail-open): Exception-Details gehen an Clients, `ENABLE_DEV_AUTH_TOOLS=1` aktiviert `dev_reset_password`, Ollama ist aktiv. Das Session-Cookie hat kein `secure`-Flag. | Default auf `production` umstellen; Dev nur explizit aktivieren. `secure => is_https_request()` setzen und `session.cookie_secure` erzwingen. |
| SEC-05 | 🟠 | [.htaccess](../../.htaccess), [api/helpers.php](../../api/helpers.php) (Z. 302), [index.html](../../index.html) (Z. 841–1146 u. a.), `headers.txt` | CSP und `X-Frame-Options` gelten nur für API-Antworten. Die App-Auslieferung hat weder CSP noch HSTS. `index.html` enthält zahlreiche Inline-Skripte und -Styles. Antworten verraten `X-Powered-By: PHP/8.2.33` und setzen ein Xdebug-Cookie. | Inline-Skripte entfernen. CSP mit Nonces/Hashes, HSTS und Permissions-Policy am Reverse Proxy setzen. `expose_php=Off` und Xdebug aus dem Prod-Image entfernen. |
| SEC-06 | 🟠 | [js/features/galaxy/galaxy-controller.js](../../js/features/galaxy/galaxy-controller.js) (Z. 155–206), `js/runtime/wm.js` (Z. 158, 418), `js/components/multi-mode-modal.js`, `js/ui/glossary.js` | Etwa 549 `innerHTML`-ähnliche Stellen. Mehrere davon interpolieren Server- oder Fehlerdaten unescaped, etwa `sys.name` und `error.message`. Positiv: NPC-Dialoge (`npc_dialogue_panel.js:320`) werden escaped. | ESLint-Regel `no-unsanitized` für das ganze Repository; Templates mit Escaping oder `textContent`; LLM- und Spielertexte immer escapen. |
| SEC-07 | 🟠 | [tts_service/config.py](../../tts_service/config.py) (Z. 19), [tts_service/auth.py](../../tts_service/auth.py) (Z. 10–11), [tts_service/models.py](../../tts_service/models.py) (Z. 22), [docker-compose.yml](../../docker-compose.yml) (Z. 97–98) | TTS-Secret ist standardmäßig leer, dann ist Auth deaktiviert. Port 5500 ist auf allen Interfaces offen. `speaker_wav` ist ein frei wählbarer Dateipfad und erlaubt Lesezugriff auf beliebige Dateien im Container. | Secret in Produktion erzwingen (Start abbrechen, falls leer). `speaker_wav` nur über Allowlist-IDs. Dienst nur im internen Netz betreiben. |
| SEC-08 | 🟠 | [docker-compose.yml](../../docker-compose.yml) (Z. 51, 58–59), `monitoring/docker-compose.monitoring.yml` (Z. 49–50), `scripts/ensure_default_admin.php`, [temp_create_user.sql](../../temp_create_user.sql), `create_test_user.sql`, `update_test_user.sql` | MySQL `root`/`root` und `galaxyquest_dev`; DB-Port 3307 auf allen Interfaces; Grafana `admin`/`admin`; Default-Admin-Passwort im Skript; Test-User mit **MD5**-Hash. | Secrets nur per Secret-Store/Env. Startabbruch bei Default-Werten in Produktion. Test-SQL entfernen. Bekannte Passwörter rotieren. |
| SEC-09 | 🟡 | `api/glossary.php` (Z. 118), `api/textures-ai.php` (Z. 518–616), `api/admin_endpoints.php` (Z. 553) | Ausgehende Requests (Wikipedia, KI-Dienste) ohne generelle Host-Allowlist und ohne Prüfung privater IPs (SSRF-Risiko). | Feste Host-Allowlist; private, Loopback- und Link-Local-Bereiche blockieren; Größen- und Timeout-Limits. |
| SEC-10 | 🟡 | [api/auth_helpers.php](../../api/auth_helpers.php) (Z. 87–108) | Rate-Limiting nur punktuell (APCu, pro User, ohne IP-Bezug). Login-Lockout existiert. | Zentrales Rate-Limiting pro IP und User, besonders für Login, Generierung, Markt und Flotten. Zusätzlich am Proxy. |
| SEC-11 | 🟡 | `api/auth.php` (logout), `js/admin/texture-admin-ui.js` (Z. 85–207), `js/services/api-client.js` (Z. 55–108), `js/systems/game_guide_system.js` (Z. 279–288) | Logout ohne CSRF-Schutz; Admin-UI-POSTs ohne CSRF-Token; `ApiClient` sendet kein CSRF-Token und prüft `response.ok` nicht; ein Auth-Token liegt in `localStorage`. | CSRF zentral im `ApiClient`; keine Tokens in `localStorage`; Origin-Prüfung serverseitig. |
| SEC-12 | 🟡 | [api/helpers.php](../../api/helpers.php) (Z. 128–133) vs. [api/auth_helpers.php](../../api/auth_helpers.php) (Z. 144–158); `api/trellis2_endpoints.php` (Z. 365) | Vier Auth-Mechanismen (Session, JWT, API-Key, `X-Admin-Key`) und zwei Admin-Modelle (`users.is_admin` vs. `users.role`). `getCurrentUserId()` existiert dreifach. | Ein Auth-/Autorisierungsmodul mit Rollenmodell; Duplikate entfernen; Autorisierungstests pro Mutation. |

### 4.2 Backend & Spielintegrität (BE)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| BE-01 | 🟠 | [api/buildings.php](../../api/buildings.php) (Z. 180–209) | Ressourcen werden gelesen und geprüft, danach **ohne Transaktion, ohne Row-Lock und ohne Bedingung** abgezogen (`metal=metal-?`). Parallele Requests ermöglichen Double-Spend und negative Ressourcen. In `api/` und `lib/` gibt es insgesamt nur 26 `beginTransaction` und 15 `FOR UPDATE`. | Muster „Transaktion + `SELECT … FOR UPDATE` + bedingtes `UPDATE … WHERE metal >= ?`“ für alle Ressourcenmutationen (Gebäude, Werft, Forschung, Flotte, Handel). Nebenläufigkeitstests ergänzen. |
| BE-02 | 🟠 | [api/simulation_runtime.php](../../api/simulation_runtime.php) (Z. 62–90, 132–144) | Der globale Tick prüft `app_state` und schreibt später zurück (Check-then-Act, kein Lock). Parallele Aufrufe führen denselben Tick doppelt aus. `--force` umgeht den Cooldown. | `GET_LOCK()` bzw. Lease mit atomarem Compare-and-Set; Idempotenzschlüssel pro Tick; Tick-Lag als Metrik. |
| BE-03 | 🟠 | `api/trade.php` (Z. 40), `api/fleet.php` (Z. 28, 110) | Tick-on-Read: Handelsrouten-Dispatch und Flottenankünfte werden bei Lese-Requests verarbeitet. Das Verhalten hängt damit von der Last ab und ist nicht deterministisch. | Simulation ausschließlich in einem überwachten Worker; Request-Handler bleiben frei von Simulations-Seiteneffekten. |
| BE-04 | 🟡 | 33 × `CREATE TABLE IF NOT EXISTS` in 14 Dateien unter `api/` und `lib/` (z. B. `api/buildings.php` Z. 296) | DDL zur Laufzeit führt zu Schema-Drift gegenüber den Migrationen. Der App-User braucht dafür DDL-Rechte. | Gesamte DDL in Migrationen verlagern; App-User nur mit DML-Rechten. |
| BE-05 | 🟡 | `api/` (131 Dateien), größte: `game_engine.php` 121 KB, `fleet.php` 119 KB, `galaxy_gen.php` 87 KB | Kein Front-Controller; Routing, Validierung, SQL und Spiellogik liegen in derselben Datei. 57 Dateien in `api/` haben keinen Auth-Guard, viele davon sind Bibliotheken, die direkt per HTTP aufrufbar sind. `/api/v1/` ist nur ein Rewrite auf Legacy-Routen. | Front-Controller mit Router; Bibliotheken nach `lib/` außerhalb des Webroots; Endpunkte schrittweise in Controller, Services und Repositories zerlegen. |
| BE-06 | 🟡 | 207 × `error_log(` in `api/` und `lib/` | Kein strukturiertes Logging, keine Korrelations-ID im Backend (der Frontend-`ApiClient` erzeugt Trace-IDs). | PSR-3-Logger (Monolog) mit JSON-Ausgabe und Trace-ID aus dem Request-Header. |
| BE-07 | ⚪ | [composer.json](../../composer.json), `ruleset.xml` | Composer nur mit PHPUnit, kein Autoloader, keine statische Analyse (PHPStan/Psalm). phpcs prüft nur `src/` und `tests/`. | PSR-4-Autoloading, PHPStan ab Level 5 mit Baseline, Psalm-Taint-Analyse. |
| BE-08 | 🟠 | `api/`, `lib/` | **Kein Mailversand implementiert** (weder `mail()` noch SMTP oder Provider). Ohne Mailversand gibt es keine E-Mail-Verifikation, keinen Passwort-Reset und keine Benachrichtigungen. | Mail-Abstraktion mit Provider (SMTP/API), Queue, Templates, Bounce-Handling; Doppel-Opt-in. |

**Stärken:** `password_hash`/`password_verify`, `session_regenerate_id` beim Login, Login-Lockout, CSRF auf vielen Mutationen (31 Dateien), überwiegend Prepared Statements, Ownership-Prüfungen in Flotte und Gebäuden, transaktionale Registrierungs-Drafts ([lib/RegistrationDraftService.php](../../lib/RegistrationDraftService.php)), CLI-Guard in `setup.php`, signierte NPC-Worker-API mit **serverseitigem Nonce-Replay-Schutz** ([api/npc_ai_worker.php](../../api/npc_ai_worker.php)).

### 4.3 Datenbank & Migrationen (DB)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| DB-01 | 🟠 | [config/migrations_manifest.php](../../config/migrations_manifest.php), `sql/` | **27 von 92 SQL-Dateien fehlen im Manifest.** Darunter echte Migrationen: `migrate_npc_ai_worker_api_v1.sql` (Nonce-Tabelle für den Replay-Schutz), `migrate_trellis2_integration_v1.sql`, `migrate_diplomatic_plays_v1.sql`, `migrate_regional_market_v1.sql`, `migrate_npc_quest_system_v1.sql`, `migrate_trust_threat_v1.sql`. Seeds und Testdaten liegen im selben Verzeichnis. | CI-Prüfung „jede Migration im Manifest“; `sql/migrations/`, `sql/seeds/` und `tests/fixtures/` trennen. |
| DB-02 | 🟠 | [docker-compose.yml](../../docker-compose.yml) (Z. 62 ff.), [setup.php](../../setup.php), `scripts/migrate.php` + [lib/MigrationRunner.php](../../lib/MigrationRunner.php), [ci.yml](../../.github/workflows/ci.yml) | **Vier Migrationspfade:** Docker-Init (feste Teilmenge), `setup.php` (eigene Liste), `MigrationRunner` (Manifest) und CI (`sql/migrate_*.sql` alphabetisch). Sie erzeugen unterschiedliche Schemata. | Einziger Einstiegspunkt `MigrationRunner` mit Manifest für Docker, CI, Setup und Produktion. |
| DB-03 | 🟡 | [lib/MigrationRunner.php](../../lib/MigrationRunner.php) (Z. 123–227) | Keine Down-Migrationen, kein Advisory-Lock gegen parallele Läufe. Positiv: Transaktionen, Checksummen, Dry-Run. | `GET_LOCK` ergänzen; irreversible Migrationen kennzeichnen; Rollback per Restore dokumentieren. |
| DB-04 | 🟡 | `sql/schema.sql` | `DOUBLE` für spielrelevante Werte, `DATETIME` ohne UTC-Konvention, gemischte `INT`/`BIGINT`-IDs. | `BIGINT` für Ressourcen und IDs, `DECIMAL` für deterministische Werte, UTC-Policy dokumentieren. |
| DB-05 | 🟡 | `sql/test_*`, `sql/seed_test_traders.sql`, Root-SQL | Test-Seeds zwischen den Produktionsmigrationen. | Verschieben; Seeds an die Umgebung koppeln. |
| DB-06 | 🟠 | [Historische TRELLIS2-Deployment-Checkliste](../archive/DEPLOYMENT_CHECKLIST.md) | Kein automatisiertes Backup und kein getesteter Restore; die Doku nutzt `-proot`. | Automatisierte, verschlüsselte Backups (Dump + Binlog/PITR); regelmäßige Restore-Übung; RPO/RTO festlegen. |
| DB-07 | 🟡 | Logs, Events, LLM-Request-Logs, Nachrichten | Kein Retention-/Cleanup-Konzept nachgewiesen (Ausnahme: Worker-Nonces). | Retention-Jobs und Partitionierung für Wachstumstabellen. |
| DB-08 | ⚪ | [THEMISDB_MIGRATION_ROADMAP.md](THEMISDB_MIGRATION_ROADMAP.md), Compose-Dienst `themisdb:latest` | ThemisDB befindet sich in Phase 0 (PoC). Ein zweites DB-System erhöht die Betriebskomplexität. | Per ADR bis nach dem Launch zurückstellen; aus dem Produktions-Scope entfernen. |

**Stärken:** InnoDB/`utf8mb4`, Fremdschlüssel in Kernrelationen, `schema_migrations` mit Checksumme, PDO mit `ERRMODE_EXCEPTION`, nativen Prepares und Charset-DSN ([config/db.php](../../config/db.php)).

### 4.4 Frontend (FE)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| FE-01 | 🟠 | [vite.config.mjs](../../vite.config.mjs) (Z. 89–90) | `sourcemap: true`, `minify: false` („lightningcss CSS parsing issues“). Folge: `core`-Chunk 2,6 MB, `vendor-three` 1,7 MB, 8,7 MB öffentliche Source-Maps. | CSS-Problem gezielt lösen (`cssMinify` separat); JS minifizieren; Source-Maps nur `hidden` und an das Error-Tracking hochladen; Bundle-Budgets in CI. |
| FE-02 | 🟡 | `js/legacy/galaxy3d.js` (204 KB), `js/rendering/galaxy-renderer-core.js` (426 KB), `js/rendering/Galaxy3DRendererWebGPU.js` (151 KB), `js/vendor/three.min.js` (670 KB) | Drei Renderer-Familien parallel; Three.js zusätzlich als Vendor-Kopie und als npm-Paket. | Ein Renderer-Pfad (WebGPU) plus ein klar abgegrenzter Fallback; Legacy und Vendor-Duplikat entfernen. |
| FE-03 | 🟡 | `js/` | Etwa 648 `window.*`-Zuweisungen, 207 `console.log`; mehrere Netzwerkschichten (`js/api.js`, `js/services/api-client.js`, `js/network/*`). | Ein `ApiClient`; Logger mit Produktions-Level; Globals schrittweise abbauen. |
| FE-04 | 🟡 | `js/legacy/engine-compat.js` (Z. 100–145) | Ohne WebGPU und WebGL2 wird `null` zurückgegeben; es gibt keinen Hinweis für Nutzer. | „Gerät nicht unterstützt“-Screen; Browser-Matrix (Chrome, Edge, Firefox, Safari, Mobile) in E2E. |
| FE-05 | 🟡 | `js/rendering`, `js/engine`, `js/ui` | Kein zentraler `dispose`-Vertrag für RAF-Loops, Listener und GPU-Ressourcen beim View-Wechsel. | Lifecycle-Interface verbindlich machen; Leak-Tests (Heap-Snapshots in E2E). |
| FE-06 | 🟡 | `generated/comfyui/output/3D/*.glb` (bis 112 MB), `generated/textures` | Keine Asset-Budgets, kein CDN- und Cache-Konzept. | Asset-Pipeline mit Kompression (Draco/Meshopt, KTX2), LODs, Lazy-Loading, CDN mit Cache-Busting. |
| FE-07 | 🟡 | Root: `admin-dashboard.html`, `benchmark.html`, `ollama_test.html`, `npc_*_test.html`, `game_guide_test.html`, `monitoring-dashboard.html`, `ship-designer.html` | Test- und Admin-Seiten werden mit ausgeliefert. | Aus dem Produktionsartefakt ausschließen; Admin-UI hinter Auth und separatem Pfad. |
| FE-08 | ⚪ | `js/**/*.gz` (543 Dateien), README-Abschnitt „Frontend JS Optimization (PHP, Uglify + Gzip)“ | Alte PHP/Uglify/Gzip-Pipeline neben Vite; vorkomprimierte Dateien im Repository. | Alte Pipeline und `.gz`-Artefakte entfernen; Kompression über Build oder Proxy. |
| FE-09 | ⚪ | `index.html`, `js/` | Deutsche und englische Strings hart codiert; A11y-Attribute nur teilweise vorhanden. | i18n-Ressourcen; Tastatur- und Screenreader-Tests (axe in Playwright). |

**Stärken:** ES-Modul-Composition-Root (`js/main.js`), Whitelist-Modul-Loader, `ApiClient` mit Timeout, Retry und Trace-IDs, 3 411 grüne Vitest-Tests, Reduced-Motion-Unterstützung, explizite WebGPU-Feature-Detection.

### 4.5 Python & KI-Dienste (PY)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| PY-01 | 🟠 | siehe SEC-07 | TTS offen erreichbar, Pfadparameter frei wählbar. | siehe SEC-07 |
| PY-02 | 🟡 | `tts_service/main.py` (Z. 101–155), `tts_service/requirements.txt` | Keine Begrenzung paralleler Synthesen, keine Quoten oder Cache-Eviction. `/health` ist kein Readiness-Check. Abhängigkeiten nur mit Untergrenzen, ohne Lockfile. | Semaphore und Queue, Rate-Limits, Cache-Quota; Liveness und Readiness trennen; gepinnte Requirements mit Hashes. |
| PY-03 | 🟡 | `scripts/*.py`, `tts_service/engines/piper.py` (Z. 9, 81) | 371 Ruff-Befunde; Verstöße gegen den Repo-Standard (`print`, `except Exception`, `urllib.parse`). | `ruff check --fix`; Standard auch für CLI-Skripte durchsetzen oder dort explizit ausnehmen. |
| PY-04 | 🟡 | `api/npc_quest_llm_generator.php`, NPC-Dialoge, Portraits | LLM- und Bildausgaben erreichen Spieler ohne nachgewiesene Moderation; Prompt-Injection über Spielereingaben ist möglich. | Moderationsschicht (Text und Bild), Output-Escaping, Trennung zwischen LLM-Vorschlag und autoritativer Spielentscheidung. |
| PY-05 | 🟡 | KI-Dienste allgemein | GPU-Dienste (Ollama, vLLM, SD, ComfyUI, TRELLIS2) sind teils Runtime-Abhängigkeiten. Bei Ausfall gibt es nur teilweise Fallbacks. | Für den Launch: KI nur als optionale asynchrone Worker hinter Feature-Flags, Assets vorab rendern, Quoten und Kostenbudget. |
| PY-06 | ⚪ | `.github/workflows/python-quality.yml` | Nur `tts_service/tests` laufen in CI; `scripts/test_*.py` nicht. Lief zuletzt auf PR-Branches rot. | Alle Python-Tests in CI; Tool-Versionen pinnen. |

**Stärken:** Multi-Stage- und Non-Root-TTS-Image mit Healthcheck, Pydantic an Grenzen, `run_in_threadpool`, atomare Cache-Writes, HMAC-signierter NPC-Worker-Client mit `pydantic-settings`.

### 4.6 CI/CD & Release (CI)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| CI-01 | 🔴 | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) (Z. 79, 19–23) | **Ungültiges YAML** (`mapping values are not allowed here`, Z. 79 Sp. 104: unquotiertes `"Note: …"` im `run`). Jeder Push erzeugt einen fehlgeschlagenen Lauf **ohne Jobs**. Zudem triggert die Pipeline nur auf `main`/`master`, aktiv entwickelt wird aber auf `develop` (`origin/HEAD`; `main` zuletzt 31.07.2026). | YAML korrigieren (Block-Scalar `run: |`); Trigger auf `develop` und PRs; `actionlint` als Pre-Commit-Hook. |
| CI-02 | 🟠 | `ci.yml` (Z. 56, 79) | Linting nicht blockierend (`continue-on-error`, `\|\| echo`); ESLint prüft nur `js/features/galaxy/`. | Blockierend machen; ganzes Repository mit Baseline. |
| CI-03 | 🟠 | `ci.yml` (Z. 120, 127) | Passwort-Tippfehler `-pgalaxquest_dev`; Migrationen alphabetisch statt per Manifest. Der Job würde auch nach der YAML-Korrektur scheitern. | Migrationen per `MigrationRunner`; Credentials aus `env`. |
| CI-04 | 🟡 | `ci.yml` (Z. 198) | `GQ_BASE_URL=http://localhost:8080`, Compose bindet aber `127.0.0.1:8081`. Der E2E-Lauf startet den kompletten Stack inklusive TTS. | Port angleichen; schlanker CI-Stack ohne KI. |
| CI-05 | 🟡 | `.github/workflows/` | Kein `npm audit` bzw. `composer audit`, kein SBOM, kein Image-Scan, kein JS-SAST (CodeQL nur für Python), kein Secret-Scanning-Gate. | CodeQL für JavaScript, Psalm-Taint oder Semgrep für PHP, Trivy, Gitleaks, Dependabot-Gates. |
| CI-06 | 🟡 | [VERSION.txt](../../VERSION.txt), `.build`, [CHANGELOG.md](../../CHANGELOG.md) | `1.0.0` vs. `1.0.0-dev`; Changelog nur „Unreleased“; keine Tags; Docker-Publish nur auf `main`. | SemVer mit Tags, Release-Workflow, Changelog pro Release, Staging-Promotion. |

### 4.7 Infrastruktur & Betrieb (INF)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| INF-01 | 🟠 | [Dockerfile](../../Dockerfile) | Reines Dev-Image: Xdebug, `dev.ini`, Node/npm im Runtime-Image, `npm run vite:build \|\| true` (Build-Fehler werden ignoriert), `COPY .` übernimmt das gesamte Repository inklusive Tests, SQL, Skripten und generierten Assets. `.dockerignore` hat nur 5 Einträge. | Multi-Stage: Node-Build-Stage, schlankes PHP-Runtime-Image ohne Xdebug, explizite Copy-Liste, Image-Pinning per Digest. |
| INF-02 | 🟠 | [docker-compose.yml](../../docker-compose.yml) | DB (3307), TTS (5500), vLLM (8000), SD (7860), ComfyUI (8188), Ollama (11434) und ThemisDB (8090/18765/4318) lauschen auf allen Interfaces. Viele Images nutzen `:latest`. | Interne Netzwerke; nur der Reverse Proxy ist öffentlich; Versionen pinnen. |
| INF-03 | 🟠 | – | Keine Produktionskonfiguration (Compose oder Kubernetes), kein TLS-Reverse-Proxy, keine Restart-Policies und Ressourcenlimits, keine Staging-Umgebung. | `docker-compose.prod.yml` oder Helm mit Proxy (Caddy/Traefik/Nginx), TLS, Limits und Healthchecks; Staging als Kopie der Produktion. |
| INF-04 | 🟠 | [.htaccess](../../.htaccess) | Nur `config/` ist gesperrt. `sql/`, `scripts/`, `tests/`, `docs/`, `*.md`, `composer.lock`, `cookies.txt` und Root-PHP-Helfer sind per HTTP abrufbar. | DocumentRoot auf `public/` (nur `index.html`, `dist/`, `api/`-Front-Controller, öffentliche Assets). |
| INF-05 | 🟡 | `monitoring/prometheus.yml` (Z. 21, 32–62), `monitoring/docker-compose.monitoring.yml` | Scrape-Targets zeigen auf `localhost` (aus Containersicht falsch), eines ist ungültig (`localhost:8080/api/metrics.php`). Alertmanager ist nicht angebunden, Grafana nutzt `admin`/`admin`, alle Images `:latest`. | Service-Namen und `metrics_path` korrigieren, Alerting-Routen testen, Zugangsdaten über Secrets. |
| INF-06 | 🟡 | – | Kein Error-Tracking (Frontend und Backend), kein Uptime-Monitoring, keine zentrale Log-Aggregation. | Sentry oder GlitchTip, Uptime-Checks, Loki oder ELK; SLOs festlegen. |

### 4.8 Repository-Hygiene (REPO)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| REPO-01 | 🟠 | [cookies.txt](../../cookies.txt), [tmp-gq-cookies.txt](../../tmp-gq-cookies.txt), [headers.txt](../../headers.txt), `.phpunit.result.cache`, `.playwright-mcp/*.log` (22), Screenshots im Root | Eingecheckte Session-Cookies inklusive `gq_remember`-Token (lokale Dev-Instanz), Debug-Header, Test-Caches und Tool-Logs. | `git rm --cached`; Remember-Tokens der Dev-DB invalidieren; `.gitignore` ergänzen; Gitleaks in CI. |
| REPO-02 | 🟡 | `generated/textures` (866 `.lock` + 865 `.png`), `js/**/*.gz` (543), `*.glb` (22) | Laufzeit- und Build-Artefakte versioniert, obwohl `.gitignore` sie teilweise schon ausschließt (Commit vor der Ignore-Regel). | Aus dem Index entfernen; große Binärdateien per Git LFS oder Asset-Storage. |
| REPO-03 | 🟡 | Root-Verzeichnis | Etwa 60 Markdown-Dateien, Test-HTML, Temp-SQL/PHP, `RUNTIME_FACTIONS_CONTROLLER_INTEGRATION.js`, `MeshOnly.json`. | Aufräumen (siehe DOC-02); Root enthält nur Einstiegsdateien. |
| REPO-04 | ⚪ | 99 Remote-Branches (`copilot/*`) | Viele vermutlich gemergte oder verwaiste Agent-Branches. | Gemergte Branches löschen; Branch-Schutz für `main` und `develop`. |

### 4.9 Dokumentation (DOC)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| DOC-01 | 🟠 | [README.md](../../README.md) (Z. 5, 531), [ROADMAP.md (technisch)](ROADMAP.md) (Z. 3–35), [IMPLEMENTATION_STATUS_SUMMARY.md](IMPLEMENTATION_STATUS_SUMMARY.md), [historische Deployment-Checkliste](../archive/DEPLOYMENT_CHECKLIST.md) | Widersprüchliche Statusangaben: „No build step, no framework, no dependencies“ (es gibt Vite und npm); „Server-authoritative, Tick-free“ (es gibt einen Simulations-Tick); „~60 %“ vs. „~70 %“ vs. Reality Check „keine belastbare Prozentzahl“; Onboarding als ✅ markiert, obwohl die Registrierung 503 liefert; Deployment-Checkliste meldet „ALL COMPONENTS READY“. | Eine Statusquelle (Reality Check + diese Roadmap); README korrigieren; Snapshots als historisch markieren. |
| DOC-02 | 🟡 | 223 Markdown-Dateien, etwa 60 im Root | Viele `*_COMPLETE.md`/`*_FINAL.md`-Snapshots und Optionspapiere ohne Statuskennzeichnung. | Nach `docs/archive/` verschieben; Root nur mit README, ROADMAP, CHANGELOG, LICENSE, SECURITY, CONTRIBUTING. |
| DOC-03 | 🟡 | – | Es fehlen `SECURITY.md`, `CONTRIBUTING.md`, eine API-Referenz (OpenAPI), Runbooks (Deploy/Rollback, Backup/Restore, Incident) und ein Threat Model. | Ergänzen (siehe Roadmap Phase 1/6). |
| DOC-04 | ⚪ | `docs/github-issues/` | Planungsdateien sind veraltet; die zugehörigen GitHub-Issues sind geschlossen. | Archivieren oder durch Links mit Status ersetzen. |

**Stärken:** [docs/INDEX.md](../INDEX.md), ADR-001 (Error-Envelope) und ADR-002, evidenzbasierter Reality Check, sehr umfangreiches Game Design und Lore.

### 4.10 Gameplay & Launch-Vollständigkeit (GAME)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| GAME-01 | 🔴 | [api/registration_handlers.php](../../api/registration_handlers.php) (Z. 13), [api/auth.php](../../api/auth.php) (Z. 22) | `register` und `register_complete` liefern bewusst **HTTP 503**, bis Tutorial, E-Mail-Verifikation und Einmal-Startpasswort existieren. Neue Spieler können sich nicht registrieren. | Account-Lifecycle fertigstellen (Roadmap Phase 4). |
| GAME-02 | 🟠 | Reality Check, Abschnitt „Spiel-Backend“ | APIs für Kolonie, Wirtschaft, Bau, Forschung, Flotte, Kampf, Diplomatie und Handel existieren, ein durchgehender Spielablauf ist aber **nicht E2E nachgewiesen**. | Vertical Slice mit E2E-Test „Registrierung → erste Stunde Spiel“ gegen eine echte DB. |
| GAME-03 | 🟠 | Game-Design-Dokumente | Kein verbindliches Konzept für Runden, Seasons oder Endgame zum Launch; kein Balancing-Tooling nachgewiesen. | Launch-Scope-Dokument mit Spielrhythmus, Reset-Politik und Balancing-Telemetrie. |
| GAME-04 | 🟡 | – | Moderation (Namen, Chat, LLM-Texte), Meldewege, Support-Prozess, Anti-Cheat bzw. Multi-Account-Erkennung und Admin-Audit-Log nicht nachgewiesen. | Live-Ops-Paket (Roadmap Phase 8). |

### 4.11 Legal & Compliance (LEGAL)

| ID | Schwere | Ort | Befund | Empfehlung |
|---|---|---|---|---|
| LEGAL-01 | 🟠 | Repository-weit | Kein Impressum, keine Datenschutzerklärung, keine AGB bzw. Nutzungsbedingungen. Kein DSGVO-Self-Service für Export und Löschung (nur Admin-Löschung in `api/admin_users.php`). Kein Consent-Konzept für Cookies, `localStorage` und IndexedDB (Dexie). | Rechtstexte (juristisch geprüft), Self-Service-Export und -Löschung, Verarbeitungsverzeichnis, AV-Verträge mit Dienstleistern (Mail, Hosting). |
| LEGAL-02 | 🟡 | `music/`, `sfx/`, `generated/`, `models/`, `3dmodell-vorlagen/`, KI-Modelle | Keine Herkunfts- und Lizenzdokumentation der Assets. Lizenzen der KI-Modelle sind ungeprüft (z. B. Coqui XTTS-v2 unter der *Coqui Public Model License*, die nach unserem Kenntnisstand **nicht kommerziell** ist; SDXL- und LoRA-Lizenzen; Piper-Stimmen). | Asset-Lizenzmanifest; nicht-kommerzielle Modelle vor dem Launch ersetzen oder lizenzieren. |
| LEGAL-03 | ⚪ | – | Jugendschutz und Altersfreigabe sowie Haftungsfragen für nutzergenerierte bzw. KI-generierte Inhalte ungeklärt. | Im Launch-Scope bewerten. |

---

## 5. Was bereits gut ist (beibehalten)

- Umfangreiche, modulare Codebasis mit klaren Domänen (Galaxie, Flotte, Wirtschaft, Krieg, NPC, Politik)
- Sehr gute JavaScript-Testabdeckung (3 412 Tests) und ein schneller Vite-Build
- Sichere PDO-Konfiguration, überwiegend Prepared Statements, `password_hash`, Login-Lockout, CSRF-Grundgerüst
- Durchdachte Registrierungs-Drafts mit Transaktionen, Rate-Limits und privater Portrait-Auslieferung
- HMAC-signierte Worker-API mit Nonce-Replay-Schutz, Claim-Tokens und Lease-TTL
- TTS-Container nach Repo-Standard (Multi-Stage, non-root, Healthcheck)
- Evidenzbasierte Statusdokumentation (Reality Check), ADRs, Doku-Index
- Feature-Flags für KI-/LLM-Funktionen und Projektionen (Read-Models) mit Dead-Letter-Logik
