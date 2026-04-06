'use strict';

(function () {
  function createFleetStatusPanelsHelper(opts = {}) {
    const {
      wm = null,
      api = null,
      showToast = () => {},
      esc = (value) => String(value || ''),
    } = opts;

    return {
      applyWormholeInfo(root, wormholeData) {
        const wormholeEl = root?.querySelector('#fleet-wormhole-info');
        if (!wormholeEl) return;

        const routeCount = Array.isArray(wormholeData?.wormholes)
          ? wormholeData.wormholes.filter((w) => !!w.available).length
          : 0;
        const level = Number(wormholeData?.wormhole_theory_level || 0);
        const canJump = !!wormholeData?.can_jump;
        const cb = root.querySelector('#f-use-wormhole');
        if (cb && (!canJump || routeCount <= 0)) {
          cb.disabled = true;
          cb.checked = false;
        }
        const reason = canJump
          ? (routeCount > 0 ? `${routeCount} active route(s) from this colony.` : 'No active route currently available.')
          : `Wormhole Theory Lv5 required (current Lv${level}).`;
        wormholeEl.insertAdjacentHTML('beforeend', `<div class="text-muted small" style="margin-top:0.2rem;">${esc(reason)}</div>`);
      },

      applyFtlStatus(root, ftlData) {
        const ftlEl = root?.querySelector('#fleet-ftl-status');
        if (!ftlEl) return;
        if (!ftlData?.success) {
          ftlEl.innerHTML = '';
          return;
        }

        const driveLabels = {
          vor_tak: "Vor'Tak - K-F Jump Drive",
          syl_nar: "Syl'Nar - Resonance Gate Network",
          vel_ar: 'Vel\'Ar - Blind Quantum Jump',
          zhareen: 'Zhareen - Crystal Resonance Channel',
          aereth: 'Aereth - Alcubierre Warp',
          kryl_tha: "Kryl'Tha - Swarm Tunnel",
        };
        const driveType = ftlData.ftl_drive_type || 'aereth';
        const driveLabel = driveLabels[driveType] || driveType;
        const ready = !!ftlData.ftl_ready;
        const cooldownSec = Number(ftlData.ftl_cooldown_remaining_s || 0);
        const cooldownStr = cooldownSec > 0
          ? `Recharging: ${Math.floor(cooldownSec / 3600)}h ${Math.floor((cooldownSec % 3600) / 60)}m remaining`
          : 'Ready';

        let ftlCooldownProgressPct = 0;
        let ftlCooldownTone = 'is-good';
        let ftlCooldownHtml = '';
        if (cooldownSec > 0) {
          const driveMaxCooldown = {
            vor_tak: 72 * 3600,
            syl_nar: 48 * 3600,
            vel_ar: 36 * 3600,
            zhareen: 60 * 3600,
            aereth: 24 * 3600,
            kryl_tha: 18 * 3600,
          };
          const maxCooldown = driveMaxCooldown[driveType] || (cooldownSec * 1.5);
          const elapsedSec = maxCooldown - cooldownSec;
          ftlCooldownProgressPct = Math.min(100, Math.round((elapsedSec / maxCooldown) * 100));
          ftlCooldownTone = ftlCooldownProgressPct < 30 ? 'is-critical' : (ftlCooldownProgressPct < 70 ? 'is-warning' : 'is-good');
          ftlCooldownHtml = `<div class="entity-bars" style="margin-top:0.2rem;">
              <div class="entity-bar-row" title="FTL cooldown recharging ${ftlCooldownProgressPct}%">
                <span class="entity-bar-label">Cooldown</span>
                <div class="bar-wrap"><div class="bar-fill bar-integrity ${ftlCooldownTone}" style="width:${ftlCooldownProgressPct}%"></div></div>
                <span class="entity-bar-value">${ftlCooldownProgressPct}%</span>
              </div>
            </div>`;
        }

        let extraInfo = '';
        let gateHealthHtml = '';
        if (driveType === 'syl_nar') {
          const allGates = Array.isArray(ftlData.gates) ? ftlData.gates : [];
          const gateCount = allGates.filter((g) => g.is_active && g.health > 0).length;
          extraInfo = ` | ${gateCount} gate(s) active | Survey to build new gates`;
          if (allGates.length) {
            gateHealthHtml = `<div class="entity-bars" style="margin-top:0.45rem;">`
              + allGates.map((g) => {
                const hp = Math.max(0, Math.min(100, Number(g.health ?? 100)));
                const tone = hp < 30 ? 'is-critical' : (hp < 60 ? 'is-warning' : 'is-good');
                const active = g.is_active ? '' : ' <span class="text-muted" style="font-size:0.7rem;">(Offline)</span>';
                const label = `G${Number(g.galaxy_a || 0)}:${Number(g.system_a || 0)}<->G${Number(g.galaxy_b || 0)}:${Number(g.system_b || 0)}`;
                return `<div class="entity-bar-row" title="Gate ${label} health ${hp}%">`
                  + `<span class="entity-bar-label" style="min-width:7rem;font-size:0.7rem;">${esc(label)}${active}</span>`
                  + `<div class="bar-wrap"><div class="bar-fill bar-integrity ${tone}" style="width:${hp}%"></div></div>`
                  + `<span class="entity-bar-value">${hp}%</span>`
                  + `</div>`;
              }).join('')
              + `</div>`;
          }
        } else if (driveType === 'zhareen') {
          const nodeCount = Array.isArray(ftlData.resonance_nodes) ? ftlData.resonance_nodes.length : 0;
          extraInfo = ` | ${nodeCount} node(s) charted | Survey to chart new nodes`;
        } else if (driveType === 'aereth') {
          extraInfo = ' | Core bonus: +50% speed in galaxies <=3, +30% in galaxies >=7';
        } else if (driveType === 'kryl_tha') {
          extraInfo = ' | Max 50 ships per FTL jump | -10% hull after each jump';
        } else if (driveType === 'vel_ar') {
          extraInfo = ' | Arrival scatter: 0.5% of distance | 60s stealth on landing';
        } else if (driveType === 'vor_tak') {
          extraInfo = ' | Max 30 LY | 72h recharge | Carrier gives +30% cargo';
        }

        ftlEl.innerHTML = `<span style="color:#88ccff;font-weight:600;">${esc(driveLabel)}</span>`
          + ` <span style="color:${ready ? '#88ff88' : '#ffcc44'}">${esc(cooldownStr)}</span>`
          + `<span style="color:#aaa">${esc(extraInfo)}</span>`
          + ftlCooldownHtml
          + gateHealthHtml
          + (!ready && driveType === 'vor_tak'
            ? ` <button class="btn btn-sm" id="ftl-reset-cooldown-btn" style="margin-left:0.5rem;font-size:0.75rem;">Reset (50 Dark Matter)</button>`
            : '');

        const resetBtn = ftlEl.querySelector('#ftl-reset-cooldown-btn');
        if (!resetBtn) return;
        resetBtn.addEventListener('click', async () => {
          resetBtn.disabled = true;
          resetBtn.textContent = '...';
          try {
            const res = await api.resetFtlCooldown();
            if (res?.success) {
              showToast(res.message || 'FTL cooldown reset.', 'success');
              wm?.refresh?.('fleet');
            } else {
              showToast(res?.error || 'Reset failed.', 'error');
              resetBtn.disabled = false;
              resetBtn.textContent = 'Reset (50 Dark Matter)';
            }
          } catch (_err) {
            showToast('Reset failed.', 'error');
            resetBtn.disabled = false;
            resetBtn.textContent = 'Reset (50 Dark Matter)';
          }
        });
      },
    };
  }

  const api = { createFleetStatusPanelsHelper };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeFleetStatusPanels = api;
  }
})();