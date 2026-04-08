'use strict';

/**
 * RuntimeWarController.js
 *
 * War overview window controller.  Loads data from api/war.php?action=list
 * and api/war.php?action=get_status, renders it into the WM-managed "wars"
 * window body, and handles peace-offer interactions.
 *
 * Follows the same pattern as RuntimePiratesController.
 */
(function () {
  function createWarController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading…</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((v) => String(v ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});

    // ── Styles ────────────────────────────────────────────────────────────────
    const S = {
      card: 'flex:1 1 110px;min-width:110px;background:#1f2533;border:1px solid #3a4762;border-radius:8px;padding:10px;',
      cardLabel: 'font-size:11px;color:#9fb0ce;',
      cardValue: 'font-size:18px;font-weight:700;color:#e3efff;',
      section: 'background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;',
      sectionTitle: 'font-weight:700;margin-bottom:6px;',
      table: 'width:100%;border-collapse:collapse;font-size:12px;',
      th: 'text-align:left;padding:4px;border-bottom:1px solid #3a4762;',
      thR: 'text-align:right;padding:4px;border-bottom:1px solid #3a4762;',
      td: 'padding:4px;',
      tdR: 'text-align:right;padding:4px;',
      btn: 'background:#2e374e;border:1px solid #4a5878;color:#d7e4ff;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;',
      btnDanger: 'background:#4e2020;border:1px solid #782e2e;color:#ffcdd2;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;',
    };

    // ── Score-bar renderer ────────────────────────────────────────────────────
    function scoreBarHtml(attScore, defScore) {
      const total = Math.max(1, attScore + defScore);
      const attPct = Math.round((attScore / total) * 100);
      const defPct = 100 - attPct;
      return `
        <div style="display:flex;gap:6px;align-items:center;font-size:11px;">
          <span style="color:#7eb8ff;min-width:38px;text-align:right;">${Number(attScore).toLocaleString('de-DE')}</span>
          <div style="flex:1;height:8px;background:#1f2533;border-radius:4px;overflow:hidden;display:flex;">
            <div style="width:${attPct}%;background:#3a7eff;"></div>
            <div style="width:${defPct}%;background:#bf4040;"></div>
          </div>
          <span style="color:#ff9980;min-width:38px;">${Number(defScore).toLocaleString('de-DE')}</span>
        </div>
      `;
    }

    // ── Goal progress summary ─────────────────────────────────────────────────
    function goalBadgeHtml(goalCounts) {
      if (!goalCounts || !goalCounts.total) return '<span style="color:#9fb0ce;font-size:11px;">no goals</span>';
      const parts = [];
      if (goalCounts.advantage) parts.push(`<span style="color:#5fd679;">${goalCounts.advantage} winning</span>`);
      if (goalCounts.active) parts.push(`<span style="color:#f0c040;">${goalCounts.active} active</span>`);
      if (goalCounts.blocked) parts.push(`<span style="color:#ff9980;">${goalCounts.blocked} blocked</span>`);
      return parts.join(' <span style="color:#4a5878;">·</span> ') || '<span style="color:#9fb0ce;font-size:11px;">no data</span>';
    }

    // ── War row ────────────────────────────────────────────────────────────────
    function warRowHtml(war, isAttacker) {
      const side = isAttacker ? 'Attacker' : 'Defender';
      const sideColor = isAttacker ? '#7eb8ff' : '#ff9980';
      const summary = war.summary || {};
      const primaryGoal = summary.primary_goal || null;
      const pressure = Number(summary.pressure || 0);
      const goalCounts = summary.goal_counts || {};
      const attScore = Number(war.war_score_att || 0);
      const defScore = Number(war.war_score_def || 0);
      const exhaustAtt = Number(war.exhaustion_att || 0).toFixed(1);
      const exhaustDef = Number(war.exhaustion_def || 0).toFixed(1);

      return `
        <tr data-war-row="${esc(war.id)}">
          <td style="${S.td}">#${esc(war.id)}</td>
          <td style="${S.td}"><span style="color:${sideColor};font-weight:700;">${side}</span></td>
          <td style="${S.td}">
            ${scoreBarHtml(attScore, defScore)}
          </td>
          <td style="${S.td};font-size:11px;color:#9fb0ce;">${exhaustAtt} / ${exhaustDef}</td>
          <td style="${S.td};font-size:11px;color:#f0c040;">${primaryGoal ? esc(primaryGoal) : '—'}</td>
          <td style="${S.td}">${goalBadgeHtml(goalCounts)}</td>
          <td style="${S.tdR};color:${pressure > 50 ? '#ff9980' : '#9fb0ce'};">${Number(pressure).toFixed(0)}</td>
          <td style="${S.tdR};">
            <button style="${S.btn}" data-war-details="${esc(war.id)}">Details</button>
          </td>
        </tr>
      `;
    }

    // ── Offer-peace modal content ─────────────────────────────────────────────
    function offerPeaceFormHtml(warId) {
      const peaceTermOptions = [
        { value: 'white_peace',      label: 'White Peace (Status Quo)' },
        { value: 'reparations',      label: 'Reparations (Credits)' },
        { value: 'resource_tribute', label: 'Resource Tribute' },
        { value: 'system_handover',  label: 'System Handover' },
        { value: 'vassal_status',    label: 'Vassal Status' },
      ];
      const termCheckboxes = peaceTermOptions.map((t) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#d7e4ff;cursor:pointer;">
          <input type="checkbox" class="peace-term-check" value="${esc(t.value)}" style="accent-color:#3a7eff;">
          ${esc(t.label)}
        </label>`).join('');
      return `
        <div style="padding:12px;display:grid;gap:10px;">
          <div style="${S.sectionTitle}">⚖ Offer Peace (War #${esc(warId)})</div>
          <p style="color:#9fb0ce;font-size:12px;">Select your peace terms. Leave all unchecked for a White Peace offer.</p>
          <div style="display:grid;gap:6px;">${termCheckboxes}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button style="${S.btn}" data-offer-confirm="${esc(warId)}">Send Peace Offer</button>
            <button style="${S.btn}" data-offer-cancel="1">Cancel</button>
          </div>
        </div>
      `;
    }

    function counterOfferFormHtml(offerId, warId) {
      const counterTermOptions = [
        { value: 'white_peace',      label: 'White Peace (Status Quo)' },
        { value: 'reparations',      label: 'Demand Reparations' },
        { value: 'resource_tribute', label: 'Demand Resource Tribute' },
        { value: 'continuation',     label: 'Continue Fighting (no terms)' },
      ];
      const termCheckboxes = counterTermOptions.map((t) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#d7e4ff;cursor:pointer;">
          <input type="checkbox" class="counter-term-check" value="${esc(t.value)}" style="accent-color:#bf4040;">
          ${esc(t.label)}
        </label>`).join('');
      return `
        <div style="padding:12px;display:grid;gap:10px;">
          <div style="${S.sectionTitle}">🔄 Counter-Offer (in response to Offer #${esc(offerId)})</div>
          <p style="color:#9fb0ce;font-size:12px;">Reject and immediately propose counter-terms, or simply reject without a counter.</p>
          <div style="display:grid;gap:6px;">${termCheckboxes}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button style="${S.btn}" data-counter-confirm data-offer-id="${esc(offerId)}" data-war-id="${esc(warId)}">Send Counter-Offer</button>
            <button style="${S.btnDanger}" data-counter-reject data-offer-id="${esc(offerId)}">Reject Only</button>
            <button style="${S.btn}" data-offer-cancel="1">Cancel</button>
          </div>
        </div>
      `;
    }

    // ── Pending offers list ────────────────────────────────────────────────────
    function pendingOffersHtml(offers, myUid) {
      const pending = (offers || []).filter((o) => o.status === 'pending');
      if (!pending.length) return '';
      const rows = pending.map((offer) => {
        const isIncoming = Number(offer.from_user_id) !== Number(myUid);
        return `
          <div style="background:#141922;border:1px solid #2e374e;border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span style="flex:1;font-size:12px;color:#d7e4ff;">
              ${isIncoming ? '⬇ Incoming' : '⬆ Outgoing'} peace offer #${esc(offer.id)}
              <span style="color:#9fb0ce;margin-left:6px;">(expires ${esc(offer.expires_at || '?')})</span>
            </span>
            ${isIncoming ? `
              <button style="${S.btn}" data-offer-accept="${esc(offer.id)}">Accept</button>
              <button style="${S.btn}" data-offer-counter="${esc(offer.id)}" data-war-id="${esc(offer.war_id || '')}">Counter</button>
              <button style="${S.btnDanger}" data-offer-reject="${esc(offer.id)}">Reject</button>
            ` : `
              <span style="color:#9fb0ce;font-size:11px;">Awaiting response</span>
            `}
          </div>
        `;
      }).join('');
      return `
        <div style="${S.section}">
          <div style="${S.sectionTitle}">Peace Offers</div>
          <div style="display:grid;gap:6px;">${rows}</div>
        </div>
      `;
    }

    // ── War detail view ────────────────────────────────────────────────────────
    function warDetailHtml(warData, myUid) {
      const goals = Array.isArray(warData.goals) ? warData.goals : [];
      const offers = Array.isArray(warData.peace_offers) ? warData.peace_offers : [];
      const attScore = Number(warData.war_score_att || 0);
      const defScore = Number(warData.war_score_def || 0);

      const goalRows = goals.map((goal) => {
        const progress = goal.progress || {};
        const rateLabel = progress.score_rate_per_day > 0
          ? `<span style="color:#5fd679;">+${Number(progress.score_rate_per_day).toFixed(2)}/day</span>`
          : '<span style="color:#9fb0ce;">0/day</span>';
        return `
          <tr>
            <td style="${S.td}">${esc(goal.goal_type)}</td>
            <td style="${S.td}">${esc(goal.side)}</td>
            <td style="${S.td};font-weight:700;color:${progress.status === 'advantage' || progress.status === 'contested_controlled' ? '#5fd679' : '#f0c040'};">
              ${esc(progress.label || progress.status || '?')}
            </td>
            <td style="${S.tdR}">${rateLabel}</td>
            <td style="${S.td};color:#9fb0ce;font-size:11px;">${esc(progress.hint || '')}</td>
          </tr>
        `;
      }).join('');

      return `
        <div style="display:grid;gap:10px;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button style="${S.btn}" data-back="1">← Back</button>
            <span style="font-weight:700;font-size:14px;color:#e3efff;">War #${esc(warData.war_id)} — ${esc(warData.status)}</span>
            <span style="flex:1;"></span>
            ${warData.status === 'active' ? `<button style="${S.btnDanger}" data-offer-peace-btn="${esc(warData.war_id)}">Offer Peace</button>` : ''}
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div style="${S.card}"><div style="${S.cardLabel}">Attacker Score</div><div style="${S.cardValue}" style="color:#7eb8ff;">${Number(attScore).toLocaleString('de-DE')}</div></div>
            <div style="${S.card}"><div style="${S.cardLabel}">Defender Score</div><div style="${S.cardValue}" style="color:#ff9980;">${Number(defScore).toLocaleString('de-DE')}</div></div>
            <div style="${S.card}"><div style="${S.cardLabel}">Exhaustion Att/Def</div><div style="${S.cardValue}">${Number(warData.exhaustion_att || 0).toFixed(1)} / ${Number(warData.exhaustion_def || 0).toFixed(1)}</div></div>
            <div style="${S.card}"><div style="${S.cardLabel}">Started</div><div style="${S.cardValue}" style="font-size:11px;">${esc(warData.started_at || '?')}</div></div>
          </div>

          ${pendingOffersHtml(offers, myUid)}

          <div style="${S.section}">
            <div style="${S.sectionTitle}">War Goals</div>
            ${goals.length === 0
              ? uiKitEmptyStateHTML('No war goals', 'No goals declared for this war.')
              : `
                <table style="${S.table}">
                  <thead>
                    <tr>
                      <th style="${S.th}">Type</th>
                      <th style="${S.th}">Side</th>
                      <th style="${S.th}">Status</th>
                      <th style="${S.thR}">Score Rate</th>
                      <th style="${S.th}">Hint</th>
                    </tr>
                  </thead>
                  <tbody>${goalRows}</tbody>
                </table>
              `}
          </div>
        </div>
      `;
    }

    class WarController {
      constructor() {
        this.state = {
          wars: [],
          detailWarId: null,
          detailData: null,
          myUid: null,
        };
        this.isBusy = false;
      }

      async loadList() {
        const res = await api.wars();
        this.state.wars = (res && res.success && Array.isArray(res.wars)) ? res.wars : [];
      }

      async loadDetail(warId) {
        const res = await api.warStatus(warId);
        this.state.detailData = (res && res.success) ? res : null;
      }

      _myUid() {
        // Normalise: prefer window._GQ_meta.uid if available, otherwise fall back
        try {
          return Number(window._GQ_meta?.uid || 0);
        } catch (_) {
          return 0;
        }
      }

      async render() {
        const root = wm && wm.body('wars');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        this.state.myUid = this._myUid();

        try {
          if (this.state.detailWarId !== null) {
            await this.loadDetail(this.state.detailWarId);
            root.innerHTML = this.state.detailData
              ? warDetailHtml(this.state.detailData, this.state.myUid)
              : `<p style="color:#ff9980;padding:10px;">Failed to load war details.</p>`;
          } else {
            await this.loadList();
            root.innerHTML = this.renderListHtml();
          }
          this._attachListeners(root);
        } catch (err) {
          gameLog('warn', 'War window load failed', err);
          root.innerHTML = '<p class="text-red">Failed to load war data.</p>';
        }
      }

      renderListHtml() {
        const wars = this.state.wars;
        const myUid = this.state.myUid;

        if (!wars.length) {
          return `
            <div style="display:grid;gap:10px;">
              <section style="display:flex;gap:8px;flex-wrap:wrap;">
                <button style="${S.btn}" data-wars-refresh="1">Refresh</button>
                <button style="${S.btnDanger}" data-wars-declare="1">⚔ Declare War</button>
              </section>
              <div data-declare-form-host style="display:none;"></div>
              ${uiKitEmptyStateHTML('No active wars', 'Your empire is currently at peace.')}
            </div>
          `;
        }

        const rows = wars.map((w) => {
          const isAttacker = Number(w.attacker_user_id) === myUid;
          return warRowHtml(w, isAttacker);
        }).join('');

        return `
          <div style="display:grid;gap:10px;">
            <section style="display:flex;gap:8px;flex-wrap:wrap;">
              <button style="${S.btn}" data-wars-refresh="1">Refresh</button>
              <button style="${S.btnDanger}" data-wars-declare="1">⚔ Declare War</button>
            </section>
            <div data-declare-form-host style="display:none;"></div>
            <div style="${S.section}">
              <div style="${S.sectionTitle}">Active Wars</div>
              <table style="${S.table}">
                <thead>
                  <tr>
                    <th style="${S.th}">ID</th>
                    <th style="${S.th}">Your Side</th>
                    <th style="${S.th}">Score (Att / Def)</th>
                    <th style="${S.th}">Exhaustion</th>
                    <th style="${S.th}">Primary Goal</th>
                    <th style="${S.th}">Goal Progress</th>
                    <th style="${S.thR}">Pressure</th>
                    <th style="${S.thR}"></th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        `;
      }

      _attachListeners(root) {
        // Back to list
        root.querySelector('[data-back="1"]')?.addEventListener('click', () => {
          this.state.detailWarId = null;
          this.state.detailData = null;
          this.render();
        });

        // PHASE 4.1: Declare war button (uses target user ID expected by backend)
        root.querySelector('[data-wars-declare="1"]')?.addEventListener('click', () => {
          const formHost = root.querySelector('[data-declare-form-host]');
          if (!formHost) return;
          if (formHost.style.display !== 'none') {
            formHost.style.display = 'none';
            formHost.innerHTML = '';
            return;
          }

          formHost.innerHTML = `
            <div style="background:#2a1820;border:1px solid #7a2e2e;border-radius:8px;padding:12px;display:grid;gap:10px;">
              <div style="font-weight:700;color:#ffcdd2;">⚔ Declare War</div>
              <label style="font-size:11px;color:#9fb0ce;">Target User ID
                <input data-dw-target-user type="number" min="1" step="1" placeholder="e.g. 42"
                  style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:4px;">
              </label>
              <div style="font-size:11px;color:#9fb0ce;">War Goals (select one or more)
                <div style="display:grid;gap:4px;margin-top:4px;">
                  ${[
                    { value: 'subjugation',  label: '👑 Subjugation',   desc: 'Force opponent into a vassal relationship' },
                    { value: 'annex_system', label: '🗺 Annex System',  desc: 'Claim a specific star system' },
                    { value: 'attrition',    label: '💀 Attrition',     desc: 'Destroy military capacity' },
                    { value: 'economic',     label: '💰 Economic',      desc: 'Seize trade routes and resources' },
                    { value: 'diplomatic',   label: '🕊 Diplomatic',    desc: 'Force a diplomatic concession' },
                  ].map((g) => `
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:#1a1020;padding:5px 8px;border-radius:4px;border:1px solid #3a2030;">
                      <input type="checkbox" class="dw-goal-check" value="${g.value}" style="accent-color:#bf4040;flex-shrink:0;">
                      <span><strong style="color:#ffcdd2;">${g.label}</strong>
                        <span style="color:#9fb0ce;font-size:11px;margin-left:4px;">${g.desc}</span></span>
                    </label>`).join('')}
                </div>
              </div>
              <label style="font-size:11px;color:#9fb0ce;">Casus Belli (optional)
                <input data-dw-casus type="text" maxlength="120" placeholder="e.g. Border aggression"
                  style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:4px;">
              </label>
              <div style="display:flex;gap:8px;">
                <button data-dw-confirm style="background:#6b1e1e;border:1px solid #9e3030;color:#ffcdd2;border-radius:5px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:700;">Confirm Declaration</button>
                <button data-dw-cancel style="${S.btn}">Cancel</button>
              </div>
            </div>`;
          formHost.style.display = '';

          formHost.querySelector('[data-dw-cancel]')?.addEventListener('click', () => {
            formHost.style.display = 'none';
            formHost.innerHTML = '';
          });

          formHost.querySelector('[data-dw-confirm]')?.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const targetUserId = Number(formHost.querySelector('[data-dw-target-user]')?.value || 0);
            const checkedGoals = [...formHost.querySelectorAll('.dw-goal-check:checked')].map((cb) => cb.value);
            const warGoals = checkedGoals.length > 0 ? checkedGoals : ['subjugation'];
            const casusBelli = String(formHost.querySelector('[data-dw-casus]')?.value || '').trim();
            if (!targetUserId) {
              showToast('Please enter a target user ID.', 'warning');
              this.isBusy = false;
              return;
            }
            try {
              const res = await api.declareStrategicWar({
                target_user_id: targetUserId,
                war_goals: warGoals,
                casus_belli: casusBelli,
              });
              if (res?.success) {
                showToast('War declared! War #' + (res.war_id || '?'), 'warning');
                invalidateGetCache([/api\/war\.php\?action=/i]);
                formHost.style.display = 'none';
                formHost.innerHTML = '';
                await this.render();
              } else {
                showToast(res?.error || 'Failed to declare war.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'declareStrategicWar failed', err);
              showToast('Network error declaring war.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });

        // Refresh list
        root.querySelector('[data-wars-refresh="1"]')?.addEventListener('click', () => {
          this.render();
        });

        // Detail view
        root.querySelectorAll('[data-war-details]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const wid = Number(btn.dataset.warDetails);
            this.state.detailWarId = wid;
            await this.render();
          });
        });

        // Offer peace (in detail view toolbar)
        root.querySelector('[data-offer-peace-btn]')?.addEventListener('click', (ev) => {
          const wid = Number(ev.currentTarget.dataset.offerPeaceBtn);
          const offerForm = root.querySelector('[data-offer-form-host]');
          if (!offerForm) return;
          offerForm.innerHTML = offerPeaceFormHtml(wid);
          offerForm.style.display = '';
          offerForm.querySelector('[data-offer-cancel="1"]')?.addEventListener('click', () => {
            offerForm.style.display = 'none';
            offerForm.innerHTML = '';
          });
          offerForm.querySelector(`[data-offer-confirm]`)?.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const selectedTerms = [...offerForm.querySelectorAll('.peace-term-check:checked')].map((cb) => cb.value);
            try {
              const res = await api.offerPeace({ war_id: wid, terms: selectedTerms });
              if (res && res.success) {
                invalidateGetCache([/api\/war\.php\?action=/i]);
                showToast('Peace offer sent.', 'success');
                this.state.detailData = null;
                await this.loadDetail(wid);
              } else {
                showToast(res?.error || 'Failed to send peace offer.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'offerPeace failed', err);
              showToast('Network error sending peace offer.', 'error');
            } finally {
              this.isBusy = false;
              offerForm.style.display = 'none';
              offerForm.innerHTML = '';
              await this.render();
            }
          });
        });

        // Accept / reject / counter incoming offers
        root.querySelectorAll('[data-offer-accept]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const offerId = Number(btn.dataset.offerAccept);
            try {
              const res = await api.respondPeaceOffer({ offer_id: offerId, accept: true });
              if (res && res.success) {
                invalidateGetCache([/api\/war\.php\?action=/i]);
                showToast('Peace offer accepted — war ended.', 'success');
                this.state.detailWarId = null;
                this.state.detailData = null;
              } else {
                showToast(res?.error || 'Failed to accept offer.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'respondPeaceOffer(accept) failed', err);
              showToast('Network error accepting peace offer.', 'error');
            } finally {
              this.isBusy = false;
              await this.render();
            }
          });
        });

        // Counter-offer button: show form
        root.querySelectorAll('[data-offer-counter]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const offerId = btn.dataset.offerCounter;
            const warId = btn.dataset.warId || this.state.detailWarId || 0;
            const offerForm = root.querySelector('[data-offer-form-host]');
            if (!offerForm) return;
            offerForm.innerHTML = counterOfferFormHtml(offerId, warId);
            offerForm.style.display = '';
            offerForm.querySelector('[data-offer-cancel="1"]')?.addEventListener('click', () => {
              offerForm.style.display = 'none';
              offerForm.innerHTML = '';
            });

            // "Send Counter-Offer" — reject incoming, then offer peace with new terms
            offerForm.querySelector('[data-counter-confirm]')?.addEventListener('click', async () => {
              if (this.isBusy) return;
              this.isBusy = true;
              const oid = Number(offerForm.querySelector('[data-counter-confirm]')?.dataset.offerId || offerId);
              const wid2 = Number(offerForm.querySelector('[data-counter-confirm]')?.dataset.warId || warId);
              const counterTerms = [...offerForm.querySelectorAll('.counter-term-check:checked')].map((cb) => cb.value);
              try {
                // First reject the original offer
                await api.respondPeaceOffer({ offer_id: oid, accept: false });
                // Then submit the counter-offer
                const res = await api.offerPeace({ war_id: wid2, terms: counterTerms });
                if (res && res.success) {
                  invalidateGetCache([/api\/war\.php\?action=/i]);
                  showToast('Counter-offer sent.', 'success');
                } else {
                  showToast(res?.error || 'Failed to send counter-offer.', 'error');
                }
              } catch (err) {
                gameLog('warn', 'counterOffer failed', err);
                showToast('Network error sending counter-offer.', 'error');
              } finally {
                this.isBusy = false;
                offerForm.style.display = 'none';
                offerForm.innerHTML = '';
                await this.render();
              }
            });

            // "Reject Only"
            offerForm.querySelector('[data-counter-reject]')?.addEventListener('click', async () => {
              if (this.isBusy) return;
              this.isBusy = true;
              const oid = Number(offerForm.querySelector('[data-counter-reject]')?.dataset.offerId || offerId);
              try {
                const res = await api.respondPeaceOffer({ offer_id: oid, accept: false });
                if (res && res.success) {
                  invalidateGetCache([/api\/war\.php\?action=/i]);
                  showToast('Peace offer rejected.', 'info');
                } else {
                  showToast(res?.error || 'Failed to reject offer.', 'error');
                }
              } catch (err) {
                gameLog('warn', 'respondPeaceOffer(reject) failed', err);
                showToast('Network error rejecting peace offer.', 'error');
              } finally {
                this.isBusy = false;
                offerForm.style.display = 'none';
                offerForm.innerHTML = '';
                await this.render();
              }
            });
          });
        });

        root.querySelectorAll('[data-offer-reject]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const offerId = Number(btn.dataset.offerReject);
            try {
              const res = await api.respondPeaceOffer({ offer_id: offerId, accept: false });
              if (res && res.success) {
                invalidateGetCache([/api\/war\.php\?action=/i]);
                showToast('Peace offer rejected.', 'info');
              } else {
                showToast(res?.error || 'Failed to reject offer.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'respondPeaceOffer(reject) failed', err);
              showToast('Network error rejecting peace offer.', 'error');
            } finally {
              this.isBusy = false;
              await this.render();
            }
          });
        });

        // Inline offer-form host (injected into detail view when not yet present)
        if (!root.querySelector('[data-offer-form-host]')) {
          const host = document.createElement('div');
          host.setAttribute('data-offer-form-host', '1');
          host.style.display = 'none';
          root.appendChild(host);
        }
      }
    }

    return new WarController();
  }

  const api = { createWarController };

  if (typeof window !== 'undefined') {
    window.GQRuntimeWarController = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
