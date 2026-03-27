/*
 * GalaxyQuest 3D galaxy renderer
 * Uses Three.js for scene management plus explicit MVP matrix projection for UI overlays.
 */
(function () {
  class BasicOrbitControls {
    constructor(camera) {
      this.camera = camera;
      this.target = new THREE.Vector3(0, 0, 0);
      this.enableDamping = false;
      this.dampingFactor = 0.08;
      this.minDistance = 40;
      this.maxDistance = 2400;
      this.dragging = false;
    }

    update() {
      const dir = this.camera.position.clone().sub(this.target);
      const dist = dir.length();
      if (dist > this.maxDistance) {
        dir.setLength(this.maxDistance);
        this.camera.position.copy(this.target.clone().add(dir));
      } else if (dist < this.minDistance) {
        dir.setLength(this.minDistance);
        this.camera.position.copy(this.target.clone().add(dir));
      }
      this.camera.lookAt(this.target);
    }

    dispose() {}
  }

  class Galaxy3DRenderer {
    constructor(container, opts = {}) {
      if (!container) throw new Error('Galaxy3DRenderer: missing container');
      if (!window.THREE) throw new Error('Galaxy3DRenderer: THREE not loaded');

      this.container = container;
      this.opts = Object.assign({
        onHover: null,
        onClick: null,
        onDoubleClick: null,
      }, opts);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x050a1a);

      const w = Math.max(320, container.clientWidth);
      const h = Math.max(220, container.clientHeight);

      this.camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 5000);
      this.camera.position.set(0, 220, 620);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(this.renderer.domElement);

      const hasOrbitControls = typeof THREE.OrbitControls === 'function';
      this.hasExternalOrbitControls = hasOrbitControls;
      this.controls = hasOrbitControls
        ? new THREE.OrbitControls(this.camera, this.renderer.domElement)
        : new BasicOrbitControls(this.camera);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 40;
      this.controls.maxDistance = 2400;
      this.controls.target.set(0, 0, 0);

      this.raycaster = new THREE.Raycaster();
      this.raycaster.params.Points.threshold = 8;
      this.pointer = new THREE.Vector2();

      this.clock = new THREE.Clock();
      this.stars = [];
      this.visibleStars = [];
      this.visibleToRawIndex = [];
      this.starPoints = null;
      this.selectedIndex = -1;
      this.hoverIndex = -1;
      this.focusTarget = null;
      this.systemMode = false;
      this.systemSourceStar = null;
      this.systemPlanetEntries = [];
      this.systemFacilityEntries = [];
      this.systemFleetEntries = [];
      this.clusterAuraEntries = [];
      this.clusterSummaryData = [];
      this.empireHeartbeatFactionId = null;
      this.empireHeartbeatSystems = new Set();
      this.heartbeatPhase = 0;
      this.systemHoverEntry = null;
      this.systemSelectedEntry = null;
      this.autoTransitionCooldownUntil = 0;
      this.zoomThresholds = {
        galaxyEnterSystem: 150,
        galaxyResetSystem: 185,
        systemEnterPlanet: 54,
        systemResetPlanet: 74,
        planetExitToSystem: 96,
        planetResetExit: 70,
        systemExitToGalaxy: 305,
        systemResetExit: 250,
      };
      this.autoTransitionArmed = {
        galaxyEnterSystem: true,
        systemEnterPlanet: true,
        planetExitToSystem: true,
        systemExitToGalaxy: true,
      };
      this.followSelectionEnabled = true;
      this.focusDamping = {
        galaxy: 1.65,
        system: 2.1,
        planet: 2.65,
      };
      this.destroyed = false;
      this.prevCamPos = this.camera.position.clone();
      this.cameraVelocity = new THREE.Vector3();
      this.autoFrameEnabled = true;
      this._kbdMove = { forward: false, back: false, left: false, right: false, up: false, down: false, panL: false, panR: false, panU: false, panD: false };

      this._setupScene();
      this._bindEvents();
      this._onResize();
      this._animate();
    }

    _setupScene() {
      const hemi = new THREE.HemisphereLight(0x7ca8ff, 0x10182d, 0.8);
      this.scene.add(hemi);

      const dir = new THREE.DirectionalLight(0xaed0ff, 0.55);
      dir.position.set(150, 220, 120);
      this.scene.add(dir);

      this._buildGalaxyCoreStars();

      const haloGeo = new THREE.RingGeometry(30, 110, 96);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x2a5bb3,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
      });
      this.halo = new THREE.Mesh(haloGeo, haloMat);
      this.halo.rotation.x = Math.PI / 2;
      this.scene.add(this.halo);

      const grid = new THREE.GridHelper(1200, 24, 0x244b83, 0x13243f);
      grid.position.y = -120;
      grid.material.opacity = 0.13;
      grid.material.transparent = true;
      this.grid = grid;
      this.scene.add(grid);

      this.clusterAuraGroup = new THREE.Group();
      this.clusterAuraGroup.visible = true;
      this.scene.add(this.clusterAuraGroup);

      this._buildHoverMarker();
      this._buildSystemScene();
    }

    _buildSystemScene() {
      this.systemGroup = new THREE.Group();
      this.systemGroup.visible = false;
      this.systemBackdrop = new THREE.Group();
      this.systemOrbitGroup = new THREE.Group();
      this.systemBodyGroup = new THREE.Group();
      this.systemFacilityGroup = new THREE.Group();
      this.systemFleetGroup = new THREE.Group();
      this.systemGroup.add(this.systemBackdrop);
      this.systemGroup.add(this.systemOrbitGroup);
      this.systemGroup.add(this.systemBodyGroup);
      this.systemGroup.add(this.systemFacilityGroup);
      this.systemGroup.add(this.systemFleetGroup);
      this.scene.add(this.systemGroup);
    }

    _buildGalaxyCoreStars() {
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
          uPointScale: { value: this.renderer.getPixelRatio() * 64.0 },
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
            vec2 uv = gl_PointCoord - vec2(0.5);
            float r2 = dot(uv, uv);
            if (r2 > 0.25) discard;
            float core = smoothstep(0.24, 0.0, r2);
            gl_FragColor = vec4(vColor * (0.52 + core * 0.68), vAlpha * core);
          }
        `,
      });

      this.coreStars = new THREE.Points(geo, mat);
      this.coreStars.frustumCulled = false;
      this.scene.add(this.coreStars);
    }

    _buildHoverMarker() {
      const size = 96;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const center = size / 2;
      ctx.clearRect(0, 0, size, size);

      ctx.beginPath();
      ctx.arc(center, center, size * 0.29, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(122, 194, 255, 0.72)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(center, center, size * 0.14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(214, 238, 255, 0.52)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        color: 0xffffff,
      });

      this.hoverMarker = new THREE.Sprite(material);
      this.hoverMarker.visible = false;
      this.hoverMarker.renderOrder = 20;
      this.scene.add(this.hoverMarker);
    }

    _spectralColorHex(spectralClass) {
      const cls = String(spectralClass || '').toUpperCase();
      const colors = {
        O: 0x9bb0ff,
        B: 0xaabfff,
        A: 0xcad7ff,
        F: 0xf8f7ff,
        G: 0xfff4ea,
        K: 0xffd2a1,
        M: 0xffcc6f,
      };
      return colors[cls] || 0xd8e6ff;
    }

    _clearGroup(group) {
      if (!group) return;
      while (group.children.length) {
        const child = group.children.pop();
        group.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m?.dispose?.());
        else if (child.material) {
          child.material.map?.dispose?.();
          child.material.dispose?.();
        }
      }
    }

    _planetColor(planetClass) {
      const cls = String(planetClass || '').toLowerCase();
      if (cls.includes('gas')) return 0xd6a56f;
      if (cls.includes('ice giant')) return 0x7fc7d9;
      if (cls.includes('ice') || cls.includes('frozen')) return 0x9bc7e8;
      if (cls.includes('lava') || cls.includes('volcan')) return 0xd86d46;
      if (cls.includes('desert')) return 0xc9ad6a;
      if (cls.includes('ocean')) return 0x4aa0d8;
      if (cls.includes('toxic')) return 0x8db255;
      if (cls.includes('barren') || cls.includes('rocky')) return 0x8f8173;
      if (cls.includes('terra') || cls.includes('hab')) return 0x6ebf72;
      return 0x9aa7b8;
    }

    _planetSize(body, fallbackIndex) {
      const diameter = Number(body?.diameter || 0);
      const cls = String(body?.planet_class || '').toLowerCase();
      if (diameter > 0) {
        const scale = cls.includes('gas') ? 7000 : 10500;
        const max = cls.includes('gas') ? 14.5 : 10.8;
        return THREE.MathUtils.clamp(2.6 + diameter / scale, 2.6, max);
      }
      if (cls.includes('gas')) return 8.6 + (fallbackIndex % 3) * 1.1;
      if (cls.includes('ice')) return 5.4 + (fallbackIndex % 2) * 0.7;
      return 3 + (fallbackIndex % 4) * 0.85;
    }

    _facilityColor(category) {
      const key = String(category || '').toLowerCase();
      if (key.includes('defense')) return 0xff8f70;
      if (key.includes('energy')) return 0x8fd9ff;
      if (key.includes('industry')) return 0xd5b06c;
      return 0xa6c3ff;
    }

    _fleetColor(mission) {
      const key = String(mission || '').toLowerCase();
      if (key === 'attack') return 0xff7a66;
      if (key === 'spy') return 0x7fd0ff;
      if (key === 'transport') return 0xb7d98c;
      if (key === 'colonize') return 0x8fe7b4;
      return 0xd9d4a8;
    }

    _clusterAuraColor(cluster) {
      const color = String(cluster?.faction?.color || '#6a8cc9');
      const value = Number.parseInt(color.replace('#', ''), 16);
      return Number.isFinite(value) ? value : 0x6a8cc9;
    }

    setClusterAuras(clusters) {
      this.clusterSummaryData = Array.isArray(clusters) ? clusters.slice() : [];
      this._rebuildClusterAuras();
      this._applyEmpireHeartbeatMask();
    }

    setEmpireHeartbeatFaction(factionId) {
      const next = Number(factionId || 0);
      this.empireHeartbeatFactionId = next > 0 ? next : null;
      this._applyEmpireHeartbeatMask();
    }

    _applyEmpireHeartbeatMask() {
      this.empireHeartbeatSystems = new Set();
      const factionId = Number(this.empireHeartbeatFactionId || 0);
      if (!factionId || !Array.isArray(this.clusterSummaryData)) {
        const attr = this.starPoints?.geometry?.getAttribute('aEmpire');
        if (attr) {
          for (let i = 0; i < attr.count; i++) attr.setX(i, 0);
          attr.needsUpdate = true;
        }
        if (this.starPoints?.material?.uniforms?.uHeartbeatStrength) {
          this.starPoints.material.uniforms.uHeartbeatStrength.value = 0;
        }
        return;
      }

      this.clusterSummaryData.forEach((cluster) => {
        if (Number(cluster?.faction?.id || 0) !== factionId) return;
        const systems = Array.isArray(cluster?.systems)
          ? cluster.systems.map((n) => Number(n || 0)).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        if (systems.length) {
          systems.forEach((systemIndex) => this.empireHeartbeatSystems.add(systemIndex));
          return;
        }
        const from = Math.max(1, Number(cluster?.from || 0));
        const to = Math.max(from, Number(cluster?.to || from));
        for (let systemIndex = from; systemIndex <= to; systemIndex++) {
          this.empireHeartbeatSystems.add(systemIndex);
        }
      });

      const attr = this.starPoints?.geometry?.getAttribute('aEmpire');
      if (attr && Array.isArray(this.visibleStars)) {
        for (let i = 0; i < attr.count; i++) {
          const systemIndex = Number(this.visibleStars[i]?.system_index || 0);
          attr.setX(i, this.empireHeartbeatSystems.has(systemIndex) ? 1 : 0);
        }
        attr.needsUpdate = true;
      }
      if (this.starPoints?.material?.uniforms?.uHeartbeatStrength) {
        this.starPoints.material.uniforms.uHeartbeatStrength.value = this.empireHeartbeatSystems.size ? 1 : 0;
      }
    }

    _rebuildClusterAuras() {
      this.clusterAuraEntries = [];
      this._clearGroup(this.clusterAuraGroup);
      if (!Array.isArray(this.stars) || !this.stars.length) return;
      if (!Array.isArray(this.clusterSummaryData) || !this.clusterSummaryData.length) return;

      const scale = 0.028;
      const bySystem = new Map();
      this.stars.forEach((star) => {
        const systemIndex = Number(star.system_index || 0);
        if (!Number.isFinite(systemIndex) || systemIndex <= 0) return;
        if (!bySystem.has(systemIndex)) bySystem.set(systemIndex, []);
        bySystem.get(systemIndex).push(star);
      });
      this.clusterSummaryData.forEach((cluster, index) => {
        const systems = Array.isArray(cluster?.systems)
          ? cluster.systems.map((n) => Number(n || 0)).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        let starsInRange = [];
        if (systems.length) {
          systems.forEach((systemIndex) => {
            starsInRange.push(...(bySystem.get(systemIndex) || []));
          });
        } else {
          const from = Number(cluster?.from || 0);
          const to = Number(cluster?.to || 0);
          if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
          starsInRange = this.stars.filter((star) => {
            const systemIndex = Number(star.system_index || 0);
            return systemIndex >= from && systemIndex <= to;
          });
        }
        if (!starsInRange.length) return;
        const color = this._clusterAuraColor(cluster);

        // Echte Cluster-Netzstruktur: Nodes pro Sternsystem + Nachbarschaftssegmente.
        const maxNodes = 140;
        const nodeStars = starsInRange.slice(0, maxNodes);
        const nodes = nodeStars.map((star) => ({
          position: new THREE.Vector3(
            (Number(star.x_ly) || 0) * scale,
            (Number(star.z_ly) || 0) * scale * 0.42,
            (Number(star.y_ly) || 0) * scale
          ),
        }));
        if (!nodes.length) return;

        let spread = 0;
        const centroid = nodes.reduce((acc, node) => {
          acc.x += node.position.x;
          acc.y += node.position.y;
          acc.z += node.position.z;
          return acc;
        }, new THREE.Vector3(0, 0, 0)).multiplyScalar(1 / nodes.length);
        nodes.forEach((node) => {
          spread = Math.max(spread, node.position.distanceTo(centroid));
        });
        const linkDistance = Math.max(10, spread * 0.42);
        const maxNeighbors = 2;

        const edgeSet = new Set();
        const edgeList = [];
        for (let i = 0; i < nodes.length; i++) {
          const distances = [];
          for (let j = 0; j < nodes.length; j++) {
            if (i === j) continue;
            const dist = nodes[i].position.distanceTo(nodes[j].position);
            if (dist <= linkDistance) distances.push({ j, dist });
          }
          distances.sort((a, b) => a.dist - b.dist);
          distances.slice(0, maxNeighbors).forEach(({ j }) => {
            const a = Math.min(i, j);
            const b = Math.max(i, j);
            const key = `${a}:${b}`;
            if (edgeSet.has(key)) return;
            edgeSet.add(key);
            edgeList.push({ a, b, dist: nodes[a].position.distanceTo(nodes[b].position) });
          });
        }

        // Falls ein Cluster sehr dispergiert ist und keine Kanten entstanden sind, mindestens Kette bauen.
        if (!edgeList.length && nodes.length > 1) {
          const ordered = nodes
            .map((node, nodeIndex) => ({ node, nodeIndex, d: node.position.distanceTo(centroid) }))
            .sort((a, b) => a.d - b.d);
          for (let i = 1; i < ordered.length; i++) {
            const a = ordered[i - 1].nodeIndex;
            const b = ordered[i].nodeIndex;
            edgeList.push({ a: Math.min(a, b), b: Math.max(a, b), dist: ordered[i].d });
          }
        }

        edgeList.sort((a, b) => a.dist - b.dist);
        const edgeCap = Math.max(16, Math.min(420, nodes.length * 4));
        const clippedEdges = edgeList.slice(0, edgeCap);
        const lines = [];
        clippedEdges.forEach((edge) => {
          const p1 = nodes[edge.a].position;
          const p2 = nodes[edge.b].position;
          lines.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        });

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        const segmentCount = Math.floor(lines.length / 6);
        lineGeo.setDrawRange(0, segmentCount * 2);
        const lineMat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.17,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
        this.clusterAuraGroup.add(lineMesh);

        const nodeMeshes = [];
        nodes.forEach((node) => {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.72, 10, 8),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.42,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            })
          );
          mesh.position.copy(node.position);
          this.clusterAuraGroup.add(mesh);
          nodeMeshes.push(mesh);
        });

        this.clusterAuraEntries.push({
          nodeMeshes,
          lineMat,
          lineGeo,
          segmentCount,
          phase: index * 0.7,
        });
      });
    }

    _buildOrbitalFacilityEntry(entry, index) {
      const facilities = Array.isArray(entry.slot?.player_planet?.orbital_facilities)
        ? entry.slot.player_planet.orbital_facilities
        : [];
      if (!facilities.length) return null;

      const radius = Math.max(5.8, (entry.mesh.geometry?.parameters?.radius || 4) + 3.5);
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.16, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x6ea4d8, transparent: true, opacity: 0.55 })
      );
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      facilities.slice(0, 8).forEach((facility, facilityIndex) => {
        const angle = (facilityIndex / Math.max(1, facilities.length)) * Math.PI * 2;
        const module = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.8, 1.4),
          new THREE.MeshStandardMaterial({ color: this._facilityColor(facility.category), emissive: this._facilityColor(facility.category), emissiveIntensity: 0.25 })
        );
        module.position.set(Math.cos(angle) * radius, (facilityIndex % 2 === 0 ? 0.55 : -0.55), Math.sin(angle) * radius);
        module.lookAt(new THREE.Vector3(0, 0, 0));
        group.add(module);
      });

      entry.mesh.add(group);
      return {
        group,
        ring,
        entry,
        spin: 0.22 + index * 0.02,
      };
    }

    _buildFleetFormationEntry(fleet, index) {
      const group = new THREE.Group();
      const vessels = Array.isArray(fleet.vessels) ? fleet.vessels : [];
      const color = this._fleetColor(fleet.mission);
      let cursor = 0;
      vessels.slice(0, 5).forEach((vessel) => {
        const sample = Math.max(1, Number(vessel.sample_count || Math.min(4, vessel.count || 1)));
        for (let i = 0; i < sample; i++) {
          const mesh = new THREE.Mesh(
            new THREE.ConeGeometry(0.32, 1.15, 6),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.35, metalness: 0.45 })
          );
          const row = Math.floor(cursor / 3);
          const col = cursor % 3;
          mesh.rotation.x = Math.PI / 2;
          mesh.position.set((col - 1) * 1.2, row * 0.45, (row % 2 === 0 ? 1 : -1) * 0.7);
          group.add(mesh);
          cursor += 1;
        }
      });
      if (!group.children.length) {
        const fallback = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 10, 10),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 })
        );
        group.add(fallback);
      }
      this.systemFleetGroup.add(group);
      return {
        group,
        fleet,
        phase: index * 0.7,
      };
    }

    _buildSystemBackdrop(star) {
      if (!Array.isArray(this.stars) || !this.stars.length) return;
      const sx = Number(star.x_ly || 0);
      const sy = Number(star.y_ly || 0);
      const sz = Number(star.z_ly || 0);
      const nearby = this.stars
        .filter((candidate) => !(Number(candidate.galaxy_index || 0) === Number(star.galaxy_index || 0) && Number(candidate.system_index || 0) === Number(star.system_index || 0)))
        .map((candidate) => {
          const dx = Number(candidate.x_ly || 0) - sx;
          const dy = Number(candidate.y_ly || 0) - sy;
          const dz = Number(candidate.z_ly || 0) - sz;
          return { candidate, dx, dy, dz, dist2: dx * dx + dy * dy + dz * dz };
        })
        .sort((a, b) => a.dist2 - b.dist2)
        .slice(0, 80);

      if (!nearby.length) return;

      const positions = new Float32Array(nearby.length * 3);
      const colors = new Float32Array(nearby.length * 3);
      for (let i = 0; i < nearby.length; i++) {
        const item = nearby[i];
        const distance = Math.max(1, Math.sqrt(item.dist2));
        const dir = new THREE.Vector3(item.dx, item.dz * 0.42, item.dy).normalize();
        const radius = 230 + Math.sqrt(distance) * 20;
        const p = i * 3;
        positions[p + 0] = dir.x * radius;
        positions[p + 1] = dir.y * radius * 0.72;
        positions[p + 2] = dir.z * radius;
        const color = new THREE.Color(this._spectralColorHex(item.candidate.spectral_class));
        colors[p + 0] = color.r;
        colors[p + 1] = color.g;
        colors[p + 2] = color.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 3.6,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.systemBackdrop.add(new THREE.Points(geo, mat));
    }

    exitSystemView(restoreGalaxy = true) {
      this.systemMode = false;
      this.systemSourceStar = null;
      this.systemPlanetEntries = [];
      this.systemFacilityEntries = [];
      this.systemFleetEntries = [];
      this.systemHoverEntry = null;
      this.systemSelectedEntry = null;
      if (this.systemGroup) this.systemGroup.visible = false;
      this._clearGroup(this.systemBackdrop);
      this._clearGroup(this.systemOrbitGroup);
      this._clearGroup(this.systemBodyGroup);
      this._clearGroup(this.systemFacilityGroup);
      this._clearGroup(this.systemFleetGroup);
      if (this.starPoints) this.starPoints.visible = true;
      if (this.coreStars) this.coreStars.visible = true;
      if (this.halo) this.halo.visible = true;
      if (this.grid) this.grid.visible = true;
      if (this.hoverMarker) this.hoverMarker.visible = false;
      if (restoreGalaxy && this.starPoints) {
        this.autoFrameEnabled = true;
        if (this.selectedIndex >= 0 && this.selectedIndex < this.visibleStars.length) {
          this.focusOnStar(this.visibleStars[this.selectedIndex], true);
        } else {
          this.fitCameraToStars(true, true);
        }
      }
    }

    enterSystemView(star, payload) {
      if (!star || !payload) return;
      this.exitSystemView(false);
      this.systemMode = true;
      this.systemSourceStar = star;
      this.systemGroup.visible = true;
      this.autoFrameEnabled = false;
      if (this.starPoints) this.starPoints.visible = false;
      if (this.coreStars) this.coreStars.visible = false;
      if (this.halo) this.halo.visible = false;
      if (this.grid) this.grid.visible = false;
      if (this.hoverMarker) this.hoverMarker.visible = false;

      const starRadius = {
        O: 20, B: 17, A: 15, F: 13, G: 11, K: 9, M: 7,
      }[String(star.spectral_class || 'G').toUpperCase()] || 11;
      const starColor = this._spectralColorHex(star.spectral_class);
      const starMesh = new THREE.Mesh(
        new THREE.SphereGeometry(starRadius, 28, 28),
        new THREE.MeshStandardMaterial({
          color: starColor,
          emissive: starColor,
          emissiveIntensity: 0.85,
          roughness: 0.4,
          metalness: 0.02,
        })
      );
      this.systemBodyGroup.add(starMesh);

      const bodies = (payload.planets || [])
        .map((slot) => ({
          slot,
          body: slot.player_planet || slot.generated_planet || null,
        }))
        .filter((entry) => entry.body);
      const orbitBodies = bodies.slice().sort((a, b) => Number(a.body.semi_major_axis_au || 0) - Number(b.body.semi_major_axis_au || 0));
      const maxAu = Math.max(0.35, ...orbitBodies.map((entry, index) => Number(entry.body.semi_major_axis_au || (0.35 + index * 0.22))));

      this.systemPlanetEntries = orbitBodies.map((entry, index) => {
        const body = entry.body;
        const slot = entry.slot;
        const semiMajor = Number(body.semi_major_axis_au || (0.35 + index * 0.22));
        const orbitRadius = 34 + (semiMajor / maxAu) * 165;
        const eccentricity = THREE.MathUtils.clamp(0.03 + index * 0.012, 0.03, 0.22);
        const orbitMinor = orbitRadius * Math.sqrt(1 - eccentricity * eccentricity);
        const orbitCurve = new THREE.EllipseCurve(0, 0, orbitRadius, orbitMinor, 0, Math.PI * 2, false, 0);
        const orbitPoints = orbitCurve.getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y));
        const orbitLine = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(orbitPoints),
          new THREE.LineBasicMaterial({ color: 0x31567c, transparent: true, opacity: 0.5 })
        );
        const orbitPivot = new THREE.Group();
        orbitPivot.rotation.x = Math.PI / 2 + ((index % 2 === 0 ? 1 : -1) * (0.05 + index * 0.012));
        orbitPivot.rotation.z = (index % 3 - 1) * (0.08 + index * 0.01);
        orbitPivot.rotation.y = index * 0.34;
        orbitPivot.add(orbitLine);
        this.systemOrbitGroup.add(orbitPivot);

        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(this._planetSize(body, index), 18, 18),
          new THREE.MeshStandardMaterial({ color: this._planetColor(body.planet_class), roughness: 0.82, metalness: 0.04 })
        );
        this.systemBodyGroup.add(mesh);
        mesh.userData = {
          kind: 'planet',
          sourceStar: star,
          slot,
          body,
          orbitRadius,
          orbitMinor,
        };
        return {
          mesh,
          slot,
          body,
          orbitRadius,
          orbitMinor,
          orbitPivot,
          eccentricity,
          angle: (index / Math.max(1, orbitBodies.length)) * Math.PI * 2,
          speed: 0.18 / Math.max(0.35, Math.sqrt(Number(body.orbital_period_days || 80) / 40)),
        };
      });

      this.systemFacilityEntries = this.systemPlanetEntries
        .map((entry, index) => this._buildOrbitalFacilityEntry(entry, index))
        .filter(Boolean);

      this.systemFleetEntries = (Array.isArray(payload.fleets_in_system) ? payload.fleets_in_system : [])
        .map((fleet, index) => this._buildFleetFormationEntry(fleet, index));

      this._buildSystemBackdrop(star);

      this.controls.target.set(0, 0, 0);
      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: new THREE.Vector3(0, 0, 0),
        fromPos: this.camera.position.clone(),
        toPos: new THREE.Vector3(0, 132, 214),
        t: 0,
      };
    }

    focusOnSystemPlanet(planetLike, smooth = true) {
      if (!this.systemMode || !planetLike) return;
      const targetPos = Number(planetLike.__slot?.position || planetLike.position || 0);
      const entry = this.systemPlanetEntries.find((item) => Number(item.slot?.position || item.body?.position || 0) === targetPos);
      if (!entry) return;

      this.systemSelectedEntry = entry;
      this._updateHoverMarker();

      const worldPos = entry.mesh.getWorldPosition(new THREE.Vector3());
      const radius = Math.max(4, entry.mesh.geometry?.parameters?.radius || 4);
      const offset = new THREE.Vector3(radius * 3.2, radius * 1.6, radius * 4.6);

      if (!smooth) {
        this.controls.target.copy(worldPos);
        this.camera.position.copy(worldPos.clone().add(offset));
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: worldPos.clone(),
        fromPos: this.camera.position.clone(),
        toPos: worldPos.clone().add(offset),
        t: 0,
      };
    }

    _bindEvents() {
      this._onMouseMove = (e) => this._handlePointerMove(e);
      this._onClick = (e) => this._handleClick(e);
      this._onDoubleClick = (e) => this._handleDoubleClick(e);
      this._onMouseDown = (e) => this._handleMouseDown(e);
      this._onMouseUp = () => this._handleMouseUp();
      this._onWheel = (e) => this._handleWheel(e);
      this._onKeyDown = (e) => this._handleKeyDown(e);
      this._onKeyUp = (e) => this._handleKeyUp(e);
      this._onResizeBound = () => this._onResize();

      this.renderer.domElement.addEventListener('mousemove', this._onMouseMove);
      this.renderer.domElement.addEventListener('click', this._onClick);
      this.renderer.domElement.addEventListener('dblclick', this._onDoubleClick);
      this.renderer.domElement.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mouseup', this._onMouseUp);
      this.renderer.domElement.addEventListener('wheel', this._onWheel, { passive: false });
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('resize', this._onResizeBound);
    }

    _handleMouseDown(e) {
      this.autoFrameEnabled = false;
      this.controls.dragging = true;
    }

    _handleMouseUp() {
      this.controls.dragging = false;
    }

    _handleWheel(e) {
      if (this.hasExternalOrbitControls) return;
      e.preventDefault();
      this.autoFrameEnabled = false;
      const zoomIn = e.deltaY < 0;
      this._zoomTowardsTarget(zoomIn ? 0.88 : 1.14);
    }

    _handleKeyDown(e) {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      const k = String(e.key || '').toLowerCase();
      if (k === 'escape' && this.systemMode) {
        e.preventDefault();
        this.exitSystemView(true);
        return;
      }
      if (k === 'f') {
        e.preventDefault();
        if (this.systemMode) this.exitSystemView(false);
        this.autoFrameEnabled = true;
        this.fitCameraToStars(true);
        return;
      }
      if (k === 'r') {
        e.preventDefault();
        if (this.systemMode) this.exitSystemView(false);
        this.autoFrameEnabled = true;
        this.fitCameraToStars(false, true);
        return;
      }
      if (k === '+' || k === '=') { e.preventDefault(); this._kbdMove.forward = true; }
      if (k === '-') { e.preventDefault(); this._kbdMove.back = true; }
      if (k === 'w') this._kbdMove.forward = true;
      if (k === 's') this._kbdMove.back = true;
      if (k === 'a') this._kbdMove.left = true;
      if (k === 'd') this._kbdMove.right = true;
      if (k === 'q') this._kbdMove.down = true;
      if (k === 'e') this._kbdMove.up = true;
      if (k === 'arrowleft') { e.preventDefault(); this._kbdMove.panL = true; }
      if (k === 'arrowright') { e.preventDefault(); this._kbdMove.panR = true; }
      if (k === 'arrowup') { e.preventDefault(); this._kbdMove.panU = true; }
      if (k === 'arrowdown') { e.preventDefault(); this._kbdMove.panD = true; }
    }

    _handleKeyUp(e) {
      const k = String(e.key || '').toLowerCase();
      if (k === '+' || k === '=') this._kbdMove.forward = false;
      if (k === '-') this._kbdMove.back = false;
      if (k === 'w') this._kbdMove.forward = false;
      if (k === 's') this._kbdMove.back = false;
      if (k === 'a') this._kbdMove.left = false;
      if (k === 'd') this._kbdMove.right = false;
      if (k === 'q') this._kbdMove.down = false;
      if (k === 'e') this._kbdMove.up = false;
      if (k === 'arrowleft') this._kbdMove.panL = false;
      if (k === 'arrowright') this._kbdMove.panR = false;
      if (k === 'arrowup') this._kbdMove.panU = false;
      if (k === 'arrowdown') this._kbdMove.panD = false;
    }

    _orbitAroundTarget(yawDelta, pitchDelta) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += yawDelta;
      spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, spherical.phi + pitchDelta));
      offset.setFromSpherical(spherical);
      this.camera.position.copy(this.controls.target.clone().add(offset));
    }

    _zoomTowardsTarget(factor) {
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
      const dist = offset.length();
      if (dist < this.controls.minDistance) offset.setLength(this.controls.minDistance);
      if (dist > this.controls.maxDistance) offset.setLength(this.controls.maxDistance);
      this.camera.position.copy(this.controls.target.clone().add(offset));
    }

    nudgeZoom(direction = 'in') {
      this.autoFrameEnabled = false;
      this._zoomTowardsTarget(direction === 'out' ? 1.14 : 0.88);
      this.controls.update();
    }

    nudgeOrbit(direction = 'left') {
      this.autoFrameEnabled = false;
      if (direction === 'left') this._orbitAroundTarget(-0.055, 0);
      if (direction === 'right') this._orbitAroundTarget(0.055, 0);
      if (direction === 'up') this._orbitAroundTarget(0, -0.045);
      if (direction === 'down') this._orbitAroundTarget(0, 0.045);
      this.controls.update();
    }

    nudgePan(direction = 'left') {
      this.autoFrameEnabled = false;
      const amount = 6;
      const moveX = direction.includes('left') ? -amount : direction.includes('right') ? amount : 0;
      const moveZ = direction.includes('up') ? -amount : direction.includes('down') ? amount : 0;
      if (moveX !== 0) {
        this.controls.target.x += moveX;
        this.camera.position.x += moveX;
      }
      if (moveZ !== 0) {
        this.controls.target.z += moveZ;
        this.camera.position.z += moveZ;
      }
      this.controls.update();
    }

    resetNavigationView() {
      this.autoFrameEnabled = true;
      if (this.systemMode) this.exitSystemView(false);
      this.fitCameraToStars(false, true);
      this.controls.update();
    }

    focusCurrentSelection() {
      this.autoFrameEnabled = false;
      if (this.systemMode && this.systemSelectedEntry) {
        this.focusOnSystemPlanet(this._planetPayload(this.systemSelectedEntry), true);
        return;
      }
      if (!this.systemMode && this.selectedIndex >= 0) {
        this.focusOnStar(this.visibleStars[this.selectedIndex], true);
      }
    }

    fitCameraToStars(smooth = false, resetDirection = false) {
      if (this.systemMode) this.exitSystemView(false);
      if (!this.starPoints?.geometry?.boundingSphere) return;
      const bs = this.starPoints.geometry.boundingSphere;
      const center = bs.center.clone();
      const radius = Math.max(35, bs.radius);
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const hFov = 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect);
      const distV = radius / Math.tan(fov / 2);
      const distH = radius / Math.tan(hFov / 2);
      const distance = Math.max(distV, distH) * 1.22;

      const dir = this.camera.position.clone().sub(this.controls.target);
      const defaultViewDir = new THREE.Vector3(0.819, 1.0, 0.574).normalize();
      const n = resetDirection
        ? defaultViewDir
        : (dir.length() > 0.001 ? dir.normalize() : defaultViewDir);
      const targetPos = center.clone().add(n.multiplyScalar(distance));

      if (!smooth) {
        this.controls.target.copy(center);
        this.camera.position.copy(targetPos);
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: center.clone(),
        fromPos: this.camera.position.clone(),
        toPos: targetPos,
        t: 0,
      };
    }

    _eventToNdc(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    _pickStar() {
      if (this.systemMode) return -1;
      if (!this.starPoints) return -1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObject(this.starPoints);
      if (!hits.length) return -1;
      return hits[0].index;
    }

    _pickSystemPlanet() {
      if (!this.systemMode || !this.systemPlanetEntries.length) return null;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.systemPlanetEntries.map((entry) => entry.mesh), false);
      if (!hits.length) return null;
      return this.systemPlanetEntries.find((entry) => entry.mesh === hits[0].object) || null;
    }

    _handlePointerMove(e) {
      this._eventToNdc(e);
      if (this.systemMode) {
        const entry = this._pickSystemPlanet();
        if (entry === this.systemHoverEntry) return;
        this.systemHoverEntry = entry;
        this._updateHoverMarker();
        if (typeof this.opts.onHover === 'function') {
          this.opts.onHover(entry ? Object.assign({ __kind: 'planet' }, entry.body, { __slot: entry.slot, __sourceStar: this.systemSourceStar }) : null, entry ? this.getWorldScreenPosition(entry.mesh.getWorldPosition(new THREE.Vector3())) : null);
        }
        return;
      }
      const idx = this._pickStar();
      if (idx === this.hoverIndex) return;
      this.hoverIndex = idx;
      this._updateHoverMarker();
      if (typeof this.opts.onHover === 'function') {
        this.opts.onHover(idx >= 0 ? this.visibleStars[idx] : null, this.getScreenPosition(idx));
      }
      this._updateStarVisualState();
    }

    _handleClick(e) {
      this._eventToNdc(e);
      if (this.systemMode) {
        const entry = this._pickSystemPlanet();
        if (!entry) return;
        this.systemSelectedEntry = entry;
        this._updateHoverMarker();
        this.focusOnSystemPlanet(this._planetPayload(entry), true);
        if (typeof this.opts.onClick === 'function') {
          this.opts.onClick(Object.assign({ __kind: 'planet' }, entry.body, { __slot: entry.slot, __sourceStar: this.systemSourceStar }), this.getWorldScreenPosition(entry.mesh.getWorldPosition(new THREE.Vector3())));
        }
        return;
      }
      const idx = this._pickStar();
      if (idx < 0) return;
      this.selectedIndex = idx;
      this._updateHoverMarker();
      this.focusOnStar(this.visibleStars[idx], true);
      this._updateStarVisualState();
      if (typeof this.opts.onClick === 'function') {
        this.opts.onClick(this.visibleStars[idx], this.getScreenPosition(idx));
      }
    }

    _handleDoubleClick(e) {
      this._eventToNdc(e);
      if (this.systemMode) {
        const entry = this._pickSystemPlanet();
        if (!entry) return;
        this.systemSelectedEntry = entry;
        this._updateHoverMarker();
        if (typeof this.opts.onDoubleClick === 'function') {
          this.opts.onDoubleClick(Object.assign({ __kind: 'planet' }, entry.body, { __slot: entry.slot, __sourceStar: this.systemSourceStar }), this.getWorldScreenPosition(entry.mesh.getWorldPosition(new THREE.Vector3())));
        }
        return;
      }
      const idx = this._pickStar();
      if (idx < 0) return;
      this.selectedIndex = idx;
      this._updateHoverMarker();
      this.focusOnStar(this.visibleStars[idx], true);
      this._updateStarVisualState();
      if (typeof this.opts.onDoubleClick === 'function') {
        this.opts.onDoubleClick(this.visibleStars[idx], this.getScreenPosition(idx));
      }
    }

    _onResize() {
      if (!this.container || this.destroyed) return;
      const w = Math.max(320, this.container.clientWidth);
      const h = Math.max(220, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      if (this.autoFrameEnabled && this.starPoints) {
        this.fitCameraToStars(false);
      }
    }

    _clusterStars(stars, targetPoints = 6000) {
      if (!Array.isArray(stars) || stars.length <= targetPoints) {
        return { stars: stars || [], map: (stars || []).map((_, i) => i) };
      }

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const s of stars) {
        const x = Number(s.x_ly || 0);
        const y = Number(s.y_ly || 0);
        const z = Number(s.z_ly || 0);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }

      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const spanZ = Math.max(1, maxZ - minZ);
      const binsPerAxis = Math.max(8, Math.ceil(Math.cbrt(targetPoints)));

      const bins = new Map();
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const nx = (Number(s.x_ly || 0) - minX) / spanX;
        const ny = (Number(s.y_ly || 0) - minY) / spanY;
        const nz = (Number(s.z_ly || 0) - minZ) / spanZ;
        const ix = Math.max(0, Math.min(binsPerAxis - 1, Math.floor(nx * binsPerAxis)));
        const iy = Math.max(0, Math.min(binsPerAxis - 1, Math.floor(ny * binsPerAxis)));
        const iz = Math.max(0, Math.min(binsPerAxis - 1, Math.floor(nz * binsPerAxis)));
        const key = `${ix}|${iy}|${iz}`;

        if (!bins.has(key)) {
          bins.set(key, {
            count: 0,
            sx: 0, sy: 0, sz: 0,
            rep: s,
            repIndex: i,
            hottest: Number(s.temperature_k || 0),
            classVotes: {},
          });
        }

        const b = bins.get(key);
        b.count++;
        b.sx += Number(s.x_ly || 0);
        b.sy += Number(s.y_ly || 0);
        b.sz += Number(s.z_ly || 0);
        const cls = String(s.spectral_class || 'G');
        b.classVotes[cls] = (b.classVotes[cls] || 0) + 1;
        const t = Number(s.temperature_k || 0);
        if (t > b.hottest) {
          b.hottest = t;
          b.rep = s;
          b.repIndex = i;
        }
      }

      const out = [];
      const map = [];
      bins.forEach((b) => {
        let bestClass = 'G';
        let bestVotes = -1;
        Object.keys(b.classVotes).forEach((k) => {
          if (b.classVotes[k] > bestVotes) {
            bestVotes = b.classVotes[k];
            bestClass = k;
          }
        });
        out.push(Object.assign({}, b.rep, {
          x_ly: b.sx / b.count,
          y_ly: b.sy / b.count,
          z_ly: b.sz / b.count,
          spectral_class: bestClass,
          cluster_size: b.count,
        }));
        map.push(b.repIndex);
      });

      return { stars: out, map };
    }

    setStars(stars) {
      if (this.systemMode) this.exitSystemView(false);
      this.stars = Array.isArray(stars) ? stars.slice() : [];
      this.visibleStars = [];
      this.visibleToRawIndex = [];
      this.hoverIndex = -1;
      this.selectedIndex = -1;

      if (this.starPoints) {
        this.scene.remove(this.starPoints);
        this.starPoints.geometry.dispose();
        this.starPoints.material.dispose();
        this.starPoints = null;
      }

      if (!this.stars.length) {
        this._rebuildClusterAuras();
        return;
      }

      const clustered = this._clusterStars(this.stars, 6500);
      this.visibleStars = clustered.stars;
      this.visibleToRawIndex = clustered.map;

      if (!this.visibleStars.length) return;

      const positions = new Float32Array(this.visibleStars.length * 3);
      const colors = new Float32Array(this.visibleStars.length * 3);
      const sizes = new Float32Array(this.visibleStars.length);
      const classColor = {
        O: [0.61, 0.69, 1.0],
        B: [0.67, 0.75, 1.0],
        A: [0.79, 0.84, 1.0],
        F: [0.95, 0.96, 1.0],
        G: [1.0, 0.95, 0.86],
        K: [1.0, 0.85, 0.63],
        M: [1.0, 0.8, 0.45],
      };

      const scale = 0.028;
      for (let i = 0; i < this.visibleStars.length; i++) {
        const s = this.visibleStars[i];
        const p = i * 3;
        positions[p + 0] = (Number(s.x_ly) || 0) * scale;
        positions[p + 1] = (Number(s.z_ly) || 0) * scale * 0.42;
        positions[p + 2] = (Number(s.y_ly) || 0) * scale;

        const c = classColor[s.spectral_class] || [0.85, 0.88, 1.0];
        colors[p + 0] = c[0];
        colors[p + 1] = c[1];
        colors[p + 2] = c[2];

        const relClass = { O: 2.4, B: 1.9, A: 1.5, F: 1.2, G: 1.0, K: 0.85, M: 0.72 };
        const clusterBoost = Math.min(2.2, 1 + Math.log2(Math.max(1, Number(s.cluster_size || 1))) * 0.24);
        sizes[i] = (3.1 * (relClass[s.spectral_class] || 1.0)) * clusterBoost;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geo.setAttribute('aEmpire', new THREE.BufferAttribute(new Float32Array(this.visibleStars.length), 1));

      geo.computeBoundingSphere();

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPointScale: { value: this.renderer.getPixelRatio() * 92.0 },
          uCameraVel: { value: new THREE.Vector3(0, 0, 0) },
          uDopplerStrength: { value: 0.11 },
          uHeartbeatPhase: { value: 0 },
          uHeartbeatStrength: { value: 0 },
        },
        vertexShader: `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aEmpire;
          varying vec3 vColor;
          varying float vAlpha;
          varying float vEmpire;
          uniform float uPointScale;
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float dist = max(1.0, -mvPosition.z);
            gl_PointSize = max(1.2, aSize * uPointScale / dist);
            gl_Position = projectionMatrix * mvPosition;
            vColor = aColor;
            vAlpha = clamp(0.30 + (aSize / 12.0), 0.24, 0.76);
            vEmpire = aEmpire;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;
          varying float vEmpire;
          uniform vec3 uCameraVel;
          uniform float uDopplerStrength;
          uniform float uHeartbeatPhase;
          uniform float uHeartbeatStrength;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float r2 = dot(uv, uv);
            if (r2 > 0.25) discard;

            float core = smoothstep(0.26, 0.0, r2);
            vec3 dir = normalize(vec3(uv.x, uv.y, 1.0));
            float radial = clamp(dot(normalize(uCameraVel + vec3(1e-6)), dir), -1.0, 1.0);
            float shift = radial * uDopplerStrength;
            vec3 redShift = vec3(vColor.r * 1.08, vColor.g * 0.88, vColor.b * 0.72);
            vec3 blueShift = vec3(vColor.r * 0.78, vColor.g * 0.93, min(1.0, vColor.b * 1.25));
            vec3 shifted = mix(vColor, shift >= 0.0 ? blueShift : redShift, abs(shift));
            float beat = 0.5 + 0.5 * sin(uHeartbeatPhase);
            float empirePulse = vEmpire * uHeartbeatStrength;
            vec3 pulseColor = mix(shifted, vec3(0.86, 0.95, 1.0), empirePulse * (0.35 + beat * 0.55));
            float pulseAlpha = vAlpha * core + empirePulse * (0.10 + beat * 0.15);

            gl_FragColor = vec4(pulseColor * (0.50 + core * 0.52), pulseAlpha);
          }
        `,
      });

      this.starPoints = new THREE.Points(geo, material);
      this.scene.add(this.starPoints);

      const bs = geo.boundingSphere;
      if (bs && Number.isFinite(bs.radius) && bs.radius > 0) {
        const center = bs.center.clone();
        const radius = Math.max(80, bs.radius);
        const distance = radius * 1.55;
        this.controls.target.copy(center);
        this.camera.position.set(center.x + distance * 0.42, center.y + distance * 0.22, center.z + distance);
      } else {
        this.controls.target.set(0, 0, 0);
      }
      this.controls.update();
      this.fitCameraToStars(true, true);
      this._rebuildClusterAuras();
      this._applyEmpireHeartbeatMask();
      this._updateHoverMarker();
    }

    _updateStarVisualState() {
      if (!this.starPoints) return;
      const sizeAttr = this.starPoints.geometry.getAttribute('aSize');
      if (!sizeAttr) return;
      for (let i = 0; i < sizeAttr.count; i++) {
        const s = this.visibleStars[i] || {};
        const relClass = { O: 2.4, B: 1.9, A: 1.5, F: 1.2, G: 1.0, K: 0.85, M: 0.72 };
        const clusterBoost = Math.min(2.2, 1 + Math.log2(Math.max(1, Number(s.cluster_size || 1))) * 0.24);
        let base = (3.1 * (relClass[s.spectral_class] || 1.0)) * clusterBoost;
        if (i === this.hoverIndex) base *= 1.5;
        if (i === this.selectedIndex) base *= 1.9;
        sizeAttr.setX(i, base);
      }
      sizeAttr.needsUpdate = true;
    }

    _updateHoverMarker() {
      if (!this.hoverMarker) return;
      if (this.systemMode) {
        const entry = this.systemHoverEntry || this.systemSelectedEntry;
        if (!entry) {
          this.hoverMarker.visible = false;
          return;
        }
        const worldPos = entry.mesh.getWorldPosition(new THREE.Vector3());
        const baseSize = Math.max(4.5, entry.mesh.geometry?.parameters?.radius || 4.5);
        this.hoverMarker.position.copy(worldPos);
        this.hoverMarker.scale.setScalar(baseSize * (this.systemHoverEntry ? 3.2 : 2.7));
        this.hoverMarker.visible = true;
        return;
      }
      if (!this.starPoints) return;
      const markerIndex = this.hoverIndex >= 0 ? this.hoverIndex : this.selectedIndex;
      if (markerIndex < 0 || markerIndex >= this.visibleStars.length) {
        this.hoverMarker.visible = false;
        return;
      }

      const posAttr = this.starPoints.geometry.getAttribute('position');
      const sizeAttr = this.starPoints.geometry.getAttribute('aSize');
      const localPos = new THREE.Vector3(
        posAttr.getX(markerIndex),
        posAttr.getY(markerIndex),
        posAttr.getZ(markerIndex)
      );
      const worldPos = this.starPoints.localToWorld(localPos.clone());
      const baseSize = sizeAttr ? sizeAttr.getX(markerIndex) : 6;
      const markerScale = Math.max(7, baseSize * (this.hoverIndex >= 0 ? 2.4 : 2.0));

      this.hoverMarker.position.copy(worldPos);
      this.hoverMarker.scale.setScalar(markerScale);
      this.hoverMarker.visible = true;
    }

    getWorldScreenPosition(worldVec) {
      if (!worldVec) return null;
      const projected = worldVec.clone().project(this.camera);
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((projected.x + 1) * 0.5) * rect.width,
        y: ((1 - projected.y) * 0.5) * rect.height,
      };
    }

    _getStarWorldPosition(index, out = new THREE.Vector3()) {
      if (!this.starPoints || index == null || index < 0 || index >= this.visibleStars.length) return null;
      const posAttr = this.starPoints.geometry.getAttribute('position');
      out.set(
        posAttr.getX(index),
        posAttr.getY(index),
        posAttr.getZ(index)
      );
      return this.starPoints.localToWorld(out);
    }

    _getTrackedSelectionWorldPosition() {
      if (this.systemMode && this.systemSelectedEntry?.mesh) {
        return this.systemSelectedEntry.mesh.getWorldPosition(new THREE.Vector3());
      }
      if (!this.systemMode && this.selectedIndex >= 0) {
        return this._getStarWorldPosition(this.selectedIndex, new THREE.Vector3());
      }
      return null;
    }

    _followTrackedSelection() {
      if (!this.followSelectionEnabled) return;
      const trackedWorldPos = this._getTrackedSelectionWorldPosition();
      if (!trackedWorldPos) return;
      const delta = trackedWorldPos.clone().sub(this.controls.target);
      if (delta.lengthSq() <= 1e-8) return;

      this.controls.target.add(delta);
      this.camera.position.add(delta);

      if (this.focusTarget) {
        this.focusTarget.fromTarget.add(delta);
        this.focusTarget.toTarget.add(delta);
        this.focusTarget.fromPos.add(delta);
        this.focusTarget.toPos.add(delta);
      }
    }

    setFollowSelectionEnabled(enabled) {
      this.followSelectionEnabled = !!enabled;
    }

    toggleFollowSelection() {
      this.followSelectionEnabled = !this.followSelectionEnabled;
      return this.followSelectionEnabled;
    }

    isFollowingSelection() {
      return !!this.followSelectionEnabled;
    }

    _updateDoppler(dt) {
      if (!this.starPoints || !this.starPoints.material?.uniforms) return;
      const delta = this.camera.position.clone().sub(this.prevCamPos);
      this.prevCamPos.copy(this.camera.position);
      const invDt = dt > 0 ? (1 / dt) : 0;
      const speed = delta.length() * invDt;
      if (speed <= 1e-5) {
        this.cameraVelocity.set(0, 0, 0);
      } else {
        this.cameraVelocity.copy(delta.normalize().multiplyScalar(Math.min(1.0, speed / 120.0)));
      }
      this.starPoints.material.uniforms.uCameraVel.value.copy(this.cameraVelocity);
    }

    focusOnStar(star, smooth) {
      if (!star) return;
      const scale = 0.028;
      const tx = (Number(star.x_ly) || 0) * scale;
      const ty = (Number(star.z_ly) || 0) * scale * 0.42;
      const tz = (Number(star.y_ly) || 0) * scale;

      if (!smooth) {
        this.controls.target.set(tx, ty, tz);
        this.camera.position.set(tx + 70, ty + 46, tz + 95);
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: new THREE.Vector3(tx, ty, tz),
        fromPos: this.camera.position.clone(),
        toPos: new THREE.Vector3(tx + 70, ty + 46, tz + 95),
        t: 0,
      };
    }

    // Explicit matrix chain for UI overlay projection: P * V * M * p
    getScreenPosition(index) {
      if (index == null || index < 0 || index >= this.visibleStars.length || !this.starPoints) return null;

      const posAttr = this.starPoints.geometry.getAttribute('position');
      const x = posAttr.getX(index);
      const y = posAttr.getY(index);
      const z = posAttr.getZ(index);

      const p = [x, y, z, 1];
      const m = this.starPoints.matrixWorld.elements;
      const v = this.camera.matrixWorldInverse.elements;
      const pr = this.camera.projectionMatrix.elements;

      const mp = this._mulMat4Vec4(m, p);
      const vp = this._mulMat4Vec4(v, mp);
      const cp = this._mulMat4Vec4(pr, vp);
      if (cp[3] === 0) return null;

      const ndcX = cp[0] / cp[3];
      const ndcY = cp[1] / cp[3];
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((ndcX + 1) * 0.5) * rect.width,
        y: ((1 - ndcY) * 0.5) * rect.height,
      };
    }

    _mulMat4Vec4(m, v) {
      return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
      ];
    }

    _tickFocus(dt) {
      if (!this.focusTarget) return;
      const speed = this.systemMode
        ? (this.systemSelectedEntry ? this.focusDamping.planet : this.focusDamping.system)
        : this.focusDamping.galaxy;
      this.focusTarget.t = Math.min(1, this.focusTarget.t + dt * speed);
      const t = this.focusTarget.t;
      const k = 1 - Math.pow(1 - t, 3);

      this.controls.target.lerpVectors(this.focusTarget.fromTarget, this.focusTarget.toTarget, k);
      this.camera.position.lerpVectors(this.focusTarget.fromPos, this.focusTarget.toPos, k);
      if (t >= 1) this.focusTarget = null;
    }

    _cameraDistance() {
      return this.camera.position.distanceTo(this.controls.target);
    }

    _planetPayload(entry) {
      return Object.assign({ __kind: 'planet' }, entry.body, { __slot: entry.slot, __sourceStar: this.systemSourceStar });
    }

    _triggerAutoTransition(kind, payload, screenPos = null) {
      this.autoTransitionCooldownUntil = performance.now() + 900;
      if (kind === 'enter-system') {
        this.autoTransitionArmed.galaxyEnterSystem = false;
        if (typeof this.opts.onDoubleClick === 'function') {
          this.opts.onDoubleClick(payload, screenPos);
        }
        return;
      }
      if (kind === 'enter-planet') {
        this.autoTransitionArmed.systemEnterPlanet = false;
        if (typeof this.opts.onDoubleClick === 'function') {
          this.opts.onDoubleClick(payload, screenPos);
        }
        return;
      }
      if (kind === 'exit-planet') {
        this.autoTransitionArmed.planetExitToSystem = false;
        this.systemSelectedEntry = null;
        this.focusTarget = {
          fromTarget: this.controls.target.clone(),
          toTarget: new THREE.Vector3(0, 0, 0),
          fromPos: this.camera.position.clone(),
          toPos: new THREE.Vector3(0, 132, 214),
          t: 0,
        };
        if (typeof this.opts.onPlanetZoomOut === 'function') {
          this.opts.onPlanetZoomOut(this.systemSourceStar);
        }
        return;
      }
      if (kind === 'exit-system') {
        this.autoTransitionArmed.systemExitToGalaxy = false;
        if (typeof this.opts.onSystemZoomOut === 'function') {
          this.opts.onSystemZoomOut(this.systemSourceStar);
        } else {
          this.exitSystemView(true);
        }
      }
    }

    _handleZoomThresholdTransitions() {
      if (performance.now() < this.autoTransitionCooldownUntil || this.focusTarget || this.controls.dragging) return;
      const distance = this._cameraDistance();

      if (!this.systemMode) {
        const idx = this.selectedIndex >= 0 ? this.selectedIndex : this.hoverIndex;
        if (idx >= 0 && distance <= this.zoomThresholds.galaxyEnterSystem && this.autoTransitionArmed.galaxyEnterSystem) {
          this.selectedIndex = idx;
          this._triggerAutoTransition('enter-system', this.visibleStars[idx], this.getScreenPosition(idx));
          return;
        }
        if (distance >= this.zoomThresholds.galaxyResetSystem) {
          this.autoTransitionArmed.galaxyEnterSystem = true;
        }
        return;
      }

      const activeEntry = this.systemSelectedEntry || this.systemHoverEntry;
      if (activeEntry && distance <= this.zoomThresholds.systemEnterPlanet && this.autoTransitionArmed.systemEnterPlanet) {
        this.systemSelectedEntry = activeEntry;
        this._triggerAutoTransition('enter-planet', this._planetPayload(activeEntry), this.getWorldScreenPosition(activeEntry.mesh.getWorldPosition(new THREE.Vector3())));
        return;
      }
      if (distance >= this.zoomThresholds.systemResetPlanet) {
        this.autoTransitionArmed.systemEnterPlanet = true;
      }

      if (this.systemSelectedEntry && distance >= this.zoomThresholds.planetExitToSystem && this.autoTransitionArmed.planetExitToSystem) {
        this._triggerAutoTransition('exit-planet');
        return;
      }
      if (distance <= this.zoomThresholds.planetResetExit) {
        this.autoTransitionArmed.planetExitToSystem = true;
      }

      if (!this.systemSelectedEntry && distance >= this.zoomThresholds.systemExitToGalaxy && this.autoTransitionArmed.systemExitToGalaxy) {
        this._triggerAutoTransition('exit-system');
        return;
      }
      if (distance <= this.zoomThresholds.systemResetExit) {
        this.autoTransitionArmed.systemExitToGalaxy = true;
      }
    }

    _animate() {
      if (this.destroyed) return;
      requestAnimationFrame(() => this._animate());
      const dt = this.clock.getDelta();

      if (!this.systemMode) {
        if (this.coreStars) this.coreStars.rotation.y += dt * 0.03;
        this.halo.rotation.z += dt * 0.022;
        this.heartbeatPhase += dt * 4.2;
        if (this.starPoints?.material?.uniforms?.uHeartbeatPhase) {
          this.starPoints.material.uniforms.uHeartbeatPhase.value = this.heartbeatPhase;
        }
        this.clusterAuraEntries.forEach((entry, index) => {
          const beat = 0.5 + 0.5 * Math.sin((this.clock.elapsedTime * 0.9) + entry.phase);
          const camDist = Math.max(1, this._cameraDistance());
          const zoomNear = 95;
          const zoomFar = 760;
          const zoomT = THREE.MathUtils.clamp((zoomFar - camDist) / (zoomFar - zoomNear), 0, 1);
          const visibleSegments = Math.max(8, Math.floor(THREE.MathUtils.lerp(24, entry.segmentCount || 24, zoomT)));
          if (entry.lineGeo && typeof entry.lineGeo.setDrawRange === 'function') {
            entry.lineGeo.setDrawRange(0, visibleSegments * 2);
          }
          (entry.nodeMeshes || []).forEach((nodeMesh) => {
            if (!nodeMesh?.material) return;
            nodeMesh.material.opacity = THREE.MathUtils.lerp(0.18, 0.42, zoomT) + beat * 0.12;
            nodeMesh.scale.setScalar(THREE.MathUtils.lerp(0.68, 1.08, zoomT) + beat * 0.18);
          });
          if (entry.lineMat) {
            entry.lineMat.opacity = THREE.MathUtils.lerp(0.04, 0.20, zoomT) + beat * 0.08;
          }
        });

        if (this.autoFrameEnabled && !this.controls.dragging && this.starPoints) {
          this.starPoints.rotation.y += dt * 0.018;
        }
      } else {
        this.systemPlanetEntries.forEach((entry, index) => {
          entry.angle += dt * entry.speed;
          const x = Math.cos(entry.angle) * entry.orbitRadius;
          const z = Math.sin(entry.angle) * entry.orbitMinor;
          const orbitalPos = new THREE.Vector3(x, 0, z);
          entry.mesh.position.copy(entry.orbitPivot.localToWorld(orbitalPos));
          entry.mesh.rotation.y += dt * (0.25 + index * 0.03);
        });
        this.systemFacilityEntries.forEach((facility, index) => {
          if (!facility?.group) return;
          facility.group.rotation.y += dt * facility.spin;
          facility.group.rotation.z += dt * (0.08 + index * 0.01);
        });
        this.systemFleetEntries.forEach((fleetEntry, index) => {
          if (!fleetEntry?.group) return;
          const fleet = fleetEntry.fleet || {};
          const originEntry = this.systemPlanetEntries.find((entry) => Number(entry.slot?.position || 0) === Number(fleet.origin_position || 0)) || null;
          const targetEntry = this.systemPlanetEntries.find((entry) => Number(entry.slot?.position || 0) === Number(fleet.target_position || 0)) || null;
          const fromWorld = originEntry?.mesh?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3(0, 0, 0);
          const toWorld = targetEntry?.mesh?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3(0, 0, 0);
          const tRaw = Number(fleet.current_pos?.progress || 0.5);
          const t = fleet.returning ? 1 - THREE.MathUtils.clamp(tRaw, 0, 1) : THREE.MathUtils.clamp(tRaw, 0, 1);
          const localFrom = this.systemFleetGroup.worldToLocal(fromWorld.clone());
          const localTo = this.systemFleetGroup.worldToLocal(toWorld.clone());
          const pos = localFrom.clone().lerp(localTo, t);
          const drift = new THREE.Vector3(Math.cos(fleetEntry.phase + dt + index), Math.sin(fleetEntry.phase + dt * 0.7) * 0.6, Math.sin(fleetEntry.phase + dt + index));
          pos.add(drift.multiplyScalar(2.8 + index * 0.15));
          fleetEntry.group.position.copy(pos);
          fleetEntry.group.rotation.y += dt * 0.9;
        });
        if (this.systemBackdrop) this.systemBackdrop.rotation.y += dt * 0.01;
      }

      if (this._kbdMove.forward) { this._zoomTowardsTarget(0.97); this.autoFrameEnabled = false; }
      if (this._kbdMove.back) { this._zoomTowardsTarget(1.03); this.autoFrameEnabled = false; }
      if (this._kbdMove.left) { this._orbitAroundTarget(-0.018, 0); this.autoFrameEnabled = false; }
      if (this._kbdMove.right) { this._orbitAroundTarget(0.018, 0); this.autoFrameEnabled = false; }
      if (this._kbdMove.up) { this._orbitAroundTarget(0, -0.014); this.autoFrameEnabled = false; }
      if (this._kbdMove.down) { this._orbitAroundTarget(0, 0.014); this.autoFrameEnabled = false; }
      if (this._kbdMove.panL) { this.controls.target.x -= 0.85; this.camera.position.x -= 0.85; this.autoFrameEnabled = false; }
      if (this._kbdMove.panR) { this.controls.target.x += 0.85; this.camera.position.x += 0.85; this.autoFrameEnabled = false; }
      if (this._kbdMove.panU) { this.controls.target.z -= 0.85; this.camera.position.z -= 0.85; this.autoFrameEnabled = false; }
      if (this._kbdMove.panD) { this.controls.target.z += 0.85; this.camera.position.z += 0.85; this.autoFrameEnabled = false; }

      this._tickFocus(dt);
      this._followTrackedSelection();
      this._handleZoomThresholdTransitions();
      this._updateDoppler(dt);
      this._updateHoverMarker();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);

      if (!this.systemMode && typeof this.opts.onHover === 'function' && this.hoverIndex >= 0) {
        this.opts.onHover(this.visibleStars[this.hoverIndex], this.getScreenPosition(this.hoverIndex));
      }
    }

    destroy() {
      this.destroyed = true;
      window.removeEventListener('resize', this._onResizeBound);
      this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
      this.renderer.domElement.removeEventListener('click', this._onClick);
      this.renderer.domElement.removeEventListener('dblclick', this._onDoubleClick);
      this.renderer.domElement.removeEventListener('mousedown', this._onMouseDown);
      window.removeEventListener('mouseup', this._onMouseUp);
      this.renderer.domElement.removeEventListener('wheel', this._onWheel);
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      this.controls.dispose();
      this.renderer.dispose();
      if (this.coreStars) {
        this.coreStars.geometry.dispose();
        this.coreStars.material.dispose();
      }
      this._clearGroup(this.clusterAuraGroup);
      this._clearGroup(this.systemBackdrop);
      this._clearGroup(this.systemOrbitGroup);
      this._clearGroup(this.systemBodyGroup);
      this._clearGroup(this.systemFacilityGroup);
      this._clearGroup(this.systemFleetGroup);
      if (this.starPoints) {
        this.starPoints.geometry.dispose();
        this.starPoints.material.dispose();
      }
      if (this.hoverMarker) {
        this.hoverMarker.material.map?.dispose();
        this.hoverMarker.material.dispose();
      }
      if (this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }

  window.Galaxy3DRenderer = Galaxy3DRenderer;
})();
