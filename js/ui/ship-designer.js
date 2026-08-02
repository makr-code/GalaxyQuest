/**
 * Ship Designer UI – Player-editable 3D ship generation via TRELLIS2
 * 
 * Features:
 * - Faction template gallery
 * - Real-time prompt editing with preview
 * - LoRA style selector
 * - 3D GLB viewer (Three.js)
 * - Generation progress tracking
 * - Ship save/export
 */

export function createShipDesignerUI(opts = {}) {
  const {
    containerId = 'ship-designer-container',
    apiBase = '/api',
    onGenerate = () => {},
    onSave = () => {},
    onError = () => {},
  } = opts;

  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`[ShipDesigner] Container #${containerId} not found`);
    return null;
  }

  // ─── State ────────────────────────────────────────────────────────────────

  let state = {
    selectedFaction: 'vor_tak',
    selectedClass: 'corvette',
    customizationPrompt: '',
    selectedLoRAStyles: [],
    shipName: 'Custom Ship',
    generatedPrompt: null,
    generatedGLB: null,
    isGenerating: false,
    shipTemplates: {},
    loraStyles: {},
    allFactionSigs: {},
  };

  // ─── UI Components ────────────────────────────────────────────────────────

  const html = `
    <div class="ship-designer" style="display: flex; gap: 1rem; height: 100%; background: #0a0e27;">
      
      <!-- Left panel: Configuration & Prompt -->
      <div class="sd-config-panel" style="flex: 0 0 380px; display: flex; flex-direction: column; gap: 1rem; padding: 1rem; background: #111827; border-right: 1px solid #1f2937; overflow-y: auto;">
        
        <!-- Faction selector -->
        <div class="sd-section">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Faction</h3>
          <div id="faction-gallery" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">
            <!-- Generated dynamically -->
          </div>
        </div>
        
        <!-- Ship class selector -->
        <div class="sd-section">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Ship Class</h3>
          <select id="ship-class" style="width: 100%; padding: 0.5rem; background: #1f2937; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; font-size: 0.9rem;">
            <option value="fighter">Fighter (3,000 tri)</option>
            <option value="corvette" selected>Corvette (8,000 tri)</option>
            <option value="frigate">Frigate (12,000 tri)</option>
            <option value="destroyer">Destroyer (18,000 tri)</option>
            <option value="freighter">Freighter (15,000 tri)</option>
            <option value="capital">Capital Ship (25,000 tri)</option>
          </select>
        </div>
        
        <!-- Ship name -->
        <div class="sd-section">
          <label style="display: block; font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 0.5px;">Ship Name</label>
          <input id="ship-name" type="text" placeholder="e.g. Void Stalker" value="Custom Ship" style="width: 100%; padding: 0.5rem; background: #1f2937; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box;">
        </div>
        
        <!-- LoRA Styles -->
        <div class="sd-section">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Style Modifiers (LoRA)</h3>
          <div id="lora-styles-list" style="display: flex; flex-direction: column; gap: 0.4rem;">
            <!-- Generated dynamically -->
          </div>
        </div>
        
        <!-- Customization prompt -->
        <div class="sd-section" style="flex: 1; display: flex; flex-direction: column;">
          <label style="display: block; font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 0.5px;">Custom Details</label>
          <textarea id="custom-prompt" placeholder="E.g. 'sleeker than default, with visible weapon ports' or 'add more organic tendrils'" style="flex: 1; padding: 0.5rem; background: #1f2937; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; font-size: 0.85rem; font-family: monospace; resize: none; box-sizing: border-box;"></textarea>
        </div>
        
        <!-- Generate button -->
        <button id="generate-btn" style="padding: 0.75rem; background: #3b82f6; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 0.9rem; transition: all 0.2s;">
          Generate Ship
        </button>
        
        <!-- Generated prompt preview (collapsible) -->
        <div class="sd-section" style="font-size: 0.8rem;">
          <details style="cursor: pointer;">
            <summary style="color: #60a5fa; padding: 0.3rem; user-select: none;">📄 View Generated Prompt</summary>
            <pre id="prompt-preview" style="background: #0f172a; color: #94a3b8; padding: 0.5rem; border-radius: 4px; margin-top: 0.3rem; max-height: 200px; overflow-y: auto; font-size: 0.75rem; line-height: 1.3; white-space: pre-wrap; word-wrap: break-word;"></pre>
          </details>
        </div>
        
      </div>
      
      <!-- Center/Right: 3D Viewer & Generation Progress -->
      <div class="sd-viewer-panel" style="flex: 1; display: flex; flex-direction: column; gap: 1rem; padding: 1rem; background: #0a0e27; position: relative;">
        
        <!-- 3D GLB Viewer -->
        <div id="glb-viewer-container" style="flex: 1; background: #111827; border: 1px solid #1f2937; border-radius: 4px; position: relative; display: flex; align-items: center; justify-content: center; color: #6b7280;">
          <canvas id="glb-viewer" style="width: 100%; height: 100%;"></canvas>
          <div id="viewer-placeholder" style="position: absolute; text-align: center; pointer-events: none;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🛸</div>
            <div style="color: #9ca3af; font-size: 0.9rem;">Generate a ship to preview</div>
          </div>
        </div>
        
        <!-- Generation progress -->
        <div id="progress-bar" style="display: none; background: #1f2937; border-radius: 4px; padding: 1rem; text-align: center;">
          <div style="font-size: 0.85rem; color: #d1d5db; margin-bottom: 0.5rem;">Generating with TRELLIS2...</div>
          <div style="background: #111827; border-radius: 4px; height: 8px; overflow: hidden;">
            <div id="progress-fill" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
          </div>
        </div>
        
        <!-- Ship stats & actions -->
        <div id="ship-stats" style="display: none; background: #1f2937; border-radius: 4px; padding: 1rem; font-size: 0.85rem;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 1rem;">
            <div>
              <div style="color: #9ca3af; margin-bottom: 0.2rem;">Triangles</div>
              <div id="stat-triangles" style="color: #60a5fa; font-weight: bold; font-size: 1rem;"></div>
            </div>
            <div>
              <div style="color: #9ca3af; margin-bottom: 0.2rem;">Materials</div>
              <div id="stat-materials" style="color: #60a5fa; font-weight: bold; font-size: 1rem;"></div>
            </div>
            <div>
              <div style="color: #9ca3af; margin-bottom: 0.2rem;">File Size</div>
              <div id="stat-filesize" style="color: #60a5fa; font-weight: bold; font-size: 1rem;"></div>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button id="save-btn" style="flex: 1; padding: 0.5rem; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
              Save Ship
            </button>
            <button id="export-btn" style="flex: 1; padding: 0.5rem; background: #6366f1; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
              Export GLB
            </button>
            <button id="regenerate-btn" style="flex: 1; padding: 0.5rem; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
              Regenerate
            </button>
          </div>
        </div>
        
      </div>
      
    </div>
  `;

  container.innerHTML = html;

  // ─── Initialization ───────────────────────────────────────────────────────

  async function init() {
    try {
      // Load templates & styles in parallel
      // NOTE: All endpoints are non-authenticated for ship designer
      const [templatesRes, stylesRes, quotaRes] = await Promise.all([
        fetch(`${apiBase}/ship_designer_engine.php?action=ship_templates`),
        fetch(`${apiBase}/ship_designer_engine.php?action=lora_styles`),
        fetch(`${apiBase}/user_quota.php`),
      ]);

      if (!templatesRes.ok || !stylesRes.ok) {
        console.warn('Failed to load some ship designer data, using defaults');
      }

      let templatesData = {};
      let stylesData = {};
      let quotaData = {};

      try {
        templatesData = await templatesRes.json();
      } catch (e) {
        console.warn('Failed to parse templates response:', e);
      }

      try {
        stylesData = await stylesRes.json();
      } catch (e) {
        console.warn('Failed to parse styles response:', e);
      }

      try {
        quotaData = await quotaRes.json();
      } catch (e) {
        console.warn('Failed to parse quota response:', e);
      }

      state.shipTemplates = templatesData.templates || {};
      state.loraStyles = stylesData.styles || {};
      state.userQuota = quotaData;
      state.designId = null; // Will be set after save
      state.queueId = null; // Will be set after queue

      renderUI();
    } catch (e) {
      console.error('[ShipDesigner] Init error:', e);
      onError(e.message);
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderUI() {
    renderFactionGallery();
    renderLoRAStyles();
    bindEventListeners();
  }

  function renderFactionGallery() {
    const gallery = container.querySelector('#faction-gallery');
    const factions = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
    const factionNames = {
      vor_tak: "Vor'Tak",
      syl_nar: "Syl'Nar",
      aereth: 'Aereth',
      kryl_tha: "Kryl'Tha",
      zhareen: 'Zhareen',
      vel_ar: "Vel'Ar",
    };
    const factionEmoji = {
      vor_tak: '⚔',
      syl_nar: '🐙',
      aereth: '🔬',
      kryl_tha: '🦗',
      zhareen: '📚',
      vel_ar: '👁',
    };

    gallery.innerHTML = factions
      .map(
        code => `
        <button class="faction-card" data-faction="${code}" style="
          padding: 0.8rem;
          background: ${state.selectedFaction === code ? '#3b82f6' : '#1f2937'};
          color: white;
          border: 2px solid ${state.selectedFaction === code ? '#60a5fa' : '#374151'};
          border-radius: 6px;
          cursor: pointer;
          font-size: 2rem;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        " title="${factionNames[code]}">
          <div>${factionEmoji[code]}</div>
          <div style="font-size: 0.6rem; margin-top: 0.2rem; font-weight: bold; text-transform: uppercase;">${code}</div>
        </button>
      `
      )
      .join('');

    gallery.querySelectorAll('.faction-card').forEach(card => {
      card.addEventListener('click', () => {
        state.selectedFaction = card.dataset.faction;
        renderUI();
        loadLoRAForFaction(state.selectedFaction);
      });
    });
  }

  function renderLoRAStyles() {
    const list = container.querySelector('#lora-styles-list');
    const styles = state.loraStyles;

    list.innerHTML = Object.entries(styles)
      .map(
        ([key, style]) => `
        <label style="display: flex; gap: 0.5rem; align-items: center; cursor: pointer; padding: 0.4rem; background: #1f2937; border-radius: 4px; transition: background 0.2s; user-select: none;">
          <input type="checkbox" data-lora-key="${key}" ${state.selectedLoRAStyles.includes(key) ? 'checked' : ''} style="cursor: pointer;">
          <span style="flex: 1;">
            <div style="color: #d1d5db; font-size: 0.85rem; font-weight: 500;">${style.name}</div>
            <div style="color: #6b7280; font-size: 0.75rem;">${style.description}</div>
          </span>
        </label>
      `
      )
      .join('');

    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', e => {
        const key = e.target.dataset.loraKey;
        if (e.target.checked) {
          if (!state.selectedLoRAStyles.includes(key)) {
            state.selectedLoRAStyles.push(key);
          }
        } else {
          state.selectedLoRAStyles = state.selectedLoRAStyles.filter(k => k !== key);
        }
      });
    });
  }

  async function loadLoRAForFaction(factionCode) {
    try {
      const res = await fetch(`${apiBase}/ship_designer_engine.php?action=lora_styles&faction_code=${factionCode}`);
      if (res.ok) {
        const data = await res.json();
        state.loraStyles = data.styles || {};
        state.selectedLoRAStyles = Object.keys(state.loraStyles).filter(k => {
          const preset = state.loraStyles[k];
          return preset.enabled_by_default !== false;
        });
        renderLoRAStyles();
      }
    } catch (e) {
      console.error('[ShipDesigner] Failed to load LoRA styles:', e);
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  function bindEventListeners() {
    const generateBtn = container.querySelector('#generate-btn');
    const saveBtn = container.querySelector('#save-btn');
    const exportBtn = container.querySelector('#export-btn');
    const regenerateBtn = container.querySelector('#regenerate-btn');
    const shipClassSelect = container.querySelector('#ship-class');
    const shipNameInput = container.querySelector('#ship-name');
    const customPromptTA = container.querySelector('#custom-prompt');

    shipClassSelect.addEventListener('change', e => {
      state.selectedClass = e.target.value;
    });

    shipNameInput.addEventListener('change', e => {
      state.shipName = e.target.value.trim() || 'Custom Ship';
    });

    customPromptTA.addEventListener('change', e => {
      state.customizationPrompt = e.target.value;
    });

    generateBtn.addEventListener('click', generateShip);
    saveBtn.addEventListener('click', saveShip);
    exportBtn.addEventListener('click', exportGLB);
    regenerateBtn.addEventListener('click', generateShip);
  }

  // ─── Generation ───────────────────────────────────────────────────────────

  async function generateShip() {
    if (state.isGenerating) return;

    state.isGenerating = true;
    container.querySelector('#generate-btn').disabled = true;
    container.querySelector('#progress-bar').style.display = 'block';
    container.querySelector('#ship-stats').style.display = 'none';

    try {
      // Step 1: Check quota
      updateProgress(5, 'Checking quota...');
      if (state.userQuota && state.userQuota.monthly_remaining <= 0) {
        throw new Error('Monthly generation limit reached. Upgrade your account.');
      }
      if (state.userQuota && state.userQuota.storage_percent_used >= 95) {
        throw new Error('Storage quota nearly full. Please delete some designs.');
      }

      // Step 2: Save design if not already saved
      if (!state.designId) {
        updateProgress(10, 'Saving design...');
        const saveRes = await fetch(`${apiBase}/vessel_designs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            species_code: state.selectedFaction,
            design_name: state.shipName,
            customizations: {
              ship_class: state.selectedClass,
              custom_prompt: state.customizationPrompt,
              lora_styles: state.selectedLoRAStyles,
            },
            description: `Ship class: ${state.selectedClass}, Custom details: ${state.customizationPrompt}`,
          }),
        });

        if (!saveRes.ok) {
          const error = await saveRes.json();
          throw new Error(error.error || 'Failed to save design');
        }

        const saveData = await saveRes.json();
        state.designId = saveData.id;
        console.log('[ShipDesigner] Design saved:', state.designId);
      }

      // Step 3: Generate prompt from backend
      updateProgress(15, 'Generating prompt...');
      const promptRes = await fetch(`${apiBase}/ship_designer_engine.php?action=generate_prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faction_code: state.selectedFaction,
          ship_class: state.selectedClass,
          name: state.shipName,
          customization_prompt: state.customizationPrompt,
          lora_styles: state.selectedLoRAStyles,
        }),
      });

      if (!promptRes.ok) {
        const error = await promptRes.json();
        throw new Error(error.error || 'Failed to generate prompt');
      }

      const promptData = await promptRes.json();
      state.generatedPrompt = promptData.prompt;
      state.generatedMetadata = promptData.metadata;

      // Show generated prompt
      container.querySelector('#prompt-preview').textContent = state.generatedPrompt;
      updateProgress(25, 'Queueing generation...');

      // Step 4: Queue generation via TRELLIS2 API
      const queueRes = await fetch(`${apiBase}/vessel_designs/${state.designId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_text: state.generatedPrompt,
          priority: 0,
        }),
      });

      if (!queueRes.ok) {
        const error = await queueRes.json();
        throw new Error(error.error || 'Failed to queue generation');
      }

      const queueData = await queueRes.json();

      // Case A: Cache hit - already have GLB
      if (queueData.generation_id) {
        console.log('[ShipDesigner] Cache hit! Using generation:', queueData.generation_id);
        updateProgress(50, 'Cache hit! Loading model...');
        await loadGenerationById(queueData.generation_id);
        updateProgress(100, 'Done!');
      } else {
        // Case B: Queued for processing - poll status
        console.log('[ShipDesigner] Queued:', queueData.queue_id);
        state.queueId = queueData.queue_id;
        updateProgress(35, `Queued (position ~${queueData.estimated_wait_seconds}s)`);
        await pollGenerationStatus(state.queueId);
      }

      // Load into viewer
      setTimeout(() => {
        updateShipStats();
        container.querySelector('#ship-stats').style.display = 'block';
        container.querySelector('#progress-bar').style.display = 'none';
        state.isGenerating = false;
        container.querySelector('#generate-btn').disabled = false;
        onGenerate(state.generatedMetadata);
      }, 500);
    } catch (e) {
      console.error('[ShipDesigner] Generation error:', e);
      container.querySelector('#progress-bar').style.display = 'none';
      state.isGenerating = false;
      container.querySelector('#generate-btn').disabled = false;
      onError(e.message);
    }
  }

  /**
   * Poll queue status every 2 seconds
   */
  async function pollGenerationStatus(queueId) {
    return new Promise((resolve, reject) => {
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${apiBase}/generation_queue/${queueId}`);
          if (!statusRes.ok) throw new Error('Queue status unavailable');

          const statusData = await statusRes.json();

          // Update progress
          const position = statusData.queue_position || 0;
          const total = statusData.total_in_queue || 1;
          const progressPercent = 35 + Math.max(0, Math.min(60, (1 - (position / Math.max(1, total))) * 60));
          updateProgress(progressPercent, `Queue position: ${position}/${total}`);

          // Check if complete
          if (statusData.status === 'complete' && statusData.generation_id) {
            clearInterval(pollInterval);
            console.log('[ShipDesigner] Generation complete:', statusData.generation_id);
            updateProgress(95, 'Loading model...');
            await loadGenerationById(statusData.generation_id);
            updateProgress(100, 'Done!');
            resolve();
          } else if (statusData.status === 'failed') {
            clearInterval(pollInterval);
            reject(new Error('Generation failed: ' + (statusData.error_message || 'Unknown error')));
          }
        } catch (error) {
          clearInterval(pollInterval);
          reject(error);
        }
      }, 2000);
    });
  }

  /**
   * Load a completed generation by ID
   */
  async function loadGenerationById(generationId) {
    const genRes = await fetch(`${apiBase}/asset_generations/${generationId}`);
    if (!genRes.ok) throw new Error('Failed to load generation');

    const genData = await genRes.json();
    state.generatedGLB = genData.glb_path;
    state.generatedMetadata = {
      tri_budget: 8000,
      ...genData.metadata,
      glb_file_size: genData.glb_file_size,
      generation_time_ms: genData.generation_time_ms,
    };

    // Load GLB into viewer
    loadGLBIntoViewer(genData.glb_path);
  }

  function updateProgress(percent, message = '') {
    const fill = container.querySelector('#progress-fill');
    if (fill) {
      fill.style.width = percent + '%';
    }
    const msgDiv = container.querySelector('#progress-bar');
    if (msgDiv && message) {
      const label = msgDiv.querySelector('div:first-child');
      if (label) {
        label.textContent = 'Generating with TRELLIS2... ' + message;
      }
    }
  }

  // ─── 3D Viewer ────────────────────────────────────────────────────────────

  function loadGLBIntoViewer(glbPath) {
    // Load GLB file into Three.js viewer
    console.log('[ShipDesigner] Loading GLB into viewer:', glbPath);

    const placeholder = container.querySelector('#viewer-placeholder');
    if (placeholder) {
      placeholder.style.display = 'none';
    }

    const canvas = container.querySelector('#glb-viewer');
    if (!canvas) return;

    // Initialize Three.js scene if not already done
    if (!state.scene) {
      state.scene = new THREE.Scene();
      state.camera = new THREE.PerspectiveCamera(75, canvas.parentElement.clientWidth / canvas.parentElement.clientHeight, 0.1, 1000);
      state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      state.renderer.setSize(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight);
      state.renderer.setClearColor(0x111827, 1);

      // Lighting
      const light = new THREE.DirectionalLight(0xffffff, 0.8);
      light.position.set(5, 10, 7);
      state.scene.add(light);
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
      state.scene.add(ambientLight);

      state.camera.position.z = 5;

      // Animation loop
      const animate = () => {
        requestAnimationFrame(animate);
        if (state.model) {
          state.model.rotation.y += 0.005;
        }
        state.renderer.render(state.scene, state.camera);
      };
      animate();
    }

    // Load GLB
    if (typeof THREE !== 'undefined' && THREE.GLTFLoader) {
      const loader = new THREE.GLTFLoader();
      loader.load(glbPath, (gltf) => {
        // Remove old model
        if (state.model) {
          state.scene.remove(state.model);
        }
        state.model = gltf.scene;
        state.scene.add(state.model);
        console.log('[ShipDesigner] GLB loaded successfully');
      });
    } else {
      console.warn('[ShipDesigner] Three.js GLTFLoader not available');
    }
  }

  function updateShipStats() {
    const metadata = state.generatedMetadata || {};
    container.querySelector('#stat-triangles').textContent =
      (metadata.tri_budget ? `~${Math.floor(metadata.tri_budget * 0.7)}/${metadata.tri_budget}` : 'N/A');
    container.querySelector('#stat-materials').textContent = 
      (metadata.material_count || '6-8');
    
    let fileSize = 'N/A';
    if (metadata.glb_file_size) {
      const mb = (metadata.glb_file_size / 1024 / 1024).toFixed(1);
      fileSize = mb + ' MB';
    } else if (metadata.file_size_bytes) {
      const kb = (metadata.file_size_bytes / 1024).toFixed(1);
      fileSize = kb + ' KB';
    }
    container.querySelector('#stat-filesize').textContent = fileSize;
  }

  // ─── Save & Export ────────────────────────────────────────────────────────

  async function saveShip() {
    if (!state.generatedGLB || !state.designId) {
      onError('No ship generated yet');
      return;
    }

    try {
      // Design is already saved in DB via TRELLIS2 API
      // Just confirm to user
      onSave({
        id: state.designId,
        faction_code: state.selectedFaction,
        ship_class: state.selectedClass,
        ship_name: state.shipName,
        glb_path: state.generatedGLB,
        message: 'Ship design saved successfully!',
      });
      console.log('[ShipDesigner] Ship saved:', state.designId);
    } catch (e) {
      console.error('[ShipDesigner] Save error:', e);
      onError(e.message);
    }
  }

  function exportGLB() {
    if (!state.generatedGLB) {
      onError('No ship generated yet');
      return;
    }

    // state.generatedGLB is now a path, not binary data
    // Create a download link to the file
    const a = document.createElement('a');
    a.href = state.generatedGLB;
    a.download = `${state.shipName || 'ship'}.glb`;
    a.click();
  }

  // ─── Mock GLB Creator (for testing) ───────────────────────────────────────

  function createMockGLB(metadata) {
    // Create a minimal valid GLB file for testing
    // Real implementation would use actual TRELLIS2 output
    const triCount = metadata.tri_budget || 8000;
    const sizeKB = Math.floor(triCount / 100) + Math.floor(Math.random() * 50);
    const buffer = new ArrayBuffer(sizeKB * 1024);
    return buffer;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  init();

  return {
    getState: () => ({ ...state }),
    setFaction: code => {
      state.selectedFaction = code;
      renderUI();
      loadLoRAForFaction(code);
    },
    setClass: shipClass => {
      state.selectedClass = shipClass;
    },
    generate: generateShip,
    export: exportGLB,
    save: saveShip,
  };
}

export default createShipDesignerUI;
