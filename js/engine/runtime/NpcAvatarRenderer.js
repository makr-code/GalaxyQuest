'use strict';
/**
 * NpcAvatarRenderer
 *
 * Renders an animated faction NPC bust (head + torso) in a WebGL canvas using
 * Three.js. The primary source is a Three.js Object JSON descriptor loaded from
 * models/npc_avatars/{factionCode}_npc_bust.json. Animation clips in the JSON
 * are played via THREE.AnimationMixer:
 *
 *   idle_breathe        – gentle torso scale + head float (looping)
 *   talk_nod            – rapid head nod (looping while talking)
 *   expression_friendly – slight tilt (one-shot)
 *   expression_hostile  – forward lean (one-shot)
 *   expression_thinking – side tilt (one-shot)
 *
 * Fallback chain
 * ──────────────
 *   1. WebGL + JSON model (THREE.ObjectLoader + AnimationMixer)    ← primary
 *   2. WebGL + procedural Three.js bust geometry (no JSON needed)  ← secondary
 *   3. <img> portrait PNG  (gfx/portraits/{Faction}_{Npc}_{g}.png) ← tertiary
 *   4. CSS div with faction colour + NPC initials                  ← always works
 *
 * Usage
 * ──────
 *   const r = new NpcAvatarRenderer({
 *     factionCode: 'vor_tak', factionColor: '#2d5a1b',
 *     npcName: "General Drak'Mol", npcGender: 'männlich',
 *   });
 *   r.mount(containerEl);
 *   r.setTalking(true);          // crossfades to talk_nod clip
 *   r.setExpression('hostile');  // plays expression_hostile once
 *   r.destroy();
 */
(function () {

  // ── Portrait URL helpers ───────────────────────────────────────────────────

  function _nameToPascal(raw) {
    return String(raw || '')
      .replace(/['''`]/g, '')
      .replace(/[^a-zA-ZäöüÄÖÜ0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !/^(General|Admiral|Stratega|Veteran|Seherin|Schmiedelehrmeisterin|Exil|Hohepriesterin|Direktor|Kommandantin|Archivar|Architektin|Segmentklinge)$/.test(w))
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  function resolvePortraitUrl(factionCode, npcName, npcGender) {
    const factionPart = (factionCode || '').split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
    const npcPart  = _nameToPascal(npcName) || 'Unknown';
    const gChar    = String(npcGender || '').toLowerCase().startsWith('w') ? 'f'
      : String(npcGender || '').toLowerCase().startsWith('f') ? 'f' : 'm';
    return `gfx/portraits/${factionPart}_${npcPart}_${gChar}.png`;
  }

  // ── Procedural bust (fallback when JSON unavailable) ──────────────────────

  function buildProceduralBust(THREE, factionCode, factionColor) {
    const accent = new THREE.Color(factionColor);
    const dark   = accent.clone().multiplyScalar(0.4);

    function mat(color, opts = {}) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: opts.roughness ?? 0.7,
        metalness: opts.metalness ?? 0.2,
        emissive:  opts.emissive ? new THREE.Color(opts.emissive) : undefined,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
      });
    }
    function mesh(geo, m) { return new THREE.Mesh(geo, m); }

    const group = new THREE.Group();
    group.name = 'bust_root';

    // Head
    const headGeo = new THREE.SphereGeometry(0.44, 12, 10);
    const headMesh = mesh(headGeo, mat(factionColor));
    headMesh.name = 'head';
    headMesh.position.set(0, 0.54, 0);

    // Eyes
    [-1, 1].forEach((s) => {
      const e = mesh(new THREE.SphereGeometry(0.07, 8, 8),
        mat('#ffffff', { emissive: '#aaccff', emissiveIntensity: 0.5, roughness: 0.1 }));
      e.position.set(s * 0.22, 0.08, 0.4);
      headMesh.add(e);
    });
    group.add(headMesh);

    // Neck
    const neckMesh = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.3, 8), mat(dark.getStyle()));
    neckMesh.name = 'neck';
    neckMesh.position.set(0, 0.1, 0);
    group.add(neckMesh);

    // Torso
    const torsoMesh = mesh(new THREE.BoxGeometry(1.1, 0.9, 0.55), mat(dark.getStyle()));
    torsoMesh.name = 'torso';
    torsoMesh.position.set(0, -0.5, 0);
    group.add(torsoMesh);

    return group;
  }

  // ── AnimationMixer helpers ─────────────────────────────────────────────────

  const ANIM_IDLE    = 'idle_breathe';
  const ANIM_TALK    = 'talk_nod';
  const ANIM_EXPRS   = ['expression_friendly', 'expression_hostile', 'expression_thinking'];

  function _findClip(clips, name) {
    return clips.find((c) => c.name === name) || null;
  }

  // ── NpcAvatarRenderer ──────────────────────────────────────────────────────

  class NpcAvatarRenderer {
    /**
     * @param {object}      opts
     * @param {string}      opts.factionCode
     * @param {string}      opts.factionColor    CSS hex
     * @param {string}      opts.npcName
     * @param {string}      [opts.npcGender]
     * @param {string|null} [opts.portraitUrl]   explicit URL or null for auto
     * @param {object}      [opts.windowRef]     defaults to window
     * @param {object|null} [opts.THREE]         inject for tests (null = no WebGL)
     * @param {string}      [opts.modelBasePath] base path for JSON models (default 'models/npc_avatars')
     */
    constructor(opts = {}) {
      this._factionCode  = String(opts.factionCode  || 'unknown');
      this._factionColor = String(opts.factionColor || '#88aaff');
      this._npcName      = String(opts.npcName      || '');
      this._npcGender    = String(opts.npcGender    || '');
      this._portraitUrl  = opts.portraitUrl !== undefined ? opts.portraitUrl
        : resolvePortraitUrl(this._factionCode, this._npcName, this._npcGender);
      this._windowRef    = opts.windowRef || (typeof window !== 'undefined' ? window : null);
      this._THREE        = opts.THREE !== undefined ? opts.THREE : null;
      this._modelBasePath = String(opts.modelBasePath || 'models/npc_avatars');

      // Animation state
      this._talking    = false;
      this._expression = 'neutral';
      this._elapsed    = 0;
      this._lastTs     = null;
      this._destroyed  = false;

      // DOM
      this._container  = null;
      this._canvas     = null;
      this._fallbackEl = null;

      // Three.js
      this._scene      = null;
      this._camera     = null;
      this._renderer3d = null;
      this._mixer      = null;
      this._clips      = [];          // THREE.AnimationClip[]
      this._actionIdle = null;
      this._actionTalk = null;
      this._bust       = null;
      this._rafId      = null;
      this._webglReady = false;
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Insert the avatar into containerEl and start rendering.
     * Shows CSS fallback immediately, upgrades to WebGL asynchronously.
     * @param {Element} containerEl
     */
    mount(containerEl) {
      if (this._destroyed) return;
      this._container = containerEl;
      this._mountFallback();
      this._initWebGL();
    }

    /**
     * Re-attach to a new container after panel HTML rebuild.
     * @param {Element} containerEl
     */
    reattach(containerEl) {
      if (this._destroyed) return;
      this._container = containerEl;
      const el = this._canvas || this._fallbackEl;
      if (el && containerEl) containerEl.appendChild(el);
    }

    /** Stop all animation and free GPU resources. */
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this._stopRenderLoop();
      this._disposeThree();
    }

    /** @param {boolean} val */
    setTalking(val) {
      const talking = !!val;
      if (talking === this._talking) return;
      this._talking = talking;
      this._updateAnimationState();
    }

    /**
     * @param {'neutral'|'friendly'|'hostile'|'thinking'} expr
     */
    setExpression(expr) {
      this._expression = String(expr || 'neutral');
      this._playExpressionOnce(this._expression);
    }

    get isWebGLActive() {
      return this._webglReady && !this._destroyed;
    }

    static resolvePortraitUrl(factionCode, npcName, npcGender) {
      return resolvePortraitUrl(factionCode, npcName, npcGender);
    }

    // ── Fallback DOM ───────────────────────────────────────────────────────

    _mountFallback() {
      if (!this._container) return;
      const doc = this._windowRef?.document || document;
      const initials = (this._npcName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const fallback = doc.createElement('div');
      fallback.className = 'npc-avatar-fallback';
      Object.assign(fallback.style, {
        width: '100%', height: '100%', minHeight: '220px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: `radial-gradient(ellipse at 50% 30%, ${this._factionColor}33 0%, rgba(0,0,0,0.5) 70%)`,
        border: `1px solid ${this._factionColor}55`,
        borderRadius: '10px', overflow: 'hidden', position: 'relative',
      });

      if (this._portraitUrl) {
        const img = doc.createElement('img');
        img.src = this._portraitUrl;
        img.alt = this._npcName;
        Object.assign(img.style, {
          width: '100%', height: '100%', objectFit: 'cover',
          objectPosition: 'center top', display: 'block',
        });
        img.addEventListener('error', () => {
          img.style.display = 'none';
          this._appendInitialsFallback(fallback, doc, initials);
        });
        fallback.appendChild(img);
      } else {
        this._appendInitialsFallback(fallback, doc, initials);
      }

      this._fallbackEl = fallback;
      this._container.appendChild(fallback);
    }

    _appendInitialsFallback(container, doc, initials) {
      const wrap = doc.createElement('div');
      Object.assign(wrap.style, {
        width: '100%', height: '100%', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
      });
      const circle = doc.createElement('div');
      Object.assign(circle.style, {
        width: '72px', height: '72px', borderRadius: '50%',
        background: `${this._factionColor}22`,
        border: `2px solid ${this._factionColor}88`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', fontWeight: '700', color: this._factionColor,
      });
      circle.textContent = initials;
      const nameEl = doc.createElement('div');
      Object.assign(nameEl.style, {
        fontSize: '0.72rem', color: 'var(--text-muted, #888)', textAlign: 'center',
        padding: '0 0.5rem', lineHeight: '1.3', maxWidth: '90%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      });
      nameEl.textContent = this._npcName;
      wrap.appendChild(circle);
      wrap.appendChild(nameEl);
      container.appendChild(wrap);
    }

    // ── WebGL init ─────────────────────────────────────────────────────────

    async _initWebGL() {
      if (this._destroyed) return;

      const THREE = await this._ensureThree();
      if (!THREE || this._destroyed) return;

      const doc = this._windowRef?.document || document;

      // Check WebGL availability
      const probe = doc.createElement('canvas');
      const probeCtx = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl');
      if (!probeCtx) return;

      this._THREE = THREE;

      // Build renderer canvas
      const canvas = doc.createElement('canvas');
      canvas.width  = 360;
      canvas.height = 480;
      Object.assign(canvas.style, {
        width: '100%', height: '100%', display: 'block', borderRadius: '10px',
      });
      canvas.setAttribute('aria-label', this._npcName);

      let renderer3d;
      try {
        renderer3d = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer3d.setSize(360, 480, false);
        renderer3d.setPixelRatio(Math.min((this._windowRef?.devicePixelRatio || 1), 2));
        renderer3d.setClearColor(0x000000, 0);
      } catch (_) {
        return; // WebGL init failed; keep fallback
      }

      // Scene + camera
      const scene  = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 360 / 480, 0.1, 20);
      camera.position.set(0, 0.15, 3.2);
      camera.lookAt(0, 0.1, 0);

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(1.5, 2.5, 2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xaaaaff, 0.3);
      fill.position.set(-2, 0, 1);
      scene.add(fill);
      const rim = new THREE.PointLight(new THREE.Color(this._factionColor).getHex(), 0.8, 4.5);
      rim.position.set(-1.2, 1, -1.5);
      scene.add(rim);

      // Load bust: try JSON first, fall back to procedural
      let bust = null;
      let clips = [];
      try {
        const result = await this._loadJsonBust(THREE);
        if (result) { bust = result.bust; clips = result.clips; }
      } catch (_) { /* ignored */ }

      if (!bust) {
        bust = buildProceduralBust(THREE, this._factionCode, this._factionColor);
      }

      scene.add(bust);

      // Set up AnimationMixer if we have clips
      let mixer = null;
      let actionIdle = null;
      let actionTalk = null;
      if (clips.length > 0) {
        mixer = new THREE.AnimationMixer(bust);
        const idleClip = _findClip(clips, ANIM_IDLE);
        const talkClip = _findClip(clips, ANIM_TALK);
        if (idleClip) {
          actionIdle = mixer.clipAction(idleClip);
          actionIdle.setLoop(THREE.LoopRepeat, Infinity);
          actionIdle.play();
        }
        if (talkClip) {
          actionTalk = mixer.clipAction(talkClip);
          actionTalk.setLoop(THREE.LoopRepeat, Infinity);
          actionTalk.enabled = false;
        }
      }

      this._scene      = scene;
      this._camera     = camera;
      this._renderer3d = renderer3d;
      this._bust       = bust;
      this._mixer      = mixer;
      this._clips      = clips;
      this._actionIdle = actionIdle;
      this._actionTalk = actionTalk;
      this._canvas     = canvas;
      this._webglReady = true;

      // Swap fallback → canvas
      if (this._container && !this._destroyed) {
        if (this._fallbackEl && this._fallbackEl.parentNode === this._container) {
          this._container.removeChild(this._fallbackEl);
        }
        this._container.appendChild(canvas);
        // Apply current talking state in case it was set before mount completed
        this._updateAnimationState();
        this._startRenderLoop();
      }
    }

    async _loadJsonBust(THREE) {
      const url = `${this._modelBasePath}/${this._factionCode}_npc_bust.json`;
      let descriptor;
      try {
        const resp = await ((this._windowRef || {}).fetch || fetch)(url);
        if (!resp.ok) return null;
        descriptor = await resp.json();
      } catch (_) {
        return null;
      }

      if (!descriptor?.metadata?.type || !descriptor?.object) return null;

      return new Promise((resolve) => {
        try {
          const loader = new THREE.ObjectLoader();
          loader.setResourcePath('/');
          loader.parse(descriptor, (object3d) => {
            let bust = object3d;
            if (!bust?.isGroup) {
              const wrapped = new THREE.Group();
              if (bust) wrapped.add(bust);
              bust = wrapped;
            }
            // Parse AnimationClips
            const clips = [];
            if (Array.isArray(descriptor.animations)) {
              descriptor.animations.forEach((clipDef) => {
                if (!clipDef || !Array.isArray(clipDef.tracks)) return;
                try {
                  clips.push(THREE.AnimationClip.parse(clipDef));
                } catch (_) { /* ignore malformed clip */ }
              });
            }
            resolve({ bust, clips });
          });
        } catch (_) {
          resolve(null);
        }
      });
    }

    async _ensureThree() {
      const win = this._windowRef;
      if (!win) return this._THREE || null;
      if (this._THREE) return this._THREE;
      if (win.THREE) return win.THREE;

      return new Promise((resolve) => {
        const doc = win.document;
        if (!doc) { resolve(null); return; }
        const s = doc.createElement('script');
        s.src = 'js/vendor/three.min.js';
        s.onload  = () => resolve(win.THREE || null);
        s.onerror = () => {
          const s2 = doc.createElement('script');
          s2.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
          s2.onload  = () => resolve(win.THREE || null);
          s2.onerror = () => resolve(null);
          doc.head.appendChild(s2);
        };
        doc.head.appendChild(s);
      });
    }

    // ── AnimationMixer state control ───────────────────────────────────────

    _updateAnimationState() {
      if (!this._mixer || !this._webglReady) return;
      const THREE = this._THREE;
      if (!THREE) return;

      if (this._talking) {
        if (this._actionIdle) this._actionIdle.crossFadeTo(
          this._actionTalk || this._actionIdle, 0.2, false
        );
        if (this._actionTalk) {
          this._actionTalk.enabled = true;
          if (!this._actionTalk.isRunning()) {
            this._actionTalk.reset().play();
          }
        }
      } else {
        if (this._actionTalk && this._actionIdle) {
          this._actionTalk.crossFadeTo(this._actionIdle, 0.3, false);
        } else if (this._actionTalk) {
          this._actionTalk.stop();
          this._actionTalk.enabled = false;
        }
        if (this._actionIdle && !this._actionIdle.isRunning()) {
          this._actionIdle.reset().play();
        }
      }
    }

    _playExpressionOnce(expr) {
      if (!this._mixer || !this._clips.length) return;
      const THREE = this._THREE;
      const clipName = `expression_${expr}`;
      const clip = _findClip(this._clips, clipName);
      if (!clip) return;
      const action = this._mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.reset().play();
    }

    // ── Render loop ────────────────────────────────────────────────────────

    _startRenderLoop() {
      if (this._rafId !== null || this._destroyed) return;
      const loop = (ts) => {
        if (this._destroyed) return;
        const dt = this._lastTs !== null ? Math.min((ts - this._lastTs) / 1000, 0.1) : 0.016;
        this._lastTs = ts;
        this._elapsed += dt;
        if (this._mixer) this._mixer.update(dt);
        // Subtle whole-bust float when no mixer (procedural fallback)
        if (!this._mixer && this._bust) {
          this._bust.position.y = Math.sin(this._elapsed * 0.6) * 0.025;
        }
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

    // ── Dispose ────────────────────────────────────────────────────────────

    _disposeThree() {
      if (this._mixer) {
        this._mixer.stopAllAction();
        this._mixer = null;
      }
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
      this._clips   = [];
      this._actionIdle = null;
      this._actionTalk = null;
      this._camera  = null;
      this._canvas  = null;
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
