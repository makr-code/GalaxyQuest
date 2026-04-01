# Template System Design — GalaxyQuest

> **Scope:** Verbindliche Vorgabe wie `{{ }}` Platzhalter, Mustache.js und HTML `<template>`-Tags
> in PHP, JavaScript und CSS eingesetzt werden sollen.  
> Für die technische Gesamt-Architektur: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Inhaltsverzeichnis

1. [Ist-Zustand](#1-ist-zustand)
2. [Hybrides 3-Schichten-Modell](#2-hybrides-3-schichten-modell)
3. [Schicht 1 – PHP: Deploy-Zeit-Variablen](#3-schicht-1--php-deploy-zeit-variablen)
4. [Schicht 2 – JS Mustache: Datenlisten-Rendering](#4-schicht-2--js-mustache-datenlisten-rendering)
5. [Schicht 3 – HTML `<template>`-Tags: Strukturelle Scaffolds](#5-schicht-3--html-template-tags-strukturelle-scaffolds)
6. [CSS-Design-Token-System](#6-css-design-token-system)
7. [Vorteile & Nachteile](#7-vorteile--nachteile)
8. [Verbotene Muster](#8-verbotene-muster)
9. [Migrations-Checkliste](#9-migrations-checkliste)

---

## 1. Ist-Zustand

Das Projekt hat historisch vier parallele Rendering-Wege, die jetzt unter dieser Vorgabe
konsolidiert werden:

| Layer | System | Datei(en) | Aufrufe (ca.) |
|---|---|---|---|
| PHP | `{{variable}}` Regex | `lib/template-renderer.php`, `api/llm_soc/LlmPromptService.php` | 2 Stellen |
| JS | Mustache `{{{ }}}` / `{{ }}` (CDN) | `js/runtime/game.js` `renderInlineTemplate()` | ~20 |
| JS | HTML `<template>`-Tags + `GQUIKit.cloneTemplate()` | `index.html`, `js/ui/ui-kit.js` | ~8 Templates |
| JS | Raw `innerHTML = \`...\`` Template-Strings | `js/runtime/game.js` überall | ~128 |
| JS | GQUI fluent DOM-Builder | `js/ui/gq-ui.js` | ~139 |

**Kernproblem:** 128 rohe `innerHTML`-Zuweisungen ohne konsistentes Escaping stehen 20
kontrollierten `renderInlineTemplate()`-Aufrufen gegenüber.

---

## 2. Hybrides 3-Schichten-Modell

```
┌──────────────────────────────────────────────────────────────────┐
│  REQUEST                                                         │
│  index.php → renderTemplate($html, $buildInfo)                   │
│              ↓ PHP {{variable}} → Deploy-Zeit-Werte              │
├──────────────────────────────────────────────────────────────────┤
│  BROWSER BOOT                                                    │
│  GQUIKit.cloneTemplate('tpl-*') → strukturelle Scaffolds         │
│              ↓ HTML <template>-Tags → statische Gerüste          │
├──────────────────────────────────────────────────────────────────┤
│  RUNTIME / API-Response                                          │
│  renderInlineTemplate(tpl, data) → Mustache.render()             │
│              ↓ {{{ }}} → sichere Liste & Detail-Darstellung      │
└──────────────────────────────────────────────────────────────────┘
```

Jede Schicht hat eine **klar abgegrenzte Verantwortung**. Schichten dürfen nicht
übereinander gemischt werden (z. B. kein PHP-`{{}}` in JS-Strings).

---

## 3. Schicht 1 – PHP: Deploy-Zeit-Variablen

### Wann verwenden

Ausschließlich für Werte, die **beim Server-Start / Build-Zeit feststehen**:

- Build-Nummer (`{{buildnr}}`)
- Build-Datum (`{{build_date}}`)
- App-Umgebung (`{{app_env}}`)
- Build-Version (`{{build_version}}`)

### Wie verwenden

```php
// lib/template-renderer.php
$html = renderTemplate($html, getBuildInfo());
```

```html
<!-- index.html -->
<p class="copyright-build">build {{buildnr}} — {{build_date}}</p>
```

### Regeln

| Regel | Begründung |
|---|---|
| ✅ Nur statische Build-/Deploy-Werte | Kein XSS-Risiko bei Build-Werten |
| ❌ Keine User-Daten als `{{variable}}` in PHP | `htmlspecialchars()` schützt, aber User-Daten gehören nicht in den PHP-Layer |
| ❌ Kein Mustache-Loop-Syntax `{{#list}}` in PHP | PHP-Renderer unterstützt keinen Loop-Syntax – LLM-Prompts sind die einzige Ausnahme |
| ✅ LLM-Prompts dürfen `{{token}}` nutzen | `LlmPromptService::renderTemplate()` ist isoliert und validiert fehlende Tokens |

### LLM-Prompt-Ausnahme

`api/llm_soc/LlmPromptService.php` hat einen eigenen `renderTemplate()`-Aufruf für
KI-Prompt-Profile. Dieser ist bewusst von `lib/template-renderer.php` **getrennt** und
gibt fehlende Tokens als `missing[]`-Array zurück. Diese Trennung beibehalten.

---

## 4. Schicht 2 – JS Mustache: Datenlisten-Rendering

### Wann verwenden

Für alle **wiederholenden Zeilen und Detail-Ansichten** die aus API-Responses befüllt
werden:

- Fleet-Zeilen, Battle-Log-Zeilen
- Message-Rows, Message-Detail
- Alle dynamischen Listen-Elemente

### Wie verwenden

```javascript
// Globale Hilfsfunktionen in game.js (bereits vorhanden – nicht duplizieren)
renderInlineTemplate(templateString, dataObject)   // → einzelner String
renderInlineTemplateList(templateString, rowsArray) // → konkatenierte Strings
```

### Triple-Stache `{{{ }}}` vs. Double-Stache `{{ }}`

| Syntax | Verhalten | Verwenden für |
|---|---|---|
| `{{{ variable }}}` | **Kein** HTML-Escaping | Bereits escapte Werte, HTML-Fragmente (z. B. `{{{vesselListHtml}}}`) |
| `{{ variable }}` | Automatisches HTML-Escaping via Mustache | User-Text, Namen, alle unbekannten Strings |

**Faustregel:** Standard ist `{{ }}`. Nur wenn der Wert nachweislich bereits durch `esc()`
oder eine API-Schicht gesichert wurde, darf `{{{ }}}` verwendet werden.

### Template-Strings auslagern

Templates sollen **nicht** als Inline-Strings in Klassen-Konstruktoren stehen:

```javascript
// ❌ Schlecht – Template im Konstruktor
constructor() {
  this.templates = {
    fleetRow: `<div class="fleet-row">{{{mission}}}</div>`,
  };
}
```

```html
<!-- ✅ Gut – Template im HTML als <template>-Tag -->
<template id="tpl-fleet-row">
  <div class="fleet-row">{{ mission }}</div>
</template>
```

```javascript
// ✅ Gut – Template aus DOM lesen
const tpl = document.getElementById('tpl-fleet-row').innerHTML;
fleetList.innerHTML = renderInlineTemplateList(tpl, rows);
```

### Mustache lokal einbetten (nicht CDN)

Mustache wird aktuell via CDN geladen (`cdn.jsdelivr.net/npm/mustache@4.2.0`).
Ziel ist die lokale Einbettung als `js/vendor/mustache.min.js`:

```html
<!-- ❌ Aktuell (CDN – Single-Point-of-Failure) -->
<script src="https://cdn.jsdelivr.net/npm/mustache@4.2.0/mustache.min.js"></script>

<!-- ✅ Ziel (lokal) -->
<script src="js/vendor/mustache.min.js"></script>
```

`renderInlineTemplate()` hat bereits einen Fallback-Regex-Renderer für den Fall dass
`window.Mustache` nicht verfügbar ist – dieser bleibt als Notfall-Fallback erhalten.

---

## 5. Schicht 3 – HTML `<template>`-Tags: Strukturelle Scaffolds

### Wann verwenden

Für **einmalige, komplexe UI-Strukturen** die als Gerüst geklont werden:

- Leere Zustände (Empty State)
- Lade-Skeletons
- KPI-Grids, Timelines
- Context-Menus
- Komplexe Panel-Strukturen (einmalig pro Seite)

### Wie verwenden

```html
<!-- index.html – Definition -->
<section id="ui-kit-templates" aria-hidden="true">
  <template id="tpl-fleet-row">
    <div class="fleet-row">
      <span class="fleet-mission"><!-- wird per JS befüllt --></span>
    </div>
  </template>
</section>
```

```javascript
// js/ui/ui-kit.js – Klonen via GQUIKit
const frag = GQUIKit.cloneTemplate('tpl-fleet-row');
container.appendChild(frag);
```

### Regeln

| Regel | Begründung |
|---|---|
| ✅ Alle `<template>`-Tags in `#ui-kit-templates` bündeln | Zentraler Ort, `aria-hidden="true"` |
| ✅ ID-Präfix `tpl-` für alle Template-Elemente | Konsistente Benennung, leicht auffindbar |
| ❌ Keine `{{{ }}}` Mustache-Syntax in `<template>`-Tags | `<template>`-Inhalt wird nicht durch Mustache verarbeitet – dafür ist `.innerHTML` nötig |
| ✅ `<template>`-Tags für statische Strukturen; Mustache für dynamische Daten | Klare Trennung der Verantwortung |

### Kombination: `<template>` + Mustache

```html
<!-- index.html -->
<template id="tpl-fleet-row">
  <div class="fleet-row">
    <span class="fleet-mission">{{{mission}}}</span>
    <span class="fleet-timer" data-end="{{{arrivalTimeRaw}}}">{{{arrivalCountdown}}}</span>
  </div>
</template>
```

```javascript
// game.js
const tpl = document.getElementById('tpl-fleet-row').innerHTML;
fleetList.innerHTML = renderInlineTemplateList(tpl, rows);
```

Dieser Hybrid ist der **bevorzugte Weg** für Listen-Elemente.

---

## 6. CSS-Design-Token-System

CSS-Variablen sind **kein Template-System**, sondern ein **Design-Token-System**.
Sie werden durch `applyUiTheme()` in `game.js` zur Laufzeit gesetzt:

```javascript
// game.js – applyUiTheme()
document.documentElement.style.setProperty('--theme-accent', palette.accent);
document.documentElement.style.setProperty('--theme-accent-soft', hexToRgba(palette.accentSoft, 0.78));
```

### Verfügbare Token-Kategorien

| Kategorie | Beispiel-Tokens | Verwendung |
|---|---|---|
| Farben | `--accent-blue`, `--accent-cyan`, `--accent-purple` | Basis-Farbpalette |
| Theme | `--theme-accent`, `--theme-accent-soft`, `--theme-accent-strong` | Primäre UI-Farben |
| Komplementär | `--theme-complement`, `--theme-complement-soft` | Sekundäre Akzente |
| Text | `--text-muted`, `--text-secondary` | Schriftfarben |
| Borders | `--border-lit` | Beleuchtete Ränder |

### Regeln

| Regel | Begründung |
|---|---|
| ✅ CSS-Variablen via `setProperty()` setzen, nie via Inline-`style=""` | Token-System bleibt konsistent |
| ✅ Alle Farbwerte in Templates als `var(--token)` referenzieren | Theme-Switching funktioniert automatisch |
| ❌ Keine hardcodierten `#hex`-Farben in Template-Strings | Bricht Theme-Switching |
| ✅ Neue Design-Token in `applyUiTheme()` definieren | Einzige Source of Truth für Farben |

**Beispiel in Mustache-Template:**
```html
<!-- ✅ Richtig -->
<span class="battle-time" style="color:var(--text-muted)">{{{createdAt}}}</span>

<!-- ❌ Falsch -->
<span class="battle-time" style="color:#8899aa">{{{createdAt}}}</span>
```

---

## 7. Vorteile & Nachteile

### Hybrides Modell – Vorteile

| Vorteil | Details |
|---|---|
| **Klare Trennung** | Jede Schicht hat eine definierte Verantwortung; weniger Debugging-Aufwand |
| **XSS-Schutz** | Mustache `{{ }}` escaped automatisch; `esc()` für Fallback-Renderer |
| **Wiederverwendbarkeit** | Templates in `<template>`-Tags sind im DevTools sichtbar und testbar |
| **Theme-fähig** | CSS-Token-System erlaubt Farbwechsel ohne Template-Änderungen |
| **Offline-fähig** | Mustache lokal → kein CDN-Ausfall bricht die UI |
| **Lesbarkeit** | HTML-Struktur in `<template>`-Tags ist lesbarer als JS-Strings |

### Hybrides Modell – Nachteile / Risiken

| Nachteil | Mitigierung |
|---|---|
| **Migrations-Aufwand** | 128 rohe `innerHTML`-Stellen müssen schrittweise migriert werden |
| **Zwei Escaping-Ebenen** | `esc()` für GQUI/raw-DOM, Mustache `{{ }}` für Template-Rendering – Entwickler müssen wissen welcher Weg gerade aktiv ist |
| **Mustache kein Two-Way-Binding** | Für reaktive UIs (Echtzeit-Updates) bleibt `GQUI`-Rebuild notwendig |
| **`<template>`-Inhalt nicht durch Mustache verarbeitet** | `.innerHTML` muss explizit ausgelesen werden vor `renderInlineTemplate()` |
| **Kein Typ-System** | Template-Variablen sind ungetypt – Tippfehler in `{{{vesselListHtm}}}` (statt `{{{vesselListHtml}}}`) werden zur Laufzeit lautlos zu leerem String |

### Vergleich der Alternativen

| Alternative | Vorteil | Warum abgelehnt |
|---|---|---|
| **Nur PHP Twig** | Vollständiges serverseitiges Templating | SPA-Architektur – fast alle Daten kommen via AJAX; Twig wäre für 95% der UI-Updates blind |
| **Nur JS Template-Literals** | Zero-Dependency | Bereits 128 Stellen aktiv – kein Escaping-Standard, XSS-anfällig |
| **Vue/React/Lit** | Reaktives Two-Way-Binding | Komplette Rewrite nötig; nicht im Scope |
| **Nur Mustache** | Einheitlich | PHP-Layer für Build-Info ist sinnvoll und bereits funktioniert |
| **Hybrids (diese Vorgabe)** | Bestehende Infrastruktur nutzen + konsolidieren | **Gewählt** |

---

## 8. Verbotene Muster

```javascript
// ❌ Raw innerHTML mit User-Daten ohne Escaping
element.innerHTML = `<div>${userData.name}</div>`;

// ❌ Mustache Triple-Stache für unkontrollierte User-Strings
renderInlineTemplate('<div>{{{username}}}</div>', { username: userInput });

// ❌ PHP {{variable}} für User-Daten
// renderTemplate($html, ['username' => $_GET['name']]); // NEVER

// ❌ Template-String im Konstruktor (schwer wartbar)
this.templates = { row: `<div>{{{id}}}</div>` };

// ❌ Hardcodierte Hex-Farben in Templates
`<span style="color:#8899aa">${value}</span>`
```

```javascript
// ✅ Mustache Double-Stache für User-Strings (automatisches Escaping)
renderInlineTemplate('<div>{{ username }}</div>', { username: userInput });

// ✅ Template aus <template>-Tag lesen + Mustache rendern
const tpl = document.getElementById('tpl-row').innerHTML;
list.innerHTML = renderInlineTemplateList(tpl, rows);

// ✅ GQUI für einmalige DOM-Konstruktion
GQUI.div({ class: 'row' }, GQUI.span({}, data.name));

// ✅ CSS-Token statt Hardcode
`<span style="color:var(--text-muted)">${esc(value)}</span>`
```

---

## 9. Migrations-Checkliste

Schrittweise Migration der 128 rohen `innerHTML`-Stellen:

- [ ] **Prio 1 – Sicherheit:** Alle `innerHTML`-Stellen mit User-Eingaben (Namen, Nachrichten, Suchbegriffe) auf `renderInlineTemplate()` mit `{{ }}` umstellen
- [ ] **Prio 2 – Templates auslagern:** `this.templates = {...}` aus Konstruktoren in `<template id="tpl-*">`-Tags in `index.html` verschieben  
- [ ] **Prio 3 – Mustache lokal:** `mustache.min.js` als `js/vendor/mustache.min.js` einbetten; CDN-Link aus `index.html` entfernen
- [ ] **Prio 4 – CSS-Token:** Hardcodierte `#hex`-Farben in Template-Strings auf `var(--token)` umstellen
- [ ] **Prio 5 – Doku:** `docs/INDEX.md` mit diesem Dokument verlinken

---

*Dieses Dokument ist die verbindliche Vorgabe für alle Template-Entscheidungen im Projekt.*  
*Bei Unklarheiten: [ARCHITECTURE.md](ARCHITECTURE.md) für Kontext, [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md) für geplante Änderungen.*
