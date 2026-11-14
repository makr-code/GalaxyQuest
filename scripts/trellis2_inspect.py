#!/usr/bin/env python3
"""Read-only inspection of embedded triangle GLBs; never grants production approval."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import json
import struct
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import structlog
import trimesh
from PIL import Image
from starlette.concurrency import run_in_threadpool
from trimesh.visual.material import PBRMaterial


@dataclass(frozen=True)
class TextureInspection:
    size: list[int]
    channel_min: list[int]
    channel_max: list[int]
    nonblack_rgb_fraction: float


@dataclass(frozen=True)
class ComponentInspection:
    triangles: int
    area_fraction: float
    local_bounds: list[list[float]]


@dataclass(frozen=True)
class MeshInspection:
    name: str
    triangles: int
    vertices: int
    zero_area_faces: int
    boundary_edges: int
    nonmanifold_edges: int
    uv_valid: bool
    components: list[ComponentInspection]
    base_color: TextureInspection | None
    metallic_roughness: TextureInspection | None
    base_color_factor: list[float] | None
    findings: list[str]


@dataclass(frozen=True)
class InspectionReport:
    schema: str
    status: str
    source_sha256: str
    size_bytes: int
    asset_type: str
    facility_kind: str | None
    instances: int
    world_bounds: list[list[float]]
    missing_normal_primitives: int
    meshes: list[MeshInspection]
    findings: list[str]
    required_manual_checks: list[str]


def _texture(image: Image.Image | None) -> TextureInspection | None:
    if image is None:
        return None
    pixels = np.asarray(image.convert("RGB"))
    return TextureInspection(
        size=list(image.size),
        channel_min=pixels.min(axis=(0, 1)).tolist(),
        channel_max=pixels.max(axis=(0, 1)).tolist(),
        nonblack_rgb_fraction=float(np.any(pixels > 0, axis=2).mean()),
    )


def _mesh(name: str, mesh: trimesh.Trimesh) -> MeshInspection:
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError(f"Empty mesh or non-finite positions: {name}")
    # Join exact positions across UV/normal seams, without closing small gaps.
    positions, indices = np.unique(mesh.vertices, axis=0, return_inverse=True)
    analysis = trimesh.Trimesh(vertices=positions, faces=indices[mesh.faces], process=False)
    groups = trimesh.graph.connected_components(
        analysis.face_adjacency, nodes=np.arange(len(analysis.faces)), engine="scipy"
    )
    areas = analysis.area_faces
    total_area = float(areas.sum())
    if not np.isfinite(total_area) or total_area <= 0:
        raise ValueError(f"Mesh has no finite surface area: {name}")
    valid_faces = analysis.faces[areas > 0]
    edges = np.concatenate((valid_faces[:, [0, 1]], valid_faces[:, [1, 2]], valid_faces[:, [2, 0]]))
    _, edge_counts = np.unique(np.sort(edges, axis=1), axis=0, return_counts=True)
    boundary_edges = int(np.count_nonzero(edge_counts == 1))
    nonmanifold_edges = int(np.count_nonzero(edge_counts > 2))
    groups = sorted(groups, key=lambda group: (-float(areas[group].sum()), int(min(group))))
    components = []
    for group in groups:
        points = analysis.vertices[analysis.faces[group].ravel()]
        components.append(
            ComponentInspection(
                triangles=len(group),
                area_fraction=float(areas[group].sum() / total_area),
                local_bounds=[points.min(axis=0).tolist(), points.max(axis=0).tolist()],
            )
        )
    uv = getattr(mesh.visual, "uv", None)
    uv_valid = (
        uv is not None and uv.shape == (len(mesh.vertices), 2) and bool(np.isfinite(uv).all())
    )
    material = getattr(mesh.visual, "material", None)
    pbr = isinstance(material, PBRMaterial)
    base = _texture(material.baseColorTexture) if pbr else None
    metal = _texture(material.metallicRoughnessTexture) if pbr else None
    factor = material.baseColorFactor if pbr else None
    zero_area_faces = int(np.count_nonzero(mesh.area_faces == 0))
    findings = []
    if len(components) > 1:
        findings.append("multiple_face_components_review_required")
    if zero_area_faces:
        findings.append("zero_area_faces")
    if boundary_edges:
        findings.append("boundary_edges_review_required")
    if nonmanifold_edges:
        findings.append("nonmanifold_edges_review_required")
    if not uv_valid:
        findings.append("missing_or_invalid_uv")
    if not pbr:
        findings.append("missing_pbr_material")
    if base is None:
        findings.append("missing_base_color_texture")
    elif base.nonblack_rgb_fraction == 0:
        findings.append("black_base_color_texture")
    if factor is not None and not np.any(factor[:3]):
        findings.append("black_base_color_factor")
    if metal is None:
        findings.append("missing_metallic_roughness_texture")
    return MeshInspection(
        name=name,
        triangles=len(mesh.faces),
        vertices=len(mesh.vertices),
        zero_area_faces=zero_area_faces,
        boundary_edges=boundary_edges,
        nonmanifold_edges=nonmanifold_edges,
        uv_valid=uv_valid,
        components=components,
        base_color=base,
        metallic_roughness=metal,
        base_color_factor=None if factor is None else (factor / 255.0).tolist(),
        findings=findings,
    )


def inspect_glb(raw: bytes, asset_type: str, facility_kind: str | None) -> InspectionReport:
    """Inspect an embedded GLB 2 triangle scene without modifying or repairing it."""
    if asset_type not in {"ship", "building", "station", "object"}:
        raise ValueError(f"Unsupported asset type: {asset_type}")
    allowed_kinds = {
        "habitat",
        "agriculture",
        "hydroponics",
        "industry",
        "warehouse",
        "tank",
        "silo",
        "solar",
        "fusion",
        "research",
        "nanotech",
        "hospital",
        "school",
        "command",
        "security",
        "terraforming",
        "drilling",
    }
    if facility_kind is not None and facility_kind not in allowed_kinds:
        raise ValueError(f"Unsupported facility kind: {facility_kind}")
    if facility_kind is not None and asset_type != "building":
        raise ValueError("Facility kinds can only be used with building assets")
    if len(raw) < 20:
        raise ValueError("Truncated GLB header")
    magic, version, length, json_length, chunk_type = struct.unpack_from("<4sIIII", raw)
    if (
        magic != b"glTF"
        or version != 2
        or length != len(raw)
        or chunk_type != 0x4E4F534A
        or json_length > len(raw) - 20
    ):
        raise ValueError("Invalid GLB 2 header or JSON chunk")
    document = json.loads(raw[20 : 20 + json_length])
    if not isinstance(document, dict):
        raise ValueError("GLB document must be an object")
    if document.get("extensionsRequired"):
        raise ValueError("Required glTF extensions are not supported by this inspector")
    for entry in document.get("buffers", []) + document.get("images", []):
        if "uri" in entry:
            raise ValueError("Only embedded buffers and images are supported")
    primitives = [
        primitive for mesh in document.get("meshes", []) for primitive in mesh.get("primitives", [])
    ]
    if not primitives or any(primitive.get("mode", 4) != 4 for primitive in primitives):
        raise ValueError("Only nonempty triangle scenes are supported")
    missing_normals = sum("NORMAL" not in primitive["attributes"] for primitive in primitives)
    with io.BytesIO(raw) as stream:
        scene = trimesh.load_scene(
            file_obj=stream, file_type="glb", process=False, merge_primitives=False
        )
    if not scene.geometry or not scene.graph.nodes_geometry:
        raise ValueError("GLB contains no visible mesh instances")
    meshes = []
    for name, geometry in sorted(scene.geometry.items()):
        if not isinstance(geometry, trimesh.Trimesh):
            raise ValueError(f"Non-triangle geometry: {name}")
        meshes.append(_mesh(name, geometry))
    bounds = scene.bounds
    if bounds is None or not np.isfinite(bounds).all():
        raise ValueError("Missing or non-finite scene bounds")
    findings = ["missing_normal_attributes"] if missing_normals else []
    return InspectionReport(
        schema="gq.trellis-inspection.v2",
        status="DEV_ONLY",
        source_sha256=hashlib.sha256(raw).hexdigest(),
        size_bytes=len(raw),
        asset_type=asset_type,
        facility_kind=facility_kind,
        instances=len(scene.graph.nodes_geometry),
        world_bounds=bounds.tolist(),
        missing_normal_primitives=missing_normals,
        meshes=meshes,
        findings=findings,
        required_manual_checks=[
            "visual_quality_and_materials",
            "physical_scale",
            "orientation_and_ground_contact",
            "lod_and_render_budget",
            "ship_rendering" if asset_type == "ship" else "both_colony_views",
        ],
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, help="Defaults to <source>_inspection.json")
    parser.add_argument(
        "--asset-type", choices=["ship", "building", "station", "object"], default="building"
    )
    parser.add_argument(
        "--facility-kind",
        choices=[
            "habitat",
            "agriculture",
            "hydroponics",
            "industry",
            "warehouse",
            "tank",
            "silo",
            "solar",
            "fusion",
            "research",
            "nanotech",
            "hospital",
            "school",
            "command",
            "security",
            "terraforming",
            "drilling",
        ],
        help="Production surface archetype represented by this building",
    )
    args = parser.parse_args()
    output = args.output or args.source.with_name(f"{args.source.stem}_inspection.json")
    log = structlog.get_logger()
    try:
        output_path, source_path = await asyncio.gather(
            run_in_threadpool(output.resolve), run_in_threadpool(args.source.resolve)
        )
        if output_path == source_path:
            raise ValueError("Report output must not overwrite the source GLB")
        raw = await run_in_threadpool(args.source.read_bytes)
        report = await run_in_threadpool(inspect_glb, raw, args.asset_type, args.facility_kind)
        payload = json.dumps(asdict(report), indent=2, allow_nan=False) + "\n"
        await run_in_threadpool(output.write_text, payload, encoding="utf-8")
    except (OSError, ValueError, KeyError, TypeError, IndexError, RuntimeError) as exc:
        log.error("trellis_inspection_failed", source=str(args.source), error=str(exc))
        return 1
    log.info(
        "trellis_inspection_written",
        report=str(output),
        source_sha256=report.source_sha256,
        status=report.status,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
