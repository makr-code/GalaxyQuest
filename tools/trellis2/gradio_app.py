#!/usr/bin/env python3
"""
TRELLIS2 Gradio WebApp - Image-to-3D & Text-to-3D Generation
Minimal implementation for container deployment
"""

import os
import sys
import json
import traceback
from pathlib import Path
from typing import Optional
from datetime import datetime
import tempfile
import base64
from io import BytesIO

import gradio as gr
import torch
from PIL import Image

# Try to import TRELLIS2 (will be available if models are linked)
try:
    from trellis.pipelines import TrellisTextTo3DPipeline, TrellisImageTo3DPipeline
    from trellis.utils import postprocessing_utils
    TRELLIS2_AVAILABLE = True
except ImportError:
    TRELLIS2_AVAILABLE = False


# Configuration
WORKSPACE = Path("/workspace")
MODELS_DIR = WORKSPACE / "models"
OUTPUT_DIR = WORKSPACE / "generated"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Create output directories
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "image2text").mkdir(exist_ok=True)
(OUTPUT_DIR / "text2image").mkdir(exist_ok=True)
(OUTPUT_DIR / "logs").mkdir(exist_ok=True)


def log_event(event_type: str, details: dict):
    """Log events to JSON for monitoring"""
    log_file = OUTPUT_DIR / "logs" / "gradio_events.jsonl"
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "event_type": event_type,
        "device": DEVICE,
        "cuda_available": torch.cuda.is_available(),
        **details
    }
    with open(log_file, "a") as f:
        f.write(json.dumps(log_entry) + "\n")


def health_check():
    """Simple health check endpoint"""
    try:
        return {
            "status": "healthy",
            "device": DEVICE,
            "cuda_available": torch.cuda.is_available(),
            "workspace": str(WORKSPACE),
            "models_dir": str(MODELS_DIR),
            "output_dir": str(OUTPUT_DIR),
            "torch_version": torch.__version__,
            "cuda_version": torch.version.cuda if torch.cuda.is_available() else "N/A"
        }
    except Exception as e:
        log_event("health_check_error", {"error": str(e)})
        return {"status": "error", "error": str(e)}


def text_to_3d(prompt: str, num_frames: int = 30, seed: int = 42) -> tuple:
    """
    Generate 3D model from text description using TRELLIS2
    
    Args:
        prompt: Text description of the 3D object
        num_frames: Number of frames for generation (UI value, not used in actual inference)
        seed: Random seed for reproducibility
    
    Returns:
        (glb_path_or_none, status_message, metadata_json)
    """
    try:
        log_event("text_to_3d_start", {"prompt": prompt, "frames": num_frames})
        
        if not TRELLIS2_AVAILABLE:
            error_msg = "TRELLIS2 not available. Models not downloaded."
            log_event("text_to_3d_error", {"error": error_msg})
            return (None, f"❌ {error_msg}", json.dumps({"error": error_msg}))
        
        # Load pipeline with error handling
        try:
            model_name = "microsoft/TRELLIS-text-large"
            print(f"[TRELLIS2] Loading model: {model_name}")
            pipeline = TrellisTextTo3DPipeline.from_pretrained(model_name)
            pipeline.cuda()
        except Exception as e:
            error_msg = f"Failed to load model: {str(e)}"
            log_event("text_to_3d_error", {"error": error_msg})
            return (None, f"❌ Model Loading Error: {str(e)}", json.dumps({"error": error_msg}))
        
        # Run inference
        print(f"[TRELLIS2] Running text-to-3d: '{prompt}'")
        outputs = pipeline.run(
            prompt,
            seed=seed,
            formats=["gaussian", "mesh"],
            sparse_structure_sampler_params={
                "steps": 12,
                "cfg_strength": 7.5,
            },
            slat_sampler_params={
                "steps": 12,
                "cfg_strength": 3.0,
            },
        )
        
        # Post-process to GLB
        print("[TRELLIS2] Post-processing to GLB")
        glb = postprocessing_utils.to_glb(
            outputs["gaussian"][0],
            outputs["mesh"][0],
            simplify=0.95,
            texture_size=1024,
            verbose=False,
        )
        
        # Save GLB
        output_name = f"text2image/{datetime.now().strftime('%Y%m%d_%H%M%S')}_text.glb"
        output_path = OUTPUT_DIR / output_name
        glb.export(str(output_path))
        
        file_size_kb = output_path.stat().st_size / 1024
        print(f"[TRELLIS2] Generated GLB: {output_path} ({file_size_kb:.1f} KB)")
        
        log_event("text_to_3d_success", {
            "prompt": prompt,
            "output_path": str(output_path),
            "file_size_bytes": output_path.stat().st_size
        })
        
        return (
            str(output_path),
            f"✅ Generation complete! ({file_size_kb:.1f} KB)",
            json.dumps({
                "prompt": prompt,
                "frames": num_frames,
                "seed": seed,
                "file_size_kb": round(file_size_kb, 1)
            })
        )
        
    except Exception as e:
        error_msg = f"Text-to-3D Error: {str(e)}\n{traceback.format_exc()}"
        print(error_msg)
        log_event("text_to_3d_error", {"prompt": prompt, "error": str(e)})
        return (None, f"❌ {str(e)}", json.dumps({"error": str(e)}))


def image_to_3d(image_input = None, num_frames: int = 30, seed: int = 42) -> tuple:
    """
    Generate 3D model from image using TRELLIS2
    
    Args:
        image_input: Image dict from Gradio or file path (Gradio sends {'name': ..., 'data': base64})
        num_frames: Number of frames for generation (UI value, not used in actual inference)
        seed: Random seed for reproducibility
    
    Returns:
        (glb_path_or_none, status_message, metadata_json)
    """
    try:
        log_event("image_to_3d_start", {"frames": num_frames})
        
        if not image_input:
            raise ValueError("No image provided")
        
        if not TRELLIS2_AVAILABLE:
            error_msg = "TRELLIS2 not available. Models not downloaded."
            log_event("image_to_3d_error", {"error": error_msg})
            return (None, f"❌ {error_msg}", json.dumps({"error": error_msg}))
        
        # Handle Gradio's image dict format: {'name': '...', 'data': 'base64_string'}
        image = None
        image_name = "uploaded_image.jpg"
        
        if isinstance(image_input, dict):
            # Gradio dict format with base64 data
            import base64
            import io
            if 'data' in image_input:
                base64_str = image_input['data']
                # Decode base64 to PIL Image
                image_data = base64.b64decode(base64_str)
                image = Image.open(io.BytesIO(image_data))
                if 'name' in image_input:
                    image_name = image_input['name']
        elif isinstance(image_input, str):
            # It's a file path
            image_path = Path(image_input)
            image_name = image_path.name
            if not image_path.exists():
                raise FileNotFoundError(f"Image file not found: {image_path}")
            image = Image.open(image_path)
        else:
            raise ValueError(f"Unexpected image format: {type(image_input)}")
        
        if image is None:
            raise ValueError("Failed to process image")
        
        # Load pipeline with error handling
        try:
            model_name = "microsoft/TRELLIS-image-large"
            print(f"[TRELLIS2] Loading model: {model_name}")
            pipeline = TrellisImageTo3DPipeline.from_pretrained(model_name)
            pipeline.cuda()
        except Exception as e:
            error_msg = f"Failed to load model: {str(e)}"
            log_event("image_to_3d_error", {"error": error_msg})
            return (None, f"❌ Model Loading Error: {str(e)}", json.dumps({"error": error_msg}))
        
        # Run inference
        print(f"[TRELLIS2] Running image-to-3d for: {image_name}")
        outputs = pipeline.run(
            image,
            seed=seed,
            formats=["gaussian", "mesh"],
            sparse_structure_sampler_params={
                "steps": 12,
                "cfg_strength": 7.5,
            },
            slat_sampler_params={
                "steps": 12,
                "cfg_strength": 3.0,
            },
        )
        
        # Post-process to GLB
        print("[TRELLIS2] Post-processing to GLB")
        glb = postprocessing_utils.to_glb(
            outputs["gaussian"][0],
            outputs["mesh"][0],
            simplify=0.95,
            texture_size=1024,
            verbose=False,
        )
        
        # Save GLB
        output_name = f"image2text/{datetime.now().strftime('%Y%m%d_%H%M%S')}_image.glb"
        output_path = OUTPUT_DIR / output_name
        glb.export(str(output_path))
        
        file_size_kb = output_path.stat().st_size / 1024
        print(f"[TRELLIS2] Generated GLB: {output_path} ({file_size_kb:.1f} KB)")
        
        log_event("image_to_3d_success", {
            "output_path": str(output_path),
            "file_size_bytes": output_path.stat().st_size,
            "image_name": image_name
        })
        
        return (
            str(output_path),
            f"✅ Generation complete! ({file_size_kb:.1f} KB)",
            json.dumps({
                "image": image_name,
                "frames": num_frames,
                "seed": seed,
                "file_size_kb": round(file_size_kb, 1)
            })
        )
        
    except Exception as e:
        error_msg = f"Image-to-3D Error: {str(e)}\n{traceback.format_exc()}"
        print(error_msg)
        log_event("image_to_3d_error", {"error": str(e)})
        return (None, f"❌ {str(e)}", json.dumps({"error": str(e)}))


def create_minimal_glb(description: str) -> bytes:
    """
    Create a minimal valid GLB file for testing
    Real TRELLIS2 generates proper 3D geometry
    """
    # Minimal GLB file structure (12-byte header + empty JSON chunk)
    glb_magic = b"glTF"  # Magic number
    glb_version = (2).to_bytes(4, 'little')
    glb_size = (28).to_bytes(4, 'little')  # Total file size
    
    # JSON chunk header
    json_chunk_size = (2).to_bytes(4, 'little')  # 2 bytes of JSON content
    json_chunk_type = b"JSON"
    json_content = b"{}"  # Minimal JSON object
    
    return glb_magic + glb_version + glb_size + json_chunk_size + json_chunk_type + json_content


def create_demo(mode: str = "both") -> gr.Blocks:
    """
    Create Gradio interface
    
    Args:
        mode: "text", "image", or "both"
    
    Returns:
        Gradio Blocks interface
    """
    
    with gr.Blocks(title="TRELLIS2 3D Generator") as demo:
        gr.Markdown(f"""
        # TRELLIS2 3D Model Generator
        
        Generate 3D models using TRELLIS2 AI models
        
        **Status**: {health_check()['status'].upper()}  
        **Device**: {health_check()['device'].upper()}  
        **CUDA**: {'✅ Available' if health_check()['cuda_available'] else '❌ Not available (using CPU)'}
        
        """)
        
        if mode in ("text", "both"):
            with gr.Tab("Text → 3D"):
                gr.Markdown("Generate 3D models from text descriptions")
                
                with gr.Row():
                    with gr.Column():
                        text_prompt = gr.Textbox(
                            label="Prompt",
                            placeholder="e.g., a futuristic spaceship with glowing windows",
                            lines=3
                        )
                        text_frames = gr.Slider(
                            minimum=1, maximum=60, value=30, step=1,
                            label="Generation Frames"
                        )
                        text_seed = gr.Number(label="Seed", value=42)
                        text_submit = gr.Button("🚀 Generate", variant="primary")
                    
                    with gr.Column():
                        text_output = gr.File(label="📥 Download GLB")
                        text_status = gr.Textbox(label="Status", interactive=False)
                        text_metadata = gr.JSON(label="Metadata")
                
                text_submit.click(
                    fn=text_to_3d,
                    inputs=[text_prompt, text_frames, text_seed],
                    outputs=[text_output, text_status, text_metadata]
                )
        
        if mode in ("image", "both"):
            with gr.Tab("Image → 3D"):
                gr.Markdown("Generate 3D models from images")
                
                with gr.Row():
                    with gr.Column():
                        image_input = gr.Image(
                            label="Input Image",
                            type="pil"
                        )
                        image_frames = gr.Slider(
                            minimum=1, maximum=60, value=30, step=1,
                            label="Generation Frames"
                        )
                        image_seed = gr.Number(label="Seed", value=42)
                        image_submit = gr.Button("🚀 Generate", variant="primary")
                    
                    with gr.Column():
                        image_output = gr.File(label="📥 Download GLB")
                        image_status = gr.Textbox(label="Status", interactive=False)
                        image_metadata = gr.JSON(label="Metadata")
                
                image_submit.click(
                    fn=image_to_3d,
                    inputs=[image_input, image_frames, image_seed],
                    outputs=[image_output, image_status, image_metadata]
                )
        
        with gr.Tab("📊 System Info"):
            gr.JSON(value=health_check(), label="System Status")
    
    return demo


if __name__ == "__main__":
    # Determine mode from environment or arguments
    mode = os.getenv("TRELLIS_MODE", "both")
    if len(sys.argv) > 1:
        mode = sys.argv[1]
    
    print(f"[TRELLIS2] Starting Gradio App in '{mode}' mode")
    print(f"[TRELLIS2] Device: {DEVICE}")
    print(f"[TRELLIS2] CUDA Available: {torch.cuda.is_available()}")
    print(f"[TRELLIS2] PyTorch Version: {torch.__version__}")
    
    log_event("app_start", {"mode": mode, "device": DEVICE})
    
    demo = create_demo(mode=mode)
    
    # Configuration from environment
    server_name = os.getenv("GRADIO_SERVER_NAME", "0.0.0.0")
    server_port = int(os.getenv("GRADIO_SERVER_PORT", 7862))
    
    print(f"[TRELLIS2] Starting server on {server_name}:{server_port}")
    
    # Launch Gradio
    demo.launch(
        server_name=server_name,
        server_port=server_port,
        share=False,
        show_error=True,
        allowed_paths=["/workspace/generated", "/workspace/generated/text2image", "/tmp"]
    )
