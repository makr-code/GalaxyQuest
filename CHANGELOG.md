# Changelog

All notable changes to GalaxyQuest are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — Sprint 1.2: Technische Schulden abbauen

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
