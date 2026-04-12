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
      const isNpc = !!war.is_npc_war;
      const side = isNpc ? 'NPC Attack' : (isAttacker ? 'Attacker' : 'Defender');
      const sideColor = isNpc ? '#ff9f40' : (isAttacker ? '#7eb8ff' : '#ff9980');
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
        const goalScoreDisplay = (goal.score_value != null && goal.score_value !== '')
          ? Number(goal.score_value).toLocaleString('de-DE')
          : 'Unbekannt';
        return `
          <tr>
            <td style="${S.td}">${esc(goal.goal_type)}</td>
            <td style="${S.td}">${esc(goal.side)}</td>
            <td style="${S.td};font-weight:700;color:${progress.status === 'advantage' || progress.status === 'contested_controlled' ? '#5fd679' : '#f0c040'};">
              ${esc(progress.label || progress.status || '?')}
            </td>
            <td style="${S.tdR};color:#a0c8ff;">${esc(goalScoreDisplay)}</td>
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
                      <th style="${S.thR}">Goal Score</th>
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
          const isNpc      = !!w.is_npc_war;
          const isAttacker = !isNpc && Number(w.attacker_user_id) === myUid;
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

  // ── Alliance War Controller (N-vs-M) ────────────────────────────────────────

  /**
   * createAllianceWarController(opts)
   *
   * Renders N-vs-M alliance wars into a WM-managed window body.
   * Supports declaring wars between multiple alliances per side (e.g. 2v2, 3v4),
   * viewing war status, and managing peace offers.
   */
  function createAllianceWarController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading…</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((v) => String(v ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});

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
      btnWarn: 'background:#4e3a00;border:1px solid #7a5c00;color:#ffe5a0;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;',
      sideA: 'color:#7eb8ff;font-weight:700;',
      sideB: 'color:#ff9980;font-weight:700;',
    };

    /** Renders a comma-separated list of alliance tags with links. */
    function sideTagsHtml(sideAlliances, styleStr) {
      if (!Array.isArray(sideAlliances) || !sideAlliances.length) {
        return '<span style="color:#9fb0ce;font-size:11px;">—</span>';
      }
      return sideAlliances
        .map((a) => `<span style="${styleStr}">[${esc(a.tag)}] ${esc(a.name)}</span>`)
        .join('<span style="color:#4a5878;"> + </span>');
    }

    /** Score bar for two sides. */
    function scoreBarHtml(scoreA, scoreB) {
      const total = Math.max(1, scoreA + scoreB);
      const pctA = Math.round((scoreA / total) * 100);
      const pctB = 100 - pctA;
      return `
        <div style="display:flex;gap:6px;align-items:center;font-size:11px;">
          <span style="color:#7eb8ff;min-width:38px;text-align:right;">${Number(scoreA).toLocaleString('de-DE')}</span>
          <div style="flex:1;height:8px;background:#1f2533;border-radius:4px;overflow:hidden;display:flex;">
            <div style="width:${pctA}%;background:#3a7eff;"></div>
            <div style="width:${pctB}%;background:#bf4040;"></div>
          </div>
          <span style="color:#ff9980;min-width:38px;">${Number(scoreB).toLocaleString('de-DE')}</span>
        </div>`;
    }

    /** Single war row for list view. */
    function warRowHtml(war) {
      const mySide = war.my_side === 'a' ? 'Side A' : 'Side B';
      const mySideColor = war.my_side === 'a' ? '#7eb8ff' : '#ff9980';
      const sideA = war.side_a || [];
      const sideB = war.side_b || [];
      return `
        <tr data-aw-row="${esc(war.war_id)}">
          <td style="${S.td}">#${esc(war.war_id)}</td>
          <td style="${S.td};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(war.name)}</td>
          <td style="${S.td};font-size:11px;">${sideTagsHtml(sideA, S.sideA)}</td>
          <td style="${S.td};font-size:11px;">${sideTagsHtml(sideB, S.sideB)}</td>
          <td style="${S.td};">${scoreBarHtml(Number(war.war_score_a || 0), Number(war.war_score_b || 0))}</td>
          <td style="${S.td};color:${mySideColor};font-size:11px;">${mySide}</td>
          <td style="${S.tdR};">
            <button style="${S.btn}" data-aw-details="${esc(war.war_id)}">Details</button>
          </td>
        </tr>`;
    }

    /** Peace offer rows. */
    function peaceOffersHtml(offers, myAllianceIds) {
      const pending = (offers || []).filter((o) => o.status === 'pending');
      if (!pending.length) return '';
      const rows = pending.map((offer) => {
        const isIncoming = !myAllianceIds.includes(Number(offer.from_alliance_id));
        return `
          <div style="background:#141922;border:1px solid #2e374e;border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span style="flex:1;font-size:12px;color:#d7e4ff;">
              ${isIncoming ? '⬇ Incoming' : '⬆ Outgoing'} peace offer #${esc(offer.id)}
              <span style="color:#9fb0ce;margin-left:6px;">(expires ${esc(offer.expires_at || '?')})</span>
            </span>
            ${isIncoming ? `
              <button style="${S.btn}" data-aw-offer-accept="${esc(offer.id)}">Accept</button>
              <button style="${S.btnDanger}" data-aw-offer-reject="${esc(offer.id)}">Reject</button>
            ` : `<span style="color:#9fb0ce;font-size:11px;">Awaiting response</span>`}
          </div>`;
      }).join('');
      return `
        <div style="${S.section}">
          <div style="${S.sectionTitle}">⚖ Peace Offers</div>
          <div style="display:grid;gap:6px;">${rows}</div>
        </div>`;
    }

    /** Detail view for a single alliance war. */
    function warDetailHtml(warData, myAllianceIds) {
      const sideA = warData.side_a || [];
      const sideB = warData.side_b || [];
      const offers = warData.peace_offers || [];
      const scoreA = Number(warData.war_score_a || 0);
      const scoreB = Number(warData.war_score_b || 0);
      const exhA = Number(warData.exhaustion_a || 0).toFixed(1);
      const exhB = Number(warData.exhaustion_b || 0).toFixed(1);
      const mySide = warData.my_side;

      return `
        <div style="display:grid;gap:10px;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button style="${S.btn}" data-aw-back="1">← Back</button>
            <span style="font-weight:700;font-size:14px;color:#e3efff;">
              Alliance War #${esc(warData.war_id)} — ${esc(warData.name)}
            </span>
            <span style="color:#9fb0ce;font-size:11px;">[${esc(warData.status)}]</span>
            <span style="flex:1;"></span>
            ${warData.status === 'active' ? `<button style="${S.btnWarn}" data-aw-offer-peace-btn="${esc(warData.war_id)}" data-aw-my-side="${esc(mySide)}">⚖ Offer Peace</button>` : ''}
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div style="${S.card}">
              <div style="${S.cardLabel}">⚔ Side A</div>
              <div style="font-size:12px;color:#7eb8ff;margin-top:4px;">${sideTagsHtml(sideA, 'color:#7eb8ff;')}</div>
            </div>
            <div style="${S.card}">
              <div style="${S.cardLabel}">⚔ Side B</div>
              <div style="font-size:12px;color:#ff9980;margin-top:4px;">${sideTagsHtml(sideB, 'color:#ff9980;')}</div>
            </div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div style="${S.card}"><div style="${S.cardLabel}">Score A / B</div><div style="${S.cardValue}">${scoreBarHtml(scoreA, scoreB)}</div></div>
            <div style="${S.card}"><div style="${S.cardLabel}">Exhaustion A / B</div><div style="${S.cardValue};font-size:13px;">${exhA} / ${exhB}</div></div>
            <div style="${S.card}"><div style="${S.cardLabel}">Started</div><div style="${S.cardValue};font-size:11px;">${esc(warData.started_at || '?')}</div></div>
            ${warData.casus_belli ? `<div style="${S.card}"><div style="${S.cardLabel}">Casus Belli</div><div style="font-size:11px;color:#d7e4ff;">${esc(warData.casus_belli)}</div></div>` : ''}
          </div>

          ${peaceOffersHtml(offers, myAllianceIds)}

          <div data-aw-offer-form-host style="display:none;"></div>
        </div>`;
    }

    /** Declare war form. */
    function declareFormHtml() {
      return `
        <div style="background:#1a1a2e;border:1px solid #7a2e2e;border-radius:8px;padding:12px;display:grid;gap:10px;">
          <div style="font-weight:700;color:#ffcdd2;">⚔ Declare Alliance War</div>
          <label style="font-size:11px;color:#9fb0ce;">War Name (optional)
            <input data-aw-war-name type="text" maxlength="120" placeholder="Auto-generated from alliance tags"
              style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:4px;">
          </label>
          <div style="font-size:11px;color:#9fb0ce;">
            Side A — Alliance IDs (comma-separated, e.g. 1,3)
            <input data-aw-side-a type="text" placeholder="e.g. 1, 3"
              style="width:100%;margin-top:3px;background:#111827;color:#7eb8ff;border:1px solid #3a4762;border-radius:4px;padding:4px;">
          </div>
          <div style="font-size:11px;color:#9fb0ce;">
            Side B — Alliance IDs (comma-separated, e.g. 2,4,5)
            <input data-aw-side-b type="text" placeholder="e.g. 2, 4, 5"
              style="width:100%;margin-top:3px;background:#111827;color:#ff9980;border:1px solid #3a4762;border-radius:4px;padding:4px;">
          </div>
          <label style="font-size:11px;color:#9fb0ce;">Casus Belli (optional)
            <input data-aw-casus type="text" maxlength="200" placeholder="e.g. Territorial aggression"
              style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:4px;">
          </label>
          <div style="display:flex;gap:8px;">
            <button data-aw-declare-confirm style="${S.btnDanger}">Declare War</button>
            <button data-aw-declare-cancel style="${S.btn}">Cancel</button>
          </div>
        </div>`;
    }

    /** Parse comma-separated integer list. */
    function parseIntList(str) {
      return (str || '').split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => n > 0);
    }

    class AllianceWarController {
      constructor() {
        this.state = {
          wars: [],
          detailWarId: null,
          detailData: null,
          myAllianceIds: [],
        };
        this.isBusy = false;
      }

      _myAllianceIds() {
        try {
          const meta = window._GQ_meta || {};
          if (Array.isArray(meta.alliance_ids)) {
            return meta.alliance_ids.map(Number);
          }
          if (meta.alliance_id) {
            return [Number(meta.alliance_id)];
          }
        } catch (_) { /* ignore */ }
        return [];
      }

      async loadList() {
        const res = await api.allianceWars();
        this.state.wars = (res && res.success && Array.isArray(res.wars)) ? res.wars : [];
      }

      async loadDetail(warId) {
        const res = await api.allianceWarStatus(warId);
        this.state.detailData = (res && res.success) ? res : null;
      }

      async render() {
        const root = wm && wm.body('alliance_wars');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();
        this.state.myAllianceIds = this._myAllianceIds();

        try {
          if (this.state.detailWarId !== null) {
            await this.loadDetail(this.state.detailWarId);
            root.innerHTML = this.state.detailData
              ? warDetailHtml(this.state.detailData, this.state.myAllianceIds)
              : `<p style="color:#ff9980;padding:10px;">Failed to load war details.</p>`;
          } else {
            await this.loadList();
            root.innerHTML = this._renderListHtml();
          }
          this._attachListeners(root);
        } catch (err) {
          gameLog('warn', 'AllianceWarController render failed', err);
          root.innerHTML = '<p class="text-red">Failed to load alliance war data.</p>';
        }
      }

      _renderListHtml() {
        const wars = this.state.wars;
        const toolbar = `
          <section style="display:flex;gap:8px;flex-wrap:wrap;">
            <button style="${S.btn}" data-aw-refresh="1">Refresh</button>
            <button style="${S.btnDanger}" data-aw-declare="1">⚔ Declare Alliance War</button>
          </section>
          <div data-aw-declare-form-host style="display:none;"></div>`;

        if (!wars.length) {
          return `<div style="display:grid;gap:10px;">${toolbar}${uiKitEmptyStateHTML('No alliance wars', 'No active alliance wars.')}</div>`;
        }

        const rows = wars.map((w) => warRowHtml(w)).join('');
        return `
          <div style="display:grid;gap:10px;">
            ${toolbar}
            <div style="${S.section}">
              <div style="${S.sectionTitle}">Active Alliance Wars</div>
              <table style="${S.table}">
                <thead>
                  <tr>
                    <th style="${S.th}">ID</th>
                    <th style="${S.th}">War Name</th>
                    <th style="${S.th}">Side A</th>
                    <th style="${S.th}">Side B</th>
                    <th style="${S.th}">Score (A / B)</th>
                    <th style="${S.th}">Your Side</th>
                    <th style="${S.thR}"></th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`;
      }

      _attachListeners(root) {
        // Back
        root.querySelector('[data-aw-back="1"]')?.addEventListener('click', () => {
          this.state.detailWarId = null;
          this.state.detailData = null;
          this.render();
        });

        // Refresh
        root.querySelector('[data-aw-refresh="1"]')?.addEventListener('click', () => {
          this.render();
        });

        // Detail view
        root.querySelectorAll('[data-aw-details]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            this.state.detailWarId = Number(btn.dataset.awDetails);
            await this.render();
          });
        });

        // Declare war toggle
        root.querySelector('[data-aw-declare="1"]')?.addEventListener('click', () => {
          const formHost = root.querySelector('[data-aw-declare-form-host]');
          if (!formHost) return;
          if (formHost.style.display !== 'none') {
            formHost.style.display = 'none';
            formHost.innerHTML = '';
            return;
          }
          formHost.innerHTML = declareFormHtml();
          formHost.style.display = '';

          formHost.querySelector('[data-aw-declare-cancel]')?.addEventListener('click', () => {
            formHost.style.display = 'none';
            formHost.innerHTML = '';
          });

          formHost.querySelector('[data-aw-declare-confirm]')?.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;

            const name = String(formHost.querySelector('[data-aw-war-name]')?.value || '').trim();
            const sideA = parseIntList(formHost.querySelector('[data-aw-side-a]')?.value || '');
            const sideB = parseIntList(formHost.querySelector('[data-aw-side-b]')?.value || '');
            const casusBelli = String(formHost.querySelector('[data-aw-casus]')?.value || '').trim();

            if (!sideA.length || !sideB.length) {
              showToast('Both sides must have at least one alliance ID.', 'warning');
              this.isBusy = false;
              return;
            }

            try {
              const res = await api.declareAllianceWar({ name, side_a: sideA, side_b: sideB, casus_belli: casusBelli });
              if (res?.success) {
                showToast('Alliance War declared! War #' + (res.war_id || '?'), 'warning');
                invalidateGetCache([/api\/alliance_wars\.php\?action=/i]);
                formHost.style.display = 'none';
                formHost.innerHTML = '';
                await this.render();
              } else {
                showToast(res?.error || 'Failed to declare alliance war.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'declareAllianceWar failed', err);
              showToast('Network error declaring alliance war.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });

        // Offer peace (in detail view)
        root.querySelector('[data-aw-offer-peace-btn]')?.addEventListener('click', (ev) => {
          const wid = Number(ev.currentTarget.dataset.awOfferPeaceBtn);
          const mySide = ev.currentTarget.dataset.awMySide;
          const offerHost = root.querySelector('[data-aw-offer-form-host]');
          if (!offerHost) return;

          // Build alliance selector from the user's own alliances on their side
          const warData = this.state.detailData;
          const sideKey = mySide === 'a' ? 'side_a' : 'side_b';
          const mySideAlliances = (warData && warData[sideKey]) ? warData[sideKey] : [];
          const myAllianceIds = this.state.myAllianceIds;
          const ownAlliances = mySideAlliances.filter((a) => myAllianceIds.includes(Number(a.alliance_id)));

          if (!ownAlliances.length) {
            showToast('No alliance found on your side to offer peace from.', 'warning');
            return;
          }

          const allianceOptions = ownAlliances
            .map((a) => `<option value="${esc(a.alliance_id)}">[${esc(a.tag)}] ${esc(a.name)}</option>`)
            .join('');

          offerHost.innerHTML = `
            <div style="background:#1a1020;border:1px solid #4a3070;border-radius:8px;padding:12px;display:grid;gap:10px;">
              <div style="${S.sectionTitle}">⚖ Offer Peace (Alliance War #${esc(wid)})</div>
              <label style="font-size:11px;color:#9fb0ce;">Offering Alliance
                <select data-aw-peace-alliance style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:4px;">
                  ${allianceOptions}
                </select>
              </label>
              <p style="color:#9fb0ce;font-size:11px;">A peace offer must be accepted by a leader/diplomat of the opposing side to end the war.</p>
              <div style="display:flex;gap:8px;">
                <button data-aw-peace-confirm="${esc(wid)}" style="${S.btnWarn}">Send Peace Offer</button>
                <button data-aw-peace-cancel style="${S.btn}">Cancel</button>
              </div>
            </div>`;
          offerHost.style.display = '';

          offerHost.querySelector('[data-aw-peace-cancel]')?.addEventListener('click', () => {
            offerHost.style.display = 'none';
            offerHost.innerHTML = '';
          });

          offerHost.querySelector(`[data-aw-peace-confirm]`)?.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const fromAllianceId = Number(offerHost.querySelector('[data-aw-peace-alliance]')?.value || 0);
            try {
              const res = await api.offerAlliancePeace({
                war_id: wid,
                from_alliance_id: fromAllianceId,
                terms: [],
              });
              if (res && res.success) {
                invalidateGetCache([/api\/alliance_wars\.php\?action=/i]);
                showToast('Peace offer sent.', 'success');
                offerHost.style.display = 'none';
                offerHost.innerHTML = '';
                await this.loadDetail(wid);
                await this.render();
              } else {
                showToast(res?.error || 'Failed to send peace offer.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'offerAlliancePeace failed', err);
              showToast('Network error sending peace offer.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
        });

        // Accept peace offer
        root.querySelectorAll('[data-aw-offer-accept]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const offerId = Number(btn.dataset.awOfferAccept);
            const warData = this.state.detailData;
            const mySide = warData?.my_side;
            const sideKey = mySide === 'a' ? 'side_a' : 'side_b';
            const mySideAlliances = (warData && warData[sideKey]) ? warData[sideKey] : [];
            const myAllianceIds = this.state.myAllianceIds;
            const ownAlliance = mySideAlliances.find((a) => myAllianceIds.includes(Number(a.alliance_id)));
            if (!ownAlliance) {
              showToast('No eligible alliance found to accept on your behalf.', 'error');
              this.isBusy = false;
              return;
            }
            try {
              const res = await api.respondAlliancePeaceOffer({
                offer_id: offerId,
                alliance_id: ownAlliance.alliance_id,
                accept: true,
              });
              if (res && res.success) {
                invalidateGetCache([/api\/alliance_wars\.php\?action=/i]);
                showToast('Peace accepted — war ended.', 'success');
                this.state.detailWarId = null;
                this.state.detailData = null;
              } else {
                showToast(res?.error || 'Failed to accept peace offer.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'respondAlliancePeaceOffer(accept) failed', err);
              showToast('Network error accepting peace offer.', 'error');
            } finally {
              this.isBusy = false;
              await this.render();
            }
          });
        });

        // Reject peace offer
        root.querySelectorAll('[data-aw-offer-reject]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const offerId = Number(btn.dataset.awOfferReject);
            const warData = this.state.detailData;
            const mySide = warData?.my_side;
            const sideKey = mySide === 'a' ? 'side_a' : 'side_b';
            const mySideAlliances = (warData && warData[sideKey]) ? warData[sideKey] : [];
            const myAllianceIds = this.state.myAllianceIds;
            const ownAlliance = mySideAlliances.find((a) => myAllianceIds.includes(Number(a.alliance_id)));
            if (!ownAlliance) {
              showToast('No eligible alliance found to reject on your behalf.', 'error');
              this.isBusy = false;
              return;
            }
            try {
              const res = await api.respondAlliancePeaceOffer({
                offer_id: offerId,
                alliance_id: ownAlliance.alliance_id,
                accept: false,
              });
              if (res && res.success) {
                invalidateGetCache([/api\/alliance_wars\.php\?action=/i]);
                showToast('Peace offer rejected.', 'info');
              } else {
                showToast(res?.error || 'Failed to reject peace offer.', 'error');
              }
            } catch (err) {
              gameLog('warn', 'respondAlliancePeaceOffer(reject) failed', err);
              showToast('Network error rejecting peace offer.', 'error');
            } finally {
              this.isBusy = false;
              await this.render();
            }
          });
        });
      }
    }

    return new AllianceWarController();
  }

  const api = { createWarController, createAllianceWarController };

  if (typeof window !== 'undefined') {
    window.GQRuntimeWarController = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
