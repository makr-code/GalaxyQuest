'use strict';
(function () {
  function createFactionsController(opts = {}) {
    const WM = opts.wm;
    const API = opts.api;
    const showToast = opts.showToast || (() => {});
    const esc = opts.esc || ((value) => String(value ?? ''));
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const loadOverview = typeof opts.onLoadOverview === 'function' ? opts.onLoadOverview : (async () => {});
    const getCurrentColony = typeof opts.getCurrentColony === 'function' ? opts.getCurrentColony : (() => null);
    const windowRef = opts.windowRef || window;
    const diplomacyPanel = opts.diplomacyPanel || null;
    const contractNegotiationModal = opts.contractNegotiationModal || null;

    class FactionsController {
      constructor() {
        this.conversations = new Map();
        this.npcSessions = new Map();
        this.lastFactions = [];
        /** @type {Map<number, object>} active NpcAvatarRenderer instances keyed by fid */
        this._npcRenderers = new Map();
      }

      standingClass(value) {
        if (value >= 50) return 'chip-allied';
        if (value >= 10) return 'chip-friendly';
        if (value >= -10) return 'chip-neutral';
        if (value >= -50) return 'chip-hostile';
        return 'chip-war';
      }

      standingLabel(value) {
        if (value >= 50) return 'Verbündet';
        if (value >= 10) return 'Freundlich';
        if (value >= -10) return 'Neutral';
        if (value >= -50) return 'Feindselig';
        return 'Krieg';
      }

      standingBarWidth(value) {
        return Math.round((Math.max(-100, Math.min(100, Number(value || 0))) + 100) / 2);
      }

      standingBarColor(value) {
        const n = Number(value || 0);
        if (n >= 50) return '#2ecc71';
        if (n >= 10) return '#27ae60';
        if (n >= -10) return '#aaa';
        if (n >= -50) return '#e67e22';
        return '#e74c3c';
      }

      diploStanceClass(trust, threat) {
        const t = Math.max(0, Math.min(100, Number(trust  || 0)));
        const h = Math.max(0, Math.min(100, Number(threat || 0)));
        if (t >= 75 && h < 20) return 'stance-ally';
        if (t >= 40 && h < 40) return 'stance-friendly';
        if (h >= 75)           return 'stance-hostile';
        if (h >= 50)           return 'stance-tense';
        return 'stance-neutral';
      }

      diploStanceLabel(trust, threat) {
        const t = Math.max(0, Math.min(100, Number(trust  || 0)));
        const h = Math.max(0, Math.min(100, Number(threat || 0)));
        if (t >= 75 && h < 20) return 'Ally';
        if (t >= 40 && h < 40) return 'Friendly';
        if (h >= 75)           return 'Hostile';
        if (h >= 50)           return 'Tense';
        return 'Neutral';
      }

      formatEffect(key, value) {
        const n = Number(value || 0);
        const sign = n > 0 ? '+' : '';
        const percentKeys = ['resource_output_mult', 'food_output_mult', 'pop_growth_mult', 'research_speed_mult', 'fleet_readiness_mult'];
        if (percentKeys.includes(String(key))) {
          return `${sign}${Math.round(n * 1000) / 10}%`;
        }
        return `${sign}${Math.round(n * 100) / 100}`;
      }

      effectLabel(key) {
        return ({
          resource_output_mult: 'Resource Output',
          food_output_mult: 'Food Output',
          pop_growth_mult: 'Population Growth',
          happiness_flat: 'Happiness',
          public_services_flat: 'Public Services',
          research_speed_mult: 'Research Speed',
          fleet_readiness_mult: 'Fleet Readiness',
        }[String(key)] || String(key));
      }

      buildMainView({ factions, politicsProfile, dynamicEffects, presets, activeUnrest, activeEvent }) {
        const effectRows = Object.entries(dynamicEffects || {})
          .filter(([key, value]) => !['faction_pressure_score', 'unrest_active', 'unrest_severity'].includes(String(key))
            && Number(value || 0) !== 0)
          .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)));

        const eventBanner = activeEvent
          ? `<div style="background:rgba(255,180,0,0.13);border:1px solid rgba(255,180,0,0.45);border-radius:6px;padding:0.55rem 0.8rem;margin-bottom:0.75rem;display:flex;gap:0.6rem;align-items:center">
              <span style="font-size:1.4rem">${esc(activeEvent.icon)}</span>
              <div>
                <strong>${esc(activeEvent.label)}</strong> galactic event active
                <div style="font-size:0.76rem;color:var(--text-secondary)">Ends in ~${esc(String(activeEvent.ends_in_min))} min | Faction stats temporarily modified</div>
              </div>
            </div>`
          : '';

        return `
          ${eventBanner}
          <div class="system-card" style="margin-bottom:0.85rem">
            <h4 style="margin:0 0 0.35rem">Empire Politics</h4>
            ${politicsProfile ? `
              <div class="system-row">Species: <strong>${esc(politicsProfile.primary_species_key || 'n/a')}</strong></div>
              <div class="system-row">Government: <strong>${esc(politicsProfile.government_key || 'n/a')}</strong></div>
              <div class="system-row">Civics: ${(politicsProfile.civics || []).map((c) => esc(c.civic_key)).join(', ') || '<span class="text-muted">none</span>'}</div>
            ` : '<div class="system-row text-muted">Politics profile unavailable.</div>'}
            <div class="system-row" style="display:flex;gap:0.45rem;align-items:center;flex-wrap:wrap">
              <select id="politics-preset-select" class="input-sm" style="min-width:220px">
                <option value="">Preset waehlen...</option>
                ${presets.map((p) => `<option value="${esc(p.preset_key)}">${esc(p.name)}</option>`).join('')}
              </select>
              <button id="politics-apply-preset-btn" class="btn btn-secondary btn-sm" type="button">Preset anwenden</button>
              <button id="politics-refresh-btn" class="btn btn-secondary btn-sm" type="button">Aktualisieren</button>
            </div>
            <div class="system-row" style="font-size:0.78rem;color:var(--text-muted)">
              Faction Pressure: <strong>${esc(String(dynamicEffects?.faction_pressure_score ?? 'n/a'))}</strong>
              ${Number(dynamicEffects?.unrest_active || 0) ? ` | Unrest aktiv (Severity ${esc(String(Math.round(Number(dynamicEffects?.unrest_severity || 0) * 100) / 100))})` : ''}
            </div>
            <div style="margin-top:0.55rem">
              <table class="data-table" style="width:100%">
                <thead><tr><th>Effect</th><th>Value</th></tr></thead>
                <tbody>
                  ${effectRows.length
                    ? effectRows.map(([key, value]) => `<tr><td>${esc(this.effectLabel(key))}</td><td>${esc(this.formatEffect(key, value))}</td></tr>`).join('')
                    : '<tr><td colspan="2" class="text-muted">Keine aktiven Modifikatoren.</td></tr>'}
                </tbody>
              </table>
            </div>
            ${activeUnrest ? `
              <div class="system-row" style="margin-top:0.55rem">
                <strong>Unrest Approach:</strong>
                Stage ${esc(String(activeUnrest.stage || '?'))} | Progress ${esc(String(activeUnrest.progress || '?'))}
              </div>
              <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
                <button class="btn btn-warning btn-sm unrest-approach-btn" data-approach="conciliation" data-sid="${esc(String(activeUnrest.id))}">Conciliation</button>
                <button class="btn btn-warning btn-sm unrest-approach-btn" data-approach="reforms" data-sid="${esc(String(activeUnrest.id))}">Reforms</button>
                <button class="btn btn-warning btn-sm unrest-approach-btn" data-approach="repression" data-sid="${esc(String(activeUnrest.id))}">Repression</button>
                <button class="btn btn-secondary btn-sm" id="unrest-tick-btn" data-sid="${esc(String(activeUnrest.id))}">Situation Tick</button>
              </div>
            ` : '<div class="system-row text-muted" style="margin-top:0.55rem">Kein aktiver Faction-Unrest.</div>'}
          </div>

          <div class="diplomacy-cards-grid">
            ${factions.map((faction) => `
              <div class="diplomacy-card faction-card" data-fid="${faction.id}">
                <div class="diplomacy-card-image" style="background:${esc(faction.color)}22;border-color:${esc(faction.color)}44">
                  <span class="diplomacy-card-icon" style="color:${esc(faction.color)}">${esc(faction.icon)}</span>
                </div>
                <div class="diplomacy-card-body">
                  <div class="diplomacy-card-name" style="color:${esc(faction.color)}">${esc(faction.name)}</div>
                  <div class="diplomacy-standing-bar">
                    <div class="diplomacy-standing-labels">
                      <span>Feindselig</span><span>Freundlich</span>
                    </div>
                    <div class="diplomacy-standing-track">
                      <div class="diplomacy-standing-fill faction-standing-fill" data-fid="${faction.id}"
                        style="width:${this.standingBarWidth(faction.standing)}%;background:${this.standingBarColor(faction.standing)}"></div>
                    </div>
                    <div class="diplomacy-standing-value faction-standing-chip ${this.standingClass(faction.standing)}" data-fid="${faction.id}">
                      ${this.standingLabel(faction.standing)} (${faction.standing > 0 ? '+' : ''}${faction.standing})
                    </div>
                  </div>
                  <div class="diplomacy-trust-threat-row faction-trust-threat-row" data-fid="${faction.id}"
                       style="font-size:0.78rem;margin-top:0.25rem;display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap">
                    <span class="trust-badge" title="Trust (0–100)">🤝 ${Math.round(Number(faction.trust_level ?? 0))}</span>
                    <span class="threat-badge" title="Threat (0–100)">⚠️ ${Math.round(Number(faction.threat_level ?? 0))}</span>
                    <span class="diplo-stance-chip ${this.diploStanceClass(faction.trust_level, faction.threat_level)}">${this.diploStanceLabel(faction.trust_level, faction.threat_level)}</span>
                  </div>
                  <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" data-fid="${faction.id}" data-act="contact">Kontakt</button>
                    <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="trade">Handel</button>
                    <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="quests">Aufträge</button>
                  </div>
                <p style="font-size:0.8rem;color:var(--text-secondary);margin:0.3rem 0 0.6rem">
                  ${esc(faction.description)}
                </p>
                <div style="font-size:0.75rem;color:var(--text-muted)">
                  Aggression: ${faction.aggression}/100 &nbsp;
                  Trade: ${faction.trade_willingness}/100 &nbsp;
                  Quests done: ${faction.quests_done}
                </div>
                <div class="faction-last-event" style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem">${faction.last_event ? esc(faction.last_event) : ''}</div>
                <div class="faction-actions" style="margin-top:0.6rem;display:flex;gap:0.4rem;flex-wrap:wrap">
                  <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="trade">Trade</button>
                  <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="quests">Quests</button>
                  <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="contact">Contact</button>
                  <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="treaties">⚖️ Treaties</button>
                </div>
              </div>`).join('')}
          </div>

          <div id="faction-detail" style="margin-top:1rem"></div>`;
      }

      bindMainActions(root) {
        root.querySelector('#politics-refresh-btn')?.addEventListener('click', async () => {
          await loadOverview();
          WM.refresh('factions');
        });

        root.querySelector('#politics-apply-preset-btn')?.addEventListener('click', async () => {
          const sel = root.querySelector('#politics-preset-select');
          const key = String(sel?.value || '').trim();
          if (!key) {
            showToast('Bitte ein Preset auswaehlen.', 'warning');
            return;
          }
          const result = await API.applyPoliticsPreset(key);
          if (!result?.success) {
            showToast(result?.error || 'Preset konnte nicht angewendet werden.', 'error');
            return;
          }
          showToast('Politik-Preset angewendet.', 'success');
          await loadOverview();
          WM.refresh('factions');
        });

        root.querySelectorAll('.unrest-approach-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const sid = Number(btn.getAttribute('data-sid') || 0);
            const approach = String(btn.getAttribute('data-approach') || '').trim();
            if (!sid || !approach) return;
            const result = await API.setSituationApproach(sid, approach);
            if (!result?.success) {
              showToast(result?.error || 'Approach konnte nicht gesetzt werden.', 'error');
              return;
            }
            showToast(`Unrest-Approach auf ${approach} gesetzt.`, 'success');
            await API.tickSituations(sid).catch(() => null);
            await loadOverview();
            WM.refresh('factions');
          });
        });

        root.querySelector('#unrest-tick-btn')?.addEventListener('click', async () => {
          const sid = Number(root.querySelector('#unrest-tick-btn')?.getAttribute('data-sid') || 0);
          const result = await API.tickSituations(sid || undefined);
          if (!result?.success) {
            showToast(result?.error || 'Situation tick fehlgeschlagen.', 'error');
            return;
          }
          showToast('Situation getickt.', 'info');
          await loadOverview();
          WM.refresh('factions');
        });

        root.querySelectorAll('[data-act]').forEach((btn) => {
          btn.addEventListener('click', () => this.renderDetail(root, parseInt(btn.dataset.fid, 10), btn.dataset.act));
        });
      }

      getFactionById(fid) {
        return (this.lastFactions || []).find((faction) => Number(faction?.id || 0) === Number(fid || 0)) || null;
      }

      getConversationState(fid) {
        return this.conversations.get(Number(fid || 0)) || null;
      }

      setConversationState(fid, state) {
        this.conversations.set(Number(fid || 0), Object.assign({
          history: [],
          suggestedReplies: [],
          model: '',
          fallback: false,
          standingChange: null,
          questHook: null,
          loading: false,
        }, state || {}));
      }

      updateFactionSnapshot(fid, patch = {}) {
        const faction = this.getFactionById(fid);
        if (!faction || !patch || typeof patch !== 'object') return;
        Object.assign(faction, patch);
      }

      syncFactionCard(root, fid) {
        const card = root?.querySelector(`.faction-card[data-fid="${Number(fid || 0)}"]`);
        const faction = this.getFactionById(fid);
        if (!card || !faction) return;

        const chip = card.querySelector('.faction-standing-chip');
        if (chip) {
          chip.className = `diplomacy-standing-value faction-standing-chip ${this.standingClass(faction.standing)}`;
          chip.textContent = `${this.standingLabel(faction.standing)} (${faction.standing > 0 ? '+' : ''}${faction.standing})`;
        }

        const fill = card.querySelector('.faction-standing-fill');
        if (fill) {
          fill.style.width = `${this.standingBarWidth(faction.standing)}%`;
          fill.style.background = this.standingBarColor(faction.standing);
        }

        const lastEvent = card.querySelector('.faction-last-event');
        if (lastEvent) {
          lastEvent.textContent = String(faction.last_event || '');
        }

        // Sync trust/threat row
        const ttRow = card.querySelector('.faction-trust-threat-row');
        if (ttRow) {
          const trustBadge  = ttRow.querySelector('.trust-badge');
          const threatBadge = ttRow.querySelector('.threat-badge');
          const stanceChip  = ttRow.querySelector('.diplo-stance-chip');
          if (trustBadge)  trustBadge.textContent  = `🤝 ${Math.round(Number(faction.trust_level ?? 0))}`;
          if (threatBadge) threatBadge.textContent  = `⚠️ ${Math.round(Number(faction.threat_level ?? 0))}`;
          if (stanceChip) {
            stanceChip.className  = `diplo-stance-chip ${this.diploStanceClass(faction.trust_level, faction.threat_level)}`;
            stanceChip.textContent = this.diploStanceLabel(faction.trust_level, faction.threat_level);
          }
        }
      }

      // ── NPC Diplomacy Chat ────────────────────────────────────────────────

      getNpcSession(fid) {
        return this.npcSessions.get(Number(fid || 0)) || null;
      }

      setNpcSession(fid, session) {
        if (!session) { this.npcSessions.delete(Number(fid || 0)); return; }
        this.npcSessions.set(Number(fid || 0), Object.assign({
          sessionId: null, npcName: '', factionCode: '',
          history: [], suggestedReplies: [], model: '', loading: false,
        }, session));
      }

      buildNpcChatPanel(fid) {
        const faction = this.getFactionById(fid);
        const session = this.getNpcSession(fid) || { history: [], suggestedReplies: [], npcName: '', model: '', loading: true };
        const factionName = faction?.name || `Faction ${fid}`;
        const factionColor = faction?.color || '#88aaff';
        const factionIcon = faction?.icon || '';
        const npcName = session.npcName || factionName;

        const transcriptHtml = session.history.length
          ? session.history.map((entry) => {
              const isNpc = entry.role === 'assistant';
              const align = isNpc ? 'flex-start' : 'flex-end';
              const bg = isNpc ? 'rgba(80,120,255,0.16)' : 'rgba(255,255,255,0.08)';
              const borderColor = isNpc ? factionColor : 'rgba(255,255,255,0.18)';
              const label = isNpc ? `${esc(factionIcon)} ${esc(npcName)}` : 'Du';
              return `
                <div style="display:flex;justify-content:${align};margin-bottom:0.55rem;">
                  <div style="max-width:85%;border:1px solid ${esc(borderColor)};background:${bg};border-radius:10px;padding:0.55rem 0.7rem;">
                    <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.22rem">${label}</div>
                    <div style="line-height:1.4">${esc(entry.content)}</div>
                  </div>
                </div>`;
            }).join('')
          : `<div class="text-muted">Verbindung wird aufgebaut${session.loading ? '\u2026' : '.'}</div>`;

        const suggestionsHtml = (session.suggestedReplies || []).map((reply, index) =>
          `<button class="btn btn-secondary btn-sm npc-chat-suggestion" data-fid="${fid}" data-index="${index}" style="text-align:left;justify-content:flex-start">${esc(reply)}</button>`
        ).join('');

        return `
          <div class="system-card npc-chat-panel">
            <div style="display:grid;grid-template-columns:160px 1fr;gap:1rem;align-items:start">
              <div id="npc-avatar-container" data-fid="${fid}" style="width:160px;height:220px;border-radius:10px;overflow:hidden;flex-shrink:0;background:rgba(0,0,0,0.3);"></div>
              <div style="min-width:0">
                <div style="display:flex;justify-content:space-between;gap:0.8rem;align-items:center;margin-bottom:0.65rem">
                  <div>
                    <h4 style="margin:0;color:${esc(factionColor)}">${esc(factionIcon)} ${esc(npcName)}</h4>
                    <div style="font-size:0.74rem;color:var(--text-muted)">${esc(factionName)}${session.model ? ` \u00b7 ${esc(session.model)}` : ''}</div>
                  </div>
                  <button class="btn btn-secondary btn-sm" id="npc-chat-restart" data-fid="${fid}" type="button">Neu starten</button>
                </div>
                <div id="npc-chat-transcript" style="background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:0.75rem;max-height:260px;overflow-y:auto;margin-bottom:0.7rem">
                  ${transcriptHtml}
                </div>
                <div style="display:grid;gap:0.4rem;margin-bottom:0.65rem">
                  ${suggestionsHtml || (session.loading ? '' : '<div class="text-muted" style="font-size:0.8rem">Keine Antwortvorschl\u00e4ge.</div>')}
                </div>
                <div style="display:flex;gap:0.45rem;align-items:center">
                  <input id="npc-chat-input" type="text" maxlength="280" placeholder="Nachricht eingeben\u2026" style="flex:1;padding:0.55rem 0.7rem;border:1px solid #666;background:#0a0a0a;color:#fff;border-radius:8px;" ${session.loading ? 'disabled' : ''} />
                  <button class="btn btn-primary btn-sm" id="npc-chat-send" data-fid="${fid}" type="button" ${session.loading ? 'disabled' : ''}>Senden</button>
                </div>
              </div>
            </div>
          </div>`;
      }

      /**
       * Mount (or reattach) the NpcAvatarRenderer into #npc-avatar-container.
       * Creates a new renderer on first call; reattaches on panel rebuilds.
       */
      _mountNpcAvatar(detail, fid) {
        const container = detail.querySelector('#npc-avatar-container');
        if (!container) return;

        const faction = this.getFactionById(fid);
        const session = this.getNpcSession(fid);
        const factionCode  = String(faction?.code  || '');
        const factionColor = String(faction?.color || '#88aaff');
        const npcName      = String(session?.npcName || faction?.diplomat_npc || '');
        const npcGender    = String(faction?.diplomat_npc_gender || '');

        // If a renderer already exists for this fid, reattach instead of recreating
        if (this._npcRenderers.has(Number(fid))) {
          const existing = this._npcRenderers.get(Number(fid));
          existing.reattach(container);
          return;
        }

        // Lazy-load NpcAvatarRenderer class from window or require
        const RendererClass = (windowRef.GQNpcAvatarRenderer || {}).NpcAvatarRenderer;
        if (!RendererClass) return; // not yet loaded – canvas will appear on next open

        const renderer = new RendererClass({
          factionCode,
          factionColor,
          npcName,
          npcGender,
          windowRef,
        });
        this._npcRenderers.set(Number(fid), renderer);
        renderer.mount(container);
      }

      /** Destroy the avatar renderer for a faction (e.g. on chat restart). */
      _destroyNpcAvatar(fid) {
        const renderer = this._npcRenderers.get(Number(fid));
        if (renderer) {
          renderer.destroy();
          this._npcRenderers.delete(Number(fid));
        }
      }

      bindNpcChatActions(root, fid) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;

        detail.querySelectorAll('.npc-chat-suggestion').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const session = this.getNpcSession(fid);
            const index = Number(btn.getAttribute('data-index') ?? -1);
            const reply = session?.suggestedReplies?.[index] || '';
            if (!reply) return;
            await this.sendNpcMessage(root, fid, reply);
          });
        });

        detail.querySelector('#npc-chat-send')?.addEventListener('click', async () => {
          const input = detail.querySelector('#npc-chat-input');
          const value = String(input?.value || '').trim();
          if (!value) return;
          if (input) input.value = '';
          await this.sendNpcMessage(root, fid, value);
        });

        detail.querySelector('#npc-chat-input')?.addEventListener('keydown', async (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const input = event.currentTarget;
          const value = String(input?.value || '').trim();
          if (!value) return;
          input.value = '';
          await this.sendNpcMessage(root, fid, value);
        });

        detail.querySelector('#npc-chat-restart')?.addEventListener('click', async () => {
          this._destroyNpcAvatar(fid);
          this.npcSessions.delete(Number(fid || 0));
          await this.openNpcChat(root, fid);
        });
      }

      _scrollNpcTranscript(detail) {
        const t = detail?.querySelector('#npc-chat-transcript');
        if (t) t.scrollTop = t.scrollHeight;
      }

      async sendNpcMessage(root, fid, playerMessage) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;
        const faction = this.getFactionById(fid);
        const factionCode = String(faction?.code || '');
        const current = this.getNpcSession(fid);
        if (!current) return;

        const optimisticHistory = [...current.history, { role: 'user', content: playerMessage }];
        this.setNpcSession(fid, Object.assign({}, current, { history: optimisticHistory, suggestedReplies: [], loading: true }));
        detail.innerHTML = this.buildNpcChatPanel(fid);
        this._mountNpcAvatar(detail, fid);
        this._scrollNpcTranscript(detail);
        this._npcRenderers.get(Number(fid))?.setTalking(true);

        try {
          const response = await API.chatNpc({
            faction_code: factionCode,
            npc_name: current.npcName,
            player_message: playerMessage,
            session_id: current.sessionId || undefined,
          });
          this._npcRenderers.get(Number(fid))?.setTalking(false);
          if (!response?.success) throw new Error(response?.error || 'NPC chat request failed.');

          const newHistory = [...optimisticHistory, { role: 'assistant', content: String(response.reply || '') }];
          this.setNpcSession(fid, {
            sessionId: Number(response.session_id || current.sessionId || 0) || null,
            npcName: String(response.npc_name || current.npcName),
            factionCode,
            history: newHistory,
            suggestedReplies: Array.isArray(response.suggested_replies) ? response.suggested_replies : [],
            model: String(response.model || current.model || ''),
            loading: false,
          });
          detail.innerHTML = this.buildNpcChatPanel(fid);
          this.bindNpcChatActions(root, fid);
          this._mountNpcAvatar(detail, fid);
          this._scrollNpcTranscript(detail);

          const npcReply = String(response.reply || '').trim();
          if (npcReply && windowRef.GQTTS && typeof windowRef.GQTTS.playOrSpeak === 'function') {
            windowRef.GQTTS.playOrSpeak(null, npcReply, {}).catch(() => {});
          }
        } catch (err) {
          this._npcRenderers.get(Number(fid))?.setTalking(false);
          this.setNpcSession(fid, Object.assign({}, current, { loading: false }));
          detail.innerHTML = this.buildNpcChatPanel(fid);
          this.bindNpcChatActions(root, fid);
          this._mountNpcAvatar(detail, fid);
          showToast(String(err?.message || 'NPC chat fehlgeschlagen.'), 'error');
        }
      }

      async openNpcChat(root, fid) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;
        const faction = this.getFactionById(fid);
        if (!faction) { detail.innerHTML = '<p class="error">Fraktion nicht gefunden.</p>'; return; }

        const npcName = String(faction.diplomat_npc || '');
        const factionCode = String(faction.code || '');
        if (!npcName || !factionCode) {
          detail.innerHTML = '<p class="text-muted">Kein NPC-Kontakt f\u00fcr diese Fraktion verf\u00fcgbar.</p>';
          return;
        }

        this.setNpcSession(fid, { sessionId: null, npcName, factionCode, history: [], suggestedReplies: [], model: '', loading: true });
        detail.innerHTML = this.buildNpcChatPanel(fid);

        try {
          const response = await API.chatNpc({ faction_code: factionCode, npc_name: npcName, player_message: 'Guten Tag.' });
          if (!response?.success) throw new Error(response?.error || 'NPC chat konnte nicht gestartet werden.');

          this.setNpcSession(fid, {
            sessionId: Number(response.session_id || 0) || null,
            npcName: String(response.npc_name || npcName),
            factionCode,
            history: [
              { role: 'user', content: 'Guten Tag.' },
              { role: 'assistant', content: String(response.reply || '') },
            ],
            suggestedReplies: Array.isArray(response.suggested_replies) ? response.suggested_replies : [],
            model: String(response.model || ''),
            loading: false,
          });
          detail.innerHTML = this.buildNpcChatPanel(fid);
          this.bindNpcChatActions(root, fid);
          this._mountNpcAvatar(detail, fid);
          this._scrollNpcTranscript(detail);

          const npcReply = String(response.reply || '').trim();
          if (npcReply && windowRef.GQTTS && typeof windowRef.GQTTS.playOrSpeak === 'function') {
            windowRef.GQTTS.playOrSpeak(null, npcReply, {}).catch(() => {});
          }
        } catch (err) {
          this.setNpcSession(fid, null);
          detail.innerHTML = `<p class="error">${esc(String(err?.message || 'NPC Chat konnte nicht ge\u00f6ffnet werden.'))}</p>`;
          showToast('NPC Diplomatie-Chat fehlgeschlagen.', 'error');
        }
      }
  async renderDetail(root, fid, mode) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;
        detail.innerHTML = '<p class="text-muted">Loading...</p>';

        if (mode === 'contact') {
          const existing = this.getNpcSession(fid);
          if (existing) {
            detail.innerHTML = this.buildNpcChatPanel(fid);
            this.bindNpcChatActions(root, fid);
            this._mountNpcAvatar(detail, fid);
          } else {
            await this.openNpcChat(root, fid);
          }
          return;
        }

        if (mode === 'treaties') {
          const faction = this.getFactionById(fid);
          if (!faction) {
            detail.innerHTML = '<p class="error">Faction not found.</p>';
            return;
          }
          if (diplomacyPanel) {
            await diplomacyPanel.render(detail, faction);
          } else {
            detail.innerHTML = '<p class="text-muted">Treaty panel unavailable.</p>';
          }
          return;
        }

        if (mode === 'trade') {
          const data = await API.tradeOffers(fid);
          if (!data?.success || !Array.isArray(data.offers) || !data.offers.length) {
            detail.innerHTML = '<p class="text-muted">No active trade offers from this faction.</p>';
            return;
          }
          detail.innerHTML = `
            <h4>Trade Offers (Standing: ${data.standing})</h4>
            <table class="data-table" style="width:100%">
              <thead><tr><th>They Offer</th><th>They Want</th><th>Expires</th><th>Claims</th><th></th></tr></thead>
              <tbody>${data.offers.map((offer) => `
                <tr>
                  <td>${offer.offer_amount.toLocaleString()} ${offer.offer_resource}</td>
                  <td>${offer.request_amount.toLocaleString()} ${offer.request_resource}</td>
                  <td style="font-size:0.75rem">${new Date(offer.valid_until).toLocaleString()}</td>
                  <td>${offer.claims_count}/${offer.max_claims}</td>
                  <td><button class="btn btn-primary btn-sm trade-accept-btn" data-oid="${offer.id}">Accept</button></td>
                </tr>`).join('')}
              </tbody>
            </table>`;

          detail.querySelectorAll('.trade-accept-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const currentColony = getCurrentColony();
              if (!currentColony) {
                showToast('Select a colony first.', 'error');
                return;
              }
              const response = await API.acceptTrade(parseInt(btn.dataset.oid, 10), currentColony.id);
              if (response.success) {
                showToast(response.message, 'success');
                await loadOverview();
                await this.renderDetail(root, fid, 'trade');
              } else {
                showToast(response.error || 'Trade failed', 'error');
              }
            });
          });
          return;
        }

        const data = await API.factionQuests(fid);
        if (!data.success) {
          detail.innerHTML = '<p class="error">Failed to load quests.</p>';
          return;
        }
        const quests = data.quests || [];
        detail.innerHTML = `
          <h4>Faction Quests (Standing: ${data.standing})</h4>
          <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
            ${quests.map((quest) => `
              <div class="quest-card" style="min-width:240px;max-width:320px">
                <div style="font-weight:bold">${esc(quest.title)}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);margin:0.2rem 0">${esc(quest.description)}</div>
                <div style="font-size:0.72rem">
                  Difficulty: <strong>${quest.difficulty}</strong> &nbsp;
                  Type: ${quest.quest_type}
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem">
                  Reward: ${quest.reward_metal ? quest.reward_metal + ' ' : ''} ${quest.reward_crystal ? quest.reward_crystal + ' ' : ''}
                          ${quest.reward_rank_points ? quest.reward_rank_points : ''} ${quest.reward_standing ? '+' + quest.reward_standing : ''}
                </div>
                ${quest.taken
                  ? '<span class="status-chip chip-neutral">Active / Done</span>'
                  : `<button class="btn btn-primary btn-sm start-fq-btn" data-fqid="${quest.id}" style="margin-top:0.4rem">Start Quest</button>`}
              </div>`).join('')}
            ${!quests.length ? '<p class="text-muted">No quests available at your current standing.</p>' : ''}
          </div>`;

        detail.querySelectorAll('.start-fq-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const response = await API.startFactionQuest(parseInt(btn.dataset.fqid, 10));
            if (response.success) {
              showToast(response.message, 'success');
              await this.renderDetail(root, fid, 'quests');
            } else {
              showToast(response.error || 'Failed', 'error');
            }
          });
        });
      }

      async render() {
        const root = WM.body('factions');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();
        try {
          const [factionsData, politicsData, presetsData, unrestData] = await Promise.all([
            API.factions(),
            API.politicsStatus().catch(() => ({ success: false })),
            API.politicsPresets().catch(() => ({ success: false })),
            API.situations('active', 100).catch(() => ({ success: false })),
          ]);
          if (!factionsData.success) {
            root.innerHTML = '<p class="error">Failed.</p>';
            return;
          }
          const factions = factionsData.factions || [];
          this.lastFactions = factions;
          const activeEvent = factionsData.active_event || null;
          const politicsProfile = politicsData?.profile || null;
          const dynamicEffects = politicsData?.dynamic_effects || windowRef._GQ_politics?.effects || {};
          const presets = Array.isArray(presetsData?.presets) ? presetsData.presets : [];
          const activeUnrest = (unrestData?.situations || []).find((s) => String(s?.situation_type || '') === 'faction_unrest') || null;
          root.innerHTML = this.buildMainView({ factions, politicsProfile, dynamicEffects, presets, activeUnrest, activeEvent });
          if (!factions.length) {
            const detail = root.querySelector('#faction-detail');
            if (detail) {
              detail.innerHTML = uiKitEmptyStateHTML('No factions available', 'Faction data is currently unavailable in this sector.');
            }
          }
          this.bindMainActions(root);
        } catch (error) {
          root.innerHTML = `<p class="error">${esc(String(error))}</p>`;
        }
      }
    }

    return new FactionsController();
  }

  const api = { createFactionsController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeFactionsController = api;
  }
})();
