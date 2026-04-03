'use strict';

(function () {
  const AUDIO_TRACK_OPTIONS_FALLBACK = [
    { value: 'music/Nebula_Overture.mp3', label: 'Nebula Overture' },
  ];

  const AUDIO_SFX_OPTIONS = [
    { value: 'sfx/mixkit-video-game-retro-click-237.wav', label: 'Retro Click' },
    { value: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav', label: 'Positive Notification' },
    { value: 'sfx/mixkit-negative-game-notification-249.wav', label: 'Negative Notification' },
    { value: 'sfx/mixkit-sci-fi-positive-notification-266.wav', label: 'Sci-Fi Positive Notification' },
    { value: 'sfx/mixkit-sci-fi-warp-slide-3113.wav', label: 'Sci-Fi Warp Slide' },
    { value: 'sfx/mixkit-unlock-new-item-game-notification-254.wav', label: 'Unlock New Item' },
    { value: 'sfx/mixkit-casino-bling-achievement-2067.wav', label: 'Achievement Bling' },
    { value: 'sfx/mixkit-space-shot-whoosh-3001.wav', label: 'Space Shot Whoosh' },
    { value: 'sfx/mixkit-space-coin-win-notification-271.wav', label: 'Space Coin Win' },
    { value: 'sfx/mixkit-falling-hit-757.wav', label: 'Falling Hit' },
    { value: 'sfx/mixkit-horn-suspense-transition-3112.wav', label: 'Horn Suspense Transition' },
    { value: 'sfx/mixkit-laser-gun-shot-3110.wav', label: 'Laser Gun Shot' },
    { value: 'sfx/mixkit-night-vision-starting-2476.wav', label: 'Night Vision Start' },
    { value: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav', label: 'Fanfare Announcement' },
    { value: 'sfx/mixkit-space-plasma-shot-3002.wav', label: 'Space Plasma Shot' },
    { value: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav', label: 'Bonus Earned' },
    { value: 'sfx/mixkit-space-deploy-whizz-3003.wav', label: 'Space Deploy Whizz' },
    { value: 'sfx/mixkit-sci-fi-laser-in-space-sound-2825.wav', label: 'Sci-Fi Laser' },
    { value: 'sfx/mixkit-space-plasma-shot-3002.wav', label: 'Space Plasma Shot' },
    { value: 'sfx/mixkit-space-shot-whoosh-3001.wav', label: 'Space Shot Whoosh' },
    { value: 'sfx/mixkit-unlock-new-item-game-notification-254.wav', label: 'Unlock New Item' },
    { value: 'sfx/mixkit-space-coin-win-notification-271.wav', label: 'Space Coin Win' },
    { value: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav', label: 'Fanfare Announcement' },
    { value: 'sfx/mixkit-laser-gun-shot-3110.wav', label: 'Laser Gun Shot' },
    { value: 'sfx/mixkit-short-laser-gun-shot-1670.wav', label: 'Short Laser Shot' },
  ];

  const AUDIO_SFX_EVENTS = [
    { key: 'uiClick', label: 'UI Click', tester: 'playUiClick' },
    { key: 'uiConfirm', label: 'UI Confirm', tester: 'playUiConfirm' },
    { key: 'uiError', label: 'UI Error', tester: 'playUiError' },
    { key: 'uiNotify', label: 'UI Notify', tester: 'playUiNotify' },
    { key: 'navigation', label: 'Navigation', tester: 'playNavigation' },
    { key: 'pvpToggle', label: 'PvP Toggle', tester: 'playPvpToggle' },
    { key: 'researchStart', label: 'Research Start', tester: 'playResearchStart' },
    { key: 'researchComplete', label: 'Research Complete', tester: 'playResearchComplete' },
    { key: 'fleetRecall', label: 'Fleet Recall', tester: 'playFleetRecall' },
    { key: 'messageSend', label: 'Message Send', tester: 'playMessageSend' },
    { key: 'messageRead', label: 'Message Read', tester: 'playMessageRead' },
    { key: 'messageDelete', label: 'Message Delete', tester: 'playMessageDelete' },
    { key: 'fleetAttack', label: 'Fleet Attack', tester: 'playFleetAttack' },
    { key: 'fleetTransport', label: 'Fleet Transport', tester: 'playFleetTransport' },
    { key: 'fleetSpy', label: 'Fleet Spy', tester: 'playFleetSpy' },
    { key: 'fleetColonize', label: 'Fleet Colonize', tester: 'playFleetColonize' },
    { key: 'fleetHarvest', label: 'Fleet Harvest', tester: 'playFleetHarvest' },
    { key: 'buildComplete', label: 'Build Complete', tester: 'playBuildComplete' },
    { key: 'fleetLaunch', label: 'Fleet Launch', tester: 'playFleetLaunch' },
  ];

  function cloneRows(rows) {
    return rows.map((row) => ({ ...row }));
  }

  const api = {
    getAudioTrackOptionsFallback() {
      return cloneRows(AUDIO_TRACK_OPTIONS_FALLBACK);
    },
    getAudioSfxOptions() {
      return cloneRows(AUDIO_SFX_OPTIONS);
    },
    getAudioSfxEvents() {
      return cloneRows(AUDIO_SFX_EVENTS);
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeAudioSettingsMetadata = api;
  }
})();