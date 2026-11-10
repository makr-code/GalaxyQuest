'use strict';
(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createLeaderboardController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
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
              <span class="lb-name">${escapeHtml(row.username)} ${row.username === currentUser.username ? '(You)' : ''}${row.alliance_tag ? ` <span class="lb-alliance-tag">[${escapeHtml(row.alliance_tag)}]</span>` : ''}</span>
              <span class="lb-stat">RP ${escapeHtml(fmt(row.rank_points))}</span>
              <span class="lb-stat">PLANETS ${escapeHtml(row.planet_count)}</span>
              <span class="lb-stat">DM ${escapeHtml(fmt(row.dark_matter))}</span>
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
