# 🤖 GalaxyQuest AI Services – Docker Profiles Guide

## Overview

GalaxyQuest supports flexible AI service stacks via Docker Compose profiles. Choose based on your GPU capacity and use case:

| Profile | Services | VRAM | Use Case | Start Command |
|---------|----------|------|----------|---------------|
| **ai-fast** | vLLM + Stable Diffusion | 10–12 GB | 🚀 Fast NPC dialogue + quick image gen | `docker compose --profile ai-fast up -d` |
| **ai-creative** | ComfyUI + Ollama | 8–10 GB | 🎨 Advanced asset workflows + lightweight fallback LLM | `docker compose --profile ai-creative up -d` |
| **ai-full** | ALL services | 18–24 GB | 🔥 Maximum flexibility (resource intensive) | `docker compose --profile ai-full up -d` |

---

## 📋 Quick Start

### Option 1: Fast NPC Dialogue (vLLM + Stable Diffusion)
```bash
docker compose --profile ai-fast up -d
```
**Available Services:**
- 🧠 **vLLM** (NPC Chat) → http://localhost:8000
- 🎨 **Stable Diffusion** (Quick Images) → http://localhost:7860

**Example: Generate NPC dialogue in PHP**
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

### Option 2: Advanced Creative Assets (ComfyUI + Ollama)
```bash
docker compose --profile ai-creative up -d
```
**Available Services:**
- 🔧 **ComfyUI** (Node Workflows) → http://localhost:8188
- 🧠 **Ollama** (Local LLM Fallback) → http://localhost:11434

**Example: Pull Mistral-7B locally**
```bash
docker compose -f docker-compose.yml --profile ai-creative exec ollama ollama pull mistral
```

**Example: Use Ollama for NPC dialogue**
```bash
curl http://localhost:11434/api/generate -X POST -d '{
  "model": "mistral",
  "prompt": "Generate a pirate trader'\''s greeting:",
  "stream": false
}'
```

---

### Option 3: Everything (All AI Services)
```bash
docker compose --profile ai-full up -d
```
Start all services (vLLM, Stable Diffusion, ComfyUI, Ollama) for maximum flexibility. Requires 18–24 GB VRAM.

---

## 🔧 Environment Variables (Web Service)

The web service automatically detects available AI backends:

```yaml
VLLM_BASE_URL: http://vllm:8000              # vLLM OpenAI API
STABLE_DIFFUSION_BASE_URL: http://stable-diffusion:7860
COMFYUI_BASE_URL: http://comfyui:8188        # Advanced workflows
OLLAMA_BASE_URL: http://ollama:11434         # Lightweight local LLM fallback
```

**Graceful Fallback Logic:**
1. Try vLLM (if available, `ai-fast` or `ai-full`)
2. Fallback to Ollama (if available, `ai-creative` or `ai-full`)
3. Use cached/default responses if both unavailable

---

## 🎬 Usage Scenarios

### Scenario 1: Player meets NPC, needs dialogue
```
1. NPC dialogue triggered
2. PHP calls `http://vllm:8000/v1/chat/completions` (fast)
3. vLLM generates response in ~500ms
4. Game displays pirate's witty reply
```

### Scenario 2: Procedurally generate ship texture
```
1. Game requests ship art: "a sleek Orion frigate with blue accents"
2. PHP submits to Stable Diffusion WebUI at http://localhost:7860/run/predict
3. SD generates 512x512 texture in ~2s
4. Asset saved to `stable-diffusion-output/`
5. Game loads texture into 3D model
```

### Scenario 3: Complex multi-step image workflow
```
1. Load base ship outline (img2img)
2. Apply ControlNet edge conditioning
3. Run through upscaler (Real-ESRGAN 4x)
4. Inpaint details (cockpit, engines)
5. Export as GLB-embedded texture

→ All done via ComfyUI node workflow (no code needed!)
```

---

## 📊 Performance Targets

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
# ComfyUI takes 120s to start (first model load)
docker compose --profile ai-creative logs comfyui

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
   - Ollama: `curl http://localhost:11434/api/tags`

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

