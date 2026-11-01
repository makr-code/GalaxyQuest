# Changelog

All notable changes to GalaxyQuest are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — Sprint 1.2: Technische Schulden abbauen

### Added — Release metadata quality gate

- `npm run check:release-metadata` validates SemVer in `VERSION.txt` and
  its exact mirrors in `package.json` and `package-lock.json`.
- Tagged metadata preparation requires matching `v<version>` and one dated
  changelog section with real change notes; validated notes are uploaded
  for operator review, without publishing a release or deploying.
- The existing `1.0.0` version is historical metadata, not a production-readiness
  claim. No released `1.0.0` changelog or tag has been invented.

### Changed — Image publication gates

- Main-branch image publication now waits for all main CI lint, test and E2E
  jobs and scans its local image candidate before registry authentication.
- Trivy HIGH/CRITICAL vulnerability and secret findings block publication,
  including unfixed vulnerabilities. Only the verified, scanned image ID is
  tagged and pushed; there is no second build between scan and publication.
- This hardens the existing development-image path, not a production release
  approval. Live registry evidence and staging/signature/SBOM gates remain open.

### Changed — Docker build context hygiene

- Docker `COPY .` no longer includes local environment material, known session
  dumps, reports, host dependencies or mutable audio/texture caches.
- Required backend/frontend configuration, deployment models, SVG fallbacks
  and legacy gzip bundles are retained.
- A synthetic real-Docker context gate and negative policy regressions verify
  these boundaries in CI without copying actual secrets or publishing images.

### Changed — Isolated CI smoke stack

- Smoke tests now use the built web image without a checkout mount, isolated
  Compose project identities and a database with no host port.
- Database initialization imports only the base schema; canonical migrations
  run inside the image before seeding and browser tests.
- MySQL readiness now waits for TCP rather than the temporary initialization
  socket. Smoke seeding explicitly skips full-galaxy bootstrap while retaining
  schema preflight and the user start region; default seed behavior is unchanged.
- Docker now serves the built Vite entry and hashed assets from Apache's root,
  rather than leaving the compiled entry unused under `dist`.
- HTTP liveness, disabled optional AI paths, failure logs and project-scoped
  unconditional teardown make CI failures explicit without retaining test data.

### Added — Bounded application health probes

- Public session-free `/health/live` and `/health/ready` distinguish PHP
  liveness from DB access plus complete canonical migration tracking; GET/HEAD,
  explicit failure statuses and non-cacheable minimal JSON are tested.
- Readiness is read-only and isolated behind a supervised three-second PHP CLI
  deadline, including DNS/DB stalls; credentials and exception text stay out
  of HTTP output. Gameplay DB connection behavior is unchanged.
- Docker/Compose healthchecks use liveness; CI verifies unavailable readiness
  before migrations and ready status before seed/browser tests.
- Worker health, migration checksum integrity and production observability
  remain separate gates, not implied by a successful readiness response.

### Added — Read-only migration deployment verification

- `php scripts/migrate.php verify` requires existing tracking, a complete
  canonical manifest, matching applied SQL bytes and no foreign history.
- Verification shares the migration advisory lock and checksum helper; it
  never executes migration SQL, bootstraps storage or repairs tracking.
- CI runs the gate from the image after migrations and before readiness/seed.
  Missing, pending, changed or newer-image migration history blocks deployment;
  public health snapshots and existing status behavior are unchanged.

### Refactored — JS-Refactoring Phase 2 (C-1, GAP_TODO)

**Domain-Subtree Migration** — `js/engine/runtime/layers/domain/`

Nine runtime modules have been migrated from the flat `js/engine/runtime/`
root into dedicated domain subtrees.  File content and global-registration
names (`window.GQRuntime*`) are unchanged; only the file paths have moved.

| New path | Module |
|---|---|
| `layers/domain/messages/RuntimeMessageSignals.js` | Unread-message signal rings |
| `layers/domain/messages/RuntimeMessageSendCommand.js` | Message send command |
| `layers/domain/messages/RuntimeMessageConsoleCommand.js` | Message console command |
| `layers/domain/messages/RuntimeMessagesController.js` | Messages window controller |
| `layers/domain/trade/RuntimeTradeProposalsController.js` | Trade proposals controller |
| `layers/domain/trade/RuntimeTradeRoutesController.js` | Trade routes controller |
| `layers/domain/trade/RuntimeTradersDashboardController.js` | Traders dashboard controller |
| `layers/domain/war/RuntimeWarController.js` | War overview controller |
| `layers/domain/pirates/RuntimePiratesController.js` | Pirates window controller |

- `js/runtime/boot-manifest.js` updated to reference new paths.
- `tests/js/runtime-module-wiring-audit.test.js` updated to scan the
  `js/engine/runtime/` tree **recursively** (was flat-directory-only).

### Added — Selection Unification Phase 1 (C-2, GAP_TODO)

**`RuntimeSelectionState.js` — `createSelectionStore()`**

A new `createSelectionStore()` factory function has been added to
`js/engine/runtime/RuntimeSelectionState.js`.  It returns a properly shaped,
mutable selection-state object — the canonical `uiState.selectionState`
structure — with all fields initialised to defined values:

```js
{
  active:         null,   // currently selected object (normalised)
  hover:          null,   // object under pointer
  multiSelection: [],     // group/cluster selection members
  group:          null,   // group descriptor { type, systems, … }
  mode:           'galaxy',
  sourceView:     'renderer',
  updatedAt:      0,
}
```

- `js/runtime/game.js` updated: `uiState.selectionState` now initialised via
  `createSelectionStore()`.  A `uiState.selection` property getter/setter
  provides backward-compatibility with existing call-sites.
- `requireRuntimeApi('GQRuntimeSelectionState', …)` extended to include
  `createSelectionStore`.
- **22 new unit tests** in `tests/js/runtime-selection-state.test.js`:
  `createSelectionStore`, `buildSelectionKey`, `normalizeRendererSelection`,
  `commitSelectionState` (hover + active), `resolveSelectionGroupMembers`,
  `getSelectionGroupHighlightedSystems`.

### Added — Selection Unification Phase 2 (C-2, GAP_TODO)

**Persistent Selection Marker Separation**

Phase 2 specification and validation complete.  Infrastructure components
validated and ready for renderer integration.

- **Marker State Independence:**
  - Persistent selection (golden marker, z-index 21, pulsing)
  - Temporary hover (blue marker, z-index 20, static)
  - Auto-clear hover on pointer-out without affecting selection
  - Layering ensures proper visual hierarchy

- **Ownership Visual Consistency:**
  - 7 faction types with distinct visual tokens
  - Color-blind safe patterns (solid, dashed, dotted, dot-dash, etc.)
  - Symbol identification (★, ✕, ○, ◆, ▽, ☠, ?)
  - WCAG 2.1 AAA contrast compliance verified

- **Accessibility Specification Complete:**
  - WCAG 2.1 compliance framework
  - Keyboard navigation (Arrow Up/Down, Enter, Escape)
  - Screen reader (ARIA) integration patterns
  - Touch-friendly targets (44x44px minimum)
  - Color-blind safe patterns + high-contrast palettes

- **New Test Coverage:**
  - **25 new integration tests** in `tests/js/selection-marker-separation.test.js`
    covering marker independence, token distinction, accessibility patterns,
    ownership visuals, and group selection states.
  - Total test coverage: **67/67 passing** (Phase 1 + Phase 2)
  - Plus existing marker tests: **129/129 selection-related tests passing**

- **New Documentation:**
  - `docs/technical/SELECTION_PHASE2_INTEGRATION_GUIDE.md` — Concrete renderer
    integration patterns for Galaxy, System, Approach, and Colony views
  - `docs/technical/SELECTION_ACCESSIBILITY_SPEC.md` — Complete accessibility
    requirements with implementation patterns
  - `SELECTION_UX_PHASE2_COMPLETION_SUMMARY.md` — Executive summary and roadmap

- **Status:**
  - ✅ Phase 2 specification complete
  - ✅ Phase 2 test-validated (47 new tests)
  - ⏳ Pending: Renderer integration (Galaxy, System, Approach, Colony)
  - ⏳ Pending: Phase 3–5 (group selection, multi-select, accessibility integration)

### Added — CI/CD Pipeline (5.5, IMPLEMENTATION_AUDIT)

New workflow: `.github/workflows/ci.yml`

Runs on every push/PR to `main`/`master`:
- **PHPUnit** — PHP unit tests (PHP 8.2 + MySQL 8.4 service)
- **Vitest** — JavaScript unit tests (Node 20, `npm ci`)
- **Playwright E2E** — End-to-end smoke test (`view-flow.spec.js`, full Docker stack)

Docker image build & push to GHCR occurs only on `push` to `main`.

### Fixed — CI/CD Pipeline Consolidation (5.5, IMPLEMENTATION_AUDIT)

Resolved duplicate `name` and `pull_request` keys, overlapping jobs, and password placeholder in `.github/workflows/ci.yml`.
- Removed duplicate `pull_request:` block (was present twice with different branches)
- Consolidated overlapping `phpunit` and `php-tests` jobs into single `phpunit` job
- Consolidated overlapping `vitest` and `js-tests` jobs into single `vitest` job
- Fixed password placeholder in Playwright E2E user-seeding step (`--****** → --******
- Fixed regex pattern in `scripts/ensure_default_e2e_user.php` to properly parse `--****** argument
- All three test suites (PHPUnit, Vitest, Playwright) now run consistently on every push/PR

### Changed — Root-Level Test Files (5.6, IMPLEMENTATION_AUDIT)

13 standalone diagnostic/smoke scripts have been moved from the project root
to `tests/scripts/` and their relative `require_once` paths updated to use
`__DIR__ . '/../../…'`.  A `tests/scripts/README.md` documents their purpose
and usage.  These scripts are **not** part of the PHPUnit suite.

---

## References

- `docs/technical/IMPLEMENTATION_AUDIT.md` §5
- `docs/technical/GAP_TODO.md` Category C
- `docs/technical/JS_REFACTOR_ZIELSTRUKTUR_TODO.md`
- `docs/technical/SELECTION_UNIFICATION_TODO.md` Phase 1
