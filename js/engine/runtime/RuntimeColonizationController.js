'use strict';

/**
 * RuntimeColonizationController
 *
 * Sprawl-Panel, Sektor-Verwaltung, Gouverneur-Zuweisung und Edikt-Steuerung.
 * Referenz: docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md
 *           lib/ColonizationEngine.php  /  api/colonization.php
 */
(function () {
  function createColonizationController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const esc = opts.esc || ((v) => String(v ?? ''));
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading…</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});

    // ── Tone helpers ─────────────────────────────────────────────────────────
    function sprawlTone(pct) {
      if (pct >= 200) return 'is-critical';
      if (pct >= 150) return 'is-critical';
      if (pct >= 121) return 'is-warning';
      if (pct >= 101) return 'is-warning';
      return 'is-good';
    }

    function sprawlStatusLabel(status) {
      const labels = {
        efficient: '✅ Effizient',
        strained: '⚠️ Angespannt',
        overstretched: '🔴 Überdehnt',
        crisis: '🔴 Krisenmodus',
        dissolution: '💀 Auflösung droht',
      };
      return labels[status] || esc(status);
    }

    // ── HTML helpers ─────────────────────────────────────────────────────────
    function entityBar(label, pct, tone, title) {
      return `<div class="entity-bar-row" title="${esc(title)}">
        <span class="entity-bar-label">${esc(label)}</span>
        <div class="bar-wrap"><div class="bar-fill bar-integrity ${esc(tone)}" style="width:${Math.min(100, pct)}%"></div></div>
        <span class="entity-bar-value">${pct}%</span>
      </div>`;
    }

    function statCard(label, value) {
      return `<div style="flex:1 1 110px;min-width:110px;background:#1f2533;border:1px solid #3a4762;border-radius:8px;padding:10px;">
        <div style="font-size:11px;color:#9fb0ce;">${esc(label)}</div>
        <div style="font-size:18px;font-weight:700;color:#e3efff;">${esc(String(value))}</div>
      </div>`;
    }

    // ── Main render ──────────────────────────────────────────────────────────
    class ColonizationController {
      constructor() {
        this.state = {
          sprawl: null,
          sectors: [],
          governors: [],
          edicts: [],
        };
        this.isBusy = false;
      }

      async loadData() {
        const [sprawlRes, sectorsRes, governorsRes, edictsRes] = await Promise.all([
          api.colonizationSprawl ? api.colonizationSprawl() : Promise.resolve(null),
          api.colonizationSectors ? api.colonizationSectors() : Promise.resolve({ success: true, sectors: [] }),
          api.colonizationGovernors ? api.colonizationGovernors() : Promise.resolve({ success: true, governors: [] }),
          api.colonizationEdicts ? api.colonizationEdicts() : Promise.resolve({ success: true, edicts: [] }),
        ]);

        this.state.sprawl = (sprawlRes && sprawlRes.success !== false) ? sprawlRes : null;
        this.state.sectors = (sectorsRes && sectorsRes.success && Array.isArray(sectorsRes.sectors)) ? sectorsRes.sectors : [];
        this.state.governors = (governorsRes && governorsRes.success && Array.isArray(governorsRes.governors)) ? governorsRes.governors : [];
        this.state.edicts = (edictsRes && edictsRes.success && Array.isArray(edictsRes.edicts)) ? edictsRes.edicts : [];
      }

      async render() {
        const root = wm.body('colonization');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();
        try {
          await this.loadData();
          root.innerHTML = this.renderHtml();
          this.attachEventListeners(root);
        } catch (err) {
          gameLog('warn', 'Colonization window load failed', err);
          root.innerHTML = '<p class="text-red">Failed to load colonization data.</p>';
        }
      }

      renderHtml() {
        const sprawl = this.state.sprawl || {};
        const sectors = this.state.sectors;
        const governors = this.state.governors;
        const edicts = this.state.edicts;

        const sprawlValue = Number(sprawl.sprawl_value || 0);
        const adminCap = Number(sprawl.admin_cap || 50);
        const sprawlPct = Number(sprawl.sprawl_pct || 0);
        const malus = sprawl.malus || {};
        const tone = sprawlTone(sprawlPct);

        // ── Sprawl panel ─────────────────────────────────────────────────────
        const sprawlHtml = `
          <section class="colonization-sprawl-panel" style="background:#1a1f2e;border:1px solid #2e374e;border-radius:8px;padding:12px;margin-bottom:10px;">
            <h3 style="margin:0 0 8px;font-size:14px;color:#adc4e8;">🌌 Empire Sprawl</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
              ${statCard('Sprawl', sprawlValue.toLocaleString('de-DE'))}
              ${statCard('AdminCap', adminCap.toLocaleString('de-DE'))}
              ${statCard('Status', sprawlStatusLabel(malus.status || 'efficient'))}
              ${statCard('Malus (Ressourcen)', (malus.resource_efficiency_pct >= 0 ? '+' : '') + (malus.resource_efficiency_pct || 0) + ' %')}
            </div>
            <div class="entity-bars">
              ${entityBar('Sprawl', Math.min(100, Math.round(sprawlPct / 2)), tone,
                `Sprawl ${sprawlValue} / AdminCap ${adminCap} = ${sprawlPct}%`)}
            </div>
            ${malus.rebellion_risk ? '<div style="color:#ff6b6b;font-size:12px;margin-top:6px;">⚠️ Rebellionsrisiko aktiv</div>' : ''}
          </section>`;

        // ── Sectors panel ────────────────────────────────────────────────────
        const sectorRows = sectors.length
          ? sectors.map((s) => `
            <tr>
              <td>${esc(s.name || '-')}</td>
              <td style="text-align:center;">${Number(s.system_count || 0)}</td>
              <td style="text-align:center;">${Number(s.autonomy_level || 0)} %</td>
              <td style="text-align:center;">${Number(s.approval_rating || 50)} / 100</td>
              <td style="text-align:center;">${s.governor_id ? `+${Number(s.governor_admin_bonus || 5)} AdminCap` : '<span style="color:#9fb0ce;">–</span>'}</td>
              <td>
                <button class="btn btn-sm btn-secondary sec-detail-btn" data-sector-id="${esc(String(s.id))}"
                  title="Sektor-Details anzeigen">Detail</button>
                <button class="btn btn-sm btn-danger sec-delete-btn" data-sector-id="${esc(String(s.id))}"
                  data-sector-name="${esc(s.name || '')}" title="Sektor löschen" style="margin-left:4px;">✕</button>
              </td>
            </tr>`).join('')
          : `<tr><td colspan="6">${uiKitEmptyStateHTML('Keine Sektoren', 'Erstelle deinen ersten Sektor.')}</td></tr>`;

        const sectorsHtml = `
          <section style="background:#1a1f2e;border:1px solid #2e374e;border-radius:8px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h3 style="margin:0;font-size:14px;color:#adc4e8;">🗺️ Sektoren (${sectors.length})</h3>
              <button class="btn btn-sm" id="col-create-sector-btn">+ Sektor erstellen</button>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="color:#9fb0ce;border-bottom:1px solid #2e374e;">
                  <th style="text-align:left;padding:4px;">Name</th>
                  <th style="padding:4px;">Systeme</th>
                  <th style="padding:4px;">Autonomie</th>
                  <th style="padding:4px;">Approval</th>
                  <th style="padding:4px;">Gouverneur</th>
                  <th style="padding:4px;">Aktionen</th>
                </tr>
              </thead>
              <tbody>${sectorRows}</tbody>
            </table>
          </section>`;

        // ── Governors panel ──────────────────────────────────────────────────
        const governorRows = governors.length
          ? governors.map((g) => `
            <tr>
              <td>#${Number(g.id || 0)}</td>
              <td style="text-align:center;">+${Number(g.admin_bonus || 5)}</td>
              <td style="text-align:center;">${Number(g.salary || 0).toLocaleString('de-DE')} ¢/Tick</td>
              <td>${g.sector_id ? `<span style="color:#88ff88;">${esc(g.sector_name || `Sektor #${g.sector_id}`)}</span>` : '<span style="color:#9fb0ce;">Frei</span>'}</td>
              <td>
                ${g.sector_id
                  ? `<button class="btn btn-sm btn-warning gov-dismiss-btn" data-governor-id="${esc(String(g.id))}" title="Gouverneur abberufen">Abberufen</button>`
                  : `<button class="btn btn-sm gov-appoint-btn" data-governor-id="${esc(String(g.id))}" title="Gouverneur zuweisen">Zuweisen</button>`}
              </td>
            </tr>`).join('')
          : `<tr><td colspan="5">${uiKitEmptyStateHTML('Keine Gouverneure', 'Stelle Gouverneure ein.')}</td></tr>`;

        const governorsHtml = `
          <section style="background:#1a1f2e;border:1px solid #2e374e;border-radius:8px;padding:12px;margin-bottom:10px;">
            <h3 style="margin:0 0 8px;font-size:14px;color:#adc4e8;">👤 Gouverneure (${governors.length})</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="color:#9fb0ce;border-bottom:1px solid #2e374e;">
                  <th style="text-align:left;padding:4px;">ID</th>
                  <th style="padding:4px;">+AdminCap</th>
                  <th style="padding:4px;">Gehalt</th>
                  <th style="padding:4px;">Sektor</th>
                  <th style="padding:4px;">Aktion</th>
                </tr>
              </thead>
              <tbody>${governorRows}</tbody>
            </table>
          </section>`;

        // ── Edicts panel ─────────────────────────────────────────────────────
        const edictLabels = {
          administrative_efficiency: { icon: '📋', label: 'Administrative Effizienz', desc: '+15 AdminCap' },
          martial_law:               { icon: '⚔️',  label: 'Kriegsrecht',             desc: '−15 Unruhe' },
          free_trade:                { icon: '💱',  label: 'Freihandel',              desc: '+10 % Ressourcen' },
          research_subsidy:          { icon: '🔬',  label: 'Forschungssubvention',    desc: '−15 % Forschungszeit' },
          colonization_drive:        { icon: '🚀',  label: 'Kolonisierungsoffensive', desc: '−20 % Kolonisierungskosten' },
          war_economy:               { icon: '🏭',  label: 'Kriegswirtschaft',        desc: '+30 % Flottenangriff, −20 % Konsumgüter' },
        };

        const edictCards = edicts.map((e) => {
          const meta = edictLabels[e.edict_type] || { icon: '⚙️', label: e.edict_type, desc: '' };
          const isActive = !!e.active;
          return `
            <div style="flex:1 1 160px;min-width:160px;background:${isActive ? '#1b2e1b' : '#1f2533'};border:1px solid ${isActive ? '#4a7a4a' : '#3a4762'};border-radius:8px;padding:10px;">
              <div style="font-size:20px;margin-bottom:4px;">${meta.icon}</div>
              <div style="font-size:12px;font-weight:700;color:#e3efff;margin-bottom:2px;">${esc(meta.label)}</div>
              <div style="font-size:11px;color:#9fb0ce;margin-bottom:6px;">${esc(meta.desc)}</div>
              <div style="font-size:11px;color:#ffcc44;margin-bottom:8px;">${Number(e.cost_per_tick || 0).toLocaleString('de-DE')} ¢/Tick</div>
              <button class="btn btn-sm ${isActive ? 'btn-warning edict-deactivate-btn' : 'edict-activate-btn'}"
                data-edict-type="${esc(e.edict_type)}"
                style="width:100%;">${isActive ? '⏹ Deaktivieren' : '▶ Aktivieren'}</button>
            </div>`;
        }).join('');

        const edictsHtml = `
          <section style="background:#1a1f2e;border:1px solid #2e374e;border-radius:8px;padding:12px;margin-bottom:10px;">
            <h3 style="margin:0 0 8px;font-size:14px;color:#adc4e8;">📜 Edikte</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${edictCards || uiKitEmptyStateHTML('Keine Edikte', '')}</div>
          </section>`;

        // ── Create-Sector form (hidden by default) ───────────────────────────
        const createFormHtml = `
          <div id="col-create-sector-form" style="display:none;background:#151b2a;border:1px solid #3a4762;border-radius:8px;padding:12px;margin-bottom:10px;">
            <h4 style="margin:0 0 8px;font-size:13px;color:#adc4e8;">Neuen Sektor erstellen</h4>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input type="text" id="col-sector-name-input" placeholder="Sektor-Name" maxlength="64"
                style="flex:1;min-width:140px;background:#1f2533;border:1px solid #3a4762;border-radius:4px;padding:6px 10px;color:#e3efff;font-size:12px;">
              <button class="btn btn-sm" id="col-sector-create-confirm-btn">Erstellen</button>
              <button class="btn btn-sm btn-secondary" id="col-sector-create-cancel-btn">Abbrechen</button>
            </div>
          </div>`;

        return `
          <div class="colonization-dashboard" style="display:grid;gap:10px;padding:4px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <button class="btn btn-sm btn-secondary" id="col-refresh-btn">↺ Aktualisieren</button>
            </div>
            ${createFormHtml}
            ${sprawlHtml}
            ${sectorsHtml}
            ${governorsHtml}
            ${edictsHtml}
          </div>`;
      }

      attachEventListeners(root) {
        // Refresh
        root.querySelector('#col-refresh-btn')?.addEventListener('click', () => this.render());

        // Create Sector — show form
        root.querySelector('#col-create-sector-btn')?.addEventListener('click', () => {
          const form = root.querySelector('#col-create-sector-form');
          if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
        });

        // Create Sector — cancel
        root.querySelector('#col-sector-create-cancel-btn')?.addEventListener('click', () => {
          const form = root.querySelector('#col-create-sector-form');
          if (form) form.style.display = 'none';
        });

        // Create Sector — confirm
        root.querySelector('#col-sector-create-confirm-btn')?.addEventListener('click', async () => {
          if (this.isBusy) return;
          const input = root.querySelector('#col-sector-name-input');
          const name = (input?.value || '').trim();
          if (!name) { showToast('Bitte einen Namen eingeben.', 'error'); return; }
          this.isBusy = true;
          try {
            const res = await api.colonizationCreateSector({ name });
            if (res && res.success) {
              showToast(`Sektor "${name}" erstellt.`, 'success');
              await this.render();
            } else {
              showToast(res?.message || 'Fehler beim Erstellen.', 'error');
            }
          } catch (err) {
            gameLog('warn', 'create sector failed', err);
            showToast('Fehler beim Erstellen des Sektors.', 'error');
          } finally {
            this.isBusy = false;
          }
        });

        // Delete Sector
        root.querySelectorAll('.sec-delete-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            const sectorId = btn.dataset.sectorId;
            const name = btn.dataset.sectorName || `#${sectorId}`;
            if (!window.confirm(`Sektor "${name}" wirklich löschen? Alle System-Zuordnungen werden entfernt.`)) return;
            this.isBusy = true;
            try {
              const res = await api.colonizationDeleteSector(sectorId);
              if (res && res.success) {
                showToast(`Sektor "${name}" gelöscht.`, 'success');
                await this.render();
              } else {
                showToast(res?.message || 'Fehler beim Löschen.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'delete sector failed', err);
              showToast('Fehler beim Löschen des Sektors.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });

        // Activate Edict
        root.querySelectorAll('.edict-activate-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            const edictType = btn.dataset.edictType;
            this.isBusy = true;
            try {
              const res = await api.colonizationActivateEdict(edictType);
              if (res && res.success) {
                showToast('Edikt aktiviert.', 'success');
                await this.render();
              } else {
                showToast(res?.message || 'Fehler beim Aktivieren.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'activate edict failed', err);
              showToast('Fehler beim Aktivieren des Edikts.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });

        // Deactivate Edict
        root.querySelectorAll('.edict-deactivate-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            const edictType = btn.dataset.edictType;
            this.isBusy = true;
            try {
              const res = await api.colonizationDeactivateEdict(edictType);
              if (res && res.success) {
                showToast('Edikt deaktiviert.', 'success');
                await this.render();
              } else {
                showToast(res?.message || 'Fehler beim Deaktivieren.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'deactivate edict failed', err);
              showToast('Fehler beim Deaktivieren des Edikts.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });

        // Dismiss Governor
        root.querySelectorAll('.gov-dismiss-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            const governorId = btn.dataset.governorId;
            this.isBusy = true;
            try {
              const res = await api.colonizationDismissGovernor(governorId);
              if (res && res.success) {
                showToast('Gouverneur abberufen.', 'success');
                await this.render();
              } else {
                showToast(res?.message || 'Fehler beim Abberufen.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'dismiss governor failed', err);
              showToast('Fehler beim Abberufen des Gouverneurs.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });
      }
    }

    return new ColonizationController();
  }

  const api = { createColonizationController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeColonizationController = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
