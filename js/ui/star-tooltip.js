/**
 * Star Tooltip System
 * 
 * Displays scientific star information on hover in the galaxy view.
 * Integrates with the Star Info API endpoint.
 */

class StarTooltip {
    constructor() {
        this.tooltip = null;
        this.currentStar = null;
        this.isVisible = false;
        this.fadeTimeout = null;
    }

    _monoIcon(symbolId, extraClass = 'gq-icon-inline') {
        const iconId = String(symbolId || '').trim();
        if (!iconId) return '';
        const iconFile = iconId.replace(/^icon-/, '');
        return `<svg class="gq-icon ${extraClass}" aria-hidden="true" focusable="false"><use href="gfx/icons/mono/${iconFile}.svg#${iconId}"></use></svg>`;
    }

    /**
     * Initialize tooltip UI
     */
    init() {
        if (!this.tooltip) {
            this.tooltip = document.createElement('div');
            this.tooltip.className = 'star-tooltip';
            this.tooltip.style.display = 'none';
            document.body.appendChild(this.tooltip);
        }
    }

    /**
     * Show tooltip with star data
     * @param {number} galaxyIdx - Galaxy index
     * @param {number} systemIdx - System index
     * @param {{x: number, y: number}} position - Screen position for tooltip
     */
    async show(galaxyIdx, systemIdx, position) {
        if (!this.tooltip) this.init();

        clearTimeout(this.fadeTimeout);
        this.isVisible = true;

        try {
            // Fetch star info from API
            const response = await fetch(
                `/api/v1/galaxy.php?action=star_info&galaxy=${galaxyIdx}&system=${systemIdx}`,
                { credentials: 'include' }
            );

            if (!response.ok) {
                console.warn(`Failed to fetch star info: ${response.status}`);
                return;
            }

            const data = await response.json();
            if (!data.star) {
                console.warn('No star data in response');
                return;
            }

            const star = data.star;
            this.currentStar = { galaxyIdx, systemIdx, ...star };

            // Build tooltip HTML
            const typeLabel = this._getStarTypeLabel(star.classification.type);
            const luminosityLabel = this._getLuminosityLabel(star.physical_properties.luminosity_solar);
            const ageLabel = this._getAgeLabel(star.age_metallicity.age_gyr);

            const hzInner = data.habitable_zone?.hz_inner_au ?? data.hz_inner_au ?? null;
            const hzOuter = data.habitable_zone?.hz_outer_au ?? data.hz_outer_au ?? null;
            let hzBadgeHtml = '';
            if (hzInner !== null && hzOuter !== null) {
                const hzClass = hzInner < 2.0 ? 'hz-green' : hzInner < 4.0 ? 'hz-yellow' : 'hz-gray';
                hzBadgeHtml = `<div class="star-tooltip-row">
                    <span class="hz-badge ${hzClass}">🌍 Habitzone: ${hzInner.toFixed(1)}–${hzOuter.toFixed(1)} AU</span>
                </div>`;
            }

            const tooltip_html = `
                <div class="star-tooltip-content">
                    <div class="star-tooltip-header">
                        <h3>${star.name}</h3>
                        <span class="star-type-badge ${typeLabel.class}">${typeLabel.iconText} ${typeLabel.label}</span>
                    </div>
                    <div class="star-tooltip-row">
                        <span class="star-tooltip-label">Spectral Class:</span>
                        <span class="star-tooltip-value">${star.classification.spectral_class}${star.classification.subtype}</span>
                    </div>
                    <div class="star-tooltip-row">
                        <span class="star-tooltip-label">Brightness:</span>
                        <span class="star-tooltip-value">${luminosityLabel} (${star.physical_properties.luminosity_solar.toFixed(4)} L☉)</span>
                    </div>
                    <div class="star-tooltip-row">
                        <span class="star-tooltip-label">Mass:</span>
                        <span class="star-tooltip-value">${star.physical_properties.mass_solar.toFixed(2)} M☉</span>
                    </div>
                    <div class="star-tooltip-row">
                        <span class="star-tooltip-label">Age:</span>
                        <span class="star-tooltip-value">${ageLabel}</span>
                    </div>
                    ${hzBadgeHtml}
                    <div class="star-tooltip-footer">
                        <button class="star-tooltip-btn" onclick="window.openSystemInfoPanel(${galaxyIdx}, ${systemIdx})">
                            ${this._monoIcon('icon-graphics')}View Full Details
                        </button>
                        <button class="star-tooltip-btn-secondary" onclick="window.openGlossaryModal()">
                            ${this._monoIcon('icon-intel')}Glossary
                        </button>
                    </div>
                </div>
            `;

            this.tooltip.innerHTML = tooltip_html;

            // Position tooltip near cursor, keeping it in viewport
            const rect = this.tooltip.getBoundingClientRect();
            let x = position.x + 12;
            let y = position.y + 12;

            if (x + 280 > window.innerWidth) x = position.x - 292;
            if (y + 300 > window.innerHeight) y = position.y - 312;

            this.tooltip.style.left = `${x}px`;
            this.tooltip.style.top = `${y}px`;
            this.tooltip.style.display = 'block';
            this.tooltip.style.opacity = '0';

            // Fade in
            requestAnimationFrame(() => {
                this.tooltip.style.transition = 'opacity 0.2s ease';
                this.tooltip.style.opacity = '1';
            });
        } catch (error) {
            console.error('Failed to show star tooltip:', error);
        }
    }

    /**
     * Hide tooltip with fade-out
     */
    hide() {
        if (!this.tooltip || !this.isVisible) return;

        clearTimeout(this.fadeTimeout);
        this.tooltip.style.opacity = '0';
        
        this.fadeTimeout = setTimeout(() => {
            this.tooltip.style.display = 'none';
            this.isVisible = false;
        }, 200);
    }

    /**
     * Get luminosity descriptive label
     * @private
     */
    _getLuminosityLabel(luminosity) {
        if (luminosity < 0.01) return 'Dim';
        if (luminosity < 0.1) return 'Faint';
        if (luminosity < 1.0) return 'Sun-like';
        if (luminosity <= 10) return 'Hell';
        return 'Radiant';
    }

    /**
     * Get age descriptive label
     * @private
     */
    _getAgeLabel(ageGyr) {
        if (ageGyr < 1) return 'Young';
        if (ageGyr <= 5) return 'Mature';
        return `Old (${ageGyr.toFixed(1)} Gyr)`;
    }

    /**
     * Get display label for star type
     * @private
     */
    _getStarTypeLabel(type) {
        const labels = {
            'white_dwarf': { label: 'White Dwarf', iconText: 'WD', class: 'white-dwarf' },
            'main_sequence': { label: 'Main Sequence', iconText: 'MS', class: 'main-sequence' },
            'neutron_star': { label: 'Neutron Star', iconText: 'NS', class: 'neutron-star' },
            'brown_dwarf': { label: 'Brown Dwarf', iconText: 'BD', class: 'brown-dwarf' },
            'red_giant': { label: 'Red Giant', iconText: 'RG', class: 'red-giant' },
            'supergiant': { label: 'Supergiant', iconText: 'SG', class: 'supergiant' },
        };
        return labels[type] || { label: 'Unknown', iconText: '??', class: 'unknown' };
    }
}

// Global instance
window.starTooltip = new StarTooltip();
window.starTooltip.init();
