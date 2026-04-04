/**
 * RuntimeSettingsFtlDrivesCatalog.js
 *
 * Static FTL drive catalog for settings rendering.
 */

'use strict';

(function () {
  const FTL_DRIVES = [
    { id: 'aereth', name: "Aereth ÔÇö Alcubierre Warp", desc: "+50% Kern ┬À -30% Rand" },
    { id: 'vor_tak', name: "Vor'Tak ÔÇö K-F Jump Drive", desc: "30 LY ┬À 72h Cooldown ┬À Carrier+30%" },
    { id: 'syl_nar', name: "Syl'Nar ÔÇö Resonance Gates", desc: "Instant via Gate-Netz" },
    { id: 'vel_ar', name: "Vel'Ar ÔÇö Blind Quantum Jump", desc: "Instant ┬À 0.5% Scatter ┬À Stealth 60s" },
    { id: 'zhareen', name: "Zhareen ÔÇö Crystal Channel", desc: "Survey-Nodes ┬À 30min CD" },
    { id: 'kryl_tha', name: "Kryl'Tha ÔÇö Swarm Tunnel", desc: "Max 50 Schiffe ┬À -10% H├╝lle" },
  ];

  function getFtlDrives() {
    return FTL_DRIVES.slice();
  }

  const api = {
    getFtlDrives,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsFtlDrivesCatalog = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
