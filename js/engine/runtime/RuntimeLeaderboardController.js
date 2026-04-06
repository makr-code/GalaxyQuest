'use strict';
(function () {
  function createLeaderboardController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const esc = opts.esc || ((value) => String(value ?? ''));
    const fmt = opts.fmt || ((value) => String(value ?? ''));
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const getCurrentUser = typeof opts.getCurrentUser === 'function' ? opts.getCurrentUser : (() => null);

    class LeaderboardController {
      async render() {
        const root = wm.body('leaderboard');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();
        try {
          const data = await api.leaderboard();
          if (!data.success) {
            root.innerHTML = '<p class="text-red">Error.</p>';
            return;
          }
          if (!data.leaderboard.length) {
            root.innerHTML = uiKitEmptyStateHTML('No players yet', 'Leaderboard will populate as commanders expand their empires.');
            return;
          }

          const currentUser = getCurrentUser() || {};
          root.innerHTML = data.leaderboard.map((row, index) => `
            <div class="lb-row">
              <span class="lb-rank">${index + 1}</span>
              <span class="lb-name">${esc(row.username)} ${row.username === currentUser.username ? '(You)' : ''}${row.alliance_tag ? ` <span class="lb-alliance-tag">[${esc(row.alliance_tag)}]</span>` : ''}</span>
              <span class="lb-stat">RP ${fmt(row.rank_points)}</span>
              <span class="lb-stat">PLANETS ${row.planet_count}</span>
              <span class="lb-stat">DM ${fmt(row.dark_matter)}</span>
            </div>`).join('');
        } catch (err) {
          gameLog('warn', 'Leaderboard laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load leaderboard.</p>';
        }
      }
    }

    return new LeaderboardController();
  }

  const api = { createLeaderboardController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeLeaderboardController = api;
  }
})();
