/**
 * VisualUtils.js
 *
 * Small visual utility helpers used by galaxy/system UI rendering.
 */

'use strict';

(function () {
  function starClassColor(spectralClass) {
    const cls = String(spectralClass || '').toUpperCase();
    const colors = {
      O: '#9bb0ff',
      B: '#aabfff',
      A: '#cad7ff',
      F: '#f8f7ff',
      G: '#fff4ea',
      K: '#ffd2a1',
      M: '#ffcc6f',
    };
    return colors[cls] || '#d8e6ff';
  }

  function planetIcon(planetClass) {
    const cls = String(planetClass || '').toLowerCase();
    if (cls.includes('gas')) return 'GAS';
    if (cls.includes('ice') || cls.includes('frozen')) return 'ICE';
    if (cls.includes('lava') || cls.includes('volcan')) return 'LAV';
    if (cls.includes('ocean')) return 'OCN';
    if (cls.includes('desert')) return 'DES';
    if (cls.includes('terra') || cls.includes('hab')) return 'TER';
    if (cls.includes('toxic')) return 'TOX';
    return 'PLN';
  }

  const api = {
    starClassColor,
    planetIcon,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyVisualUtils = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
