/**
 * GalaxyQuest – Main game UI controller
 * All views are rendered as floating windows via the WM (window manager).
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
  let planets       = [];
  let currentPlanet = null;

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
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── WM window registrations ──────────────────────────────
  WM.register('overview',    { title: '🌍 Overview',    w: 860, h: 540, onRender: () => renderOverview() });
  WM.register('buildings',   { title: '🏗 Buildings',   w: 680, h: 540, onRender: () => renderBuildings() });
  WM.register('research',    { title: '🔬 Research',    w: 680, h: 540, onRender: () => renderResearch() });
  WM.register('shipyard',    { title: '🚀 Shipyard',    w: 740, h: 540, onRender: () => renderShipyard() });
  WM.register('fleet',       { title: '⚡ Fleet',       w: 640, h: 640, onRender: () => renderFleetForm() });
  WM.register('galaxy',      { title: '🌌 Galaxy Map',  w: 860, h: 540, onRender: () => renderGalaxyWindow() });
  WM.register('messages',    { title: '✉ Messages',     w: 640, h: 520, onRender: () => renderMessages() });
  WM.register('quests',      { title: '📋 Quests',      w: 860, h: 620, onRender: () => renderQuests() });
  WM.register('leaderboard', { title: '🏆 Leaderboard', w: 540, h: 480, onRender: () => renderLeaderboard() });

  // ── Nav buttons → open windows ───────────────────────────
  document.querySelectorAll('.nav-btn[data-win]').forEach(btn => {
    btn.addEventListener('click', () => WM.open(btn.dataset.win));
  });

  // ── Planet selector ──────────────────────────────────────
  const planetSelect = document.getElementById('planet-select');
  planetSelect.addEventListener('change', () => {
    const pid = parseInt(planetSelect.value, 10);
    currentPlanet = planets.find(p => p.id === pid) || null;
    updateResourceBar();
    // Re-render planet-specific windows that are open
    ['buildings','research','shipyard','fleet'].forEach(id => WM.refresh(id));
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

  // ── Resource bar ─────────────────────────────────────────
  function updateResourceBar() {
    if (!currentPlanet) return;
    document.getElementById('res-metal').textContent     = fmt(currentPlanet.metal);
    document.getElementById('res-crystal').textContent   = fmt(currentPlanet.crystal);
    document.getElementById('res-deuterium').textContent = fmt(currentPlanet.deuterium);
    document.getElementById('res-energy').textContent    = currentPlanet.energy ?? '—';
    document.getElementById('topbar-coords').textContent =
      `[${currentPlanet.galaxy}:${currentPlanet.system}:${currentPlanet.position}]`;
    if (window._gqUserMeta) {
      document.getElementById('res-dark-matter').textContent =
        fmt(window._gqUserMeta.dark_matter ?? 0);
    }
  }

  // ── Overview data load ────────────────────────────────────
  async function loadOverview() {
    try {
      const data = await API.overview();
      if (!data.success) return;
      planets = data.planets || [];
      populatePlanetSelect();
      updateResourceBar();

      window._gqUserMeta = data.user_meta || {};
      updateResourceBar();

      // Message badge
      const msgBadge = document.getElementById('msg-badge');
      if (data.unread_msgs > 0) {
        msgBadge.textContent = data.unread_msgs;
        msgBadge.classList.remove('hidden');
      } else {
        msgBadge.classList.add('hidden');
      }

      // Quest badge
      const qBadge = document.getElementById('quest-badge');
      const unclaimed = data.user_meta?.unclaimed_quests ?? 0;
      if (unclaimed > 0) {
        qBadge.textContent = unclaimed;
        qBadge.classList.remove('hidden');
      } else {
        qBadge.classList.add('hidden');
      }

      window._gqFleets = data.fleets || [];
      WM.refresh('overview');
    } catch (e) {
      console.error('Overview load failed', e);
    }
  }

  // ── Overview window ───────────────────────────────────────
  function renderOverview() {
    const root = WM.body('overview');
    if (!root) return;
    if (!planets.length) {
      root.innerHTML = '<p class="text-muted">No planets yet.</p>';
      return;
    }

    const meta       = window._gqUserMeta || {};
    const protUntil  = meta.protection_until ? new Date(meta.protection_until) : null;
    const protected_ = protUntil && protUntil > Date.now();
    const pvpOn      = !!parseInt(meta.pvp_mode, 10);
    const protText   = protected_
      ? `🛡 Newbie protection until ${protUntil.toLocaleDateString()}`
      : '🛡 No protection';

    root.innerHTML = `
      <div class="status-bar">
        <span class="status-chip ${protected_ ? 'chip-shield' : 'chip-neutral'}">${protText}</span>
        <span class="status-chip ${pvpOn ? 'chip-pvp-on' : 'chip-pvp-off'}">⚔ PvP: ${pvpOn ? 'ON' : 'OFF'}</span>
        <button id="pvp-toggle-btn" class="btn btn-sm ${pvpOn ? 'btn-warning' : 'btn-secondary'}"
                ${protected_ ? 'disabled' : ''}>
          ${pvpOn ? 'Disable PvP' : 'Enable PvP'}
        </button>
        <span class="status-chip chip-rank">★ ${fmt(meta.rank_points ?? 0)} RP</span>
        <span class="status-chip chip-dm">◆ ${fmt(meta.dark_matter ?? 0)} DM</span>
      </div>

      <h3 style="margin:0.75rem 0 0.5rem">Your Planets</h3>
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
          </div>`).join('')}
      </div>

      <h3 style="margin:1rem 0 0.5rem">Fleets in Motion</h3>
      <div id="fleet-list-wm"></div>`;

    // Planet card clicks
    root.querySelectorAll('.planet-card').forEach(card => {
      card.addEventListener('click', () => {
        const pid = parseInt(card.dataset.pid, 10);
        currentPlanet = planets.find(p => p.id === pid);
        planetSelect.value = pid;
        updateResourceBar();
        renderOverview();
      });
    });

    // PvP toggle
    root.querySelector('#pvp-toggle-btn')?.addEventListener('click', async () => {
      const r = await API.togglePvp();
      if (r.success) {
        showToast(r.pvp_mode ? '⚔ PvP enabled!' : '🛡 PvP disabled.', 'info');
        await loadOverview();
      } else {
        showToast(r.error || 'Could not toggle PvP.', 'error');
      }
    });

    // Fleets
    const fleetList = root.querySelector('#fleet-list-wm');
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
          const r = await API.recallFleet(parseInt(btn.dataset.fid, 10));
          if (r.success) { showToast('Fleet recalled.', 'success'); loadOverview(); }
          else showToast(r.error || 'Recall failed', 'error');
        });
      });
    }
  }

  // ── Buildings window ──────────────────────────────────────
  async function renderBuildings() {
    const root = WM.body('buildings');
    if (!root) return;
    if (!currentPlanet) { root.innerHTML = '<p class="text-muted">Select a planet first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      await API.finishBuilding(currentPlanet.id);
      const data = await API.buildings(currentPlanet.id);
      if (!data.success) { root.innerHTML = '<p class="text-red">Error loading buildings.</p>'; return; }

      root.innerHTML = `<div class="card-grid">${data.buildings.map(b => {
        const busy = !!b.upgrade_end;
        const c    = b.next_cost;
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
              ? `<div class="item-timer">⏳ <span data-end="${esc(b.upgrade_end)}">${countdown(b.upgrade_end)}</span></div>
                 <div class="progress-bar-wrap"><div class="progress-bar" style="width:50%"></div></div>`
              : `<button class="btn btn-primary btn-sm upgrade-btn" data-type="${esc(b.type)}">↑ Upgrade</button>`
            }
          </div>`;
      }).join('')}</div>`;

      root.querySelectorAll('.upgrade-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await API.upgrade(currentPlanet.id, btn.dataset.type);
          if (r.success) {
            showToast(`Upgrading ${fmtName(btn.dataset.type)}…`, 'success');
            const res = await API.resources(currentPlanet.id);
            if (res.success) Object.assign(currentPlanet, res.resources);
            updateResourceBar();
            renderBuildings();
          } else { showToast(r.error || 'Upgrade failed', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load buildings.</p>'; }
  }

  // ── Research window ───────────────────────────────────────
  async function renderResearch() {
    const root = WM.body('research');
    if (!root) return;
    if (!currentPlanet) { root.innerHTML = '<p class="text-muted">Select a planet first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      await API.finishResearch();
      const data = await API.research(currentPlanet.id);
      if (!data.success) { root.innerHTML = '<p class="text-red">Error.</p>'; return; }

      root.innerHTML = `<div class="card-grid">${data.research.map(r => {
        const busy = !!r.research_end;
        const c    = r.next_cost;
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
              ? `<div class="item-timer">🔬 <span data-end="${esc(r.research_end)}">${countdown(r.research_end)}</span></div>`
              : `<button class="btn btn-primary btn-sm research-btn" data-type="${esc(r.type)}">Research</button>`
            }
          </div>`;
      }).join('')}</div>`;

      root.querySelectorAll('.research-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await API.doResearch(currentPlanet.id, btn.dataset.type);
          if (res.success) { showToast(`Researching ${fmtName(btn.dataset.type)}…`, 'success'); renderResearch(); }
          else { showToast(res.error || 'Research failed', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load research.</p>'; }
  }

  // ── Shipyard window ───────────────────────────────────────
  async function renderShipyard() {
    const root = WM.body('shipyard');
    if (!root) return;
    if (!currentPlanet) { root.innerHTML = '<p class="text-muted">Select a planet first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.ships(currentPlanet.id);
      if (!data.success) { root.innerHTML = '<p class="text-red">Error.</p>'; return; }

      root.innerHTML = `<div class="card-grid">${data.ships.map(s => `
        <div class="item-card">
          <div class="item-card-header">
            <span class="item-name">${fmtName(s.type)}</span>
            <span class="item-level">${s.count} owned</span>
          </div>
          <div class="item-cost">
            ${s.cost.metal     ? `<span class="cost-metal">⬡ ${fmt(s.cost.metal)}</span>` : ''}
            ${s.cost.crystal   ? `<span class="cost-crystal">💎 ${fmt(s.cost.crystal)}</span>` : ''}
            ${s.cost.deuterium ? `<span class="cost-deut">🔵 ${fmt(s.cost.deuterium)}</span>` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            �� ${fmt(s.cargo)} &nbsp; ⚡ ${fmt(s.speed)}
          </div>
          <div class="ship-build-row">
            <input type="number" class="ship-qty" data-type="${esc(s.type)}" min="1" value="1" />
            <button class="btn btn-primary btn-sm build-btn" data-type="${esc(s.type)}">Build</button>
          </div>
        </div>`).join('')}</div>`;

      root.querySelectorAll('.build-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const type = btn.dataset.type;
          const qty  = parseInt(root.querySelector(`.ship-qty[data-type="${type}"]`).value, 10) || 1;
          btn.disabled = true;
          const res = await API.buildShip(currentPlanet.id, type, qty);
          if (res.success) {
            showToast(`Built ${qty}× ${fmtName(type)}`, 'success');
            const r2 = await API.resources(currentPlanet.id);
            if (r2.success) Object.assign(currentPlanet, r2.resources);
            updateResourceBar();
            renderShipyard();
          } else { showToast(res.error || 'Build failed', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load shipyard.</p>'; }
  }

  // ── Fleet window ──────────────────────────────────────────
  async function renderFleetForm() {
    const root = WM.body('fleet');
    if (!root) return;
    if (!currentPlanet) { root.innerHTML = '<p class="text-muted">Select a planet first.</p>'; return; }

    // Build the form HTML (self-contained in window)
    root.innerHTML = `
      <form id="fleet-form-wm" autocomplete="off">
        <h3>1. Select Ships</h3>
        <div id="fleet-ship-select-wm"><p class="text-muted">Loading ships…</p></div>

        <h3>2. Select Mission</h3>
        <div class="mission-grid">
          <label><input type="radio" name="mission" value="attack" /> ⚔️ Attack</label>
          <label><input type="radio" name="mission" value="transport" checked /> 📦 Transport</label>
          <label><input type="radio" name="mission" value="spy" /> 🔭 Spy</label>
          <label><input type="radio" name="mission" value="colonize" /> 🌍 Colonize</label>
          <label><input type="radio" name="mission" value="harvest" /> ♻️ Harvest</label>
        </div>

        <h3>3. Target Coordinates</h3>
        <div class="coord-inputs">
          <label>Galaxy  <input type="number" id="f-galaxy"   min="1" max="9"   value="1" /></label>
          <label>System  <input type="number" id="f-system"   min="1" max="499" value="1" /></label>
          <label>Position<input type="number" id="f-position" min="1" max="15"  value="1" /></label>
        </div>

        <h3>4. Cargo (optional)</h3>
        <div class="cargo-inputs">
          <label>Metal    <input type="number" id="f-cargo-metal"   min="0" value="0" /></label>
          <label>Crystal  <input type="number" id="f-cargo-crystal" min="0" value="0" /></label>
          <label>Deuterium<input type="number" id="f-cargo-deut"    min="0" value="0" /></label>
        </div>

        <button type="submit" class="btn btn-primary">🚀 Launch Fleet</button>
        <div id="fleet-send-result-wm" class="form-info" aria-live="polite"></div>
      </form>`;

    // Load available ships
    try {
      const data = await API.ships(currentPlanet.id);
      const shipEl = root.querySelector('#fleet-ship-select-wm');
      if (!data.success) { shipEl.innerHTML = '<p class="text-red">Error.</p>'; return; }
      const avail = data.ships.filter(s => s.count > 0);
      if (!avail.length) { shipEl.innerHTML = '<p class="text-muted">No ships on this planet.</p>'; return; }
      shipEl.innerHTML = `<div class="ship-selector-grid">${avail.map(s => `
        <div class="ship-selector-row">
          <span>${fmtName(s.type)} (${s.count})</span>
          <input type="number" class="fleet-ship-qty" data-type="${esc(s.type)}"
                 min="0" max="${s.count}" value="0" />
        </div>`).join('')}</div>`;
    } catch (_) {}

    // Form submit
    root.querySelector('#fleet-form-wm').addEventListener('submit', async e => {
      e.preventDefault();
      const resultEl = root.querySelector('#fleet-send-result-wm');
      resultEl.textContent = '';

      const ships = {};
      root.querySelectorAll('.fleet-ship-qty').forEach(inp => {
        const cnt = parseInt(inp.value, 10);
        if (cnt > 0) ships[inp.dataset.type] = cnt;
      });

      const mission = root.querySelector('input[name="mission"]:checked')?.value;
      const tg = parseInt(root.querySelector('#f-galaxy').value,   10);
      const ts = parseInt(root.querySelector('#f-system').value,   10);
      const tp = parseInt(root.querySelector('#f-position').value, 10);

      const payload = {
        origin_planet_id: currentPlanet.id,
        target_galaxy: tg, target_system: ts, target_position: tp,
        mission,
        ships,
        cargo: {
          metal:     parseFloat(root.querySelector('#f-cargo-metal').value)   || 0,
          crystal:   parseFloat(root.querySelector('#f-cargo-crystal').value) || 0,
          deuterium: parseFloat(root.querySelector('#f-cargo-deut').value)    || 0,
        },
      };

      const submitBtn = root.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const r = await API.sendFleet(payload);
        if (r.success) {
          resultEl.className = 'form-info';
          resultEl.textContent = `Fleet launched! ETA: ${new Date(r.arrival_time).toLocaleString()}`;
          showToast('🚀 Fleet launched!', 'success');
          await loadOverview();
        } else {
          resultEl.className = 'form-error';
          resultEl.textContent = r.error || 'Failed to send fleet.';
        }
      } catch (_) {
        resultEl.className = 'form-error';
        resultEl.textContent = 'Network error.';
      }
      submitBtn.disabled = false;
    });
  }

  // ── Galaxy window ─────────────────────────────────────────
  function renderGalaxyWindow() {
    const root = WM.body('galaxy');
    if (!root) return;

    // Only build controls once (check for existing nav)
    if (!root.querySelector('.galaxy-nav')) {
      root.innerHTML = `
        <div class="galaxy-nav">
          <label>Galaxy: <input type="number" id="gal-galaxy" min="1" max="9" value="1" /></label>
          <label>System: <input type="number" id="gal-system" min="1" max="499" value="1" /></label>
          <button class="btn btn-secondary" id="gal-search-btn">Search</button>
          <button class="btn btn-secondary" id="gal-prev-btn">◀ Prev</button>
          <button class="btn btn-secondary" id="gal-next-btn">Next ▶</button>
        </div>
        <div id="galaxy-content-wm">Enter coordinates and search.</div>`;

      root.querySelector('#gal-search-btn').addEventListener('click', () => loadGalaxy(root));
      root.querySelector('#gal-prev-btn').addEventListener('click', () => {
        const inp = root.querySelector('#gal-system');
        inp.value = Math.max(1, parseInt(inp.value, 10) - 1);
        loadGalaxy(root);
      });
      root.querySelector('#gal-next-btn').addEventListener('click', () => {
        const inp = root.querySelector('#gal-system');
        inp.value = Math.min(499, parseInt(inp.value, 10) + 1);
        loadGalaxy(root);
      });
    }
  }

  async function loadGalaxy(root) {
    if (!root) root = WM.body('galaxy');
    if (!root) return;
    const el = root.querySelector('#galaxy-content-wm');
    if (!el) return;
    const g = parseInt(root.querySelector('#gal-galaxy').value, 10) || 1;
    const s = parseInt(root.querySelector('#gal-system').value,  10) || 1;
    el.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.galaxy(g, s);
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }

      // Star system header
      const ss = data.star_system;
      const starColor = { O:'#9bb0ff', B:'#aabfff', A:'#cad7ff', F:'#f8f7ff',
                          G:'#fff4ea', K:'#ffd2a1', M:'#ffcc6f' };
      const starBadge = ss
        ? `<div class="star-system-header">
            <span class="star-badge" style="background:${starColor[ss.spectral_class]||'#fff'};color:#111">
              ${ss.spectral_class}${ss.subtype} ${ss.luminosity_class}
            </span>
            <span class="star-name">${esc(ss.name)}</span>
            <span class="star-temp">${fmt(ss.temperature_k)} K</span>
            <span class="star-hz">HZ: ${ss.hz_inner_au?.toFixed(2)}–${ss.hz_outer_au?.toFixed(2)} AU</span>
            <span class="star-coords">📍 ${ss.x_ly?.toFixed(0)}, ${ss.y_ly?.toFixed(0)}, ${ss.z_ly?.toFixed(0)} ly</span>
           </div>`
        : '';

      el.innerHTML = starBadge + `
        <table class="galaxy-table">
          <thead>
            <tr><th>Pos</th><th>Planet / Slot</th><th>Class</th><th>Owner</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${data.planets.map(slot => {
              const pp = slot.player_planet;
              const gp = slot.generated_planet;
              const pos = slot.position;

              if (pp) {
                return `<tr>
                  <td>${pos}</td>
                  <td class="${pp.user_id == currentUser.id ? 'slot-own' : 'slot-other'}">${esc(pp.name)}</td>
                  <td><span class="planet-type-badge">${esc(pp.planet_class || pp.type)}</span>
                    ${pp.in_habitable_zone ? '<span class="hz-badge" title="Habitable Zone">🌿</span>' : ''}</td>
                  <td>${esc(pp.owner)}</td>
                  <td>${pp.user_id != currentUser.id
                    ? `<button class="btn btn-danger btn-sm atk-btn" data-g="${g}" data-s="${s}" data-p="${pos}">⚔</button>`
                    : '<span class="text-green">Yours</span>'}</td>
                </tr>`;
              } else if (gp) {
                return `<tr>
                  <td>${pos}</td>
                  <td class="slot-unclaimed">${esc(fmtName(gp.planet_class))}
                    <span style="font-size:0.7rem;color:var(--text-muted)">${gp.semi_major_axis_au?.toFixed(3)} AU</span></td>
                  <td><span class="planet-type-badge">${esc(gp.planet_class)}</span>
                    ${gp.in_habitable_zone ? '<span class="hz-badge" title="Habitable Zone">🌿</span>' : ''}</td>
                  <td class="text-muted">—</td>
                  <td><button class="btn btn-secondary btn-sm col-btn" data-g="${g}" data-s="${s}" data-p="${pos}">🌍 Colonize</button></td>
                </tr>`;
              } else {
                return `<tr><td>${pos}</td><td class="slot-empty" colspan="4">— empty —</td></tr>`;
              }
            }).join('')}
          </tbody>
        </table>`;

      // Attack buttons → open fleet window pre-filled
      el.querySelectorAll('.atk-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          WM.open('fleet');
          // Small delay to let fleet window render
          setTimeout(() => {
            const fw = WM.body('fleet');
            if (!fw) return;
            const fg = fw.querySelector('#f-galaxy');
            const fs = fw.querySelector('#f-system');
            const fp = fw.querySelector('#f-position');
            if (fg) fg.value = btn.dataset.g;
            if (fs) fs.value = btn.dataset.s;
            if (fp) fp.value = btn.dataset.p;
            const atk = fw.querySelector('input[value="attack"]');
            if (atk) atk.checked = true;
            showToast('Coordinates set – select ships!', 'info');
          }, 120);
        });
      });

      // Colonize buttons → pre-fill fleet window with colonize mission
      el.querySelectorAll('.col-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          WM.open('fleet');
          setTimeout(() => {
            const fw = WM.body('fleet');
            if (!fw) return;
            const fg = fw.querySelector('#f-galaxy');
            const fs = fw.querySelector('#f-system');
            const fp = fw.querySelector('#f-position');
            if (fg) fg.value = btn.dataset.g;
            if (fs) fs.value = btn.dataset.s;
            if (fp) fp.value = btn.dataset.p;
            const col = fw.querySelector('input[value="colonize"]');
            if (col) col.checked = true;
            showToast('Colonize mission set – select ships!', 'info');
          }, 120);
        });
      });
    } catch (e) { el.innerHTML = '<p class="text-red">Failed to load galaxy.</p>'; }
  }

  // ── Messages window ───────────────────────────────────────
  async function renderMessages() {
    const root = WM.body('messages');
    if (!root) return;

    root.innerHTML = `
      <div style="margin-bottom:0.75rem">
        <button class="btn btn-secondary btn-sm" id="compose-toggle-btn">✉ Compose</button>
      </div>
      <div id="compose-form-wm" class="hidden" style="margin-bottom:1rem">
        <div class="form-group">
          <label>To (username)</label>
          <input id="msg-to-wm" type="text" placeholder="recipient" />
        </div>
        <div class="form-group">
          <label>Subject</label>
          <input id="msg-subject-wm" type="text" placeholder="Subject" />
        </div>
        <div class="form-group">
          <label>Message</label>
          <textarea id="msg-body-wm" rows="3" placeholder="Your message…"></textarea>
        </div>
        <button class="btn btn-primary btn-sm" id="msg-send-btn-wm">Send</button>
        <div id="msg-send-result-wm" class="form-info" aria-live="polite"></div>
      </div>
      <div id="messages-list-wm"><p class="text-muted">Loading…</p></div>`;

    root.querySelector('#compose-toggle-btn').addEventListener('click', () => {
      root.querySelector('#compose-form-wm').classList.toggle('hidden');
    });

    root.querySelector('#msg-send-btn-wm').addEventListener('click', async () => {
      const res = root.querySelector('#msg-send-result-wm');
      const to      = root.querySelector('#msg-to-wm').value.trim();
      const subject = root.querySelector('#msg-subject-wm').value.trim();
      const body    = root.querySelector('#msg-body-wm').value.trim();
      if (!to || !subject || !body) { res.className='form-error'; res.textContent='Fill in all fields.'; return; }
      const r = await API.sendMsg(to, subject, body);
      if (r.success) {
        res.className='form-info'; res.textContent='Message sent!';
        root.querySelector('#msg-to-wm').value = '';
        root.querySelector('#msg-subject-wm').value = '';
        root.querySelector('#msg-body-wm').value = '';
        showToast('Message sent!', 'success');
      } else { res.className='form-error'; res.textContent=r.error||'Failed.'; }
    });

    await _loadMessagesList(root);
  }

  async function _loadMessagesList(root) {
    const el = root.querySelector('#messages-list-wm');
    if (!el) return;
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
        row.addEventListener('click', async e => {
          if (e.target.classList.contains('del-msg-btn')) return;
          const mid  = parseInt(row.dataset.mid, 10);
          const d    = await API.readMsg(mid);
          if (!d.success) return;
          const m    = d.message;
          // Show detail above list
          let detail = root.querySelector('.msg-detail');
          if (!detail) { detail = document.createElement('div'); detail.className='msg-detail'; el.before(detail); }
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
          row.classList.remove('unread');
          loadBadge();
        });
      });

      el.querySelectorAll('.del-msg-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const r = await API.deleteMsg(parseInt(btn.dataset.mid, 10));
          if (r.success) _loadMessagesList(root);
        });
      });
    } catch (e) { el.innerHTML = '<p class="text-red">Failed to load messages.</p>'; }
  }

  // ── Leaderboard window ────────────────────────────────────
  async function renderLeaderboard() {
    const root = WM.body('leaderboard');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      const data = await API.leaderboard();
      if (!data.success) { root.innerHTML = '<p class="text-red">Error.</p>'; return; }
      if (!data.leaderboard.length) { root.innerHTML = '<p class="text-muted">No players yet.</p>'; return; }

      root.innerHTML = data.leaderboard.map((row, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${esc(row.username)} ${row.username === currentUser.username ? '(You)' : ''}</span>
          <span class="lb-stat">★ ${fmt(row.rank_points)} RP</span>
          <span class="lb-stat">🌍 ${row.planet_count}</span>
          <span class="lb-stat">◆ ${fmt(row.dark_matter)}</span>
        </div>`).join('');
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load leaderboard.</p>'; }
  }

  // ── Quests window ─────────────────────────────────────────
  async function renderQuests() {
    const root = WM.body('quests');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      const data = await API.achievements();
      if (!data.success) { root.innerHTML = '<p class="text-red">Error loading quests.</p>'; return; }

      const all    = data.achievements || [];
      const groups = {};
      for (const a of all) {
        if (!groups[a.category]) groups[a.category] = [];
        groups[a.category].push(a);
      }

      const categoryLabels = {
        tutorial:  '📘 Tutorial – New Player Quests',
        economy:   '💰 Economy', expansion: '🌍 Expansion',
        combat:    '⚔ Combat',   milestone: '🏆 Veteran Milestones',
      };
      const categoryOrder = ['tutorial','economy','expansion','combat','milestone'];
      let html = '';

      for (const cat of categoryOrder) {
        if (!groups[cat]) continue;
        const quests    = groups[cat];
        const done      = quests.filter(q => q.completed && q.reward_claimed).length;
        const claimable = quests.filter(q => q.completed && !q.reward_claimed).length;

        html += `<div class="quest-group">
          <h3 class="quest-group-title">
            ${esc(categoryLabels[cat] ?? cat)}
            <span class="quest-group-progress">${done}/${quests.length}</span>
            ${claimable ? `<span class="quest-claimable-badge">${claimable} ready!</span>` : ''}
          </h3><div class="quest-list">`;

        for (const q of quests) {
          const pct   = (q.goal > 0) ? Math.min(100, Math.round(q.progress / q.goal * 100)) : 100;
          const state = q.reward_claimed ? 'claimed' : q.completed ? 'claimable' : 'pending';
          const rewards = [];
          if (q.reward_metal)       rewards.push(`⬡ ${fmt(q.reward_metal)}`);
          if (q.reward_crystal)     rewards.push(`💎 ${fmt(q.reward_crystal)}`);
          if (q.reward_deuterium)   rewards.push(`🔵 ${fmt(q.reward_deuterium)}`);
          if (q.reward_dark_matter) rewards.push(`◆ ${fmt(q.reward_dark_matter)} DM`);
          if (q.reward_rank_points) rewards.push(`★ ${fmt(q.reward_rank_points)} RP`);

          html += `
            <div class="quest-card quest-${state}" data-aid="${q.id}">
              <div class="quest-header">
                <span class="quest-icon">${state==='claimed'?'✅':state==='claimable'?'🎁':'○'}</span>
                <span class="quest-title">${esc(q.title)}</span>
              </div>
              <div class="quest-desc">${esc(q.description)}</div>
              ${state !== 'claimed' ? `
                <div class="quest-progress-wrap">
                  <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
                  <span class="quest-progress-label">${q.progress} / ${q.goal}</span>
                </div>` : ''}
              <div class="quest-footer">
                <span class="quest-rewards">${rewards.join(' &nbsp; ')}</span>
                ${state==='claimable'
                  ? `<button class="btn btn-primary btn-sm claim-btn" data-aid="${q.id}">✨ Claim</button>`
                  : state==='claimed'
                    ? `<span class="quest-claimed-label">Claimed ${q.completed_at?new Date(q.completed_at).toLocaleDateString():''}</span>`
                    : ''}
              </div>
            </div>`;
        }
        html += `</div></div>`;
      }

      root.innerHTML = html || '<p class="text-muted">No quests found.</p>';

      root.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await API.claimAchievement(parseInt(btn.dataset.aid, 10));
          if (r.success) {
            showToast(r.message || '🏆 Reward claimed!', 'success');
            await loadOverview();
            renderQuests();
          } else { showToast(r.error || 'Could not claim reward.', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load quests.</p>'; }
  }

  // ── Logout ────────────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await API.logout();
    window.location.href = 'index.html';
  });

  // ── Badge refresh (messages) ──────────────────────────────
  async function loadBadge() {
    try {
      const data = await API.inbox();
      if (!data.success) return;
      const unread = data.messages.filter(m => !parseInt(m.is_read, 10)).length;
      const badge  = document.getElementById('msg-badge');
      if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch (_) {}
  }

  // ── Countdown ticker ─────────────────────────────────────
  setInterval(() => {
    document.querySelectorAll('[data-end]').forEach(el => {
      el.textContent = countdown(el.dataset.end);
    });
  }, 1000);

  // ── Periodic refresh ──────────────────────────────────────
  setInterval(async () => {
    await loadOverview();
    ['buildings','research','shipyard'].forEach(id => WM.refresh(id));
  }, 30000);

  // ── Boot: load data, open overview ───────────────────────
  await loadOverview();
  WM.open('overview');
})();
