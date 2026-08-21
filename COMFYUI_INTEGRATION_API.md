# ComfyUI Dual-Mode Job Integration Guide

## API Endpoints

### 1. Submit Job (Text/Image/Hybrid)
**POST** `/api/generation_queue_v3.php`

```bash
curl -X POST http://localhost:8080/api/generation_queue_v3.php \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "text",
    "job_type": "comfyui",
    "prompt": "A shiny red metallic sphere",
    "user_id": 1
  }'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "queue_id": 15,
  "job_type": "comfyui",
  "mode": "text",
  "status": "pending",
  "message": "Job 15 submitted to daemon (type: comfyui, mode: text)"
}
```

**Supported Modes:**
- `text`: Text-to-3D (requires `prompt`)
- `image`: Image-to-3D (requires `image_base64`, PNG/JPEG)
- `hybrid`: Image + refinement (requires `image_base64` + `refinement_prompt`)

**Supported Job Types:**
- `comfyui`: Node-based workflow engine (recommended for advanced control)
- `trellis2`: Legacy Gradio interface (default, stable)

---

### 2. Check Job Status
**GET** `/api/generation_queue_status_v3.php?queue_id=15`

```bash
curl http://localhost:8080/api/generation_queue_status_v3.php?queue_id=15
```

**Response (200 OK):**
```json
{
  "ok": true,
  "queue_id": 15,
  "status": "processing",
  "progress": 0.45,
  "progress_label": "Generating 3D model...",
  "job_type": "comfyui",
  "input_mode": "text",
  "comfyui_prompt_id": "8a7f2c9e-abc1-4d2e-9f7b-3c6e8b2a1f4d",
  "elapsed_seconds": 54,
  "total_duration_seconds": 54,
  "created_at": "2025-01-16T10:30:45+00:00",
  "started_at": "2025-01-16T10:30:47+00:00",
  "completed_at": null,
  "error_message": null
}
```

**Status Values:**
- `pending`: Waiting in queue (progress: 0.0)
- `processing`: Active generation (progress: 0.0-0.95)
- `completed`: Done, GLB file ready (progress: 1.0)
- `failed`: Error occurred (progress: -1.0)

---

## Workflow Examples

### Example 1: Text-to-3D with ComfyUI

```javascript
// 1. Submit job
const response = await fetch('/api/generation_queue_v3.php', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'text',
    job_type: 'comfyui',
    prompt: 'A crystalline blue cube with metallic edges',
    user_id: 1
  })
});

const { queue_id } = await response.json();
console.log(`Job submitted: ${queue_id}`);

// 2. Poll status every 5 seconds
const poll = setInterval(async () => {
  const status = await fetch(`/api/generation_queue_status_v3.php?queue_id=${queue_id}`);
  const job = await status.json();
  
  console.log(`Progress: ${(job.progress * 100).toFixed(1)}% - ${job.progress_label}`);
  
  if (job.status === 'completed') {
    console.log('✅ Job complete!');
    clearInterval(poll);
    // Load GLB from /generated/comfyui/output/
  } else if (job.status === 'failed') {
    console.error(`❌ Job failed: ${job.error_message}`);
    clearInterval(poll);
  }
}, 5000);
```

### Example 2: Image-to-3D with ComfyUI

```javascript
// 1. Read image file
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const reader = new FileReader();

reader.onload = async (e) => {
  const imageBase64 = e.target.result.split(',')[1]; // Remove data:image/png;base64, prefix
  
  // 2. Submit image job
  const response = await fetch('/api/generation_queue_v3.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'image',
      job_type: 'comfyui',
      image_base64: imageBase64,
      user_id: 1
    })
  });
  
  const { queue_id } = await response.json();
  console.log(`Image job submitted: ${queue_id}`);
};

reader.readAsDataURL(file);
```

### Example 3: Hybrid Mode with Refinement

```javascript
const response = await fetch('/api/generation_queue_v3.php', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'hybrid',
    job_type: 'comfyui',
    image_base64: imageBase64,
    refinement_prompt: 'Add more metallic shine and chrome details',
    user_id: 1
  })
});

const { queue_id } = await response.json();
console.log(`Hybrid job submitted: ${queue_id}`);
```

---

## Daemon Processing

The background daemon (`daemon_trellis2_jobs_v2.php`) runs continuously and:

1. **Every 30 seconds:**
   - Fetches pending jobs from DB
   - Checks `metadata.job_type` field
   - Routes to appropriate backend:
     - `comfyui`: Builds workflow JSON, submits to ComfyUI API
     - `trellis2`: Submits to TRELLIS2 Gradio interface

2. **Monitors processing jobs:**
   - Polls ComfyUI `/api/prompt/{prompt_id}` for workflow status
   - Scans `/generated/comfyui/output/` for GLB files
   - Updates DB status → `completed` when GLB found
   - Marks as `failed` on timeout (15 min) or error

3. **Example logs:**
```
[2025-01-16 10:30:47] Job 15 (comfyui): Building text-to-3d workflow...
[2025-01-16 10:30:48] Job 15 (comfyui): Submitted to ComfyUI (prompt_id: 8a7f2c9e...)
[2025-01-16 10:30:49] Job 15 (comfyui): Status pending (0%)
[2025-01-16 10:31:00] Job 15 (comfyui): Status processing (45%)
[2025-01-16 10:31:30] Job 15 (comfyui): Status completed (100%)
[2025-01-16 10:31:31] Job 15 (comfyui): GLB found: sphere_1234567890.glb
[2025-01-16 10:31:31] Job 15 (comfyui): Marked as completed ✅
```

---

## Database Schema

### generation_queue table
```sql
CREATE TABLE generation_queue (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  vessel_design_id INT,
  prompt_text TEXT,
  input_mode ENUM('text', 'image', 'hybrid'),
  input_image_base64 LONGBLOB,
  metadata JSON,  -- {job_type, trellis2_event_id, comfyui_prompt_id, ...}
  status ENUM('pending', 'processing', 'completed', 'failed'),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  error_message TEXT,
  output_glb_path VARCHAR(500),
  INDEX (status),
  INDEX (created_at)
);
```

### Metadata JSON Structure
```json
{
  "job_type": "comfyui",
  "submitted_at": "2025-01-16T10:30:45+00:00",
  "user_ip": "192.168.1.100",
  "trellis2_event_id": null,
  "comfyui_prompt_id": "8a7f2c9e-abc1-4d2e-9f7b-3c6e8b2a1f4d",
  "refinement_prompt": "Add metallic shine"
}
```

---

## Performance Targets

| Mode | Backend | Est. Time | GPU Memory |
|------|---------|-----------|-----------|
| Text-to-3D | ComfyUI | 30-120s | 8-12GB |
| Image-to-3D | ComfyUI | 40-150s | 10-14GB |
| Hybrid | ComfyUI | 50-180s | 12-16GB |
| Text-to-3D | TRELLIS2 | 20-90s | 6-10GB |

On NVIDIA RTX 3060 with CUDA 12.1, average performance:
- Text-to-3D: 60-80 seconds
- Image-to-3D: 80-120 seconds
- Hybrid: 120-180 seconds

---

## Troubleshooting

### Job stuck in "pending"
- Check if daemon is running: `docker compose exec web ps aux | grep daemon`
- Restart daemon: `docker compose exec -d web php /var/www/html/scripts/daemon_trellis2_jobs_v2.php`

### ComfyUI container not running
- Check logs: `docker compose logs comfyui`
- Verify port 8188 available: `netstat -an | grep 8188`
- Rebuild container: `docker compose --profile ai-3d build --no-cache comfyui`

### GLB file not found after completion
- Check output directory: `ls -lah /generated/comfyui/output/`
- Verify container volume mapping: `docker inspect galaxyquest-comfyui | grep -A 5 Mounts`

---

## Next: Ship Designer Integration

Update `/js/components/multi-mode-modal.js` to expose TRELLIS2 parameters:

```javascript
// Add parameter sliders for ComfyUI advanced mode
const params = {
  sampler: 'euler',      // euler|heun|rk4|rk5
  steps: 50,             // 20-100
  cfg_strength: 7.5,     // 1.0-20.0
  texture_size: 2048,    // 512-16384
  simplify: 0.5,         // 0.0-1.0
  post_processing: {
    fill_holes: true,
    smooth_iterations: 2,
    remesh_target_vertices: 100000
  }
};
```

These parameters will be passed in the job submission payload for fine-grained control over generation quality/speed.
