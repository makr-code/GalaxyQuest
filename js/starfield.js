/**
 * Auth background renderer.
 * Shows a rotating spiral galaxy on the login page and falls back to 2D stars when WebGL is unavailable.
 */
(function () {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const stage = document.getElementById('galaxy-stage');

  const starfieldRuntime = window.__GQ_STARFIELD_RUNTIME = Object.assign(window.__GQ_STARFIELD_RUNTIME || {}, {
    releaseRequested: false,
    release: null,
    released: false,
    choreographyScript: null,
    choreographyRevision: 0,
    targetSelectionMode: 'mixed',
  });

  window.GQStarfieldControl = Object.assign(window.GQStarfieldControl || {}, {
    releaseCanvasForGame() {
      starfieldRuntime.releaseRequested = true;
      try {
        if (typeof starfieldRuntime.release === 'function') starfieldRuntime.release();
      } catch (_) {}
      starfieldRuntime.released = true;
    },
    setChoreographyScript(script) {
      starfieldRuntime.choreographyScript = script || null;
      starfieldRuntime.choreographyRevision = Number(starfieldRuntime.choreographyRevision || 0) + 1;
      return true;
    },
    setChoreographyScriptFromJson(jsonText) {
      try {
        const parsed = JSON.parse(String(jsonText || 'null'));
        starfieldRuntime.choreographyScript = parsed;
        starfieldRuntime.choreographyRevision = Number(starfieldRuntime.choreographyRevision || 0) + 1;
        return true;
      } catch (err) {
        bootLog('warn', `invalid choreography json: ${String(err && err.message ? err.message : err || 'unknown')}`);
        return false;
      }
    },
    clearChoreographyScript() {
      starfieldRuntime.choreographyScript = null;
      starfieldRuntime.choreographyRevision = Number(starfieldRuntime.choreographyRevision || 0) + 1;
      return true;
    },
    setTargetSelectionMode(mode) {
      const key = String(mode || '').toLowerCase();
      const allowed = ['mixed', 'near', 'far', 'cluster'];
      if (!allowed.includes(key)) return false;
      starfieldRuntime.targetSelectionMode = key;
      return true;
    },
  });

  // Keep only minimal runtime-safe styles; placement is controlled by layout CSS/auth shell.
  if (stage) {
    stage.style.display = 'block';
    stage.style.pointerEvents = 'none';
  }
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '1';

  function bootLog(level, message) {
    const text = String(message || '');
    try {
      if (window.GQLog && typeof window.GQLog[level] === 'function') {
        window.GQLog[level](`[starfield] ${text}`);
        return;
      }
    } catch (_) {}
    try {
      if (window.__GQ_BOOT_PROBE?.log) {
        window.__GQ_BOOT_PROBE.log(`[starfield] ${text}`, level);
      }
    } catch (_) {}
  }

  function tryLoadStoredChoreographyScript() {
    if (starfieldRuntime.choreographyScript) return;
    try {
      const raw = localStorage.getItem('gq_starfield_choreo_script');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      starfieldRuntime.choreographyScript = parsed;
      starfieldRuntime.choreographyRevision = Number(starfieldRuntime.choreographyRevision || 0) + 1;
      bootLog('info', 'external choreography loaded from localStorage');
    } catch (_) {}
  }

  function run2DStarFallback() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    bootLog('warn', '2D fallback active');
    let w = 0;
    let h = 0;
    let stars = [];
    const starCount = 1400;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }

    function initStars() {
      stars = [];
      for (let i = 0; i < starCount; i += 1) {
        const radius = Math.pow(Math.random(), 1.9);
        const arm = i % 4;
        const armAngle = (Math.PI * 2 * arm) / 4;
        const theta = armAngle + radius * 15.0 + (Math.random() - 0.5) * 0.9;
        const galaxyRadius = Math.min(w, h) * 0.43 * radius;
        const centerX = w * 0.5;
        const centerY = h * 0.5;
        const x = centerX + Math.cos(theta) * galaxyRadius + (Math.random() - 0.5) * 14;
        const y = centerY + Math.sin(theta) * galaxyRadius * 0.38 + (Math.random() - 0.5) * 10;
        const coreMix = 1 - radius;
        stars.push({
          x,
          y,
          ox: x,
          oy: y,
          r: 0.45 + (Math.random() * 1.7) + coreMix * 1.3,
          speed: 0.0002 + Math.random() * 0.0007,
          opacity: 0.14 + Math.random() * 0.48,
          coreMix,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    function drawBackdrop(t) {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const r = Math.max(w, h) * 0.62;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0.0, 'rgba(18, 24, 52, 0.95)');
      grad.addColorStop(0.35, 'rgba(9, 15, 33, 0.88)');
      grad.addColorStop(1.0, 'rgba(4, 8, 18, 1.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const glowR = Math.min(w, h) * 0.23;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0.0, 'rgba(255, 224, 150, 0.26)');
      glow.addColorStop(0.35, 'rgba(145, 176, 255, 0.11)');
      glow.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      // Subtle disk haze.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(t * 0.00008) * 0.08);
      ctx.scale(1.0, 0.38);
      const diskR = Math.min(w, h) * 0.42;
      const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, diskR);
      disk.addColorStop(0.0, 'rgba(120, 156, 255, 0.12)');
      disk.addColorStop(0.45, 'rgba(82, 120, 220, 0.08)');
      disk.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(0, 0, diskR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      if (document.body.classList.contains('game-page') || starfieldRuntime.releaseRequested) {
        starfieldRuntime.released = true;
        return;
      }
      const t = performance.now();
      drawBackdrop(t);
      const cx = w * 0.5;
      const cy = h * 0.5;
      for (const s of stars) {
        const dx = s.ox - cx;
        const dy = (s.oy - cy) / 0.38;
        const theta = Math.atan2(dy, dx) + (t * s.speed);
        const rr = Math.hypot(dx, dy);
        s.x = cx + Math.cos(theta) * rr;
        s.y = cy + Math.sin(theta) * rr * 0.38;

        const pulse = 0.82 + Math.sin(t * 0.0016 + s.phase) * 0.18;
        const alpha = s.opacity * pulse;
        const warm = Math.floor(212 + s.coreMix * 40);
        const cool = Math.floor(220 + (1 - s.coreMix) * 30);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${warm},${cool},255,${alpha})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => {
      resize();
      initStars();
    });

    resize();
    initStars();
    draw();
  }

  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    return new Promise((resolve, reject) => {
      const src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
      let script = document.querySelector(`script[src="${src}"]`);
      if (script && window.THREE) {
        resolve(window.THREE);
        return;
      }
      if (!script) {
        script = document.createElement('script');
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => {
        if (window.THREE) resolve(window.THREE);
        else reject(new Error('THREE not available after load'));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load three.js')), { once: true });
    });
  }

  function createSpiralPoints(THREE) {
    const count = 7500;
    const arms = 4;
    const maxRadius = 180;
    const armTightness = 2.35;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const inner = new THREE.Color(0xfff2ca);
    const mid = new THREE.Color(0x8fc8ff);
    const outer = new THREE.Color(0x5f8bff);

    function randomPow(exponent) {
      return Math.pow(Math.random(), exponent);
    }

    for (let i = 0; i < count; i += 1) {
      const radius = maxRadius * randomPow(1.9);
      const arm = i % arms;
      const armOffset = (Math.PI * 2 * arm) / arms;
      const spiralAngle = radius * 0.075 * armTightness;
      const spread = (Math.random() - 0.5) * (0.55 + radius * 0.025);
      const theta = armOffset + spiralAngle + spread;

      const radialNoise = (Math.random() - 0.5) * (0.8 + radius * 0.05);
      const x = Math.cos(theta) * (radius + radialNoise);
      const z = Math.sin(theta) * (radius + radialNoise);
      const y = (Math.random() - 0.5) * (0.4 + radius * 0.055);

      const p = i * 3;
      positions[p + 0] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;

      const t = Math.min(1, radius / maxRadius);
      const c = t < 0.45
        ? inner.clone().lerp(mid, t / 0.45)
        : mid.clone().lerp(outer, (t - 0.45) / 0.55);
      colors[p + 0] = c.r;
      colors[p + 1] = c.g;
      colors[p + 2] = c.b;

      sizes[i] = 0.9 + (1 - t) * 1.7 + Math.random() * 0.8;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSizeScale: { value: 70.0 },
      },
      vertexShader: `
        attribute float aSize;
        uniform float uSizeScale;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = max(1.0, -mvPosition.z);
          gl_PointSize = max(1.2, aSize * uSizeScale / dist);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = dot(uv, uv);
          if (d > 0.25) discard;
          float core = smoothstep(0.22, 0.0, d);
          float halo = exp(-sqrt(d) * 9.0) * 0.2;
          float a = clamp(core + halo, 0.0, 1.0);
          gl_FragColor = vec4(vColor * (0.55 + core * 0.55), a * 0.85);
        }
      `,
      vertexColors: true,
    });

    return new THREE.Points(geo, material);
  }

  function createCoreStars(THREE) {
    const count = 3200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const p = i * 3;

      const a = Math.random() * Math.PI * 2;
      const b = Math.acos((Math.random() * 2) - 1);
      const coreWeighted = i < Math.floor(count * 0.82);
      const r = coreWeighted
        ? Math.pow(Math.random(), 2.4) * 44
        : (20 + Math.pow(Math.random(), 1.15) * 68);

      const sx = Math.sin(b) * Math.cos(a);
      const sy = Math.cos(b);
      const sz = Math.sin(b) * Math.sin(a);

      positions[p + 0] = sx * r;
      positions[p + 1] = sy * r * (coreWeighted ? 0.42 : 0.56);
      positions[p + 2] = sz * r;

      const warm = 0.82 + Math.random() * 0.18;
      colors[p + 0] = 1.0;
      colors[p + 1] = 0.76 * warm;
      colors[p + 2] = 0.44 * warm;

      sizes[i] = coreWeighted
        ? (2.7 + Math.random() * 3.7)
        : (1.3 + Math.random() * 2.2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPointScale: { value: 64.0 },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPointScale;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = max(1.0, -mvPosition.z);
          gl_PointSize = max(1.4, aSize * uPointScale / dist);
          gl_Position = projectionMatrix * mvPosition;
          vColor = aColor;
          vAlpha = clamp(0.30 + aSize * 0.055, 0.28, 0.74);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2  uv   = gl_PointCoord - vec2(0.5);
          float r2   = dot(uv, uv);
          if (r2 > 0.25) discard;
          float r    = sqrt(r2);
          float core = smoothstep(0.24, 0.0, r2);
          float halo = exp(-r * 7.5) * 0.32;
          gl_FragColor = vec4(vColor * (0.52 + core * 0.68 + halo * 0.45), vAlpha * (core + halo * 0.42));
        }
      `,
    });

    return new THREE.Points(geo, mat);
  }

  function createBackdropStars(THREE) {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const p = i * 3;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      const r = 340 + Math.random() * 520;

      positions[p + 0] = Math.cos(a) * s * r;
      positions[p + 1] = u * r * 0.45;
      positions[p + 2] = Math.sin(a) * s * r;

      const tint = 0.78 + Math.random() * 0.22;
      colors[p + 0] = 0.78 * tint;
      colors[p + 1] = 0.88 * tint;
      colors[p + 2] = 1.0 * tint;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 1.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const points = new THREE.Points(geo, mat);
    points.userData.kind = 'backdrop-stars';
    points.frustumCulled = false;
    return points;
  }

  function runThreeGalaxy(THREE) {
    let rafId = 0;
    let failed = false;
    let firstFrameLogged = false;
    let cleanedUp = false;
    bootLog('info', '3D galaxy active');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040813);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    camera.position.set(0, 92, 255);
    camera.lookAt(0, 0, 0);

    const CAMERA_CHOREO = {
      cycleDurationMinSec: 44,
      cycleDurationMaxSec: 68,
      phaseTraverseShare: 0.38,
      phaseApproachShare: 0.44,
      phaseExitShare: 0.18,
      transitRadius: 235,
      transitHeightJitter: 42,
      approachDistance: 52,
      approachHeightJitter: 30,
      exitDistance: 210,
      exitLateral: 95,
      exitHeightJitter: 44,
      forwardSpinTurnsMin: 1.1,
      forwardSpinTurnsMax: 2.4,
      baseRollAmplitude: 0.14,
      lyPerUnit: 120,
      minLyPerSec: 180,
      maxLyPerSec: 980,
      minRouteSec: 22,
      maxRouteSec: 120,
      targetModeWeights: {
        near: 0.5,
        cluster: 0.3,
        far: 0.2,
      },
    };

    const SHIP_MOTION = {
      posSpring: 1.65,
      posDamping: 2.35,
      lookSpring: 2.0,
      lookDamping: 2.7,
      rollSpring: 7.2,
      rollDamping: 5.9,
      throttleSmoothing: 1.5,
    };

    function easeInOutCubic(x) {
      const t = Math.max(0, Math.min(1, Number(x || 0)));
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function buildBezierBetween(p0, p3, opts = {}) {
      const bend = Number(opts.bend ?? 0.22);
      const upLift = Number(opts.upLift ?? 14);

      const dir = p3.clone().sub(p0);
      const dist = Math.max(1, dir.length());
      const fwd = dir.clone().normalize();
      let side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 0.0001) side = new THREE.Vector3(1, 0, 0);
      side.normalize();

      const c1 = p0.clone()
        .addScaledVector(fwd, dist * 0.33)
        .addScaledVector(side, dist * bend)
        .add(new THREE.Vector3(0, upLift, 0));

      const c2 = p0.clone()
        .addScaledVector(fwd, dist * 0.68)
        .addScaledVector(side, -dist * bend * 0.82)
        .add(new THREE.Vector3(0, upLift * 0.45, 0));

      return new THREE.CubicBezierCurve3(p0.clone(), c1, c2, p3.clone());
    }

    function createCameraDirector(starPoints) {
      const starAttr = starPoints?.geometry?.getAttribute?.('position');
      const starArray = starAttr?.array || null;
      const STAR_GRID_SIZE = 38;
      const state = {
        route: null,
        routeT: 0,
        speedTPerSec: 0.02,
        lastTargetIdx: -1,
        arrivalCooldownSec: 0,
      };

      const makeCellKey = (x, z) => {
        const cx = Math.floor(Number(x || 0) / STAR_GRID_SIZE);
        const cz = Math.floor(Number(z || 0) / STAR_GRID_SIZE);
        return `${cx}:${cz}`;
      };

      const buildStarCatalog = () => {
        if (!starArray || starArray.length < 6) return [];
        const rows = [];
        const cells = new Map();
        for (let idx = 0; idx < starArray.length / 3; idx += 1) {
          const p = idx * 3;
          const x = Number(starArray[p + 0] || 0);
          const y = Number(starArray[p + 1] || 0) * 0.88;
          const z = Number(starArray[p + 2] || 0);
          const radial = Math.hypot(x, z);
          if (radial < 60 || radial > 285) continue;
          const cellKey = makeCellKey(x, z);
          const row = {
            idx,
            pos: new THREE.Vector3(x, y, z),
            radial,
            cellKey,
            clusterScore: 0,
          };
          rows.push(row);
          if (!cells.has(cellKey)) cells.set(cellKey, []);
          cells.get(cellKey).push(row);
        }

        rows.forEach((row) => {
          const [sx, sz] = String(row.cellKey).split(':').map((v) => Number(v));
          let count = 0;
          for (let dx = -1; dx <= 1; dx += 1) {
            for (let dz = -1; dz <= 1; dz += 1) {
              const key = `${sx + dx}:${sz + dz}`;
              const bucket = cells.get(key);
              if (bucket) count += bucket.length;
            }
          }
          row.clusterScore = count;
        });

        return rows;
      };

      const starCatalog = buildStarCatalog();

      const weightedPick = (items) => {
        if (!Array.isArray(items) || !items.length) return null;
        let total = 0;
        for (let i = 0; i < items.length; i += 1) total += Math.max(0.0001, Number(items[i].w || 0));
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i += 1) {
          r -= Math.max(0.0001, Number(items[i].w || 0));
          if (r <= 0) return items[i].v;
        }
        return items[items.length - 1].v;
      };

      const chooseMode = () => {
        const forced = String(starfieldRuntime.targetSelectionMode || '').toLowerCase();
        if (forced === 'near' || forced === 'far' || forced === 'cluster') return forced;
        const weights = CAMERA_CHOREO.targetModeWeights || {};
        return weightedPick([
          { v: 'near', w: Number(weights.near || 0.5) },
          { v: 'cluster', w: Number(weights.cluster || 0.3) },
          { v: 'far', w: Number(weights.far || 0.2) },
        ]) || 'near';
      };

      const pickRandomStar = () => {
        if (!starCatalog.length) {
          return {
            idx: -1,
            pos: new THREE.Vector3((Math.random() - 0.5) * 140, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 140),
            mode: 'near',
          };
        }

        const mode = chooseMode();
        const origin = state.route && state.route.target ? state.route.target.pos : null;
        const currentPos = origin || new THREE.Vector3(0, 0, 0);

        const candidates = [];
        for (let i = 0; i < starCatalog.length; i += 1) {
          const s = starCatalog[i];
          if (s.idx === state.lastTargetIdx) continue;
          const dist = s.pos.distanceTo(currentPos);
          if (dist < 42) continue;

          if (mode === 'near') {
            if (dist > 190) continue;
            const score = Math.max(0.1, 1.15 - dist / 220);
            candidates.push({ v: s, w: score });
            continue;
          }

          if (mode === 'far') {
            if (dist < 180) continue;
            const score = Math.max(0.1, (dist - 150) / 260);
            candidates.push({ v: s, w: score });
            continue;
          }

          if (mode === 'cluster') {
            if (dist < 80 || dist > 290) continue;
            if (s.clusterScore < 12) continue;
            const score = Math.max(0.1, (s.clusterScore - 8) * 0.12) * Math.max(0.35, 1.0 - dist / 360);
            candidates.push({ v: s, w: score });
          }
        }

        const chosen = weightedPick(candidates) || weightedPick(starCatalog.map((s) => ({ v: s, w: 1 })));
        if (chosen) {
          return {
            idx: chosen.idx,
            pos: chosen.pos.clone(),
            mode,
          };
        }

        return {
          idx: -1,
          pos: new THREE.Vector3(0, 12, -145),
          mode,
        };
      };

      const buildRoute = (startPos) => {
        const target = pickRandomStar();
        state.lastTargetIdx = target.idx;

        const toTarget = target.pos.clone().sub(startPos);
        const dist = Math.max(60, toTarget.length());
        const fwd = toTarget.clone().normalize();
        let right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        if (right.lengthSq() < 0.0001) right = new THREE.Vector3(1, 0, 0);
        right.normalize();

        const ingress = startPos.clone()
          .addScaledVector(fwd, dist * (0.42 + Math.random() * 0.12))
          .addScaledVector(right, (Math.random() - 0.5) * Math.min(140, dist * 0.36))
          .add(new THREE.Vector3(0, (Math.random() - 0.5) * 34, 0));

        const nearTarget = target.pos.clone()
          .addScaledVector(fwd, -Math.max(26, Math.min(74, dist * 0.14)))
          .addScaledVector(right, (Math.random() - 0.5) * 26)
          .add(new THREE.Vector3(0, (Math.random() - 0.5) * 18, 0));

        const c1 = buildBezierBetween(startPos, ingress, { bend: 0.2, upLift: 16 });
        const c2 = buildBezierBetween(ingress, nearTarget, { bend: 0.24, upLift: 10 });
        const path = new THREE.CurvePath();
        path.add(c1);
        path.add(c2);

        const pathLengthUnits = Math.max(1, path.getLength());
        const distanceLy = pathLengthUnits * CAMERA_CHOREO.lyPerUnit;

        let minSpeedLy = CAMERA_CHOREO.minLyPerSec;
        let maxSpeedLy = CAMERA_CHOREO.maxLyPerSec;
        if (target.mode === 'near') {
          minSpeedLy *= 0.7;
          maxSpeedLy *= 0.82;
        } else if (target.mode === 'cluster') {
          minSpeedLy *= 0.78;
          maxSpeedLy *= 0.9;
        } else if (target.mode === 'far') {
          minSpeedLy *= 0.95;
          maxSpeedLy *= 1.05;
        }

        const speedLyPerSec = minSpeedLy + Math.random() * Math.max(1, maxSpeedLy - minSpeedLy);
        const speedUnitsPerSec = speedLyPerSec / Math.max(1, CAMERA_CHOREO.lyPerUnit);
        const travelSecBySpeed = pathLengthUnits / Math.max(0.001, speedUnitsPerSec);
        const clampedTravelSec = Math.max(CAMERA_CHOREO.minRouteSec, Math.min(CAMERA_CHOREO.maxRouteSec, travelSecBySpeed));
        const cruise = Math.max(0.006, 1 / clampedTravelSec);

        const spinTurns = CAMERA_CHOREO.forwardSpinTurnsMin + Math.random() * (CAMERA_CHOREO.forwardSpinTurnsMax - CAMERA_CHOREO.forwardSpinTurnsMin);
        bootLog('info', `target=${target.mode} dist=${Math.round(distanceLy)}ly eta=${clampedTravelSec.toFixed(1)}s speed=${Math.round(speedLyPerSec)}ly/s`);
        return {
          path,
          target,
          ingress,
          nearTarget,
          cruiseTPerSec: cruise,
          speedLyPerSec,
          pathLengthUnits,
          distanceLy,
          travelSec: clampedTravelSec,
          rollPhase: Math.random() * Math.PI * 2,
          spinTurns,
          wobbleAmp: 0.015 + Math.random() * 0.02,
          brakeStartDistance: Math.max(45, Math.min(120, dist * 0.28)),
          arrivalDistance: 20 + Math.random() * 10,
        };
      };

      const sampleRoute = (route, progress, t) => {
        const p = Math.max(0, Math.min(1, progress));
        const eased = easeInOutCubic(p);
        const pos = route.path.getPointAt(eased);
        const ahead = route.path.getPointAt(Math.min(1, eased + 0.03 + route.wobbleAmp * 0.4));

        const distToTarget = pos.distanceTo(route.target.pos);
        const brakeZone = Math.max(route.arrivalDistance + 6, route.brakeStartDistance);
        const brakeNorm = Math.max(0, Math.min(1, (distToTarget - route.arrivalDistance) / Math.max(1, brakeZone - route.arrivalDistance)));

        const accelNorm = Math.max(0, Math.min(1, p / 0.22));
        const accel = easeInOutCubic(accelNorm);
        const cruise = 0.92;
        const decel = easeInOutCubic(brakeNorm);
        const throttle = Math.max(0.18, Math.min(1.05, (0.22 + accel * cruise) * decel));

        const lockStrength = 1 - brakeNorm;
        const look = ahead.lerp(route.target.pos.clone(), 0.34 + lockStrength * 0.58);

        const spinShare = Math.max(0, Math.min(1, (p - 0.12) / 0.88));
        const spin = route.spinTurns * spinShare * Math.PI * 2;
        const roll = Math.sin(t * 0.42 + route.rollPhase) * CAMERA_CHOREO.baseRollAmplitude
          + spin * 0.28 * lockStrength
          + Math.sin(t * 0.93 + p * 9.2) * 0.05;

        return {
          pos,
          look,
          roll,
          throttle,
          distToTarget,
          arrivalDistance: route.arrivalDistance,
        };
      };

      return {
        update(timeSec, currentPos, dtSec = 1 / 60) {
          if (!state.route) {
            state.route = buildRoute(currentPos.clone());
            state.routeT = 0;
            state.speedTPerSec = state.route.cruiseTPerSec * 0.25;
          }

          const dt = Math.max(0.001, Math.min(0.05, Number(dtSec || 0.016)));
          if (state.arrivalCooldownSec > 0) state.arrivalCooldownSec = Math.max(0, state.arrivalCooldownSec - dt);

          const currentShot = sampleRoute(state.route, state.routeT, timeSec);
          const targetSpeed = state.route.cruiseTPerSec * (0.35 + currentShot.throttle * 0.85);
          state.speedTPerSec += (targetSpeed - state.speedTPerSec) * Math.min(1, dt * 1.9);
          state.routeT = Math.min(1, state.routeT + state.speedTPerSec * dt);

          const shot = sampleRoute(state.route, state.routeT, timeSec);
          const remainingUnits = Math.max(0, (1 - state.routeT) * state.route.pathLengthUnits);
          const remainingLy = remainingUnits * CAMERA_CHOREO.lyPerUnit;
          const speedUnitsPerSecNow = Math.max(0.0001, state.speedTPerSec * state.route.pathLengthUnits);
          const speedLyPerSecNow = speedUnitsPerSecNow * CAMERA_CHOREO.lyPerUnit;
          const etaSec = remainingLy / Math.max(1, speedLyPerSecNow);

          shot.debug = {
            source: 'procedural',
            mode: String(state.route.target?.mode || 'near'),
            routeProgress: state.routeT,
            distanceRemainingLy: remainingLy,
            etaSec,
            speedLyPerSec: speedLyPerSecNow,
            throttle: Number(shot.throttle || 0),
          };

          const arrived = shot.distToTarget <= shot.arrivalDistance && state.routeT > 0.82;
          if (arrived && state.arrivalCooldownSec <= 0) {
            state.arrivalCooldownSec = 0.5;
            state.route = buildRoute(shot.pos.clone());
            state.routeT = 0;
            state.speedTPerSec *= 0.32;
          }

          return shot;
        },
      };
    }

    function createScriptCameraDirector(script) {
      const cfg = script && typeof script === 'object' ? script : null;
      if (!cfg) return null;
      const shotsRaw = Array.isArray(cfg.shots) ? cfg.shots : [];
      if (!shotsRaw.length) return null;

      const parseVec3 = (value) => {
        if (!Array.isArray(value) || value.length < 3) return null;
        const x = Number(value[0]);
        const y = Number(value[1]);
        const z = Number(value[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return new THREE.Vector3(x, y, z);
      };

      const parseBezier = (value) => {
        if (!Array.isArray(value) || value.length < 4) return null;
        const p0 = parseVec3(value[0]);
        const p1 = parseVec3(value[1]);
        const p2 = parseVec3(value[2]);
        const p3 = parseVec3(value[3]);
        if (!p0 || !p1 || !p2 || !p3) return null;
        return new THREE.CubicBezierCurve3(p0, p1, p2, p3);
      };

      const compiledShots = [];
      for (let i = 0; i < shotsRaw.length; i += 1) {
        const row = shotsRaw[i] || {};
        const durationSec = Math.max(0.5, Number(row.durationSec || row.duration || 6));
        const cameraBezier = parseBezier(row.cameraBezier || row.positionBezier || row.position || null);
        const lookAtBezier = parseBezier(row.lookAtBezier || row.targetBezier || row.lookAt || null);
        if (!cameraBezier || !lookAtBezier) continue;

        const rollFrom = Number(row.roll?.from ?? row.rollFrom ?? 0);
        const rollTo = Number(row.roll?.to ?? row.rollTo ?? rollFrom);
        const rollNoiseAmp = Math.max(0, Number(row.roll?.noiseAmp ?? row.rollNoiseAmp ?? 0));
        const rollNoiseFreq = Math.max(0, Number(row.roll?.noiseFreq ?? row.rollNoiseFreq ?? 0.5));

        const fovFrom = Math.max(18, Math.min(90, Number(row.fov?.from ?? row.fovFrom ?? camera.fov)));
        const fovTo = Math.max(18, Math.min(90, Number(row.fov?.to ?? row.fovTo ?? fovFrom)));

        compiledShots.push({
          durationSec,
          cameraBezier,
          lookAtBezier,
          rollFrom,
          rollTo,
          rollNoiseAmp,
          rollNoiseFreq,
          fovFrom,
          fovTo,
          easing: String(row.easing || 'easeInOutCubic'),
        });
      }

      if (!compiledShots.length) return null;

      const loop = cfg.loop !== false;
      const totalDuration = compiledShots.reduce((sum, shot) => sum + shot.durationSec, 0);
      const localEase = (x, name) => {
        const t = Math.max(0, Math.min(1, Number(x || 0)));
        const key = String(name || 'easeInOutCubic').toLowerCase();
        if (key === 'linear') return t;
        if (key === 'easein') return t * t;
        if (key === 'easeout') return 1 - (1 - t) * (1 - t);
        return easeInOutCubic(t);
      };

      return {
        update(timeSec) {
          if (totalDuration <= 0.001) return null;

          let cursor = loop
            ? ((Number(timeSec || 0) % totalDuration) + totalDuration) % totalDuration
            : Math.max(0, Math.min(totalDuration, Number(timeSec || 0)));

          let selected = compiledShots[compiledShots.length - 1];
          for (let i = 0; i < compiledShots.length; i += 1) {
            const shot = compiledShots[i];
            if (cursor <= shot.durationSec || i === compiledShots.length - 1) {
              selected = shot;
              break;
            }
            cursor -= shot.durationSec;
          }

          const tNorm = localEase(cursor / Math.max(0.001, selected.durationSec), selected.easing);
          const pos = selected.cameraBezier.getPoint(tNorm);
          const look = selected.lookAtBezier.getPoint(tNorm);
          const roll = selected.rollFrom + (selected.rollTo - selected.rollFrom) * tNorm
            + Math.sin(timeSec * selected.rollNoiseFreq) * selected.rollNoiseAmp;
          const fov = selected.fovFrom + (selected.fovTo - selected.fovFrom) * tNorm;
          const throttle = Math.max(0.15, Math.min(1.25, Number(selected.throttle ?? 0.6)));

          return {
            pos,
            look,
            roll,
            fov,
            throttle,
            debug: {
              source: 'script',
              mode: 'script',
              routeProgress: tNorm,
              distanceRemainingLy: NaN,
              etaSec: NaN,
              speedLyPerSec: NaN,
              throttle,
            },
          };
        },
      };
    }

    function createNearbyStarPlaques(starPoints) {
      const attr = starPoints?.geometry?.getAttribute?.('position');
      const count = Number(attr?.count || 0);
      if (!attr || count <= 0) {
        return { update() {}, dispose() {} };
      }

      const wrap = document.createElement('div');
      wrap.id = 'starfield-plaques';
      wrap.setAttribute('aria-hidden', 'true');
      wrap.style.position = 'fixed';
      wrap.style.inset = '0';
      wrap.style.pointerEvents = 'none';
      wrap.style.zIndex = '4';
      document.body.appendChild(wrap);

      const namesA = ['Astra', 'Vela', 'Rhea', 'Neris', 'Luma', 'Orion', 'Nyx', 'Aegis', 'Draco', 'Altair'];
      const namesB = ['Prime', 'Gate', 'Echo', 'Spire', 'Nova', 'Harbor', 'Ridge', 'Beacon', 'Drift', 'Arc'];

      const pool = new Map();
      let nextScanAt = 0;

      const ensureLabel = (idx) => {
        if (pool.has(idx)) return pool.get(idx);
        const node = document.createElement('div');
        node.style.position = 'absolute';
        node.style.transform = 'translate(-50%, -50%)';
        node.style.padding = '4px 8px';
        node.style.border = '1px solid rgba(120, 190, 255, 0.45)';
        node.style.borderRadius = '8px';
        node.style.background = 'rgba(7, 20, 40, 0.58)';
        node.style.color = '#cfe7ff';
        node.style.fontSize = '11px';
        node.style.fontWeight = '600';
        node.style.letterSpacing = '0.02em';
        node.style.boxShadow = '0 0 0 1px rgba(120,190,255,0.16) inset, 0 8px 20px rgba(0,0,0,0.35)';
        node.style.whiteSpace = 'nowrap';
        node.style.backdropFilter = 'blur(3px)';
        wrap.appendChild(node);
        pool.set(idx, node);
        return node;
      };

      const buildName = (idx) => {
        const a = namesA[idx % namesA.length];
        const b = namesB[Math.floor(idx / namesA.length) % namesB.length];
        return `${a} ${b}-${(idx % 97) + 3}`;
      };

      const tmpWorld = new THREE.Vector3();
      const tmpNdc = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      const toStar = new THREE.Vector3();

      return {
        update(timeSec, cameraRef) {
          if (!cameraRef || document.body.classList.contains('game-page')) {
            pool.forEach((node) => { node.style.display = 'none'; });
            return;
          }

          if (timeSec < nextScanAt) return;
          nextScanAt = timeSec + 0.18;

          cameraRef.getWorldDirection(camDir);

          const hits = [];
          for (let i = 0; i < count; i += 3) {
            tmpWorld.fromBufferAttribute(attr, i);
            tmpWorld.applyMatrix4(starPoints.matrixWorld);

            toStar.copy(tmpWorld).sub(cameraRef.position);
            const dist = toStar.length();
            if (dist < 12 || dist > 145) continue;

            const facing = toStar.normalize().dot(camDir);
            if (facing < 0.58) continue;

            tmpNdc.copy(tmpWorld).project(cameraRef);
            if (tmpNdc.z < -1 || tmpNdc.z > 1) continue;
            if (Math.abs(tmpNdc.x) > 0.94 || Math.abs(tmpNdc.y) > 0.92) continue;

            hits.push({
              idx: i,
              dist,
              ndcX: tmpNdc.x,
              ndcY: tmpNdc.y,
            });
          }

          hits.sort((a, b) => a.dist - b.dist);
          const chosen = hits.slice(0, 6);
          const active = new Set(chosen.map((h) => h.idx));

          chosen.forEach((hit) => {
            const node = ensureLabel(hit.idx);
            const x = (hit.ndcX * 0.5 + 0.5) * window.innerWidth;
            const y = (-hit.ndcY * 0.5 + 0.5) * window.innerHeight;
            const alpha = Math.max(0.38, Math.min(0.95, 1 - (hit.dist - 12) / 160));
            node.style.display = 'block';
            node.style.left = `${x.toFixed(1)}px`;
            node.style.top = `${y.toFixed(1)}px`;
            node.style.opacity = alpha.toFixed(2);
            node.textContent = `${buildName(hit.idx)} · ${Math.round(hit.dist)}u`;
          });

          pool.forEach((node, idx) => {
            if (!active.has(idx)) node.style.display = 'none';
          });
        },
        dispose() {
          try { wrap.remove(); } catch (_) {}
          pool.clear();
        },
      };
    }

    function createFlightHud() {
      let enabled = false;
      try {
        const host = String(window.location?.hostname || '').toLowerCase();
        const localHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
        const query = new URLSearchParams(window.location.search || '');
        const q = query.get('starHud') === '1';
        const ls = localStorage.getItem('gq_starfield_hud') === '1';
        enabled = !!(localHost || q || ls);
      } catch (_) {}

      const hud = document.createElement('div');
      hud.id = 'starfield-flight-hud';
      hud.setAttribute('aria-hidden', 'true');
      hud.style.position = 'fixed';
      hud.style.left = '12px';
      hud.style.top = '12px';
      hud.style.minWidth = '260px';
      hud.style.maxWidth = '420px';
      hud.style.padding = '10px 12px';
      hud.style.borderRadius = '10px';
      hud.style.background = 'rgba(8, 16, 34, 0.68)';
      hud.style.border = '1px solid rgba(114, 174, 255, 0.42)';
      hud.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35)';
      hud.style.backdropFilter = 'blur(5px)';
      hud.style.color = '#d9edff';
      hud.style.fontFamily = 'Consolas, Menlo, monospace';
      hud.style.fontSize = '12px';
      hud.style.lineHeight = '1.35';
      hud.style.pointerEvents = 'none';
      hud.style.zIndex = '6';
      hud.style.display = enabled ? 'block' : 'none';
      document.body.appendChild(hud);

      let nextUpdateAt = 0;
      const fmt = (n, digits = 0) => Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '-';
      const targetModeOrder = ['mixed', 'near', 'cluster', 'far'];

      const onKeyDown = (ev) => {
        const target = ev.target;
        if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
          return;
        }
        const key = String(ev.key || '').toLowerCase();
        if (!key) return;

        if (key === 'h') {
          enabled = !enabled;
          try {
            localStorage.setItem('gq_starfield_hud', enabled ? '1' : '0');
          } catch (_) {}
          hud.style.display = enabled ? 'block' : 'none';
          bootLog('info', `flight hud ${enabled ? 'enabled' : 'disabled'} (hotkey H)`);
          return;
        }

        if (key === 'm') {
          const current = String(starfieldRuntime.targetSelectionMode || 'mixed').toLowerCase();
          const idx = Math.max(0, targetModeOrder.indexOf(current));
          const nextMode = targetModeOrder[(idx + 1) % targetModeOrder.length];
          starfieldRuntime.targetSelectionMode = nextMode;
          bootLog('info', `target mode -> ${nextMode} (hotkey M)`);
        }
      };
      window.addEventListener('keydown', onKeyDown);

      return {
        update(timeSec, shot, shipStateRef) {
          if (!enabled || !shot || document.body.classList.contains('game-page')) {
            hud.style.display = 'none';
            return;
          }
          hud.style.display = 'block';
          if (timeSec < nextUpdateAt) return;
          nextUpdateAt = timeSec + 0.1;

          const dbg = shot.debug || {};
          const mode = String(dbg.mode || 'n/a');
          const src = String(dbg.source || 'n/a');
          const progress = Number(dbg.routeProgress || 0) * 100;
          const distLy = Number(dbg.distanceRemainingLy);
          const etaSec = Number(dbg.etaSec);
          const speedLy = Number(dbg.speedLyPerSec);
          const throttle = Number.isFinite(Number(dbg.throttle)) ? Number(dbg.throttle) : Number(shipStateRef?.throttle || 0);

          hud.innerHTML = [
            '<strong>Flight HUD</strong>',
            `source: ${src}`,
            `mode: ${mode}`,
            `progress: ${fmt(progress, 1)}%`,
            `remaining: ${Number.isFinite(distLy) ? `${fmt(distLy, 0)} ly` : '-'}`,
            `eta: ${Number.isFinite(etaSec) ? `${fmt(etaSec, 1)} s` : '-'}`,
            `speed: ${Number.isFinite(speedLy) ? `${fmt(speedLy, 0)} ly/s` : '-'}`,
            `throttle: ${fmt(throttle, 2)}`,
            'hotkeys: H=HUD, M=Mode',
          ].join('<br />');
        },
        dispose() {
          try { window.removeEventListener('keydown', onKeyDown); } catch (_) {}
          try { hud.remove(); } catch (_) {}
        },
      };
    }

    let cameraDirector = null;
    let scriptDirector = null;
    let scriptDirectorRevision = -1;
    let starPlaques = null;
    let flightHud = null;
    let lastFrameSec = 0;
    const shipState = {
      pos: camera.position.clone(),
      vel: new THREE.Vector3(),
      look: new THREE.Vector3(0, 0, 0),
      lookVel: new THREE.Vector3(),
      roll: 0,
      rollVel: 0,
      throttle: 0.45,
    };

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // ── Post-Processing Effects ────────────────────────────────────────────
    let postEffects = null;
    if (typeof PostEffectsManager !== 'undefined') {
      postEffects = new PostEffectsManager(renderer, scene, camera);
      bootLog('info', 'Post-processing effects enabled');
    }

    // ── Lighting (same as gameplay galaxy) ──────────────────────────────────
    const ambient = new THREE.AmbientLight(0x9bb5ff, 0.62);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xdde8ff, 1.18);
    key.position.set(240, 280, 190);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x6da6ff, 0.28);
    fill.position.set(-180, -90, -220);
    scene.add(fill);

    const galaxyGroup = new THREE.Group();
    scene.add(galaxyGroup);

    // Shader-independent safety layer: always-visible star volume.
    const backdropStars = createBackdropStars(THREE);
    scene.add(backdropStars);

    const stars = createSpiralPoints(THREE);
    galaxyGroup.add(stars);

    const coreStars = createCoreStars(THREE);
    galaxyGroup.add(coreStars);

    cameraDirector = createCameraDirector(stars);
    starPlaques = createNearbyStarPlaques(stars);
    flightHud = createFlightHud();
    tryLoadStoredChoreographyScript();

    // ── Black Hole + Photon Sphere (Galactic Core) ───────────────────────────
    const bhMesh = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 28, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    bhMesh.userData.kind = 'black-hole';
    galaxyGroup.add(bhMesh);

    // ── Photon sphere with relativistic lensing glow ──────────────────────────
    const lensMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff8822) },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3  uColor;
        uniform float uTime;
        varying vec3  vNormal;
        void main() {
          float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
          rim = pow(rim, 3.2);
          float flicker = 0.88 + 0.12 * sin(uTime * 1.7 + vNormal.x * 4.2);
          gl_FragColor = vec4(uColor * flicker, rim * 0.72);
        }`,
    });
    const lensGlow = new THREE.Mesh(new THREE.SphereGeometry(5.6, 22, 22), lensMat);
    lensGlow.userData.kind = 'bh-lens';
    galaxyGroup.add(lensGlow);

    // ── Galaxy background disk with 4-arm spiral shader ──────────────────────
    const diskGlowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUV;
        void main() {
          vUV = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2  vUV;
        void main() {
          vec2  uv    = vUV * 2.0 - 1.0;
          float r     = length(uv);
          if (r > 1.0) discard;
          float theta = atan(uv.y, uv.x);

          float b        = 0.2493;
          float armPhase = 4.0 * theta - (4.0 / b) * log(max(r, 0.001));
          float armNear  = pow(max(0.0, 0.5 + 0.5 * cos(armPhase)), 7.0);
          float armMask  = smoothstep(0.06, 0.15, r) * smoothstep(0.97, 0.52, r);
          float armGlow  = armNear * armMask;

          float bulgeCore = exp(-r * 9.0);
          float bulgeWide = exp(-r * 3.0) * 0.48;
          float bulge     = bulgeCore + bulgeWide;

          float diskHaze  = smoothstep(1.0, 0.25, r) * 0.05;

          vec3 cBulge = vec3(1.00, 0.72, 0.33);
          vec3 cArm   = vec3(0.45, 0.66, 1.00);
          vec3 cDisk  = vec3(0.20, 0.28, 0.58);

          vec3 color  = mix(cDisk, cArm, armGlow * 0.92);
          color       = mix(color, cBulge, clamp(bulge * 1.5, 0.0, 1.0));

          float intensity = bulge * 0.68 + armGlow * (1.0 - bulgeCore) * 0.44 + diskHaze;
          float alpha     = clamp(intensity * 0.50, 0.0, 0.60);
          if (alpha < 0.002) discard;

          gl_FragColor = vec4(color * intensity, alpha);
        }`,
    });

    const diskGeo  = new THREE.CircleGeometry(1390.0, 192);
    const diskMesh = new THREE.Mesh(diskGeo, diskGlowMat);
    diskMesh.rotation.x    = -Math.PI / 2;
    diskMesh.renderOrder   = -2;
    diskMesh.userData.kind = 'galaxy-disk-glow';
    diskMesh.frustumCulled = false;
    galaxyGroup.add(diskMesh);

    // ── Centre-bulge glow sprites (multi-layer soft diffraction glow) ─────────
    const glowLayers = [
      { sceneRadius: 590, rgb: [255, 228, 142], peakA: 0.09 },
      { sceneRadius: 295, rgb: [255, 242, 182], peakA: 0.18 },
      { sceneRadius: 122, rgb: [255, 252, 222], peakA: 0.35 },
      { sceneRadius:  38, rgb: [255, 255, 252], peakA: 0.64 },
    ];
    glowLayers.forEach((layer) => {
      const sz  = 256;
      const cvs = document.createElement('canvas');
      cvs.width = sz; cvs.height = sz;
      const ctx = cvs.getContext('2d');
      const cx  = sz / 2;
      const [r, g, b] = layer.rgb;
      const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
      grad.addColorStop(0,    `rgba(${r},${g},${b},${layer.peakA.toFixed(3)})`);
      grad.addColorStop(0.30, `rgba(${r},${g},${b},${(layer.peakA * 0.36).toFixed(3)})`);
      grad.addColorStop(0.65, `rgba(${r},${g},${b},${(layer.peakA * 0.07).toFixed(3)})`);
      grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, sz, sz);
      const tex = new THREE.CanvasTexture(cvs);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(layer.sceneRadius);
      sprite.renderOrder   = -1;
      sprite.frustumCulled = false;
      sprite.userData.kind = 'galaxy-center-glow';
      galaxyGroup.add(sprite);
    });

    function resize() {
      const w = Math.max(320, window.innerWidth);
      const h = Math.max(220, window.innerHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (postEffects) {
        postEffects.resize(w, h);
      }
    }

    function animate() {
      if (failed || document.body.classList.contains('game-page') || starfieldRuntime.releaseRequested) {
        cancelAnimationFrame(rafId);
        cleanup();
        return;
      }
      rafId = requestAnimationFrame(animate);
      const t = performance.now() * 0.001;
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        bootLog('info', '3D frame loop started');
      }

      const dt = Math.min(0.05, Math.max(0.001, lastFrameSec > 0 ? (t - lastFrameSec) : 1 / 60));
      lastFrameSec = t;

      const runtimeRev = Number(starfieldRuntime.choreographyRevision || 0);
      if (runtimeRev !== scriptDirectorRevision) {
        scriptDirectorRevision = runtimeRev;
        scriptDirector = createScriptCameraDirector(starfieldRuntime.choreographyScript);
        if (scriptDirector) bootLog('info', 'external choreography script activated');
      }

      const scriptedShot = scriptDirector ? scriptDirector.update(t) : null;
      const shot = scriptedShot || (cameraDirector
        ? cameraDirector.update(t, camera.position, dt)
        : {
          pos: camera.position.clone(),
          look: new THREE.Vector3(0, 0, 0),
          roll: 0,
          throttle: 0.45,
        });

      const bob = Math.sin(t * 0.58) * 1.8;
      shot.pos.y += bob;

      const targetThrottle = Math.max(0.18, Math.min(1.3, Number(shot.throttle ?? 0.58)));
      shipState.throttle += (targetThrottle - shipState.throttle) * Math.min(1, dt * SHIP_MOTION.throttleSmoothing);
      const inertia = 0.65 + shipState.throttle * 0.85;

      const posAccel = shot.pos.clone()
        .sub(shipState.pos)
        .multiplyScalar(SHIP_MOTION.posSpring * inertia)
        .addScaledVector(shipState.vel, -SHIP_MOTION.posDamping * inertia);
      shipState.vel.addScaledVector(posAccel, dt);
      shipState.pos.addScaledVector(shipState.vel, dt);

      const lookAccel = shot.look.clone()
        .sub(shipState.look)
        .multiplyScalar(SHIP_MOTION.lookSpring * inertia)
        .addScaledVector(shipState.lookVel, -SHIP_MOTION.lookDamping * inertia);
      shipState.lookVel.addScaledVector(lookAccel, dt);
      shipState.look.addScaledVector(shipState.lookVel, dt);

      const targetRoll = Number(shot.roll || 0);
      const rollAccel = ((targetRoll - shipState.roll) * SHIP_MOTION.rollSpring * inertia)
        - (shipState.rollVel * SHIP_MOTION.rollDamping * inertia);
      shipState.rollVel += rollAccel * dt;
      shipState.roll += shipState.rollVel * dt;

      camera.position.copy(shipState.pos);

      if (Number.isFinite(Number(shot.fov))) {
        const nextFov = Math.max(18, Math.min(90, Number(shot.fov)));
        if (Math.abs(camera.fov - nextFov) > 0.01) {
          camera.fov = nextFov;
          camera.updateProjectionMatrix();
        }
      }

      const forward = shipState.look.clone().sub(shipState.pos).normalize();
      const baseUp = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(forward, baseUp).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(right, forward).normalize();
      camera.up.copy(correctedUp.applyAxisAngle(forward, shipState.roll));
      camera.lookAt(shipState.look);

      if (starPlaques && typeof starPlaques.update === 'function') {
        starPlaques.update(t, camera);
      }
      if (flightHud && typeof flightHud.update === 'function') {
        flightHud.update(t, shot, shipState);
      }

      galaxyGroup.rotation.y -= 0.0009;
      galaxyGroup.rotation.z = Math.sin(t * 0.16) * 0.03;
      backdropStars.rotation.y += 0.00008;

      // Update shader uniforms for time-based effects
      galaxyGroup.children.forEach((child) => {
        if (child.material?.uniforms?.uTime) {
          child.material.uniforms.uTime.value = t;
        }
      });

      try {
        if (postEffects) {
          postEffects.render();
        } else {
          renderer.render(scene, camera);
        }
      } catch (_) {
        failed = true;
        bootLog('error', '3D render failed, switching to 2D fallback');
        cleanup();
        run2DStarFallback();
      }
    }

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        if (starPlaques && typeof starPlaques.dispose === 'function') starPlaques.dispose();
      } catch (_) {}
      try {
        if (flightHud && typeof flightHud.dispose === 'function') flightHud.dispose();
      } catch (_) {}
      try {
        if (postEffects) postEffects.dispose();
      } catch (_) {}
      try {
        renderer.dispose();
      } catch (_) {}
      starfieldRuntime.released = true;
      starfieldRuntime.release = null;
    }

    starfieldRuntime.release = cleanup;

    window.addEventListener('resize', resize);
    resize();
    animate();
  }

  loadThree()
    .then((THREE) => {
      if (!THREE || document.body.classList.contains('game-page') || starfieldRuntime.releaseRequested) return;
      runThreeGalaxy(THREE);
    })
    .catch((err) => {
      bootLog('warn', `three.js unavailable, using 2D fallback (${String(err && err.message ? err.message : err)})`);
      run2DStarFallback();
    });
})();
