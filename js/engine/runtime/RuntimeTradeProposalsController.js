'use strict';
(function () {
  function createTradeProposalsController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const esc = opts.esc || ((v) => String(v ?? ''));
    const showToast = opts.showToast || (() => {});
    const getAudioManager = typeof opts.getAudioManager === 'function' ? opts.getAudioManager : (() => null);
    const onLoadOverview = typeof opts.onLoadOverview === 'function' ? opts.onLoadOverview : (async () => {});
    const getResourceInsightConfig = typeof opts.getResourceInsightConfig === 'function' ? opts.getResourceInsightConfig : (() => null);
    const getSuggestedTradeAmount = typeof opts.getSuggestedTradeAmount === 'function' ? opts.getSuggestedTradeAmount : (() => 0);

    class TradeProposalsController {
      constructor() {
        this._tab = 'inbox';
      }

      async render() {
        const root = wm.body('trade');
        if (!root) return;
        root.innerHTML = '<div class="text-muted" style="padding:8px;">Loading...</div>';
        try {
          const data = await api.listTradeProposals();
          const proposals = data.proposals || [];
          const inbox = proposals.filter((p) => !p.is_mine);
          const outbox = proposals.filter((p) => p.is_mine);

          const pendingInbox = inbox.filter((p) => p.status === 'pending').length;
          const pendingTab = pendingInbox > 0
            ? ` <span style="background:#c44;border-radius:8px;padding:1px 6px;font-size:0.78em;">${pendingInbox}</span>`
            : '';

          const tab = this._tab;
          const items = tab === 'inbox' ? inbox : outbox;

          let html = `<div style="padding:8px;">
            <div style="display:flex;gap:6px;margin-bottom:10px;">
              <button class="btn btn-sm${tab === 'inbox' ? '' : ' btn-secondary'}" style="flex:1;" onclick="GQTradeProposalsController._tab='inbox';GQTradeProposalsController.render()">
                Inbox${pendingTab}
              </button>
              <button class="btn btn-sm${tab === 'outbox' ? '' : ' btn-secondary'}" style="flex:1;" onclick="GQTradeProposalsController._tab='outbox';GQTradeProposalsController.render()">
                Outbox
              </button>
              <button class="btn btn-sm btn-secondary" onclick="GQTradeProposalsController.showProposeDialog()" title="New Proposal">+</button>
            </div>`;

          if (items.length === 0) {
            html += '<div class="text-muted" style="padding:8px;text-align:center;">No proposals.</div>';
          } else {
            for (const proposal of items) {
              html += this._renderCard(proposal);
            }
          }
          html += '</div>';
          root.innerHTML = html;
        } catch (error) {
          root.innerHTML = `<div class="text-muted" style="padding:8px;">Error: ${esc(error.message)}</div>`;
        }
      }

      _statusBadge(status) {
        const map = { pending: '#bb8822', accepted: '#3a8', rejected: '#844', cancelled: '#555', expired: '#444' };
        return `<span style="background:${map[status] ?? '#555'};border-radius:4px;padding:1px 6px;font-size:0.8em;">${esc(status)}</span>`;
      }

      _fmtRes(resources) {
        const parts = [];
        if (resources.metal > 0) parts.push(`M ${resources.metal.toLocaleString()}`);
        if (resources.crystal > 0) parts.push(`C ${resources.crystal.toLocaleString()}`);
        if (resources.deuterium > 0) parts.push(`D ${resources.deuterium.toLocaleString()}`);
        return parts.length ? parts.join('  ') : '-';
      }

      _renderCard(proposal) {
        const other = proposal.is_mine ? proposal.target_name : proposal.initiator_name;
        const expires = new Date(proposal.expires_at).toLocaleDateString();
        const actions = [];
        if (proposal.status === 'pending') {
          if (!proposal.is_mine) {
            actions.push(`<button class="btn btn-sm" style="background:#3a8;" onclick="GQTradeProposalsController.doAccept(${proposal.id})">Accept</button>`);
            actions.push(`<button class="btn btn-sm" style="background:#844;" onclick="GQTradeProposalsController.doReject(${proposal.id})">Reject</button>`);
          } else {
            actions.push(`<button class="btn btn-sm btn-secondary" onclick="GQTradeProposalsController.doCancel(${proposal.id})">Cancel</button>`);
          }
        }
        return `<div style="border:1px solid #444;border-radius:6px;padding:8px;margin-bottom:6px;font-size:0.88em;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong>${esc(other)}</strong>
            ${this._statusBadge(proposal.status)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">
            <div><span style="color:#aaa;">Offers:</span><br>${this._fmtRes(proposal.offer)}</div>
            <div><span style="color:#aaa;">Wants:</span><br>${this._fmtRes(proposal.request)}</div>
          </div>
          ${proposal.message ? `<div style="color:#aaa;font-size:0.85em;margin-bottom:4px;">"${esc(proposal.message)}"</div>` : ''}
          <div style="color:#666;font-size:0.8em;">Expires ${esc(expires)}</div>
          ${actions.length ? `<div style="display:flex;gap:4px;margin-top:6px;">${actions.join('')}</div>` : ''}
        </div>`;
      }

      showProposeDialog(targetId = 0, targetName = '', options = {}) {
        const existing = documentRef.getElementById('trade-propose-dialog');
        if (existing) existing.remove();

        const config = getResourceInsightConfig(options.resourceKey);
        const focusMode = String(options.mode || 'request');
        const focusAmount = getSuggestedTradeAmount(config?.key || '', focusMode);
        const offerDefaults = { metal: 0, crystal: 0, deuterium: 0 };
        const requestDefaults = { metal: 0, crystal: 0, deuterium: 0 };
        if (config?.tradeable && ['offer', 'request'].includes(focusMode)) {
          if (focusMode === 'offer') offerDefaults[config.key] = focusAmount;
          else requestDefaults[config.key] = focusAmount;
        }

        const dialog = documentRef.createElement('div');
        dialog.id = 'trade-propose-dialog';
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#1a1a2e;border:1px solid #444;border-radius:8px;padding:16px;min-width:320px;max-width:400px;';
        dialog.innerHTML = `
          <h3 style="margin:0 0 12px;">New Trade Proposal</h3>
          ${config?.tradeable ? `<div style="margin:-4px 0 10px;color:#9fb3d1;font-size:0.82em;">Focus: ${esc(config.icon)} ${esc(config.label)} - Real fleets will be launched on acceptance.</div>` : ''}
          <label class="system-row">Target Player (username)</label>
          <input id="tp-target-name" type="text" placeholder="username" value="${esc(targetName)}" style="width:100%;box-sizing:border-box;" />
          <div style="margin-top:10px;font-weight:bold;">You Offer</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;">
            <div><label style="font-size:0.8em;">Metal</label><input id="tp-om" type="number" min="0" value="${Math.round(offerDefaults.metal)}" style="width:100%;box-sizing:border-box;"/></div>
            <div><label style="font-size:0.8em;">Crystal</label><input id="tp-oc" type="number" min="0" value="${Math.round(offerDefaults.crystal)}" style="width:100%;box-sizing:border-box;"/></div>
            <div><label style="font-size:0.8em;">Deuterium</label><input id="tp-od" type="number" min="0" value="${Math.round(offerDefaults.deuterium)}" style="width:100%;box-sizing:border-box;"/></div>
          </div>
          <div style="margin-top:10px;font-weight:bold;">You Want</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;">
            <div><label style="font-size:0.8em;">Metal</label><input id="tp-rm" type="number" min="0" value="${Math.round(requestDefaults.metal)}" style="width:100%;box-sizing:border-box;"/></div>
            <div><label style="font-size:0.8em;">Crystal</label><input id="tp-rc" type="number" min="0" value="${Math.round(requestDefaults.crystal)}" style="width:100%;box-sizing:border-box;"/></div>
            <div><label style="font-size:0.8em;">Deuterium</label><input id="tp-rd" type="number" min="0" value="${Math.round(requestDefaults.deuterium)}" style="width:100%;box-sizing:border-box;"/></div>
          </div>
          <label class="system-row" style="margin-top:10px;">Message (optional)</label>
          <input id="tp-msg" type="text" maxlength="500" placeholder="..." style="width:100%;box-sizing:border-box;" />
          <label class="system-row" style="margin-top:10px;">Expires in (days)</label>
          <select id="tp-days" style="width:100%;box-sizing:border-box;">
            <option value="1">1 day</option>
            <option value="2" selected>2 days</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
          </select>
          <div id="tp-err" style="color:#d66;font-size:0.85em;margin-top:6px;min-height:1em;"></div>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn" style="flex:1;" onclick="GQTradeProposalsController.doPropose()">Send</button>
            <button class="btn btn-secondary" onclick="document.getElementById('trade-propose-dialog').remove()">Cancel</button>
          </div>`;
        documentRef.body.appendChild(dialog);
      }

      async doPropose() {
        const setErr = (value) => {
          const el = documentRef.getElementById('tp-err');
          if (el) el.textContent = value;
        };
        const targetName = (documentRef.getElementById('tp-target-name')?.value ?? '').trim();
        if (!targetName) return setErr('Please enter a target player.');

        let targetId = 0;
        try {
          const lb = await api.get('api/game.php?action=leaderboard');
          const match = (lb.leaderboard || lb.players || []).find((user) =>
            (user.username || user.name || '').toLowerCase() === targetName.toLowerCase()
          );
          if (!match) return setErr('Player not found.');
          targetId = match.id || match.user_id;
        } catch (error) {
          return setErr('Could not resolve player: ' + error.message);
        }

        const data = {
          target_id: targetId,
          offer_metal: parseFloat(documentRef.getElementById('tp-om')?.value || 0),
          offer_crystal: parseFloat(documentRef.getElementById('tp-oc')?.value || 0),
          offer_deuterium: parseFloat(documentRef.getElementById('tp-od')?.value || 0),
          request_metal: parseFloat(documentRef.getElementById('tp-rm')?.value || 0),
          request_crystal: parseFloat(documentRef.getElementById('tp-rc')?.value || 0),
          request_deuterium: parseFloat(documentRef.getElementById('tp-rd')?.value || 0),
          message: documentRef.getElementById('tp-msg')?.value || '',
          expire_days: parseInt(documentRef.getElementById('tp-days')?.value || 2, 10),
        };

        try {
          await api.proposeTrade(data);
          documentRef.getElementById('trade-propose-dialog')?.remove();
          this.render();
        } catch (error) {
          setErr(error.message || 'Failed to send proposal.');
        }
      }

      async doAccept(id) {
        try {
          const response = await api.acceptTrade(id);
          const deliveries = Array.isArray(response?.deliveries) ? response.deliveries : [];
          if (response?.success) {
            const headline = deliveries.length
              ? deliveries.map((entry) => `${entry.resource_label || 'Transport'} ETA ${new Date(entry.arrival_time).toLocaleTimeString()}`).join(' | ')
              : 'Transport order started.';
            showToast(headline, 'success');
            const audioManager = getAudioManager();
            if (audioManager) audioManager.playUiConfirm();
            await onLoadOverview();
            wm.refresh('fleet');
          }
          this.render();
        } catch (error) {
          alert('Accept failed: ' + error.message);
        }
      }

      async doReject(id) {
        if (!confirm('Reject this trade proposal?')) return;
        try {
          await api.rejectTrade(id);
          this.render();
        } catch (error) {
          alert('Reject failed: ' + error.message);
        }
      }

      async doCancel(id) {
        if (!confirm('Cancel this proposal?')) return;
        try {
          await api.cancelTrade(id);
          this.render();
        } catch (error) {
          alert('Cancel failed: ' + error.message);
        }
      }
    }

    return new TradeProposalsController();
  }

  const api = { createTradeProposalsController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeTradeProposalsController = api;
  }
})();
