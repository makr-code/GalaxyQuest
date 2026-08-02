/**
 * TRELLIS2 Enhanced Ship Designer UI
 * Real-time 3D ship design with TRELLIS2 generation queueing
 * 
 * Features:
 *   - Real-time prompt preview (updated as user adjusts sliders)
 *   - Queue status polling with position + ETA
 *   - Cache hit detection (instant preview on duplicates)
 *   - Progress indicators during generation
 *   - Three.js GLB rendering when complete
 */

class TRELLIS2ShipDesigner {
    constructor(containerId = 'ship-designer-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container #${containerId} not found`);
        }
        
        // State
        this.currentSpecies = null;
        this.currentCustomizations = {};
        this.currentDesignId = null;
        this.currentQueueId = null;
        this.currentGenerationId = null;
        this.pollInterval = null;
        
        // UI elements
        this.speciesSelect = null;
        this.sliderContainer = null;
        this.promptPreview = null;
        this.generateButton = null;
        this.statusPanel = null;
        this.previewCanvas = null;
        
        // Three.js scene
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.model = null;
        
        this.init();
    }
    
    /**
     * Initialize UI and load templates
     */
    async init() {
        console.log('[TRELLIS2] Initializing Ship Designer');
        
        // Build UI
        this.buildUI();
        
        // Load species templates from Python backend
        await this.loadSpeciesTemplates();
        
        // Setup Three.js scene
        this.initThreeJS();
        
        console.log('[TRELLIS2] Designer ready');
    }
    
    /**
     * Build the UI structure
     */
    buildUI() {
        const html = `
<div class="trellis2-designer">
    <div class="designer-main">
        <div class="designer-left">
            <!-- Species Selection -->
            <div class="section">
                <h3>Species</h3>
                <select id="species-select" class="form-control">
                    <option value="">Choose a species...</option>
                </select>
            </div>
            
            <!-- Customization Sliders -->
            <div class="section">
                <h3>Customization</h3>
                <div id="slider-container" class="sliders">
                    <!-- Dynamically populated -->
                </div>
            </div>
            
            <!-- Design Name -->
            <div class="section">
                <h3>Design Name</h3>
                <input type="text" id="design-name" class="form-control" placeholder="e.g., 'Elite Scout Warship'">
            </div>
            
            <!-- Action Buttons -->
            <div class="section">
                <button id="save-design-btn" class="btn btn-secondary">Save Design</button>
                <button id="generate-btn" class="btn btn-primary" disabled>Generate 3D Model</button>
            </div>
        </div>
        
        <div class="designer-right">
            <!-- Prompt Preview -->
            <div class="section">
                <h3>TRELLIS2 Prompt</h3>
                <div id="prompt-preview" class="prompt-preview">
                    <em>Select a species to see the prompt...</em>
                </div>
                <small class="text-muted">This prompt will be sent to TRELLIS2 for 3D generation</small>
            </div>
            
            <!-- Status Panel -->
            <div class="section" id="status-panel" style="display:none;">
                <h3>Generation Status</h3>
                <div id="status-content" class="status-content">
                    <!-- Updated by polling -->
                </div>
            </div>
            
            <!-- 3D Preview Canvas -->
            <div class="section">
                <h3>3D Preview</h3>
                <div id="preview-canvas" class="preview-canvas" style="background: #222; width: 100%; height: 400px; border-radius: 8px;">
                    <!-- Three.js scene rendered here -->
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.trellis2-designer {
    font-family: 'Segoe UI', sans-serif;
    padding: 20px;
    max-width: 1400px;
}

.designer-main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-top: 20px;
}

.designer-left, .designer-right {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.section {
    background: #f5f5f5;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
}

.section h3 {
    margin: 0 0 15px 0;
    font-size: 16px;
    font-weight: 600;
    color: #333;
}

.form-control {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
}

.form-control:focus {
    outline: none;
    border-color: #0066cc;
    box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
}

.sliders {
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.slider-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.slider-label {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 500;
    color: #666;
}

.slider-value {
    color: #0066cc;
    font-weight: 600;
}

.slider-group input[type="range"] {
    width: 100%;
    cursor: pointer;
}

.slider-group input[type="color"] {
    width: 50px;
    height: 40px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.btn {
    padding: 12px 20px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-primary {
    background: #0066cc;
    color: white;
}

.btn-primary:hover:not(:disabled) {
    background: #0052a3;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 102, 204, 0.3);
}

.btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-secondary {
    background: #666;
    color: white;
}

.btn-secondary:hover {
    background: #555;
}

.prompt-preview {
    background: #2d2d2d;
    color: #e0e0e0;
    padding: 15px;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.6;
    font-family: 'Courier New', monospace;
    max-height: 200px;
    overflow-y: auto;
    word-break: break-word;
}

.status-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.status-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    background: white;
    border-radius: 4px;
    border-left: 3px solid #0066cc;
}

.status-label {
    font-size: 12px;
    font-weight: 600;
    color: #333;
}

.status-value {
    font-size: 14px;
    font-weight: 700;
    color: #0066cc;
}

.progress-bar {
    width: 100%;
    height: 6px;
    background: #e0e0e0;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 10px;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #0066cc, #00cc99);
    transition: width 0.3s;
}

.preview-canvas {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}

.preview-canvas canvas {
    display: block;
    width: 100%;
    height: 100%;
}

.loading-spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.text-muted {
    color: #999;
    font-size: 12px;
    margin-top: 8px;
}

@media (max-width: 1000px) {
    .designer-main {
        grid-template-columns: 1fr;
    }
}
</style>
        `;
        
        this.container.innerHTML = html;
        
        // Cache elements
        this.speciesSelect = this.container.querySelector('#species-select');
        this.sliderContainer = this.container.querySelector('#slider-container');
        this.promptPreview = this.container.querySelector('#prompt-preview');
        this.generateButton = this.container.querySelector('#generate-btn');
        this.statusPanel = this.container.querySelector('#status-panel');
        this.previewCanvas = this.container.querySelector('#preview-canvas');
        this.designNameInput = this.container.querySelector('#design-name');
        
        // Event handlers
        this.speciesSelect.addEventListener('change', () => this.onSpeciesChange());
        this.generateButton.addEventListener('click', () => this.onGenerateClick());
        this.container.querySelector('#save-design-btn').addEventListener('click', () => this.onSaveClick());
    }
    
    /**
     * Load species templates from Python backend
     */
    async loadSpeciesTemplates() {
        try {
            // This would call your Python service or load from API
            // For now, we'll use a mock (you can replace with real API)
            this.speciesTemplates = MOCK_SPECIES_TEMPLATES;
            
            // Populate species dropdown
            for (const [code, species] of Object.entries(this.speciesTemplates)) {
                const option = document.createElement('option');
                option.value = code;
                option.textContent = species.display_name;
                this.speciesSelect.appendChild(option);
            }
            
            console.log('[TRELLIS2] Loaded species templates');
        } catch (error) {
            console.error('[TRELLIS2] Failed to load templates:', error);
            alert('Failed to load species templates');
        }
    }
    
    /**
     * Called when species is selected
     */
    async onSpeciesChange() {
        const code = this.speciesSelect.value;
        if (!code) return;
        
        this.currentSpecies = code;
        this.currentCustomizations = {};
        
        const species = this.speciesTemplates[code];
        
        // Clear existing sliders
        this.sliderContainer.innerHTML = '';
        
        // Build customization sliders
        for (const point of species.customization_points) {
            const div = document.createElement('div');
            div.className = 'slider-group';
            
            if (point.type === 'slider') {
                div.innerHTML = `
<div class="slider-label">
    <span>${point.label}</span>
                    <span class="slider-value">${point.default}</span>
                </div>
                <input type="range" 
                       min="${point.min}" 
                       max="${point.max}" 
                       value="${point.default}"
                       data-key="${point.key}">
                `;
                
                const input = div.querySelector('input');
                const valueSpan = div.querySelector('.slider-value');
                
                input.addEventListener('input', (e) => {
                    valueSpan.textContent = e.target.value;
                    this.currentCustomizations[point.key] = parseFloat(e.target.value);
                    this.updatePromptPreview();
                });
                
                this.currentCustomizations[point.key] = point.default;
            } else if (point.type === 'color') {
                div.innerHTML = `
<div class="slider-label">
    <span>${point.label}</span>
                </div>
                <input type="color" 
                       value="${point.default}"
                       data-key="${point.key}">
                `;
                
                const input = div.querySelector('input');
                input.addEventListener('change', (e) => {
                    this.currentCustomizations[point.key] = e.target.value;
                    this.updatePromptPreview();
                });
                
                this.currentCustomizations[point.key] = point.default;
            }
            
            this.sliderContainer.appendChild(div);
        }
        
        this.generateButton.disabled = false;
        this.updatePromptPreview();
    }
    
    /**
     * Update prompt preview in real-time
     */
    updatePromptPreview() {
        if (!this.currentSpecies) return;
        
        const species = this.speciesTemplates[this.currentSpecies];
        let prompt = species.prompt_template;
        
        // Replace variables
        for (const [key, value] of Object.entries(this.currentCustomizations)) {
            prompt = prompt.replace(`{${key}}`, String(value));
        }
        
        this.promptPreview.textContent = prompt;
    }
    
    /**
     * Save design to database
     */
    async onSaveClick() {
        if (!this.currentSpecies) {
            alert('Please select a species');
            return;
        }
        
        const designName = this.designNameInput.value.trim();
        if (!designName) {
            alert('Please enter a design name');
            return;
        }
        
        try {
            this.generateButton.disabled = true;
            
            const response = await fetch('/api/vessel_designs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    species_code: this.currentSpecies,
                    design_name: designName,
                    customizations: this.currentCustomizations,
                    description: 'Generated via Ship Designer UI',
                }),
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save design');
            }
            
            const data = await response.json();
            this.currentDesignId = data.id;
            
            console.log('[TRELLIS2] Design saved:', this.currentDesignId);
            alert(`Design saved! (ID: ${data.id})`);
            
            this.generateButton.disabled = false;
        } catch (error) {
            console.error('[TRELLIS2] Save failed:', error);
            alert('Failed to save design: ' + error.message);
            this.generateButton.disabled = false;
        }
    }
    
    /**
     * Queue generation when Generate button is clicked
     */
    async onGenerateClick() {
        if (!this.currentDesignId) {
            alert('Please save the design first');
            return;
        }
        
        const prompt = this.promptPreview.textContent;
        if (!prompt || prompt.includes('{')) {
            alert('Prompt template error - please review the preview');
            return;
        }
        
        try {
            this.generateButton.disabled = true;
            this.showStatus('Submitting generation request...');
            
            const response = await fetch(`/api/vessel_designs/${this.currentDesignId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt_text: prompt,
                    priority: 0,
                }),
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to queue generation');
            }
            
            const data = await response.json();
            
            if (data.generation_id) {
                // Cache hit - already have the GLB
                console.log('[TRELLIS2] Cache hit! Using generation', data.generation_id);
                this.showStatus('✅ Cache hit! Loading model...', 'success');
                await this.loadGeneration(data.generation_id);
            } else {
                // Queued for processing
                console.log('[TRELLIS2] Queued:', data.queue_id);
                this.currentQueueId = data.queue_id;
                this.showStatus('Generation queued - waiting for GPU...', 'info');
                
                // Start polling
                this.startPolling(data.queue_id);
            }
            
        } catch (error) {
            console.error('[TRELLIS2] Generate failed:', error);
            this.showStatus('❌ ' + error.message, 'error');
            this.generateButton.disabled = false;
        }
    }
    
    /**
     * Show status panel
     */
    showStatus(message, type = 'info') {
        this.statusPanel.style.display = 'block';
        const statusContent = this.statusPanel.querySelector('#status-content');
        
        const color = {
            'info': '#0066cc',
            'success': '#00aa00',
            'error': '#cc0000',
        }[type] || '#0066cc';
        
        statusContent.innerHTML = `
<div style="color: ${color}; padding: 15px; background: rgba(0,0,0,0.05); border-radius: 4px;">
    ${message}
</div>
        `;
    }
    
    /**
     * Poll queue status every 2 seconds
     */
    startPolling(queueId) {
        this.pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/generation_queue/${queueId}`);
                if (!response.ok) throw new Error('Queue status unavailable');
                
                const data = await response.json();
                
                const statusMsg = `
<div class="status-item">
                    <span class="status-label">Status</span>
                    <span class="status-value">${data.status.toUpperCase()}</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Queue Position</span>
                    <span class="status-value">${data.queue_position}/${data.total_in_queue}</span>
                </div>
                <div class="status-item">
                    <span class="status-label">ETA</span>
                    <span class="status-value">~${data.estimated_wait_seconds}s</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${Math.min(100, (1 - (data.queue_position / Math.max(1, data.total_in_queue))) * 100)}%"></div>
                </div>
                `;
                
                this.statusPanel.querySelector('#status-content').innerHTML = statusMsg;
                
                // Check if complete
                if (data.status === 'complete' && data.generation_id) {
                    clearInterval(this.pollInterval);
                    this.showStatus('✅ Generation complete! Loading model...', 'success');
                    await this.loadGeneration(data.generation_id);
                } else if (data.status === 'failed') {
                    clearInterval(this.pollInterval);
                    this.showStatus('❌ Generation failed: ' + (data.error_message || 'Unknown error'), 'error');
                    this.generateButton.disabled = false;
                }
            } catch (error) {
                console.error('[TRELLIS2] Polling error:', error);
                this.showStatus('⚠️ Status update error', 'error');
            }
        }, 2000);
    }
    
    /**
     * Load and display generated GLB
     */
    async loadGeneration(generationId) {
        try {
            const response = await fetch(`/api/asset_generations/${generationId}`);
            if (!response.ok) throw new Error('Generation not found');
            
            const data = await response.json();
            this.currentGenerationId = generationId;
            
            // Load GLB in Three.js
            await this.loadGLBInThreeJS(data.glb_path);
            
            this.showStatus(`✅ Model loaded! (${data.glb_file_size} bytes, ${data.generation_time_ms}ms)`, 'success');
            this.generateButton.disabled = false;
            
        } catch (error) {
            console.error('[TRELLIS2] Load generation failed:', error);
            this.showStatus('❌ Failed to load model: ' + error.message, 'error');
            this.generateButton.disabled = false;
        }
    }
    
    /**
     * Initialize Three.js scene
     */
    initThreeJS() {
        const width = this.previewCanvas.clientWidth;
        const height = this.previewCanvas.clientHeight;
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x1a1a1a);
        this.previewCanvas.innerHTML = '';
        this.previewCanvas.appendChild(this.renderer.domElement);
        
        // Lighting
        const light = new THREE.DirectionalLight(0xffffff, 0.8);
        light.position.set(5, 10, 7);
        this.scene.add(light);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);
        
        this.camera.position.z = 5;
        
        // Animation loop
        const animate = () => {
            requestAnimationFrame(animate);
            if (this.model) {
                this.model.rotation.y += 0.01;
            }
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }
    
    /**
     * Load GLB file into Three.js
     */
    async loadGLBInThreeJS(glbPath) {
        // Remove old model
        if (this.model) {
            this.scene.remove(this.model);
        }
        
        return new Promise((resolve, reject) => {
            const loader = new THREE.GLTFLoader();
            loader.load(
                glbPath,
                (gltf) => {
                    this.model = gltf.scene;
                    this.scene.add(this.model);
                    resolve();
                },
                undefined,
                (error) => {
                    reject(error);
                }
            );
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DATA (replace with real templates)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_SPECIES_TEMPLATES = {
    'kryltha': {
        display_name: 'Kryl\'Tha',
        prompt_template: 'A Kryl\'Tha warship, sleek insectoid design, carapace_color={carapace_color}, detail_level={detail_level}, with chitinous plating and predatory aesthetics',
        customization_points: [
            { key: 'carapace_color', label: 'Carapace Color', type: 'color', default: '#2d5f4f' },
            { key: 'detail_level', label: 'Detail Level', type: 'slider', min: 0, max: 100, default: 75 },
        ],
    },
    'vortak': {
        display_name: 'Vor\'Tak',
        prompt_template: 'A massive Vor\'Tak tank, industrial build_strength={build_strength}, rust_factor={rust_factor}, heavily armored',
        customization_points: [
            { key: 'build_strength', label: 'Build Strength', type: 'slider', min: 30, max: 100, default: 85 },
            { key: 'rust_factor', label: 'Weathering', type: 'slider', min: 0, max: 50, default: 20 },
        ],
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

// Auto-initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    const designer = new TRELLIS2ShipDesigner('ship-designer-container');
    window.TRELLIS2Designer = designer; // Expose globally for debugging
});
