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
- [x] PHPCS-4-/PSR-12-Gate für `api/`, `lib/`, `config/` (BE-07) über `composer lint:php` lokal und blockierend in CI integriert. Initiale Baseline: 6 847 bestehende Verstöße (6 213 Errors / 634 Warnings), 4 999 gezählte Fingerprints in 152 Dateien. Bindung an relativen Pfad, Regel, Severity, Meldung, Spalte und Quellzeilen-Hash; keine Quelltexte in Baseline, Zeilenverschiebungen/CRLF-LF stabil. Neue Befunde, Mehrfachvorkommen und veraltete Ausnahmen scheitern; Inline-Suppressions werden ignoriert, Tool-/Report-/Baselinefehler fail-closed. 22 Regressionstests / 38 Assertions einschließlich echter PHPCS-/CLI-Läufe belegen neue und aufgelöste Verstöße sowie Suppression-Bypass-Abweisung. Keine flächige Umformatierung; Altlastenabbau und erster Remote-CI-Nachweis bleiben offen. Composer-Einstieg und Plattformanforderungen unter PHP 8.2.33, locked Dependency-Audit und Actionlint lokal bestanden.
- [x] **PHPStan Level 5** für `api/`, `lib/`, `config/`, `src/` mit PHP-8.2-Semantik und blockierendem `composer analyse` in CI eingerichtet. Aktuelle Baseline: 401 bestehende Befunde, 216 gezählte Einträge in 85 Dateien (initial 438 / 229 / 88); neue Befunde und veraltete Baseline-Einträge schlagen fehl. Lokaler Lauf sauber gegen Baseline; absichtlicher neuer Return-Type-Fehler wurde mit Exit 1 abgewiesen und danach entfernt. Erster Remote-Nachweis und weiterer Abbau der Baseline bleiben offen.
- [x] Drei durch PHPStan aufgedeckte Syntaxblocker gezielt korrigiert: zusätzliche Switch-Klammer im LLM-Endpoint, JavaScript-artiges leeres Objekt im TRELLIS2-Asset-Manager und unzulässiger Heredoc-Ausdruck im TRELLIS2-Generator. Leere Metadaten bleiben als JSON-Objekt kodiert.
- [x] Sechs nicht existierende PHP-`String()`-Aufrufe in vier Alliance-Schreibaktionen entfernt: Erstellen, Rollenvergabe, Beziehungen und Nachrichten verwenden den vorhandenen JSON-Helper und explizite String-Prüfung mit HTTP 400 für Zahlen/Booleans/Arrays. Trimming, Rollen-Normalisierung, bestehende Längen-/Enum-Grenzen und Berechtigungsprüfungen erhalten. 50 Regressionstests / 137 Assertions laden die tatsächlichen Handler ohne HTTP-Dispatch; Persistenz auf SQLite, MySQL-Relation-Upsert über PDO-Mock geprüft (kein neuer MySQL-/HTTP-E2E-Nachweis). Aufgelösten Baseline-Eintrag gezielt entfernt, PHPStan sauber.
- [x] Fünf undefinierte `json_err()`-Aufrufe der Model-Descriptor-API durch vorhandenes `json_error()` mit expliziten HTTP-Statuscodes ersetzt; fehlgeschlagener Dateiread liefert HTTP 500 statt Weiterverarbeitung von `false`. 19 Regressionstests / 95 Assertions prüfen echte Endpoint-Exitpfade und JSON-Response-Helper in isolierten PHP-Prozessen: neun Fehlerfälle sowie byte-identische Ausgabe aller zehn erlaubten Deskriptoren. Auth-/Methoden- und Dateisystemfehler werden im Test simuliert; HTTP-E2E bleibt offen. Aufgelösten Baseline-Eintrag gezielt entfernt.
- [x] Beide Diplomatie-Dispatcher repariert: 15 undefinierte `json_out()`-Aufrufe durch vorhandene JSON-Helper ersetzt. Handler-Payloads einschließlich bestehender Validierungsantworten mit HTTP 200 unverändert; unbekannte Aktionen liefern explizit HTTP 400. Verbindungs-/Queryfehler werden als `PDOException` protokolliert und liefern generisches HTTP 500 ohne SQL-Details; Programmierfehler werden nicht mehr pauschal als normale Antwort abgefangen. 18 Regressionstests / 61 Assertions prüfen tatsächliche Handler und Dispatcher in isolierten Namespaces, SQLite-Listen mit User-/Faction-Scope und JSON-Decoding, Katalog, Trust/Threat, alle Schreibaktionen auf ihrem frühen Validierungspfad sowie Verbindungs-/Queryfehler. Erfolgreiche MySQL-Schreibabläufe und HTTP-/Auth-/CSRF-E2E bleiben offen; zwei aufgelöste Baseline-Einträge gezielt entfernt.
- [x] Cache-Aufrufvertrag für Faction-Relationships und Conflict-Prediction korrigiert: Leseaufrufe erhalten nur Scope und Benutzerparameter, TTL bleibt unverändert beim Schreiben. PHP ignorierte das überzählige Argument bisher zur Laufzeit; keine neue Cache-Semantik. Sieben Regressionstests / 56 Assertions führen tatsächliche Endpoint-Zweige, Conflict-Prediction und Datei-Cache-Funktionen in isolierten Namespaces mit kontrollierter Uhr und temporärem Cache-Verzeichnis aus. Treffer/Miss, TTL von 300 Sekunden inklusive Ablauf, Benutzer-/Aktionsschlüssel und gecachte leere Ergebnisse geprüft; Testdateien werden bereinigt. APCu und HTTP-E2E nicht geprüft. Einen aufgelösten Baseline-Eintrag mit zwei Befunden gezielt entfernt.
- [x] Zwei globale Admin-Handlernamen disambiguiert: `trellis_admin_get_stats()` statt `getStats()` und `admin_users_handle_list()` statt `handle_list()`, inklusive Routing-Aufrufen. Gleichnamige Funktionen anderer Endpoints hatten falsche PHPStan-Argumentbefunde verursacht; keine Laufzeitargumente oder HTTP-Routen geändert. Vier Regressionstests / 31 Assertions prüfen tatsächliche Handler: SQLite-Benutzerliste mit Deleted-Filter, Suche, Pagination und numerischen Feldern; Statistikberechnungen über sieben PDO-Mock-Ergebnisse; Routing-Verweise geprüft. HTTP-/Admin-Auth-E2E und echte MySQL-Statistikqueries bleiben offen. Zwei aufgelöste Baseline-Einträge gezielt entfernt.
- [x] Fatalen Seed-Aufruf in AI-PBR-Batchgenerierung korrigiert: vorhandene private Hash-Methode über `$this` statt nicht existierender globaler Funktion aufgerufen. Vier Regressionstests / 46 Assertions laden die tatsächliche Serviceklasse ohne Endpoint-Dispatch; nur Einzelgenerierung und Wartezeit werden ersetzt. Alle vier Maps, unveränderte CRC32-Seedableitung, Determinismus, Descriptor-/Größenweitergabe, Teilfehler und vollständiger Fehlschlag geprüft. Zwei aufgelöste Baseline-Einträge (undefinierte Funktion und zuvor ungenutzte Methode) entfernt; PHPStan sauber. Keine echte ComfyUI-Generierung oder HTTP-E2E.
- [x] Fehlende AI-Texture-Status-/Queue-Handler ergänzt, nur GET erlaubt. Monitoring verwendet vorhandene JSON-Helper und fünf Sekunden HTTP-Timeout; Transport-/JSON-/Schemafehler werden protokolliert und liefern generisches HTTP 503 statt erfolgreicher Leerantworten. ComfyUI-`queue_pending`/`queue_running` werden ohne Jobverlust auf `pending`/`running` abgebildet; beide Felder sind Listen, auch bei leerer Queue. Status verlangt `system` und `devices`. 21 Regressionstests / 143 Assertions führen tatsächliche Handler und Service mit simuliertem HTTP aus: gültige Statistiken/Jobs, leere Queue, ungültige JSON-/Feldformen, Unerreichbarkeit und Methodenprüfung. Zwei aufgelöste Baseline-Einträge entfernt; echte ComfyUI-/HTTP-/Auth-E2E bleiben offen.
- [x] AI-Texture-Cache-Schlüsselbildung repariert: nicht existierende PHP-Konstante `JSON_SORT_KEYS` durch rekursive Sortierung assoziativer Array-Schlüssel ersetzt, Listenreihenfolge erhalten; JSON-Encoding wirft bei ungültigen Daten statt einen ungültigen Schlüssel zu bilden. SHA256/Dateipfade unverändert, keine Cache-Dateien gelöscht. Fünf Regressionstests / 16 Assertions prüfen exakten Hash, Schlüsselreihenfolge auf mehreren Ebenen, Parameter-/Typunterschiede, ungültiges UTF-8 und tatsächlichen `generateTexture()`-Cache-Treffer mit temporärer Datei (ohne Netzwerk). Aufgelösten Baseline-Eintrag entfernt; echte Generierung, Bildvalidierung und HTTP-E2E bleiben offen.
- [x] Progressiven AI-Texture-Pfad zwischen PHP und Frontend repariert: High-Res-Phase erzeugt Zielauflösung und liefert `high_res.path` ohne weitere Upgrade-URL; Low-Res-Größe ist ganzzahlig, Zielgröße 128–1024 und Phase explizit validiert. Upgrade-URL bewahrt Seed 0 und Descriptorparameter. Frontend lädt zuerst High-Res-JSON, danach den Bildpfad statt JSON als Bild; Timeout wird bereinigt, Fehler erzeugen kein Upgrade-Event. 13 PHP-Regressionstests / 57 Assertions und neun Tests des tatsächlichen JS-Managers prüfen beide Phasen, Größen-/Fehlergrenzen, Bildladen und Events mit simuliertem Backend. PHPStan-Baseline unverändert; echte ComfyUI-/Browser-E2E bleiben offen.
- [x] Größerer AI-Texture-Generierungsblock umgesetzt: gültige Basis-Node-Verknüpfungen und `prompt`-Envelope für ComfyUI, exakter konfigurierbarer Checkpoint; serverseitige Settings und normalisierte Größe können nicht mehr durch Descriptorfelder überschrieben werden. History-Fehler/fehlende Bilder explizit behandelt; Download erhält Subfolder/Type, lokaler Prompt-ID-Pfad gehasht und PNG-Metadaten vor Veröffentlichung geprüft. Lock-Öffnungsfehler stoppen vor HTTP, Handles schließen in `finally`; deaktivierte Disk-Wiederverwendung respektiert, internes ETag-`exit` entfernt, damit Batch-/Progressive-JSON nicht abbricht. Initial 17 Tests / 89 Assertions prüften tatsächliche Service-Methoden mit simuliertem HTTP und isolierten Dateien, einschließlich erfolgreicher Pipeline, Cache-Treffer, Fehlern und begrenztem Polling; Folgeblock erweitert diese Abdeckung. Dokumentation korrigiert unbelegte Memory-Cache-/Global-Concurrency-Aussagen. Kein Live-GPU-/ControlNet-/PBR-Qualitätsnachweis; globale Queue-Limits bleiben offen. Zwei redundante Typbefunde gezielt aus Baseline entfernt.
- [x] Folgeblock für AI-Texture-Ressourcenbegrenzung und Veröffentlichung: alle vier HTTP-Lesepfade auf begrenzten gemeinsamen Reader umgestellt (JSON maximal 1 MiB, PNG maximal 16 MiB; höchstens Limit + 1 Byte gelesen). Neue PNGs vor GD-Dekodierung auf maximal 1024 × 1024 begrenzt; Header-only/trunkierte Bilder nicht als Cache-Erfolg veröffentlicht. Vollständige Schreibmenge geprüft, partielle/fehlgeschlagen veröffentlichte temporäre Dateien bereinigt; Locks bleiben freigegeben. Elf weitere Regressionstests sowie zusätzliche Vertragsassertions prüfen exakte Byte-/Dimensionsgrenzen, Übergrößen, echtes begrenztes Stream-Lesen, Monitoring-Fehler, partielles Schreiben und fehlgeschlagene Veröffentlichung. Baseline unverändert. Bestehende Cache-Dateien nicht rückwirkend validiert; globale Admission-Control, Gesamtdeadline und Live-GPU-/Browser-E2E bleiben offen.
- [ ] PHPUnit gegen MySQL 8 mit Migration über `MigrationRunner` (DB-02); Ergebnis der 29 Defekte im Cache klären
- [x] MySQL-DDL-Implicit-Commit-Fehler im `MigrationRunner` für Up/Down behoben: Commit/Rollback nur bei aktiver Transaktion, ursprüngliche SQL-Fehler bleiben erhalten, Warnung bei möglichen Teiländerungen. 8 isolierte MySQL-8.4-Regressionstests mit 50 Assertions bestanden; reine InnoDB-DML bleibt transaktional. CI führt diesen Runner-Gate vor der Schema-Initialisierung aus; Remote-Nachweis offen.
- [x] Alle 84 MariaDB-spezifischen bedingten ALTER-Operationen im kanonischen Manifest in sechs SQL-Dateien auf bestehendes `information_schema`-/`PREPARE`-Muster umgestellt. Spalten, Indizes und Constraints einzeln abgesichert; echte SQL-Guards gegen MySQL 8.4 auf teilangewandten Schemas und bei Wiederholung geprüft, inklusive Definitionen/Defaults/Kommentaren/Indizes. Neuer Unit-Gate verhindert erneute inkompatible ALTER-Syntax; keine zusätzliche Runner-Umschreibeschicht.
- [x] Legacy-v2-Backfills an aktuelle Baseline angepasst: planetenbasierte Besitz-/Ressourcenübernahme und Building-/Ship-/Fleet-Verknüpfungen nur bei vorhandenen Legacy-Quellspalten; aktuelle Colony-Identitäten unverändert. Vollständige v2-Migration gegen echtes `schema.sql` erfolgreich, Legacy-Datenübernahme inklusive Wiederholung geprüft. Zwei TEXT-Defaults auf MySQL-Ausdruckssyntax korrigiert; Colony-Buildings-FK auf signed `colonies.id` abgestimmt und Update-/Delete-Cascades getestet.
- [x] Unified-Bodies-Hardcut für aktuelle und Legacy-Reports korrigiert: Battle-/Spy-Backfills nur bei vorhandenen alten Quellspalten, bestehende Body-IDs bleiben unverändert; neue Spy-Body-Spalte benötigt kein `target_planet_id` als Positionsanker. Vier echte MySQL-Testfälle decken Legacy-Daten, aktuelle Report-Identitäten, fehlende Zielspalten, Wiederholung und vollständiges aktuelles Basisschema ab.
- [x] NPC-FTL-Migration und betroffene Runtime-Abfragen auf kanonische `npc_faction_memberships` umgestellt. Voraussetzung in v12 mit identischem späterem Homeworld-DDL bereitgestellt, Manifestreihenfolge unverändert. NPC-Antriebszuweisung inklusive PvE-Aliassen, menschlicher Accounts, vorhandener Antriebe und fehlender Mitgliedschaft gegen MySQL getestet; Runtime verdeckt Fehler der primären Mitgliedschaftsabfrage nicht mehr.
- [x] Marketplace-/Advisor-Migration konsolidiert: doppelte SQL-Blöcke und Stored Procedure mit internen Semikolons/Client-DELIMITER entfernt; acht Leader-Spalten einzeln mit bestehenden `information_schema`-Guards abgesichert. Echte MySQL-Tests prüfen teilvorhandene Spalten, Advisor-Rolle, Profil-/Marketplace-/Hint-Datenerhalt und Wiederholung.
- [x] Projection-Timestamps unter MySQL Strict Mode korrigiert: Zero-Date-Vergleich als String, historische `enqueued_at`-Werte bei neu angelegtem `created_at` übernommen; gültige vorhandene Zeitstempel bleiben bei Wiederholung erhalten. Zwei MySQL-Testfälle prüfen neue/teilmigrierte Spalten inklusive NULL-/Legacy-Zero-Date-Werten, ohne SQL-Mode im Migrationslauf abzuschwächen.
- [x] Runner-Splitter unterstützt Backslash-escaped SQL-Strings; nativer PDO-Prepare-Modus in allen MySQL-Regressionstests aktiviert. Speziesmigration mit sechs korrekten Namen und Statement-Grenzen getestet. Drei World-Scenario-TEXT-Defaults auf MySQL-Ausdruckssyntax korrigiert.
- [x] Update-System auf tatsächliche Actor-Tabelle `users` abgestimmt; Konfigurations-Seeds überschreiben bestehende Werte bei Wiederholung nicht mehr. MySQL-Test prüft Wert-Erhalt sowie `ON DELETE SET NULL` für Admin-Auditreferenzen.
- [x] Vollständiges aktuelles Fresh-Install-Manifest lokal validiert: alle 64 Migrationen / 1 039 Statements auf isoliertem MySQL 8.4 mit nativen PDO-Prepares erfolgreich. Echter CLI-Lauf mit schema-beschränkten Zugangsdaten und zweiter No-op-Lauf geprüft; Status 64 angewandt / 0 offen. Dauerhafter Fresh-Install-Test prüft Manifestreihenfolge, Checksummen, Umgebung und Wiederholung. CI-Wildcard-SQL-Schleife durch kanonischen Runner ersetzt; Remote-Nachweis sowie befüllte Legacy-Upgrades und Runtime-Schema-Vollständigkeit bleiben offen.
- [x] AI-Texture-Admission und Zeitbudget implementiert: `COMFYUI_MAX_CONCURRENT` (1–16, Default 2) begrenzt Generierungen über nichtblockierende Slot-Dateilocks im gemeinsam genutzten Lock-Verzeichnis. Belegter Descriptor/volle Slots scheitern vor HTTP; Cache-Treffer benötigen keinen Slot; Ressourcen schließen in `finally`. `COMFYUI_QUEUE_TIMEOUT` (1–600, Default 120 Sekunden) steuert monotones Budget pro Textur, reduziert HTTP-Timeouts auf Restzeit und begrenzt Pollingwartezeiten; Deadline vor Veröffentlichung erneut geprüft. Ungültige Konfiguration wird explizit abgewiesen und Initialisierungsfehler generisch als HTTP 500 mit internem Log ausgegeben. Zwölf Regressionstests prüfen Kapazität, Wiederverwendung/Freigabe, Restzeit nach HTTP/Polling/Download, Descriptor-Kollision und ungültige Settings. Keine harte Prozess-/DNS-/CPU-Deadline, keine Backend-Cancellation; Batch-Budget pro Map, Slot-Limit nur für Prozesse mit identischem Verzeichnis/Config. Verteilte Queue und Live-Lasttest bleiben offen.
- [x] AI-Texture-Protokollgrenzen gehärtet: explizites `COMFYUI_ENABLED=0` bleibt auch in Dev deaktiviert. JSON-Wurzeln müssen Objekte sein; ungültige Submission-/History-/Status-/Output-/Bildmetadaten einschließlich expliziter Nullwerte scheitern mit internem Log und generischem Clientfehler statt Typfehlern oder stillen Polling-Schleifen. Fehlende History-Jobs bleiben legitimer Pending-Zustand. Gemeinsamer HTTP-Reader folgt keinen Redirects und weist finale Nicht-2xx-Statuscodes ab. 37 weitere Tests prüfen Fehlerschemata, neun Flag-/Environment-Kombinationen und echte Loopback-HTTP-Streams für 200/302/503; Kapazitätslocks bleiben bei Fehlern frei. Keine vollständige Host-Allowlist oder Live-GPU-/Browser-Abnahme; Baseline unverändert.
- [ ] Separater PHPUnit-Unit-Gate ohne MySQL-Initialisierung in CI ergänzt. Lokal mit PHP 8.2.33/PHPUnit 11.5.55 nach API-/Admin-/Texture-/PHPCS-/Migrations-/Dry-Run-Fixes: 1 002 Unit-Tests, 4 865 Assertions, keine Fehler/Failures oder PHPUnit-Deprecations. Aktueller fokussierter MySQL-8.4-Gate: 14 Tests / 105 Assertions für Vorschau, Berechtigungen, Locks, Integrität und Rollback-Barrieren bestanden. Letzter vollständiger MySQL-Migrationsgate vor Dry-Run-Block inklusive Fresh-Install: 49 Tests / 1 079 Assertions bestanden. Letzte Gesamtsuite vor diesen API-Fixes: 716 Tests, 3 651 Assertions, 2 Skips. Läufe bestehen mit `--fail-on-warning --fail-on-risky --fail-on-phpunit-deprecation`; erster Remote-CI-Nachweis steht aus.
- [x] Alle 67 PHPUnit-Doc-comment-Metadata-Deprecations behoben: 24 Data-Provider-Marker auf PHP-Attribute migriert und 43 redundante `@test`-Marker entfernt. Test- und Assertion-Anzahlen bleiben unverändert; Unit- und MySQL-CI-Jobs blockieren neue PHPUnit-Deprecations.
- [x] Vitest 5 mit 3 412 bestandenen Tests und Vite 8.3.5 mit blockierendem Produktionsbuild ohne Source-Maps; `npm ci` reproduzierbar
- [x] Node 24 in `.nvmrc` festgelegt und in den Node-Workflows verwendet
- [x] Minifizierter JS-Chunk maximal 1,25 MiB und gesamte JS-Ausgabe maximal 650 KiB gzip (FE-01); aktueller Build: Core 1,11 MiB, alle JS-Chunks 594 KiB gzip
- [x] E2E-Port-Mismatch 8080/8081 korrigiert
- [ ] E2E (Playwright) gegen schlanken CI-Stack ohne KI-Dienste (Workflow nutzt jetzt den Compose-CI-Override; erster CI-Lauf zur Verifikation steht aus)
- [x] CI-Smoke-Stack isoliert und auf Build-Artefakt umgestellt: Override entfernt feste Web-/DB-Container-Namen und Web-Checkout-Mount; DB veröffentlicht keinen Host-Port und importiert nur Basisschema statt Legacy-Migrationsliste. Workflow vergibt Projekt-ID pro Run/Attempt, führt kanonische Migrationen (Up, zweiter Up, Status) im gebauten Image vor User-Seed/E2E aus, erfasst Fehlerlogs und entfernt eigenes Projekt/Volumes immer. Expliziter Dev-Testmodus, AI-/ThemisDB-/Xdebug-Flags aus; Web-HTTP-Liveness und MySQL-TCP-Probe (kein vorzeitiger Socket-Init-Erfolg). Dockerfile veröffentlicht Vite-Index/gehashte Assets im Apache-Root statt ungenutztem dist-Build. Seed-Option --skip-bootstrap erhält Schema-/Faction-/Diplomatie-Preflight und Startregion, spart erzwungenen 25.000-System-Bootstrap; bisheriges Default-Verhalten erhalten. Sieben neue Tests prüfen tatsächliches Compose-JSON, Workflow und Artefaktveröffentlichung; mit Docker-Kontext-/Publish-Regressionen 21 Tests und Actionlint lokal bestanden. Echte lokale Abnahme: Image gebaut, gehashte JS über Apache geladen, frische MySQL-DB mit 64 Migrationen/0 Pending nach zweitem Up, 50 Startregion-Systeme, Chromium 2 bestanden/1 Runtime-Test übersprungen; Hauptpfad nutzt System-Fallback und meldet fehlende WebGPU/Runtime-Abhängigkeiten. Testcontainer/-Netz/-Volume/-Image entfernt. Remote-CI/strict native/GPU/Produktion weiterhin offen; Compose 2.24.4+ nötig, Web-Port 8081 nur für isolierte Runner, Liveness kein umfassendes Readiness-Gate.
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
- [ ] Repository-Artefakt-Gate: [`npm run check:repository-artifacts`](scripts/check_repository_artifacts.mjs) und CI-Anbindung implementiert; blockiert getrackte Texture-Cache-PNGs/Lockfiles und Git-Blobs > 100 MiB. [7 lokale Regressionstests](tests/js/repository-artifacts.test.js) bestanden, inklusive exakt 100 MiB / ein Byte darüber; erster CI-Nachweis steht aus.
- [ ] `js/**/*.gz` erst nach Migration des Boot-Loaders entfernen: Die komprimierten Bundles werden derzeit vom Boot-System geladen und durch `.htaccess` mit `Content-Encoding: gzip` ausgeliefert ([Boot-System](docs/technical/BOOT_SYSTEM_ARCHITECTURE.md), [`.htaccess`](.htaccess))
- [ ] Die 22 verbleibenden GLB-Dateien auf Runtime-/Testbedarf prüfen und nicht benötigte generierte Assets auslagern; größtes getracktes GLB aktuell ca. 10 MiB
- [ ] Root aufräumen: Snapshot- und Statusdokumente nach `docs/archive/`; Root enthält nur Einstiegsdateien
- [x] Falsche README-Aussagen „No build step“ und „Tick-free“ korrigiert
- [x] README mit dieser Roadmap verlinkt
- [ ] Veraltete Statusangaben entfernen
- [x] `SECURITY.md` mit privatem Meldeweg und `CONTRIBUTING.md` mit Branching, PR-Regeln und den real verfügbaren Quality Gates; im Index verlinkt
- [x] Release-Metadaten-Fundament: `npm run check:release-metadata` prüft SemVer aus `VERSION.txt` und exakte Package-/Lock-Mirrors in CI. Tag-Prüfung verlangt `v<version>`, eindeutig datierte Changelog-Sektion mit echten Change-Bullets; keine Placeholder-/Duplikat-/ungültigen Datums- oder Versionsfreigaben. Read-only Workflow für Tag-Push/manuellen existierenden Tag prüft Checkout-Commit und bereitet ausschließlich validierte Release-Notizen als Artefakt vor, ohne Veröffentlichung/Deployment. Historisches `1.0.0` unverändert und nicht als Release/Produktionsreife umgedeutet. 46 Regressionstests prüfen SemVer-/Taggrenzen, Mirror-Drift, Notizextraktion und echte CLI-Fehlerpfade; lokaler Metadatengate, explizite Abweisung des unvorbereiteten `v1.0.0`, Node-Syntax und Actionlint bestanden. Kein Remote-/Publishing-Nachweis.
- [ ] Vollständige Versionierung/Release-Freigabe: Runtime-Overrides/Fallbacks der Update-Helfer auf sichere zentrale Versionsquelle umstellen; geprüfte Git-Tags, Changelog pro tatsächlichem Release, blockierende vollständige Quality-/Security-Gates auf Tag-Commit, Produktionspackaging und Release-/Staging-/Publishing-Workflow. Metadatenvorbereitung allein ist kein Release-Nachweis; erste Remote-Ausführung offen.

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
- [x] Datenbankweiter Advisory-Lock (`GET_LOCK`, Timeout 0) im `MigrationRunner`: Bootstrap, gesamter Up-/Rollback-Lauf und Dry-Runs vor Tracking-DDL/Status-Snapshot gesperrt; Lock-ID unabhängig von Manifest/Environment, DB-spezifisch. Besitz bleibt über DDL-Implicit-Commits erhalten, Freigabe in `finally`; bei Cleanupfehler ursprüngliche Exception erhalten und Fehler protokolliert, nach sonstigem Erfolg Freigabefehler nicht verschluckt. Aktive Caller-Transaktionen und fehlende DB-Auswahl explizit abgewiesen. Elf zusätzliche echte MySQL-Regressionstests / 78 Assertions prüfen konkurrierende Verbindungen, keine Änderungen bei belegtem Lock, Besitz über DDL/Rollback, Freigabe nach Bootstrap-/SQL-Fehlern und DB-Isolation; acht Unit-Tests / 50 Assertions für Lock-/Release-Fehlerpfade. SQLite-Testverhalten erhalten, PHPStan-/PHPCS-Baselines unverändert. Keine Absicherung unabhängiger DB-Server, alter Migrationspfade oder externen SQLs.
- [ ] Irreversible Migrationen explizit kennzeichnen und Recovery-/Restore-Vorgehen pro Migration dokumentieren
- [x] Echte schreibfreie Up-/Rollback-Vorschau auf frischer DB: fehlende Tracking-Tabelle als leere Historie behandelt, keine Bootstrap-DDL oder Migrations-SQL ausgeführt; Advisory-Lock bleibt aktiv. Tabellenprobe bootstrapped ausschließlich bei spezifischem Missing-Table-Code; Rechtefehler, Verbindungsabbrüche und sonstige SQL-Fehler propagieren unverändert. Acht zusätzliche Unit-Tests / 24 Assertions prüfen frische Vorschau, normales Bootstrap und sechs Fehlerklassen in beiden Modi; zwei zusätzliche echte MySQL-Tests mit ungültigem Bootstrap-SQL und CREATE-only-Testkonto prüfen keine Tabellenänderungen, originalen SELECT-Fehler 1142 und Lock-Freigabe. Fokussierter MySQL-Gate mit eng gekoppelten Regressionen bestanden; Baselines unverändert. Explizites Bootstrap und CLI-Status können weiterhin Tracking-DDL ausführen; kein neuer vollständiger MySQL-/Restore-Nachweis.
- [x] Rollback-Barrieren fail-closed: alle ausgewählten Down-Dateien vor erstem Rollback-SQL unter Advisory-Lock geprüft. Fehlender Companion blockiert den gesamten ausgewählten Bereich (`no_down_file` erhalten), statt irreversibles neueres Schema zu überspringen oder zunächst jüngere Migrationen zurückzunehmen. Ungültige/unlesbare Companion-Pfade scheitern vor Änderungen; ungewählte ältere Grenzen blockieren einen zulässigen Step-Rollback nicht. CLI meldet Barriere und unbekannte Ergebnisstatus als Exit 1, auch im Dry-Run, ohne Erfolgszusammenfassung. Elf zusätzliche Unit-/CLI-Tests / 50 Assertions und zwei echte MySQL-Fälle prüfen unveränderte Daten/Tracking, Barrierenpositionen, Dry-Run und Lock-Freigabe sowie erfolgreichen mehrstufigen DDL-Rollback nach Ergänzung beider Companions. Keine Garantie semantischer Reversibilität oder atomarer DDL-Recovery; explizite Recovery-Inventarisierung bleibt offen.
- [x] Migrations-CLI fail-closed: unbekannte/zusätzliche Argumente, doppelte Optionen, ungültige/überlaufende Schrittzahlen, wirkungslose Statusoptionen, unzulässige Environment-Labels und fehlende SQL-Verzeichnisse scheitern vor DB-Konfiguration/-Zugriff. `--help` benötigt keine DB; gültige Optionen/Defaults erhalten. Direkte Runner-Aufrufe weisen nichtpositive Schritte ebenfalls ab. Erwartete Verbindungs-/Manifest-/Lock-/Integritäts-/SQL-Fehler gehen kontrolliert auf stderr mit Exit 1 statt unhandled Fatal oder Erfolgszusammenfassung. 35 Subprozess-Tests des tatsächlichen CLI mit isolierten DB-/Runner-Fixtures plus vier Runner-Tests (130 zusätzliche Assertions) prüfen Validierung, Routing und Fehlerausgabe. Reales Offline-CLI für Preview-Tippfehler und Help geprüft; keine neue MySQL-Vollabnahme dieses Blocks. Baselines unverändert.
- [x] Migrationsintegritäts-Preflight unter Advisory-Lock: Up/Rollback einschließlich Dry-Run/No-op prüft alle manifestgelisteten angewendeten Forward-Dateien gegen gespeicherte MD5-Bytes. Fehlende/unlesbare/geänderte Dateien stoppen vor Migrations-SQL; alle ausgewählten Pending-Dateien vor erster Ausführung auf Lesbarkeit geprüft. Manifest-Konstruktor verwirft Nichtlisten, Duplikate/Case-Kollisionen, Pfade, falsche Extensions und Down-Dateien. 22 weitere SQLite-/Unit-Tests / 42 Assertions sowie sechs echte MySQL-Tests / 29 Assertions prüfen Formen, Drift/Removal, unveränderte Daten/Tracking und Lock-Freigabe. Testhelfer zum SQL-Einlesen seiteneffektfrei gemacht statt Prüfsummen zu umgehen. Baselines unverändert. Exakte Bytes inklusive Zeilenenden, kein Authentizitätsnachweis; alte angewendete SQL-Korrekturen benötigen Original-Release plus reviewed append-only Upgrade statt automatischer Checksum-Rewrites. Status-Snapshot, manifestfremde Historie, Rollback-Companion-Checksums und Produktions-Restore bleiben offen.
- [x] Schreibfreies Deployment-Integritätsgate `migrate.php verify`: vorhandene lesbare Tracking-Tabelle, vollständig angewendetes Manifest, exakte gespeicherte Forward-MD5 und keine manifestfremde Historie erforderlich. Gemeinsamer Advisory-Lock/Checksum-Helper; keine Bootstrap-DDL, SQL-Ausführung, Checksum-Reparatur oder Historienlöschung. Fremde neuere Migrationen blockieren auch ältere Image-Manifeste; reviewed Kompatibilitäts-/Recoveryverfahren statt automatischem Downgrade nötig. CLI verwirft Step/Preview vor DB-Zugriff, Erfolg erst nach vollständiger Prüfung; CI Verify im gebauten Image nach Up/zweitem Up/Status vor Readiness/Seed. 17 zusätzliche Unit-/CLI-Fälle, fokussiert 119 Tests/421 Assertions; sechs zusätzliche reale MySQL-Fälle, fokussiert inklusive 64-Migrations-Freshinstall 16 Tests/366 Assertions. SELECT-only-Konto reicht, verweigerter SELECT propagiert; unveränderte Daten/Tracking, konkurrierender Lock, Caller-Transaktion und Lock-Freigabe geprüft. PHPCS/PHPStan-Baselines unverändert. Status und öffentliche Readiness bleiben absichtlich Snapshots ohne diese Prüfung; kein Schema-Diff, Down-Hash, Authentizitäts-, Backup-/Restore- oder Remote-Produktionsnachweis.
- [ ] Alle 33 Laufzeit-DDL-Statements in Migrationen verlagern; App-DB-User ohne DDL-Rechte
- [x] Destruktiven Ship-Designer-Initializer deaktiviert: `api/_init_tables.php` und `sql/init_ship_designer.sql` führten bisher `DROP TABLE` für Nutzerdaten aus, erzeugten MyISAM bzw. widersprüchliche Legacy-Spalten und standen außerhalb des kanonischen Migrationspfads. PHP-CLI und direktes SQL brechen nun fail-closed vor Änderungen ab; tatsächlicher MySQL-Test erhält bestehende Definitionen und alle drei befüllten Tabellen. Gesamt-Unit-Gate 1.236 Tests/6.330 Assertions, zusätzlicher MySQL-Fall 9 Assertions; PHPStan und Append-only-History/Release-Gates grün. Fünf ausschließlich erledigte PHPCS-Fingerprints entfernt; keine neuen Ausnahmen. Setup-/Ship-Designer-Dokumentation korrigiert. Feature-Persistenz bleibt bis zu einer reviewed kanonischen Schema-Migration und API-/Worker-Akzeptanz deaktiviert; keine vorhandenen Feature-Endpunkte oder Tabellenmigrationen behauptet.
- [x] Stern-/Binärschema aus Runtime-DDL gelöst: zwei Galaxy-Seed-Helper verwenden nur Metadatenprüfung, statt 18 bedingten ADDs, Spectral-MODIFY und Binary-CREATE (20 DDL-Codepfade). Historische Base/v2 liefern bestehende Spalten/Tabellen; neue append-only Migration `migrate_star_spectral_wd_v1.sql` ergänzt fehlendes WD-Enum, ohne alte SQL/Checksums zu ändern. Fehlendes Schema/WD meldet Migrationsbedarf, Rechtefehler propagieren; kein globaler Done-Cache über DB-Verbindungen. Legacy-Setup und Registration-/Homeworld-Testfixtures ergänzt. Sechs neue Unit-Tests/34 Assertions; echte MySQL-Tests erhalten Star-Daten, erlauben WD-Inserts, prüfen tatsächliche Runtime-Helper mit SELECT-only, missing Binary/outdated Enum ohne Reparatur. Canonical-Freshinstall jetzt 65 Migrationen/1.040 Statements, Verify/zweiter Up grün; fokussiert 3 MySQL-Tests/280 Assertions. Vollständige PHP-Unit-Suite 1.047 Tests/5.040 Assertions bestanden, PHPStan sauber. Zehn ausschließlich erledigte PHPCS-Fingerprints entfernt (6.837 Verstöße/4.989 Fingerprints, keine neuen Freigaben). Echter Image-Build/Startregion/9 HTTP-Tests erfolgreich, Chromium 2 bestanden/1 übersprungen mit System-Fallback. Kein Down wegen möglicher WD-Datentrunkierung; reviewed Backup/kompatibles Rollback nötig, Custom-Enum/Large-Table-DDL separat prüfen. Andere Planet-/Faction-/Diplomatie-DDL und gesamter DDL-freier App-User/Schema-Diff bleiben offen.
- [x] Append-only-Git-Gate vor DB-Deployment: `npm run check:migration-history -- --base <ancestor>` verlangt historischen Manifest-Prefix unverändert und bestehende Forward-SQL-Git-Clean-Blobs bytegleich; neue Dateien nur am Ende, lesbar/regulär, keine Symlinks/Directories. Deklarativen PHP-Manifest-Subset ohne Ausführung geparst, ungültige Formen/Baselines/fehlende Dateien/History-Umschreibungen fail-closed. CI lint-js holt vollständige Historie und verwendet PR-Base bzw. Push-before; neuer Branch mit Zero-before gegen Mergebase der Remote-Defaultbranch, fehlende Historie/Nonancestor-Forcepush nicht stillschweigend akzeptiert. 47 Tests mit echten isolierten Git-Repositories, CLI und Workflow prüfen committed/staged/uncommitted Drift, Removal/Reorder, Case-Kollisionen, fehlende Dateien/Basis und Git-Zeilenendennormalisierung; zusammen mit Release-Metadaten 93 Tests lokal bestanden. Reales Repository: 64 unveränderte Forward-Dateien. Actionlint bestanden. Windows-CRLF-Checkout korrekt über Git-Clean-Identität; exakte Deployment-MD5 bleiben separates Verify-Gate. Down-Companions/Base-Schema/manifestsfremde SQL, Schema-Diff, Remote-CI und Branch-Protection offen; keine Commit-/DB-/Index-Änderungen durch Gate.
- [x] Planet-Science aus Runtime-DDL gelöst: elf ALTER-Codepfade durch schreibfreie Metadatenprüfung ersetzt, ohne globalen Done-Cache. Append-only `migrate_planet_science_v1.sql` ergänzt ausschließlich fehlende Spalten mit bisherigen Defaults; vorhandene Definitionen und Science-Daten bleiben erhalten, Legacy-Setup ergänzt. Fehlendes Schema meldet Migrationsbedarf; keine automatische Reparatur. Drei zusätzliche Unit-Fälle (Schema-Guards zusammen 9 Tests/54 Assertions), zwei echte MySQL-Legacyfälle plus kompletter Freshinstall/Verify/zweiter Up: 3 Tests/326 Assertions. Teilbefüllte und vollständig fehlende Science-Schemas, direkter Replay und tatsächlicher Runtime-Helper mit SELECT-only geprüft. Vollständige PHP-Unit-Suite 1.050 Tests/5.061 Assertions; PHPStan sauber. Fünf ausschließlich erledigte PHPCS-Fingerprints entfernt, jetzt 6.832 Verstöße/4.984 Fingerprints ohne neue Freigaben. 47 History-Gate-Tests und reales Gate mit 64 unveränderten plus zwei neuen Migrationen grün. Echter Image-Build mit 66 Migrationen/1.084 Statements, Verify, Startregion-Seed und neun HTTP-Health-Tests bestanden; Testressourcen entfernt. Rollout/Recovery dokumentiert, kein destruktiver Down-Companion. Kein vollständiger Typ-/Schema-Diff oder Browser-/GPU-/Produktionsnachweis dieses Blocks; App-State-/Faction-/Diplomacy-DDL und App-User ohne DDL-Rechte bleiben offen.
- [x] App-State aus Runtime-DDL gelöst: CREATE bei jedem State-Zugriff durch Metadatenprüfung ersetzt. Append-only `migrate_app_state_v1.sql` stellt fehlenden Legacy-Speicher bereit, erhält vorhandene Definitionen, Seed-Marker, Cooldowns und Zeitstempel; Legacy-Setup ergänzt. Fehlender/unvollständiger Speicher scheitert explizit statt Default oder Reparatur; Defaults bei fehlenden Keys/nichtnumerischen Werten und signed Integer-Upserts bleiben erhalten. Drei neue Unit-Fälle; gesamte Unit-Suite 1.053 Tests/5.082 Assertions. Zwei echte MySQL-Fälle plus vollständiger 67-Migrations-Freshinstall/Verify/No-op: 3 Tests/297 Assertions. SELECT-only-Lesen, verweigerte Writes, SELECT/INSERT/UPDATE ohne DDL, Upserts sowie aktive Transaktion/Rollback geprüft. PHPStan sauber, ein ausschließlich erledigter PHPCS-Fingerprint entfernt (6.831 Verstöße/4.983 Fingerprints); 47 History-Tests und reales Gate mit 64 unveränderten plus drei neuen Migrationen grün. Echter Image-Build/67 Migrationen/1.085 Statements, zweiter Up, Verify, Startregion-Seed und neun HTTP-Tests erfolgreich. Chromium 2 bestanden/1 übersprungen; Hauptfluss weiterhin System-Fallback, WebGPU-/Runtime-Warnungen bleiben offen. Rollout/Recovery ohne destruktiven Down dokumentiert, eigene Testressourcen entfernt. Faction-/Diplomacy-DDL, vollständiger Schema-Diff, Tick-on-Read und globaler App-User ohne DDL-Rechte bleiben offen; kein Produktions-/GPU-/Remote-CI-Nachweis.
- [x] Faction-/Diplomacy-Schema aus Runtime-DDL gelöst: letzte fünf CREATE-Codepfade in `api/galaxy_seed.php` durch Metadaten-Guards ersetzt; diese Datei enthält nun keine CREATE-/ALTER-Statements mehr. Historische Base/v2 liefern Factions/Quests unverändert; append-only `migrate_faction_government_v1.sql` ergänzt drei zuvor ausschließlich zur Laufzeit angelegte Government-/Alliance-/Standing-Tabellen mit bisherigen Defaults, Keys und CASCADE-Beziehungen, erhält bestehende Definitionen/Daten; Legacy-Setup ergänzt. Seed-DML/Done-Keys bleiben erhalten. Fünf neue Unit-Fälle prüfen fehlende Tabellen ohne Reparatur; gesamte Unit-Suite 1.058 Tests/5.125 Assertions. Vollständiger 68-Migrations-Freshinstall/Verify/zweiter Up und zwei echte MySQL-Legacy-/Seed-Fälle bestanden (letztere 2 Tests/32 Assertions): SELECT-only-Guards, DML ohne DDL-Rechte, aktive Transaktion/Rollback, geänderte Stability-/Alliance-Werte bei wiederholtem Seed und alle drei CASCADE-Pfade. PHPStan sauber; zwei erledigte PHPCS-Fingerprints entfernt (6.829 Verstöße/4.981 Fingerprints), keine neuen Ausnahmen. 47 History-Tests mit 15s lokalem Testtimeout nach einmaligem 5s-Fixture-Timeout unter paralleler Buildlast grün; reales Gate 64 unveränderte plus vier neue Migrationen. Echter Image-Build mit 68 Migrationen/1.088 Statements, No-op, Verify, Startregion-Seed und neun HTTP-Tests grün; Chromium 2 bestanden/1 übersprungen, System-Fallback/WebGPU-/Runtime-Warnungen unverändert offen. Rollout/Recovery ohne destruktiven Down dokumentiert; eigene Testressourcen entfernt. Kein vollständiger App-DDL-/Schema-Diff-/Least-Privilege-/Produktionsnachweis; Gesamtziel bleibt offen.
- [x] Bau-/Werft-Speicher aus Runtime-DDL gelöst: drei CREATEs und globale Ready-Caches in Buildings-/Shipyard-Helpern durch Metadaten-Guards ersetzt. Base-Bauqueue und Blueprint-v5-Vessels unverändert; append-only `migrate_ship_build_queue_v1.sql` ergänzt fehlende Schiffsbauqueue mit bisherigen Defaults/Indexes/Colony-CASCADE, erhält bezahlte Kosten, Mengen, laufende Aufträge und vorhandene Definitionen. Legacy-Setup ergänzt; vollständige kanonische Blueprint-Sequenz weiterhin erforderlich. Fehlendes Vessel-Schema nicht länger stillschweigend verschluckt: Completion prüft Blueprint-Vessel-Speicher vor Zähler-/Statusmutation, Spawn-Fehler propagieren. Neun zusätzliche Unit-Fälle für drei Speicher; Gesamt-Unit-Gate 1.067 Tests/5.186 Assertions. Echte MySQL-Fälle für kompletten 69-Migrations-Freshinstall/Verify/No-op, bezahlte Legacyqueue und echte Runtime-Helfer bestanden (zunächst 3 Tests/314 Assertions); erweiterter Runtime-Fall 1 Test/30 Assertions für SELECT-only-Guards, DML-only-Spawn, Transaktion/Rollback, JSON-/HP-Snapshots, echte Completion/Wiederholung ohne Doppelzählung, fehlende Vessels ohne Zähler-/Statusänderung und Colony-CASCADE. PHPStan sauber; vier ausschließlich erledigte PHPCS-Fingerprints entfernt (6.825 Verstöße/4.977 Fingerprints), keine neuen Ausnahmen. 47 History-Tests mit lokalem 15s-Timeout grün, reales Gate 64 unveränderte plus fünf neue Migrationen. Echter Image-Build/69 Migrationen/1.089 Statements, zweiter Up, Verify, Seed und neun HTTP-Tests bestanden; Chromium 2 bestanden/1 übersprungen, System-Fallback/WebGPU-/Runtime-Warnungen bleiben offen. Rollout/Recovery ohne destruktiven Down dokumentiert; eigene Ressourcen entfernt. Keine vollständige Completion-Atomarität/Konkurrenzabsicherung, kein App-DDL-frei-/Schema-Diff-/Produktionsnachweis.
- [x] Account-/Homeworld-Speicher schreibfrei geprüft: drei CREATE-Codepfade in Auth-/Character-Profile-Helpern durch Metadaten-Guards für Ships, Messages und Profiles ersetzt. Kanonische Base/v2 liefern Speicher bereits; keine neue Migration und keine historischen SQL-Änderungen. Fehlendes/unvollständiges Schema scheitert vor Generierung/Dateischreiben/Fallback; vorhandene Profile mit gespeicherten JSON-/YAML-Referenzen bleiben unverändert und mit SELECT-only lesbar. Fünf zusätzliche Unit-Fälle (fehlende Homeworld-Tabellen, Profile-Spalten/DB-Isolation); Gesamt-Unit-Gate 1.072 Tests/5.221 Assertions. Vollständiger unveränderter 69-Migrations-Freshinstall/Verify/No-op plus tatsächliche Account-Helper auf befülltem Schema: 2 echte MySQL-Tests/301 Assertions, Datenerhalt, aktive Transaktion und fehlende Tabellen/Spalte ohne Reparatur geprüft. Legacy-Auth-Dispatch beendet Import; Test lädt ausschließlich tatsächlichen Helper-Source statt Endpoint-Dispatch. PHPStan sauber; zwei ausschließlich erledigte PHPCS-Fingerprints entfernt (6.823 Verstöße/4.975 Fingerprints), keine neuen Freigaben. Reales History-Gate unverändert 64 Originale plus fünf append-only Upgrades. Echter Image-Build mit 69 Migrationen/1.089 Statements, Verify, Startregion-Seed und neun HTTP-Tests erfolgreich; Chromium 2 bestanden/1 übersprungen, System-Fallback und WebGPU-/Runtime-Warnungen bleiben offen. Dokumentation/Rollout ergänzt, eigene Testressourcen entfernt. Kein Asset-Existenz-/vollständiger Registration-/Email-/App-DDL-frei-/Produktionsnachweis.
- [x] Situationsspeicher aus Runtime-DDL gelöst: zwei CREATEs und globalen Ready-Cache durch Metadatenprüfung für States/Stage-Log ersetzt. Bestehende kanonische Gameplay-Migration liefert beide Tabellen inklusive zusätzlichem Type-Index bereits; keine neue Migration/SQL-Umschreibung. Fehlende Tabellen/Spalten melden Migrationsbedarf statt Reparatur, Metadatenfehler propagieren. Zwei zusätzliche Unit-Fälle; Gesamt-Unit-Gate 1.074 Tests/5.236 Assertions. Unveränderter 69-Migrations-Freshinstall/Verify/No-op grün; fokussierter echter MySQL-Situationstest 1 Test/25 Assertions prüft SELECT-only-Guards, ownergefilterte Reads, befüllten Datenerhalt, DML-only-Ticks/Stage-Log, aktive Transaktion/Rollback, Colony-SET-NULL und User-CASCADE sowie fehlende Tabellen nach früherem Erfolg ohne CREATE. Test lädt tatsächliche Endpoint-Helper ohne HTTP-Dispatch und nutzt App-PDO-Fetchmodus. PHPStan sauber; ein ausschließlich erledigter PHPCS-Fingerprint entfernt (6.822 Verstöße/4.974 Fingerprints), keine neuen Freigaben. Rollout/Recovery dokumentiert und eigene MySQL-Testressourcen entfernt. Kein neuer Image-/Browser-/GPU-/Remote-Produktionsnachweis dieses gezielten Blocks; Tick-Atomarität/Konkurrenz und gesamte App ohne DDL-Rechte bleiben offen.
- [x] ScenarioEngine aus Runtime-DDL gelöst: drei CREATEs und Catch-and-continue-Schemafallback durch Metadaten-Guards für Galactic Events/Definitions/Active Events ersetzt. Bestehende kanonische World-Scenario-Migration inklusive Foreign Keys unverändert; keine neue Migration. Due-Tick prüft Schema vor Cooldown-Marker, fehlendes Schema/Metadatenfehler verbrauchen kein Stundenfenster und propagieren; Not-due-Early-return bleibt erhalten. Drei zusätzliche Unit-Fälle, Gesamt-Unit-Gate 1.077 Tests/5.263 Assertions; zwei echte MySQL-Tests/299 Assertions einschließlich unverändertem 69-Migrations-Freshinstall/Verify/No-op prüfen tatsächliche Engine, unveränderten Marker bei fehlendem Schema, SELECT-only-Preflight, DML-only-Tick, Datenerhalt vorhandener Definitions/Events, aktive Transaktion/Rollback und schreibfreien Not-due-Tick. PHPStan/PHPCS sauber mit unveränderten Baselines (6.822 Verstöße/4.974 Fingerprints). Rollout/Recovery dokumentiert und eigene Ressourcen entfernt. Äußerer optionaler NPC-Dispatcher protokolliert Fehler weiterhin und setzt andere Subsysteme fort; keine gesamte Request-fail-closed-Garantie. Spätere Tickfehler, Cooldown-Claim/Konkurrenz, atomare Effekte und App-DDL-frei-/Produktionsnachweis bleiben offen; kein neuer Image-/Browser-Gate dieses Blocks.
- [x] Glossar-Cache in Migrationspfad überführt: unerreichbares Runtime-CREATE nach Endpoint-Exit entfernt; append-only `migrate_glossary_cache_v1.sql` stellt Speicher mit bisherigen Defaults/Indexes/Unicode-Collation bereit, erhält vorhandene Definitionen und Daten; Legacy-Setup ergänzt. Read-only-Guard vor Generierung/RAG sowie in Cache-Reader/Writer; fehlendes Schema nicht als Cache-Miss behandelt, PDO-Fehler protokolliert und propagiert statt verschluckt. Drei zusätzliche Unit-Fälle; Gesamt-Unit-Gate 1.080 Tests/5.284 Assertions. Zwei echte MySQL-Tests/307 Assertions inklusive komplettem 70-Migrations-Freshinstall/Verify/No-op prüfen fail-before-RAG, Replay/Datenerhalt, SELECT-only-Hit/Miss, verweigerte Writes, DML-only-Upserts, aktive Transaktion/Rollback und 6-Tage-Expiry. PHPStan sauber; ein ausschließlich erledigter PHPCS-Fingerprint entfernt (6.821 Verstöße/4.973 Fingerprints). 47 History-Tests mit 15s lokalem Timeout grün, reales Gate 64 Originale plus sechs append-only Upgrades. Rollout/Recovery ohne destruktiven Down dokumentiert, eigene Ressourcen entfernt. Kein neuer Image-/Browser-/externer RAG-Nachweis; Transportlimits/Cache-Inhaltsvalidierung und Gesamt-App ohne DDL-Rechte bleiben offen.
- [x] Spieler-Allianz-Basisspeicher aus Runtime-DDL gelöst: vier CREATEs für Alliances/Members/Relations/Messages durch Metadaten-Guards ersetzt. Kanonische Base/v2 liefern Speicher bereits, keine neue Migration/SQL-Umschreibung. Fehlende Tabellen/Spalten explizit statt Reparatur; kein globaler Success-Cache. Vier zusätzliche Unit-Fälle, Gesamt-Unit-Suite inklusive bestehender Allianz-Action-Tests 1.084 Tests/5.326 Assertions. Zwei echte MySQL-Tests/308 Assertions einschließlich unverändertem 70-Migrations-Freshinstall/Verify/No-op prüfen tatsächlichen Runtime-Helper mit SELECT-only, aktive Transaktion, befüllte Treasury-DECIMALs/Membership/Relations/Messages unverändert, Other-Alliance-SET-NULL und Leader-User-CASCADE; fehlende Messages/Treasuryspalte nach vorherigem Erfolg ohne Reparatur. PHPStan sauber; ein ausschließlich erledigter PHPCS-Fingerprint entfernt (6.820 Verstöße/4.972 Fingerprints), keine neuen Freigaben. Dokumentation/Rollout ergänzt und eigene Ressourcen entfernt. Mehrparteien-Allianzkriege weiterhin Runtime-DDL; Autorisierung/Ressourcentransaktionen unverändert. Kein neuer Image-/Browser-/Produktionsnachweis, gesamte App ohne DDL-Rechte bleibt offen.
- [x] Mehrparteien-Allianzkriege in Migrationspfad überführt: drei Runtime-CREATEs durch Metadaten-Guard ersetzt; append-only `migrate_alliance_wars_v1.sql` stellt Wars/Sides/Peace-Offers mit bisherigen Defaults/Unique-Key/CASCADE bereit und erhält vorhandene Daten/Definitionen. TEXT-Default `[]` in gültige MySQL-Expressionsyntax überführt, Wert unverändert. Legacy-Setup ergänzt, kein destruktiver Down. Drei neue Unit-Fälle; Gesamt-Unit-Gate 1.087 Tests/5.354 Assertions. Zwei echte MySQL-Tests/312 Assertions inklusive komplettem 71-Migrations-Freshinstall/Verify/No-op prüfen echte Runtime-Prüfung mit SELECT-only, Transaktionserhalt, befüllte Scores/Exhaustion/Seiten/Offers bei Replay, Default-Peace-Terms und Allianz-/Declarer-CASCADE. Fehlende Offers nach vorherigem Erfolg ohne Reparatur. PHPStan/PHPCS sauber; ein erledigter Fingerprint entfernt (6.819 Verstöße/4.971 Fingerprints), keine neuen Freigaben. Rollout/Recovery dokumentiert, eigene Ressourcen entfernt. War-Action-Autorisierung/Ressourcen/Konkurrenz unverändert; kein neuer Image-/Browser-/Produktionsnachweis, gesamte App ohne DDL-Rechte bleibt offen.
- [x] Leader-Marktplatz aus Runtime-DDL gelöst: ein CREATE, 14 bedingte Profile-ALTERs und globale Success-Caches durch Metadaten-Guards ersetzt. Kanonische Base-/Marketplace-Migration liefern Speicher bereits; keine neue Migration oder Änderung historischer SQL-Dateien. Vorhandene Kandidaten/Profile und abweichende Spaltenbreiten bleiben unverändert. Sechs neue Unit-Fälle; Gesamt-Unit-Gate 1.093 Tests/5.394 Assertions. Drei echte MySQL-Tests/318 Assertions inklusive komplettem 71-Migrations-Freshinstall/Verify/No-op und bestehendem Partial-Legacy-Upgrade prüfen tatsächliche Helper mit SELECT-only, aktive Transaktion, erhaltene Daten/Definitionen sowie fehlende Tabelle/Skillspalte nach vorherigem Erfolg ohne Reparatur. PHPStan/PHPCS sauber; drei erledigte Fingerprints entfernt (6.816 Verstöße/4.968 Fingerprints), keine neuen Freigaben. Rollout/Recovery dokumentiert, eigene Ressourcen entfernt. Keine neue Image-/Browser-/Hiring-Action-Abnahme; Markt-Ressourcenatomarität und gesamte App ohne DDL-Rechte bleiben offen.
- [x] Wormhole-Speicher aus Runtime-DDL gelöst: sechs CREATEs und zwei bedingte ALTERs in Fleet-Listing/Routing, Beacon-Belohnung und NPC-Regeneration durch gemeinsame Metadaten-Guards ersetzt. Kanonische v8/v9 liefern Speicher bereits; keine neue Migration/Änderung historischer SQL-Dateien. Fehlendes Schema propagiert statt „keine Route“; Due-Tick prüft vor Cooldown-Marker, Beacon-Rewards vor Ressourcen-/Claimed-Statusänderungen; andere Quests bleiben unabhängig vom Unlock-Speicher. Sechs neue Unit-Fälle; Gesamt-Unit-Gate 1.099 Tests/5.434 Assertions. Drei echte MySQL-Tests/390 Assertions inklusive unverändertem 71-Migrations-Freshinstall/Verify/No-op prüfen SELECT-only-Routen und Listing-Payload, Forschungslevel 4/5, Unlock, beide Richtungen, Stabilitätsgrenze 9/10, aktive/gesperrte Routen, DML-only-Sprung/Regeneration/Reward-Body, Cooldown-Clear, Clamp 100, unveränderte Future-Cooldowns/inaktive Routen, Transaktion/Rollback, Daten-/Definitions-Replay und User-CASCADE. PHPStan/PHPCS sauber (6.801 Verstöße/4.955 Fingerprints); erledigte Findings entfernt, unveränderten Side-Effects-Bestandfingerprint nach striktem Vergleich lediglich positionsneu zugeordnet. Rollout/Recovery dokumentiert, eigene Ressourcen entfernt. Kein neuer Image-/Browser-/vollständiger HTTP-Claim-Nachweis; Tick-Claim/Konkurrenz, Quest-/Flotten-Atomarität und gesamte App ohne DDL-Rechte bleiben offen.
- [x] Projektor-Worker auf kanonisches Schema und fail-closed Bootstrap umgestellt: vier CREATE-Statements entfernt, Queue/User-/System-Guards vor jedem Claim. Beschädigten System-Worker mit reproduziertem Parsefehler, vermischten Schleifen und falschem system_id-Schema auf vorhandene (galaxy, system_index)-Payload-/Writer-Helper und gemeinsamen Claim/Retry/Mark-done-Runtime zurückgeführt. Keine neue Migration/Änderung historischer SQL. Beide Dry-runs lesen mit SELECT-only ohne Claim/Writes; max-items begrenzt Claim vor Verarbeitung, bereits geclaimte Batches werden auch jenseits weicher Deadline beendet statt bei normalem Limit mit Processing-Resten verlassen. Explizites --batch=50 überschreibt auch abweichende Config-Defaults. Worker nutzen strikte Read-/Write-/JSON-Fehler; Request-seitige Best-effort-Defaults erhalten. 15 neue Unit-Fälle, Gesamt-Unit-Gate 1.114 Tests/5.503 Assertions; drei echte MySQL-Tests/400 Assertions inklusive vollständigem 71-Migrations-Freshinstall/Verify/No-op prüfen tatsächliche CLI-Prozesse, Missing-Schema vor Claim, schreibfreie Dry-runs, User-Fehler mit Claimlimit, kanonische System-/Owner-/Population-Payloads, Version/Stale-Flag, nicht vorhandene Sterne, verweigerte Writes mit Retry statt Ack und erfolgreichen Wiederanlauf. PHP-Syntax/PHPStan/PHPCS grün, Baselines unverändert (6.801 Verstöße/4.955 Fingerprints). Rollout/Runbook ergänzt und eigene Ressourcen entfernt. Keine gesamte User-Live-Overview-/Image-/Browser-/Produktionsabnahme; Crash-Leases/Fencing, Outbox-/Snapshot-Atomarität, CLI-Argumenthärtung und App-DDL-frei-/Least-Privilege-Gesamtnachweis bleiben offen.
- [x] Projektor-CLI fail-closed: unbekannte/positionale/duplizierte Optionen, fehlende Werte, falsche Syntax, Signs/Whitespace/Dezimalzahlen und Integer-Overflow scheitern vor Config-/DB-Zugriff mit stderr/Exit 1. Batch null verworfen statt still auf eins geklemmt; Zeit-/Itemlimits null weiter unbegrenzt, führende Nullen/exakte PHP_INT_MAX-Grenze/gültige Defaults erhalten. Nichtpositive Config-Batchgrößen explizit abgewiesen; standalone --help ohne Config/DB, gemischtes Help ungültig. 101 neue Parser-/Subprozessfälle mit tatsächlichen Worker-Scripts und Config-Trap, zwei bestehende Fallback-Tests auf intentional fail-closed umgestellt. Gesamt-Unit-Gate 1.215 Tests/6.240 Assertions; zwei fokussierte echte MySQL-Tests/121 Assertions prüfen Tippfehler ohne Start/Claim sowie erhaltene Dry-run-/Schema-/Claimlimit-/System-Write-/Retry-Verarbeitung. PHPStan/PHPCS sauber, Baselines unverändert; Release-Metadaten/append-only History grün. Runbook/Rollout aktualisiert, eigene Ressourcen entfernt. Kein neuer kompletter Freshinstall-/Image-/Browser-/Produktionsnachweis; harte Deadlines, Crash-Leases/Fencing und atomare Snapshot-/Queue-Updates bleiben offen.
- [x] Projektor-Retry erhält neu gequeue­te Events: Überschreiben von Attempts/Error/Retryzeit eines neuen Producer-Enqueues durch alten Workerfehler auf MySQL reproduziert. Retry-/Dead-letter-UPDATEs auf status=processing begrenzt, betroffene Zeilen vor Erfolgslog geprüft; queued/failed/gelöschte Rows bleiben bei verspäteten oder doppelten Fehlern unverändert, No-op explizit als failure_skipped protokolliert. Drei neue Unit-Fälle plus bestehende SQL-Assertions, Gesamt-Unit-Gate 1.218 Tests/6.249 Assertions; drei fokussierte echte MySQL-Tests/152 Assertions prüfen getrennte Producer-/Worker-Verbindungen, deterministische Retry-/Dead-letter-Interleavings, erhaltene neue Payload/Reason/Attemptreset/Schedule, Caller-Rollback, normale Retries/Dead-letter, Revival und tatsächliche CLI-Verarbeitung. PHPStan/PHPCS/Release-/History-Gates sauber, Baselines unverändert. Runbook/Rollout aktualisiert, eigene Ressourcen entfernt. Statusguard ausdrücklich kein Claim-Fencing bei anschließendem Neuclaim; Token/Leases, atomare Snapshot-/Queue-Updates, Parallel-Reclaim-/Crash-/Produktionsnachweis bleiben offen. Kein neuer Freshinstall-/Image-/Browser-Gate.
- [x] Projektor-Queue mit Claim-Token-Fencing: append-only Migration 72 ergänzt nullable ASCII/binären Token ohne Änderung historischer SQL. Jeder Claim-Batch erhält frischen 256-Bit-Zufallstoken; beide Worker übergeben ihn verpflichtend an Ack/Retry/Dead-letter. Status und exakter Token müssen übereinstimmen; alte Worker verändern nach Neuclaim weder Queue noch Retryzeit, No-op explizit als skipped protokolliert. Enqueue/Fehlertransition löschen Tokens; separater System-Producer setzt nun auch processing/failed zurück auf queued, statt neue Events zu verlieren. Gesamt-Unit-Gate 1.221 Tests/6.261 Assertions, 47 History-Tests und PHPStan/PHPCS/Release-Gates grün, Baselines unverändert. Echte MySQL-Abnahme prüft befüllte Legacy-Queue/Replay, vollständigen 72-Migrations-Freshinstall/Verify/No-op, tatsächliche CLI-Worker sowie getrennte Producer-/Worker-Verbindungen mit Neuclaim/Ack/Retry/Dead-letter; vorheriger Status-only-DELETE innerhalb zurückgerollter Transaktion als unsicher nachgewiesen. Rollout nur mit gestoppten alten Workern, Migration/Verify und passenden Producern/Workern; Legacy-Processing selektiv prüfen/requeue, kein sicherer Mixed-Version-Rollout. Queue-Fencing ausdrücklich keine Absicherung alter Snapshot-Writes, kein atomarer Snapshot/Ack, keine Leases/automatische Crash-Recovery oder Produktionsabnahme. Kein neuer Image-/Browser-Gate.
- [x] Projektor-Publikation atomar und gefenced: beide Worker bauen Payload außerhalb der Commit-Transaktion und sperren danach exakt Processing-Row/Claim-Token via SELECT FOR UPDATE. Nur aktueller Besitzer schreibt mit strict Helper und quittiert auf derselben PDO-Verbindung; Write/Ack gemeinsam committed, bei Fehler gemeinsam zurückgerollt. Überholte Claims führen Writer nicht aus, eigene skipped-Zähler statt processed/Done-Erfolg. Nicht bereinigte Transaktionen stoppen vor Retry. InnoDB-Engine-Preflight für Queue/Read-model vor Claim/Dry-run; MyISAM ohne Reparatur verworfen. Keine weitere Migration, historische SQL unverändert. Gesamt-Unit-Gate 1.234 Tests/6.321 Assertions; vier echte MySQL-Tests/254 Assertions prüfen beide Writer, alte Snapshot-Write-Race in zurückgerollter Transaktion, Writer-Suppression nach Neuclaim, Rollback/unsichtbare uncommitted Versions, Queue-Lock gegen Producer, doppeltes/no-write Completion sowie actual System-CLI mit DELETE-Verweigerung: exakte alte Snapshotdaten/Version/Stale erhalten, Retry und Wiederanlauf mit einzelnem Versionsinkrement. Unit-Fälle für Caller-Transaktion, Write/Ack/Commit-/Rollbackfehler; echte Worker weisen MyISAM vor Claim zurück. Betriebsgrenzen/Rollout dokumentiert; alte token-only Worker vor Deployment stoppen. Keine Garantie konsistenter Source-Reads, gefenceter Request-Writer/Gameplay-Mutationen, atomarer Outbox, Leases/exactly-once oder Crash-/Restore-/Produktionsabnahme; kein neuer Freshinstall-/Image-/Browser-Gate.
- [ ] Datentypen bereinigen: `BIGINT` für Ressourcen und IDs, `DECIMAL` statt `DOUBLE` für deterministische Werte, UTC-Konvention

**Spielintegrität** (BE-01 … BE-03)
- [ ] Gemeinsamer `ResourceLedger`-Service: Transaktion + `SELECT … FOR UPDATE` + bedingtes Update; Einsatz in Bau, Forschung, Werft, Flotte, Handel und Markt
- [ ] Nebenläufigkeitstests (parallele Requests) für jede Ressourcenmutation; Invariante „Ressourcen ≥ 0“ per DB-Constraint oder Check
- [x] Opt-in Koloniewirtschaft als serverseitiger On-Demand-Prozess: persistente 300-Sekunden-Schritte, begrenztes Catch-up, reale Produktionsinputs und Bevoelkerungsklassen, gemeinsame Bau-/Markt-Abrechnung und aggregierte System-/Galaxieprojektionen mit Altersangabe. Migration und `ON_DEMAND_ECONOMY_ENABLED=1` erforderlich; kein Wirtschaftsworker. Externe Marktliquiditaet bleibt ein Market-Maker.
- [ ] Nichtwirtschaftliche Weltsimulation als eigener Worker-Prozess mit Lease und idempotenter Tick-Nummer pruefen; dies ist keine Voraussetzung fuer Kolonieproduktion.
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
- [x] Bestehenden Main-Branch-Image-Publish-Pfad vorgezogen abgesichert: `docker-build` wartet auf PHP-/JS-Lint, beide PHPUnit-Gates, Vitest/Build/Budget und Playwright-Smoke. Ein lokaler Candidate wird ohne Push gebaut, vor Registry-Login mit Trivy auf HIGH/CRITICAL OS-/Library-Vulnerabilities und Secrets geprüft (auch ohne verfügbaren Fix). Push prüft Candidate-ID gegen Build-Output, taggt/pusht exakt dieses Image ohne Rebuild; fehlende Metadaten, Identity-Mismatch und Dockerfehler blockieren. Elf Regressionstests prüfen Workflow-Kontrakt und echtes Bash-Skript mit isolierten Docker-Fixtures; Actionlint bestanden. Keine Live-Registry-/Scan-Abnahme, kein Produktionsimage-/Tag-Release-Nachweis; mehrere Tag-Pushes nicht atomar. Historien-/CodeQL-Gates, SBOM, Signatur und Staging-Freigabe bleiben separat offen.
- [x] Docker-Build-Kontext gehärtet: `.dockerignore` schließt lokale/nested Environment-Dateien, Key-/PEM-Dateien, Host-Abhängigkeiten, Editor-/Sprach-/PHP-Caches, Testberichte, bekannte Session-/Header-/Testuser-Dumps und gezielte Runtime-Audio-/Texture-/Dev-Outputs aus. Source/Config/Migrationen, Apache/PHP-Konfig, Musik, SVG-Fallbacks, Deployment-GLBs und Legacy-Gzip erhalten; lokale Dateien unverändert. `npm run check:docker-context` baut synthetischen `FROM scratch`-Kontext mit echten Docker-Regeln, prüft 56 ausgeschlossene und 26 byte-identisch enthaltene Inputs und bereinigt eigene Ressourcen. Drei echte Docker-Regressionen (inklusive geschwächter Secret-Policy/versehentlich fehlender API) blockierend in CI; zusammen mit Release-/Publish-Tests 60 Tests lokal bestanden, Actionlint/Metadatengate sauber. Keine vollständige App-Image-/Secret-/Mount-Abnahme; lokale `.env` wird nicht mehr implizit in Docker-Vite-Build übernommen, Runtime-Config bleibt explizit.
- [ ] Staging-Umgebung mit anonymisierten oder synthetischen Daten

**Observability** (INF-05, INF-06)
- [ ] Prometheus-Targets auf Service-Namen umstellen, `/metrics` absichern, Alertmanager anbinden; Images pinnen; Grafana-Zugang über SSO oder Secret
- [ ] App-Metriken: Request-Latenz und Fehlerrate pro Route, Tick-Dauer und -Lag, Queue-Längen, aktive Spieler, Mail-Zustellrate
- [ ] Error-Tracking für Frontend und Backend (Sentry/GlitchTip) mit Release-Zuordnung
- [ ] Zentrale Logs (Loki/ELK) mit Request-ID-Korrelation; Uptime-Checks von außen
- [ ] Liveness- und Readiness-Endpunkte (DB, Worker-Heartbeat)
- [x] PHP-/DB-Probe-Teil umgesetzt: öffentliche sessionfreie GET/HEAD-Endpunkte `/health/live` (200, keine DB/Spielinitialisierung) und `/health/ready` (DB-SELECT + alle Manifest-Migrationen angewendet; sonst 503), minimale nicht cachebare JSON-Antworten ohne interne Fehlermeldungen; 405/Allow, 404 und Retry-After explizit. Kein Tracking-Bootstrap/DDL/Seed. Readiness läuft im separaten PHP-CLI-Prozess mit 3-s-Watchdog, begrenztem Pipe-Drain und Beenden/Reaping bei Hängern; PDO-Verbindungs-/mysqlnd-Read-Timeout je 2 s, Gameplay-Verbindung unverändert. Reale Docker-DNS-Ausfallprobe zeigte zunächst >5 s trotz PDO-Timeout; nach Watchdog 503 in ca. 3,1 s bei weiterhin 200 Liveness. Image-HEALTHCHECK/CI-Compose nutzen Liveness; CI prüft echte HTTP-Verträge vor Migrationen (nicht bereit) und danach vor Seed (bereit). 22 PHP-Tests/88 Assertions, jeweils neun echte HTTP-Tests für frische/migrierte/ausgefallene DB und 21 Docker-/CI-Regressionen lokal bestanden; frische Probes erzeugen keine Tracking-Tabelle, 64 echte Migrationen angewendet, Image gebaut und eigene Ressourcen bereinigt. PHPCS-/PHPStan-Baselines unverändert. Readiness bestätigt Trackingstatus, nicht Checksums/vollständige Schema-/Gameplay-Korrektheit; Worker-Heartbeat, Proxy-Rate-Limit/Probe-Allowlist, Monitoring, Remote-CI und Produktionsimage offen.

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
