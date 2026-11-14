from __future__ import annotations

import hashlib
import json
import struct
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial

from scripts.trellis2_inspect import inspect_glb, main


def document_glb(document: dict[str, object]) -> bytes:
    payload = json.dumps(document).encode()
    payload += b" " * (-len(payload) % 4)
    return struct.pack("<4sIIII", b"glTF", 2, 20 + len(payload), len(payload), 0x4E4F534A) + payload


def textured_box() -> trimesh.Trimesh:
    mesh = trimesh.creation.box()
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(mesh.vertices), 2)),
        material=PBRMaterial(
            baseColorTexture=Image.new("RGB", (4, 4), (120, 60, 30)),
            metallicRoughnessTexture=Image.new("RGB", (4, 4), (0, 150, 40)),
            baseColorFactor=[1.0, 1.0, 1.0, 1.0],
        ),
    )
    return mesh


class InspectGlbTests(unittest.TestCase):
    def test_textured_mesh_is_always_dev_only(self) -> None:
        raw = textured_box().export(file_type="glb", include_normals=True)
        report = inspect_glb(raw, "building", "habitat")
        mesh = report.meshes[0]
        self.assertEqual(report.schema, "gq.trellis-inspection.v2")
        self.assertEqual(report.source_sha256, hashlib.sha256(raw).hexdigest())
        self.assertEqual(report.status, "DEV_ONLY")
        self.assertEqual(report.asset_type, "building")
        self.assertEqual(report.facility_kind, "habitat")
        self.assertEqual(report.missing_normal_primitives, 0)
        self.assertEqual(mesh.triangles, 12)
        self.assertEqual(len(mesh.components), 1)
        self.assertTrue(mesh.uv_valid)
        assert mesh.base_color is not None
        assert mesh.metallic_roughness is not None
        self.assertEqual(mesh.base_color.channel_min, [120, 60, 30])
        self.assertEqual(mesh.metallic_roughness.channel_max, [0, 150, 40])
        self.assertEqual(mesh.base_color.nonblack_rgb_fraction, 1)
        self.assertIn("physical_scale", report.required_manual_checks)

    def test_uv_seams_do_not_create_false_components(self) -> None:
        mesh = textured_box()
        vertices = mesh.vertices[mesh.faces.ravel()]
        split = trimesh.Trimesh(
            vertices=vertices,
            faces=np.arange(len(vertices)).reshape(-1, 3),
            process=False,
        )
        split.visual = trimesh.visual.TextureVisuals(
            uv=np.arange(len(vertices) * 2).reshape(-1, 2) / 100,
            material=mesh.visual.material,
        )
        before_vertices = split.vertices.copy()
        before_uv = split.visual.uv.copy()
        raw = split.export(file_type="glb")
        report = inspect_glb(raw, "building", "habitat")
        self.assertEqual(len(report.meshes[0].components), 1)
        self.assertEqual(report.meshes[0].boundary_edges, 0)
        self.assertEqual(report.meshes[0].nonmanifold_edges, 0)
        np.testing.assert_array_equal(split.vertices, before_vertices)
        np.testing.assert_array_equal(split.visual.uv, before_uv)

    def test_counts_boundary_edges_ignoring_zero_area_faces(self) -> None:
        box = trimesh.creation.box()
        mesh = trimesh.Trimesh(
            vertices=box.vertices,
            faces=np.vstack((box.faces[:-1], [0, 0, 1])),
            process=False,
        )
        report = inspect_glb(mesh.export(file_type="glb"), "ship", None).meshes[0]
        self.assertEqual(report.zero_area_faces, 1)
        self.assertEqual(report.boundary_edges, 3)
        self.assertEqual(report.nonmanifold_edges, 0)
        self.assertIn("boundary_edges_review_required", report.findings)

    def test_reports_edges_shared_by_more_than_two_faces(self) -> None:
        mesh = trimesh.Trimesh(
            vertices=np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]),
            faces=np.array([[0, 1, 2], [1, 0, 3], [0, 1, 4]]),
            process=False,
        )
        report = inspect_glb(mesh.export(file_type="glb"), "ship", None).meshes[0]
        self.assertEqual(report.nonmanifold_edges, 1)
        self.assertEqual(report.boundary_edges, 6)
        self.assertIn("nonmanifold_edges_review_required", report.findings)

    def test_separate_parts_are_reported_not_deleted(self) -> None:
        first = trimesh.creation.box()
        second = trimesh.creation.box()
        second.apply_translation([4, 0, 0])
        combined = trimesh.util.concatenate([first, second])
        raw = combined.export(file_type="glb")
        report = inspect_glb(raw, "building", "industry")
        mesh = report.meshes[0]
        self.assertEqual(mesh.triangles, 24)
        self.assertEqual(len(mesh.components), 2)
        self.assertAlmostEqual(sum(c.area_fraction for c in mesh.components), 1)
        self.assertIn("multiple_face_components_review_required", mesh.findings)
        self.assertIn("missing_or_invalid_uv", mesh.findings)
        self.assertEqual(mesh.components[1].local_bounds[0][0], 3.5)

    def test_world_bounds_include_all_instance_transforms(self) -> None:
        scene = trimesh.Scene()
        scene.add_geometry(textured_box(), geom_name="building", node_name="first")
        scene.graph.update(
            frame_to="second",
            matrix=trimesh.transformations.translation_matrix([10, 0, 0]),
            geometry="building",
        )
        report = inspect_glb(scene.export(file_type="glb"), "building", None)
        self.assertEqual(report.instances, 2)
        self.assertEqual(len(report.meshes), 1)
        self.assertEqual(report.world_bounds, [[-0.5, -0.5, -0.5], [10.5, 0.5, 0.5]])

    def test_black_texture_and_missing_normals_are_detected(self) -> None:
        mesh = textured_box()
        mesh.visual.material.baseColorTexture = Image.new("RGB", (4, 4))
        report = inspect_glb(mesh.export(file_type="glb", include_normals=False), "building", None)
        self.assertIn("black_base_color_texture", report.meshes[0].findings)
        self.assertEqual(report.missing_normal_primitives, 1)

    def test_black_factor_is_detected_even_with_colored_texture(self) -> None:
        mesh = textured_box()
        mesh.visual.material.baseColorFactor = [0.0, 0.0, 0.0, 1.0]
        report = inspect_glb(mesh.export(file_type="glb"), "building", None)
        self.assertIn("black_base_color_factor", report.meshes[0].findings)
        self.assertNotIn("black_base_color_texture", report.meshes[0].findings)

    def test_analysis_does_not_close_small_gaps(self) -> None:
        first = trimesh.creation.box(extents=[1e-5, 1e-5, 1e-5])
        second = first.copy()
        second.apply_translation([1e-5 + 1e-9, 0, 0])
        raw = trimesh.util.concatenate([first, second]).export(file_type="glb")
        self.assertEqual(len(inspect_glb(raw, "building", None).meshes[0].components), 2)

    def test_report_is_deterministic(self) -> None:
        raw = textured_box().export(file_type="glb")
        self.assertEqual(
            asdict(inspect_glb(raw, "building", None)),
            asdict(inspect_glb(raw, "building", None)),
        )

    def test_malformed_and_empty_files_fail_explicitly(self) -> None:
        for raw in (b"", b"not a GLB" * 10, document_glb({"asset": {"version": "2.0"}})):
            with self.subTest(raw_length=len(raw)), self.assertRaises(ValueError):
                inspect_glb(raw, "building", None)

    def test_unsupported_resources_and_extensions_fail_explicitly(self) -> None:
        for document in (
            {"buffers": [{"uri": "external.bin"}]},
            {"images": [{"uri": "https://example.invalid/texture.png"}]},
            {"extensionsRequired": ["KHR_draco_mesh_compression"]},
            {"meshes": [{"primitives": [{"mode": 1}]}]},
        ):
            with self.subTest(document=document), self.assertRaises(ValueError):
                inspect_glb(
                    document_glb({"asset": {"version": "2.0"}, **document}), "building", None
                )

    def test_facility_class_requires_a_building_asset(self) -> None:
        raw = textured_box().export(file_type="glb")
        for asset_type, facility_kind in (
            ("station", "drilling"),
            ("building", "shipyard"),
            ("invalid", None),
        ):
            with self.subTest(asset_type=asset_type, facility_kind=facility_kind):
                with self.assertRaises(ValueError):
                    inspect_glb(raw, asset_type, facility_kind)

    def test_ship_review_does_not_require_colony_views(self) -> None:
        raw = textured_box().export(file_type="glb")
        report = inspect_glb(raw, "ship", None)
        self.assertIn("ship_rendering", report.required_manual_checks)
        self.assertNotIn("both_colony_views", report.required_manual_checks)
        self.assertIn(
            "both_colony_views", inspect_glb(raw, "building", None).required_manual_checks
        )


class InspectorCliTests(unittest.IsolatedAsyncioTestCase):
    async def test_writes_hash_bound_sidecar_without_changing_glb(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "habitat.glb"
            raw = textured_box().export(file_type="glb")
            source.write_bytes(raw)
            with patch(
                "sys.argv",
                ["trellis2_inspect.py", str(source), "--facility-kind", "habitat"],
            ):
                self.assertEqual(await main(), 0)
            report = json.loads(source.with_name("habitat_inspection.json").read_text())
            self.assertEqual(report["source_sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(report["status"], "DEV_ONLY")
            self.assertEqual(report["asset_type"], "building")
            self.assertEqual(report["facility_kind"], "habitat")
            self.assertEqual(source.read_bytes(), raw)

    async def test_invalid_input_fails_without_creating_a_report(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "broken.glb"
            source.write_bytes(b"broken")
            with patch("sys.argv", ["trellis2_inspect.py", str(source)]):
                self.assertEqual(await main(), 1)
            self.assertFalse(source.with_name("broken_inspection.json").exists())

    async def test_report_cannot_overwrite_the_source(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "habitat.glb"
            raw = textured_box().export(file_type="glb")
            source.write_bytes(raw)
            with patch("sys.argv", ["trellis2_inspect.py", str(source), "--output", str(source)]):
                self.assertEqual(await main(), 1)
            self.assertEqual(source.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
