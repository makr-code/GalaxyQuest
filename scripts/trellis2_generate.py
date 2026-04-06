#!/usr/bin/env python3
"""GalaxyQuest dev helper to generate TRELLIS2 assets via CLI."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

import imageio
import numpy as np
import trimesh
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate 3D assets for GQ with TRELLIS2 (dev mode)")
    parser.add_argument("--repo-root", default="tools/trellis2", help="Path to local TRELLIS repo")
    parser.add_argument("--mode", choices=["text", "image"], default="text")
    parser.add_argument("--prompt", default="A modular sci-fi cargo ship with hard surface panels")
    parser.add_argument("--image", default="", help="Input image path for image mode")
    parser.add_argument("--model", default="", help="Optional HF model override")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--ss-steps", type=int, default=12)
    parser.add_argument("--ss-cfg", type=float, default=7.5)
    parser.add_argument("--slat-steps", type=int, default=12)
    parser.add_argument("--slat-cfg", type=float, default=3.0)
    parser.add_argument("--simplify", type=float, default=0.95)
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument("--preview-frames", type=int, default=120)
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--output-dir", default="generated/trellis2")
    return parser.parse_args()


def ensure_repo_path(repo_root: pathlib.Path) -> None:
    if not repo_root.exists():
        raise FileNotFoundError(
            f"TRELLIS repo nicht gefunden unter: {repo_root}. "
            "Bitte zuerst scripts/trellis2_link.ps1 ausfuehren."
        )
    sys.path.insert(0, str(repo_root.resolve()))


def check_quality(glb_path: pathlib.Path) -> dict:
    """Prüft Dateigröße, Triangle-Count und Bounding-Box eines GLB."""
    result: dict = {
        "file": str(glb_path),
        "file_size_kb": round(glb_path.stat().st_size / 1024, 1),
        "triangles": 0,
        "vertices": 0,
        "bounding_box": None,
        "issues": [],
    }
    try:
        scene = trimesh.load(str(glb_path), force="scene")
        meshes = list(scene.geometry.values()) if hasattr(scene, "geometry") else [scene]
        total_tri = sum(len(m.faces) for m in meshes if hasattr(m, "faces"))
        total_verts = sum(len(m.vertices) for m in meshes if hasattr(m, "vertices"))
        result["triangles"] = total_tri
        result["vertices"] = total_verts

        all_vertices = np.concatenate(
            [m.vertices for m in meshes if hasattr(m, "vertices")], axis=0
        )
        bbox_min = all_vertices.min(axis=0).tolist()
        bbox_max = all_vertices.max(axis=0).tolist()
        size = [round(bbox_max[i] - bbox_min[i], 4) for i in range(3)]
        result["bounding_box"] = {"min": [round(v, 4) for v in bbox_min],
                                   "max": [round(v, 4) for v in bbox_max],
                                   "size": size}

        if total_tri == 0:
            result["issues"].append("WARN: Keine Dreiecke gefunden (leeres Mesh?)")
        if total_tri > 150_000:
            result["issues"].append(f"WARN: Hohe Dreieckszahl ({total_tri}). Fuer Dev-Asset prüfen.")
        if result["file_size_kb"] > 20_000:
            result["issues"].append(f"WARN: Datei sehr groß ({result['file_size_kb']} KB).")
        any_zero = any(s < 0.001 for s in size)
        if any_zero:
            result["issues"].append("WARN: Eine Achse der Bounding-Box ist nahezu null (flaches Mesh?).")
    except Exception as exc:
        result["issues"].append(f"ERROR beim Laden des GLB: {exc}")
    return result


def print_quality_report(report: dict) -> None:
    sep = "-" * 50
    print(sep)
    print("[TRELLIS2] Qualitätsbericht")
    print(f"  Datei:       {report['file']}")
    print(f"  Dateigröße:  {report['file_size_kb']} KB")
    print(f"  Dreiecke:    {report['triangles']}")
    print(f"  Vertices:    {report['vertices']}")
    if report["bounding_box"]:
        s = report["bounding_box"]["size"]
        print(f"  BBox Größe:  x={s[0]}  y={s[1]}  z={s[2]}")
    if report["issues"]:
        for issue in report["issues"]:
            print(f"  ⚠  {issue}")
    else:
        print("  ✓ Keine Qualitätsprobleme erkannt.")
    print(sep)

def choose_model(mode: str, model_override: str) -> str:
    if model_override:
        return model_override
    if mode == "image":
        return "microsoft/TRELLIS-image-large"
    return "microsoft/TRELLIS-text-xlarge"


def generate(args: argparse.Namespace) -> tuple[pathlib.Path, pathlib.Path]:
    repo_root = pathlib.Path(args.repo_root)
    ensure_repo_path(repo_root)

    os.environ.setdefault("SPCONV_ALGO", "native")

    from trellis.pipelines import TrellisImageTo3DPipeline, TrellisTextTo3DPipeline
    from trellis.utils import postprocessing_utils, render_utils

    model_name = choose_model(args.mode, args.model)

    out_dir = pathlib.Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = "_".join(args.prompt.lower().split())[:60] or "asset"

    if args.mode == "image":
        if not args.image:
            raise ValueError("--image ist im image-Modus erforderlich.")
        image_path = pathlib.Path(args.image)
        if not image_path.exists():
            raise FileNotFoundError(f"Bilddatei nicht gefunden: {image_path}")

        pipeline = TrellisImageTo3DPipeline.from_pretrained(model_name)
        pipeline.cuda()

        image = Image.open(image_path)
        outputs = pipeline.run(
            image,
            seed=args.seed,
            formats=["gaussian", "mesh"],
            sparse_structure_sampler_params={"steps": args.ss_steps, "cfg_strength": args.ss_cfg},
            slat_sampler_params={"steps": args.slat_steps, "cfg_strength": args.slat_cfg},
        )
    else:
        pipeline = TrellisTextTo3DPipeline.from_pretrained(model_name)
        pipeline.cuda()

        outputs = pipeline.run(
            args.prompt,
            seed=args.seed,
            formats=["gaussian", "mesh"],
            sparse_structure_sampler_params={"steps": args.ss_steps, "cfg_strength": args.ss_cfg},
            slat_sampler_params={"steps": args.slat_steps, "cfg_strength": args.slat_cfg},
        )

    glb = postprocessing_utils.to_glb(
        outputs["gaussian"][0],
        outputs["mesh"][0],
        simplify=args.simplify,
        texture_size=args.texture_size,
        verbose=False,
    )

    glb_path = out_dir / f"{slug}_{args.mode}.glb"
    glb.export(str(glb_path))

    preview = render_utils.render_video(outputs["mesh"][0], num_frames=args.preview_frames)["normal"]
    preview_path = out_dir / f"{slug}_{args.mode}_preview.mp4"
    imageio.mimsave(preview_path, preview, fps=args.fps)

    quality = check_quality(glb_path)
    quality_path = out_dir / f"{slug}_{args.mode}_quality.json"
    quality_path.write_text(json.dumps(quality, indent=2, ensure_ascii=False), encoding="utf-8")

    return glb_path, preview_path, quality


def main() -> int:
    args = parse_args()
    glb_path, preview_path, quality = generate(args)
    print(f"GLB: {glb_path}")
    print(f"Preview: {preview_path}")
    print_quality_report(quality)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())