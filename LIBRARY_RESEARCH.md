# 📚 GalaxyQuest – Library & Best Practice Research

Gezielte Recherche nach Libraries und GitHub-Repos für Python, PHP, JavaScript, CSS, XHTML für GalaxyQuest.

---

## 🐍 PYTHON (Kopilot Standards: FastAPI + Pydantic + Structlog)

### Aktuell Verwendet
- `fastapi` (0.111.0+) – Web Framework
- `uvicorn` (0.29.0+) – ASGI Server
- `httpx` (0.27.0+) – Async HTTP Client
- `pydantic-settings` (2.1.0+) – Config Management
- `structlog` (23.2.0+) – Structured Logging
- `piper-tts` (1.2.0) – TTS Engine
- `aiofiles` (23.2.1+) – Async File I/O
- `pytest` + `pytest-asyncio` – Testing

### ✅ Empfohlen (Alignment mit Standards)

| Library | Zweck | Begründung | GitHub |
|---------|-------|-----------|--------|
| `typing-extensions` | Enhanced Type Hints (Python <3.10) | Protocol support, TypedDict, etc. | [python/typing_extensions](https://github.com/python/typing_extensions) |
| `msgspec` | Fast, Zero-Copy Serialization | Schneller als pydantic für große Payloads | [jcrist/msgspec](https://github.com/jcrist/msgspec) |
| `orjson` | Fast JSON encoding/decoding | Pydantic-kompatibel, 5-10x schneller | [ijl/orjson](https://github.com/ijl/orjson) |
| `aiodns` | Async DNS resolver | Für async HTTP-Clients ohne Blocking | [saghul/aiodns](https://github.com/saghul/aiodns) |
| `python-dotenv` | .env Fallback | Vor pydantic-settings für Dev-Fallback | [theskumar/python-dotenv](https://github.com/theskumar/python-dotenv) |
| `tenacity` | Async Retry Logic | Für HTTP-Timeouts + Backoff Strategies | [jd/tenacity](https://github.com/jd/tenacity) |
| `prometheus-client` | Metrics/Observability | Standard für FastAPI-Health-Checks | [prometheus/client_python](https://github.com/prometheus/client_python) |
| `opentelemetry-api` | Distributed Tracing | Standardized Logging/Tracing für Microservices | [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python) |
| `pydantic[email]` | Email Validation | Built-in, nutze Pydantic-V2 EmailStr | [pydantic/pydantic](https://github.com/pydantic/pydantic) |

### 🎓 Best Practice GitHub-Repos zum Lernen

| Repo | Zweck | Warum Lernen? |
|------|-------|---------------|
| [encode/starlette](https://github.com/encode/starlette) | FastAPI-Basis | Middleware Patterns, Request Handling |
| [pydantic/pydantic](https://github.com/pydantic/pydantic) | Validation Gold Standard | V2 Architecture, Validators, Serializers |
| [hynek/attrs](https://github.com/hynek/attrs) | Dataclass Alternative | Cleaner API als dataclass, Type Safety |
| [tiangolo/fastapi](https://github.com/tiangolo/fastapi) | FastAPI (Quelle) | Dependency Injection, Async Patterns |
| [encode/httpx](https://github.com/encode/httpx) | HTTP Client (Quelle) | Request/Response Lifecycle, Async |
| [gvanrossum/pep-0492](https://github.com/gvanrossum/pep-0492) | Async/Await Reference | Understanding async semantics |
| [alex-sherman/pydantic-settings](https://github.com/pydantic/pydantic-settings) | Config Management | Environment Variable Handling |

---

## 🐘 PHP (Backend: OOP + Type Hints + Clean Code)

### Aktuell Verwendet
- `phpunit` (11+) – Testing

### ✅ Empfohlen (Modern PHP 8.2+)

| Library | Zweck | Begründung | GitHub |
|---------|-------|-----------|--------|
| **symfony/console** | CLI Tools Framework | Für Backend-Scripts (bessere Option als rawes PHP) | [symfony/console](https://github.com/symfony/console) |
| **symfony/var-dumper** | Better Debug Output | IDE-aware `dump()` replacement für `var_dump()` | [symfony/var-dumper](https://github.com/symfony/var-dumper) |
| **monolog/monolog** | Structured Logging (PHP) | PSR-3 Standard, Multi-Handler Support | [Seldaek/monolog](https://github.com/Seldaek/monolog) |
| **guzzlehttp/guzzle** | HTTP Client | Falls PHP-zu-Python-API-Calls nötig | [guzzle/guzzle](https://github.com/guzzle/guzzle) |
| **phpdotenv** | .env Loading | Sichere Config in PHP Scripts | [vlucas/phpdotenv](https://github.com/vlucas/phpdotenv) |
| **php-standards/fig-standards** | PSR Standards | Reference für PSR-3 (Logging), PSR-4 (Autoloading) | [php-fig/fig-standards](https://github.com/php-fig/fig-standards) |
| **vimeo/psalm** | Static Type Checker | Für Type Hints in PHP (Alternative: PHPStan) | [vimeo/psalm](https://github.com/vimeo/psalm) |
| **phpstan/phpstan** | Static Analysis | Catch bugs before runtime | [phpstan/phpstan](https://github.com/phpstan/phpstan) |
| **squizlabs/php_codesniffer** | Code Style Enforcer | PSR-12 Standard Enforcement | [squizlabs/PHP_CodeSniffer](https://github.com/squizlabs/PHP_CodeSniffer) |

### 🎓 Best Practice GitHub-Repos (PHP)

| Repo | Zweck | Warum? |
|------|-------|--------|
| [laravel/framework](https://github.com/laravel/framework) | Full-Stack Framework | Service Container, Dependency Injection Patterns |
| [symfony/symfony](https://github.com/symfony/symfony) | Component-Based Framework | Reusable Components, PSR Compliance |
| [nikic/PHP-Parser](https://github.com/nikic/PHP-Parser) | Abstract Syntax Tree | Understanding PHP parsing/transformation |
| [doctrine/orm](https://github.com/doctrine/orm) | ORM Pattern | Database Abstraction, Query Builder |
| [PSR Specs](https://www.php-fig.org/psr/) | PHP Standards | PSR-3 (Logging), PSR-4 (Autoloading), PSR-12 (Style) |

---

## 🎨 JavaScript / Frontend (Vanilla ES6+, no frameworks)

### Aktuell Verwendet
- `vitest` (4.1.3+) – Testing
- `@playwright/test` (1.62.1+) – E2E Testing
- `jsdom` (24.1.3+) – DOM Simulation
- `three.js` – 3D Graphics (Galaxy Renderer)
- `tone.js` – Web Audio API
- `dexie` – IndexedDB Wrapper
- `mustache` – Templating
- `fetch-event-source` – Server-Sent Events

### ✅ Empfohlen (Vanilla JS Stack Enhancement)

| Library | Zweck | Begründung | GitHub |
|---------|-------|-----------|--------|
| **zod** | Runtime Validation (TypeScript-free) | Alternative zu Pydantic für Client-side Validation | [colinhacks/zod](https://github.com/colinhacks/zod) |
| **typebox** | JSON Schema + Type Generation | Type-safe Runtime Validation (Zero-runtime overhead) | [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox) |
| **loglevel** | Lightweight Logging | Structured Browser Logs (namespace support) | [pimterry/loglevel](https://github.com/pimterry/loglevel) |
| **idb** | Modern IndexedDB API | Better Dexie alternative (smaller, simpler) | [jakearchibald/idb](https://github.com/jakearchibald/idb) |
| **lit** | Lightweight Web Components | Minimal reactive component framework | [lit/lit](https://github.com/lit/lit) |
| **petite-vue** | Minimal Vue (2KB) | Progressive enhancement without SPA overhead | [vuejs/petite-vue](https://github.com/vuejs/petite-vue) |
| **htmx** | HTML Attributes for AJAX | Seamless Server-Client interaction pattern | [bigskysoftware/htmx](https://github.com/bigskysoftware/htmx) |
| **sortablejs** | Drag & Drop Lists | Reorderable UI elements | [SortableJS/Sortable](https://github.com/SortableJS/Sortable) |
| **chart.js** | Data Visualization | Simple Charts (für Economy/War Statistics) | [chartjs/Chart.js](https://github.com/chartjs/Chart.js) |
| **wavesurfer.js** | Audio Visualization | TTS Audio Waveform Display | [katspaugh/wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) |
| **eta** | Lightweight Template Engine | Faster than Mustache (ETA embedded templating) | [eta-dev/eta](https://github.com/eta-dev/eta) |

### 🎓 Best Practice GitHub-Repos (JavaScript)

| Repo | Zweck | Warum? |
|------|-------|--------|
| [mdn/dom-examples](https://github.com/mdn/dom-examples) | MDN Code Examples | Best Practices for DOM Manipulation |
| [trekhleb/javascript-algorithms](https://github.com/trekhleb/javascript-algorithms) | Algorithm Implementations | Data Structures, Efficient JS Code |
| [goldbergyoni/javascript-testing-best-practices](https://github.com/goldbergyoni/javascript-testing-best-practices) | Testing Patterns | Unit/E2E/Integration Test Strategies |
| [airbnb/javascript](https://github.com/airbnb/javascript) | JS Style Guide | ES6+ Best Practices, Naming Conventions |
| [getify/You-Dont-Know-JS](https://github.com/getify/You-Dont-Know-JS) | JS Deep Dive | Scope, Closure, Async, Promises, async/await |
| [tc39/proposals](https://github.com/tc39/proposals) | ECMAScript Proposals | Bleeding-edge JS Features (TC39 Process) |
| [mdn/js-examples](https://github.com/mdn/js-examples) | Mozilla JS Examples | Web APIs, Game Development Patterns |

---

## 🎨 CSS / Styling (Vanilla CSS + No Frameworks)

### Aktuell Verwendet
- Vanilla CSS (no preprocessor)

### ✅ Empfohlen

| Library/Tool | Zweck | Begründung | GitHub |
|---------|-------|-----------|--------|
| **Open Props** | CSS Variables Framework | Pre-built semantic variables (colors, spacing) | [argyleink/open-props](https://github.com/argyleink/open-props) |
| **pico.css** | Minimal CSS Framework | Classless CSS (nur HTML Semantik nötig) | [picocss/pico](https://github.com/picocss/pico) |
| **water.css** | Typography-focused CSS | Nice defaults für Text-basierte Interfaces | [kognise/water.css](https://github.com/kognise/water.css) |
| **Normalize.css** | Cross-browser Baseline | Konsistente Browser-Defaults (18 KB) | [necolas/normalize.css](https://github.com/necolas/normalize.css) |
| **Lightning CSS** | CSS Processing | Ultra-fast CSS transpiler (autoprefixer, minify) | [parcel-bundler/lightningcss](https://github.com/parcel-bundler/lightningcss) |
| **PostCSS** | CSS Transformation Tool | Plugins für Autoprefixer, Nesting, etc. | [postcss/postcss](https://github.com/postcss/postcss) |
| **CSS Containment** | Performance | `@container` queries für responsive design | [CSS Working Group Draft](https://drafts.csswg.org/css-contain/) |

### 🎓 Best Practice GitHub-Repos (CSS)

| Repo | Zweck | Warum? |
|------|-------|--------|
| [mdn/css-examples](https://github.com/mdn/css-examples) | MDN CSS Examples | Complete CSS Pattern Library |
| [You-Dont-Need/You-Dont-Need-JavaScript](https://github.com/You-Dont-Need/You-Dont-Need-JavaScript) | CSS Capabilities | Solve problems with CSS instead of JS |
| [csstools/cssdb](https://github.com/csstools/cssdb) | CSS Spec Tracker | Next-Gen CSS Features Status |
| [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | Utility-First CSS | Alternative Pattern (nicht aktiv genutzt, aber lehrreich) |

---

## 🏗️ XHTML / HTML (Semantic Web)

### Aktuell Verwendet
- Vanilla HTML5 (keine Templates außer Mustache)

### ✅ Empfohlen

| Standard/Tool | Zweck | Begründung | GitHub |
|---------|-------|-----------|--------|
| **WAI-ARIA** | Accessibility Spec | Screen Reader Support, Keyboard Navigation | [w3c/aria](https://github.com/w3c/aria) |
| **HTML5 Boilerplate** | HTML Template | Best-practice HTML5 structure | [h5bp/html5-boilerplate](https://github.com/h5bp/html5-boilerplate) |
| **Axe DevTools** | Accessibility Testing | Automated a11y audit | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) |
| **Semantic HTML Reference** | HTML Standards | Proper `<article>`, `<nav>`, `<section>` usage | [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Element) |
| **schema.org** | Structured Data | JSON-LD for Search Engines | [schemaorg/schema.org](https://github.com/schemaorg/schema.org) |

---

## 🔧 DevOps / Infrastructure

### Aktuell Verwendet
- Docker + Docker Compose (PHP, MySQL, FastAPI, ComfyUI)
- PHP OPCache
- MySQL 8.4

### ✅ Empfohlen

| Tool | Zweck | Begründung | GitHub |
|------|-------|-----------|--------|
| **pytest-cov** (Python) | Code Coverage | Measure test coverage % | [pytest-dev/pytest-cov](https://github.com/pytest-dev/pytest-cov) |
| **codecov** | Coverage CI/CD | Track coverage over commits | [codecov/codecov-python](https://github.com/codecov/codecov-python) |
| **pre-commit** | Git Hooks | Lint/Format before commit | [pre-commit/pre-commit](https://github.com/pre-commit/pre-commit) |
| **docker-slim** | Docker Optimization | Reduce image size 10-50x | [slimtoolkit/slim](https://github.com/slimtoolkit/slim) |
| **distroless** | Minimal Base Images | Security + Size (0 shell, no package manager) | [GoogleContainerTools/distroless](https://github.com/GoogleContainerTools/distroless) |
| **trivy** | Vulnerability Scanner | Scan Docker images + dependencies | [aquasecurity/trivy](https://github.com/aquasecurity/trivy) |

---

## 📊 Testing & Quality Assurance

### Best Practice GitHub-Repos

| Repo | Fokus | Lern-Wert |
|------|-------|-----------|
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest) | Unit Testing (JS) | Vite-native testing, Performance |
| [microsoft/playwright](https://github.com/microsoft/playwright) | E2E Testing | Cross-browser automation, API |
| [pytest-dev/pytest](https://github.com/pytest-dev/pytest) | Testing Framework (Python) | Fixtures, Plugins, Best Practices |
| [phpunit/phpunit](https://github.com/phpunit/phpunit) | Testing (PHP) | Assertions, Mocking, Fixtures |
| [testcontainers/testcontainers-python](https://github.com/testcontainers/testcontainers-python) | Container Integration Tests | Database/Service Mocking in Tests |

---

## 🚀 Architecture Patterns & Learning

### Essential GitHub-Repos for GalaxyQuest Architecture

| Repo | Zweck | Relevanz für GalaxyQuest |
|------|-------|------------------------|
| [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices) | Node.js Patterns | Async Patterns, Error Handling, Logging |
| [joelparkerhenderson/architecture-decision-records](https://github.com/joelparkerhenderson/architecture-decision-records) | ADR Template | Document Technical Decisions |
| [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer) | System Design | Scaling, Database Patterns, Microservices |
| [bmorelli25/Ethical-Hacking-Tools](https://github.com/bmorelli25/Ethical-Hacking-Tools) | Security Auditing | Security Best Practices |
| [OWASP/Top10](https://github.com/OWASP/Top10) | Web Security | SQL Injection, XSS, CSRF Prevention |

---

## 📋 Action Items / Next Steps

### Priority 1 (Immediate)
- [ ] Add `zod` or `typebox` for client-side validation
- [ ] Add `loglevel` for better console logging
- [ ] Add `pytest-asyncio` improvements to Python test suite
- [ ] Integrate `httpx` timeout defaults into TTS service

### Priority 2 (Mid-term)
- [ ] Setup `pre-commit` hooks for linting/formatting
- [ ] Integrate `prometheus-client` for TTS service metrics
- [ ] Add `pytest-cov` to measure Python test coverage
- [ ] Explore `opentelemetry` for distributed tracing

### Priority 3 (Long-term)
- [ ] Consider migration to `pydantic-v2` serialization patterns
- [ ] Evaluate `htmx` for real-time updates in UI
- [ ] Setup `trivy` for security scanning in CI/CD
- [ ] Document architectural decisions via ADRs

---

## 📚 Key Learning Resources

### JavaScript/Frontend
1. [MDN Web Docs](https://developer.mozilla.org/) – Official Reference
2. [Web.dev by Google](https://web.dev/) – Performance, Accessibility, Best Practices
3. [WHATWG Standards](https://whatwg.org/) – HTML, DOM, Fetch API Specs

### Python
1. [Real Python](https://realpython.com/) – Comprehensive Tutorials
2. [Python Enhancement Proposals (PEPs)](https://peps.python.org/) – Language Standards
3. [FastAPI Documentation](https://fastapi.tiangolo.com/) – Official Docs

### PHP
1. [PHP Official Documentation](https://www.php.net/docs.php) – Reference
2. [Modern PHP (Book)](https://www.oreilly.com/library/view/modern-php/9781491905173/) – Best Practices
3. [Symfony Docs](https://symfony.com/doc) – Framework Patterns

### General
1. [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html) – Command Query Responsibility Segregation
2. [Microservices Patterns](https://microservices.io/) – Architecture Patterns
3. [12 Factor App](https://12factor.net/) – SaaS Application Guidelines

---

**Zuletzt aktualisiert:** 2026-08-01
**Status:** Research Complete ✅
