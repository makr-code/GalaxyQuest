# TRELLIS2 with CUDA Support
# Simplified version - ensure PyTorch stays installed

ARG CUDA_VERSION=12.1.1
ARG CUDNN_VERSION=8
ARG BASE_OS=ubuntu22.04

FROM nvidia/cuda:12.1.1-cudnn${CUDNN_VERSION}-runtime-${BASE_OS}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install Python & system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3.11-dev python3-pip \
    git wget curl ca-certificates \
    libgomp1 libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1

WORKDIR /workspace

# Step 1: Install PyTorch (cu121)  - PINNED, do NOT change
RUN python3.11 -m pip install --no-cache-dir torch==2.3.0 torchvision==0.18.0 torchaudio==2.3.0 \
    --index-url https://download.pytorch.org/whl/cu121

# Step 2: Install TRELLIS2 & AI dependencies (flexible versions, let pip resolve)
RUN python3.11 -m pip install --no-cache-dir \
    transformers diffusers accelerate safetensors \
    pillow numpy scipy scikit-image pydantic omegaconf \
    opencv-python trimesh gradio huggingface-hub \
    peft tensorboard packaging

# Step 3: Create workspace directories
RUN mkdir -p /workspace/{models/torch,models/huggingface,generated}

# Step 4: Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import torch; assert torch.cuda.is_available()" || exit 1

EXPOSE 7862 7863
CMD ["/bin/bash"]
