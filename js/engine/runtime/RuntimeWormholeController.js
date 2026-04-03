'use strict';

(function () {
  function createWormholeController(opts = {}) {
    const {
      wm = null,
      api = null,
      getCurrentColony = () => null,
      waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      showToast = () => {},
      uiKitEmptyStateHTML = () => '',
      uiKitSkeletonHTML = () => '',
      esc = (value) => String(value || ''),
      fmt = (value) => String(value || 0),
      gameLog = () => {},
    } = opts;

    return {
      resolveOriginCoords() {
        const currentColony = getCurrentColony();
        const g = Number(currentColony?.galaxy || 0);
        const s = Number(currentColony?.system || 0);
        return { g, s };
      },

      resolveCounterpart(wormhole, origin) {
        const a = wormhole?.a || {};
        const b = wormhole?.b || {};
        const originMatchesA = Number(a.galaxy || 0) === origin.g && Number(a.system || 0) === origin.s;
        if (originMatchesA) return b;
        const originMatchesB = Number(b.galaxy || 0) === origin.g && Number(b.system || 0) === origin.s;
        if (originMatchesB) return a;
        return b;
      },

      async openFleetWithWormholeTarget(endpoint) {
        wm?.open?.('fleet');
        await waitMs(120);
        const root = wm?.body?.('fleet');
        if (!root) return;

        const gInput = root.querySelector('#f-galaxy');
        const sInput = root.querySelector('#f-system');
        const pInput = root.querySelector('#f-position');
        const cb = root.querySelector('#f-use-wormhole');
        const missionTransport = root.querySelector('input[name="mission"][value="transport"]');

        if (gInput) gInput.value = String(Number(endpoint?.galaxy || 1));
        if (sInput) sInput.value = String(Number(endpoint?.system || 1));
        if (pInput) pInput.value = String(Number(pInput?.value || 1));
        if (missionTransport) {
          missionTransport.checked = true;
          missionTransport.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (cb && !cb.disabled) cb.checked = true;
        showToast('Fleet target prefilled for wormhole jump.', 'info');
      },

      buildCardsHtml(payload) {
        const wormholes = Array.isArray(payload?.wormholes) ? payload.wormholes : [];
        const canJump = !!payload?.can_jump;
        const level = Number(payload?.wormhole_theory_level || 0);
        const origin = this.resolveOriginCoords();

        if (!wormholes.length) {
          return uiKitEmptyStateHTML(
            'No Wormhole Routes',
            canJump
              ? 'No active route starts at this colony system.'
              : `Wormhole Theory Lv5 required (current Lv${level}).`
          );
        }

        return `<div class="card-grid">${wormholes.map((w) => {
          const to = this.resolveCounterpart(w, origin);
          const available = !!w.available;
          const isPermanent = !!w.is_permanent;
          const unlocked = !!w.unlocked;
          const statusCls = available ? 'resource-positive' : 'text-muted';
          const cooldown = w.cooldown_until ? new Date(w.cooldown_until).toLocaleString() : 'ready';
          const availabilityText = available
            ? 'Available for jump'
            : (isPermanent && !unlocked ? 'Requires Precursor beacon unlock quest' : 'Unavailable');
          return `
            <div class="item-card">
              <div class="item-card-header">
                <span class="item-name">${esc(String(w.label || `Route #${w.id}`))}</span>
                <span class="item-level">Stability ${fmt(w.stability || 0)}</span>
              </div>
              ${isPermanent ? '<div class="system-row small">Permanent Beacon Route</div>' : ''}
              <div class="system-row small">A: [${fmt(w.a?.galaxy || 0)}:${fmt(w.a?.system || 0)}] | B: [${fmt(w.b?.galaxy || 0)}:${fmt(w.b?.system || 0)}]</div>
              <div class="system-row small">Jump target from here: [${fmt(to?.galaxy || 0)}:${fmt(to?.system || 0)}]</div>
              <div class="system-row small">Cooldown: ${esc(cooldown)}</div>
              <div class="system-row small ${statusCls}">${availabilityText}</div>
              ${available
                ? `<button class="btn btn-primary btn-sm wormhole-use-btn" data-target-g="${esc(String(to?.galaxy || 1))}" data-target-s="${esc(String(to?.system || 1))}">Use Wormhole (Fleet)</button>`
                : '<button class="btn btn-secondary btn-sm" disabled>Unavailable</button>'}
            </div>`;
        }).join('')}</div>`;
      },

      bindActions(root) {
        root.querySelectorAll('.wormhole-use-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const g = Number(btn.getAttribute('data-target-g') || 1);
            const s = Number(btn.getAttribute('data-target-s') || 1);
            await this.openFleetWithWormholeTarget({ galaxy: g, system: s });
          });
        });
      },

      async render() {
        const root = wm?.body?.('wormholes');
        if (!root) return;
        const currentColony = getCurrentColony();
        if (!currentColony) {
          root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
          return;
        }

        root.innerHTML = uiKitSkeletonHTML();
        try {
          const data = await api.wormholes(currentColony.id);
          if (!data?.success) {
            root.innerHTML = '<p class="text-red">Failed to load wormholes.</p>';
            return;
          }
          root.innerHTML = this.buildCardsHtml(data);
          this.bindActions(root);
        } catch (err) {
          gameLog('warn', 'Wormhole view laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load wormholes.</p>';
        }
      },
    };
  }

  const api = { createWormholeController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeWormholeController = api;
  }
})();