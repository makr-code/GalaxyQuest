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

    class FactionsController {
      constructor() {
        this.conversations = new Map();
        this.lastFactions = [];
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
                  <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" data-fid="${faction.id}" data-act="contact">Kontakt</button>
                    <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="trade">Handel</button>
                    <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="quests">Aufträge</button>
                  </div>
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
      }

      buildConversationDetail(fid) {
        const faction = this.getFactionById(fid);
        const state = this.getConversationState(fid) || { history: [], suggestedReplies: [], model: '', fallback: false, standingChange: null, questHook: null, loading: true };
        const factionName = faction?.name || `Faction ${fid}`;
        const factionColor = faction?.color || '#88aaff';
        const factionIcon = faction?.icon || '';
        const standingChange = state.standingChange && typeof state.standingChange === 'object' ? state.standingChange : null;
        const standingDelta = Number(standingChange?.delta || 0);
        const questHook = state.questHook && typeof state.questHook === 'object' ? state.questHook : null;

        const transcriptHtml = state.history.length
          ? state.history.map((entry) => {
              const isNpc = entry.speaker === 'npc';
              const align = isNpc ? 'flex-start' : 'flex-end';
              const bg = isNpc ? 'rgba(80,120,255,0.16)' : 'rgba(255,255,255,0.08)';
              const border = isNpc ? factionColor : 'rgba(255,255,255,0.18)';
              const label = isNpc ? `${factionIcon} ${factionName}` : 'You';
              return `
                <div style="display:flex;justify-content:${align};margin-bottom:0.55rem;">
                  <div style="max-width:85%;border:1px solid ${esc(border)};background:${bg};border-radius:10px;padding:0.55rem 0.7rem;">
                    <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.22rem">${esc(label)}</div>
                    <div style="line-height:1.4">${esc(entry.text)}</div>
                  </div>
                </div>`;
            }).join('')
          : '<div class="text-muted">Opening channel...</div>';

        const standingEffectHtml = standingChange
          ? `
            <div style="margin-bottom:0.7rem;border:1px solid ${standingDelta >= 0 ? 'rgba(90,200,140,0.45)' : 'rgba(220,110,110,0.45)'};background:${standingDelta >= 0 ? 'rgba(90,200,140,0.12)' : 'rgba(220,110,110,0.12)'};border-radius:10px;padding:0.6rem 0.75rem;">
              <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.18rem">Diplomatic Shift</div>
              <div style="font-weight:600">Standing ${standingDelta >= 0 ? '+' : ''}${standingDelta} -> ${esc(String(standingChange.after ?? faction?.standing ?? ''))}</div>
              <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.18rem">${esc(String(standingChange.reason || ''))}</div>
            </div>`
          : '';

        const questHookHtml = questHook
          ? `
            <div style="margin-bottom:0.7rem;border:1px solid rgba(255,210,90,0.38);background:rgba(255,210,90,0.08);border-radius:10px;padding:0.7rem 0.75rem;display:flex;justify-content:space-between;gap:0.8rem;align-items:center;">
              <div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.18rem">Quest Hook</div>
                <div style="font-weight:600">${esc(String(questHook.title || 'Available Assignment'))}</div>
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.18rem">${esc(String(questHook.description || ''))}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.18rem">${esc(String(questHook.hook_text || ''))}${Number(questHook.reward_standing || 0) ? ` Reward standing: +${esc(String(questHook.reward_standing))}` : ''}</div>
              </div>
              <button class="btn btn-primary btn-sm" id="faction-dialog-start-hook" data-fid="${fid}" data-fqid="${Number(questHook.quest_id || 0)}" type="button" ${questHook.started ? 'disabled' : ''}>${questHook.started ? 'Quest Started' : 'Start Quest'}</button>
            </div>`
          : '';

        const suggestionsHtml = (state.suggestedReplies || []).map((reply, index) => `
          <button class="btn btn-secondary btn-sm faction-dialog-suggestion" data-fid="${fid}" data-index="${index}" style="text-align:left;justify-content:flex-start">${esc(reply)}</button>
        `).join('');

        return `
          <div class="system-card">
            <div style="display:flex;justify-content:space-between;gap:0.8rem;align-items:center;margin-bottom:0.65rem">
              <div>
                <h4 style="margin:0">${esc(factionIcon)} Contact: ${esc(factionName)}</h4>
                <div style="font-size:0.74rem;color:var(--text-muted)">NPC opens first. Then you get 3 RPG-style responses plus free input.${state.model ? ` Model: ${esc(state.model)}` : ''}${state.fallback ? ' | fallback reply' : ''}</div>
              </div>
              <button class="btn btn-secondary btn-sm" id="faction-dialog-restart" data-fid="${fid}" type="button">Restart</button>
            </div>
            ${standingEffectHtml}
            ${questHookHtml}
            <div style="background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:0.75rem;max-height:360px;overflow:auto;margin-bottom:0.7rem">
              ${transcriptHtml}
            </div>
            <div style="display:grid;gap:0.45rem;margin-bottom:0.7rem">
              ${suggestionsHtml || '<div class="text-muted">No suggested replies available.</div>'}
            </div>
            <div style="display:flex;gap:0.45rem;align-items:center">
              <input id="faction-dialog-input" type="text" maxlength="280" placeholder="Type your own response..." style="flex:1;padding:0.55rem 0.7rem;border:1px solid #666;background:#0a0a0a;color:#fff;border-radius:8px;" ${state.loading ? 'disabled' : ''} />
              <button class="btn btn-primary btn-sm" id="faction-dialog-send" data-fid="${fid}" type="button" ${state.loading ? 'disabled' : ''}>Send</button>
            </div>
          </div>`;
      }

      bindConversationActions(root, fid) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;

        detail.querySelectorAll('.faction-dialog-suggestion').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const state = this.getConversationState(fid);
            const index = Number(btn.getAttribute('data-index') || -1);
            const reply = state?.suggestedReplies?.[index] || '';
            if (!reply) return;
            await this.advanceConversation(root, fid, reply, false);
          });
        });

        detail.querySelector('#faction-dialog-send')?.addEventListener('click', async () => {
          const input = detail.querySelector('#faction-dialog-input');
          const value = String(input?.value || '').trim();
          if (!value) return;
          if (input) input.value = '';
          await this.advanceConversation(root, fid, value, false);
        });

        detail.querySelector('#faction-dialog-input')?.addEventListener('keydown', async (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const input = event.currentTarget;
          const value = String(input?.value || '').trim();
          if (!value) return;
          input.value = '';
          await this.advanceConversation(root, fid, value, false);
        });

        detail.querySelector('#faction-dialog-restart')?.addEventListener('click', async () => {
          await this.advanceConversation(root, fid, '', true);
        });

        detail.querySelector('#faction-dialog-start-hook')?.addEventListener('click', async (event) => {
          const btn = event.currentTarget;
          const fqid = Number(btn?.getAttribute('data-fqid') || 0);
          if (!fqid) return;
          btn.disabled = true;
          const response = await API.startFactionQuest(fqid);
          if (response?.success) {
            const current = this.getConversationState(fid) || {};
            const nextHook = current.questHook ? Object.assign({}, current.questHook, { started: true }) : null;
            this.setConversationState(fid, Object.assign({}, current, { questHook: nextHook }));
            detail.innerHTML = this.buildConversationDetail(fid);
            this.bindConversationActions(root, fid);
            showToast(response.message || 'Quest started.', 'success');
          } else {
            btn.disabled = false;
            showToast(response?.error || 'Quest could not be started.', 'error');
          }
        });
      }

      async advanceConversation(root, fid, playerInput = '', reset = false) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;

        const current = reset ? null : this.getConversationState(fid);
        const history = reset ? [] : (current?.history || []);
        this.setConversationState(fid, Object.assign({}, current || {}, { loading: true, history }));
        detail.innerHTML = this.buildConversationDetail(fid);

        try {
          const response = await API.factionDialogue({
            faction_id: fid,
            history,
            player_input: reset ? '' : playerInput,
          });

          if (!response?.success) {
            throw new Error(response?.error || 'Dialogue request failed.');
          }

          this.setConversationState(fid, {
            history: Array.isArray(response.history) ? response.history : [],
            suggestedReplies: Array.isArray(response.suggested_replies) ? response.suggested_replies : [],
            model: String(response.model || ''),
            fallback: !!response.fallback,
            standingChange: response.standing_change && typeof response.standing_change === 'object' ? response.standing_change : null,
            questHook: response.quest_hook && typeof response.quest_hook === 'object' ? Object.assign({ started: false }, response.quest_hook) : null,
            loading: false,
          });
          if (response?.faction && Number.isFinite(Number(response.faction.standing))) {
            const standingChange = response.standing_change && typeof response.standing_change === 'object' ? response.standing_change : null;
            this.updateFactionSnapshot(fid, {
              standing: Number(response.faction.standing),
              last_event: standingChange?.reason ? `[dialogue] ${standingChange.reason}` : String(this.getFactionById(fid)?.last_event || ''),
            });
            this.syncFactionCard(root, fid);
          }
          detail.innerHTML = this.buildConversationDetail(fid);
          this.bindConversationActions(root, fid);

          const npcMsg = String(response.npc_message || '').trim();
          if (npcMsg && windowRef.GQTTS && typeof windowRef.GQTTS.playOrSpeak === 'function') {
            windowRef.GQTTS.playOrSpeak(
              response.tts_audio_url || null,
              npcMsg,
              { voice: response.tts_voice || '' }
            ).catch(() => {});
          }
        } catch (err) {
          this.setConversationState(fid, Object.assign({}, current || {}, { loading: false }));
          detail.innerHTML = `<p class="error">${esc(String(err?.message || err || 'Dialogue failed.'))}</p>`;
          showToast('Faction dialogue failed.', 'error');
        }
      }

      async renderDetail(root, fid, mode) {
        const detail = root.querySelector('#faction-detail');
        if (!detail) return;
        detail.innerHTML = '<p class="text-muted">Loading...</p>';

        if (mode === 'contact') {
          const existing = this.getConversationState(fid);
          if (existing) {
            detail.innerHTML = this.buildConversationDetail(fid);
            this.bindConversationActions(root, fid);
          } else {
            await this.advanceConversation(root, fid, '', true);
          }
          return;
        }

        if (mode === 'trade') {
          const data = await API.tradeOffers(fid);
          if (!data.success || !data.offers.length) {
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
