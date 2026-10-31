# ComfyUI + TRELLIS2 Custom Nodes  
# Python 3.12 base for TRELLIS2 wheel compatibility (cp312)

FROM python:3.12-bookworm

RUN apt-get update && apt-get install -y git curl wget build-essential libffi-dev libssl-dev libsm6 libxext6 libxrender-dev libgomp1 libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*

ENV PIP_DEFAULT_TIMEOUT=120 \
	PIP_RETRIES=10

WORKDIR /workspace

RUN git clone --depth=1 https://github.com/comfyanonymous/ComfyUI.git . && git checkout HEAD

RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
	if [ -f requirements.txt ]; then \
	  sed -E '/^(torch|torchvision|torchaudio)([<>=!~].*)?$/d' requirements.txt > requirements-no-torch.txt && \
	  pip install --no-cache-dir --retries 10 --timeout 120 -r requirements-no-torch.txt; \
	fi

RUN pip install --no-cache-dir --retries 10 --timeout 120 torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu128 && pip install --no-cache-dir --retries 10 --timeout 120 transformers diffusers accelerate safetensors omegaconf einops pillow

RUN pip install --no-cache-dir nvidia-cuda-runtime-cu12

RUN pip install --no-cache-dir trimesh opencv-python pymeshlab requests plyfile spconv-cu121==2.3.8

RUN mkdir -p /init && echo '#!/bin/bash\nset -e\nCUDA_RT_LIB="/usr/local/lib/python3.12/site-packages/nvidia/cuda_runtime/lib"\nif [ -d "$CUDA_RT_LIB" ]; then\n  export LD_LIBRARY_PATH="$CUDA_RT_LIB:${LD_LIBRARY_PATH}"\nfi\necho "[STARTUP] Installing TRELLIS2 wheels (no-deps)"\nif [ -d /workspace/custom_nodes/ComfyUI-Trellis2/wheels/Linux/Torch291 ]; then\n  pip install --no-cache-dir --no-deps /workspace/custom_nodes/ComfyUI-Trellis2/wheels/Linux/Torch291/*.whl\nfi\necho "[STARTUP] Launching ComfyUI"\nexec python -m main --listen 0.0.0.0 --port 8188' > /init/entrypoint.sh && chmod +x /init/entrypoint.sh

HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=30s CMD curl -f http://localhost:8188/system_stats || exit 1

EXPOSE 8188

ENTRYPOINT ["/init/entrypoint.sh"]
