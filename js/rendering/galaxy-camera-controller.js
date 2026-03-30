/*
 * GalaxyCameraController
 * Verantwortlich für: Camera-Driver-Verwaltung, Pose-API, Takeover-Mechanik.
 * Wird von Galaxy3DRenderer erstellt und als this.cameraCtrl referenziert.
 * Die öffentliche Renderer-API (setCameraDriver etc.) delegiert hierher.
 */
(function () {
  'use strict';

  class GalaxyCameraController {
    /**
     * Formales Driver-Interface:
     * - Pflicht: update(ctx)
     * - Optional: onAttach(ref), onDetach(ref), consumeAutoNav, updateControls, priority
     * @param {object} driver
     * @returns {{ valid: boolean, missing: string[] }}
     */
    static validateDriver(driver) {
      const missing = [];
      if (!driver || typeof driver !== 'object') {
        missing.push('driver');
      }
      if (!driver || typeof driver.update !== 'function') {
        missing.push('update(ctx)');
      }
      return {
        valid: missing.length === 0,
        missing,
      };
    }

    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {object} controls  OrbitControls oder BasicOrbitControls
     */
    constructor(camera, controls) {
      if (!camera) throw new Error('GalaxyCameraController: camera required');
      this._camera   = camera;
      this._controls = controls;
      this._driver   = null;
      this._consumeAutoNav = true;
      this._roll     = 0;
      this._blendFramesLeft = 0;
      this._blendFramesTotal = 0;
      this._blendFromPose = null;
      this._blendFromRoll = 0;
    }

    // ─── Driver-Verwaltung ──────────────────────────────────────────────────

    /**
     * Registriert einen externen Camera-Driver.
     * @param {object} driver  Muss .update(ctx) implementieren.
     * @param {object} [opts]
     * @param {boolean} [opts.consumeAutoNav=true]   Blockiert internen Nav-Tick.
     * @param {boolean} [opts.updateControls=true]   Läuft controls.update() danach.
    * @param {number}  [opts.blendFrames]           Weiches Takeover in Frames.
     * @param {object}  [rendererRef]  Wird an onAttach/onDetach weitergegeben.
     * @returns {boolean}
     */
    setDriver(driver, opts = {}, rendererRef) {
      const validation = GalaxyCameraController.validateDriver(driver);
      if (!validation.valid) {
        this.clearDriver(rendererRef);
        const log = window.GQLog || console;
        log.warn('[camera-ctrl] setDriver: invalid driver — driver cleared', validation.missing.join(', '));
        return false;
      }

      this.clearDriver(rendererRef);

      const consumeAutoNav = opts.consumeAutoNav !== undefined
        ? opts.consumeAutoNav !== false
        : driver.consumeAutoNav !== false;
      const updateControls = opts.updateControls !== undefined
        ? opts.updateControls !== false
        : driver.updateControls !== false;
      const priority = Number.isFinite(Number(driver.priority)) ? Number(driver.priority) : 0;
      const blendFramesRaw = opts.blendFrames !== undefined ? opts.blendFrames : (driver.blendFrames !== undefined ? driver.blendFrames : 14);
      const blendFrames = Math.max(0, Math.floor(Number.isFinite(Number(blendFramesRaw)) ? Number(blendFramesRaw) : 0));

      this._driver = {
        update:         driver.update.bind(driver),
        onAttach:       typeof driver.onAttach  === 'function' ? driver.onAttach.bind(driver)  : null,
        onDetach:       typeof driver.onDetach  === 'function' ? driver.onDetach.bind(driver)  : null,
        consumeAutoNav,
        updateControls,
        priority,
      };
      this._consumeAutoNav = this._driver.consumeAutoNav;
      this._roll = 0;
      this._blendFramesTotal = blendFrames;
      this._blendFramesLeft = blendFrames;
      this._blendFromPose = blendFrames > 0 ? this.getPose() : null;
      this._blendFromRoll = this._roll;

      try {
        this._driver.onAttach?.(rendererRef || this);
      } catch (err) {
        const log = window.GQLog || console;
        log.error('[camera-ctrl] driver.onAttach threw:', String(err?.message || err));
      }
      return true;
    }

    /**
     * Entfernt den aktiven Driver und ruft onDetach auf.
     * @param {object} [rendererRef]
     */
    clearDriver(rendererRef) {
      if (this._driver?.onDetach) {
        try {
          this._driver.onDetach(rendererRef || this);
        } catch (err) {
          const log = window.GQLog || console;
          log.error('[camera-ctrl] driver.onDetach threw:', String(err?.message || err));
        }
      }
      this._driver        = null;
      this._consumeAutoNav = true;
      this._roll          = 0;
      this._blendFramesLeft = 0;
      this._blendFramesTotal = 0;
      this._blendFromPose = null;
      this._blendFromRoll = 0;
    }

    /** @returns {boolean} */
    hasDriver() {
      return !!this._driver;
    }

    // ─── Pose-API ───────────────────────────────────────────────────────────

    /**
     * Gibt die aktuelle Kamerapose zurück.
     * @returns {{ position: THREE.Vector3, target: THREE.Vector3 }}
     */
    getPose() {
      return {
        position: this._camera.position.clone(),
        target:   this._controls?.target?.clone?.() || new THREE.Vector3(0, 0, 0),
      };
    }

    /**
     * Setzt Kamerapose; position, target, lookAt, roll werden optional angewendet.
     * @param {object} pose
     * @param {object} [opts]
     * @param {boolean} [opts.updateControls=true]
     * @returns {boolean}
     */
    applyPose(pose = {}, opts = {}) {
      if (!pose || typeof pose !== 'object') return false;

      const c    = this._camera;
      const ctrl = this._controls;

      if (pose.position && Number.isFinite(pose.position.x) && Number.isFinite(pose.position.y) && Number.isFinite(pose.position.z)) {
        c.position.set(pose.position.x, pose.position.y, pose.position.z);
      }
      if (pose.target && ctrl?.target && Number.isFinite(pose.target.x) && Number.isFinite(pose.target.y) && Number.isFinite(pose.target.z)) {
        ctrl.target.set(pose.target.x, pose.target.y, pose.target.z);
      }
      if (pose.lookAt && Number.isFinite(pose.lookAt.x) && Number.isFinite(pose.lookAt.y) && Number.isFinite(pose.lookAt.z)) {
        c.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      }

      this._roll = Number.isFinite(Number(pose.roll)) ? Number(pose.roll) : 0;

      if (opts.updateControls !== false && ctrl?.update) {
        ctrl.update();
      }
      if (Math.abs(this._roll) > 1e-6) {
        c.rotation.z += this._roll;
      }
      return true;
    }

    _blendTakeoverPose(pose = {}) {
      if (!this._blendFramesLeft || !this._blendFramesTotal || !this._blendFromPose) {
        return pose;
      }
      const progress = 1 - (this._blendFramesLeft / this._blendFramesTotal);
      const t = Math.max(0, Math.min(1, progress));

      const out = Object.assign({}, pose);
      if (pose.position && this._blendFromPose.position?.clone) {
        const p = this._blendFromPose.position.clone();
        p.lerp(pose.position, t);
        out.position = p;
      }
      if (pose.target && this._blendFromPose.target?.clone) {
        const q = this._blendFromPose.target.clone();
        q.lerp(pose.target, t);
        out.target = q;
      }
      if (Number.isFinite(Number(pose.roll))) {
        const r = Number(pose.roll);
        out.roll = this._blendFromRoll + ((r - this._blendFromRoll) * t);
      }

      this._blendFramesLeft -= 1;
      if (this._blendFramesLeft <= 0) {
        this._blendFramesLeft = 0;
        this._blendFramesTotal = 0;
        this._blendFromPose = null;
      }
      return out;
    }

    // ─── Render-Loop-Tick ───────────────────────────────────────────────────

    /**
     * Wird jeden Frame vom Renderer-Render-Loop aufgerufen.
     * @param {number} dt         Delta-Zeit in Sekunden.
     * @param {number} nowMs      performance.now() Zeitstempel.
     * @param {object} rendererRef  Galaxy3DRenderer-Instanz (wird dem Driver übergeben).
     * @returns {boolean}  true = interner Auto-Nav-Tick wird übersprungen.
     */
    tick(dt, nowMs, rendererRef) {
      if (!this._driver || typeof this._driver.update !== 'function') return false;

      try {
        const result = this._driver.update({
          renderer: rendererRef,
          dt,
          now:      nowMs,
          camera:   this._camera,
          controls: this._controls,
          getPose:   () => this.getPose(),
          applyPose: (pose) => this.applyPose(pose, { updateControls: false }),
        });

        if (result && typeof result === 'object') {
          const pose = this._blendTakeoverPose(result);
          this.applyPose(pose, { updateControls: false });
          return this._consumeAutoNav;
        }
        if (result === true) {
          return this._consumeAutoNav;
        }
      } catch (err) {
        const log = window.GQLog || console;
        log.error('[camera-ctrl] driver.update threw:', String(err?.message || err));
      }
      return false;
    }

    // ─── Hilfszugriffe für Render-Loop ──────────────────────────────────────

    /** Aktueller Roll-Wert aus der letzten applyPose-Anwendung. */
    getRoll() {
      return this._roll;
    }

    /**
     * Ob controls.update() nach dem Driver-Tick aufgerufen werden soll.
     * @returns {boolean}
     */
    getDriverUpdateControls() {
      return this._driver?.updateControls !== false;
    }
  }

  window.GalaxyCameraController = GalaxyCameraController;
})();
