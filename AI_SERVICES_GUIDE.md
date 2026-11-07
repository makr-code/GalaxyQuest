# 🤖 GalaxyQuest AI Services – Docker Profiles Guide

## Overview

GalaxyQuest supports flexible AI service stacks via Docker Compose profiles. Choose based on your GPU capacity and use case:

The profile names below reflect the services configured in `docker-compose.yml`. Starting a profile does not by itself connect every service to gameplay or establish automatic backend fallback.

| Profile | Services | Use Case | Start Command |
|---------|----------|----------|---------------|
| **ai-fast** | vLLM + Stable Diffusion | Local LLM and image-generation services | `docker compose --profile ai-fast up -d` |
| **ai-creative** | Ollama | Local LLM service | `docker compose --profile ai-creative up -d` |
| **ai-3d** | ComfyUI + TRELLIS2 | 3D-generation workflows | `docker compose --profile ai-3d up -d` |
| **ai-full** | All AI services | Combined local AI stack | `docker compose --profile ai-full up -d` |

GPU memory requirements depend on the selected models and workloads; measure them on the target deployment rather than relying on fixed estimates.

---

## 📋 Quick Start

### Option 1: vLLM and Stable Diffusion services
```bash
docker compose --profile ai-fast up -d
```
**Available Services:**
- 🧠 **vLLM** (OpenAI-compatible API) → http://localhost:8000
- 🎨 **Stable Diffusion** (WebUI) → http://localhost:7860

The following is a manual service-call example, not a claim that the game currently routes NPC dialogue through vLLM:
```php
$response = file_get_contents('http://vllm:8000/v1/chat/completions', false, 
  stream_context_create(['http' => [
    'method'  => 'POST',
    'header'  => 'Content-Type: application/json',
    'content' => json_encode([
      'model' => 'mistral-7b-instruct-v0.2',
      'messages' => [['role' => 'user', 'content' => 'Generate pirate dialogue...']],
      'temperature' => 0.7,
      'max_tokens' => 256
    ])
  ]])
);
```

---

### Option 2: Local LLM (Ollama)
```bash
docker compose --profile ai-creative up -d
```
**Available Services:**
- 🧠 **Ollama** (Local LLM) → http://localhost:11435 by default on the host; port 11434 inside the Compose network

**Example: Pull Mistral-7B locally**
```bash
docker compose -f docker-compose.yml --profile ai-creative exec ollama ollama pull mistral
```

**Example: Use Ollama for NPC dialogue**
```bash
curl http://localhost:11435/api/generate -X POST -d '{
  "model": "mistral",
  "prompt": "Generate a pirate trader'\''s greeting:",
  "stream": false
}'
```

---

### Option 3: 3D Generation Workflows (ComfyUI + TRELLIS2)
```bash
docker compose --profile ai-3d up -d
```
**Available Services:**
- 🔧 **ComfyUI** (Node Workflows) → http://localhost:8188
- 🧊 **TRELLIS2** (3D generation) → http://localhost:7862

---

### Option 4: Everything (All AI Services)
```bash
docker compose --profile ai-full up -d
```
Starts all profiled inference services (vLLM, Stable Diffusion, ComfyUI, Ollama, and TRELLIS2). Actual resource requirements depend on the selected models and workloads.

---

## 🔧 Environment Variables (Web Service)

Compose provides these service URLs to the web container. Their presence does not mean every feature uses every backend:

```yaml
VLLM_BASE_URL: http://vllm:8000              # vLLM OpenAI API
STABLE_DIFFUSION_BASE_URL: http://stable-diffusion:7860
COMFYUI_BASE_URL: http://comfyui:8188        # Advanced workflows
OLLAMA_BASE_URL: http://ollama:11434         # Ollama service on the Compose network
```

**Backend selection:** There is no global vLLM → Ollama → cached-response fallback chain established by these Compose profiles. Backend selection is feature-specific; verify the implementation for the API being used before assuming a service is active in gameplay.

---

## 🎬 Usage Scenarios

### Scenario 1: Manual NPC-dialogue service-call example
```
1. A future or separately configured integration sends a request to `http://vllm:8000/v1/chat/completions`
2. vLLM generates a response
3. The caller handles and displays the response
```

### Scenario 2: Illustrative Stable Diffusion workflow (not wired by this guide)
```
1. A separately configured feature requests ship art
2. Its client calls an API route supported by the deployed Stable Diffusion WebUI
3. Generated output is stored in the configured volume
4. The game loads the result only through an implemented asset pipeline
```

### Scenario 3: Optional ComfyUI workflow (nodes and models must be configured)
```
1. Load base ship outline (img2img)
2. Apply ControlNet edge conditioning
3. Run through upscaler (Real-ESRGAN 4x)
4. Inpaint details (cockpit, engines)
5. Export as GLB-embedded texture

→ These steps require matching ComfyUI nodes, models, and a configured workflow; this profile does not guarantee them.
```

---

## 📊 Historical Performance Estimates

These figures are not verified performance guarantees. Benchmark the selected models, image sizes, and hardware in the target environment.
| Operation | Service | Target | Notes |
|-----------|---------|--------|-------|
| NPC Chat | vLLM | < 1s | Mistral-7B batch=1, max_tokens=256 |
| NPC Chat (Fallback) | Ollama | 2–3s | Network latency + CPU inference |
| Ship Texture (txt2img) | Stable Diffusion | 2–5s | 512x512, 50 steps |
| Ship Upscaling | ComfyUI (GFPGAN) | 1–2s | 512→2048 |
| Batch Ships (100×) | ComfyUI Queue | ~5–10s | Parallel + GPU batching |

---

## 🛠️ Troubleshooting

### "Connection refused: vllm:8000"
```bash
# Check if vLLM is running
docker compose --profile ai-fast ps

# View logs
docker compose --profile ai-fast logs vllm

# Ensure model is loaded (wait 60s on first start)
curl http://localhost:8000/v1/models
```

### "Ollama: model not found"
```bash
# Pull model into container
docker compose --profile ai-creative exec ollama ollama pull mistral

# List available models
docker compose --profile ai-creative exec ollama ollama list
```

### "ComfyUI page blank or timing out"
```bash
# ComfyUI is part of the ai-3d profile
docker compose --profile ai-3d logs comfyui

# Check health
curl http://localhost:8188/system_stats
```

---

## 🗂️ Volume Mounts (Persistent Storage)

| Volume | Path | Purpose |
|--------|------|---------|
| `vllm-models` | `/root/.cache/huggingface/hub` | Model cache (Mistral-7B, etc.) |
| `vllm-cache` | `/root/.cache` | Inference cache |
| `ollama-models` | `/root/.ollama` | Local models (Mistral, Llama, etc.) |
| `stable-diffusion-models` | `/stable-diffusion-webui/models` | SD checkpoints, VAEs, ControlNets |
| `stable-diffusion-outputs` | `/stable-diffusion-webui/outputs` | Generated images |
| `comfyui-models` | `/root/.comfyui/models` | Model directory (shared with SD) |
| `comfyui-output` | `/root/.comfyui/output` | ComfyUI workflow outputs |

---

## 🚀 Next Steps

1. **Start your chosen profile:**
   ```bash
   docker compose --profile ai-fast up -d
   ```

2. **Verify services are healthy:**
   ```bash
   docker compose --profile ai-fast ps
   ```

3. **Test endpoints:**
   - vLLM: `curl http://localhost:8000/v1/models`
   - Stable Diffusion: `curl http://localhost:7860/info`
   - ComfyUI: `curl http://localhost:8188/system_stats`
   - Ollama: `curl http://localhost:11435/api/tags` (default host port)

4. **Integrate into game:**
   - Update `api/llm.php` to use `VLLM_BASE_URL` or `OLLAMA_BASE_URL`
   - Update `api/model_gen.php` to call Stable Diffusion API
   - Create ComfyUI workflow scripts in `ai/comfyui_workflows/`

---

## 📚 Documentation Links

- **vLLM:** https://docs.vllm.ai/en/latest/
- **Stable Diffusion WebUI:** https://github.com/AUTOMATIC1111/stable-diffusion-webui
- **ComfyUI:** https://github.com/comfyanonymous/ComfyUI
- **Ollama:** https://ollama.ai/
