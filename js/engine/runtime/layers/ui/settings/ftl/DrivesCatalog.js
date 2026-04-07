/**
 * DrivesCatalog.js
 *
 * Static FTL drive catalog for settings rendering.
 */

'use strict';

(function () {
  const FTL_DRIVES = [
    { id: 'aereth', name: "Aereth — Alcubierre Warp", desc: "+50% Kern — -30% Rand" },
    { id: 'vor_tak', name: "Vor'Tak — K-F Jump Drive", desc: "30 LY — 72h Cooldown — Carrier+30%" },
    { id: 'syl_nar', name: "Syl'Nar — Resonance Gates", desc: "Instant via Gate-Netz" },
    { id: 'vel_ar', name: "Vel'Ar — Blind Quantum Jump", desc: "Instant — 0.5% Scatter — Stealth 60s" },
    { id: 'zhareen', name: "Zhareen — Crystal Channel", desc: "Survey-Nodes — 30min CD" },
    { id: 'kryl_tha', name: "Kryl'Tha — Swarm Tunnel", desc: "Max 50 Schiffe — -10% Hülle" },
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
