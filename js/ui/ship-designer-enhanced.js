/**
 * Ship Designer – Enhanced Integration mit Backend Base Assets
 * 
 * Neue Features:
 * 1. Base asset browser (canonical components per faction)
 * 2. Component assembly (player selects which to use)
 * 3. Customization details
 * 4. Optional TRELLIS2 refinement
 * 
 * File: js/ui/ship-designer-enhanced.js
 */

/**
 * Enhanced Ship Designer UI
 * 
 * Usage:
 *   const ui = createShipDesignerEnhancedUI({ container: '#designer' });
 *   ui.selectFaction('vor_tak');
 */
export function createShipDesignerEnhancedUI(opts = {}) {
    const {
        container = '#ship-designer',
        apiBase = '/api',
        onShipGenerated = null,
    } = opts;

    const root = document.querySelector(container);
    if (!root) throw new Error(`Container not found: ${container}`);

    // ─────────────────────────────────────────────────────────────────────

    let state = {
        factions: [],
        selectedFaction: null,
        baseAssets: null,
        shipClass: 'corvette',
        shipName: 'Unnamed Vessel',
        selectedComponents: {
            weapons: null,
            engines: null,
            shields: null,
            sensors: null,
        },
        customDetails: '',
        refinementJobId: null,
        refinementProgress: 0,
    };

    // ─────────────────────────────────────────────────────────────────────
    // UI Rendering
    // ─────────────────────────────────────────────────────────────────────

    function render() {
        root.innerHTML = '';

        const mainContainer = el('div', {
            className: 'ship-designer-enhanced',
            style: 'display: grid; grid-template-columns: 250px 1fr; gap: 20px;'
        });

        // Left: Sidebar (faction selection)
        const sidebar = renderSidebar();
        mainContainer.appendChild(sidebar);

        // Right: Main workspace
        const workspace = el('div', { className: 'designer-workspace' });
        
        if (state.selectedFaction) {
            workspace.appendChild(renderFactionHeader());
            workspace.appendChild(renderComponentBrowser());
            workspace.appendChild(renderCustomizationPanel());
            workspace.appendChild(renderActionButtons());
        } else {
            workspace.innerHTML = '<p style="color: #999; text-align: center; padding: 40px;">Select a faction to begin</p>';
        }

        mainContainer.appendChild(workspace);
        root.appendChild(mainContainer);
    }

    function renderSidebar() {
        const sidebar = el('div', {
            className: 'designer-sidebar',
            style: 'border-right: 1px solid #333; padding: 20px; overflow-y: auto;'
        });

        const title = el('h2', { textContent: 'Factions' });
        sidebar.appendChild(title);

        const factionList = el('div', { style: 'display: flex; flex-direction: column; gap: 12px;' });

        const factions = [
            { code: 'vor_tak', name: '⚔ Vor\'Tak', color: '#8B4513' },
            { code: 'syl_nar', name: '🌊 Syl\'Nar', color: '#4169E1' },
            { code: 'aereth', name: '🌪 Aereth', color: '#32CD32' },
            { code: 'kryl_tha', name: '⚡ Kryl\'Tha', color: '#FFD700' },
            { code: 'zhareen', name: '🔮 Zhareen', color: '#9370DB' },
            { code: 'vel_ar', name: '🌙 Vel\'Ar', color: '#87CEEB' },
        ];

        for (const faction of factions) {
            const card = el('button', {
                className: 'faction-card',
                style: `
                    padding: 12px;
                    border: 2px solid ${state.selectedFaction === faction.code ? faction.color : '#444'};
                    background: ${state.selectedFaction === faction.code ? faction.color + '20' : '#222'};
                    color: ${faction.color};
                    cursor: pointer;
                    border-radius: 4px;
                    font-weight: bold;
                    transition: all 0.2s;
                `,
                textContent: faction.name,
                onclick: async () => {
                    state.selectedFaction = faction.code;
                    await loadBaseAssets(faction.code);
                    render();
                }
            });
            factionList.appendChild(card);
        }

        sidebar.appendChild(factionList);
        return sidebar;
    }

    function renderFactionHeader() {
        const header = el('div', {
            style: 'margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #444;'
        });

        const title = el('h1', { textContent: `${state.selectedFaction} Ship Designer` });
        header.appendChild(title);

        const shipNameInput = el('input', {
            type: 'text',
            placeholder: 'Ship Name',
            value: state.shipName,
            style: 'padding: 8px; margin-right: 10px; width: 200px;',
            onchange: (e) => {
                state.shipName = e.target.value;
            }
        });
        header.appendChild(shipNameInput);

        const classSelect = el('select', {
            style: 'padding: 8px;',
            onchange: (e) => {
                state.shipClass = e.target.value;
            }
        });

        const classOptions = [
            { value: 'fighter', label: 'Fighter (3k tri)' },
            { value: 'corvette', label: 'Corvette (8k tri)' },
            { value: 'frigate', label: 'Frigate (12k tri)' },
            { value: 'destroyer', label: 'Destroyer (18k tri)' },
            { value: 'freighter', label: 'Freighter (15k tri)' },
            { value: 'capital', label: 'Capital (25k tri)' },
        ];

        for (const opt of classOptions) {
            const option = el('option', {
                value: opt.value,
                textContent: opt.label,
                selected: state.shipClass === opt.value
            });
            classSelect.appendChild(option);
        }

        header.appendChild(classSelect);
        return header;
    }

    function renderComponentBrowser() {
        if (!state.baseAssets) return el('div');

        const section = el('div', {
            style: 'margin-bottom: 30px; padding: 15px; background: #1a1a1a; border-radius: 4px;'
        });

        const title = el('h2', { textContent: '⚙ Base Components' });
        section.appendChild(title);

        // Base Hull (read-only)
        const hullSection = el('div', { style: 'margin-bottom: 15px;' });
        const hullTitle = el('h3', { textContent: 'Hull (Canonical)' });
        hullSection.appendChild(hullTitle);

        if (state.baseAssets.hull) {
            const hullCard = el('div', {
                className: 'component-card',
                style: 'padding: 10px; background: #2a2a2a; border-left: 4px solid #8B4513; border-radius: 2px;'
            });

            const hullName = el('div', {
                textContent: `Hull – ${state.baseAssets.hull.metadata?.description || 'Standard'}`,
                style: 'font-weight: bold;'
            });
            hullCard.appendChild(hullName);

            const hullMeta = el('div', {
                textContent: `Size: ${state.baseAssets.hull.size} bytes | Triangles: ${state.baseAssets.hull.metadata?.triangles || '?'}`,
                style: 'font-size: 0.85em; color: #999;'
            });
            hullCard.appendChild(hullMeta);

            hullSection.appendChild(hullCard);
        }

        section.appendChild(hullSection);

        // Optional Components
        for (const [compType, variants] of Object.entries(state.baseAssets.components || {})) {
            const compSection = el('div', { style: 'margin-bottom: 15px;' });

            const compTitle = el('h3', { 
                textContent: compType.charAt(0).toUpperCase() + compType.slice(1)
            });
            compSection.appendChild(compTitle);

            const variantGroup = el('div', { style: 'display: flex; gap: 10px; flex-wrap: wrap;' });

            for (const variant of variants) {
                const variantBtn = el('button', {
                    textContent: `${variant.metadata?.size || 'Standard'} (${variant.size} B)`,
                    style: `
                        padding: 8px 12px;
                        border: 2px solid ${state.selectedComponents[compType] === variant.path ? '#4CAF50' : '#444'};
                        background: ${state.selectedComponents[compType] === variant.path ? '#4CAF5020' : '#222'};
                        color: ${state.selectedComponents[compType] === variant.path ? '#4CAF50' : '#aaa'};
                        cursor: pointer;
                        border-radius: 3px;
                        font-size: 0.9em;
                    `,
                    onclick: () => {
                        state.selectedComponents[compType] = variant.path;
                        render();
                    }
                });
                variantGroup.appendChild(variantBtn);
            }

            compSection.appendChild(variantGroup);
            section.appendChild(compSection);
        }

        return section;
    }

    function renderCustomizationPanel() {
        const section = el('div', {
            style: 'margin-bottom: 30px; padding: 15px; background: #1a1a1a; border-radius: 4px;'
        });

        const title = el('h2', { textContent: '✏ Customization Details' });
        section.appendChild(title);

        const textarea = el('textarea', {
            placeholder: 'Describe your ship design... (e.g., sleeker hull, aggressive paint scheme, reinforced armor)',
            value: state.customDetails,
            style: `
                width: 100%;
                height: 120px;
                padding: 10px;
                background: #222;
                color: #fff;
                border: 1px solid #444;
                border-radius: 3px;
                font-family: monospace;
                font-size: 0.9em;
            `,
            onchange: (e) => {
                state.customDetails = e.target.value;
            }
        });
        section.appendChild(textarea);

        return section;
    }

    function renderActionButtons() {
        const section = el('div', {
            style: 'display: flex; gap: 15px; padding: 20px 0;'
        });

        // Save Customization
        const saveBtn = el('button', {
            textContent: '💾 Save Customization',
            style: `
                padding: 12px 20px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-size: 1em;
            `,
            onclick: async () => {
                await saveCustomization();
            }
        });
        section.appendChild(saveBtn);

        // Refine with AI
        const refineBtn = el('button', {
            textContent: '🤖 Refine with AI',
            style: `
                padding: 12px 20px;
                background: #2196F3;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-size: 1em;
            `,
            onclick: async () => {
                await refineWithTRELLIS2();
            },
            disabled: !state.selectedFaction || !state.customDetails
        });
        section.appendChild(refineBtn);

        // Progress bar (if refining)
        if (state.refinementJobId) {
            const progressContainer = el('div', { style: 'flex: 1;' });
            
            const progressBar = el('div', {
                style: `
                    width: 100%;
                    height: 20px;
                    background: #333;
                    border-radius: 10px;
                    overflow: hidden;
                `,
            });

            const progressFill = el('div', {
                style: `
                    width: ${state.refinementProgress}%;
                    height: 100%;
                    background: #2196F3;
                    transition: width 0.3s;
                `,
            });
            progressBar.appendChild(progressFill);
            progressContainer.appendChild(progressBar);

            const progressText = el('div', {
                textContent: `Refining... ${state.refinementProgress}%`,
                style: 'font-size: 0.9em; color: #999; margin-top: 5px;'
            });
            progressContainer.appendChild(progressText);

            section.appendChild(progressContainer);
        }

        return section;
    }

    // ─────────────────────────────────────────────────────────────────────
    // API Calls
    // ─────────────────────────────────────────────────────────────────────

    async function loadBaseAssets(factionCode) {
        try {
            const response = await fetch(
                `${apiBase}/ship_designer_enhanced.php?action=get_base_assets&faction_code=${factionCode}`
            );
            const result = await response.json();

            if (result.base_assets) {
                state.baseAssets = result.base_assets;
            } else {
                console.error('No base_assets in response');
            }
        } catch (err) {
            console.error('Failed to load base assets:', err);
            alert('Error loading base assets. Ensure backend is running.');
        }
    }

    async function saveCustomization() {
        if (!state.selectedFaction) {
            alert('Select a faction first');
            return;
        }

        const payload = {
            faction_code: state.selectedFaction,
            ship_class: state.shipClass,
            ship_name: state.shipName,
            components: state.selectedComponents,
            custom_details: state.customDetails,
        };

        try {
            const response = await fetch(
                `${apiBase}/ship_designer_enhanced.php?action=customize_ship`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            );

            const result = await response.json();

            if (result.success) {
                alert(`✓ Customization saved (ID: ${result.customization_id})`);
                return result.customization_id;
            } else {
                alert(`❌ Error: ${result.error}`);
            }
        } catch (err) {
            console.error('Failed to save customization:', err);
            alert('Network error');
        }
    }

    async function refineWithTRELLIS2() {
        const customizationId = await saveCustomization();
        if (!customizationId) return;

        const payload = { customization_id: customizationId };

        try {
            const response = await fetch(
                `${apiBase}/ship_designer_enhanced.php?action=refine_with_trellis2`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            );

            const result = await response.json();

            if (result.success) {
                state.refinementJobId = result.job_id;
                render();

                // Poll for progress
                pollRefinementProgress();
            } else {
                alert(`❌ Error: ${result.error}`);
            }
        } catch (err) {
            console.error('Failed to queue refinement:', err);
            alert('Network error');
        }
    }

    async function pollRefinementProgress() {
        if (!state.refinementJobId) return;

        const interval = setInterval(async () => {
            try {
                const response = await fetch(
                    `${apiBase}/trellis2_generator.php?action=generation_status&job_id=${state.refinementJobId}`
                );

                const result = await response.json();

                state.refinementProgress = result.progress || 0;
                render();

                if (result.complete) {
                    clearInterval(interval);

                    alert(`✓ Ship refinement complete!\nPath: ${result.glb_path}`);

                    state.refinementJobId = null;
                    state.refinementProgress = 0;

                    if (onShipGenerated) {
                        onShipGenerated({
                            glbPath: result.glb_path,
                            customizationId: state.customizationId,
                        });
                    }

                    render();
                }
            } catch (err) {
                console.error('Poll error:', err);
                clearInterval(interval);
            }
        }, 2000); // Poll every 2 seconds
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helper
    // ─────────────────────────────────────────────────────────────────────

    function el(tag, attrs = {}) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'onclick' || key === 'onchange') {
                element[key] = value;
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'selected') {
                if (value) element.selected = true;
            } else {
                element.setAttribute(key, value);
            }
        }
        return element;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────

    render();

    return {
        render,
        selectFaction: (code) => {
            state.selectedFaction = code;
            loadBaseAssets(code).then(() => render());
        },
        getState: () => ({ ...state }),
        setState: (updates) => {
            state = { ...state, ...updates };
            render();
        },
    };
}
