/**
 * GalaxyQuest – Main game UI controller (game.html)
 */
(async function () {
  // ── Auth guard ───────────────────────────────────────────
  let currentUser;
  try {
    const meData = await API.me();
    if (!meData.success) { window.location.href = 'index.html'; return; }
    currentUser = meData.user;
  } catch (_) { window.location.href = 'index.html'; return; }

  document.getElementById('commander-name').textContent = '⚙ ' + currentUser.username;

  // ── State ────────────────────────────────────────────────
  let planets      = [];
  let currentPlanet = null;
  let activeView   = 'overview';

  // ── Utilities ────────────────────────────────────────────
  function fmt(n) {
    n = parseFloat(n);
    if (isNaN(n)) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toLocaleString();
  }

  function fmtName(type) {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function countdown(endTime) {
    const secs = Math.max(0, Math.round((new Date(endTime) - Date.now()) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }

  function showToast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `toast ${type}`;
    el.classList.remove('hidden');
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ── View switching ────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === 'view-' + activeView);
        v.classList.toggle('hidden', v.id !== 'view-' + activeView);
      });
      renderView(activeView);
    });
  });

  function renderView(view) {
    switch (view) {
      case 'overview':    renderOverview();   break;
      case 'buildings':   renderBuildings();  break;
      case 'research':    renderResearch();   break;
      case 'shipyard':    renderShipyard();   break;
      case 'fleet':       renderFleetForm();  break;
      case 'galaxy':      /* on demand */     break;
      case 'messages':    renderMessages();   break;
      case 'leaderboard': renderLeaderboard();break;
    }
  }

  // ── Planet selector ───────────────────────────────────────
  const planetSelect = document.getElementById('planet-select');
  planetSelect.addEventListener('change', () => {
    const pid = parseInt(planetSelect.value, 10);
    currentPlanet = planets.find(p => p.id === pid) || null;
    updateResourceBar();
    renderView(activeView);
  });

  function populatePlanetSelect() {
    planetSelect.innerHTML = planets.map(p =>
      `<option value="${p.id}">${esc(p.name)} [${p.galaxy}:${p.system}:${p.position}]</option>`
    ).join('');
    if (!currentPlanet && planets.length) {
      currentPlanet = planets[0];
      planetSelect.value = currentPlanet.id;
    }
  }

  function updateResourceBar() {
    if (!currentPlanet) return;
    document.getElementById('res-metal').textContent     = fmt(currentPlanet.metal);
    document.getElementById('res-crystal').textContent   = fmt(currentPlanet.crystal);
    document.getElementById('res-deuterium').textContent = fmt(currentPlanet.deuterium);
    document.getElementById('res-energy').textContent    = currentPlanet.energy ?? '—';
    document.getElementById('topbar-coords').textContent =
      `[${currentPlanet.galaxy}:${currentPlanet.system}:${currentPlanet.position}]`;
  }

  // ── Initial data load ─────────────────────────────────────
  async function loadOverview() {
    try {
      const data = await API.overview();
      if (!data.success) return;
      planets = data.planets || [];
      populatePlanetSelect();
      updateResourceBar();

      // Unread badge
      const badge = document.getElementById('msg-badge');
      if (data.unread_msgs > 0) {
        badge.textContent = data.unread_msgs;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }

      // Store fleets for overview
      window._gqFleets = data.fleets || [];
      if (activeView === 'overview') renderOverview();
    } catch (e) {
      console.error('Overview load failed', e);
    }
  }

  // ── Overview ──────────────────────────────────────────────
  function renderOverview() {
    const content = document.getElementById('overview-content');
    if (!planets.length) { content.innerHTML = '<p class="text-muted">No planets yet.</p>'; return; }

    content.innerHTML = `
      <div class="overview-grid">
        ${planets.map(p => `
          <div class="planet-card ${currentPlanet && p.id === currentPlanet.id ? 'selected' : ''}"
               data-pid="${p.id}">
            <div class="planet-card-name">${esc(p.name)}</div>
            <div class="planet-card-coords">[${p.galaxy}:${p.system}:${p.position}]</div>
            <div class="planet-card-type">${fmtName(p.type)} • ${p.is_homeworld ? '🏠 Homeworld' : '🌐 Colony'}</div>
            <div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-secondary)">
              ⬡ ${fmt(p.metal)} &nbsp; 💎 ${fmt(p.crystal)} &nbsp; 🔵 ${fmt(p.deuterium)}
            </div>
          </div>
        `).join('')}
      </div>`;

    content.querySelectorAll('.planet-card').forEach(card => {
      card.addEventListener('click', () => {
        const pid = parseInt(card.dataset.pid, 10);
        currentPlanet = planets.find(p => p.id === pid);
        planetSelect.value = pid;
        updateResourceBar();
        renderOverview();
      });
    });

    // Fleets
    const fleetList = document.getElementById('fleet-list');
    const fleets = window._gqFleets || [];
    if (!fleets.length) {
      fleetList.innerHTML = '<p class="text-muted">No active fleets.</p>';
    } else {
      fleetList.innerHTML = fleets.map(f => `
        <div class="fleet-row">
          <span class="fleet-mission">${esc(f.mission.toUpperCase())}</span>
          <span class="fleet-target">→ [${f.target_galaxy}:${f.target_system}:${f.target_position}]</span>
          <span class="fleet-timer" data-end="${esc(f.arrival_time)}">${countdown(f.arrival_time)}</span>
          ${f.returning ? '<span class="fleet-returning">↩ Returning</span>' : ''}
          ${!f.returning ? `<button class="btn btn-warning btn-sm recall-btn" data-fid="${f.id}">Recall</button>` : ''}
        </div>`).join('');

      fleetList.querySelectorAll('.recall-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fid = parseInt(btn.dataset.fid, 10);
          const r = await API.recallFleet(fid);
          if (r.success) { showToast('Fleet recalled.', 'success'); loadOverview(); }
          else showToast(r.error || 'Recall failed', 'error');
        });
      });
    }
  }

  // ── Buildings ─────────────────────────────────────────────
  async function renderBuildings() {
    const el = document.getElementById('buildings-content');
    if (!currentPlanet) { el.innerHTML = '<p class="text-muted">Select a planet.</p>'; return; }
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      await API.finishBuilding(currentPlanet.id);
      const data = await API.buildings(currentPlanet.id);
      if (!data.success) { el.innerHTML = '<p class="text-red">Error loading buildings.</p>'; return; }

      el.innerHTML = `<div class="card-grid">${data.buildings.map(b => {
        const busy      = !!b.upgrade_end;
        const busyTimer = busy ? countdown(b.upgrade_end) : '';
        const c = b.next_cost;
        return `
          <div class="item-card">
            <div class="item-card-header">
              <span class="item-name">${fmtName(b.type)}</span>
              <span class="item-level">Lv ${b.level}</span>
            </div>
            <div class="item-cost">
              ${c.metal     ? `<span class="cost-metal">⬡ ${fmt(c.metal)}</span>` : ''}
              ${c.crystal   ? `<span class="cost-crystal">💎 ${fmt(c.crystal)}</span>` : ''}
              ${c.deuterium ? `<span class="cost-deut">🔵 ${fmt(c.deuterium)}</span>` : ''}
            </div>
            ${busy
              ? `<div class="item-timer">⏳ ${busyTimer}</div>
                 <div class="progress-bar-wrap"><div class="progress-bar" style="width:50%"></div></div>`
              : `<button class="btn btn-primary btn-sm upgrade-btn" data-type="${esc(b.type)}">
                   ↑ Upgrade
                 </button>`
            }
          </div>`;
      }).join('')}</div>`;

      el.querySelectorAll('.upgrade-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await API.upgrade(currentPlanet.id, btn.dataset.type);
          if (r.success) {
            showToast(`Upgrading ${fmtName(btn.dataset.type)}…`, 'success');
            // Refresh resources
            const res = await API.resources(currentPlanet.id);
            if (res.success) Object.assign(currentPlanet, res.resources);
            updateResourceBar();
            renderBuildings();
          } else {
            showToast(r.error || 'Upgrade failed', 'error');
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load buildings.</p>';
    }
  }

  // ── Research ──────────────────────────────────────────────
  async function renderResearch() {
    const el = document.getElementById('research-content');
    if (!currentPlanet) { el.innerHTML = '<p class="text-muted">Select a planet.</p>'; return; }
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      await API.finishResearch();
      const data = await API.research(currentPlanet.id);
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }

      el.innerHTML = `<div class="card-grid">${data.research.map(r => {
        const busy      = !!r.research_end;
        const busyTimer = busy ? countdown(r.research_end) : '';
        const c = r.next_cost;
        return `
          <div class="item-card">
            <div class="item-card-header">
              <span class="item-name">${fmtName(r.type)}</span>
              <span class="item-level">Lv ${r.level}</span>
            </div>
            <div class="item-cost">
              ${c.metal     ? `<span class="cost-metal">⬡ ${fmt(c.metal)}</span>` : ''}
              ${c.crystal   ? `<span class="cost-crystal">💎 ${fmt(c.crystal)}</span>` : ''}
              ${c.deuterium ? `<span class="cost-deut">🔵 ${fmt(c.deuterium)}</span>` : ''}
            </div>
            ${busy
              ? `<div class="item-timer">🔬 ${busyTimer}</div>`
              : `<button class="btn btn-primary btn-sm research-btn" data-type="${esc(r.type)}">
                   Research
                 </button>`
            }
          </div>`;
      }).join('')}</div>`;

      el.querySelectorAll('.research-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await API.doResearch(currentPlanet.id, btn.dataset.type);
          if (res.success) {
            showToast(`Researching ${fmtName(btn.dataset.type)}…`, 'success');
            renderResearch();
          } else {
            showToast(res.error || 'Research failed', 'error');
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load research.</p>';
    }
  }

  // ── Shipyard ──────────────────────────────────────────────
  async function renderShipyard() {
    const el = document.getElementById('shipyard-content');
    if (!currentPlanet) { el.innerHTML = '<p class="text-muted">Select a planet.</p>'; return; }
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.ships(currentPlanet.id);
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }

      el.innerHTML = `<div class="card-grid">${data.ships.map(s => `
        <div class="item-card">
          <div class="item-card-header">
            <span class="item-name">${fmtName(s.type)}</span>
            <span class="item-level">${s.count} available</span>
          </div>
          <div class="item-cost">
            ${s.cost.metal     ? `<span class="cost-metal">⬡ ${fmt(s.cost.metal)}</span>` : ''}
            ${s.cost.crystal   ? `<span class="cost-crystal">💎 ${fmt(s.cost.crystal)}</span>` : ''}
            ${s.cost.deuterium ? `<span class="cost-deut">🔵 ${fmt(s.cost.deuterium)}</span>` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            📦 ${fmt(s.cargo)} &nbsp;⚡ ${fmt(s.speed)} speed
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem;">
            <input type="number" class="ship-qty" data-type="${esc(s.type)}"
                   min="1" value="1" style="width:60px;" />
            <button class="btn btn-primary btn-sm build-btn" data-type="${esc(s.type)}">Build</button>
          </div>
        </div>`).join('')}</div>`;

      el.querySelectorAll('.build-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const type = btn.dataset.type;
          const qty  = parseInt(el.querySelector(`.ship-qty[data-type="${type}"]`).value, 10) || 1;
          btn.disabled = true;
          const res = await API.buildShip(currentPlanet.id, type, qty);
          if (res.success) {
            showToast(`Built ${qty}× ${fmtName(type)}`, 'success');
            const r2 = await API.resources(currentPlanet.id);
            if (r2.success) Object.assign(currentPlanet, r2.resources);
            updateResourceBar();
            renderShipyard();
          } else {
            showToast(res.error || 'Build failed', 'error');
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load shipyard.</p>';
    }
  }

  // ── Fleet form ────────────────────────────────────────────
  async function renderFleetForm() {
    const el = document.getElementById('fleet-ship-select');
    if (!currentPlanet) { el.innerHTML = '<p class="text-muted">Select a planet.</p>'; return; }
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.ships(currentPlanet.id);
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }

      const available = data.ships.filter(s => s.count > 0);
      if (!available.length) {
        el.innerHTML = '<p class="text-muted">No ships available on this planet.</p>';
        return;
      }

      el.innerHTML = `<div class="ship-selector-grid">${available.map(s => `
        <div class="ship-selector-row">
          <span>${fmtName(s.type)} (${s.count})</span>
          <input type="number" class="fleet-ship-qty" data-type="${esc(s.type)}"
                 min="0" max="${s.count}" value="0" />
        </div>`).join('')}</div>`;
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load ships.</p>';
    }
  }

  document.getElementById('fleet-form').addEventListener('submit', async e => {
    e.preventDefault();
    const resultEl = document.getElementById('fleet-send-result');
    resultEl.textContent = '';
    resultEl.className   = 'form-info';

    if (!currentPlanet) { resultEl.textContent = 'Select a planet.'; return; }

    const ships = {};
    document.querySelectorAll('.fleet-ship-qty').forEach(inp => {
      const n = parseInt(inp.value, 10);
      if (n > 0) ships[inp.dataset.type] = n;
    });
    if (!Object.keys(ships).length) {
      resultEl.className   = 'form-error';
      resultEl.textContent = 'Select at least one ship.';
      return;
    }

    const mission  = document.querySelector('input[name="mission"]:checked')?.value || 'transport';
    const payload  = {
      origin_planet_id: currentPlanet.id,
      target_galaxy:    parseInt(document.getElementById('f-galaxy').value,   10),
      target_system:    parseInt(document.getElementById('f-system').value,   10),
      target_position:  parseInt(document.getElementById('f-position').value, 10),
      mission,
      ships,
      cargo: {
        metal:     parseFloat(document.getElementById('f-cargo-metal').value)   || 0,
        crystal:   parseFloat(document.getElementById('f-cargo-crystal').value) || 0,
        deuterium: parseFloat(document.getElementById('f-cargo-deut').value)    || 0,
      },
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = await API.sendFleet(payload);
      if (res.success) {
        resultEl.className   = 'form-info';
        resultEl.textContent = `Fleet launched! Arrives: ${new Date(res.arrival_time).toLocaleString()}`;
        showToast('🚀 Fleet launched!', 'success');
        loadOverview();
      } else {
        resultEl.className   = 'form-error';
        resultEl.textContent = res.error || 'Launch failed.';
      }
    } catch (_) {
      resultEl.className   = 'form-error';
      resultEl.textContent = 'Network error.';
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ── Galaxy map ────────────────────────────────────────────
  document.getElementById('gal-search-btn').addEventListener('click', loadGalaxy);
  document.getElementById('gal-prev-btn').addEventListener('click', () => {
    const sInput = document.getElementById('gal-system');
    sInput.value = Math.max(1, parseInt(sInput.value, 10) - 1);
    loadGalaxy();
  });
  document.getElementById('gal-next-btn').addEventListener('click', () => {
    const sInput = document.getElementById('gal-system');
    sInput.value = Math.min(499, parseInt(sInput.value, 10) + 1);
    loadGalaxy();
  });

  async function loadGalaxy() {
    const el = document.getElementById('galaxy-content');
    const g  = parseInt(document.getElementById('gal-galaxy').value, 10) || 1;
    const s  = parseInt(document.getElementById('gal-system').value,  10) || 1;
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.galaxy(g, s);
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }

      el.innerHTML = `
        <table class="galaxy-table">
          <thead>
            <tr>
              <th>Pos</th><th>Planet</th><th>Type</th><th>Owner</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${data.planets.map((p, i) => p
              ? `<tr>
                  <td>${i + 1}</td>
                  <td class="${p.user_id == currentUser.id ? 'slot-own' : 'slot-other'}">${esc(p.name)}</td>
                  <td><span class="planet-type-badge">${esc(p.type)}</span></td>
                  <td>${esc(p.owner)}</td>
                  <td>${p.user_id != currentUser.id
                      ? `<button class="btn btn-danger btn-sm attack-galaxy-btn"
                             data-g="${g}" data-s="${s}" data-p="${i+1}">⚔ Attack</button>`
                      : '<span class="text-green">— Yours —</span>'}</td>
                 </tr>`
              : `<tr>
                  <td>${i + 1}</td>
                  <td class="slot-empty" colspan="4">— empty —</td>
                 </tr>`
            ).join('')}
          </tbody>
        </table>`;

      el.querySelectorAll('.attack-galaxy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          // Switch to fleet view and pre-fill coordinates
          document.querySelector('.nav-btn[data-view="fleet"]').click();
          document.getElementById('f-galaxy').value   = btn.dataset.g;
          document.getElementById('f-system').value   = btn.dataset.s;
          document.getElementById('f-position').value = btn.dataset.p;
          document.querySelector('input[name="mission"][value="attack"]').checked = true;
          showToast('Coordinates set – select your ships!', 'info');
        });
      });
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load galaxy.</p>';
    }
  }

  // ── Messages ──────────────────────────────────────────────
  async function renderMessages() {
    const el = document.getElementById('messages-content');
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.inbox();
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }
      if (!data.messages.length) { el.innerHTML = '<p class="text-muted">Inbox empty.</p>'; return; }

      el.innerHTML = data.messages.map(m => `
        <div class="msg-row ${m.is_read ? '' : 'unread'}" data-mid="${m.id}">
          ${m.is_read ? '' : '<div class="msg-unread-dot"></div>'}
          <span class="msg-subject">${esc(m.subject)}</span>
          <span class="msg-sender">From: ${esc(m.sender)}</span>
          <span class="msg-date">${new Date(m.sent_at).toLocaleDateString()}</span>
          <button class="btn btn-danger btn-sm del-msg-btn" data-mid="${m.id}">🗑</button>
        </div>`).join('');

      el.querySelectorAll('.msg-row').forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.classList.contains('del-msg-btn')) return;
          openMessage(parseInt(row.dataset.mid, 10));
        });
      });
      el.querySelectorAll('.del-msg-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const r = await API.deleteMsg(parseInt(btn.dataset.mid, 10));
          if (r.success) renderMessages();
        });
      });
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load messages.</p>';
    }
  }

  async function openMessage(id) {
    const data = await API.readMsg(id);
    if (!data.success) return;
    const m = data.message;
    const detail = document.createElement('div');
    detail.className = 'msg-detail';
    detail.innerHTML = `
      <div class="msg-detail-header">
        <div>
          <strong>${esc(m.subject)}</strong>
          <div class="msg-detail-meta">From: ${esc(m.sender)} &nbsp;•&nbsp; ${new Date(m.sent_at).toLocaleString()}</div>
        </div>
        <button class="btn btn-secondary btn-sm close-msg-btn">✕ Close</button>
      </div>
      <hr class="separator" />
      <div class="msg-detail-body">${esc(m.body)}</div>`;
    detail.querySelector('.close-msg-btn').addEventListener('click', () => detail.remove());

    const el = document.getElementById('messages-content');
    // Remove existing open detail
    el.querySelector('.msg-detail')?.remove();
    el.prepend(detail);

    // Mark row as read
    el.querySelector(`.msg-row[data-mid="${id}"]`)?.classList.remove('unread');
    // Refresh badge
    loadBadge();
  }

  // ── Compose ───────────────────────────────────────────────
  document.getElementById('compose-btn').addEventListener('click', () => {
    document.getElementById('compose-form').classList.toggle('hidden');
  });
  document.getElementById('msg-send-btn').addEventListener('click', async () => {
    const res = document.getElementById('msg-send-result');
    const to      = document.getElementById('msg-to').value.trim();
    const subject = document.getElementById('msg-subject').value.trim();
    const body    = document.getElementById('msg-body').value.trim();
    if (!to || !subject || !body) {
      res.className = 'form-error'; res.textContent = 'Fill in all fields.'; return;
    }
    const r = await API.sendMsg(to, subject, body);
    if (r.success) {
      res.className = 'form-info'; res.textContent = 'Message sent!';
      document.getElementById('msg-to').value = '';
      document.getElementById('msg-subject').value = '';
      document.getElementById('msg-body').value = '';
      showToast('Message sent!', 'success');
    } else {
      res.className = 'form-error'; res.textContent = r.error || 'Failed to send.';
    }
  });

  // ── Leaderboard ───────────────────────────────────────────
  async function renderLeaderboard() {
    const el = document.getElementById('leaderboard-content');
    el.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      const data = await API.leaderboard();
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }
      if (!data.leaderboard.length) { el.innerHTML = '<p class="text-muted">No players yet.</p>'; return; }

      el.innerHTML = data.leaderboard.map((row, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${esc(row.username)} ${row.username === currentUser.username ? '(You)' : ''}</span>
          <span class="lb-stat">🌍 ${row.planet_count} planets</span>
          <span class="lb-stat">⬡ ${fmt(row.total_resources)}</span>
        </div>`).join('');
    } catch (e) {
      el.innerHTML = '<p class="text-red">Failed to load leaderboard.</p>';
    }
  }

  // ── Logout ────────────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await API.logout();
    window.location.href = 'index.html';
  });

  // ── Periodic unread-badge refresh ────────────────────────
  async function loadBadge() {
    try {
      const data = await API.inbox();
      if (!data.success) return;
      const unread = data.messages.filter(m => !parseInt(m.is_read, 10)).length;
      const badge  = document.getElementById('msg-badge');
      if (unread > 0) {
        badge.textContent = unread;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (_) {}
  }

  // ── Countdown ticker ─────────────────────────────────────
  setInterval(() => {
    document.querySelectorAll('[data-end]').forEach(el => {
      el.textContent = countdown(el.dataset.end);
    });
  }, 1000);

  // ── Periodic resource & fleet refresh ────────────────────
  setInterval(() => {
    loadOverview();
  }, 30000);

  // ── Boot ──────────────────────────────────────────────────
  await loadOverview();
  renderView('overview');
})();
