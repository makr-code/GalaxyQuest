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
    if (r.status === 401) { window.location.href = 'index.html'; throw new Error('Not authenticated'); }
    return r.json();
  }

  async function post(endpoint, body) {
    const csrf = await _csrf();
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    });
    if (r.status === 401) { window.location.href = 'index.html'; throw new Error('Not authenticated'); }
    return r.json();
  }

  return {
    // Auth
    me:     () => get('api/auth.php?action=me'),
    logout: () => post('api/auth.php?action=logout', {}),

    // Game overview
    overview:    ()    => get('api/game.php?action=overview'),
    resources:   (cid) => get(`api/game.php?action=resources&colony_id=${cid}`),
    leaderboard: ()    => get('api/game.php?action=leaderboard'),
    renameColony:  (cid, name) => post('api/game.php?action=rename_colony',   { colony_id: cid, name }),
    setColonyType: (cid, type) => post('api/game.php?action=set_colony_type', { colony_id: cid, colony_type: type }),

    // Buildings
    buildings:     (cid)        => get(`api/buildings.php?action=list&colony_id=${cid}`),
    upgrade:       (cid, type)  => post('api/buildings.php?action=upgrade', { colony_id: cid, type }),
    finishBuilding:(cid)        => post('api/buildings.php?action=finish',  { colony_id: cid }),

    // Research
    research:      (cid)        => get(`api/research.php?action=list&colony_id=${cid}`),
    doResearch:    (cid, type)  => post('api/research.php?action=research', { colony_id: cid, type }),
    finishResearch:()           => post('api/research.php?action=finish', {}),

    // Shipyard
    ships:    (cid)              => get(`api/shipyard.php?action=list&colony_id=${cid}`),
    buildShip:(cid, type, count) => post('api/shipyard.php?action=build', { colony_id: cid, type, count }),

    // Fleet
    fleets:     ()        => get('api/fleet.php?action=list'),
    sendFleet:  (payload) => post('api/fleet.php?action=send', payload),
    recallFleet:(id)      => post('api/fleet.php?action=recall', { fleet_id: id }),

    // Galaxy
    galaxy: (g, s) => get(`api/galaxy.php?galaxy=${g}&system=${s}`),

    // Achievements / quests
    achievements:    ()    => get('api/achievements.php?action=list'),
    claimAchievement:(id)  => post('api/achievements.php?action=claim', { achievement_id: id }),

    // PvP
    togglePvp: () => post('api/game.php?action=pvp_toggle', {}),

    // Leaders
    leaders:        ()                      => get('api/leaders.php?action=list'),
    hireLeader:     (name, role)            => post('api/leaders.php?action=hire',     { name, role }),
    assignLeader:   (lid, cid, fid)         => post('api/leaders.php?action=assign',   { leader_id: lid, colony_id: cid ?? undefined, fleet_id: fid ?? undefined }),
    setAutonomy:    (lid, autonomy)         => post('api/leaders.php?action=autonomy', { leader_id: lid, autonomy }),
    dismissLeader:  (lid)                   => post('api/leaders.php?action=dismiss',  { leader_id: lid }),
    aiTick:         ()                      => post('api/leaders.php?action=ai_tick',  {}),

    // Messages
    inbox:    ()               => get('api/messages.php?action=inbox'),
    readMsg:  (id)             => get(`api/messages.php?action=read&id=${id}`),
    sendMsg:  (to, sub, body)  => post('api/messages.php?action=send', { to_username: to, subject: sub, body }),
    deleteMsg:(id)             => post('api/messages.php?action=delete', { id }),
  };
})();
