/**
 * RuntimeViewHyperlinksUsageGuide.md
 *
 * ## How to Use View Hyperlinks in Your Renderers
 *
 * ### 1. Bind Hyperlinks to a Container
 *
 * After rendering your view HTML, call:
 *
 * ```javascript
 * ViewHyperlinks.bindAll(container);
 * ```
 *
 * Example in RuntimeColonyViewController.js:
 *
 * ```javascript
 * function renderColonyView(root) {
 *   // ... render your HTML ...
 *   root.innerHTML = `
 *     <h2>Colony Management</h2>
 *     <button class="view-link" data-open-window="buildings">
 *       View Buildings
 *     </button>
 *     <button class="view-link" data-open-window="research">
 *       View Research
 *     </button>
 *   `;
 *
 *   // Bind the hyperlinks
 *   const viewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
 *   if (viewHyperlinks) {
 *     viewHyperlinks.bindAll(root);
 *   }
 * }
 * ```
 *
 * ### 2. Use data-open-window Attribute
 *
 * Any element with `data-open-window="windowId"` becomes a clickable link:
 *
 * ```html
 * <button data-open-window="economy">Economics</button>
 * <a href="#" data-open-window="messages">Messages</a>
 * <div class="card" data-open-window="wormholes">Wormholes</div>
 * ```
 *
 * ### 3. Create Action Buttons Programmatically
 *
 * ```javascript
 * const viewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
 *
 * const fragment = viewHyperlinks.createActionButtonsFor({
 *   actions: [
 *     { label: 'View Colony', windowId: 'colony', className: 'btn-primary' },
 *     { label: 'View Buildings', windowId: 'buildings', className: 'btn-secondary' },
 *   ]
 * });
 *
 * root.appendChild(fragment);
 * viewHyperlinks.bindAll(root);
 * ```
 *
 * ### 4. Auto-Generate Related Window Actions
 *
 * Based on NavigationSequences, auto-generate action buttons:
 *
 * ```javascript
 * const viewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
 *
 * const relatedActions = viewHyperlinks.createRelatedActionsFor('economy');
 * // Returns: [
 * //   { label: 'Open ECONOMY-FLOW', windowId: 'economy-flow', ... },
 * //   { label: 'Open TRADE', windowId: 'trade', ... },
 * // ]
 *
 * const fragment = viewHyperlinks.createActionButtonsFor({ actions: relatedActions });
 * root.appendChild(fragment);
 * viewHyperlinks.bindAll(root);
 * ```
 *
 * ### 5. Direct Window Opening
 *
 * Open a window programmatically:
 *
 * ```javascript
 * const viewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
 * viewHyperlinks.openWindow('colony');
 * ```
 *
 * ---
 *
 * ## Navigation Sequences (Auto Open Related Windows)
 *
 * When you open a primary window, dependent windows open automatically (if enabled):
 *
 * **Example Sequences:**
 * - Open `colony` → auto-open `buildings`, `research` (sequentially, 200ms apart)
 * - Open `economy` → auto-open `economy-flow`, `trade` (sequentially)
 * - Open `messages` → auto-open `intel`, `leaderboard` (in parallel)
 *
 * Users can disable this in settings: `autoOpenRelatedViews` flag.
 *
 * **To Add New Sequence:**
 *
 * Edit RuntimeNavigationSequences.js:
 *
 * ```javascript
 * const sequences = {
 *   myPrimaryWindow: {
 *     title: 'My Window Stack',
 *     windows: ['dependent1', 'dependent2'],
 *     parallel: false,  // or true for parallel opens
 *     delay: 200,       // ms between opens
 *   },
 *   // ...
 * };
 * ```
 *
 * Then call:
 *
 * ```javascript
 * window.GQNavigationSequences?.registerSequence('myPrimaryWindow');
 * ```
 *
 * ---
 *
 * ## View Hierarchy (Tier-Based)
 *
 * See RuntimeDesktopShell.js buildDefinitions() for the full hierarchy:
 *
 * **TIER 0:** System (galaxy, console)
 * **TIER 1:** Primary navigation (overview, quicknav, nav-orb, minimap)
 * **TIER 2a:** Colony (colony, buildings, research, shipyard, fleet)
 * **TIER 2b:** Exploration (wormholes, galaxy-info)
 * **TIER 2c:** Intelligence (messages, intel, factions, alliances, wars, leaders, leaderboard)
 * **TIER 2d:** Economy (economy, economy-flow, trade, trade-routes, traders)
 * **TIER 2e:** Threats (pirates, conflict)
 * **TIER 2f:** Misc (quests)
 * **TIER 3:** Settings (settings, sidebars)
 *
 * ---
 *
 * ## CSS Classes for Hyperlinks
 *
 * Default class: `view-link`
 * Container class: `view-hyperlinks-group`
 *
 * Customize with:
 *
 * ```css
 * .view-link {
 *   cursor: pointer;
 *   padding: 0.5rem 1rem;
 *   border: 1px solid #ccc;
 *   border-radius: 4px;
 *   background: #f5f5f5;
 *   transition: all 0.2s ease;
 * }
 *
 * .view-link:hover {
 *   background: #e0e0e0;
 *   transform: translateY(-2px);
 * }
 *
 * .view-link:active {
 *   transform: translateY(0);
 * }
 * ```
 */
