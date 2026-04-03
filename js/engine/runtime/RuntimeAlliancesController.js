'use strict';
(function () {
  function createAlliancesController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML;
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML;
    const esc = opts.esc || ((value) => String(value ?? ''));
    const fmt = opts.fmt || ((value) => String(value ?? '0'));
    const showToast = opts.showToast || (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});

    class AlliancesController {
      constructor() {
        this.alliances = [];
        this.userAlliance = null;
        this.allianceDetails = null;
      }

      async render() {
        const root = wm.body('alliances');
        if (!root) return;

        root.innerHTML = uiKitSkeletonHTML();

        try {
          const data = await api.alliances();
          this.alliances = data.alliances || [];
          this.userAlliance = data.user_alliance_id;

          let html = '<div style="padding: 8px;">';

          if (this.userAlliance) {
            html += `<div style="margin-bottom: 12px; padding: 8px; background: #1a3a2a; border: 1px solid #4a8;border-radius:4px;">
              <button class="btn" onclick="GQAlliancesController.showAllianceDetails(${this.userAlliance})" style="width:100%;text-align:left;">View My Alliance</button>
              <button class="btn btn-sm" style="margin-top:4px;width:100%;background:#8b4444;" onclick="GQAlliancesController.showLeaveDialog();">Leave Alliance</button>
            </div>`;
          } else {
            html += `<div style="margin-bottom: 12px;">
              <button class="btn" onclick="GQAlliancesController.showCreateDialog()" style="width:100%;">Create Alliance</button>
            </div>`;
          }

          html += '<div style="margin-top: 12px; border-top: 1px solid #555; padding-top: 8px;"><strong>All Alliances</strong></div>';
          if (this.alliances.length === 0) {
            html += uiKitEmptyStateHTML('No alliances found', 'Start a new alliance and invite trusted commanders.');
          } else {
            html += '<div style="display: grid; gap: 6px; margin-top: 6px;">';
            for (const alliance of this.alliances) {
              html += this.renderAllianceCard(alliance);
            }
            html += '</div>';
          }

          html += '</div>';
          root.innerHTML = html;
        } catch (error) {
          root.innerHTML = '<p class="text-red">Error: ' + esc(String(error.message || 'Unknown error')) + '</p>';
        }
      }

      renderAllianceCard(alliance) {
        const canJoin = !this.userAlliance;
        return `
          <div style="padding:8px;border:1px solid #666;border-radius:4px;background:#0a0a0a;">
            <div style="font-weight:bold;">[${esc(alliance.tag)}] ${esc(alliance.name)}</div>
            <div style="font-size:0.85em;color:#bbb;margin:4px 0;">Leader ${esc(alliance.leader_name)} | ${alliance.member_count} members</div>
            ${alliance.description ? `<div style="font-size:0.8em;color:#aaa;margin:4px 0;max-height:2.5em;overflow:hidden;">${esc(alliance.description)}</div>` : ''}
            <div style="display:flex;gap:4px;margin-top:6px;">
              <button class="btn btn-sm" onclick="GQAlliancesController.showAllianceDetails(${alliance.id})" style="flex:1;">View</button>
              ${canJoin ? `<button class="btn btn-sm" onclick="GQAlliancesController.joinAlliance(${alliance.id})" style="flex:1;background:#3a4;">Join</button>` : ''}
            </div>
          </div>
        `;
      }

      async showAllianceDetails(allianceId) {
        try {
          const data = await api.allianceDetails(allianceId);
          const alliance = data.alliance;
          const members = data.members || [];
          const isMember = data.is_member;
          const isLeader = isMember && data.user_role === 'leader';

          let relations = [];
          if (isMember) {
            try {
              const relData = await api.allianceRelations(allianceId);
              relations = relData.relations || [];
            } catch (error) {
              console.warn('Failed to load relations:', error);
            }
          }

          const html = `
            <div style="padding:12px;overflow-y:auto;max-height:100%;font-size:0.9em;">
              <div style="font-size:1.1em;font-weight:bold;margin-bottom:8px;">
                [${esc(alliance.tag)}] ${esc(alliance.name)}
              </div>
              ${alliance.description ? `<div style="color:#bbb;margin-bottom:8px;">${esc(alliance.description)}</div>` : ''}
              <div style="border-bottom:1px solid #555;padding-bottom:8px;margin-bottom:8px;font-size:0.85em;color:#aaa;">
                Leader: ID ${alliance.leader_id} | Founded: ${new Date(alliance.created_at).toLocaleDateString()}
              </div>

              ${isMember ? `
                <div style="background:#1a3a2a;padding:6px;border-radius:4px;margin-bottom:8px;font-size:0.85em;">
                  <div style="font-weight:bold;color:#4f8;">Member (${esc(data.user_role)})</div>
                </div>
              ` : ''}

              <div style="margin-bottom:8px;">
                <strong>Treasury</strong>
                <div style="font-size:0.8em;color:#bbb;margin-top:4px;">
                  Metal ${fmt(alliance.treasury.metal)} | Crystal ${fmt(alliance.treasury.crystal)} | Deuterium ${fmt(alliance.treasury.deuterium)} | Dark Matter ${fmt(alliance.treasury.dark_matter)}
                </div>
              </div>

              <div style="margin-bottom:8px;">
                <strong>Members (${members.length})</strong>
                <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;max-height:120px;overflow-y:auto;margin-top:4px;font-size:0.8em;">
                  ${members.map((member) => `
                    <div style="padding:3px 6px;border-bottom:1px solid #333;">
                      <strong style="color:${member.role === 'leader' ? '#ff8' : member.role === 'diplomat' ? '#8ff' : '#fff'};">${esc(member.username)}</strong>
                      <span style="color:#999;"> (${esc(member.role)})</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              ${relations.length > 0 ? `
                <div style="margin-bottom:8px;">
                  <strong>Diplomacy Relations</strong>
                  <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;max-height:120px;overflow-y:auto;margin-top:4px;font-size:0.8em;">
                    ${relations.map((relation) => {
                      const icon = {
                        war: 'WAR',
                        enemy: 'ENEMY',
                        alliance: 'ALLY',
                        nap: 'NAP',
                        neutral: 'NEUTRAL',
                      }[relation.relation_type] || '?';
                      const color = {
                        war: '#f44',
                        enemy: '#f44',
                        alliance: '#4f4',
                        nap: '#ff8',
                        neutral: '#888',
                      }[relation.relation_type] || '#fff';
                      const label = relation.other_alliance_name
                        ? `[${relation.other_alliance_tag}] ${relation.other_alliance_name}`
                        : `Player: ${relation.other_user_name}`;
                      return `<div style="padding:3px 6px;border-bottom:1px solid #333;color:${color};">${icon} ${esc(label)} (${relation.relation_type})</div>`;
                    }).join('')}
                  </div>
                </div>
              ` : ''}

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:12px;font-size:0.85em;">
                ${isMember ? `
                  <button class="btn btn-sm" onclick="GQAlliancesController.showChatDialog(${allianceId})" style="background:#448;">Chat</button>
                  <button class="btn btn-sm" onclick="GQAlliancesController.showContributeDialog(${allianceId})" style="background:#484;">Contribute</button>
                ` : ''}
                ${isLeader ? `
                  <button class="btn btn-sm" onclick="GQAlliancesController.showDiplomacyDialog(${allianceId})" style="background:#844;">Diplomacy</button>
                  <button class="btn btn-sm" onclick="GQAlliancesController.showManageMembersDialog(${allianceId})" style="background:#448;">Members</button>
                ` : ''}
                ${isMember
                  ? '<button class="btn btn-sm" onclick="GQAlliancesController.showLeaveDialog()" style="background:#844;">Leave</button>'
                  : `<button class="btn btn-sm" onclick="GQAlliancesController.joinAlliance(${allianceId})" style="background:#3a4;">Join</button>`}
                <button class="btn btn-sm" onclick="GQAlliancesController.render()" style="background:#555;">Back</button>
              </div>
            </div>
          `;

          const root = wm.body('alliances');
          if (root) root.innerHTML = html;
        } catch (error) {
          showToast('Error loading alliance: ' + String(error.message), 'error');
        }
      }

      showCreateDialog() {
        const dialog = documentRef.createElement('div');
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:420px;';
        dialog.innerHTML = `
          <h3 style="margin: 0 0 12px 0;">Create Alliance</h3>
          <label style="display:block;margin-bottom:8px;">
            Name <span style="color:#f88;">*</span>
            <input type="text" id="alliance-name-input" placeholder="e.g., Unified Empire" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" maxlength="64" />
          </label>
          <label style="display:block;margin-bottom:8px;">
            Tag <span style="color:#f88;">*</span>
            <input type="text" id="alliance-tag-input" placeholder="e.g., UE" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" maxlength="4" />
          </label>
          <label style="display:block;margin-bottom:12px;">
            Description
            <textarea id="alliance-desc-input" placeholder="Optional..." style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;height:80px;resize:none;" maxlength="500"></textarea>
          </label>
          <div style="display:flex;gap:8px;">
            <button class="btn" onclick="GQAlliancesController.doCreateAlliance()" style="flex:1;">Create</button>
            <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Cancel</button>
          </div>
        `;
        documentRef.body.appendChild(dialog);
      }

      async doCreateAlliance() {
        try {
          const name = documentRef.getElementById('alliance-name-input')?.value || '';
          const tag = documentRef.getElementById('alliance-tag-input')?.value || '';
          const description = documentRef.getElementById('alliance-desc-input')?.value || '';

          const response = await api.createAlliance({ name, tag, description });
          documentRef.querySelector('[style*="position:fixed"]')?.remove();
          showToast(`Alliance "${response.name}" created! [${response.tag}]`, 'success');
          invalidateGetCache([/api\/alliances\.php/i]);
          await this.render();
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }

      async joinAlliance(allianceId) {
        if (!confirm('Join this alliance?')) return;
        try {
          await api.joinAlliance(allianceId);
          showToast('Joined alliance!', 'success');
          invalidateGetCache([/api\/alliances\.php/i]);
          await this.render();
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }

      showLeaveDialog() {
        if (!confirm('Leave your alliance?')) return;
        showToast('Not yet ready', 'warning');
      }

      async showChatDialog(allianceId) {
        try {
          const data = await api.allianceMessages(allianceId);
          const messages = data.messages || [];

          const html = `
            <div style="padding:12px;">
              <h4 style="margin:0 0 12px 0;">Alliance Chat</h4>
              <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;height:300px;overflow-y:auto;margin-bottom:8px;padding:8px;">
                ${messages.length === 0 ? '<div class="text-muted">No messages yet.</div>' : messages.map((message) => `
                  <div style="margin-bottom:6px;padding:4px;border-bottom:1px solid #333;">
                    <div style="font-weight:bold;color:#8f8;">${esc(message.author_name)}</div>
                    <div style="color:#ccc;font-size:0.9em;margin:2px 0;">${esc(message.text)}</div>
                    <div style="color:#666;font-size:0.75em;">${new Date(message.created_at).toLocaleTimeString()}</div>
                  </div>
                `).join('')}
              </div>
              <div style="display:flex;gap:4px;">
                <input type="text" id="alliance-chat-input" placeholder="Message..." style="flex:1;padding:6px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
                <button class="btn btn-sm" onclick="GQAlliancesController.doSendChatMessage(${allianceId})">Send</button>
              </div>
              <button class="btn btn-sm" onclick="GQAlliancesController.showAllianceDetails(${allianceId})" style="margin-top:8px;width:100%;">Close</button>
            </div>
          `;

          const root = wm.body('alliances');
          if (root) root.innerHTML = html;
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }

      async doSendChatMessage(allianceId) {
        const input = documentRef.getElementById('alliance-chat-input');
        const message = input?.value || '';
        if (!message.trim()) return;

        try {
          await api.sendAllianceMessage(allianceId, message);
          input.value = '';
          invalidateGetCache([/api\/alliances\.php\?action=get_messages/i]);
          await this.showChatDialog(allianceId);
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }

      showContributeDialog(allianceId) {
        const dialog = documentRef.createElement('div');
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:380px;font-size:0.9em;';
        dialog.innerHTML = `
          <h3 style="margin: 0 0 12px 0;">Contribute to Treasury</h3>
          <label style="display:block;margin-bottom:8px;">
            Metal <input type="number" id="contrib-metal" value="0" min="0" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
          </label>
          <label style="display:block;margin-bottom:8px;">
            Crystal <input type="number" id="contrib-crystal" value="0" min="0" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
          </label>
          <label style="display:block;margin-bottom:12px;">
            Deuterium <input type="number" id="contrib-deuterium" value="0" min="0" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
          </label>
          <div style="display:flex;gap:8px;">
            <button class="btn" onclick="GQAlliancesController.doContribute(${allianceId})" style="flex:1;">Contribute</button>
            <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Cancel</button>
          </div>
        `;
        documentRef.body.appendChild(dialog);
      }

      async doContribute(allianceId) {
        const metal = parseFloat(documentRef.getElementById('contrib-metal')?.value || 0);
        const crystal = parseFloat(documentRef.getElementById('contrib-crystal')?.value || 0);
        const deuterium = parseFloat(documentRef.getElementById('contrib-deuterium')?.value || 0);

        if (metal < 0 || crystal < 0 || deuterium < 0) {
          showToast('Resources must be non-negative.', 'error');
          return;
        }

        try {
          await api.contributeAlliance({ alliance_id: allianceId, metal, crystal, deuterium });
          documentRef.querySelector('[style*="position:fixed"]')?.remove();
          showToast('Resources contributed!', 'success');
          invalidateGetCache([/api\/alliances\.php/i]);
          await this.showAllianceDetails(allianceId);
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }

      showDiplomacyDialog(allianceId) {
        const dialog = documentRef.createElement('div');
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:400px;font-size:0.9em;';
        dialog.innerHTML = `
          <h3 style="margin: 0 0 12px 0;">Diplomacy</h3>
          <div style="margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>Target Type</strong></div>
            <select id="diplo-target-type" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
              <option value="alliance">Alliance</option>
              <option value="player">Player</option>
            </select>
          </div>
          <div style="margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>Target ID</strong></div>
            <input type="number" id="diplo-target-id" min="1" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" placeholder="Alliance/Player ID" />
          </div>
          <div style="margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>Action</strong></div>
            <select id="diplo-action" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
              <option value="war">Declare War</option>
              <option value="nap">Non-Aggression Pact</option>
              <option value="alliance">Propose Alliance</option>
              <option value="enemy">Mark as Enemy</option>
              <option value="neutral">Neutral</option>
            </select>
          </div>
          <div id="diplo-nap-days" style="display:none;margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>Duration (days)</strong></div>
            <input type="number" id="diplo-nap-value" value="7" min="1" max="365" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn" onclick="GQAlliancesController.doDiplomacy(${allianceId})" style="flex:1;">Execute</button>
            <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Cancel</button>
          </div>
        `;
        documentRef.body.appendChild(dialog);

        documentRef.getElementById('diplo-action')?.addEventListener('change', (event) => {
          const napDaysDiv = documentRef.getElementById('diplo-nap-days');
          if (napDaysDiv) {
            napDaysDiv.style.display = event.target.value === 'nap' ? 'block' : 'none';
          }
        });
      }

      async doDiplomacy(allianceId) {
        const targetType = documentRef.getElementById('diplo-target-type')?.value || 'alliance';
        const targetId = parseInt(documentRef.getElementById('diplo-target-id')?.value || 0, 10);
        const action = documentRef.getElementById('diplo-action')?.value || 'war';
        const napDays = parseInt(documentRef.getElementById('diplo-nap-value')?.value || 7, 10);

        if (!targetId || targetId <= 0) {
          showToast('Invalid target ID.', 'error');
          return;
        }

        try {
          const payload = { alliance_id: allianceId };
          if (targetType === 'alliance') {
            payload.target_alliance_id = targetId;
          } else {
            payload.target_user_id = targetId;
          }

          if (action === 'war') {
            await api.declareWar(payload);
            showToast('War declared!', 'success');
          } else if (action === 'nap') {
            payload.days = napDays;
            await api.declareNap(payload);
            showToast(`NAP declared for ${napDays} days!`, 'success');
          } else if (action === 'alliance') {
            await api.declareAllianceDiplomacy(payload);
            showToast('Alliance proposed!', 'success');
          } else {
            payload.relation_type = action;
            await api.setAllianceRelation(payload);
            showToast(`Relation set to ${action}.`, 'success');
          }

          documentRef.querySelector('[style*="position:fixed"]')?.remove();
          invalidateGetCache([/api\/alliances\.php/i]);
          await this.showAllianceDetails(allianceId);
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }

      showManageMembersDialog(allianceId) {
        const dialog = documentRef.createElement('div');
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:420px;font-size:0.9em;';
        dialog.innerHTML = `
          <h3 style="margin: 0 0 12px 0;">Manage Members</h3>
          <div style="margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>Member ID/Username</strong></div>
            <input type="text" id="member-id-input" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" placeholder="User ID (numeric)" />
          </div>
          <div style="margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>Action</strong></div>
            <select id="member-action" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
              <option value="set_role">Change Role</option>
              <option value="remove">Remove Member</option>
            </select>
          </div>
          <div id="member-role-div" style="margin-bottom:12px;">
            <div style="color:#aaa;margin-bottom:8px;"><strong>New Role</strong></div>
            <select id="member-role" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
              <option value="diplomat">Diplomat</option>
              <option value="officer">Officer</option>
              <option value="member">Member</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn" onclick="GQAlliancesController.doManageMember(${allianceId})" style="flex:1;">Execute</button>
            <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Cancel</button>
          </div>
        `;
        documentRef.body.appendChild(dialog);

        documentRef.getElementById('member-action')?.addEventListener('change', (event) => {
          const roleDiv = documentRef.getElementById('member-role-div');
          if (roleDiv) {
            roleDiv.style.display = event.target.value === 'set_role' ? 'block' : 'none';
          }
        });
      }

      async doManageMember(allianceId) {
        const userId = parseInt(documentRef.getElementById('member-id-input')?.value || 0, 10);
        const action = documentRef.getElementById('member-action')?.value || 'set_role';

        if (!userId || userId <= 0) {
          showToast('Invalid user ID.', 'error');
          return;
        }

        try {
          if (action === 'remove') {
            if (!confirm('Remove this member?')) return;
            await api.removeAllianceMember({ alliance_id: allianceId, user_id: userId });
            showToast('Member removed!', 'success');
          } else {
            const role = documentRef.getElementById('member-role')?.value || 'member';
            await api.setAllianceMemberRole({ alliance_id: allianceId, user_id: userId, role });
            showToast(`Member role set to ${role}!`, 'success');
          }

          documentRef.querySelector('[style*="position:fixed"]')?.remove();
          invalidateGetCache([/api\/alliances\.php/i]);
          await this.showAllianceDetails(allianceId);
        } catch (error) {
          showToast('Error: ' + String(error.message), 'error');
        }
      }
    }

    return new AlliancesController();
  }

  const api = {
    createAlliancesController,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeAlliancesController = api;
  }
})();
