/**
 * Integrierte UI-Komponenten für den Window Manager
 * Verbindet Ship Designer + Geometry Editor in einem System
 */

class UnifiedDesignerUI {
  constructor(windowManager) {
    this.wm = windowManager;
    this.currentDesignId = null;
    this.shipDesignerState = {
      selectedFaction: 'vor_tak',
      selectedClass: 'corvette',
      selectedLoRAStyles: [],
      shipName: 'Custom Ship',
      customDetails: ''
    };
    
    this.geometryEditorState = null;
    
    // Restore currentDesignId from localStorage
    const savedDesignId = localStorage.getItem('galaxy_quest_current_design_id');
    if (savedDesignId) {
      this.currentDesignId = parseInt(savedDesignId);
    }
    
    this.initialize();
  }

  initialize() {
    this.createPanels();
    this.setupPanelComponents();
  }

  createPanels() {
    // Left Sidebar: Properties & Settings
    this.wm.registerPanel('properties-panel', 'left', {
      title: '⚙️ Properties',
      width: '280px',
      closeable: false
    });

    this.wm.registerTab('properties-panel', 'faction', {
      title: 'Faction',
      icon: '⚔',
      component: this.createFactionPanel(),
      active: true
    });

    this.wm.registerTab('properties-panel', 'ship-class', {
      title: 'Ship Class',
      icon: '🛸',
      component: this.createShipClassPanel()
    });

    this.wm.registerTab('properties-panel', 'lora-styles', {
      title: 'LoRA Styles',
      icon: '🎨',
      component: this.createLoRAStylesPanel()
    });

    // Top Panel: Ship Preview & Controls
    this.wm.registerPanel('preview-panel', 'top', {
      title: '👁️ Preview',
      height: '250px',
      closeable: false
    });

    this.wm.registerTab('preview-panel', 'viewport', {
      title: 'Viewport',
      icon: '🎬',
      component: this.createViewportContainer(),
      active: true
    });

    this.wm.registerTab('preview-panel', 'generation-params', {
      title: 'Generation',
      icon: '⚡',
      component: this.createGenerationPanel()
    });

    // Center Panel: Main Editor (Geometry or Ship Designer)
    this.wm.registerPanel('editor-panel', 'center', {
      title: '🔧 Editor',
      closeable: false
    });

    this.wm.registerTab('editor-panel', 'wireframe', {
      title: '📐 Wireframe Editor',
      icon: '📐',
      component: this.createWireframeContainer(),
      active: true
    });

    this.wm.registerTab('editor-panel', 'ship-designer', {
      title: '🛸 Ship Designer',
      icon: '🛸',
      component: this.createShipDesignerContainer()
    });

    // Right Sidebar: Inspector & Debug
    this.wm.registerPanel('inspector-panel', 'right', {
      title: '🔍 Inspector',
      width: '280px',
      closeable: false
    });

    this.wm.registerTab('inspector-panel', 'geometry-info', {
      title: 'Geometry',
      icon: '📦',
      component: this.createGeometryInspector(),
      active: true
    });

    this.wm.registerTab('inspector-panel', 'selection', {
      title: 'Selection',
      icon: '✓',
      component: this.createSelectionInspector()
    });

    this.wm.registerTab('inspector-panel', 'console', {
      title: 'Console',
      icon: '⌨',
      component: this.createConsolePanel()
    });
  }

  setupPanelComponents() {
    // Event Listeners zwischen Panels
    this.setupCrossPanelCommunication();
  }

  setupCrossPanelCommunication() {
    // Wenn Geometry ändert, update Inspector
    document.addEventListener('geometry-changed', (e) => {
      const inspector = this.wm.getPanelState('inspector-panel');
      if (inspector) {
        this.updateGeometryInspector(e.detail);
      }
    });

    // Wenn Ship Properties ändern, regeneriere Preview
    document.addEventListener('properties-changed', (e) => {
      this.shipDesignerState = { ...this.shipDesignerState, ...e.detail };
      this.updatePreview();
    });
  }

  createFactionPanel() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-properties';
    
    const factions = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
    const icons = { vor_tak: '⚔', syl_nar: '🐙', aereth: '🔬', kryl_tha: '🦗', zhareen: '📚', vel_ar: '👁' };
    
    div.innerHTML = `
      <div class="property-group">
        <label class="property-label">Select Faction:</label>
        <div class="faction-buttons">
          ${factions.map(faction => `
            <button class="faction-btn ${faction === this.shipDesignerState.selectedFaction ? 'active' : ''}" data-faction="${faction}">
              ${icons[faction]} ${faction}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="property-info">
        <p style="font-size: 0.8rem; color: #6b7280; margin-top: 1rem;">
          Factions define visual style, color schemes, and signature components.
        </p>
      </div>
    `;

    div.querySelectorAll('.faction-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.shipDesignerState.selectedFaction = e.currentTarget.dataset.faction;
        div.querySelectorAll('.faction-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.dispatchPropertyChange();
      });
    });

    return div;
  }

  createShipClassPanel() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-properties';
    
    const classes = [
      { id: 'fighter', name: 'Fighter', triangles: '3,000 tri' },
      { id: 'corvette', name: 'Corvette', triangles: '8,000 tri' },
      { id: 'frigate', name: 'Frigate', triangles: '12,000 tri' },
      { id: 'destroyer', name: 'Destroyer', triangles: '18,000 tri' },
      { id: 'freighter', name: 'Freighter', triangles: '15,000 tri' },
      { id: 'capital', name: 'Capital Ship', triangles: '25,000 tri' }
    ];

    div.innerHTML = `
      <div class="property-group">
        <label class="property-label">Ship Class:</label>
        <select class="property-select ship-class-select">
          ${classes.map(c => `
            <option value="${c.id}" ${c.id === this.shipDesignerState.selectedClass ? 'selected' : ''}>
              ${c.name} (${c.triangles})
            </option>
          `).join('')}
        </select>
      </div>
      <div class="property-info">
        <p style="font-size: 0.8rem; color: #6b7280; margin-top: 1rem;">
          Ship class determines size, complexity, and polygon budget.
        </p>
      </div>
    `;

    div.querySelector('.ship-class-select')?.addEventListener('change', (e) => {
      this.shipDesignerState.selectedClass = e.target.value;
      this.dispatchPropertyChange();
    });

    return div;
  }

  createLoRAStylesPanel() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-properties';
    
    const styles = [
      { id: 'faction_signature', name: 'Faction Signature Style', desc: 'Apply faction-specific LoRA' },
      { id: 'industrial_militaristic', name: 'Industrial Militaristic', desc: 'Heavy armor, angular geometry' },
      { id: 'organic_biomimetic', name: 'Organic Biomimetic', desc: 'Flowing curves, biological' },
      { id: 'crystalline_geometric', name: 'Crystalline Geometric', desc: 'Sharp angles, crystalline' },
      { id: 'stealth_angular', name: 'Stealth Angular', desc: 'Radar-absorbing geometry' },
      { id: 'archival_geometric', name: 'Archival Geometric', desc: 'Information storage emphasis' }
    ];

    div.innerHTML = `
      <div class="property-group">
        <label class="property-label">LoRA Modifiers:</label>
        <div class="lora-checkboxes">
          ${styles.map(s => `
            <label class="checkbox-label">
              <input type="checkbox" class="lora-checkbox" data-style="${s.id}" 
                ${this.shipDesignerState.selectedLoRAStyles.includes(s.id) ? 'checked' : ''}>
              <span class="checkbox-text">
                <strong>${s.name}</strong>
                <br><small style="color: #6b7280;">${s.desc}</small>
              </span>
            </label>
          `).join('')}
        </div>
      </div>
    `;

    div.querySelectorAll('.lora-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(div.querySelectorAll('.lora-checkbox:checked'))
          .map(c => c.dataset.style);
        this.shipDesignerState.selectedLoRAStyles = checked;
        this.dispatchPropertyChange();
      });
    });

    return div;
  }

  createViewportContainer() {
    const div = document.createElement('div');
    div.id = 'viewport-container';
    div.className = 'viewport-container';
    div.style.cssText = `
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    `;
    div.innerHTML = '🎬 Viewport (3D Preview)';
    return div;
  }

  createGenerationPanel() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-properties';
    div.innerHTML = `
      <div class="property-group">
        <label class="property-label">Ship Name:</label>
        <input type="text" class="property-input ship-name-input" placeholder="Enter ship name" value="${this.shipDesignerState.shipName}">
      </div>
      <div class="property-group">
        <label class="property-label">Custom Details:</label>
        <textarea class="property-textarea custom-details-input" placeholder="Additional generation instructions..."></textarea>
      </div>
      <button class="generation-button">Generate Ship</button>
    `;

    div.querySelector('.ship-name-input')?.addEventListener('change', (e) => {
      this.shipDesignerState.shipName = e.target.value;
    });

    div.querySelector('.custom-details-input')?.addEventListener('change', (e) => {
      this.shipDesignerState.customDetails = e.target.value;
    });

    div.querySelector('.generation-button')?.addEventListener('click', () => {
      this.generateShip();
    });

    return div;
  }

  createWireframeContainer() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-wireframe';
    div.id = 'wireframe-editor-container';
    div.innerHTML = `
      <div style="flex: 1; position: relative; background: #0f172a; border-radius: 8px;">
        <!-- Wireframe Editor wird hier initialisiert -->
        <canvas id="wireframe-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
        <div id="wireframe-toolbar" style="position: absolute; top: 1rem; left: 1rem; background: rgba(15, 23, 42, 0.8); padding: 1rem; border-radius: 8px; max-width: 350px;">
          <!-- Toolbar wird gefüllt von wireframe-editor.js -->
        </div>
      </div>
    `;
    return div;
  }

  createShipDesignerContainer() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-ship-designer';
    div.id = 'ship-designer-workspace';
    div.innerHTML = `
      <div style="flex: 1; position: relative; background: #0f172a; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
        🛸 Ship Designer Preview Area
      </div>
    `;
    return div;
  }

  createGeometryInspector() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-inspector';
    div.id = 'geometry-inspector';
    div.innerHTML = `
      <div style="display: grid; gap: 0.5rem;">
        <div class="inspector-item">
          <label>Vertices:</label>
          <span class="inspector-value" data-field="vertices">0</span>
        </div>
        <div class="inspector-item">
          <label>Edges:</label>
          <span class="inspector-value" data-field="edges">0</span>
        </div>
        <div class="inspector-item">
          <label>Faces:</label>
          <span class="inspector-value" data-field="faces">0</span>
        </div>
        <div class="inspector-item">
          <label>Triangles:</label>
          <span class="inspector-value" data-field="triangles">0</span>
        </div>
        <hr style="border: none; border-top: 1px solid #374151; margin: 0.5rem 0;">
        <div class="inspector-item">
          <label>Bounds:</label>
          <span class="inspector-value" data-field="bounds">-</span>
        </div>
        <div class="inspector-item">
          <label>Volume:</label>
          <span class="inspector-value" data-field="volume">0</span>
        </div>
      </div>
    `;
    return div;
  }

  createSelectionInspector() {
    const div = document.createElement('div');
    div.className = 'wm-panel-content-inspector';
    div.id = 'selection-inspector';
    div.innerHTML = `
      <div style="display: grid; gap: 0.5rem;">
        <div class="inspector-item">
          <label>Selection Mode:</label>
          <span class="inspector-value" data-field="mode">Vertices</span>
        </div>
        <div class="inspector-item">
          <label>Selected Items:</label>
          <span class="inspector-value" data-field="count">0</span>
        </div>
        <div class="inspector-item">
          <label>Last Clicked:</label>
          <span class="inspector-value" data-field="last-id">-</span>
        </div>
        <hr style="border: none; border-top: 1px solid #374151; margin: 0.5rem 0;">
        <div class="inspector-item">
          <label>Position:</label>
          <span class="inspector-value" data-field="position" style="font-size: 0.75rem;">-</span>
        </div>
      </div>
    `;
    return div;
  }

  createConsolePanel() {
    const div = document.createElement('div');
    div.id = 'debug-console';
    div.className = 'wm-panel-content-inspector';
    div.style.cssText = `
      height: 100%;
      display: flex;
      flex-direction: column;
      font-family: 'Courier New', monospace;
      font-size: 0.75rem;
    `;
    div.innerHTML = `
      <div id="console-output" style="flex: 1; overflow-y: auto; padding: 0.5rem; background: #0a0e27; border-radius: 4px; border: 1px solid #374151; margin-bottom: 0.5rem;"></div>
      <input id="console-input" type="text" placeholder="> Type command..." style="padding: 0.4rem; background: #1f2937; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.75rem;">
    `;
    return div;
  }

  updateGeometryInspector(data) {
    const inspector = document.getElementById('geometry-inspector');
    if (inspector) {
      const fields = ['vertices', 'edges', 'faces', 'triangles', 'bounds', 'volume'];
      fields.forEach(field => {
        const span = inspector.querySelector(`[data-field="${field}"]`);
        if (span && data[field] !== undefined) {
          span.textContent = String(data[field]);
        }
      });
    }
  }

  dispatchPropertyChange() {
    document.dispatchEvent(new CustomEvent('properties-changed', {
      detail: this.shipDesignerState
    }));
  }

  updatePreview() {
    console.log('[UnifiedDesigner] Updating preview with:', this.shipDesignerState);
    // Wird implementiert wenn Preview-System verfügbar ist
  }

  setCurrentDesignId(designId) {
    this.currentDesignId = designId;
    if (designId) {
      localStorage.setItem('galaxy_quest_current_design_id', designId.toString());
      console.log(`[UnifiedDesigner] Current design ID set to: ${designId}`);
    } else {
      localStorage.removeItem('galaxy_quest_current_design_id');
    }
  }

  generateShip() {
    if (!this.currentDesignId) {
      this.showNotification('❌ Keine Design geladen. Bitte zuerst eine Design speichern oder laden.', 'error');
      return;
    }

    // Prompt aus State generieren
    const prompt = this.generatePromptFromState();
    
    // Generation Dialog anzeigen
    this.showGenerationDialog(prompt);
  }

  generatePromptFromState() {
    const factionNames = {
      'vor_tak': 'Vor\'Tak',
      'syl_nar': 'Syl\'Nar',
      'aereth': 'Aereth',
      'kryl_tha': 'Kryl\'Tha',
      'zhareen': 'Zhareen',
      'vel_ar': 'Vel\'Ar'
    };

    const classNames = {
      'fighter': 'Fighter Class',
      'corvette': 'Corvette Class',
      'frigate': 'Frigate Class',
      'destroyer': 'Destroyer Class',
      'freighter': 'Freighter Class',
      'capital': 'Capital Class'
    };

    const faction = factionNames[this.shipDesignerState.selectedFaction] || 'Unknown';
    const shipClass = classNames[this.shipDesignerState.selectedClass] || 'Unknown';
    const loraStyles = this.shipDesignerState.selectedLoRAStyles?.join(', ') || 'default';

    let prompt = `Create a sci-fi ${faction} ${shipClass} spaceship with the following characteristics:
- Faction: ${faction}
- Class: ${shipClass}
- Style: ${loraStyles}
- Name: ${this.shipDesignerState.shipName || 'Unnamed Vessel'}`;

    if (this.shipDesignerState.customDetails) {
      prompt += `\n- Additional Details: ${this.shipDesignerState.customDetails}`;
    }

    return prompt;
  }

  showGenerationDialog(defaultPrompt) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.7); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #1f2937; border: 1px solid #374151; border-radius: 12px;
      padding: 2rem; width: 90%; max-width: 600px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    `;

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="color: #e5e7eb; margin: 0; font-size: 1.3rem;">⚡ Ship Generation</h3>
        <button data-close style="background: none; border: none; color: #9ca3af; font-size: 1.5rem; cursor: pointer;">✕</button>
      </div>
      
      <div style="margin-bottom: 1rem;">
        <label style="color: #9ca3af; font-size: 0.9rem; display: block; margin-bottom: 0.5rem;">
          Generation Prompt (auto-generated, editable):
        </label>
        <textarea data-prompt style="width: 100%; height: 120px; padding: 0.75rem; background: #111827; border: 1px solid #374151; color: #e5e7eb; border-radius: 6px; font-family: monospace; font-size: 0.85rem; resize: none;">${defaultPrompt}</textarea>
      </div>

      <div style="margin-bottom: 1.5rem;">
        <label style="color: #9ca3af; font-size: 0.9rem; display: block; margin-bottom: 0.5rem;">
          Priority: <span data-priority-value style="color: #3b82f6; font-weight: 600;">0 (Normal)</span>
        </label>
        <input type="range" data-priority min="-1" max="2" value="0" style="width: 100%;" />
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: #6b7280; margin-top: 0.5rem;">
          <span>Lowest</span>
          <span>Normal</span>
          <span>Highest</span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem;">
        <button data-cancel style="padding: 0.75rem; background: #374151; color: #e5e7eb; border: 1px solid #4b5563; border-radius: 6px; cursor: pointer; font-weight: 500;">Cancel</button>
        <button data-generate style="padding: 0.75rem; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #ffffff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">🚀 Generate</button>
      </div>

      <div data-status style="margin-top: 1.5rem; padding: 1rem; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; display: none;">
        <div style="color: #93c5fd; font-size: 0.9rem;">
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span style="animation: spin 1s linear infinite;">⏳</span>
            <span data-status-text>Starting generation...</span>
          </div>
          <div data-estimated-wait style="color: #6b7280; font-size: 0.8rem; margin-top: 0.5rem;"></div>
          <div data-queue-id style="color: #6b7280; font-size: 0.8rem; margin-top: 0.25rem;"></div>
        </div>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Add spin animation
    if (!document.querySelector('style[data-spin]')) {
      const style = document.createElement('style');
      style.setAttribute('data-spin', '');
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // Event listeners
    const promptInput = dialog.querySelector('[data-prompt]');
    const priorityInput = dialog.querySelector('[data-priority]');
    const priorityValue = dialog.querySelector('[data-priority-value]');
    const statusDiv = dialog.querySelector('[data-status]');
    const statusText = dialog.querySelector('[data-status-text]');
    const estimatedWait = dialog.querySelector('[data-estimated-wait]');
    const queueId = dialog.querySelector('[data-queue-id]');

    const priorityLabels = ['Lowest', 'Normal', 'High', 'Highest'];
    priorityInput.addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      priorityValue.textContent = `${val} (${priorityLabels[val + 1] || 'Unknown'})`;
    });

    dialog.querySelector('[data-close]').addEventListener('click', () => {
      overlay.remove();
    });

    dialog.querySelector('[data-cancel]').addEventListener('click', () => {
      overlay.remove();
    });

    dialog.querySelector('[data-generate]').addEventListener('click', async () => {
      const prompt = promptInput.value.trim();
      const priority = parseInt(priorityInput.value);

      if (!prompt) {
        this.showNotification('❌ Prompt darf nicht leer sein.', 'error');
        return;
      }

      // UI ausblenden, Status anzeigen
      dialog.querySelector('[data-cancel]').disabled = true;
      dialog.querySelector('[data-generate]').disabled = true;
      statusDiv.style.display = 'block';

      try {
        const response = await fetch(`/api/generation_queue.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            prompt_text: prompt, 
            priority,
            design_id: this.currentDesignId 
          })
        });

        const data = await response.json();

        if (!response.ok) {
          this.showNotification(`❌ Generation fehler: ${data.error}`, 'error');
          statusDiv.style.display = 'none';
          dialog.querySelector('[data-cancel]').disabled = false;
          dialog.querySelector('[data-generate]').disabled = false;
          return;
        }

        statusText.textContent = '⏳ Generation in Warteschlange...';
        if (data.estimated_wait_seconds) {
          estimatedWait.textContent = `Geschätzte Wartezeit: ${data.estimated_wait_seconds}s`;
        }
        if (data.queue_id) {
          queueId.textContent = `Queue ID: ${data.queue_id}`;
        } else if (data.generation_id) {
          queueId.textContent = `Generation ID: ${data.generation_id}`;
        }

        this.showNotification(
          data.cache_hit 
            ? '✅ Generierung sofort verfügbar (Cache Hit)' 
            : `✅ Generation eingeplant (Geschätzte Wartezeit: ${data.estimated_wait_seconds}s)`,
          'success'
        );

        // Polling starten
        const queueIdToWatch = data.queue_id || data.generation_id;
        if (queueIdToWatch) {
          this.pollGenerationStatus(queueIdToWatch, statusText, statusDiv, dialog, overlay);
        } else {
          setTimeout(() => overlay.remove(), 3000);
        }

      } catch (error) {
        console.error('[UnifiedDesigner] Generation error:', error);
        this.showNotification(`❌ Fehler bei Generation: ${error.message}`, 'error');
        statusDiv.style.display = 'none';
        dialog.querySelector('[data-cancel]').disabled = false;
        dialog.querySelector('[data-generate]').disabled = false;
      }
    });
  }

  async pollGenerationStatus(queueId, statusText, statusDiv, dialog, overlay) {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/generation_queue.php?queue_id=${queueId}`);
        const data = await response.json();

        if (!response.ok) {
          clearInterval(pollInterval);
          this.showNotification(`❌ Status-Abfrage fehlgeschlagen: ${data.error}`, 'error');
          return;
        }

        statusText.textContent = `Status: ${data.status}`;

        if (data.status === 'complete') {
          clearInterval(pollInterval);
          this.showNotification('✅ Generierung abgeschlossen!', 'success');
          setTimeout(() => overlay.remove(), 2000);
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          this.showNotification(`❌ Generierung fehlgeschlagen: ${data.error}`, 'error');
          setTimeout(() => overlay.remove(), 3000);
        } else if (data.status === 'processing') {
          statusText.textContent = `🔧 Wird generiert... (${data.progress || '0'}%)`;
        }
      } catch (error) {
        console.error('[UnifiedDesigner] Polling error:', error);
        clearInterval(pollInterval);
      }
    }, 2000); // Poll alle 2 Sekunden
  }

  showNotification(message, type = 'info') {
    const div = document.createElement('div');
    const bgColor = type === 'error' ? '#7f1d1d' : type === 'success' ? '#1b4332' : '#1f2937';
    const borderColor = type === 'error' ? '#dc2626' : type === 'success' ? '#22c55e' : '#3b82f6';
    const textColor = type === 'error' ? '#fca5a5' : type === 'success' ? '#86efac' : '#93c5fd';

    div.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      background: ${bgColor};
      border: 1px solid ${borderColor};
      border-radius: 8px;
      color: ${textColor};
      font-size: 0.9rem;
      max-width: 400px;
      z-index: 9999;
      animation: slideIn 0.3s ease-out;
    `;

    div.innerHTML = message;
    document.body.appendChild(div);

    setTimeout(() => {
      div.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => div.remove(), 300);
    }, 4000);
  }
}

window.UnifiedDesignerUI = UnifiedDesignerUI;
