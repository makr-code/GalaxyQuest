/**
 * RuntimeResourceScanOverview.js
 *
 * Resource scan overview panel – shows resources discovered by survey (scout/
 * research) missions grouped by star system.
 *
 * Data comes from:
 *   1. Galaxy star data (has colony data including colony_count etc.)
 *   2. Trade route suggestions (surplus/deficit info per system)
 *   3. A lightweight API call to list completed survey missions
 *      (falls back to local fleet data when unavailable)
 *
 * Window ID: 'resource-scan'
 */
'use strict';

(function () {
  /** Map from resource key → display metadata */
  const RESOURCE_META = {
    metal:      { label: 'Metall',         icon: '⛏',  color: '#d6b170' },
    crystal:    { label: 'Kristall',        icon: '💎', color: '#72d0ff' },
    deuterium:  { label: 'Deuterium',       icon: '🔵', color: '#8fb7ff' },
    rare_earth: { label: 'Seltene Erden',   icon: '🟣', color: '#d18bff' },
    food:       { label: 'Nahrung',         icon: '🌿', color: '#9fd18b' },
  };

  const DEPOSIT_TIERS = [
    { min: 5_000_000, label: 'Reich',      color: '#ffd166' },
    { min: 1_000_000, label: 'Mittel',     color: '#8dd3a8' },
    { min: 0,         label: 'Gering',     color: '#7c8694' },
  ];

  function depositTier(amount) {
    for (const tier of DEPOSIT_TIERS) {
      if (amount >= tier.min) return tier;
    }
    return DEPOSIT_TIERS[DEPOSIT_TIERS.length - 1];
  }

  /**
   * Build a resource deposit badge HTML string.
   */
  function resourceBadge(key, amount, esc) {
    const meta = RESOURCE_META[key] || { label: key, icon: '▪', color: '#ccc' };
    const tier = depositTier(Number(amount || 0));
    const amountFmt = Number(amount || 0).toLocaleString('de-DE');
    return `<span style="display:inline-flex;align-items:center;gap:3px;border:1px solid ${tier.color}66;border-radius:999px;padding:1px 7px;font-size:0.73em;color:${tier.color};background:rgba(0,0,0,0.25);" title="${esc(meta.label)}: ${amountFmt}">${meta.icon} ${amountFmt}</span>`;
  }

  /**
   * Derive a compact "resource richness" summary from planet deposit data
   * returned by the API (each planet has deposit_metal, deposit_crystal, etc.)
   * or from inferred colony surplus/deficit.
   */
  function summarizePlanetDeposits(planet, esc) {
    const keys = ['metal', 'crystal', 'deuterium', 'rare_earth'];
    const badges = [];
    for (const key of keys) {
      const amount = Number(planet[`deposit_${key}`] || planet[key] || 0);
      if (amount > 0) {
        badges.push(resourceBadge(key, amount, esc));
      }
    }
    return badges.join(' ');
  }

  /**
   * @param {Object} opts
   * @param {{ body: Function, refresh: Function }} opts.wm   – window manager
   * @param {Object}   opts.api          – API client
   * @param {Function} opts.getGalaxyStars – () => star[]
   * @param {Function} opts.getColonies    – () => colony[]
   * @param {Function} opts.esc            – HTML-escaping fn
   * @param {Function} [opts.gameLog]
   * @param {Function} [opts.uiKitSkeletonHTML]
   * @param {Function} [opts.uiKitEmptyStateHTML]
   */
  function createResourceScanOverviewController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
    const getColonies = typeof opts.getColonies === 'function' ? opts.getColonies : (() => []);
    const esc = typeof opts.esc === 'function' ? opts.esc : (v) => String(v ?? '');
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const uiKitSkeletonHTML = typeof opts.uiKitSkeletonHTML === 'function' ? opts.uiKitSkeletonHTML : (() => '<p class="text-muted">Lädt…</p>');
    const uiKitEmptyStateHTML = typeof opts.uiKitEmptyStateHTML === 'function' ? opts.uiKitEmptyStateHTML : (() => '');

    class ResourceScanOverviewController {
      constructor() {
        /** @type {Array<Object>} cached survey missions from API */
        this.surveyMissions = [];
        /** @type {Array<Object>} cached scanned systems */
        this.scannedSystems = [];
        /** @type {'all'|'own'|'foreign'} current filter */
        this.filter = 'all';
        /** @type {string} search query */
        this.search = '';
      }

      /**
       * Fetch completed survey missions and planet deposit data.
       */
      async fetchData() {
        const fleets = [];
        // Try to load fleet data (survey missions)
        try {
          const result = await api.get('api/fleet.php?action=list');
          const raw = Array.isArray(result?.fleets) ? result.fleets : [];
          for (const fleet of raw) {
            if (String(fleet?.mission || '').toLowerCase() === 'survey') {
              fleets.push(fleet);
            }
          }
        } catch (err) {
          gameLog('warn', 'ResourceScanOverview: fleet list fetch failed', err);
        }

        // Build scanned system map from galaxy stars + colony data
        const stars = getGalaxyStars();
        const colonies = getColonies();
        const ownSystemSet = new Set(
          colonies.map((c) => `${Number(c.galaxy || 1)}:${Number(c.system || c.system_index || 0)}`).filter((k) => !k.endsWith(':0'))
        );

        // Group survey fleets by target system
        const surveyBySystem = new Map();
        for (const fleet of fleets) {
          const key = `${Number(fleet.target_galaxy || 1)}:${Number(fleet.target_system || 0)}`;
          if (!surveyBySystem.has(key)) surveyBySystem.set(key, []);
          surveyBySystem.get(key).push(fleet);
        }

        // Build scanned system entries from stars that either
        //  a) have a completed survey, or
        //  b) are own colony systems (implicitly known)
        this.scannedSystems = [];
        for (const star of stars) {
          const gi = Number(star.galaxy_index || 1);
          const si = Number(star.system_index || 0);
          if (!si) continue;
          const key = `${gi}:${si}`;
          const isOwn = ownSystemSet.has(key);
          const surveys = surveyBySystem.get(key) || [];
          const hasSurvey = surveys.length > 0;
          if (!isOwn && !hasSurvey) continue;

          this.scannedSystems.push({
            star,
            isOwn,
            surveys,
            key,
          });
        }

        this.surveyMissions = fleets;
      }

      /**
       * Main render entry point – called when the 'resource-scan' window is opened.
       */
      async render() {
        const root = wm.body('resource-scan');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        await this.fetchData();

        root.innerHTML = this.buildHtml();
        this.attachBindings(root);
      }

      buildHtml() {
        const filtered = this.applyFilter(this.scannedSystems);
        const searched = this.applySearch(filtered);

        let html = '<div class="resource-scan-overview">';

        // ── Filter + Search bar ──
        html += `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #334455;">
          <span style="font-size:0.85em;color:#9fb8c6;">Filter:</span>
          <button class="btn btn-sm${this.filter === 'all'    ? ' active' : ''}" data-scan-filter="all">Alle</button>
          <button class="btn btn-sm${this.filter === 'own'    ? ' active' : ''}" data-scan-filter="own">Eigene</button>
          <button class="btn btn-sm${this.filter === 'foreign'? ' active' : ''}" data-scan-filter="foreign">Fremd</button>
          <input type="text" class="form-control" style="max-width:160px;padding:3px 7px;font-size:0.82em;" placeholder="System suchen…" value="${esc(this.search)}" data-scan-search="1">
          <span style="margin-left:auto;font-size:0.78em;color:#7c8694;">${searched.length} System${searched.length !== 1 ? 'e' : ''}</span>
        </div>`;

        if (!searched.length) {
          html += uiKitEmptyStateHTML(
            'Keine gescannten Systeme',
            'Sende Aufklärer (Survey-Mission) zu Sternensystemen, um Ressourcenvorkommen aufzudecken.'
          ) || '<p class="text-muted" style="padding:12px;">Keine Einträge. Sende einen Aufklärer (Survey-Mission) zu einem Sternensystem.</p>';
          html += '</div>';
          return html;
        }

        // ── Legend ──
        html += `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:0.75em;color:#9fb8c6;">
          ${DEPOSIT_TIERS.map((t) => `<span><span style="color:${t.color};">●</span> ${esc(t.label)}</span>`).join('')}
          ${Object.entries(RESOURCE_META).map(([, m]) => `<span>${m.icon} ${esc(m.label)}</span>`).join('')}
        </div>`;

        // ── System cards ──
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">';
        for (const entry of searched) {
          html += this.renderSystemCard(entry);
        }
        html += '</div>';
        html += '</div>';
        return html;
      }

      renderSystemCard(entry) {
        const { star, isOwn, surveys } = entry;
        const name = esc(star.name || `System ${star.system_index}`);
        const spectral = esc(String(star.spectral_class || '') + String(star.subtype || ''));
        const coords = `${star.galaxy_index}:${star.system_index}`;
        const colonyCount = Number(star.colony_count || 0);
        const colonyColor = String(star.colony_owner_color || star.faction_color || '#7db7ee');
        const ownerLabel = isOwn
          ? '<span style="color:#44ee88;font-size:0.78em;">Eigene Kolonie</span>'
          : (colonyCount > 0
            ? `<span style="color:${esc(colonyColor)};font-size:0.78em;">${esc(star.colony_owner_name || 'Fremd')} (${colonyCount})</span>`
            : '<span style="color:#7c8694;font-size:0.78em;">Unbewohnt</span>');

        const depositBadges = this.buildDepositBadges(star, surveys);

        const surveyBadge = surveys.length > 0
          ? `<span style="font-size:0.72em;color:#ffd166;margin-left:4px;">🔭 ${surveys.length}x gescannt</span>`
          : '';

        return `
        <div style="border:1px solid #334455;border-radius:5px;padding:8px;background:rgba(10,20,35,0.6);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-weight:600;font-size:0.9em;">${name}</span>
            <span style="font-size:0.72em;color:#7c8694;">${esc(coords)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <span style="font-size:0.78em;color:#9fb8c6;">Klasse ${spectral}</span>
            ${ownerLabel}
            ${surveyBadge}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${depositBadges || '<span style="font-size:0.75em;color:#5a6878;">Keine Depositdaten bekannt</span>'}
          </div>
        </div>`;
      }

      buildDepositBadges(star, surveys) {
        // Prefer direct deposit data from system payload if available
        const planetDeposits = Array.isArray(star.planets) ? star.planets : [];
        if (planetDeposits.length) {
          const totals = { metal: 0, crystal: 0, deuterium: 0, rare_earth: 0 };
          for (const planet of planetDeposits) {
            for (const key of Object.keys(totals)) {
              totals[key] += Number(planet[`deposit_${key}`] || 0);
            }
          }
          const badges = Object.entries(totals)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => resourceBadge(k, v, esc));
          if (badges.length) return badges.join(' ');
        }

        // Fallback: use colony surplus from survey fleet cargo if available
        if (surveys.length) {
          const cargo = surveys[surveys.length - 1]?.cargo || {};
          const badges = Object.entries(cargo)
            .filter(([k]) => RESOURCE_META[k])
            .filter(([, v]) => Number(v || 0) > 0)
            .map(([k, v]) => resourceBadge(k, v, esc));
          if (badges.length) return badges.join(' ');
        }

        return '';
      }

      applyFilter(systems) {
        if (this.filter === 'own') return systems.filter((e) => e.isOwn);
        if (this.filter === 'foreign') return systems.filter((e) => !e.isOwn);
        return systems;
      }

      applySearch(systems) {
        const q = this.search.trim().toLowerCase();
        if (!q) return systems;
        return systems.filter((e) => {
          const name = String(e.star.name || '').toLowerCase();
          const coords = `${e.star.galaxy_index}:${e.star.system_index}`;
          return name.includes(q) || coords.includes(q);
        });
      }

      attachBindings(root) {
        root.querySelectorAll('[data-scan-filter]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            this.filter = String(btn.dataset.scanFilter || 'all');
            root.innerHTML = this.buildHtml();
            this.attachBindings(root);
          });
        });

        const searchInput = root.querySelector('[data-scan-search]');
        if (searchInput) {
          searchInput.addEventListener('input', () => {
            this.search = searchInput.value;
            root.innerHTML = this.buildHtml();
            this.attachBindings(root);
          });
        }
      }
    }

    return new ResourceScanOverviewController();
  }

  const api = { createResourceScanOverviewController };

  if (typeof window !== 'undefined') {
    window.GQRuntimeResourceScanOverview = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
