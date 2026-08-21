# ComfyUI + TRELLIS2 Custom Nodes  
# Python 3.12 base for TRELLIS2 wheel compatibility (cp312)

FROM python:3.12-bullseye

RUN apt-get update && apt-get install -y git curl wget build-essential libffi-dev libssl-dev libsm6 libxext6 libxrender-dev libgomp1 libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN git clone --depth=1 https://github.com/comfyanonymous/ComfyUI.git . && git checkout HEAD

RUN pip install --no-cache-dir --upgrade pip setuptools wheel && if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi

RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 && pip install --no-cache-dir transformers diffusers accelerate safetensors omegaconf einops pillow

RUN pip install --no-cache-dir trimesh opencv-python open3d pymeshlab rembg requests plotly

RUN mkdir -p /init && echo '#!/bin/bash\nset -e\nif [ -d /workspace/custom_nodes/ComfyUI-Trellis2/wheels/Linux/Torch291 ]; then\n  pip install --no-cache-dir /workspace/custom_nodes/ComfyUI-Trellis2/wheels/Linux/Torch291/*.whl 2>&1 | grep -i successfully | head -3\nfi\nexec python -m main --listen 0.0.0.0 --port 8188' > /init/entrypoint.sh && chmod +x /init/entrypoint.sh

HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=30s CMD curl -f http://localhost:8188/system_stats || exit 1

EXPOSE 8188

ENTRYPOINT ["/init/entrypoint.sh"]
