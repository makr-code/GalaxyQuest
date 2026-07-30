# GalaxyQuest AI Texture Generation Integration

## Overview

This document describes the integration of ComfyUI/SwarmUI for procedurally-generated AI-based PBR (Physically Based Rendering) textures in GalaxyQuest. The system allows generation of:

- **Spaceship hull textures** (Albedo, Normal, Specular, Roughness, Metallic, Emission)
- **Planet surface textures** (Rocky, Icy, Volcanic, Alien variants)
- **Atmospheric effects** (Clouds, auroras, storm clouds)
- **Detail overlays** (Wear, scratches, corrosion, damage)

All with faction-specific and condition-based variations.

## Architecture

### Components

#### Backend (PHP)
- **`api/textures-ai.php`** - Main API endpoint bridging GalaxyQuest to ComfyUI
  - Texture generation requests
  - LRU caching with SHA256 key generation
  - Queue management (avoid service overload)
  - Status/health checks
  - Fallback logic to procedural generation

#### Frontend (JavaScript)
- **`texture-manager.js`** - Enhanced with AI texture support
  - `requestAITexture()` - Request AI-generated textures
  - `getAITextureStatus()` - Check service availability
  - Automatic fallback to procedural textures
  - ETag-based HTTP caching

#### Docker Service
- **`docker-compose.yml`** - ComfyUI service configuration
  - Optional service (use `docker compose --profile ai up`)
  - GPU support (CUDA/ROCm configurable)
  - Model and output volume persistence

#### Configuration
- **`.env` variables** - AI texture generation settings
  - `COMFYUI_ENABLED` - Enable/disable feature
  - `COMFYUI_BASE_URL` - Service endpoint
  - `COMFYUI_MODEL` - Model selection (sd15, sdxl)
  - `COMFYUI_TEXTURE_SIZE` - Resolution (128-1024)
  - `COMFYUI_DIFFUSION_STEPS` - Quality/speed tradeoff
  - `COMFYUI_GUIDANCE_SCALE` - Prompt adherence strength
  - `COMFYUI_CACHE_MODE` - Caching strategy (memory/disk)

### Data Flow

```
Client Request
    ↓
[texture-manager.js]
    ↓
    ├─→ Check AI enabled
    ├─→ Call api/textures-ai.php
    │
[api/textures-ai.php]
    ├─→ Check cache (SHA256 hash)
    ├─→ If cached: Return cached image + ETag
    └─→ If not cached:
        ├─→ Build ComfyUI prompt from descriptor
        ├─→ Send to ComfyUI API
        ├─→ Poll job completion
        ├─→ Cache result
        ├─→ Return image
    │
    └─→ On error: Return { fallback_required: true }
        ↓
    Use procedural texture fallback
```

## Configuration

### Environment Variables

Add these to your `.env` file (copy from `.env.example`):

```bash
# AI Texture Generation (ComfyUI)
COMFYUI_ENABLED=1
COMFYUI_BASE_URL=http://localhost:8188
COMFYUI_MODEL=sdxl                    # sd15 or sdxl
COMFYUI_TEXTURE_SIZE=512              # 128-1024
COMFYUI_DIFFUSION_STEPS=30            # 20-50
COMFYUI_GUIDANCE_SCALE=8.5            # 7.0-12.0
COMFYUI_QUEUE_TIMEOUT=120             # seconds
COMFYUI_CACHE_MODE=disk               # disk or memory
COMFYUI_MAX_CONCURRENT=2              # 1-4
COMFYUI_FALLBACK_PROCEDURAL=1         # 1=yes, 0=no
```

### Docker Compose

To run with AI texture support:

```bash
# Start with AI profile (ComfyUI + GalaxyQuest)
docker compose --profile ai up -d

# Access ComfyUI UI at http://localhost:8188
# Access GalaxyQuest at http://localhost:8080
```

**GPU Support:**
Uncomment the GPU section in `docker-compose.yml` if using NVIDIA GPU:

```yaml
comfyui:
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

## API Endpoints

### Generate Spaceship Texture

```http
GET /api/textures-ai.php?action=spaceship_texture&texture_type=albedo&faction=iron_fleet&condition=weathered&size=512
```

**Parameters:**
- `texture_type`: `albedo`, `normal`, `specular`, `roughness`, `metallic`, `emission`
- `faction`: `generic`, `iron_fleet`, `merchants`, `nomads`
- `condition`: `new`, `weathered`, `damaged`
- `style`: `scifi`, `industrial`, `alien`
- `size`: `128`, `256`, `512`, `1024`
- `seed`: optional integer for reproducibility

**Response:**
```json
{
  "success": true,
  "source": "cache",
  "cache_key": "sha256_hash",
  "path": "generated/ai_textures/sha256_hash.png",
  "etag": "\"sha256_hash\"",
  "size": 262144,
  "mtime": 1234567890
}
```

### Generate Planet Texture

```http
GET /api/textures-ai.php?action=planet_texture&texture_type=albedo&biome=rocky&size=512
```

**Parameters:**
- `texture_type`: `albedo`, `normal`, `roughness`, `ao`
- `biome`: `rocky`, `icy`, `volcanic`, `desert`, `alien`
- `size`: `128`, `256`, `512`, `1024`

### Generate Atmosphere Texture

```http
GET /api/textures-ai.php?action=atmosphere_texture&texture_type=cloud&style=aurora&size=256
```

**Parameters:**
- `texture_type`: `cloud`, `aurora`, `storm`
- `style`: `earth_like`, `toxic`, `aurora`, `storm`

### Generate Detail Map

```http
GET /api/textures-ai.php?action=detail_texture&texture_type=wear&intensity=0.7
```

**Parameters:**
- `texture_type`: `wear`, `scratches`, `dust`, `corrosion`, `damage`
- `intensity`: `0.0` - `1.0` (amount of visible wear)

### Check Service Status

```http
GET /api/textures-ai.php?action=status
```

**Response:**
```json
{
  "success": true,
  "status": "available",
  "model": "sdxl",
  "stats": {
    "vram_used": 4096,
    "memory_available": 8192
  }
}
```

### Get Queue Status

```http
GET /api/textures-ai.php?action=queue
```

**Response:**
```json
{
  "success": true,
  "queue": {
    "pending": [],
    "running": null
  }
}
```

## JavaScript API

### Request AI Texture

```javascript
const textureManager = new GQTextureManager({
  three: THREE,
  serverTexturesEnabled: true,
});

// Request AI-generated spaceship texture
const aiResult = await textureManager.requestAITexture(
  { faction: 'iron_fleet', seed: 12345 },
  { 
    textureType: 'albedo',
    objectType: 'spaceship',
    size: 512 
  }
);

if (aiResult) {
  // Successfully generated
  const textureUrl = aiResult.path;
  const texture = new THREE.TextureLoader().load(textureUrl);
} else {
  // Failed - use procedural fallback
  const fallback = textureManager.getPlanetMaterial(...);
}
```

### Check AI Availability

```javascript
const isAvailable = await textureManager.getAITextureStatus();
if (isAvailable) {
  // Request AI textures
} else {
  // Use procedural generation
}
```

## Caching Strategy

### Disk Cache (Default)

- **Location:** `generated/ai_textures/`
- **Key:** SHA256 hash of descriptor + settings
- **TTL:** Persistent until manual cleanup
- **Advantages:** Survives server restart, HTTP ETag support
- **Disadvantages:** Disk usage grows over time

### Memory Cache

- **Location:** PHP in-memory cache
- **TTL:** Session lifetime
- **Advantages:** Fast, no disk I/O
- **Disadvantages:** Lost on restart

### Fallback Mechanism

If AI generation fails:
1. Check if `COMFYUI_FALLBACK_PROCEDURAL=1`
2. If yes: Return `{ fallback_required: true }`
3. Client uses procedural texture generator
4. If no: Return error (no texture)

## Performance Tuning

### Generation Speed

```bash
# Fast (low quality)
COMFYUI_MODEL=sd15
COMFYUI_DIFFUSION_STEPS=20
COMFYUI_TEXTURE_SIZE=256

# Balanced
COMFYUI_MODEL=sdxl
COMFYUI_DIFFUSION_STEPS=30
COMFYUI_TEXTURE_SIZE=512

# High quality (slow)
COMFYUI_MODEL=sdxl
COMFYUI_DIFFUSION_STEPS=40
COMFYUI_TEXTURE_SIZE=1024
```

### Queue Management

```bash
# Avoid overload
COMFYUI_MAX_CONCURRENT=1              # Process one at a time
COMFYUI_QUEUE_TIMEOUT=60              # Fail fast

# Allow parallelism (with GPU memory)
COMFYUI_MAX_CONCURRENT=4
COMFYUI_QUEUE_TIMEOUT=180
```

### Memory Usage

- **SD 1.5:** ~3 GB VRAM
- **SDXL:** ~8-12 GB VRAM
- **Batch processing:** +4-6 GB per concurrent job

## Workflow Templates

Located in: `ai/comfyui_workflows/templates.json`

### Available Templates

1. **spaceship_albedo** - Base color textures for ship hulls
2. **spaceship_normal** - Surface detail/bump mapping
3. **planet_surface** - Geological formations
4. **atmosphere_cloud** - Atmospheric effects
5. **detail_wear** - Grayscale overlay for wear/damage

### Extending Templates

Add custom templates to `templates.json`:

```json
{
  "templates": {
    "custom_effect": {
      "name": "Custom Effect Name",
      "description": "What this generates",
      "nodes": {
        "1": { "inputs": {...}, "class_type": "CLIPTextEncode(positive)" },
        ...
      }
    }
  }
}
```

## Troubleshooting

### ComfyUI Service Unreachable

```
Error: ComfyUI service unreachable
```

**Solutions:**
1. Check if ComfyUI is running: `docker compose ps`
2. Verify `COMFYUI_BASE_URL` in `.env` matches container URL
3. Check Docker network: `docker network ls`
4. View ComfyUI logs: `docker compose logs comfyui`

### Generation Timeout

```
Error: ComfyUI job timeout
```

**Solutions:**
1. Increase `COMFYUI_DIFFUSION_STEPS` (slower but more reliable)
2. Reduce texture size: `COMFYUI_TEXTURE_SIZE=256`
3. Reduce concurrent jobs: `COMFYUI_MAX_CONCURRENT=1`
4. Check GPU memory usage

### Out of Memory

```
CUDA out of memory. Tried to allocate...
```

**Solutions:**
1. Reduce `COMFYUI_TEXTURE_SIZE`
2. Reduce `COMFYUI_MAX_CONCURRENT`
3. Use SD 1.5 instead of SDXL: `COMFYUI_MODEL=sd15`
4. Reduce `COMFYUI_DIFFUSION_STEPS`

### Cache Not Working

```
Textures regenerated every request
```

**Solutions:**
1. Verify cache directory exists: `ls -la generated/ai_textures/`
2. Check directory permissions: `chmod 775 generated/ai_textures/`
3. Verify `COMFYUI_CACHE_MODE=disk` in `.env`
4. Check disk space: `df -h`

## Advanced Features (Phase 3)

### Batch PBR Generation

Request complete PBR set (Albedo, Normal, Specular, Roughness) in one workflow:

```javascript
// Future: Batch API endpoint
const pbrSet = await textureManager.requestBatchPBRTextures({
  objectType: 'spaceship',
  faction: 'iron_fleet',
  size: 512,
});

// pbrSet contains: albedo, normal, specular, roughness
```

### ControlNet Consistency

Enforce visual consistency across texture set:

```bash
# Use reference image for all texture variations
COMFYUI_USE_CONTROLNET=1
COMFYUI_CONTROLNET_MODEL=normal_map_fp16
```

### Style Parameters

```javascript
requestAITexture({
  style: 'rusty_industrial',    // Pre-defined style presets
  weathering: 0.8,              // 0-1 scale
  faction: 'nomads',            // Faction-specific aesthetics
});
```

### Progressive Loading

Generate low-res first, then refine asynchronously:

```javascript
// Phase 1: Quick low-res (256px)
const lowRes = await requestAITexture({...}, {size: 256, quality: 'fast'});

// Phase 2: Async refinement to 1024px
requestAITexture({...}, {size: 1024, quality: 'high'}).then(highRes => {
  updateMaterial(highRes);
});
```

## Admin Panel Features (Phase 4)

### Texture Regeneration UI

```
/admin/textures/regenerate
- Regenerate specific textures
- Test different prompts/styles
- Preview before applying
- Batch regenerate by faction
```

### Texture Randomization

```javascript
// In-game: "Randomize Ship Appearance"
const variations = await generateTextureVariations({
  baseShip: shipDescriptor,
  count: 5,  // Generate 5 variations
});

// Player selects favorite
```

## Performance Metrics

Expected generation times (on RTX 4090):

| Model | Size | Steps | Time |
|-------|------|-------|------|
| SD 1.5 | 256 | 20 | ~2s |
| SD 1.5 | 512 | 30 | ~5s |
| SDXL | 512 | 30 | ~12s |
| SDXL | 1024 | 40 | ~45s |

With caching enabled, subsequent requests to same descriptor: **<50ms** (disk I/O only)

## Security Considerations

### Input Validation

All user inputs are sanitized:
- Texture types: whitelist (albedo, normal, specular, etc.)
- Faction/biome: alphanumeric only
- Size: clamped to 128-1024
- Seed: integer only
- All strings: max 64 characters

### API Rate Limiting

Implement rate limiting to prevent abuse:

```php
// Add to api/textures-ai.php
if (!isRateLimitValid($_SERVER['REMOTE_ADDR'])) {
    http_response_code(429);
    exit;
}
```

### Model Safety

- Models verified safe (Stability AI OpenRAIL license)
- Negative prompts filter inappropriate content
- Output validation (PNG only, no embedded code)

## License & Attribution

- **Stable Diffusion**: OpenRAIL v2 License (compatible with MIT)
- **ComfyUI**: GPL-3.0 (see https://github.com/comfyanonymous/ComfyUI)
- **GalaxyQuest Integration**: MIT (part of GalaxyQuest)

## Future Roadmap

- [ ] LoRA fine-tuning for faction-specific aesthetics
- [ ] WebSocket-based streaming for progress feedback
- [ ] Upscaling (2x, 4x) with RealESRGAN
- [ ] Semantic segmentation for automated texture layering
- [ ] Browser-based preview with dynamic lighting
- [ ] Distributed generation across multiple GPU machines

## Support & Debugging

### Enable Verbose Logging

```php
// In api/textures-ai.php, add:
error_log('AI Texture Request: ' . json_encode($descriptor));
```

### View Generation Queue

```bash
curl http://localhost:8188/queue
```

### Clear Cache

```bash
rm -rf generated/ai_textures/*
```

### Test Workflow

```bash
# Test basic API endpoint
curl "http://localhost:8080/api/textures-ai.php?action=status"
```
