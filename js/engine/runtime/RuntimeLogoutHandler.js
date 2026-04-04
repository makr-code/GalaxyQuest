/**
 * RuntimeLogoutHandler.js
 *
 * Binds logout button behavior with graceful API logout and fallback redirect.
 */
(function () {
  function bindLogoutHandler({
    documentRef,
    audioManager,
    api,
    gameLog,
    localStorageRef,
    sessionStorageRef,
    windowRef,
  }) {
    documentRef.getElementById('logout-btn')?.addEventListener('click', async () => {
      if (audioManager) audioManager.playUiClick();

      // Attempt graceful logout
      try {
        const res = await api.logout();
        if (res && res.success) {
          // Clear session-related storage
          try {
            localStorageRef.clear();
            sessionStorageRef.clear();
          } catch (err) {
            gameLog('info', 'Session-Storage cleanup im Logout fehlgeschlagen', err);
          }

          // Close EventSource if active
          if (typeof windowRef.__gqSSE !== 'undefined' && windowRef.__gqSSE?.close) {
            try {
              windowRef.__gqSSE.close();
            } catch (err) {
              gameLog('info', 'SSE close im Logout-Cleanup fehlgeschlagen', err);
            }
          }

          // Hard redirect after brief delay to ensure cookies are sent
          setTimeout(() => {
            windowRef.location.href = 'index.html?logout=1&nocache=' + Date.now();
          }, 200);
          return;
        }
      } catch (err) {
        gameLog('warn', 'API logout fehlgeschlagen, fallback redirect aktiv', err);
      }

      // Fallback: redirect immediately if logout failed
      windowRef.location.href = 'index.html?logout=1&nocache=' + Date.now();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bindLogoutHandler };
  } else {
    window.GQRuntimeLogoutHandler = { bindLogoutHandler };
  }
})();
