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


def clean_glb(
    raw: bytes,
    facility_kind: str | None,
    *,
    asset_type: str = "building",
    with_normals: bool = False,
) -> CleanedGlb:
    """Clean exact zero-area faces without culling components, optionally exporting normals."""
    inspect_glb(raw, asset_type, facility_kind)
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
        if with_normals:
            normals = cleaned.vertex_normals
            lengths = np.linalg.norm(normals, axis=1)
            if not np.isfinite(normals).all() or not np.allclose(lengths, 1, atol=1e-5):
                raise ValueError(f"Cannot export finite unit vertex normals for {name}")
        scene.geometry[name] = cleaned
        removed_faces += removed

    export_options = {"include_normals": True} if with_normals else {}
    exported = scene.export(file_type="glb", **export_options)
    if not isinstance(exported, bytes):
        raise TypeError("Trimesh did not return GLB bytes.")
    report = inspect_glb(exported, asset_type, facility_kind)
    if any(mesh.zero_area_faces for mesh in report.meshes):
        raise ValueError("Cleaned GLB still contains zero-area faces.")
    if with_normals and report.missing_normal_primitives:
        raise ValueError("Cleaned GLB is missing normal attributes.")
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
    parser.add_argument("--asset-type", choices=["building", "ship"], default="building")
    parser.add_argument("--facility-kind")
    parser.add_argument("--with-normals", action="store_true")
    parser.add_argument("--output", type=Path, help="Defaults to <source>_zero_area_cleaned.glb")
    args = parser.parse_args()
    log = structlog.get_logger()

    try:
        if args.asset_type == "building" and args.facility_kind is None:
            raise ValueError("--facility-kind is required for building assets")
        source_path = await run_in_threadpool(args.source.resolve)
        output_path = await run_in_threadpool(
            args.output.resolve
            if args.output is not None
            else args.source.with_name(f"{args.source.stem}_zero_area_cleaned.glb").resolve
        )
        if source_path == output_path:
            raise ValueError("Output must not overwrite the source GLB.")

        raw = await run_in_threadpool(source_path.read_bytes)
        cleaned = await run_in_threadpool(
            clean_glb,
            raw,
            args.facility_kind,
            asset_type=args.asset_type,
            with_normals=args.with_normals,
        )
        await run_in_threadpool(output_path.parent.mkdir, parents=True, exist_ok=True)
        await run_in_threadpool(_write_new_file, output_path, cleaned.data)
    except (OSError, ValueError, KeyError, TypeError, IndexError, RuntimeError) as exc:
        log.error("trellis_mesh_cleanup_failed", source=str(args.source), error=str(exc))
        return 1

    log.info(
        "trellis_mesh_cleanup_written",
        source=str(source_path),
        output=str(output_path),
        asset_type=args.asset_type,
        with_normals=args.with_normals,
        facility_kind=args.facility_kind,
        removed_zero_area_faces=cleaned.removed_zero_area_faces,
        remaining_faces=cleaned.remaining_faces,
        status="DEV_ONLY",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
