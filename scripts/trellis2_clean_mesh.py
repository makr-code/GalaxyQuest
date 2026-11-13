#!/usr/bin/env python3
"""Write a separate GLB with exact zero-area faces removed; never grants approval."""

from __future__ import annotations

import argparse
import asyncio
import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import structlog
import trimesh
from starlette.concurrency import run_in_threadpool

if __package__:
    from .trellis2_inspect import inspect_glb
else:
    from trellis2_inspect import inspect_glb


@dataclass(frozen=True)
class CleanedGlb:
    data: bytes
    removed_zero_area_faces: int
    remaining_faces: int


def remove_zero_area_faces(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, int]:
    """Copy a mesh and remove only faces whose computed area is exactly zero."""
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError("Mesh is empty or contains non-finite vertex positions.")
    areas = mesh.area_faces
    if not np.isfinite(areas).all():
        raise ValueError("Mesh contains non-finite face areas.")

    keep_faces = areas > 0
    if not np.any(keep_faces):
        raise ValueError("Mesh contains no positive-area faces.")

    cleaned = mesh.copy()
    removed = int(np.count_nonzero(~keep_faces))
    if removed:
        cleaned.update_faces(keep_faces)
        cleaned.remove_unreferenced_vertices()
    return cleaned, removed


def clean_glb(raw: bytes, facility_kind: str) -> CleanedGlb:
    """Clean exact zero-area faces in an embedded building GLB without culling components."""
    inspect_glb(raw, "building", facility_kind)
    scene = trimesh.load_scene(
        file_obj=io.BytesIO(raw),
        file_type="glb",
        process=False,
        merge_primitives=False,
    )
    removed_faces = 0
    for name, geometry in list(scene.geometry.items()):
        if not isinstance(geometry, trimesh.Trimesh):
            raise ValueError(f"Unsupported geometry type: {name}")
        cleaned, removed = remove_zero_area_faces(geometry)
        scene.geometry[name] = cleaned
        removed_faces += removed

    exported = scene.export(file_type="glb")
    if not isinstance(exported, bytes):
        raise TypeError("Trimesh did not return GLB bytes.")
    report = inspect_glb(exported, "building", facility_kind)
    if any(mesh.zero_area_faces for mesh in report.meshes):
        raise ValueError("Cleaned GLB still contains zero-area faces.")
    return CleanedGlb(
        data=exported,
        removed_zero_area_faces=removed_faces,
        remaining_faces=sum(mesh.triangles for mesh in report.meshes),
    )


def _write_new_file(path: Path, data: bytes) -> None:
    with path.open("xb") as output:
        output.write(data)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--facility-kind", required=True)
    parser.add_argument("--output", type=Path, help="Defaults to <source>_zero_area_cleaned.glb")
    args = parser.parse_args()
    log = structlog.get_logger()

    try:
        source_path = await run_in_threadpool(args.source.resolve)
        output_path = await run_in_threadpool(
            args.output.resolve
            if args.output is not None
            else args.source.with_name(f"{args.source.stem}_zero_area_cleaned.glb").resolve
        )
        if source_path == output_path:
            raise ValueError("Output must not overwrite the source GLB.")

        raw = await run_in_threadpool(source_path.read_bytes)
        cleaned = await run_in_threadpool(clean_glb, raw, args.facility_kind)
        await run_in_threadpool(output_path.parent.mkdir, parents=True, exist_ok=True)
        await run_in_threadpool(_write_new_file, output_path, cleaned.data)
    except (OSError, ValueError, KeyError, TypeError, IndexError, RuntimeError) as exc:
        log.error("trellis_mesh_cleanup_failed", source=str(args.source), error=str(exc))
        return 1

    log.info(
        "trellis_mesh_cleanup_written",
        source=str(source_path),
        output=str(output_path),
        facility_kind=args.facility_kind,
        removed_zero_area_faces=cleaned.removed_zero_area_faces,
        remaining_faces=cleaned.remaining_faces,
        status="DEV_ONLY",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
