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
        
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        
        // Attach close handler
        const closeBtn = modal.querySelector('.system-info-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => backdrop.remove());
        }
    } catch (error) {
        console.error('Failed to open system info panel:', error);
    }
}

function _buildSystemInfoPanel(star, galaxyIdx, systemIdx) {
    const typeLabel = _getStarTypeLabel(star.classification.type);
    const habZoneKm = (star.habitable_zone.hz_inner_au * 149597870.7).toFixed(0);
    const frostLineKm = (star.habitable_zone.frost_line_au * 149597870.7).toFixed(0);
    const hasBinary = !!(star.binary && star.binary.is_binary);
    const companion = hasBinary ? (star.binary.companion || {}) : null;
    const companionType = companion && companion.stellar_type
        ? _getStarTypeLabel(companion.stellar_type)
        : { label: 'Unknown', icon: '❓', class: 'unknown' };
    const binarySection = hasBinary ? `
            <section class="system-section">
                <h3 class="system-section-title">👥 Binary Dynamics</h3>
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
                            <span class="star-type-badge ${companionType.class}">${companionType.icon} ${companionType.label}</span>
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

        <div class="system-info-content">
            
            <section class="system-section">
                <h3 class="system-section-title">⭐ Stellar Classification</h3>
                <div class="system-grid">
                    <div class="system-info-row">
                        <span class="system-label">Star Type</span>
                        <span class="system-value">
                            <span class="star-type-badge ${typeLabel.class}">${typeLabel.icon} ${typeLabel.label}</span>
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
                <h3 class="system-section-title">📊 Physical Properties</h3>
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
                <h3 class="system-section-title">🕰️ Age & Composition</h3>
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

            <section class="system-section">
                <h3 class="system-section-title">🌍 Orbital Zones</h3>
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
                <h3 class="system-section-title">📍 Position</h3>
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

            <section class="system-section">
                <h3 class="system-section-title">📚 References</h3>
                <div class="system-references">
                    <button class="system-ref-btn" onclick="window.openGlossaryModal()">
                        📖 Open Glossary
                    </button>
                    <button class="system-ref-btn" onclick="window.openHRDiagram('${star.classification.type}')">
                        📊 View HR-Diagram
                    </button>
                    <a href="https://en.wikipedia.org/wiki/Stellar_classification" target="_blank" rel="noopener" class="system-ref-btn">
                        🌐 Stellar Classification (Wikipedia)
                    </a>
                    <a href="https://arxiv.org/abs/1301.6674" target="_blank" rel="noopener" class="system-ref-btn">
                        📄 Habitable Zone Research (ArXiv)
                    </a>
                </div>
            </section>

        </div>
    `;
}

function _getStarTypeLabel(type) {
    const labels = {
        'white_dwarf': { label: 'White Dwarf', icon: '⚪', class: 'white-dwarf' },
        'main_sequence': { label: 'Main Sequence', icon: '🟡', class: 'main-sequence' },
        'neutron_star': { label: 'Neutron Star', icon: '🟣', class: 'neutron-star' },
        'brown_dwarf': { label: 'Brown Dwarf', icon: '🔴', class: 'brown-dwarf' },
        'giant': { label: 'Giant Star', icon: '🟠', class: 'red-giant' },
        'subdwarf': { label: 'Subdwarf', icon: '🔹', class: 'main-sequence' },
        'red_giant': { label: 'Red Giant', icon: '🔴', class: 'red-giant' },
        'supergiant': { label: 'Supergiant', icon: '🔵', class: 'supergiant' },
    };
    return labels[type] || { label: 'Unknown', icon: '❓', class: 'unknown' };
}

// Attach to global scope for event handling
window.openSystemInfoPanel = openSystemInfoPanel;
