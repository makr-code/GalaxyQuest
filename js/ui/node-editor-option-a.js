/**
 * Node Editor – Option A: Procedural Nodes (Simplified)
 * Fully integrated initialization
 */

(function() {
  'use strict';

  window.createNodeEditor = function(opts = {}) {
    const { container, apiBase = '/api' } = opts;

    console.log('[NodeEditor-Init] Called with container:', !!container, 'THREE:', !!window.THREE);

    if (!container) {
      console.error('[NodeEditor-Init] No container provided');
      return null;
    }

    if (!window.THREE) {
      console.error('[NodeEditor-Init] THREE.js not loaded');
      return null;
    }

    console.log('[NodeEditor-Init] Setup OK, proceeding...');

    // ─────────────────────────────────────────────────────────────────
    // Setup Container
    // ─────────────────────────────────────────────────────────────────
    
    container.innerHTML = '';  // Clear any existing content
    
    // Get parent size
    const parentWidth = container.parentElement?.offsetWidth || window.innerWidth;
    const parentHeight = container.parentElement?.offsetHeight || window.innerHeight;
    
    // Must use explicit pixel sizes for absolute positioning
    container.style.position = 'relative';  // Use relative instead to work within layout flow
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.background = '#0a0e27';
    container.style.overflow = 'hidden';
    container.style.fontFamily = 'system-ui, sans-serif';
    
    console.log('[NodeEditor-Init] Container configured (parent: ' + parentWidth + 'x' + parentHeight + ')');

    // State
    const state = {
      nodes: [],
      edges: [],
      selectedNode: null,
      nodeIdCounter: 0,
      draggingNode: null,
      scene: null,
      camera: null,
      renderer: null,
      raycaster: new window.THREE.Raycaster(),
      mouse: new window.THREE.Vector2(),
      
      // NEW: Undo/Redo
      history: [],
      historyIndex: -1,
      
      // NEW: Node type colors
      typeColors: {
        hull: 0xffffff,      // white
        engine: 0xff6b6b,    // red
        sensor: 0x4ecdc4,    // teal
        cargo: 0xffe66d,     // yellow
        weapon: 0xff1493,    // deep pink
        shield: 0x00d4ff,    // cyan
        armor: 0x95a5a6,     // gray
        default: 0x60a5fa,   // blue
      },
      
      // NEW: Canvas references for MiniMap
      miniMapCanvas: null,
      miniMapCtx: null,
    };

    // ─────────────────────────────────────────────────────────────────
    // Create HTML
    // ─────────────────────────────────────────────────────────────────

    // Toolbar
    const toolbarDiv = document.createElement('div');
    toolbarDiv.style.cssText =
      'background:#1f2937; padding:0.75rem; border-bottom:1px solid #374151; display:flex; gap:0.5rem; flex-wrap:wrap; flex:0 0 auto;';

    const btnAdd = document.createElement('button');
    btnAdd.textContent = '➕ Add Node';
    btnAdd.style.cssText =
      'padding:0.4rem 0.8rem; background:#3b82f6; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem;';

    const btnDelete = document.createElement('button');
    btnDelete.textContent = '❌ Delete';
    btnDelete.style.cssText =
      'padding:0.4rem 0.8rem; background:#ef4444; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem;';

    const btnConnect = document.createElement('button');
    btnConnect.textContent = '🔗 Connect';
    btnConnect.style.cssText =
      'padding:0.4rem 0.8rem; background:#8b5cf6; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem;';

    const btnReset = document.createElement('button');
    btnReset.textContent = '🔄 Reset';
    btnReset.style.cssText =
      'padding:0.4rem 0.8rem; background:#6b7280; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem;';

    const btnExport = document.createElement('button');
    btnExport.textContent = '📤 Export';
    btnExport.style.cssText =
      'padding:0.4rem 0.8rem; background:#f59e0b; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem; margin-left:auto;';

    const btnUndo = document.createElement('button');
    btnUndo.textContent = '↶ Undo';
    btnUndo.style.cssText =
      'padding:0.4rem 0.8rem; background:#1e40af; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem;';

    const btnRedo = document.createElement('button');
    btnRedo.textContent = '↷ Redo';
    btnRedo.style.cssText =
      'padding:0.4rem 0.8rem; background:#1e40af; color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.9rem;';

    toolbarDiv.appendChild(btnAdd);
    toolbarDiv.appendChild(btnDelete);
    toolbarDiv.appendChild(btnConnect);
    toolbarDiv.appendChild(btnReset);
    toolbarDiv.appendChild(btnExport);
    toolbarDiv.appendChild(btnUndo);
    toolbarDiv.appendChild(btnRedo);
    container.appendChild(toolbarDiv);

    // Content area
    const contentDiv = document.createElement('div');
    contentDiv.style.cssText =
      'display:flex; gap:1rem; flex:1; overflow:hidden; padding:1rem; min-height:0;';

    // Canvas container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText =
      'flex:1; background:#111827; border:1px solid #1f2937; border-radius:4px; position:relative; overflow:hidden; min-height:0;';

    const canvas = document.createElement('canvas');
    // IMPORTANT: Canvas must have explicit width/height attributes for WebGL
    canvas.style.cssText = 'width:100%; height:100%; display:block;';
    canvasContainer.appendChild(canvas);

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.style.cssText =
      'flex:0 0 300px; background:#1f2937; border-radius:4px; padding:1rem; border:1px solid #374151; display:flex; flex-direction:column; overflow-y:auto;';

    const sidebarHTML = `
      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:bold; color:#e5e7eb; margin-bottom:0.75rem; font-size:0.9rem;">🗺 Mini Map</div>
        <canvas id="ne-minimap" style="width:100%; border:1px solid #374151; border-radius:3px; background:#0f172a; display:block;"></canvas>
      </div>
      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:bold; color:#e5e7eb; margin-bottom:0.75rem; font-size:0.9rem;">🎨 Templates</div>
        <div id="ne-templates" style="display:grid; grid-template-columns:repeat(2,1fr); gap:0.5rem; margin-bottom:1rem;"></div>
      </div>
      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:bold; color:#e5e7eb; margin-bottom:0.75rem; font-size:0.9rem;">📍 Nodes</div>
        <div id="ne-node-list" style="background:#111827; border-radius:3px; padding:0.5rem; min-height:100px; max-height:250px; overflow-y:auto; font-size:0.85rem; color:#d1d5db;"></div>
      </div>
      <div style="border-top:1px solid #374151; padding-top:1rem;">
        <div style="font-weight:bold; color:#e5e7eb; margin-bottom:0.75rem; font-size:0.9rem;">📊 Stats</div>
        <div style="background:#111827; border-radius:3px; padding:0.75rem; font-size:0.85rem; color:#d1d5db; line-height:1.6;">
          <div>Nodes: <strong id="ne-stat-nodes" style="color:#60a5fa;">0</strong></div>
          <div>Edges: <strong id="ne-stat-edges" style="color:#8b5cf6;">0</strong></div>
          <div>Volume: <strong id="ne-stat-volume" style="color:#f59e0b;">0.0</strong> u³</div>
        </div>
      </div>
    `;
    sidebar.innerHTML = sidebarHTML;

    contentDiv.appendChild(canvasContainer);
    contentDiv.appendChild(sidebar);
    container.appendChild(contentDiv);

    // Load template thumbnails (AFTER sidebar is added to DOM)
    const templateImages = [
      'fighter', 'corvette', 'frigate', 'destroyer', 'freighter', 'capital',
      'interceptor', 'scout', 'trader', 'cruiser', 'dreadnought', 'mothership'
    ];
    
    const templatesDiv = document.getElementById('ne-templates');
    if (templatesDiv) {
      templateImages.forEach((name, idx) => {
        const thumb = document.createElement('div');
        thumb.style.cssText = `
          width:100%; aspect-ratio:1; background:#0f172a; border:1px solid #374151;
          border-radius:3px; cursor:pointer; display:flex; align-items:center;
          justify-content:center; font-size:0.75rem; color:#6b7280; transition:all 0.2s;
        `;
        thumb.textContent = name;
        thumb.title = `Template: ${name}`;
        thumb.onmouseover = () => {
          thumb.style.background = '#1f2937';
          thumb.style.borderColor = '#60a5fa';
        };
        thumb.onmouseout = () => {
          thumb.style.background = '#0f172a';
          thumb.style.borderColor = '#374151';
        };
        thumb.onclick = () => {
          // Load template: add nodes based on type
          console.log('[NodeEditor] Loaded template:', name);
          resetToDefault();  // For now, just reset to default
        };
        templatesDiv.appendChild(thumb);
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Three.js Setup
    // ─────────────────────────────────────────────────────────────────

    // Use initial viewport size, will be resized by ResizeObserver
    let w = canvasContainer.clientWidth || 800;
    let h = canvasContainer.clientHeight || 600;
    
    // Fallback to viewport size if container hasn't laid out yet
    if (w <= 0) w = window.innerWidth * 0.7;
    if (h <= 0) h = window.innerHeight * 0.8;

    console.log('[NodeEditor] Init: container=' + canvasContainer.clientWidth + 'x' + canvasContainer.clientHeight + ', w=' + w + ', h=' + h);

    state.scene = new window.THREE.Scene();
    state.scene.background = new window.THREE.Color(0x111827);

    state.camera = new window.THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    state.camera.position.set(0, 0, 8);

    state.renderer = new window.THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    
    // CRITICAL: Set canvas attributes using setAttribute to ensure they stick
    canvas.setAttribute('width', String(w));
    canvas.setAttribute('height', String(h));
    console.log('[NodeEditor] Canvas attrs set to ' + w + 'x' + h + ', actual: ' + canvas.width + 'x' + canvas.height);
    
    state.renderer.setSize(w, h, false);
    state.renderer.shadowMap.enabled = true;

    // Force an immediate render to populate the canvas
    state.renderer.render(state.scene, state.camera);

    // Force immediate resize callback to update if container size is available
    setTimeout(() => {
      const newW = canvasContainer.clientWidth;
      const newH = canvasContainer.clientHeight;
      console.log('[NodeEditor] Timeout callback: container now ' + newW + 'x' + newH);
      if (newW > 0 && newH > 0 && (newW !== w || newH !== h)) {
        canvas.setAttribute('width', String(newW));
        canvas.setAttribute('height', String(newH));
        state.camera.aspect = newW / newH;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(newW, newH, false);
        state.renderer.render(state.scene, state.camera);
        console.log('[NodeEditor] Resized to', newW, 'x', newH);
      }
    }, 100);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      const newW = canvasContainer.clientWidth;
      const newH = canvasContainer.clientHeight;
      if (newW > 0 && newH > 0) {
        canvas.setAttribute('width', String(newW));
        canvas.setAttribute('height', String(newH));
        state.camera.aspect = newW / newH;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(newW, newH, false);
        state.renderer.render(state.scene, state.camera);
        console.log('[NodeEditor] ResizeObserver: resized to', newW, 'x', newH);
      }
    });
    resizeObserver.observe(canvasContainer);

    // Lighting
    const light = new window.THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(5, 10, 7);
    state.scene.add(light);
    state.scene.add(new window.THREE.AmbientLight(0xffffff, 0.5));

    // Grid
    const gridHelper = new window.THREE.GridHelper(20, 20, 0x444444, 0x222222);
    gridHelper.position.y = -5;
    state.scene.add(gridHelper);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      state.renderer.render(state.scene, state.camera);
    };
    animate();

    // Initialize with default graph
    resetToDefault();

    console.log('[NodeEditor] Three.js initialized with default nodes');

    // ─────────────────────────────────────────────────────────────────
    // Core Functions
    // ─────────────────────────────────────────────────────────────────

    function addNode(type = 'hull', pos = null) {
      if (!pos) {
        pos = {
          x: Math.random() * 4 - 2,
          y: Math.random() * 3 - 1,
          z: Math.random() * 2 - 1,
        };
      }

      const id = state.nodeIdCounter++;
      const geo = new window.THREE.SphereGeometry(0.7, 16, 16);
      
      // Get color based on node type
      const color = state.typeColors[type] || state.typeColors.default;
      
      const mat = new window.THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.4,
        roughness: 0.5,
        emissive: 0x333333,
      });
      const mesh = new window.THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.userData.nodeId = id;
      mesh.userData.nodeType = type;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      state.scene.add(mesh);

      state.nodes.push({ id, type, position: pos, mesh });
      console.log('[NodeEditor] Added node', id, type, '(color:', color.toString(16) + ')');
      
      // Save history for undo
      saveHistory();
      
      updateUI();
      redrawEdges();
      updateMiniMap();
      return id;
    }

    function deleteNode(id) {
      const idx = state.nodes.findIndex(n => n.id === id);
      if (idx >= 0) {
        state.scene.remove(state.nodes[idx].mesh);
        state.nodes.splice(idx, 1);
        state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
        if (state.selectedNode === id) state.selectedNode = null;
        saveHistory();
        updateUI();
        redrawEdges();
        updateMiniMap();
      }
    }

    function connectNodes(fromId, toId) {
      if (fromId !== toId && !state.edges.find(e => e.from === fromId && e.to === toId)) {
        state.edges.push({ from: fromId, to: toId });
        saveHistory();
        redrawEdges();
        updateUI();
        updateMiniMap();
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Undo/Redo System
    // ─────────────────────────────────────────────────────────────────
    
    function saveHistory() {
      // Serialize current state
      const snapshot = {
        nodes: state.nodes.map(n => ({ id: n.id, type: n.type, position: { ...n.position } })),
        edges: state.edges.map(e => ({ ...e })),
        nodeIdCounter: state.nodeIdCounter,
        selectedNode: state.selectedNode,
      };
      
      // Remove any redo history
      state.history = state.history.slice(0, state.historyIndex + 1);
      
      // Add new entry
      state.history.push(snapshot);
      state.historyIndex++;
      
      // Limit history to 50 entries
      if (state.history.length > 50) {
        state.history.shift();
        state.historyIndex--;
      }
      
      console.log('[NodeEditor] History saved:', state.historyIndex);
    }
    
    function undo() {
      if (state.historyIndex > 0) {
        state.historyIndex--;
        restoreHistory(state.history[state.historyIndex]);
        console.log('[NodeEditor] Undo executed');
      }
    }
    
    function redo() {
      if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        restoreHistory(state.history[state.historyIndex]);
        console.log('[NodeEditor] Redo executed');
      }
    }
    
    function restoreHistory(snapshot) {
      // Remove all existing meshes
      state.nodes.forEach(n => state.scene.remove(n.mesh));
      
      // Rebuild nodes
      state.nodes = snapshot.nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: { ...n.position },
        mesh: null, // Will be recreated
      }));
      state.edges = snapshot.edges.map(e => ({ ...e }));
      state.nodeIdCounter = snapshot.nodeIdCounter;
      state.selectedNode = snapshot.selectedNode;
      
      // Recreate meshes
      state.nodes.forEach(n => {
        const geo = new window.THREE.SphereGeometry(0.7, 16, 16);
        const color = state.typeColors[n.type] || state.typeColors.default;
        const mat = new window.THREE.MeshStandardMaterial({
          color: color,
          metalness: 0.4,
          roughness: 0.5,
          emissive: 0x333333,
        });
        const mesh = new window.THREE.Mesh(geo, mat);
        mesh.position.set(n.position.x, n.position.y, n.position.z);
        mesh.userData.nodeId = n.id;
        mesh.userData.nodeType = n.type;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        state.scene.add(mesh);
        n.mesh = mesh;
      });
      
      updateUI();
      redrawEdges();
      updateMiniMap();
    }

    function redrawEdges() {
      // Remove old edges
      state.scene.children = state.scene.children.filter(obj => {
        if (obj instanceof window.THREE.LineSegments && obj.userData && obj.userData.isEdge) {
          state.scene.remove(obj);
          return false;
        }
        return true;
      });

      // Create new edges
      const points = [];
      state.edges.forEach(e => {
        const from = state.nodes.find(n => n.id === e.from);
        const to = state.nodes.find(n => n.id === e.to);
        if (from && to) {
          points.push(from.position.x, from.position.y, from.position.z);
          points.push(to.position.x, to.position.y, to.position.z);
        }
      });

      if (points.length > 0) {
        const geo = new window.THREE.BufferGeometry();
        geo.setAttribute('position', new window.THREE.BufferAttribute(new Float32Array(points), 3));
        const mat = new window.THREE.LineBasicMaterial({ color: 0x60a5fa });
        const lines = new window.THREE.LineSegments(geo, mat);
        lines.userData.isEdge = true;
        state.scene.add(lines);
      }
    }

    function resetToDefault() {
      state.nodes.forEach(n => state.scene.remove(n.mesh));
      state.nodes = [];
      state.edges = [];
      state.nodeIdCounter = 0;
      state.selectedNode = null;

      const c1 = addNode('hull', { x: 0, y: 0, z: 0 });
      const c2 = addNode('engine', { x: 2, y: -0.5, z: -1 });
      const c3 = addNode('engine', { x: -2, y: -0.5, z: -1 });
      const c4 = addNode('sensor', { x: 0, y: 1.5, z: 0.5 });
      const c5 = addNode('cargo', { x: 0, y: -1, z: 2 });

      connectNodes(c1, c2);
      connectNodes(c1, c3);
      connectNodes(c1, c4);
      connectNodes(c1, c5);

      updateUI();
    }

    function updateMiniMap() {
      if (!state.miniMapCanvas) {
        state.miniMapCanvas = document.getElementById('ne-minimap');
        if (!state.miniMapCanvas) return;
        state.miniMapCanvas.width = state.miniMapCanvas.offsetWidth || 200;
        state.miniMapCanvas.height = state.miniMapCanvas.offsetHeight || 150;
        state.miniMapCtx = state.miniMapCanvas.getContext('2d');
      }
      
      const ctx = state.miniMapCtx;
      const w = state.miniMapCanvas.width;
      const h = state.miniMapCanvas.height;
      
      // Clear
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      
      // Grid
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo((w / 4) * i, 0);
        ctx.lineTo((w / 4) * i, h);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(0, (h / 4) * i);
        ctx.lineTo(w, (h / 4) * i);
        ctx.stroke();
      }
      
      if (state.nodes.length === 0) return;
      
      // Find bounds
      const xs = state.nodes.map(n => n.position.x);
      const ys = state.nodes.map(n => n.position.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const margin = 20;
      
      const scaleX = (w - margin * 2) / rangeX;
      const scaleY = (h - margin * 2) / rangeY;
      const scale = Math.min(scaleX, scaleY);
      
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      
      // Draw edges
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1;
      state.edges.forEach(e => {
        const from = state.nodes.find(n => n.id === e.from);
        const to = state.nodes.find(n => n.id === e.to);
        if (from && to) {
          const x1 = w / 2 + (from.position.x - centerX) * scale;
          const y1 = h / 2 + (from.position.y - centerY) * scale;
          const x2 = w / 2 + (to.position.x - centerX) * scale;
          const y2 = h / 2 + (to.position.y - centerY) * scale;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      });
      
      // Draw nodes
      state.nodes.forEach(n => {
        const px = w / 2 + (n.position.x - centerX) * scale;
        const py = h / 2 + (n.position.y - centerY) * scale;
        const radius = 3;
        
        // Node color
        const color = state.typeColors[n.type] || state.typeColors.default;
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Selection ring
        if (state.selectedNode === n.id) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, radius + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    function updateUI() {
      document.getElementById('ne-stat-nodes').textContent = state.nodes.length;
      document.getElementById('ne-stat-edges').textContent = state.edges.length;

      const volume = state.nodes.reduce(
        (sum, n) => sum + (4 / 3) * Math.PI * ((Math.sqrt(n.position.x ** 2 + n.position.y ** 2 + n.position.z ** 2) / 2) ** 2),
        0
      );
      document.getElementById('ne-stat-volume').textContent = volume.toFixed(1);

      const nodeList = document.getElementById('ne-node-list');
      if (state.nodes.length === 0) {
        nodeList.innerHTML = '<div style="color:#6b7280; font-style:italic; padding:0.5rem;">No nodes</div>';
      } else {
        nodeList.innerHTML = state.nodes
          .map(
            n => `
          <div data-id="${n.id}" style="padding:0.4rem; background:${state.selectedNode === n.id ? '#3b82f6' : '#0f172a'}; border:1px solid #374151; border-radius:3px; margin-bottom:0.3rem; cursor:pointer;">
            <strong>Node ${n.id}</strong> (${n.type})
          </div>
        `
          )
          .join('');

        document.querySelectorAll('#ne-node-list div[data-id]').forEach(el => {
          el.addEventListener('click', () => {
            state.selectedNode = parseInt(el.getAttribute('data-id'));
            updateUI();
          });
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────

    btnAdd.onclick = () => {
      console.log('[NodeEditor] Add button clicked');
      addNode();
    };

    btnDelete.onclick = () => {
      if (state.selectedNode !== null) {
        console.log('[NodeEditor] Delete node', state.selectedNode);
        deleteNode(state.selectedNode);
        state.selectedNode = null;
      }
    };

    btnConnect.onclick = () => {
      if (state.selectedNode !== null) {
        const others = state.nodes.filter(n => n.id !== state.selectedNode);
        if (others.length > 0) {
          connectNodes(state.selectedNode, others[0].id);
        }
      }
    };

    btnReset.onclick = () => {
      console.log('[NodeEditor] Reset');
      resetToDefault();
    };

    btnExport.onclick = () => {
      const desc = `Geometry: ${state.nodes.length} nodes, ${state.edges.length} edges`;
      console.log('[NodeEditor] Export:', desc);
      if (opts.onExport) opts.onExport(desc);
      alert('Geometry exported:\n\n' + desc);
    };

    btnUndo.onclick = () => {
      console.log('[NodeEditor] Undo');
      undo();
    };

    btnRedo.onclick = () => {
      console.log('[NodeEditor] Redo');
      redo();
    };

    // ─────────────────────────────────────────────────────────────────
    // Mouse Interaction: Click, Drag, Zoom, Pan
    // ─────────────────────────────────────────────────────────────────

    // Mouse move for dragging nodes
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      state.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // If dragging, move the node
      if (state.draggingNode !== null) {
        const node = state.nodes.find(n => n.id === state.draggingNode);
        if (node && e.buttons === 1) {  // Left mouse button
          // Convert mouse position to world coordinates at node z-depth
          const vFOV = state.camera.fov * Math.PI / 180;  // convert vertical FOV to radians
          const height = 2 * Math.tan(vFOV / 2) * Math.abs(node.position.z - state.camera.position.z);  // height at z
          const width = height * (canvas.width / canvas.height);

          node.position.x = state.mouse.x * (width / 2);
          node.position.y = state.mouse.y * (height / 2);
          node.mesh.position.copy(node.position);
          redrawEdges();
        }
      }

      // Highlight hover node
      state.raycaster.setFromCamera(state.mouse, state.camera);
      const hits = state.raycaster.intersectObjects(state.nodes.map(n => n.mesh));
      state.nodes.forEach(n => {
        n.mesh.material.emissive.setHex(0x333333);
      });
      if (hits.length > 0) {
        hits[0].object.material.emissive.setHex(0x666666);  // Brighter on hover
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = 'default';
      }
    });

    // Mouse down to start dragging
    canvas.addEventListener('mousedown', e => {
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      state.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      state.raycaster.setFromCamera(state.mouse, state.camera);
      const hits = state.raycaster.intersectObjects(state.nodes.map(n => n.mesh));

      if (hits.length > 0) {
        const nodeId = hits[0].object.userData.nodeId;
        state.selectedNode = nodeId;
        state.draggingNode = nodeId;
        canvas.style.cursor = 'grabbing';
        updateUI();
      }
    });

    // Mouse up to stop dragging
    canvas.addEventListener('mouseup', () => {
      if (state.draggingNode !== null) {
        console.log('[NodeEditor] Dropped node', state.draggingNode);
      }
      state.draggingNode = null;
      canvas.style.cursor = 'default';
    });

    // Canvas wheel to zoom (with limits)
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const minDistance = 2;
      const maxDistance = 50;
      const newDist = state.camera.position.length() * (1 + e.deltaY * 0.001);
      const clampedDist = Math.max(minDistance, Math.min(maxDistance, newDist));
      state.camera.position.multiplyScalar(clampedDist / state.camera.position.length());
      console.log('[NodeEditor] Zoom:', clampedDist.toFixed(1));
    });

    // Right-click drag to pan
    let panStart = null;
    canvas.addEventListener('mousedown', e => {
      if (e.button === 2) {  // Right mouse button
        panStart = { x: e.clientX, y: e.clientY };
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (panStart && e.buttons === 2) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        const speed = state.camera.position.length() * 0.01;
        state.camera.position.x -= dx * speed;
        state.camera.position.y += dy * speed;
        panStart = { x: e.clientX, y: e.clientY };
      }
    });

    canvas.addEventListener('mouseup', () => {
      panStart = null;
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ─────────────────────────────────────────────────────────────────
    // Advanced: Connect Dialog and Export
    // ─────────────────────────────────────────────────────────────────

    function showConnectDialog() {
      if (state.nodes.length < 2) {
        alert('Need at least 2 nodes to connect');
        return;
      }

      // Create modal
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); display: flex; align-items: center;
        justify-content: center; z-index: 10000;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: #1f2937; border: 1px solid #374151; border-radius: 8px;
        padding: 2rem; min-width: 400px; color: #e5e7eb;
      `;

      const title = document.createElement('div');
      title.textContent = 'Connect Two Nodes';
      title.style.cssText = 'font-size: 1.1rem; font-weight: bold; margin-bottom: 1rem;';
      dialog.appendChild(title);

      const fromLabel = document.createElement('label');
      fromLabel.textContent = 'From: ';
      fromLabel.style.cssText = 'display: block; margin-bottom: 0.5rem; font-size: 0.9rem;';
      const fromSelect = document.createElement('select');
      fromSelect.style.cssText = `
        width: 100%; padding: 0.5rem; background: #111827; color: #e5e7eb;
        border: 1px solid #374151; border-radius: 3px; margin-bottom: 1rem;
      `;
      state.nodes.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = `Node ${n.id} (${n.type})`;
        if (n.id === state.selectedNode) opt.selected = true;
        fromSelect.appendChild(opt);
      });
      fromLabel.appendChild(fromSelect);
      dialog.appendChild(fromLabel);

      const toLabel = document.createElement('label');
      toLabel.textContent = 'To: ';
      toLabel.style.cssText = 'display: block; margin-bottom: 0.5rem; font-size: 0.9rem;';
      const toSelect = document.createElement('select');
      toSelect.style.cssText = `
        width: 100%; padding: 0.5rem; background: #111827; color: #e5e7eb;
        border: 1px solid #374151; border-radius: 3px; margin-bottom: 1.5rem;
      `;
      state.nodes.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = `Node ${n.id} (${n.type})`;
        toSelect.appendChild(opt);
      });
      toLabel.appendChild(toSelect);
      dialog.appendChild(toLabel);

      const buttonDiv = document.createElement('div');
      buttonDiv.style.cssText = 'display: flex; gap: 0.5rem; justify-content: flex-end;';

      const btnOK = document.createElement('button');
      btnOK.textContent = 'Connect';
      btnOK.style.cssText = `
        padding: 0.5rem 1rem; background: #8b5cf6; color: white;
        border: none; border-radius: 3px; cursor: pointer;
      `;
      btnOK.onclick = () => {
        const from = parseInt(fromSelect.value);
        const to = parseInt(toSelect.value);
        if (from !== to) {
          connectNodes(from, to);
          console.log('[NodeEditor] Connected node', from, 'to', to);
        }
        modal.remove();
      };
      buttonDiv.appendChild(btnOK);

      const btnCancel = document.createElement('button');
      btnCancel.textContent = 'Cancel';
      btnCancel.style.cssText = `
        padding: 0.5rem 1rem; background: #6b7280; color: white;
        border: none; border-radius: 3px; cursor: pointer;
      `;
      btnCancel.onclick = () => modal.remove();
      buttonDiv.appendChild(btnCancel);

      dialog.appendChild(buttonDiv);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
    }

    function exportGeometry() {
      const geometry = {
        timestamp: new Date().toISOString(),
        nodes: state.nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: { x: n.position.x, y: n.position.y, z: n.position.z },
        })),
        edges: state.edges.map(e => ({ from: e.from, to: e.to })),
        stats: {
          nodeCount: state.nodes.length,
          edgeCount: state.edges.length,
          volume: state.nodes.reduce(
            (sum, n) => sum + (4 / 3) * Math.PI * ((Math.sqrt(n.position.x ** 2 + n.position.y ** 2 + n.position.z ** 2) / 2) ** 2),
            0
          ),
        },
      };

      // Create download link
      const json = JSON.stringify(geometry, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `geometry-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      // Also try to save to API
      fetch(`${apiBase}/geometry_export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geometry),
      }).catch(err => console.log('[NodeEditor] API export (optional):', err));

      console.log('[NodeEditor] Exported geometry:', json.length, 'bytes');
    }

    // Override button handlers
    btnConnect.onclick = showConnectDialog;
    btnExport.onclick = exportGeometry;

    // ─────────────────────────────────────────────────────────────────
    // Keyboard Shortcuts
    // ─────────────────────────────────────────────────────────────────

    document.addEventListener('keydown', e => {
      // Only if Node Editor is active (canvas is focused or visible)
      const nodeEditorTab = document.getElementById('node-editor-tab');
      if (!nodeEditorTab || nodeEditorTab.style.display === 'none') return;

      if (e.key === 'z' && e.ctrlKey && !e.shiftKey) {
        // Ctrl+Z: Undo
        e.preventDefault();
        undo();
        console.log('[NodeEditor] Undo via Keyboard');
      } else if ((e.key === 'y' && e.ctrlKey) || (e.key === 'z' && e.ctrlKey && e.shiftKey)) {
        // Ctrl+Y or Ctrl+Shift+Z: Redo
        e.preventDefault();
        redo();
        console.log('[NodeEditor] Redo via Keyboard');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected node
        if (state.selectedNode !== null) {
          e.preventDefault();
          deleteNode(state.selectedNode);
          state.selectedNode = null;
          console.log('[NodeEditor] Deleted via Keyboard');
        }
      } else if (e.key === 'e' && e.ctrlKey) {
        // Ctrl+E: Export
        e.preventDefault();
        exportGeometry();
        console.log('[NodeEditor] Exported via Keyboard');
      } else if (e.key === 'a' && e.ctrlKey) {
        // Ctrl+A: Add Node
        e.preventDefault();
        addNode();
        console.log('[NodeEditor] Added node via Keyboard');
      } else if (e.key === 'r' && e.ctrlKey) {
        // Ctrl+R: Reset
        e.preventDefault();
        resetToDefault();
        console.log('[NodeEditor] Reset via Keyboard');
      } else if (e.key === 'c' && e.ctrlKey) {
        // Ctrl+C: Connect Dialog
        e.preventDefault();
        showConnectDialog();
        console.log('[NodeEditor] Connect dialog via Keyboard');
      } else if (e.key === 'd' && e.ctrlKey) {
        // Ctrl+D: Duplicate selected node
        e.preventDefault();
        if (state.selectedNode !== null) {
          const node = state.nodes.find(n => n.id === state.selectedNode);
          if (node) {
            const newPos = {
              x: node.position.x + 0.5,
              y: node.position.y + 0.5,
              z: node.position.z,
            };
            addNode(node.type, newPos);
            console.log('[NodeEditor] Duplicated node', state.selectedNode);
          }
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────
    // Initialize
    // ─────────────────────────────────────────────────────────────────

    resetToDefault();
    console.log('[NodeEditor] Initialization complete with all features');

    return state;
  };
})();
