# Third-Party-Lizenzen — GalaxyQuest

GalaxyQuest ist unter der **MIT-Lizenz** veröffentlicht (siehe [`LICENSE`](../../LICENSE)).  
Dieses Dokument listet alle eingesetzten Drittanbieter-Bibliotheken, ihre Versionen und Lizenzmodelle auf.

---

## 1. Laufzeit-Abhängigkeiten (lokal ausgeliefert)

Diese Bibliotheken werden zur Laufzeit aus lokalen Vendor-Assets geladen und sind Bestandteil des ausgelieferten Clients.

| Bibliothek | Version | Lizenz | Einsatzbereich | Asset-Pfad |
|---|---|---|---|---|
| **Three.js** | 0.160.0 | MIT | 3D-Rendering (Galaxie-Karte, Starfield) | `js/vendor/three.min.js` |
| **Dexie** | 4.0.8 | Apache-2.0 | IndexedDB-Wrapper (Client-seitiger Datenspeicher) | `js/vendor/dexie.min.js` |
| **Mustache.js** | 4.2.0 | MIT | Logic-less Templating | `js/vendor/mustache.min.js` |
| **QRCode.js** | 1.5.4 | MIT | QR-Code-Generierung (2FA-Einrichtung) | `https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js` |

> QRCode.js wird **lazy** geladen (nur auf der 2FA-Seite), CDN-Request erfolgt erst bei Bedarf.

---

## 2. Entwicklungs- & Build-Werkzeuge

Diese Pakete werden ausschließlich zur Entwicklungszeit oder im Build-Prozess verwendet und sind **nicht** Teil des ausgelieferten Produkts.

### 2a. npm devDependencies (`package.json`)

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| **vitest** | ^4.1.2 | MIT | Unit-Test-Framework (JS/Engine-Tests) |
| **jsdom** | ^24.1.0 | MIT | DOM-Emulation für Unit-Tests (kein Browser nötig) |
| **@playwright/test** | ^1.58.2 | Apache-2.0 | End-to-End-Tests (Browser-Automatisierung) |

### 2b. Build-Tool (Docker-Image)

| Werkzeug | Version | Lizenz | Zweck |
|---|---|---|---|
| **esbuild** | latest¹ | MIT | JavaScript-Bundler (wird global im Container installiert) |

> ¹ Die Version von `esbuild` ist im Dockerfile nicht fixiert (`npm install -g esbuild`). Für reproduzierbare Builds empfiehlt sich eine Versionsfixierung.

---

## 3. Transitive npm-Abhängigkeiten (Auszug nicht-MIT-Lizenzen)

Die Vollständige Liste aller transitiven Abhängigkeiten ist in `package-lock.json` zu finden. Nachfolgend sind alle transitiven Pakete aufgeführt, die **nicht** unter MIT lizenziert sind. Diese stammen ausschließlich aus dem Dev/Test-Stack und gehen **nicht** in den Produktivcode ein.

| Paket | Version | Lizenz | Eingebunden über |
|---|---|---|---|
| **playwright** | 1.58.2 | Apache-2.0 | `@playwright/test` |
| **playwright-core** | 1.58.2 | Apache-2.0 | `@playwright/test` |
| **xml-name-validator** | 5.0.0 | Apache-2.0 | `jsdom` |
| **lightningcss** | 1.32.0 | MPL-2.0 | `vite` (via `vitest`) |
| **lightningcss-\*** (Platform-Binaries) | 1.32.0 | MPL-2.0 | `vite` (via `vitest`) |
| **source-map-js** | 1.2.1 | BSD-3-Clause | `postcss` (via `vitest`) |
| **tough-cookie** | 4.1.4 | BSD-3-Clause | `jsdom` |
| **webidl-conversions** | 7.0.0 | BSD-2-Clause | `jsdom` → `whatwg-url` |
| **lru-cache** | 10.4.3 | ISC | `jsdom` |
| **picocolors** | 1.1.1 | ISC | `vitest` |
| **saxes** | 6.0.0 | ISC | `jsdom` |
| **siginfo** | 2.0.0 | ISC | `vitest` |

---

## 4. Laufzeit-Infrastruktur (Docker)

| Komponente | Version | Lizenz | Anmerkung |
|---|---|---|---|
| **PHP** | 8.2 (apache-Variante) | PHP License v3.01 | Basis-Image `php:8.2-apache` |
| **MySQL** | 8.4 | GPL-2.0 (Community) | Nur serverseitig, nicht in Quellcode eingebettet |
| **Node.js / npm** | LTS (apt) | MIT / Artistic License 2.0 | Nur im Dev/Build-Container |

---

## 5. PHP-Abhängigkeiten

Das Projekt verwendet **keinen PHP-Paketmanager** (kein `composer.json`). Der gesamte PHP-Code ist eigenständig implementiert. Externe PHP-Bibliotheken werden nicht eingesetzt.

Die einzige PHP-Testinfrastruktur ist **PHPUnit**, das ausschließlich über den Docker-Container (`phpunit/phpunit`) genutzt wird:

| Werkzeug | Version | Lizenz | Zweck |
|---|---|---|---|
| **PHPUnit** | (via Docker/phpunit.xml) | BSD-3-Clause | PHP-Unit-Tests |

---

## 6. Lizenz-Kompatibilitätsübersicht

GalaxyQuest ist unter **MIT** lizenziert. Die folgende Tabelle zeigt, ob die eingesetzten Lizenzen mit einer MIT-Lizenzierung des Gesamtprojekts kompatibel sind.

| Lizenz | Typ | Kompatibel mit MIT (Verteilung) | Anmerkung |
|---|---|---|---|
| **MIT** | Permissiv | ✅ Ja | Namensnennung erforderlich |
| **Apache-2.0** | Permissiv | ✅ Ja | Namensnennung + NOTICE erforderlich |
| **ISC** | Permissiv | ✅ Ja | Funktional äquivalent zu MIT |
| **BSD-2-Clause** | Permissiv | ✅ Ja | Namensnennung erforderlich |
| **BSD-3-Clause** | Permissiv | ✅ Ja | Namensnennung + Non-Endorsement |
| **MPL-2.0** | Schwaches Copyleft | ✅ Ja (mit Einschränkung) | Nur bei *Modifikation* von MPL-Dateien selbst müssen diese wieder unter MPL veröffentlicht werden — betrifft `lightningcss`, ein reines Dev-Tool |
| **PHP License v3.01** | Permissiv | ✅ Ja | Nur serverseitige Ausführung, nicht in Quellcode eingebettet |
| **GPL-2.0** | Starkes Copyleft | ✅ Ja (Laufzeit-only) | MySQL läuft als separater Prozess; GPL-Contagion greift nicht auf GQ-Quellcode |

**Fazit:** Alle eingesetzten Bibliotheken sind mit dem MIT-Lizenzmodell von GalaxyQuest kompatibel.

---

## 7. Hinweise für Contributors

- Neue Laufzeit-Bibliotheken (CDN oder lokal) müssen in Abschnitt 1 dieses Dokuments eingetragen werden.
- Neue npm-Pakete (`package.json`) müssen in Abschnitt 2 aufgeführt werden; Lizenzen sind vor der Aufnahme auf Kompatibilität zu prüfen.
- Lizenzen mit **Copyleft** (GPL, AGPL, LGPL) dürfen **nicht** in den Produktivcode (ausgelieferter Client oder Server-Quellcode) eingebunden werden.
- MPL-2.0-Pakete sind als Dev-Abhängigkeit akzeptabel, **nicht** jedoch als Laufzeit-Abhängigkeit im Client.

---

*Letzte Aktualisierung: April 2026*
