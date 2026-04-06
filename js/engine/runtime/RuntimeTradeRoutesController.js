'use strict';
(function () {
  function createTradeRoutesController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading...</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((value) => String(value ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});
    const getResourceInsightConfig = typeof opts.getResourceInsightConfig === 'function' ? opts.getResourceInsightConfig : (() => null);
    const getSuggestedTradeAmount = typeof opts.getSuggestedTradeAmount === 'function' ? opts.getSuggestedTradeAmount : (() => 0);
    const getCurrentColony = typeof opts.getCurrentColony === 'function' ? opts.getCurrentColony : (() => null);

    class TradeRoutesController {
      constructor() {
        this.routes = [];
        this.suggestions = [];
        this.suggestionIntervalHours = 24;
      }

      async render() {
        const root = wm.body('trade-routes');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        let data;
        let suggestionsData;
        try {
          [data, suggestionsData] = await Promise.all([
            api.tradeRoutes(),
            api.listTradeSuggestions({ limit: 12, interval_hours: this.suggestionIntervalHours }),
          ]);
        } catch (err) {
          gameLog('warn', 'Trade routes laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load trade routes.</p>';
          return;
        }
        this.routes = data.trade_routes || [];
        this.suggestions = suggestionsData?.suggestions || [];

        let html = '<div class="trade-routes-list">';

        html += this.renderSuggestionsSection();

        if (this.routes.length === 0) {
          html += uiKitEmptyStateHTML('No trade routes yet', 'Create your first automated route between two colonies.');
        } else {
          html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px;">';
          for (const route of this.routes) {
            html += this.renderRouteCard(route);
          }
          html += '</div>';
        }

        html += '<div style="margin-top: 12px; padding: 8px; border-top: 1px solid #555;">';
        html += '<button id="btn-create-route" class="btn" style="width: 100%;">New Trade Route</button>';
        html += '</div>';
        html += '</div>';

        root.innerHTML = html;
        this.attachEventListeners();
      }

      renderSuggestionsSection() {
        if (!this.suggestions.length) {
          return '';
        }

        const colonyResources = new Set(['metal', 'crystal', 'deuterium', 'rare_earth', 'food']);
        const colonySuggestions = [];
        const processedSuggestions = [];

        for (const suggestion of this.suggestions) {
          const resource = String(suggestion?.resource_type || '').trim();
          if (colonyResources.has(resource)) {
            colonySuggestions.push(suggestion);
          } else {
            processedSuggestions.push(suggestion);
          }
        }

        let html = '<div style="margin-bottom: 10px; border: 1px solid #4d6a7a; border-radius: 4px; padding: 8px; background: rgba(34,58,70,0.35);">';
        html += '<div style="font-weight: bold; margin-bottom: 6px;">Suggested Resource Flows</div>';
        html += '<div style="font-size: 0.8em; color: #9fb8c6; margin-bottom: 8px;">Auto-generated from colony surplus/deficit. Click to create or update recurring routes.</div>';

        if (colonySuggestions.length) {
          html += '<div style="font-size: 0.8em; color: #8fd4ff; margin: 6px 0 4px 0;">Colony Resources</div>';
          html += '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px;">';
          for (const suggestion of colonySuggestions) {
            html += this.renderSuggestionCard(suggestion, 'colony');
          }
          html += '</div>';
        }

        if (processedSuggestions.length) {
          html += '<div style="font-size: 0.8em; color: #ffd78f; margin: 8px 0 4px 0;">Processed Goods</div>';
          html += '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px;">';
          for (const suggestion of processedSuggestions) {
            html += this.renderSuggestionCard(suggestion, 'processed');
          }
          html += '</div>';
        }

        html += '</div>';
        return html;
      }

      renderSuggestionCard(suggestion, kind) {
        const cargo = suggestion?.cargo || {};
        const entries = Object.entries(cargo).filter(([, qty]) => Number(qty || 0) > 0);
        const buttonLabel = suggestion?.existing_route_id ? 'Update Route' : 'Create Route';
        const tone = kind === 'processed' ? 'rgba(96,74,33,0.35)' : 'rgba(30,54,69,0.35)';
        const pressure = Math.max(
          0,
          Number(suggestion?.source_surplus_before || 0),
          Number(suggestion?.target_deficit_before || 0)
        );
        const serverPriority = String(suggestion?.priority || '').toLowerCase();
        const priorityLabel = serverPriority
          ? serverPriority.charAt(0).toUpperCase() + serverPriority.slice(1)
          : (pressure > 25000 ? 'Critical' : (pressure > 8000 ? 'High' : 'Normal'));
        const priorityColor = priorityLabel.toLowerCase() === 'critical'
          ? '#ff6b6b'
          : (priorityLabel.toLowerCase() === 'high' ? '#ffd166' : '#8dd3a8');
        const priorityScore = Number(suggestion?.priority_score || 0);
        const priorityMultiplier = Number(suggestion?.priority_multiplier || 1);
        const reason = String(suggestion?.reason || 'stock-imbalance');
        const welfare = suggestion?.target_welfare || {};
        const foodCoverage = Number(welfare.food_coverage ?? 1);
        const energyBalance = Number(welfare.energy_balance ?? 0);
        const happiness = Number(welfare.happiness ?? 70);

        const reasonLabel = reason === 'welfare-shortage' ? 'Welfare shortage' : 'Stock imbalance';
        const reasonColor = reason === 'welfare-shortage' ? '#ff9f6b' : '#9fb8c6';

        const welfareBadges = [];
        if (Number.isFinite(foodCoverage)) {
          const foodTone = foodCoverage < 1 ? '#ff6b6b' : (foodCoverage < 1.2 ? '#ffd166' : '#8dd3a8');
          welfareBadges.push(`<span style="color:${foodTone};">Food ${foodCoverage.toFixed(2)}x</span>`);
        }
        if (Number.isFinite(energyBalance)) {
          const energyTone = energyBalance < 0 ? '#ff6b6b' : '#8dd3a8';
          const signedEnergy = energyBalance > 0 ? `+${Math.round(energyBalance)}` : `${Math.round(energyBalance)}`;
          welfareBadges.push(`<span style="color:${energyTone};">Energy ${signedEnergy}</span>`);
        }
        if (Number.isFinite(happiness)) {
          const happyTone = happiness < 50 ? '#ff6b6b' : (happiness < 70 ? '#ffd166' : '#8dd3a8');
          welfareBadges.push(`<span style="color:${happyTone};">Happy ${Math.round(happiness)}%</span>`);
        }

        const cargoBadges = entries.map(([resource, qty]) => this.renderCargoBadge(resource, qty)).join('');

        return `
          <div style="border:1px solid #4f6873; border-radius:4px; padding:6px; background:${tone};">
            <div style="font-weight:600; font-size:0.9em; margin-bottom:2px;">${esc(suggestion.origin_name)} -> ${esc(suggestion.target_name)}</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px;">${cargoBadges || '<span style="font-size:0.78em; color:#cfdce2;">No cargo</span>'}</div>
            <div style="font-size:0.75em; color:#95aab4; margin-bottom:5px;">
              ${esc(suggestion.resource_type)} • ${Number(suggestion.interval_hours || 24)}h • ${Number(suggestion.estimated_distance_ly || 0).toFixed(1)} ly
            </div>
            <div style="font-size:0.74em; color:${priorityColor}; margin-bottom:6px;">Priority: ${priorityLabel}${priorityScore > 0 ? ` (${priorityScore.toFixed(1)})` : ''}</div>
            <div style="font-size:0.73em; color:${reasonColor}; margin-bottom:4px;">Reason: ${reasonLabel}${priorityMultiplier > 1 ? ` • x${priorityMultiplier.toFixed(2)}` : ''}</div>
            <div style="font-size:0.72em; color:#9fb8c6; margin-bottom:6px; display:flex; gap:6px; flex-wrap:wrap;">${welfareBadges.join('')}</div>
            <button class="btn" style="width:100%; padding:4px;" data-apply-suggestion="${Number(suggestion.origin_colony_id || 0)}|${Number(suggestion.target_colony_id || 0)}|${encodeURIComponent(JSON.stringify(cargo))}|${Number(suggestion.interval_hours || 24)}">
              ${buttonLabel}
            </button>
          </div>
        `;
      }

      renderCargoBadge(resource, qty) {
        const key = String(resource || '').trim();
        const amount = Number(qty || 0);
        const meta = {
          metal: { label: 'Metal', color: '#d6b170' },
          crystal: { label: 'Crystal', color: '#72d0ff' },
          deuterium: { label: 'Deuterium', color: '#8fb7ff' },
          rare_earth: { label: 'Rare Earth', color: '#d18bff' },
          food: { label: 'Food', color: '#9fd18b' },
        }[key] || { label: key.replace(/_/g, ' '), color: '#d0d7de' };

        return `<span style="display:inline-flex; align-items:center; gap:4px; border:1px solid rgba(255,255,255,0.15); border-radius:999px; padding:2px 8px; font-size:0.74em; color:${meta.color}; background:rgba(0,0,0,0.25);">${esc(meta.label)} ${amount.toLocaleString()}</span>`;
      }

      classifyRouteTraffic(route) {
        const intervalHours = Math.max(1, Number(route?.interval_hours || 24));
        const isActive = !!route?.is_active;
        const isDue = !!route?.is_due;

        let lane = { label: 'Versorgungsroute', color: '#8fb9d8' };
        if (!isActive) {
          lane = { label: 'Pausiert', color: '#7c8694' };
        } else if (intervalHours <= 6) {
          lane = { label: 'Autobahn', color: '#ffb347' };
        } else if (intervalHours <= 12) {
          lane = { label: 'Schnelltrasse', color: '#ffd166' };
        } else if (intervalHours <= 24) {
          lane = { label: 'Haupttrasse', color: '#8dd3a8' };
        } else if (intervalHours <= 48) {
          lane = { label: 'Nebenroute', color: '#7cc8ff' };
        }

        let usage = 'neu';
        const lastDispatchRaw = route?.last_dispatch;
        if (lastDispatchRaw) {
          const lastTs = new Date(lastDispatchRaw).getTime();
          if (Number.isFinite(lastTs)) {
            const hoursSinceLast = Math.max(0, (Date.now() - lastTs) / 3600000);
            if (hoursSinceLast <= intervalHours * 1.25) {
              usage = 'oft benutzt';
            } else if (hoursSinceLast <= intervalHours * 3) {
              usage = 'regelmaessig';
            } else {
              usage = 'selten genutzt';
            }
          }
        }

        if (isDue && isActive) {
          usage = 'faellig';
        }
        if (!isActive) {
          usage = 'ruhend';
        }

        return {
          laneLabel: lane.label,
          laneColor: lane.color,
          usageLabel: usage,
        };
      }

      renderRouteCard(route) {
        const routeId = route.id;
        const intervalHours = Number(route.interval_hours || 24);
        const isDue = !!route.is_due;
        const traffic = this.classifyRouteTraffic(route);

        let nextExecProgressPct = isDue ? 100 : 0;
        let nextExecTone = 'is-good';
        let nextExecHtml = '';

        if (route.next_execution_at || route.last_execution_at) {
          const nextExecTime = route.next_execution_at ? new Date(route.next_execution_at).getTime() : null;
          const lastExecTime = route.last_execution_at ? new Date(route.last_execution_at).getTime() : null;
          const now = Date.now();

          if (nextExecTime) {
            const intervalMs = intervalHours * 3600000;
            const timeUntilNextMs = Math.max(0, nextExecTime - now);
            nextExecProgressPct = Math.min(100, Math.round((1 - (timeUntilNextMs / intervalMs)) * 100));
          } else if (lastExecTime) {
            const intervalMs = intervalHours * 3600000;
            const timeSinceLastMs = now - lastExecTime;
            nextExecProgressPct = Math.min(100, Math.round((timeSinceLastMs / intervalMs) * 100));
          }

          nextExecTone = nextExecProgressPct < 30 ? 'is-good' : (nextExecProgressPct < 70 ? 'is-warning' : 'is-critical');
          nextExecHtml = `<div class="entity-bars" style="margin-top:0.4rem;">
            <div class="entity-bar-row" title="Next execution in ${intervalHours - Math.floor(nextExecProgressPct / 100 * intervalHours)}h">
              <span class="entity-bar-label" style="font-size:0.75rem;">Next</span>
              <div class="bar-wrap"><div class="bar-fill bar-integrity ${nextExecTone}" style="width:${nextExecProgressPct}%"></div></div>
              <span class="entity-bar-value" style="font-size:0.75rem;">${nextExecProgressPct}%</span>
            </div>
          </div>`;
        }

        return `
          <div class="route-card" style="padding: 8px; border: 1px solid #777; border-radius: 4px; background: #1a1a1a;">
            <div style="font-weight: bold; margin-bottom: 4px;">
              ${esc(route.origin_name)} -> ${esc(route.target_name)}
            </div>
            <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
              <span style="display:inline-flex; align-items:center; border:1px solid ${traffic.laneColor}; color:${traffic.laneColor}; border-radius:999px; padding:1px 8px; font-size:0.72em; font-weight:600;">
                ${esc(traffic.laneLabel)}
              </span>
              <span style="font-size:0.72em; color:#b8c4cf;">${esc(traffic.usageLabel)}</span>
            </div>
            <div style="position:relative; height:8px; border-radius:999px; background:rgba(255,255,255,0.08); overflow:hidden; margin-bottom:6px;">
              <div style="position:absolute; inset:0; background:linear-gradient(90deg, transparent 0%, ${traffic.laneColor} 18%, ${traffic.laneColor} 82%, transparent 100%);"></div>
              <div style="position:absolute; left:0; right:0; top:3px; height:2px; background:repeating-linear-gradient(90deg, rgba(255,255,255,0.85) 0 9px, transparent 9px 16px);"></div>
            </div>
            <div style="font-size: 0.85em; color: #ccc; margin-bottom: 4px;">
              <span style="color: #ffa500;">${(route.cargo.metal || 0).toLocaleString()}</span> M
              <span style="color: #00ff00;">${(route.cargo.crystal || 0).toLocaleString()}</span> K
              <span style="color: #00ccff;">${(route.cargo.deuterium || 0).toLocaleString()}</span> D
            </div>
            <div style="font-size: 0.8em; color: #aaa; margin-bottom: 6px;">
              Interval: ${route.interval_hours}h
              ${route.is_due ? ' <span style="color: #f00;">[DUE NOW]</span>' : ''}
              ${!route.is_active ? ' <span style="color: #f80;">[PAUSED]</span>' : ''}
            </div>
            ${nextExecHtml}
            <div style="display: flex; gap: 4px; margin-top:6px;">
              <button data-toggle-route="${routeId}" class="btn" style="flex: 1; padding: 4px;">
                ${route.is_active ? 'Pause' : 'Resume'}
              </button>
              <button data-delete-route="${routeId}" class="btn" style="flex: 1; padding: 4px; color: #f55;">Delete</button>
            </div>
          </div>
        `;
      }

      attachEventListeners() {
        documentRef.getElementById('btn-create-route')?.addEventListener('click', () => this.showCreateDialog());

        documentRef.querySelectorAll('[data-toggle-route]').forEach((btn) => {
          btn.addEventListener('click', async (event) => {
            const routeId = parseInt(event.currentTarget?.dataset?.toggleRoute || '0', 10);
            if (!routeId) return;
            await api.toggleTradeRoute(routeId);
            invalidateGetCache([/api\/trade\.php/i]);
            await this.render();
          });
        });

        documentRef.querySelectorAll('[data-delete-route]').forEach((btn) => {
          btn.addEventListener('click', async (event) => {
            if (!confirm('Delete this trade route?')) return;
            const routeId = parseInt(event.currentTarget?.dataset?.deleteRoute || '0', 10);
            if (!routeId) return;
            await api.deleteTradeRoute(routeId);
            invalidateGetCache([/api\/trade\.php/i]);
            await this.render();
          });
        });

        documentRef.querySelectorAll('[data-apply-suggestion]').forEach((btn) => {
          btn.addEventListener('click', async (event) => {
            const raw = String(event.currentTarget?.dataset?.applySuggestion || '');
            const [originIdRaw, targetIdRaw, cargoEncoded, intervalRaw] = raw.split('|');
            const originColonyId = Number(originIdRaw || 0);
            const targetColonyId = Number(targetIdRaw || 0);
            const intervalHours = Number(intervalRaw || 24);
            if (!originColonyId || !targetColonyId) return;

            let cargo = {};
            try {
              cargo = JSON.parse(decodeURIComponent(cargoEncoded || '{}')) || {};
            } catch (_err) {
              cargo = {};
            }

            if (!Object.keys(cargo).length) return;

            await api.applyTradeSuggestion({
              origin_colony_id: originColonyId,
              target_colony_id: targetColonyId,
              cargo,
              interval_hours: intervalHours,
            });
            invalidateGetCache([/api\/trade\.php/i]);
            await this.render();
          });
        });
      }

      showCreateDialog(options = {}) {
        const config = getResourceInsightConfig(options.resourceKey);
        const focusedCargo = { metal: 0, crystal: 0, deuterium: 0 };
        if (config?.tradeable) {
          focusedCargo[config.key] = getSuggestedTradeAmount(config.key, 'offer');
        }
        const currentColony = getCurrentColony();
        const dialog = documentRef.createElement('div');
        dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #222; border: 2px solid #777; border-radius: 4px; padding: 16px; z-index: 10000; width: 90%; max-width: 400px;';
        dialog.innerHTML = `
          <h3 style="margin-top: 0;">Create Trade Route</h3>
          <p style="color: #aaa; font-size: 0.9em;">${config ? `${esc(config.icon)} ${esc(config.label)} fokussiert. ` : ''}Routen starten echte Frachter, binden Fracht an Flugzeit und verbrauchen Deuterium fuer den Transport.</p>
          <p style="color: #aaa; font-size: 0.85em;">This feature requires clicking on colonies to select. You can also use the command line API:</p>
          <code style="display: block; background: #1a1a1a; padding: 8px; border-radius: 2px; margin: 8px 0; font-size: 0.8em; word-break: break-all;">
            await API.createTradeRoute({ origin_colony_id: ${Number(currentColony?.id || 1)}, target_colony_id: 2, cargo_metal: ${Math.round(focusedCargo.metal || 1000)}, cargo_crystal: ${Math.round(focusedCargo.crystal || 500)}, cargo_deuterium: ${Math.round(focusedCargo.deuterium || 100)}, interval_hours: 24 })
          </code>
          <button class="btn" data-close-route-dialog="1" style="width: 100%;">Close</button>
        `;
        documentRef.body.appendChild(dialog);
        dialog.querySelector('[data-close-route-dialog="1"]')?.addEventListener('click', () => dialog.remove());
      }
    }

    return new TradeRoutesController();
  }

  const api = { createTradeRoutesController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeTradeRoutesController = api;
  }
})();
