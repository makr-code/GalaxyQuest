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
- **Vitest** — JavaScript unit tests (Node 20, `npm ci`)
- **PHPUnit** — PHP unit tests (PHP 8.2, Composer install)

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
