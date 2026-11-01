# GalaxyQuest — Roadmap zur Production-Readiness

**Stand:** 31. Oktober 2026 · **Basis:** `develop` @ `c9fd1e8`
**Status:** 🔴 **Nicht produktionsreif.** Hauptprobleme sind Sicherheit, CI, Betrieb, Account-Lifecycle und Rechtliches.
**Evidenz:** [Production-Readiness-Audit](docs/technical/PRODUCTION_AUDIT_2026-10-31.md) · [Reality Check 29.10.2026](docs/technical/REALITY_CHECK_2026-10-29.md)

> Diese Datei ist die **einzige verbindliche Roadmap bis zum öffentlichen Launch.**
> Die bisherige [Feature-Roadmap](docs/technical/ROADMAP.md), die [Refactoring-Roadmap](REFACTORING_ROADMAP.md) und die [3D-Implementierungs-Roadmap](IMPLEMENTATION_ROADMAP.md) gelten als Feature-Backlog bzw. historische Planung. Sie definieren **keinen** Release-Status.
> Befund-IDs wie `SEC-01` verweisen auf den Audit.

---

## 1. Zielbild: Was „production-ready“ für GalaxyQuest bedeutet

GalaxyQuest gilt als produktionsreif, wenn **alle** folgenden Aussagen nachweisbar zutreffen:

1. **Sicher:** Kein Endpunkt ist ohne Authentifizierung und Autorisierung erreichbar, sofern er nicht ausdrücklich öffentlich ist. Keine Default-Credentials. TLS, CSP und sichere Cookies sind aktiv. Ein externer Pentest ergab keine offenen Findings der Stufe High oder Critical.
2. **Korrekt:** Spielzustand wird nur atomar verändert (kein Double-Spend). Die Simulation läuft genau einmal pro Tick in einem überwachten Worker.
3. **Spielbar:** Ein neuer Spieler kann sich registrieren, seine E-Mail verifizieren, das Tutorial abschließen und die erste Spielstunde ohne Hilfe durchlaufen. Das ist durch E2E-Tests gegen eine echte Datenbank belegt.
4. **Betreibbar:** Ein Deployment läuft reproduzierbar aus einem getaggten Release über Staging nach Produktion. Rollback, Backups mit geprobtem Restore, Monitoring, Alerting und Runbooks existieren.
5. **Qualitätsgesichert:** CI ist für `develop`, `main` und PRs grün und blockierend (Lint, Unit-, Integrations- und E2E-Tests, Security-Scans).
6. **Rechtskonform:** Impressum, Datenschutzerklärung und AGB sind veröffentlicht. DSGVO-Rechte (Export, Löschung) sind als Self-Service umgesetzt. Alle Asset- und Modell-Lizenzen erlauben den geplanten Betrieb.
7. **Skalierbar für das Launch-Ziel:** Ein Lasttest belegt die Ziel-Last (Annahme: 500 gleichzeitige Spieler, 5 000 registrierte Konten) und hält die SLOs ein.

---

## 2. Ausgangslage (Kurzfassung des Audits)

| Bereich | Reife (1–5) | Wichtigste Lücke |
|---|:---:|---|
| Sicherheit | 1 | Unauthentifizierte Admin-, KI- und Debug-Endpunkte; JWT ohne Signaturprüfung; `gen_hash.php` setzt Passwörter per HTTP-Aufruf zurück |
| CI/CD | 1 | `ci.yml` ist ungültiges YAML; seit Wochen läuft kein einziger Job; Trigger nicht auf `develop` |
| Deployment/Infra | 1 | Nur ein Dev-Image (Xdebug); keine Produktionskonfiguration und kein TLS; DB und KI-Dienste auf allen Interfaces offen |
| Betrieb/Observability | 1 | Monitoring falsch konfiguriert, keine Backups, kein Error-Tracking |
| Spielintegrität | 2 | Double-Spend in `buildings.php`; globaler Tick ohne Lock; Tick-on-Read |
| Datenbank | 2 | Vier Migrationspfade; 27 SQL-Dateien fehlen im Manifest |
| Frontend | 2–3 | Starke Testbasis (3 412 Tests), aber unminifizierter 2,6-MB-Core-Chunk, öffentliche Source-Maps, drei Renderer-Familien |
| Spielbarkeit | 1 | Registrierung liefert HTTP 503; kein Mailversand, kein Tutorial; Core Loop nicht E2E nachgewiesen |
| Legal | 1 | Keine Rechtstexte, kein DSGVO-Self-Service, Lizenzlage der KI-Modelle ungeklärt |
| Repository-Hygiene | 1 | Session-Cookies, Logs und tausende Artefakte eingecheckt; etwa 60 Markdown-Dateien im Root |

**Stärken, auf denen aufgebaut wird:** große, domänenorientierte Codebasis, sehr gute JavaScript-Testabdeckung, schneller Vite-Build, sichere PDO-Basis, CSRF- und Lockout-Grundlagen, sauber gebaute Registrierungs-Drafts, HMAC-Worker-API mit Replay-Schutz, TTS-Container nach Standard, evidenzbasierte Doku (Reality Check, ADRs).

---

## 3. Leitprinzipien

1. **Feature-Freeze für neue Spielsysteme bis Meilenstein M3.** Bestehende Systeme werden stabilisiert, fertiggestellt oder bewusst aus dem Launch-Scope entfernt. Neue Systeme kommen nicht hinzu.
2. **Evidenz statt Prozentangaben.** „Fertig“ heißt: Test in grüner CI und Abnahme gegen das Exit-Kriterium der Phase. Statusdokumente ohne Beleg werden archiviert.
3. **Sicherheit vor Sichtbarkeit.** Bis Phase 2 abgeschlossen ist, läuft keine Instanz öffentlich erreichbar.
4. **Ein Weg pro Sache:** ein Migrationspfad, ein Auth-Modul, ein API-Client, ein Renderer-Pfad, eine Statusquelle.
5. **KI ist optional.** Der Spielkern funktioniert ohne GPU-Dienste. KI-Funktionen laufen asynchron hinter Feature-Flags (Default aus).
6. **Kleine, reviewbare PRs** mit Befund-ID im Titel. Agenten-PRs durchlaufen dieselben Quality Gates.

---

## 4. Phasen und Meilensteine (Überblick)

| Phase | Ziel | Schätzung¹ | Meilenstein | Abhängig von |
|---|---|---|---|---|
| **0** | Sofortmaßnahmen: Angriffsfläche schließen, CI reparieren | 1 Woche | **M0 – Sicher eingefroren** | – |
| **1** | Fundament & Quality Gates | 2–3 Wochen | **M1 – Grüne, blockierende Pipeline** | 0 |
| **2** | Security- und Backend-Härtung | 4–6 Wochen | **M2 – Gehärtetes Backend** | 1 |
| **3** | Daten, Migrationen & Simulation | 3–4 Wochen | (Teil von M2) | 1 |
| **4** | Spielbarkeit: Account-Lifecycle & Core Loop | 6–8 Wochen | **M3 – Spielbarer Vertical Slice (Closed Alpha)** | 2, 3 |
| **5** | Frontend-Konsolidierung & Performance | 4–6 Wochen (parallel zu 4) | (Teil von M3) | 1 |
| **6** | Infrastruktur, Betrieb & Observability | 3–4 Wochen | **M4 – Staging = Produktion** | 2, 3 |
| **7** | KI-Dienste produktionsfähig (optional) | 2 Wochen | – | 6 |
| **8** | Legal, Compliance & Live-Ops | 2–4 Wochen (+ externe Prüfung) | **M5 – Closed Beta** | 4, 6 |
| **9** | Launch-Vorbereitung: Last, Pentest, Beta | 4–8 Wochen | **M6 – Open Beta / Launch 1.0** | alle |

¹ Grobe Schätzung bei 1–2 Vollzeit-Entwicklern. Phasen 3 und 5 sowie Teile von 6 und 8 können parallel laufen. **Realistischer Gesamtrahmen: 6–9 Monate bis zur Open Beta.**

---

## Phase 0 — Sofortmaßnahmen (Woche 1)

**Ziel:** Kritische, ausnutzbare Lücken schließen und Sichtbarkeit über die Qualität herstellen. Alle Punkte sind kleine, isolierte Änderungen.

**CI wiederbeleben** (CI-01, CI-03)
- [x] `.github/workflows/ci.yml` Z. 79 korrigieren: Block-Scalar `run: |`; Tippfehler `-pgalaxquest_dev` (Z. 120, 127) korrigiert
- [x] Trigger in `ci.yml` auf `develop` und Pull Requests erweitern
- [x] Trigger ebenso in `codeql-python.yml` und `python-quality.yml` auf `develop` erweitern; ungültige CodeQL-`paths`-Action-Option entfernen

**Angriffsfläche entfernen** (SEC-01, SEC-03, FE-07)
- [x] Root-Helfer (`gen_hash.php`, `debug_error.php`, `check_faction_species.php`, `test_wireframe_api.php`, `bootstrap_25k.php`) per CLI-Guard und `.htaccess` gegen HTTP-Aufruf sperren; API-Test-/Debug-Skripte ebenfalls absichern
- [x] Admin-Guard für `api/textures-admin.php` und `api/generation_queue_monitor.php`; Login-Pflicht für das spielseitige `api/traders_dashboard.php`
- [x] Auth für `api/textures-ai.php` und `api/generation_queue_v3.php`; Queue-`user_id` stammt aus der Session
- [x] Test-/Admin-HTML-Seiten sowie Quellcode, SQL, Logs und Konfigurationsdateien im Webroot per `.htaccess` sperren

**Auth-Fallbacks entfernen** (SEC-02, SEC-04)
- [x] JWT-Pfad ohne Signaturprüfung und Dev-Fallback `$_GET['user_id']` entfernen
- [x] DB-Fallback `root`/`root` in Auth-/Admin-Helfern entfernen
- [x] `APP_ENV`-Default auf `production` (fail-closed); Dev-Tools und lokale KI nur bei explizitem `APP_ENV=dev`

**Secrets & Hygiene** (REPO-01, SEC-08)
- [x] Getrackte Cookies, Header-Dumps und `.playwright-mcp/`-Artefakte mit `git rm --cached` entfernen; `.gitignore` ergänzen (`.phpunit.result.cache` war nicht getrackt)
- [ ] Remember-Tokens und Sessions der Dev-Instanz invalidieren (DB nicht verfügbar); Default-Admin- und Testpasswörter in der aktiven Dev-DB rotieren
- [x] `create_test_user.sql`, `temp_create_user.sql` (MD5) und `update_test_user.sql` aus dem Git-Index entfernen
- [x] Ports in `docker-compose.yml` an `127.0.0.1` binden; Grafana-Passwort aus `.env`

**Exit-Kriterium M0:** `ci.yml` erzeugt Jobs auf `develop`. Kein unauthentifizierter Mutations-, Admin- oder Debug-Endpunkt ist mehr erreichbar (manuelle Liste und Smoke-Test). Keine Cookies oder Logs im Index.

---

## Phase 1 — Fundament & Quality Gates (Wochen 2–4)

**Ziel:** Jede Änderung wird automatisch und blockierend geprüft. Release-Basis steht.

**Pipeline** (CI-02 … CI-06)
- [x] Kein `continue-on-error` oder `|| echo` in Workflows; Docker-Buildfehler werden nicht mehr verschluckt, der Build nutzt Node 24 wie `.nvmrc`
- [x] ESLint für das gesamte `js/` mit Baseline und `no-unsanitized`; die Baseline dokumentiert 271 bestehende DOM-Sinks in 107 Dateien, neue Findings lassen den Gate fehlschlagen (SEC-06)
- [x] PHP-Syntaxprüfung mit `php -l` als CI-Schritt
- [ ] PHPCS für `api/`, `lib/`, `config/` (Baseline), **PHPStan Level 5** mit Baseline (BE-07)
- [ ] PHPUnit gegen MySQL 8 mit Migration über `MigrationRunner` (DB-02); Ergebnis der 29 Defekte im Cache klären
- [x] Vitest 5 mit 3 412 bestandenen Tests und Vite 8.3.5 mit blockierendem Produktionsbuild ohne Source-Maps; `npm ci` reproduzierbar
- [x] Node 24 in `.nvmrc` festgelegt und in den Node-Workflows verwendet
- [x] Minifizierter JS-Chunk maximal 1,25 MiB und gesamte JS-Ausgabe maximal 650 KiB gzip (FE-01); aktueller Build: Core 1,11 MiB, alle JS-Chunks 594 KiB gzip
- [x] E2E-Port-Mismatch 8080/8081 korrigiert
- [ ] E2E (Playwright) gegen schlanken CI-Stack ohne KI-Dienste (Workflow nutzt jetzt den Compose-CI-Override; erster CI-Lauf zur Verifikation steht aus)
- [x] `npm audit --audit-level=high`, `composer audit`, CodeQL für JavaScript/Python und `actionlint` konfiguriert; `minimatch` auf 11.0.3 überschrieben, `npm audit` ist vollständig clean
- [x] Gitleaks für die Git-Historie sowie Trivy für Dateisystem und Container-Image in CI ergänzt
- [ ] Erste CI-Scans ausführen und alle High-/Critical-Findings triagieren und beheben
- [x] Ruff lint/format und Mypy für TTS-Service und Skripte als CI-Checks; Python-Tests (29) und Mypy-Prüfungen lokal erfolgreich
- [x] Vite auf 8.3.5 und Vitest auf 5.0.5 aktualisiert; öffentliche Source-Maps im Build deaktiviert
- [x] Moderate npm-Findings im ESLint-/`minimatch`-Pfad durch gepinntes Override auf `minimatch` 11.0.3 behoben
- [x] JavaScript mit Oxc und CSS mit Lightning CSS minifizieren; zwei ungültige `transition`-Deklarationen korrigiert, die zuvor CSS-Minifizierung blockierten

**Repository & Prozess** (REPO-02 … REPO-04, DOC-01 … DOC-04, CI-06)
- [ ] Branch-Schutz für `main` und `develop` (Required Checks, Review); gemergte `copilot/*`-Branches aufräumen
- [x] Generierte Texture-Cache-PNGs und Lockfiles aus dem Index entfernt; lokale Cache-Dateien bleiben erhalten und werden ignoriert
- [ ] `js/**/*.gz` erst nach Migration des Boot-Loaders entfernen: Die komprimierten Bundles werden derzeit vom Boot-System geladen und durch `.htaccess` mit `Content-Encoding: gzip` ausgeliefert ([Boot-System](docs/technical/BOOT_SYSTEM_ARCHITECTURE.md), [`.htaccess`](.htaccess))
- [ ] Die 22 verbleibenden GLB-Dateien auf Runtime-/Testbedarf prüfen und nicht benötigte generierte Assets auslagern; größtes getracktes GLB aktuell ca. 10 MiB
- [ ] Root aufräumen: Snapshot- und Statusdokumente nach `docs/archive/`; Root enthält nur Einstiegsdateien
- [x] Falsche README-Aussagen „No build step“ und „Tick-free“ korrigiert
- [x] README mit dieser Roadmap verlinkt
- [ ] Veraltete Statusangaben entfernen
- [x] `SECURITY.md` mit privatem Meldeweg und `CONTRIBUTING.md` mit Branching, PR-Regeln und den real verfügbaren Quality Gates; im Index verlinkt
- [ ] Versionierung: SemVer, Git-Tags, `VERSION.txt` als einzige Quelle, Changelog pro Release, Release-Workflow

**Exit-Kriterium M1:** Alle Pflicht-Checks laufen grün und blockierend auf `develop` und PRs. Das erste Tag `v0.9.0-alpha.1` ist aus der Pipeline gebaut.

---

## Phase 2 — Security- und Backend-Härtung (Wochen 4–10)

**Ziel:** Ein Auth-Modell, ein Einstiegspunkt, keine bekannten High-Findings.

**Architektur-Grundlage** (BE-05, INF-04)
- [ ] Verzeichnis `public/` als DocumentRoot mit `index.html`, `dist/`, öffentlichen Assets und einem **API-Front-Controller** (`public/api/index.php`)
- [ ] Router mit Routen-Tabelle; Middleware-Kette: Request-ID → Rate-Limit → Session/Auth → CSRF → Autorisierung → Handler → Error-Envelope (ADR-001)
- [ ] Bestehende Endpunkte zunächst als Legacy-Handler über den Router anbinden; Bibliotheken aus `api/` nach `lib/` verschieben
- [ ] PSR-4-Autoloading über Composer

**Authentifizierung & Autorisierung** (SEC-02, SEC-10 … SEC-12)
- [ ] Ein Auth-Modul (Session-basiert); doppelte `getCurrentUserId`/`verifyJWT` entfernen; Rollenmodell vereinheitlichen (`users.role` **oder** `is_admin`, inklusive Migration)
- [ ] Falls Tokens für Worker oder APIs nötig sind: geprüfte JWT-Bibliothek mit Signatur-, `alg`-, `exp`-, `iss`- und `aud`-Prüfung oder HMAC wie beim NPC-Worker
- [ ] Autorisierungstests: Für jeden mutierenden Endpunkt ein Test „fremder User → 403“ und „anonym → 401“
- [ ] CSRF zentral in der Middleware und im Frontend-`ApiClient` (inklusive Logout und Admin-UI); Origin-/Referer-Prüfung
- [ ] Zentrales Rate-Limiting pro IP und User (Redis oder DB), strikte Limits für Login, Registrierung, KI und Markt

**Transport & Browser** (SEC-04 … SEC-06)
- [ ] Session-Cookies mit `Secure`, `HttpOnly`, `SameSite=Lax/Strict`, `__Host-`-Präfix; Remember-Me-Token gehasht und rotierend
- [ ] Inline-Skripte aus `index.html` auslagern; CSP mit Nonce/Hash, HSTS, `Permissions-Policy`, `Referrer-Policy`, `frame-ancestors`
- [ ] `expose_php=Off`, Server-Signatur aus
- [ ] Unescaped `innerHTML`-Stellen beheben (Start: `galaxy-controller.js`, `wm.js`, `multi-mode-modal.js`, `glossary.js`); kein Auth-Token in `localStorage`

**Ausgehende Requests & Fehlerbehandlung** (SEC-09, BE-06)
- [ ] Zentraler HTTP-Client mit Host-Allowlist, Blockade privater IPs, Timeouts und Größenlimits
- [ ] Strukturiertes Logging (Monolog/JSON) mit Request-ID; Exception-Details nie an Clients

**Threat Model**
- [ ] STRIDE-Analyse für Auth, Spielökonomie, KI-Pfade und Admin-Funktionen; Ergebnis in `docs/security/THREAT_MODEL.md`

**Exit-Kriterium M2 (gemeinsam mit Phase 3):** Alle Requests laufen über den Front-Controller. Interner Security-Review (OWASP ASVS Level 2, Checkliste) ohne offene High-Findings. Autorisierungstests decken 100 % der mutierenden Routen ab.

---

## Phase 3 — Daten, Migrationen & Simulation (Wochen 4–8, parallel zu Phase 2)

**Ziel:** Reproduzierbares Schema, atomare Spielzustandsänderungen, deterministische Simulation.

**Migrationen** (DB-01 … DB-05, BE-04)
- [ ] **Einziger Migrationspfad** `scripts/migrate.php` (`MigrationRunner`) für Docker-Init, CI, `setup.php` und Produktion; andere Pfade entfernen
- [ ] Die 27 fehlenden SQL-Dateien sichten: echte Migrationen ins Manifest aufnehmen, Seeds und Tests verschieben (`sql/migrations/`, `sql/seeds/`, `tests/fixtures/`)
- [ ] CI-Prüfung: „frische DB → alle Migrationen → Schema-Diff gegen Referenz = 0“ und „jede Datei in `sql/migrations` steht im Manifest“
- [ ] Advisory-Lock (`GET_LOCK`) im `MigrationRunner`; irreversible Migrationen kennzeichnen
- [ ] Alle 33 Laufzeit-DDL-Statements in Migrationen verlagern; App-DB-User ohne DDL-Rechte
- [ ] Datentypen bereinigen: `BIGINT` für Ressourcen und IDs, `DECIMAL` statt `DOUBLE` für deterministische Werte, UTC-Konvention

**Spielintegrität** (BE-01 … BE-03)
- [ ] Gemeinsamer `ResourceLedger`-Service: Transaktion + `SELECT … FOR UPDATE` + bedingtes Update; Einsatz in Bau, Forschung, Werft, Flotte, Handel und Markt
- [ ] Nebenläufigkeitstests (parallele Requests) für jede Ressourcenmutation; Invariante „Ressourcen ≥ 0“ per DB-Constraint oder Check
- [ ] Simulation als **eigener Worker-Prozess** (Supervisor/systemd/Container) mit Lease (`GET_LOCK` oder Lease-Tabelle) und idempotenter Tick-Nummer; `--force` nur für Admin-CLI
- [ ] Tick-on-Read entfernen (`trade.php`, `fleet.php` u. a.); Lesepfade bleiben frei von Seiteneffekten
- [ ] Tick-Metriken: Dauer, Lag, Fehler pro Subsystem

**Datenlebenszyklus** (DB-06, DB-07)
- [ ] Retention-Jobs und Partitionierung für Logs, Events, LLM-Logs und Nachrichten
- [ ] Automatisierte, verschlüsselte Backups (täglicher Dump + Binlog für PITR) an einem externen Speicherort
- [ ] **Restore-Übung** dokumentiert und monatlich wiederholt; Ziele: RPO ≤ 15 min, RTO ≤ 2 h
- [ ] ADR: ThemisDB wird bis nach dem Launch zurückgestellt (DB-08)

**Exit-Kriterium:** Eine frische Umgebung entsteht mit einem Befehl und identischem Schema. Nebenläufigkeitstests sind grün. Der Tick-Worker läuft 72 h ohne doppelte oder ausgelassene Ticks. Der Restore wurde erfolgreich geprobt.

---

## Phase 4 — Spielbarkeit: Account-Lifecycle & Core Loop (Wochen 8–16)

**Ziel:** Ein neuer Spieler kommt ohne Hilfe von der Landingpage bis zur ersten Spielstunde.

**Launch-Scope festlegen** (GAME-03)
- [ ] Dokument `docs/gamedesign/LAUNCH_SCOPE.md`: Welche Systeme sind zum Launch aktiv (Kolonie, Wirtschaft, Bau, Forschung, Flotte, Kampf, Diplomatie, Handel), welche stehen hinter Flags oder werden entfernt?
- [ ] Spielrhythmus festlegen: persistente Galaxie oder Seasons, Reset-Politik, Endgame-Ziel, Neuspieler-Schutz

**Account-Lifecycle** (GAME-01, BE-08)
- [ ] Mail-Infrastruktur: Provider (SMTP/API), Versand-Queue, Templates (DE/EN), SPF, DKIM und DMARC, Bounce-Handling
- [ ] Registrierung reaktivieren: E-Mail-Verifikation mit Doppel-Opt-in, Einmal-Startpasswort bzw. Passwortsetzen, Rate-Limits, Captcha oder Proof-of-Work gegen Bots
- [ ] Passwort-Reset per Mail; `dev_reset_password` in Produktion hart deaktivieren
- [ ] Konto-Einstellungen: Passwort und E-Mail ändern, **Datenexport** und **Kontolöschung** als Self-Service (LEGAL-01)
- [ ] Optional: 2FA (TOTP) für Admins verpflichtend

**Onboarding & Core Loop** (GAME-02)
- [ ] Tutorial bzw. geführte erste Mission, gekoppelt an den Registrierungs-Prolog
- [ ] Vertical Slice als E2E-Suite gegen eine echte DB: Registrierung → Verifikation → Heimatkolonie → erstes Gebäude → Forschung → erstes Schiff → Flottenbewegung → Handel → Kontakt mit einer NPC-Fraktion
- [ ] Balancing-Telemetrie (Ressourcenkurven, Zeit bis Meilenstein) und Admin-Tools zur Anpassung von Parametern ohne Deployment
- [ ] Fehlerzustände im UI: Offline, Wartung, Session abgelaufen, Gerät nicht unterstützt

**Exit-Kriterium M3 (Closed Alpha):** 10–20 eingeladene Tester registrieren sich selbstständig. Die Vertical-Slice-E2E-Suite ist grün. Keine Blocker-Bugs im Core Loop.

---

## Phase 5 — Frontend-Konsolidierung & Performance (Wochen 6–14, parallel)

**Ziel:** Ein schlanker, sicherer und messbar performanter Client.

- [ ] Produktionsbuild minifizieren; CSS-Minify-Problem isoliert lösen; Source-Maps `hidden` und nur an das Error-Tracking hochladen (FE-01)
- [ ] `core`-Chunk aufteilen (Route- und View-basiertes Lazy-Loading); Budget: initiales JS ≤ 400 KB gzip
- [ ] **Ein Renderer-Pfad:** WebGPU-Renderer plus definierter WebGL2-Fallback; `js/legacy/galaxy3d.js` und `js/vendor/three.min.js` entfernen (FE-02)
- [ ] „Gerät nicht unterstützt“-Screen und Browser-Matrix in Playwright (Chromium, Firefox, WebKit, Mobile) (FE-04)
- [ ] Ein `ApiClient` mit CSRF, `response.ok`-Prüfung, Error-Envelope-Parsing; `js/api.js` und direkte `fetch`-Aufrufe migrieren (FE-03, SEC-11)
- [ ] Lifecycle- und `dispose`-Vertrag für Views, Renderer und Audio; Leak-Test in E2E (FE-05)
- [ ] Logger mit Level-Gating statt `console.log`; Globals schrittweise abbauen
- [ ] Asset-Pipeline: GLB mit Meshopt/Draco, Texturen als KTX2, LODs, Lazy-Loading, CDN mit Cache-Busting; Größenbudgets in CI (FE-06)
- [ ] Alte PHP/Uglify/Gzip-Pipeline und `.gz`-Artefakte entfernen (FE-08)
- [ ] i18n-Grundgerüst (DE/EN); axe-Checks in Playwright; Tastaturbedienung der Kern-UI (FE-09)

**Exit-Kriterium:** Lighthouse Performance ≥ 70 auf Referenz-Hardware für die Landing- und Login-Seite. Time-to-Interactive der Galaxieansicht ≤ 5 s bei 4G und Mittelklasse-Laptop. 60 FPS in der Standardansicht auf Referenz-GPU. Keine axe-Findings der Stufe „critical“.

---

## Phase 6 — Infrastruktur, Betrieb & Observability (Wochen 10–14)

**Ziel:** Staging und Produktion sind identisch, automatisiert und überwacht.

**Build & Deployment** (INF-01 … INF-04)
- [ ] Produktions-`Dockerfile` als Multi-Stage-Build: Node-Build-Stage → `php:8.x-apache` bzw. `php-fpm` + Nginx, ohne Xdebug und Node, non-root, `HEALTHCHECK`, explizite Copy-Liste, umfassende `.dockerignore`
- [ ] `docker-compose.prod.yml` (oder Helm): Reverse Proxy (Caddy/Traefik) mit TLS und HSTS, internes Netzwerk, nur Port 443 öffentlich, Restart-Policies, CPU- und Speicherlimits, Images per Version oder Digest gepinnt
- [ ] Getrennte Dienste: Web, Tick-Worker, Mail-Worker, NPC-/KI-Worker, Cron/Retention
- [ ] Secrets über einen Secret-Store oder Docker Secrets; Startabbruch bei Default-Credentials
- [ ] Release-Pipeline: Tag → Image-Build → SBOM (Syft) → Scan (Trivy) → Signatur (cosign) → Deployment nach Staging → Smoke-Tests → manuelle Freigabe → Produktion; Rollback per Image-Tag
- [ ] Staging-Umgebung mit anonymisierten oder synthetischen Daten

**Observability** (INF-05, INF-06)
- [ ] Prometheus-Targets auf Service-Namen umstellen, `/metrics` absichern, Alertmanager anbinden; Images pinnen; Grafana-Zugang über SSO oder Secret
- [ ] App-Metriken: Request-Latenz und Fehlerrate pro Route, Tick-Dauer und -Lag, Queue-Längen, aktive Spieler, Mail-Zustellrate
- [ ] Error-Tracking für Frontend und Backend (Sentry/GlitchTip) mit Release-Zuordnung
- [ ] Zentrale Logs (Loki/ELK) mit Request-ID-Korrelation; Uptime-Checks von außen
- [ ] Liveness- und Readiness-Endpunkte (DB, Worker-Heartbeat)

**Runbooks** (DOC-03)
- [ ] Deployment und Rollback, Backup und Restore, Incident-Response (inkl. Sicherheitsvorfall und Datenpanne mit 72-h-Meldepflicht), Tick-Worker-Störung, Wartungsmodus

**Exit-Kriterium M4:** Deployment nach Staging und Produktion ausschließlich über die Pipeline. Alerts erreichen die Bereitschaft (Test-Alarm). Ein Rollback wurde einmal geprobt. Die Runbooks wurden in einer Game-Day-Übung getestet.

---

## Phase 7 — KI-Dienste produktionsfähig (optional, Wochen 14–16)

**Ziel:** KI-Funktionen sind sicher, kostenbegrenzt und für den Spielkern verzichtbar.

- [ ] Alle KI-Features hinter Flags, Default **aus**; das Spiel ist ohne GPU-Dienste vollständig spielbar (PY-05)
- [ ] TTS: Secret in Produktion Pflicht (Startabbruch), `speaker_wav` nur als Allowlist-ID, Semaphore und Rate-Limit, Cache-Quota, Readiness-Check, gepinnte Requirements mit Hashes (SEC-07, PY-02)
- [ ] NPC-Worker: Release bei Fehlschlag, Monitoring der Lease- und Claim-Raten; Nonce-Migration verbindlich im Manifest (DB-01)
- [ ] Moderationsschicht für LLM- und Bild-Outputs; Prompt-Injection-Schutz; LLM schlägt nur vor, die Spiellogik entscheidet (PY-04)
- [ ] Vorab gerenderte Assets statt Laufzeitgenerierung für Launch-Inhalte (Texturen, Portraits, Modelle)
- [ ] Kosten- und GPU-Budget mit Quoten pro Spieler und Tag; Abschaltplan bei Überschreitung

**Exit-Kriterium:** Abschalten aller KI-Dienste in Staging ändert nichts am E2E-Ergebnis des Core Loops. Ein KI-Lasttest bleibt innerhalb des Kostenbudgets.

---

## Phase 8 — Legal, Compliance & Live-Ops (Wochen 12–18)

**Ziel:** Rechtssicherer Betrieb und handlungsfähiges Live-Team.

**Rechtliches** (LEGAL-01 … LEGAL-03)
- [ ] Impressum, Datenschutzerklärung und AGB bzw. Nutzungsbedingungen (juristisch geprüft); Versionierung und Zustimmung bei der Registrierung
- [ ] Consent-Konzept für Cookies, `localStorage` und IndexedDB; keine nicht notwendigen Speicherungen ohne Einwilligung
- [ ] Verarbeitungsverzeichnis, AV-Verträge (Hosting, Mail, Error-Tracking), Löschkonzept mit Fristen
- [ ] **Asset- und Modell-Lizenzmanifest** (Musik, SFX, Texturen, 3D-Modelle, KI-Modelle und -Stimmen). Nicht kommerziell lizenzierte Modelle (z. B. XTTS-v2 unter CPML) vor dem Launch ersetzen oder lizenzieren
- [ ] Altersfreigabe und Jugendschutz bewerten; Haftungsrahmen für nutzer- und KI-generierte Inhalte

**Live-Ops** (GAME-04)
- [ ] Moderation: Namensfilter, Melde-Funktion, Moderations-Queue, Sanktionen (Mute/Ban) mit Audit-Log
- [ ] Admin-Audit-Log für alle administrativen Aktionen; Admin-Bereich nur mit 2FA
- [ ] Anti-Cheat: serverseitige Plausibilitätsprüfungen, Multi-Account-Erkennung, Rate-Anomalien
- [ ] Support-Kanal (E-Mail/Ticket), FAQ, Statusseite, Wartungsankündigungen im Spiel
- [ ] Community-Regeln und Kommunikationsplan

**Exit-Kriterium M5 (Closed Beta):** Rechtstexte sind online. DSGVO-Export und -Löschung funktionieren E2E. Das Lizenzmanifest ist vollständig. Moderations- und Support-Prozess sind mit benannten Verantwortlichen besetzt.

---

## Phase 9 — Launch-Vorbereitung (Wochen 16–24)

- [ ] **Lasttest** (k6/Gatling) mit realistischen Spielerprofilen gegen Staging: Ziel-Last plus 50 % Reserve, Tick-Worker unter Last, DB-Indizes nach Slow-Query-Analyse
- [ ] **Externer Pentest** (Web, API, Auth, Spielökonomie); alle Findings der Stufe High oder Critical behoben und nachgetestet
- [ ] **Closed Beta** (100–300 Spieler, 4+ Wochen): Telemetrie, Balancing-Iterationen, Bug-Triage mit SLA
- [ ] Wipe-Entscheidung und Kommunikation vor der Open Beta
- [ ] **Go/No-Go-Review** anhand der Gates in Abschnitt 5

---

## 5. Go-Live-Gates (alle müssen erfüllt sein)

| # | Gate | Nachweis |
|---|---|---|
| G1 | CI grün und blockierend auf `main` und `develop` | Branch-Protection-Einstellungen, letzte 20 Läufe |
| G2 | 0 offene Security-Findings der Stufe High oder Critical (Pentest, SAST, Dependency-Scan) | Pentest-Bericht, Scan-Reports |
| G3 | 0 unauthentifizierte nicht öffentliche Routen | Automatisierter Routen-Auth-Test |
| G4 | Vertical-Slice-E2E grün gegen echte DB in Staging | CI-Artefakt |
| G5 | Nebenläufigkeitstests der Ressourcenmutationen grün; 72 h Tick-Stabilität | Testreport, Tick-Metriken |
| G6 | Restore innerhalb des RTO in den letzten 30 Tagen geprobt | Restore-Protokoll |
| G7 | Lasttest erfüllt SLOs bei Ziel-Last + 50 % | k6-Report |
| G8 | Monitoring, Alerting und Error-Tracking aktiv; Bereitschaft benannt | Test-Alarm, Rota |
| G9 | Rechtstexte online, DSGVO-Self-Service funktionsfähig, Lizenzmanifest vollständig | Review-Protokoll |
| G10 | Rollback in Produktion-ähnlicher Umgebung geprobt | Protokoll |

---

## 6. SLOs und Launch-KPIs (Startwerte, nach Beta kalibrieren)

| Kategorie | Ziel |
|---|---|
| Verfügbarkeit Spiel-API | ≥ 99,5 % / Monat |
| API-Latenz | p95 ≤ 300 ms, p99 ≤ 1 s (ohne KI-Routen) |
| Fehlerrate | ≤ 0,5 % 5xx |
| Tick-Pünktlichkeit | ≥ 99 % der Ticks mit Lag ≤ 1 Intervall |
| Datenverlust | RPO ≤ 15 min, RTO ≤ 2 h |
| Onboarding | ≥ 70 % der Registrierten schließen das Tutorial ab |
| Retention | D1 ≥ 35 %, D7 ≥ 15 % (Beta-Richtwert) |
| Frontend | Fehlerfreie Sessions ≥ 98 % (Error-Tracking) |

---

## 7. Bewusst **nach** dem Launch (Post-1.0-Backlog)

Diese Themen sind im Code oder in der Doku angelegt, bleiben aber **nicht** Teil des Launch-Scopes. Sie werden vor dem Launch ausgeblendet, hinter Flags gelegt oder entfernt:

- ThemisDB-Migration ([THEMISDB_MIGRATION_ROADMAP.md](docs/technical/THEMISDB_MIGRATION_ROADMAP.md))
- TRELLIS2- und ComfyUI-Laufzeitgenerierung von 3D-Assets; Stable Diffusion und vLLM als Live-Dienste
- LLM-gesteuerte NPC-Controller mit Spielwirkung (Vorschläge bleiben möglich, Entscheidungen trifft die deterministische Logik)
- Erweiterte VFX-, Warp- und Wormhole-Effekte sowie experimentelle Renderer-Features ([IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md))
- Weitere Spielsysteme aus der [Feature-Roadmap](docs/technical/ROADMAP.md), die nicht im `LAUNCH_SCOPE.md` stehen
- Mobile-native Clients, Monetarisierung (erst nach separatem Legal- und Payment-Konzept)

---

## 8. Risiken

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| Codebasis zu groß für das Team (≈ 250 000 Zeilen, 57 % Agent-Commits) | Langsame Härtung, Regressionen | Feature-Freeze, Scope-Cut, Quality Gates auch für Agent-PRs |
| Monolithische Endpunkte (bis 121 KB) | Fehleranfällige Refactorings | Front-Controller zuerst, dann schrittweise Extraktion mit Tests |
| Unklare Lizenzlage von Assets und Modellen | Launch-Stopp, Abmahnung | Lizenzmanifest früh (parallel zu Phase 2) beginnen |
| GPU- und KI-Kosten | Unkontrollierte Betriebskosten | KI optional, Quoten, vorgerenderte Assets |
| Fehlender Mailversand bzw. Zustellprobleme | Kein Onboarding | Etablierter Provider, SPF/DKIM/DMARC, Monitoring der Zustellrate |
| Widersprüchliche Doku | Fehlentscheidungen | Diese Roadmap und der Audit als einzige Statusquelle; Archivierung |

---

## 9. Pflege dieser Roadmap

- Fortschritt wird **nur** über abgehakte Checkboxen mit verlinktem PR oder Test gemeldet, nicht über Prozentangaben.
- Am Ende jeder Phase: Exit-Kriterium prüfen, Ergebnis im Abschnitt „Änderungsprotokoll“ festhalten, Audit-Befunde als erledigt markieren.
- Neue Befunde erhalten eine ID im Audit-Schema (`SEC-`, `BE-`, `DB-`, `FE-`, `PY-`, `CI-`, `INF-`, `REPO-`, `DOC-`, `GAME-`, `LEGAL-`).
- Empfohlen: Pro Phase ein GitHub-Milestone und pro Checkbox ein Issue mit der Befund-ID im Titel.

### Änderungsprotokoll

| Datum | Änderung |
|---|---|
| 31.10.2026 | Erstfassung auf Basis des [Production-Readiness-Audits](docs/technical/PRODUCTION_AUDIT_2026-10-31.md) |
