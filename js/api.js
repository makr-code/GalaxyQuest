/**
 * Thin API wrapper for the game frontend.
 * All requests automatically attach the CSRF token from the session.
 */
const API = (() => {
  let _csrfToken = null;

  async function _csrf() {
    if (!_csrfToken) {
      const r = await fetch('api/auth.php?action=csrf');
      const d = await r.json();
      _csrfToken = d.token;
    }
    return _csrfToken;
  }

  async function get(endpoint) {
    const r = await fetch(endpoint);
    if (r.status === 401) {
      window.location.href = 'index.html';
      throw new Error('Not authenticated');
    }
    return r.json();
  }

  async function post(endpoint, body) {
    const csrf = await _csrf();
    const r = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify(body),
    });
    if (r.status === 401) {
      window.location.href = 'index.html';
      throw new Error('Not authenticated');
    }
    return r.json();
  }

  return {
    // Auth
    me:       ()        => get('api/auth.php?action=me'),
    logout:   ()        => post('api/auth.php?action=logout', {}),

    // Game overview
    overview: ()        => get('api/game.php?action=overview'),
    resources:(pid)     => get(`api/game.php?action=resources&planet_id=${pid}`),
    leaderboard:()      => get('api/game.php?action=leaderboard'),

    // Buildings
    buildings:(pid)     => get(`api/buildings.php?action=list&planet_id=${pid}`),
    upgrade:  (pid, type) => post('api/buildings.php?action=upgrade', { planet_id: pid, type }),
    finishBuilding:(pid)  => post('api/buildings.php?action=finish', { planet_id: pid }),

    // Research
    research: (pid)     => get(`api/research.php?action=list&planet_id=${pid}`),
    doResearch:(pid, type) => post('api/research.php?action=research', { planet_id: pid, type }),
    finishResearch:()   => post('api/research.php?action=finish', {}),

    // Shipyard
    ships:    (pid)     => get(`api/shipyard.php?action=list&planet_id=${pid}`),
    buildShip:(pid, type, count) =>
                           post('api/shipyard.php?action=build', { planet_id: pid, type, count }),

    // Fleet
    fleets:   ()        => get('api/fleet.php?action=list'),
    sendFleet:(payload) => post('api/fleet.php?action=send', payload),
    recallFleet:(id)    => post('api/fleet.php?action=recall', { fleet_id: id }),

    // Galaxy
    galaxy:   (g, s)    => get(`api/galaxy.php?galaxy=${g}&system=${s}`),

    // Achievements / quests
    achievements:   ()    => get('api/achievements.php?action=list'),
    claimAchievement:(id) => post('api/achievements.php?action=claim', { achievement_id: id }),
    checkAchievements:()  => post('api/achievements.php?action=check', {}),

    // PvP toggle
    togglePvp: ()         => post('api/game.php?action=pvp_toggle', {}),

    // Messages
    inbox:    ()        => get('api/messages.php?action=inbox'),
    readMsg:  (id)      => get(`api/messages.php?action=read&id=${id}`),
    sendMsg:  (to, subject, body) =>
                           post('api/messages.php?action=send', { to_username: to, subject, body }),
    deleteMsg:(id)      => post('api/messages.php?action=delete', { id }),
  };
})();
