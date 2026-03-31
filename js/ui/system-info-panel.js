/**
 * System Info Panel – Detailed scientific data for star systems
 * 
 * Displays comprehensive information about a star and its planets,
 * formatted for scientific exploration and discovery.
 */

async function openSystemInfoPanel(galaxyIdx, systemIdx) {
    try {
        // Fetch detailed star info from API
        const response = await fetch(
            `/api/galaxy.php?action=star_info&galaxy=${galaxyIdx}&system=${systemIdx}`,
            { credentials: 'include' }
        );

        if (!response.ok) {
            console.error('Failed to fetch system info:', response.status);
            return;
        }

        const data = await response.json();
        if (!data.star) {
            console.error('No star data in response');
            return;
        }

        const star = data.star;
        const panel = _buildSystemInfoPanel(star, galaxyIdx, systemIdx);
        
        // Show as modal
        const backdrop = document.createElement('div');
        backdrop.className = 'system-info-backdrop';
        backdrop.addEventListener('click', () => backdrop.remove());
        
        const modal = document.createElement('div');
        modal.className = 'system-info-modal';
        modal.innerHTML = panel;
        modal.addEventListener('click', (ev) => ev.stopPropagation());
        
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        
        // Attach close handler
        const closeBtn = modal.querySelector('.system-info-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => backdrop.remove());
        }

        _initSystemInfoTabs(modal);
    } catch (error) {
        console.error('Failed to open system info panel:', error);
    }
}

function _monoIcon(symbolId, extraClass = 'gq-icon-inline') {
    const iconId = String(symbolId || '').trim();
    if (!iconId) return '';
    const iconFile = iconId.replace(/^icon-/, '');
    return `<svg class="gq-icon ${extraClass}" aria-hidden="true" focusable="false"><use href="gfx/icons/mono/${iconFile}.svg#${iconId}"></use></svg>`;
}

function _buildSystemInfoPanel(star, galaxyIdx, systemIdx) {
    const typeLabel = _getStarTypeLabel(star.classification.type);
    const habZoneKm = (star.habitable_zone.hz_inner_au * 149597870.7).toFixed(0);
    const frostLineKm = (star.habitable_zone.frost_line_au * 149597870.7).toFixed(0);
    const hasBinary = !!(star.binary && star.binary.is_binary);
    const companion = hasBinary ? (star.binary.companion || {}) : null;
    const companionType = companion && companion.stellar_type
        ? _getStarTypeLabel(companion.stellar_type)
        : { label: 'Unknown', iconText: '??', class: 'unknown' };
    const binarySection = hasBinary ? `
            <section class="system-section">
                <h3 class="system-section-title">${_monoIcon('icon-factions')}Binary Dynamics</h3>
                <div class="system-grid">
                    <div class="system-info-row">
                        <span class="system-label">Configuration</span>
                        <span class="system-value">
                            ${star.binary.is_circumbinary ? 'Circumbinary (P-type)' : 'S-type / hierarchical'}
                        </span>
                    </div>
                    <div class="system-info-row">
                        <span class="system-label">Companion Type</span>
                        <span class="system-value">
                            <span class="star-type-badge ${companionType.class}">${companionType.iconText} ${companionType.label}</span>
                        </span>
                    </div>
                    <div class="system-info-row">
                        <span class="system-label">Companion Spectral Class</span>
                        <span class="system-value">${companion.spectral_class ?? '?'}${Number.isFinite(companion.subtype) ? companion.subtype : ''}</span>
                    </div>
                    <div class="system-info-row">
                        <span class="system-label">Separation</span>
                        <span class="system-value">${Number.isFinite(companion.separation_au) ? companion.separation_au.toFixed(5) : '—'} AU</span>
                    </div>
                    <div class="system-info-row">
                        <span class="system-label">Eccentricity</span>
                        <span class="system-value">${Number.isFinite(companion.eccentricity) ? companion.eccentricity.toFixed(5) : '—'}</span>
                    </div>
                    <div class="system-info-row">
                        <span class="system-label">Critical Stable Orbit</span>
                        <span class="system-value">${Number.isFinite(star.binary.stability_critical_au) ? star.binary.stability_critical_au.toFixed(5) : '—'} AU</span>
                    </div>
                </div>
            </section>
    ` : '';

    return `
        <div class="system-info-header">
            <div class="system-info-title-block">
                <h2>${star.name}</h2>
                <p class="system-catalog">${star.catalog_name}</p>
                <p class="system-coords">Galaxy ${galaxyIdx} • System ${systemIdx}</p>
            </div>
            <button class="system-info-close">&times;</button>
        </div>

        <nav class="system-info-tabs" aria-label="System info Bereiche">
            <button type="button" class="system-info-tab is-active" data-system-tab="overview" aria-selected="true">Overview</button>
            <button type="button" class="system-info-tab" data-system-tab="orbit" aria-selected="false">Orbit</button>
            <button type="button" class="system-info-tab" data-system-tab="references" aria-selected="false">Referenzen</button>
        </nav>

        <div class="system-info-content">
            <div class="system-tab-panel is-active" data-system-panel="overview">
                <section class="system-section">
                    <h3 class="system-section-title">${_monoIcon('icon-galaxy')}Stellar Classification</h3>
                    <div class="system-grid">
                        <div class="system-info-row">
                            <span class="system-label">Star Type</span>
                            <span class="system-value">
                                <span class="star-type-badge ${typeLabel.class}">${typeLabel.iconText} ${typeLabel.label}</span>
                            </span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Spectral Class</span>
                            <span class="system-value">${star.classification.spectral_class}${star.classification.subtype}</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Luminosity Class</span>
                            <span class="system-value roman">${star.classification.luminosity_class}</span>
                        </div>
                    </div>
                </section>

                <section class="system-section">
                    <h3 class="system-section-title">${_monoIcon('icon-graphics')}Physical Properties</h3>
                    <div class="system-grid">
                        <div class="system-info-row">
                            <span class="system-label">Surface Temperature</span>
                            <span class="system-value">${star.physical_properties.temperature_k.toLocaleString()} K</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Luminosity</span>
                            <span class="system-value">${star.physical_properties.luminosity_solar.toFixed(6)} L☉</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Mass</span>
                            <span class="system-value">${star.physical_properties.mass_solar.toFixed(4)} M☉</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Radius</span>
                            <span class="system-value">${star.physical_properties.radius_solar.toFixed(5)} R☉</span>
                        </div>
                    </div>
                </section>

                <section class="system-section">
                    <h3 class="system-section-title">${_monoIcon('icon-quests')}Age & Composition</h3>
                    <div class="system-grid">
                        <div class="system-info-row">
                            <span class="system-label">Stellar Age</span>
                            <span class="system-value">${star.age_metallicity.age_gyr.toFixed(2)} billion years</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Metallicity [Z]</span>
                            <span class="system-value">${star.age_metallicity.metallicity_z.toFixed(4)}</span>
                        </div>
                    </div>
                </section>
            </div>

            <div class="system-tab-panel" data-system-panel="orbit" hidden>
                <div class="system-panel-actions">
                    <button type="button" class="system-ref-btn system-ref-btn-detach" data-system-detach="orbit">
                        ${_monoIcon('icon-map')}Orbit in eigenem Fenster
                    </button>
                </div>

                <section class="system-section">
                    <h3 class="system-section-title">${_monoIcon('icon-orb')}Orbital Zones</h3>
                    <div class="system-grid">
                        <div class="system-info-row">
                            <span class="system-label">Habitable Zone (inner)</span>
                            <span class="system-value">
                                ${star.habitable_zone.hz_inner_au.toFixed(5)} AU
                                <span class="system-sub">${habZoneKm} km</span>
                            </span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Habitable Zone (outer)</span>
                            <span class="system-value">
                                ${star.habitable_zone.hz_outer_au.toFixed(5)} AU
                                <span class="system-sub">${(star.habitable_zone.hz_outer_au * 149597870.7).toFixed(0)} km</span>
                            </span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Frost Line</span>
                            <span class="system-value">
                                ${star.habitable_zone.frost_line_au.toFixed(5)} AU
                                <span class="system-sub">${frostLineKm} km</span>
                            </span>
                        </div>
                    </div>
                </section>

                ${binarySection}

                <section class="system-section">
                    <h3 class="system-section-title">${_monoIcon('icon-map')}Position</h3>
                    <div class="system-grid">
                        <div class="system-info-row">
                            <span class="system-label">X</span>
                            <span class="system-value">${star.xy.x_ly.toFixed(2)} ly</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Y</span>
                            <span class="system-value">${star.xy.y_ly.toFixed(2)} ly</span>
                        </div>
                        <div class="system-info-row">
                            <span class="system-label">Z</span>
                            <span class="system-value">${star.xy.z_ly.toFixed(2)} ly</span>
                        </div>
                    </div>
                </section>
            </div>

            <div class="system-tab-panel" data-system-panel="references" hidden>
                <div class="system-panel-actions">
                    <button type="button" class="system-ref-btn system-ref-btn-detach" data-system-detach="references">
                        ${_monoIcon('icon-intel')}Referenzen in eigenem Fenster
                    </button>
                </div>

                <section class="system-section">
                    <h3 class="system-section-title">${_monoIcon('icon-intel')}References</h3>
                    <div class="system-references">
                        <button class="system-ref-btn" onclick="window.openGlossaryModal()">
                            ${_monoIcon('icon-intel')}Open Glossary
                        </button>
                        <button class="system-ref-btn" onclick="window.openHRDiagram('${star.classification.type}')">
                            ${_monoIcon('icon-graphics')}View HR-Diagram
                        </button>
                        <a href="https://en.wikipedia.org/wiki/Stellar_classification" target="_blank" rel="noopener" class="system-ref-btn">
                            ${_monoIcon('icon-factions')}Stellar Classification (Wikipedia)
                        </a>
                        <a href="https://arxiv.org/abs/1301.6674" target="_blank" rel="noopener" class="system-ref-btn">
                            ${_monoIcon('icon-research')}Habitable Zone Research (ArXiv)
                        </a>
                    </div>
                </section>
            </div>

        </div>
    `;
}

function _initSystemInfoTabs(modal) {
    if (!(modal instanceof HTMLElement)) return;

    const tabs = Array.from(modal.querySelectorAll('[data-system-tab]'));
    const panels = Array.from(modal.querySelectorAll('[data-system-panel]'));
    if (!tabs.length || !panels.length) return;

    const activateTab = (tabName) => {
        const selected = String(tabName || 'overview');
        tabs.forEach((tab) => {
            const active = tab.getAttribute('data-system-tab') === selected;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panels.forEach((panel) => {
            const active = panel.getAttribute('data-system-panel') === selected;
            panel.classList.toggle('is-active', active);
            panel.hidden = !active;
        });
    };

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            activateTab(tab.getAttribute('data-system-tab'));
        });
    });

    const detachButtons = Array.from(modal.querySelectorAll('[data-system-detach]'));
    detachButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const kind = String(btn.getAttribute('data-system-detach') || '');
            const panel = btn.closest('[data-system-panel]');
            _openDetachedSystemInfoWindow(kind, panel);
        });
    });

    activateTab('overview');
}

function _openDetachedSystemInfoWindow(kind, sourcePanel) {
    if (!(sourcePanel instanceof HTMLElement)) return;

    const panelKind = String(kind || '').trim().toLowerCase();
    if (!panelKind) return;

    const titleMap = {
        orbit: 'Orbit-Details',
        references: 'Referenzen',
    };

    const existing = document.querySelector(`.system-info-detached[data-system-detached="${panelKind}"]`);
    if (existing instanceof HTMLElement) existing.remove();

    const detached = document.createElement('section');
    detached.className = 'system-info-detached';
    detached.setAttribute('data-system-detached', panelKind);
    detached.setAttribute('role', 'dialog');
    detached.setAttribute('aria-label', titleMap[panelKind] || 'Systemdetails');

    const header = document.createElement('div');
    header.className = 'system-info-detached-head';
    header.innerHTML = `
        <strong>${titleMap[panelKind] || 'Systemdetails'}</strong>
        <button type="button" class="system-info-detached-close" aria-label="Fenster schließen">&times;</button>
    `;

    const body = document.createElement('div');
    body.className = 'system-info-detached-body';
    const clone = sourcePanel.cloneNode(true);
    clone.querySelectorAll('[data-system-detach]').forEach((node) => node.remove());
    clone.hidden = false;
    clone.classList.add('is-active');
    body.appendChild(clone);

    detached.appendChild(header);
    detached.appendChild(body);
    document.body.appendChild(detached);

    const closeBtn = detached.querySelector('.system-info-detached-close');
    if (closeBtn instanceof HTMLElement) {
        closeBtn.addEventListener('click', () => {
            detached.remove();
            _saveDetachedWindowsState();
        });
    }
    
    // Persist state when window opens
    _saveDetachedWindowsState();
}

function _getStarTypeLabel(type) {
    const labels = {
        'white_dwarf': { label: 'White Dwarf', iconText: 'WD', class: 'white-dwarf' },
        'main_sequence': { label: 'Main Sequence', iconText: 'MS', class: 'main-sequence' },
        'neutron_star': { label: 'Neutron Star', iconText: 'NS', class: 'neutron-star' },
        'brown_dwarf': { label: 'Brown Dwarf', iconText: 'BD', class: 'brown-dwarf' },
        'giant': { label: 'Giant Star', iconText: 'GS', class: 'red-giant' },
        'subdwarf': { label: 'Subdwarf', iconText: 'SD', class: 'main-sequence' },
        'red_giant': { label: 'Red Giant', iconText: 'RG', class: 'red-giant' },
        'supergiant': { label: 'Supergiant', iconText: 'SG', class: 'supergiant' },
    };
    return labels[type] || { label: 'Unknown', iconText: '??', class: 'unknown' };
}

// ── Detached Window Persistence ─────────────────────────────────────────────
const SYSTEM_DETACHED_COOKIE_NAME = 'gq_system_info_detached_v1';
const SYSTEM_DETACHED_DAYS = 7;

function _saveDetachedWindowsState() {
    try {
        const types = [];
        document.querySelectorAll('.system-info-detached[data-system-detached]').forEach((el) => {
            const kind = el.getAttribute('data-system-detached');
            if (kind) types.push(String(kind).trim());
        });
        
        if (!types.length) {
            document.cookie = `${SYSTEM_DETACHED_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
            return;
        }
        
        const payload = JSON.stringify(types);
        const encoded = encodeURIComponent(payload);
        const expires = new Date(Date.now() + SYSTEM_DETACHED_DAYS * 24 * 60 * 60 * 1000).toUTCString();
        document.cookie = `${SYSTEM_DETACHED_COOKIE_NAME}=${encoded}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (e) {
        console.warn('Failed to save detached window state:', e);
    }
}

function _loadDetachedWindowsState() {
    try {
        const cookie = String(document.cookie || '');
        const prefix = `${SYSTEM_DETACHED_COOKIE_NAME}=`;
        const chunk = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix));
        if (!chunk) return [];
        const encoded = chunk.slice(prefix.length);
        const decoded = decodeURIComponent(encoded);
        const types = JSON.parse(decoded);
        return Array.isArray(types) ? types.map((t) => String(t).trim()).filter((t) => !!t) : [];
    } catch (e) {
        return [];
    }
}

function restoreDetachedSystemInfoWindows() {
    const types = _loadDetachedWindowsState();
    if (!types.length) return;
    // Note: This will only visually restore the windows
    // The actual data will need to be fetched from context or cached
    // For now, we store intention but full restoration requires the parent modal to be open
}

// Attach to global scope for event handling
window.openSystemInfoPanel = openSystemInfoPanel;
