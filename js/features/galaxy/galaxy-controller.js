/**
 * GalaxyController – UI controller for galaxy feature.
 *
 * Manages galaxy map viewport, system detail display, loading states, and error handling.
 */
class GalaxyController {
    /**
     * @param {GalaxyService} galaxyService Galaxy application service
     * @param {Object} config Configuration
     */
    constructor(galaxyService, config = {}) {
        this.service = galaxyService;
        this.containerSelector = config.containerSelector || '#galaxy-container';
        this.isLoading = false;
        this.currentViewport = null;
        this.selectedSystem = null;
        this.setupEventHandlers();
    }

    /**
     * Setup DOM event handlers.
     *
     * @private
     */
    setupEventHandlers() {
        const container = document.querySelector(this.containerSelector);
        if (!container) {
            console.warn(`Galaxy container not found: ${this.containerSelector}`);
            return;
        }

        container.addEventListener('click', (e) => this.onSystemClick(e));
    }

    /**
     * Handle system click from map.
     *
     * @private
     */
    async onSystemClick(event) {
        const systemElement = event.target.closest('[data-system-id]');
        if (!systemElement) return;

        const x = parseInt(systemElement.dataset.systemX, 10);
        const y = parseInt(systemElement.dataset.systemY, 10);

        await this.displaySystemDetail(x, y);
    }

    /**
     * Load and display systems in viewport range.
     *
     * @param {Object} range
     * @returns {Promise<boolean>}
     */
    async loadViewport(range) {
        if (this.isLoading) return false;

        this.isLoading = true;
        const container = document.querySelector(this.containerSelector);
        if (!container) return false;

        try {
            this.showLoading();
            const result = await this.service.getStarsRange(range);

            if (result.error) {
                this.showError(result.error);
                return false;
            }

            this.currentViewport = result.data;
            this.renderSystems(result.data.systems);
            return true;
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    /**
     * Display detailed information for a single system.
     *
     * @param {number} x X coordinate
     * @param {number} y Y coordinate
     * @returns {Promise<boolean>}
     */
    async displaySystemDetail(x, y) {
        if (this.isLoading) return false;

        this.isLoading = true;

        try {
            this.showLoading();
            const result = await this.service.getSystemPayload({ x, y });

            if (result.error) {
                this.showError(result.error);
                return false;
            }

            this.selectedSystem = result.data;
            this.renderSystemDetail(result.data);
            return true;
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    /**
     * Render system list on map.
     *
     * @private
     */
    renderSystems(systems) {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;

        container.querySelectorAll('[data-system-id]').forEach(el => el.remove());
        systems.forEach(system => {
            const el = this.createSystemElement(system);
            container.appendChild(el);
        });

        container.dispatchEvent(new CustomEvent('systems-loaded', { detail: { systems } }));
    }

    /**
     * Create DOM element for a system marker.
     *
     * @private
     */
    createSystemElement(system) {
        const el = document.createElement('div');
        el.className = 'galaxy-system';
        el.dataset.systemId = system.id;
        el.dataset.systemX = system.x;
        el.dataset.systemY = system.y;
        el.title = `${system.name} (${system.x}, ${system.y})`;
        el.textContent = system.name.substring(0, 3);
        return el;
    }

    /**
     * Render system detail panel.
     *
     * @private
     */
    renderSystemDetail(systemDetail) {
        const panel = document.querySelector('[data-role="system-detail"]');
        if (!panel) return;

        const sys = systemDetail.system;
        panel.innerHTML = `
            <h2>${sys.name || 'Unknown'}</h2>
            <dl>
                <dt>Spectral:</dt><dd>${sys.spectral_class}${sys.subtype || ''}</dd>
                <dt>Planets:</dt><dd>${sys.planet_count || 0}</dd>
            </dl>
        `;

        panel.dispatchEvent(new CustomEvent('system-detail-rendered', { detail: systemDetail }));
    }

    /**
     * Show loading indicator.
     *
     * @private
     */
    showLoading() {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;

        let spinner = container.querySelector('.loading-spinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'loading-spinner';
            spinner.innerHTML = '<p>Loading systems...</p>';
            container.appendChild(spinner);
        }
        spinner.style.display = 'block';
    }

    /**
     * Hide loading indicator.
     *
     * @private
     */
    hideLoading() {
        const spinner = document.querySelector(`${this.containerSelector} .loading-spinner`);
        if (spinner) spinner.style.display = 'none';
    }

    /**
     * Show error message.
     *
     * @private
     */
    showError(error) {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;

        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.innerHTML = `<p><strong>[${error.code}]:</strong> ${error.message}</p>`;

        container.appendChild(errorEl);
        setTimeout(() => errorEl.remove(), 5000);
    }
}

if (typeof window !== 'undefined') window.GalaxyController = GalaxyController;
