/**
 * Multi-Mode TRELLIS2 Generation Modal
 * Supports: Text→3D, Image→3D, Hybrid (Image→Base+Text)
 */

class MultiModeGenerationModal {
  constructor() {
    this.modal = null;
    this.currentMode = 'text';
    this.selectedImage = null;
    this.pollingIntervals = new Map();
    this.apiUrl = '/api/generation_queue_v2.php';
  }

  create() {
    const html = `
    <div id="multi-mode-modal" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🚀 Multi-Mode 3D Generation</h2>
          <button class="modal-close" onclick="multiModeModal.close()">✕</button>
        </div>
        
        <div class="modal-body">
          <!-- Mode Selector -->
          <div class="mode-selector">
            <button class="mode-btn active" data-mode="text">
              <span class="mode-icon">📝</span>
              <span>Text→3D</span>
            </button>
            <button class="mode-btn" data-mode="image">
              <span class="mode-icon">🖼️</span>
              <span>Image→3D</span>
            </button>
            <button class="mode-btn" data-mode="hybrid">
              <span class="mode-icon">🔄</span>
              <span>Hybrid</span>
            </button>
          </div>
          
          <!-- Mode: Text→3D -->
          <div class="mode-content active" id="mode-text">
            <div class="form-group">
              <label>Ship Description</label>
              <textarea 
                id="text-prompt" 
                placeholder="e.g., A sleek sci-fi cargo ship with modular engine nacelles and glowing windows..."
                rows="4"
              ></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Frames</label>
                <input type="number" id="text-frames" value="30" min="1" max="60">
              </div>
              <div class="form-group">
                <label>Seed</label>
                <input type="number" id="text-seed" value="42" min="0">
              </div>
            </div>
          </div>
          
          <!-- Mode: Image→3D -->
          <div class="mode-content" id="mode-image">
            <div class="form-group">
              <label>Input Image</label>
              <div class="image-upload-area" id="image-upload-area">
                <input type="file" id="image-input" accept="image/*" style="display: none;">
                <div class="upload-prompt">
                  <span class="upload-icon">📤</span>
                  <p>Click to upload or drag and drop</p>
                  <p class="upload-hint">PNG, JPG, WEBP (max 10MB)</p>
                </div>
                <div class="image-preview" id="image-preview" style="display: none;">
                  <img id="preview-img" alt="Preview">
                  <button class="btn-remove" onclick="multiModeModal.clearImage()">✕ Remove</button>
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>Image Description (Optional)</label>
              <input type="text" id="image-description" placeholder="e.g., Spaceship outline sketch...">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Frames</label>
                <input type="number" id="image-frames" value="30" min="1" max="60">
              </div>
              <div class="form-group">
                <label>Seed</label>
                <input type="number" id="image-seed" value="42" min="0">
              </div>
            </div>
          </div>
          
          <!-- Mode: Hybrid (Image→Base + Text Refinement) -->
          <div class="mode-content" id="mode-hybrid">
            <div class="form-group">
              <label>Base Image</label>
              <div class="image-upload-area" id="hybrid-upload-area">
                <input type="file" id="hybrid-input" accept="image/*" style="display: none;">
                <div class="upload-prompt">
                  <span class="upload-icon">📤</span>
                  <p>Click to upload base image</p>
                  <p class="upload-hint">PNG, JPG, WEBP (max 10MB)</p>
                </div>
                <div class="image-preview" id="hybrid-preview" style="display: none;">
                  <img id="hybrid-preview-img" alt="Preview">
                  <button class="btn-remove" onclick="multiModeModal.clearHybridImage()">✕ Remove</button>
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>Refinement Prompt</label>
              <textarea 
                id="refinement-prompt" 
                placeholder="e.g., Add glowing neon accents, increase engine details, add weapon turrets..."
                rows="3"
              ></textarea>
            </div>
            <div class="form-group">
              <label>Image Description (Optional)</label>
              <input type="text" id="hybrid-description" placeholder="e.g., Base spaceship design...">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Frames</label>
                <input type="number" id="hybrid-frames" value="30" min="1" max="60">
              </div>
              <div class="form-group">
                <label>Seed</label>
                <input type="number" id="hybrid-seed" value="42" min="0">
              </div>
            </div>
          </div>
          
          <!-- Generation Status -->
          <div id="generation-status" class="generation-status" style="display: none;">
            <div class="status-header">
              <span class="spinner"></span>
              <span id="status-text">Submitting...</span>
            </div>
            <div id="job-list" class="job-list"></div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="multiModeModal.close()">Close</button>
          <button class="btn btn-primary" id="submit-btn" onclick="multiModeModal.submit()">
            <span class="btn-icon">🚀</span>
            Generate
          </button>
        </div>
      </div>
    </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    this.modal = document.getElementById('multi-mode-modal');
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Mode switching
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });

    // Image upload handlers
    ['image-upload-area', 'hybrid-upload-area'].forEach(areaId => {
      const area = document.getElementById(areaId);
      if (area) {
        area.addEventListener('click', () => {
          const inputId = areaId === 'image-upload-area' ? 'image-input' : 'hybrid-input';
          document.getElementById(inputId).click();
        });
        area.addEventListener('dragover', (e) => {
          e.preventDefault();
          area.classList.add('dragover');
        });
        area.addEventListener('dragleave', () => {
          area.classList.remove('dragover');
        });
        area.addEventListener('drop', (e) => {
          e.preventDefault();
          area.classList.remove('dragover');
          const files = e.dataTransfer.files;
          if (files.length > 0) {
            this.handleImageUpload(files[0], areaId);
          }
        });
      }
    });

    // File input handlers
    document.getElementById('image-input')?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleImageUpload(e.target.files[0], 'image-upload-area');
      }
    });

    document.getElementById('hybrid-input')?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleImageUpload(e.target.files[0], 'hybrid-upload-area');
      }
    });
  }

  switchMode(mode) {
    this.currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    document.querySelectorAll('.mode-content').forEach(content => {
      content.classList.toggle('active', content.id === `mode-${mode}`);
    });
  }

  handleImageUpload(file, areaId) {
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large (max 10MB)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      const isHybrid = areaId === 'hybrid-upload-area';
      
      if (isHybrid) {
        this.selectedImage = { hybrid: base64, filename: file.name };
      } else {
        this.selectedImage = { image: base64, filename: file.name };
      }

      const previewId = isHybrid ? 'hybrid-preview' : 'image-preview';
      const previewImgId = isHybrid ? 'hybrid-preview-img' : 'preview-img';
      
      document.getElementById(previewId).style.display = 'flex';
      document.getElementById(previewImgId).src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  clearImage() {
    this.selectedImage = null;
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('image-input').value = '';
  }

  clearHybridImage() {
    this.selectedImage = null;
    document.getElementById('hybrid-preview').style.display = 'none';
    document.getElementById('hybrid-input').value = '';
  }

  async submit() {
    if (this.currentMode === 'text') await this.submitText();
    else if (this.currentMode === 'image') await this.submitImage();
    else if (this.currentMode === 'hybrid') await this.submitHybrid();
  }

  async submitText() {
    const prompt = document.getElementById('text-prompt').value?.trim();
    if (!prompt) {
      alert('Please enter a ship description');
      return;
    }

    const payload = {
      input_mode: 'text',
      prompt_text: prompt,
      design_id: window.currentDesignId || null,
      priority: 1
    };

    await this.sendRequest(payload, 'Text→3D Generation');
  }

  async submitImage() {
    if (!this.selectedImage?.image) {
      alert('Please select an image');
      return;
    }

    const payload = {
      input_mode: 'image',
      image_base64: this.selectedImage.image,
      image_description: document.getElementById('image-description').value || 'Image-based 3D generation',
      design_id: window.currentDesignId || null,
      priority: 1
    };

    await this.sendRequest(payload, 'Image→3D Generation');
  }

  async submitHybrid() {
    if (!this.selectedImage?.hybrid) {
      alert('Please select a base image');
      return;
    }

    const refinement = document.getElementById('refinement-prompt').value?.trim();
    if (!refinement) {
      alert('Please enter a refinement prompt');
      return;
    }

    const payload = {
      input_mode: 'hybrid',
      image_base64: this.selectedImage.hybrid,
      refinement_prompt: refinement,
      image_description: document.getElementById('hybrid-description').value || 'Hybrid generation',
      design_id: window.currentDesignId || null,
      priority: 1
    };

    await this.sendRequest(payload, 'Hybrid Generation');
  }

  async sendRequest(payload, label) {
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.success) {
        this.showGenerationStatus(data, label);
      } else {
        alert('Error: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Failed to submit: ' + error.message);
      submitBtn.disabled = false;
    }
  }

  showGenerationStatus(jobData, label) {
    const statusDiv = document.getElementById('generation-status');
    const jobList = document.getElementById('job-list');
    
    statusDiv.style.display = 'block';
    document.getElementById('submit-btn').style.display = 'none';
    
    const queueId = jobData.queue_id;
    const jobCard = document.createElement('div');
    jobCard.className = 'job-card';
    jobCard.innerHTML = `
      <div class="job-header">
        <span>${label}</span>
        <span class="job-id">ID: ${queueId}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 5%"></div>
      </div>
      <div class="job-details">
        <span class="status-badge">PENDING</span>
        <span class="progress-text">Waiting to start...</span>
      </div>
    `;
    jobList.appendChild(jobCard);

    // Poll for status
    this.pollJobStatus(queueId, jobCard);
  }

  pollJobStatus(queueId, jobCard) {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.apiUrl}?queue_id=${queueId}`);
        const data = await response.json();

        if (!data.success) {
          clearInterval(pollInterval);
          return;
        }

        const { status, progress } = data;
        const progressFill = jobCard.querySelector('.progress-fill');
        const statusBadge = jobCard.querySelector('.status-badge');
        const progressText = jobCard.querySelector('.progress-text');

        progressFill.style.width = progress + '%';
        statusBadge.textContent = status.toUpperCase();
        progressText.textContent = `${progress}% — ${status}`;

        if (status === 'completed') {
          clearInterval(pollInterval);
          statusBadge.className = 'status-badge completed';
          progressText.innerHTML = `
            <span style="color: #10b981; margin-right: 0.5rem;">✓</span>
            Generation complete!
          `;
        } else if (status === 'failed') {
          clearInterval(pollInterval);
          statusBadge.className = 'status-badge failed';
          progressText.textContent = 'Generation failed';
        }

      } catch (error) {
        console.error('Poll error:', error);
      }
    }, 2000);

    this.pollingIntervals.set(queueId, pollInterval);
  }

  show() {
    if (!this.modal) this.create();
    this.modal.style.display = 'flex';
  }

  close() {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
    // Clear polling intervals
    this.pollingIntervals.forEach(interval => clearInterval(interval));
    this.pollingIntervals.clear();
  }
}

// Global instance
window.multiModeModal = new MultiModeGenerationModal();
