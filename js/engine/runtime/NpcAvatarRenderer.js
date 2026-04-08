'use strict';
/**
 * NpcAvatarRenderer
 *
 * Renders a faction-specific NPC bust (head + torso) in a WebGL canvas using
 * Three.js procedural geometry. Falls back to a portrait PNG, and finally to a
 * CSS-only placeholder, when WebGL is unavailable or the portrait is missing.
 *
 * Usage
 * -----
 *   const renderer = new NpcAvatarRenderer({
 *     factionCode:  'vor_tak',
 *     factionColor: '#2d5a1b',
 *     npcName:      "General Drak'Mol",
 *     npcGender:    'männlich',
 *     portraitUrl:  null,          // resolved automatically if null
 *     windowRef:    window,
 *   });
 *   renderer.mount(document.getElementById('npc-chat-avatar'));
 *   // … later …
 *   renderer.setTalking(true);
 *   renderer.setExpression('hostile');
 *   renderer.destroy();
 *
 * Fallback chain
 * -----
 *   1. WebGL Three.js 3D bust (primary)
 *   2. <img> with portrait PNG  (gfx/portraits/{Faction}_{NpcSlug}_{g}.png)
 *   3. Colored <div> with faction icon + NPC initials (pure CSS, always works)
 */
(function () {

  // ─── Portrait URL helpers ──────────────────────────────────────────────────

  /**
   * Convert a raw name to PascalCase token used in portrait filenames.
   * e.g. "General Drak'Mol" → "DrakMol", "Sol'Kaar" → "SolKaar"
   */
  function _nameToPascal(raw) {
    return String(raw || '')
      .replace(/['''`]/g, '')   // strip apostrophes
      .replace(/[^a-zA-ZäöüÄÖÜ0-9 ]/g, '') // strip other punctuation
      .split(/\s+/)
      .filter(Boolean)
      // Remove generic honorifics/titles so we get the surname/key name
      .filter((w) => !/^(General|Admiral|Stratega|Veteran|Seherin|Schmiedelehrmeisterin|Exil|Hohepriesterin|Direktor|Kommandantin|Archivar|Architektin|Segmentklinge)$/.test(w))
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  /**
   * Derive the conventional portrait PNG path for an NPC.
   *   gfx/portraits/{FactionPascal}_{NpcPascal}_{g}.png
   * Gender char: 'm' (männlich), 'f' (weiblich), 'n' (neutral/unknown)
   */
  function resolvePortraitUrl(factionCode, npcName, npcGender) {
    const factionPart = (factionCode || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
    const npcPart     = _nameToPascal(npcName) || 'Unknown';
    const genderChar  = String(npcGender || '').toLowerCase().startsWith('w') ? 'f'
      : String(npcGender || '').toLowerCase().startsWith('f') ? 'f'
        : 'm';
    return `gfx/portraits/${factionPart}_${npcPart}_${genderChar}.png`;
  }

  // ─── Faction bust factory ──────────────────────────────────────────────────

  /**
   * Returns a THREE.Group (head + torso bust) for the given faction.
   * Each faction has a distinctive silhouette and color palette.
   *
   * @param {object} THREE  - The Three.js namespace
   * @param {string} factionCode
   * @param {string} factionColor  - Hex CSS color string
   * @returns {{ bust: THREE.Group, headMesh: THREE.Mesh, torsoMesh: THREE.Mesh }}
   */
  function buildFactionBust(THREE, factionCode, factionColor) {
    const accentColor = new THREE.Color(factionColor);
    const darkColor   = accentColor.clone().multiplyScalar(0.4);

    function mat(color, opts = {}) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: opts.roughness ?? 0.7,
        metalness: opts.metalness ?? 0.2,
        emissive:  opts.emissive ? new THREE.Color(opts.emissive) : undefined,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
      });
    }

    function mesh(geo, m) { return new THREE.Mesh(geo, m); }

    const group = new THREE.Group();
    let headMesh, torsoMesh;

    switch (factionCode) {

      // ── Vor'Tak: angular reptilian, bone ridges, dark green/bronze ───────
      case 'vor_tak': {
        const headGeo = new THREE.BoxGeometry(0.88, 1.0, 0.78);
        headMesh = mesh(headGeo, mat('#2d5a1b', { metalness: 0.1 }));
        headMesh.position.set(0, 0.55, 0);
        group.add(headMesh);
        // brow ridge
        const browGeo = new THREE.BoxGeometry(1.0, 0.16, 0.5);
        const brow = mesh(browGeo, mat('#1a3a10'));
        brow.position.set(0, 0.47, 0.2);
        headMesh.add(brow);
        // bone plate top
        const plateGeo = new THREE.BoxGeometry(0.72, 0.28, 0.22);
        const plate = mesh(plateGeo, mat('#8b6914', { metalness: 0.3 }));
        plate.position.set(0, 0.64, 0);
        headMesh.add(plate);
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.22, 0.28, 0.32, 8);
        const neck = mesh(neckGeo, mat('#2d5a1b'));
        neck.position.set(0, 0.12, 0);
        group.add(neck);
        // torso
        const torsoGeo = new THREE.BoxGeometry(1.35, 0.95, 0.62);
        torsoMesh = mesh(torsoGeo, mat('#1a3a10', { metalness: 0.25 }));
        torsoMesh.position.set(0, -0.52, 0);
        group.add(torsoMesh);
        // shoulder pads
        [-1, 1].forEach((side) => {
          const sGeo = new THREE.BoxGeometry(0.38, 0.22, 0.54);
          const s = mesh(sGeo, mat('#8b6914', { metalness: 0.35 }));
          s.position.set(side * 0.8, 0.02, 0);
          torsoMesh.add(s);
        });
        break;
      }

      // ── Kryl'Tha: insectoid, chitinous, orange-brown ─────────────────────
      case 'kryl_tha': {
        const headGeo = new THREE.SphereGeometry(0.52, 12, 10);
        headMesh = mesh(headGeo, mat('#7a3010', { roughness: 0.5, metalness: 0.3 }));
        headMesh.scale.set(0.88, 1.38, 0.82);
        headMesh.position.set(0, 0.6, 0);
        group.add(headMesh);
        // mandibles
        [-1, 1].forEach((side) => {
          const mGeo = new THREE.ConeGeometry(0.06, 0.38, 6);
          const m = mesh(mGeo, mat('#5a2008'));
          m.rotation.z = side * 0.55;
          m.rotation.x = 0.4;
          m.position.set(side * 0.28, -0.3, 0.3);
          headMesh.add(m);
        });
        // compound eyes (hemispheres)
        [-1, 1].forEach((side) => {
          const eGeo = new THREE.SphereGeometry(0.12, 8, 8, 0, Math.PI);
          const e = mesh(eGeo, mat('#ff6600', { emissive: '#ff4400', emissiveIntensity: 0.6, roughness: 0.2 }));
          e.position.set(side * 0.28, 0.18, 0.42);
          headMesh.add(e);
        });
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.15, 0.22, 0.3, 8);
        const neck = mesh(neckGeo, mat('#5a2008'));
        neck.position.set(0, 0.08, 0);
        group.add(neck);
        // torso (compressed sphere = thorax)
        const torsoGeo = new THREE.SphereGeometry(0.62, 10, 8);
        torsoMesh = mesh(torsoGeo, mat('#6a2808', { roughness: 0.45, metalness: 0.35 }));
        torsoMesh.scale.set(1.1, 0.72, 0.88);
        torsoMesh.position.set(0, -0.5, 0);
        group.add(torsoMesh);
        break;
      }

      // ── Aereth: crystalline energy being, glowing blue-white ─────────────
      case 'aereth': {
        const headGeo = new THREE.OctahedronGeometry(0.54, 1);
        headMesh = mesh(headGeo, mat('#4ae8ff', { roughness: 0.1, metalness: 0.4, emissive: '#0088cc', emissiveIntensity: 0.5 }));
        headMesh.position.set(0, 0.55, 0);
        group.add(headMesh);
        // crystal shards (face features)
        [[0.2, 0.06, 0.48, 0.1, 'eye'], [-0.2, 0.06, 0.48, 0.1, 'eye'], [0, -0.18, 0.52, 0.08, 'mouth']].forEach(([x, y, z, r, _]) => {
          const cGeo = new THREE.OctahedronGeometry(r, 0);
          const c = mesh(cGeo, mat('#ffffff', { emissive: '#88eeff', emissiveIntensity: 0.8, roughness: 0.05 }));
          c.position.set(x, y, z);
          headMesh.add(c);
        });
        // neck (energy column)
        const neckGeo = new THREE.CylinderGeometry(0.1, 0.14, 0.3, 6);
        const neck = mesh(neckGeo, mat('#4ae8ff', { emissive: '#4ae8ff', emissiveIntensity: 0.4 }));
        neck.position.set(0, 0.1, 0);
        group.add(neck);
        // torso (larger octahedron, compressed)
        const torsoGeo = new THREE.OctahedronGeometry(0.68, 1);
        torsoMesh = mesh(torsoGeo, mat('#2a90cc', { roughness: 0.15, metalness: 0.5, emissive: '#0055aa', emissiveIntensity: 0.3 }));
        torsoMesh.scale.set(1.15, 0.72, 0.8);
        torsoMesh.position.set(0, -0.5, 0);
        group.add(torsoMesh);
        break;
      }

      // ── Syl'Nar: tall graceful bioluminescent, deep purple ───────────────
      case 'syl_nar': {
        const headGeo = new THREE.SphereGeometry(0.44, 14, 12);
        headMesh = mesh(headGeo, mat('#4a1070', { roughness: 0.6 }));
        headMesh.scale.set(0.72, 1.38, 0.72);
        headMesh.position.set(0, 0.6, 0);
        group.add(headMesh);
        // bioluminescent tendrils
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2 - 0.4;
          const tGeo = new THREE.CylinderGeometry(0.025, 0.004, 0.38, 5);
          const t = mesh(tGeo, mat('#00b4d8', { emissive: '#00b4d8', emissiveIntensity: 0.9, roughness: 0.2 }));
          t.position.set(Math.sin(angle) * 0.28, -0.42, Math.cos(angle) * 0.18);
          t.rotation.z = (Math.random() - 0.5) * 0.3;
          headMesh.add(t);
        }
        // neck (very slender)
        const neckGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.52, 8);
        const neck = mesh(neckGeo, mat('#3a0860'));
        neck.position.set(0, 0.08, 0);
        group.add(neck);
        // torso (narrow, tall)
        const torsoGeo = new THREE.BoxGeometry(0.85, 1.05, 0.48);
        torsoMesh = mesh(torsoGeo, mat('#3a0860'));
        torsoMesh.position.set(0, -0.6, 0);
        group.add(torsoMesh);
        // glowing robe pattern lines
        const lineGeo = new THREE.BoxGeometry(0.82, 0.03, 0.5);
        [0.2, 0, -0.2].forEach((y) => {
          const line = mesh(lineGeo, mat('#00b4d8', { emissive: '#00b4d8', emissiveIntensity: 0.7 }));
          line.position.y = y;
          torsoMesh.add(line);
        });
        break;
      }

      // ── Vel'Ar: avian, beaked, feathered crest, gold-amber ───────────────
      case 'vel_ar': {
        headMesh = new THREE.Group();
        headMesh.position.set(0, 0.55, 0);
        group.add(headMesh);
        // head sphere
        const headGeo = new THREE.SphereGeometry(0.44, 12, 10);
        const headSph = mesh(headGeo, mat('#c8860e', { metalness: 0.15 }));
        headMesh.add(headSph);
        // beak
        const beakGeo = new THREE.ConeGeometry(0.1, 0.52, 8);
        const beak = mesh(beakGeo, mat('#ffd54f', { roughness: 0.5 }));
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, -0.04, 0.52);
        headMesh.add(beak);
        // crest feathers
        for (let i = 0; i < 4; i++) {
          const cGeo = new THREE.BoxGeometry(0.06, 0.28, 0.04);
          const c = mesh(cGeo, mat('#1a237e'));
          c.position.set((i - 1.5) * 0.14, 0.56, 0);
          c.rotation.z = (i - 1.5) * 0.12;
          headMesh.add(c);
        }
        // eyes
        [-1, 1].forEach((s) => {
          const eGeo = new THREE.SphereGeometry(0.07, 8, 8);
          const e = mesh(eGeo, mat('#1a237e', { roughness: 0.1 }));
          e.position.set(s * 0.3, 0.08, 0.36);
          headMesh.add(e);
        });
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.32, 8);
        const neck = mesh(neckGeo, mat('#a87010'));
        neck.position.set(0, 0.1, 0);
        group.add(neck);
        // torso (bird chest — slightly rounded box)
        const torsoGeo = new THREE.SphereGeometry(0.6, 10, 8);
        torsoMesh = mesh(torsoGeo, mat('#c8860e'));
        torsoMesh.scale.set(1.12, 0.88, 0.85);
        torsoMesh.position.set(0, -0.48, 0);
        group.add(torsoMesh);
        break;
      }

      // ── Genesis Kollektiv: biomechanical humanoid, grey/cyan tech ─────────
      case 'genesis_kollektiv': {
        const headGeo = new THREE.SphereGeometry(0.44, 14, 12);
        headMesh = mesh(headGeo, mat('#8a9aaa', { roughness: 0.4, metalness: 0.5 }));
        headMesh.position.set(0, 0.54, 0);
        group.add(headMesh);
        // tech implants on temples
        [-1, 1].forEach((s) => {
          const iGeo = new THREE.BoxGeometry(0.14, 0.22, 0.08);
          const imp = mesh(iGeo, mat('#00bcd4', { emissive: '#00bcd4', emissiveIntensity: 0.6, metalness: 0.7 }));
          imp.position.set(s * 0.45, 0.08, 0.1);
          headMesh.add(imp);
        });
        // visor/optical band
        const visorGeo = new THREE.BoxGeometry(0.78, 0.11, 0.12);
        const visor = mesh(visorGeo, mat('#00e5ff', { emissive: '#00bcd4', emissiveIntensity: 0.8, roughness: 0.05 }));
        visor.position.set(0, 0.1, 0.42);
        headMesh.add(visor);
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.19, 0.24, 0.3, 8);
        const neck = mesh(neckGeo, mat('#6a7a8a', { metalness: 0.6 }));
        neck.position.set(0, 0.1, 0);
        group.add(neck);
        // torso (blocky armor)
        const torsoGeo = new THREE.BoxGeometry(1.18, 0.92, 0.58);
        torsoMesh = mesh(torsoGeo, mat('#5a6a7a', { metalness: 0.6, roughness: 0.35 }));
        torsoMesh.position.set(0, -0.51, 0);
        group.add(torsoMesh);
        // chest panel lines
        const panelGeo = new THREE.BoxGeometry(0.5, 0.38, 0.08);
        const panel = mesh(panelGeo, mat('#003344', { emissive: '#00bcd4', emissiveIntensity: 0.3 }));
        panel.position.set(0, 0.1, 0.32);
        torsoMesh.add(panel);
        break;
      }

      // ── Zhareen: amphibian scholars, smooth, wide-set eyes, dark teal ─────
      case 'zhareen': {
        const headGeo = new THREE.SphereGeometry(0.5, 14, 12);
        headMesh = mesh(headGeo, mat('#1a6b5a', { roughness: 0.8 }));
        headMesh.scale.set(1.18, 1.0, 0.9);
        headMesh.position.set(0, 0.52, 0);
        group.add(headMesh);
        // wide-set eyes
        [-1, 1].forEach((s) => {
          const eGeo = new THREE.SphereGeometry(0.1, 8, 8);
          const e = mesh(eGeo, mat('#d4af37', { roughness: 0.15, emissive: '#c8a020', emissiveIntensity: 0.4 }));
          e.position.set(s * 0.42, 0.12, 0.38);
          headMesh.add(e);
          // pupil slit
          const pGeo = new THREE.BoxGeometry(0.02, 0.12, 0.04);
          const p = mesh(pGeo, mat('#000000'));
          p.position.set(0, 0, 0.09);
          e.add(p);
        });
        // lateral fin/line
        [-1, 1].forEach((s) => {
          const fGeo = new THREE.BoxGeometry(0.06, 0.42, 0.55);
          const f = mesh(fGeo, mat('#0d4f40'));
          f.position.set(s * 0.52, 0, -0.06);
          headMesh.add(f);
        });
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.3, 8);
        const neck = mesh(neckGeo, mat('#155040'));
        neck.position.set(0, 0.08, 0);
        group.add(neck);
        // torso
        const torsoGeo = new THREE.SphereGeometry(0.62, 10, 8);
        torsoMesh = mesh(torsoGeo, mat('#155040'));
        torsoMesh.scale.set(1.1, 0.8, 0.85);
        torsoMesh.position.set(0, -0.49, 0);
        group.add(torsoMesh);
        break;
      }

      // ── Iron Fleet: human military/naval, steel grey, rank insignia ───────
      case 'iron_fleet': {
        const headGeo = new THREE.SphereGeometry(0.43, 14, 12);
        headMesh = mesh(headGeo, mat('#e8d5b0', { roughness: 0.75 })); // human skin tone
        headMesh.position.set(0, 0.54, 0);
        group.add(headMesh);
        // ears
        [-1, 1].forEach((s) => {
          const eGeo = new THREE.SphereGeometry(0.1, 8, 6);
          const e = mesh(eGeo, mat('#d4c0a0', { roughness: 0.8 }));
          e.scale.set(0.4, 0.6, 0.3);
          e.position.set(s * 0.43, 0.04, 0);
          headMesh.add(e);
        });
        // military collar
        const collarGeo = new THREE.CylinderGeometry(0.34, 0.38, 0.22, 12);
        const collar = mesh(collarGeo, mat('#1a237e', { metalness: 0.3 }));
        collar.position.set(0, 0.14, 0);
        group.add(collar);
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.22, 8);
        const neck = mesh(neckGeo, mat('#d4c0a0'));
        neck.position.set(0, 0.12, 0);
        group.add(neck);
        // torso (uniform)
        const torsoGeo = new THREE.BoxGeometry(1.2, 0.95, 0.58);
        torsoMesh = mesh(torsoGeo, mat('#1a237e', { roughness: 0.55 }));
        torsoMesh.position.set(0, -0.51, 0);
        group.add(torsoMesh);
        // rank stripe
        const stripeGeo = new THREE.BoxGeometry(0.14, 0.04, 0.3);
        [0.18, 0.25, 0.32].forEach((x) => {
          const s = mesh(stripeGeo, mat('#d4af37', { metalness: 0.6 }));
          s.position.set(x, 0.3, 0.3);
          torsoMesh.add(s);
        });
        break;
      }

      // ── Schattenkompakt: shadow operatives, near-black, purple glow ───────
      case 'schattenkompakt': {
        const headGeo = new THREE.SphereGeometry(0.44, 12, 10);
        headMesh = mesh(headGeo, mat('#1a1a2e', { roughness: 0.9 }));
        headMesh.position.set(0, 0.54, 0);
        group.add(headMesh);
        // glowing eyes (the only visible features)
        [-1, 1].forEach((s) => {
          const eGeo = new THREE.SphereGeometry(0.075, 8, 8);
          const e = mesh(eGeo, mat('#7b2fbe', { emissive: '#9b3fe0', emissiveIntensity: 1.0, roughness: 0.05 }));
          e.position.set(s * 0.2, 0.06, 0.4);
          headMesh.add(e);
        });
        // hood rim
        const hoodGeo = new THREE.TorusGeometry(0.52, 0.05, 8, 16, Math.PI * 1.5);
        const hood = mesh(hoodGeo, mat('#2a0a3e', { roughness: 0.9 }));
        hood.position.set(0, 0.28, 0);
        hood.rotation.x = 0.4;
        headMesh.add(hood);
        // neck
        const neckGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.3, 8);
        const neck = mesh(neckGeo, mat('#0e0e1c'));
        neck.position.set(0, 0.1, 0);
        group.add(neck);
        // torso (cloak shape)
        const torsoGeo = new THREE.BoxGeometry(1.08, 1.02, 0.52);
        torsoMesh = mesh(torsoGeo, mat('#0e0e1c', { roughness: 0.95 }));
        torsoMesh.position.set(0, -0.55, 0);
        group.add(torsoMesh);
        // subtle purple trim line
        const trimGeo = new THREE.BoxGeometry(1.08, 0.02, 0.54);
        [0.2, -0.2].forEach((y) => {
          const t = mesh(trimGeo, mat('#7b2fbe', { emissive: '#7b2fbe', emissiveIntensity: 0.5 }));
          t.position.y = y;
          torsoMesh.add(t);
        });
        break;
      }

      // ── Default / generic ─────────────────────────────────────────────────
      default: {
        const headGeo = new THREE.SphereGeometry(0.44, 14, 12);
        headMesh = mesh(headGeo, mat(factionColor || '#88aaff'));
        headMesh.position.set(0, 0.54, 0);
        group.add(headMesh);
        // eyes
        [-1, 1].forEach((s) => {
          const eGeo = new THREE.SphereGeometry(0.07, 8, 8);
          const e = mesh(eGeo, mat('#ffffff', { emissive: '#aaccff', emissiveIntensity: 0.5, roughness: 0.1 }));
          e.position.set(s * 0.22, 0.08, 0.4);
          headMesh.add(e);
        });
        const neckGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.3, 8);
        const neck = mesh(neckGeo, mat(darkColor.getStyle()));
        neck.position.set(0, 0.1, 0);
        group.add(neck);
        const torsoGeo = new THREE.BoxGeometry(1.1, 0.9, 0.55);
        torsoMesh = mesh(torsoGeo, mat(darkColor.getStyle()));
        torsoMesh.position.set(0, -0.5, 0);
        group.add(torsoMesh);
      }
    }

    // Ensure headMesh/torsoMesh are set even for group-based heads (vel_ar)
    if (!torsoMesh) torsoMesh = group.children.find((c) => c !== headMesh) || headMesh;
    if (!(headMesh instanceof THREE.Mesh) && headMesh instanceof THREE.Group) {
      // For faction busts where head is a Group, use first Mesh child
      torsoMesh = torsoMesh || headMesh;
    }

    return { bust: group, headMesh, torsoMesh };
  }

  // ─── NpcAvatarRenderer class ───────────────────────────────────────────────

  class NpcAvatarRenderer {
    /**
     * @param {object} opts
     * @param {string} opts.factionCode
     * @param {string} opts.factionColor   CSS hex color string
     * @param {string} opts.npcName
     * @param {string} [opts.npcGender]    'männlich'|'weiblich' (from spec)
     * @param {string|null} [opts.portraitUrl]  explicit portrait URL or null for auto-resolve
     * @param {object} [opts.windowRef]    defaults to window
     * @param {object|null} [opts.THREE]   inject THREE for testing; null = no WebGL
     */
    constructor(opts = {}) {
      this._factionCode  = String(opts.factionCode || 'unknown');
      this._factionColor = String(opts.factionColor || '#88aaff');
      this._npcName      = String(opts.npcName || '');
      this._npcGender    = String(opts.npcGender || '');
      this._portraitUrl  = opts.portraitUrl !== undefined ? opts.portraitUrl
        : resolvePortraitUrl(this._factionCode, this._npcName, this._npcGender);
      this._windowRef    = opts.windowRef || (typeof window !== 'undefined' ? window : null);
      this._THREE        = opts.THREE !== undefined ? opts.THREE : null; // set in _initWebGL

      // State
      this._talking    = false;
      this._expression = 'neutral'; // neutral | friendly | hostile | thinking
      this._elapsed    = 0;
      this._lastTs     = null;
      this._destroyed  = false;

      // DOM refs
      this._container  = null;
      this._canvas     = null;
      this._fallbackEl = null;

      // Three.js refs
      this._scene      = null;
      this._camera     = null;
      this._renderer3d = null;
      this._lights     = null;
      this._bust       = null;
      this._headRef    = null;
      this._torsoRef   = null;
      this._rafId      = null;
      this._webglReady = false;
    }

    // ── Public API ────────────────────────────────────────────────────────

    /**
     * Insert the avatar into containerEl and start rendering.
     * Immediately shows the CSS fallback, then upgrades to WebGL asynchronously.
     * @param {Element} containerEl
     */
    mount(containerEl) {
      if (this._destroyed) return;
      this._container = containerEl;
      this._mountFallback();
      this._initWebGL(); // async, no-await intentional
    }

    /**
     * Re-attach the avatar's canvas / fallback element to a new container.
     * Useful when the panel HTML is rebuilt but we want to keep the same renderer.
     * @param {Element} containerEl
     */
    reattach(containerEl) {
      if (this._destroyed) return;
      this._container = containerEl;
      const el = this._canvas || this._fallbackEl;
      if (el && containerEl) containerEl.appendChild(el);
    }

    /** Stop all animation and free Three.js resources. */
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this._stopRenderLoop();
      this._disposeThree();
    }

    /** @param {boolean} val */
    setTalking(val) {
      this._talking = !!val;
    }

    /**
     * @param {'neutral'|'friendly'|'hostile'|'thinking'} expr
     */
    setExpression(expr) {
      this._expression = String(expr || 'neutral');
    }

    /** Whether the WebGL renderer is currently active. */
    get isWebGLActive() {
      return this._webglReady && !this._destroyed;
    }

    // ── Portrait URL helper (static, exposed for testing) ─────────────────

    static resolvePortraitUrl(factionCode, npcName, npcGender) {
      return resolvePortraitUrl(factionCode, npcName, npcGender);
    }

    // ── Internal: fallback ────────────────────────────────────────────────

    _mountFallback() {
      if (!this._container) return;

      // Build the CSS-only placeholder (shown immediately; replaced by canvas on success)
      const npcInitials = (this._npcName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const fallback = (this._windowRef?.document || document).createElement('div');
      fallback.className = 'npc-avatar-fallback';
      Object.assign(fallback.style, {
        width: '100%',
        height: '100%',
        minHeight: '220px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `radial-gradient(ellipse at 50% 30%, ${this._factionColor}33 0%, rgba(0,0,0,0.5) 70%)`,
        border: `1px solid ${this._factionColor}55`,
        borderRadius: '10px',
        overflow: 'hidden',
        position: 'relative',
      });

      // Try portrait image first
      if (this._portraitUrl) {
        const img = (this._windowRef?.document || document).createElement('img');
        img.src = this._portraitUrl;
        img.alt = this._npcName;
        Object.assign(img.style, {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center top',
          display: 'block',
        });
        img.addEventListener('error', () => {
          // Portrait not available — show initials fallback
          img.style.display = 'none';
          this._showInitialsFallback(fallback, npcInitials);
        });
        fallback.appendChild(img);
      } else {
        this._showInitialsFallback(fallback, npcInitials);
      }

      this._fallbackEl = fallback;
      this._container.appendChild(fallback);
    }

    _showInitialsFallback(container, initials) {
      const doc = this._windowRef?.document || document;
      const bg = doc.createElement('div');
      Object.assign(bg.style, {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        color: this._factionColor,
      });
      const icon = doc.createElement('div');
      icon.style.fontSize = '2.5rem';
      // No emoji/icon available here; just show initials in a circle
      const circle = doc.createElement('div');
      Object.assign(circle.style, {
        width: '72px',
        height: '72px',
        borderRadius: '50%',
        background: `${this._factionColor}22`,
        border: `2px solid ${this._factionColor}88`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.5rem',
        fontWeight: '700',
        color: this._factionColor,
        letterSpacing: '0.05em',
      });
      circle.textContent = initials;
      const nameEl = doc.createElement('div');
      Object.assign(nameEl.style, {
        fontSize: '0.72rem',
        color: 'var(--text-muted, #888)',
        textAlign: 'center',
        padding: '0 0.5rem',
        lineHeight: '1.3',
        maxWidth: '90%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });
      nameEl.textContent = this._npcName;
      bg.appendChild(circle);
      bg.appendChild(nameEl);
      container.appendChild(bg);
    }

    // ── Internal: WebGL init ──────────────────────────────────────────────

    async _initWebGL() {
      if (this._destroyed) return;

      const THREE = await this._ensureThree();
      if (!THREE || this._destroyed) return;

      const doc = this._windowRef?.document || document;

      // Check WebGL support
      const testCanvas = doc.createElement('canvas');
      const testCtx = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      if (!testCtx) return; // No WebGL available

      this._THREE = THREE;

      // Create canvas
      const canvas = doc.createElement('canvas');
      canvas.width  = 360;
      canvas.height = 480;
      Object.assign(canvas.style, {
        width: '100%',
        height: '100%',
        display: 'block',
        borderRadius: '10px',
      });
      canvas.setAttribute('aria-label', this._npcName);

      // Three.js renderer
      let renderer3d;
      try {
        renderer3d = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer3d.setSize(360, 480, false);
        renderer3d.setPixelRatio(Math.min((this._windowRef?.devicePixelRatio || 1), 2));
        renderer3d.setClearColor(0x000000, 0);
        renderer3d.shadowMap.enabled = false;
      } catch (_) {
        return; // WebGL init failed; keep PNG fallback
      }

      // Scene
      const scene  = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 360 / 480, 0.1, 20);
      camera.position.set(0, 0.15, 3.2);
      camera.lookAt(0, 0.1, 0);

      // Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.45);
      scene.add(ambient);
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
      keyLight.position.set(1.5, 2.5, 2);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xaaaaff, 0.3);
      fillLight.position.set(-2, 0, 1);
      scene.add(fillLight);
      const rimLight = new THREE.PointLight(new THREE.Color(this._factionColor).getHex(), 0.8, 4.5);
      rimLight.position.set(-1.2, 1, -1.5);
      scene.add(rimLight);

      // Build bust
      let bustData;
      try {
        bustData = buildFactionBust(THREE, this._factionCode, this._factionColor);
      } catch (_) {
        renderer3d.dispose();
        return;
      }

      scene.add(bustData.bust);

      this._scene      = scene;
      this._camera     = camera;
      this._renderer3d = renderer3d;
      this._bust       = bustData.bust;
      this._headRef    = bustData.headMesh;
      this._torsoRef   = bustData.torsoMesh;
      this._canvas     = canvas;
      this._webglReady = true;

      // Replace fallback with canvas
      if (this._container && !this._destroyed) {
        if (this._fallbackEl && this._fallbackEl.parentNode === this._container) {
          this._container.removeChild(this._fallbackEl);
        }
        this._container.appendChild(canvas);
        this._startRenderLoop();
      }
    }

    async _ensureThree() {
      const win = this._windowRef;
      if (!win) return null;
      if (win.THREE) return win.THREE;

      // Load Three.js vendor script
      return new Promise((resolve) => {
        const doc = win.document;
        if (!doc) { resolve(null); return; }
        const s = doc.createElement('script');
        s.src = 'js/vendor/three.min.js';
        s.onload  = () => resolve(win.THREE || null);
        s.onerror = () => {
          // CDN fallback
          const s2 = doc.createElement('script');
          s2.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
          s2.onload  = () => resolve(win.THREE || null);
          s2.onerror = () => resolve(null);
          doc.head.appendChild(s2);
        };
        doc.head.appendChild(s);
      });
    }

    // ── Internal: render loop ─────────────────────────────────────────────

    _startRenderLoop() {
      if (this._rafId !== null || this._destroyed) return;
      const loop = (ts) => {
        if (this._destroyed) return;
        const dt = this._lastTs !== null ? Math.min((ts - this._lastTs) / 1000, 0.1) : 0.016;
        this._lastTs = ts;
        this._elapsed += dt;
        this._tick(dt);
        this._renderer3d.render(this._scene, this._camera);
        this._rafId = (this._windowRef?.requestAnimationFrame || requestAnimationFrame)(loop);
      };
      this._rafId = (this._windowRef?.requestAnimationFrame || requestAnimationFrame)(loop);
    }

    _stopRenderLoop() {
      if (this._rafId !== null) {
        (this._windowRef?.cancelAnimationFrame || cancelAnimationFrame)(this._rafId);
        this._rafId = null;
      }
    }

    _tick(dt) {
      const e = this._elapsed;
      const head = this._headRef;
      const torso = this._torsoRef;
      if (!head || !torso) return;

      // Target values for each state
      let targetRotX = 0;
      let targetRotY = 0;
      let targetRotZ = 0;

      if (this._talking) {
        // Fast nod + slight side sway when talking
        targetRotX = Math.sin(e * 9.5) * 0.055 + Math.sin(e * 4.2) * 0.022;
        targetRotY = Math.sin(e * 3.8) * 0.038;
      } else {
        // Idle: very subtle ambient sway
        targetRotX = Math.sin(e * 1.1) * 0.008;
        targetRotY = Math.sin(e * 0.8) * 0.022;
      }

      // Expression overlay on Z tilt
      switch (this._expression) {
        case 'thinking':  targetRotZ = 0.1 + Math.sin(e * 0.4) * 0.02; break;
        case 'friendly':  targetRotZ = -0.06; break;
        case 'hostile':   targetRotX += 0.06; break; // forward lean
        default:          targetRotZ = 0; break;
      }

      // Smooth interpolation toward target
      const k = 1 - Math.pow(0.04, dt);
      if (head instanceof this._THREE.Group || head.rotation) {
        head.rotation.x += (targetRotX - head.rotation.x) * k;
        head.rotation.y += (targetRotY - head.rotation.y) * k;
        head.rotation.z += (targetRotZ - head.rotation.z) * k;
      }

      // Gentle breathing on torso
      const breathe = Math.sin(e * 0.9) * 0.012;
      if (torso.scale) {
        torso.scale.y = 1.0 + breathe;
      }

      // Very slow whole-bust Y float
      if (this._bust) {
        this._bust.position.y = Math.sin(e * 0.6) * 0.025;
      }
    }

    // ── Internal: dispose ─────────────────────────────────────────────────

    _disposeThree() {
      if (this._renderer3d) {
        this._renderer3d.dispose();
        this._renderer3d = null;
      }
      if (this._scene) {
        this._scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else obj.material.dispose();
          }
        });
        this._scene = null;
      }
      this._bust    = null;
      this._headRef = null;
      this._torsoRef = null;
      this._camera   = null;
      this._canvas   = null;
      this._webglReady = false;
    }
  }

  // ── Module export ──────────────────────────────────────────────────────────

  const _public = { NpcAvatarRenderer, resolvePortraitUrl };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _public;
  }
  if (typeof window !== 'undefined') {
    window.GQNpcAvatarRenderer = _public;
  }
})();
