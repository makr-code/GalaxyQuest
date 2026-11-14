from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial

from scripts.trellis2_clean_mesh import clean_glb, main, remove_zero_area_faces
from scripts.trellis2_inspect import inspect_glb


def textured_box_with_degenerate_face() -> trimesh.Trimesh:
    box = trimesh.creation.box()
    faces = np.vstack((box.faces, [0, 0, 1]))
    mesh = trimesh.Trimesh(vertices=box.vertices.copy(), faces=faces, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(mesh.vertices), 2)),
        material=PBRMaterial(
            baseColorTexture=Image.new("RGB", (4, 4), (120, 60, 30)),
            metallicRoughnessTexture=Image.new("RGB", (4, 4), (0, 150, 40)),
            baseColorFactor=[1.0, 1.0, 1.0, 1.0],
        ),
    )
    return mesh


class RemoveZeroAreaFacesTests(unittest.TestCase):
    def test_removes_only_zero_area_faces_and_preserves_visual_data(self) -> None:
        mesh = textured_box_with_degenerate_face()

        cleaned, removed = remove_zero_area_faces(mesh)

        self.assertEqual(removed, 1)
        self.assertEqual(len(cleaned.faces), 12)
        self.assertEqual(int(np.count_nonzero(cleaned.area_faces == 0)), 0)
        np.testing.assert_array_equal(cleaned.vertices, mesh.vertices)
        np.testing.assert_array_equal(cleaned.faces, mesh.faces[:-1])
        np.testing.assert_array_equal(cleaned.visual.uv, mesh.visual.uv)
        assert isinstance(cleaned.visual.material, PBRMaterial)
        assert cleaned.visual.material.baseColorTexture is not None
        np.testing.assert_array_equal(
            np.asarray(cleaned.visual.material.baseColorTexture),
            np.asarray(mesh.visual.material.baseColorTexture),
        )

    def test_preserves_positive_area_faces(self) -> None:
        vertices = np.array(
            [
                [0.0, 0.0, 0.0],
                [1e-8, 0.0, 0.0],
                [0.0, 1e-8, 0.0],
                [1.0, 0.0, 0.0],
            ]
        )
        mesh = trimesh.Trimesh(
            vertices=vertices,
            faces=np.array([[0, 1, 2], [0, 0, 3]]),
            process=False,
        )

        cleaned, removed = remove_zero_area_faces(mesh)

        self.assertEqual(removed, 1)
        self.assertEqual(len(cleaned.faces), 1)
        self.assertGreater(float(cleaned.area_faces[0]), 0)

    def test_preserves_disconnected_components(self) -> None:
        first = trimesh.creation.box()
        second = trimesh.creation.box()
        second.apply_translation([4, 0, 0])
        combined = trimesh.util.concatenate([first, second])
        faces = np.vstack((combined.faces, [0, 0, 1]))
        mesh = trimesh.Trimesh(
            vertices=combined.vertices.copy(),
            faces=faces,
            process=False,
        )

        cleaned, removed = remove_zero_area_faces(mesh)
        report = inspect_glb(cleaned.export(file_type="glb"), "building", None)

        self.assertEqual(removed, 1)
        self.assertEqual(report.meshes[0].triangles, 24)
        self.assertEqual(len(report.meshes[0].components), 2)

    def test_rejects_mesh_without_positive_area_faces(self) -> None:
        mesh = trimesh.Trimesh(
            vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]),
            faces=np.array([[0, 0, 1]]),
            process=False,
        )

        with self.assertRaisesRegex(ValueError, "no positive-area faces"):
            remove_zero_area_faces(mesh)


class CleanGlbTests(unittest.TestCase):
    def test_optional_normals_preserve_ship_faces_and_do_not_mutate_source(self) -> None:
        raw = textured_box_with_degenerate_face().export(file_type="glb", include_normals=False)
        default = clean_glb(raw, None, asset_type="ship")
        cleaned = clean_glb(raw, None, asset_type="ship", with_normals=True)

        self.assertEqual(inspect_glb(default.data, "ship", None).missing_normal_primitives, 1)
        report = inspect_glb(cleaned.data, "ship", None)
        self.assertEqual(report.missing_normal_primitives, 0)
        self.assertEqual(report.meshes[0].zero_area_faces, 0)
        self.assertTrue(report.meshes[0].uv_valid)
        self.assertIsNotNone(report.meshes[0].base_color)
        original_scene = trimesh.load_scene(
            file_obj=io.BytesIO(raw), file_type="glb", process=False
        )
        cleaned_scene = trimesh.load_scene(
            file_obj=io.BytesIO(cleaned.data), file_type="glb", process=False
        )
        original_mesh = next(iter(original_scene.geometry.values()))
        cleaned_mesh = next(iter(cleaned_scene.geometry.values()))
        np.testing.assert_array_equal(
            original_mesh.vertices[original_mesh.faces[:-1]],
            cleaned_mesh.vertices[cleaned_mesh.faces],
        )
        self.assertTrue(np.isfinite(cleaned_mesh.vertex_normals).all())
        np.testing.assert_allclose(
            np.linalg.norm(cleaned_mesh.vertex_normals, axis=1), 1.0, atol=1e-5
        )

    def test_cleans_separate_glb_and_preserves_instances_and_materials(self) -> None:
        scene = trimesh.Scene()
        scene.add_geometry(
            textured_box_with_degenerate_face(),
            geom_name="building",
            node_name="first",
        )
        scene.graph.update(
            frame_to="second",
            matrix=trimesh.transformations.translation_matrix([10, 0, 0]),
            geometry="building",
        )
        raw = scene.export(file_type="glb")

        cleaned = clean_glb(raw, "hospital")
        report = inspect_glb(cleaned.data, "building", "hospital")

        self.assertEqual(cleaned.removed_zero_area_faces, 1)
        self.assertEqual(cleaned.remaining_faces, 12)
        self.assertEqual(report.instances, 2)
        self.assertEqual(report.world_bounds, [[-0.5, -0.5, -0.5], [10.5, 0.5, 0.5]])
        self.assertEqual(report.missing_normal_primitives, 1)
        self.assertTrue(report.meshes[0].uv_valid)
        self.assertEqual(report.meshes[0].zero_area_faces, 0)
        self.assertIsNotNone(report.meshes[0].base_color)


class CleanerCliTests(unittest.IsolatedAsyncioTestCase):
    async def test_cleans_ship_without_a_facility_kind(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "shuttle.glb"
            raw = textured_box_with_degenerate_face().export(file_type="glb")
            source.write_bytes(raw)
            with patch.object(
                sys,
                "argv",
                ["trellis2_clean_mesh.py", str(source), "--asset-type", "ship", "--with-normals"],
            ):
                self.assertEqual(await main(), 0)
            output = source.with_name("shuttle_zero_area_cleaned.glb")
            report = inspect_glb(output.read_bytes(), "ship", None)
            self.assertEqual(report.meshes[0].zero_area_faces, 0)
            self.assertEqual(report.meshes[0].triangles, 12)
            self.assertEqual(report.missing_normal_primitives, 0)
            self.assertEqual(source.read_bytes(), raw)

    async def test_rejects_building_without_kind_and_ship_with_kind(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "asset.glb"
            source.write_bytes(textured_box_with_degenerate_face().export(file_type="glb"))
            for arguments in (
                [],
                ["--asset-type", "ship", "--facility-kind", "hospital"],
            ):
                with (
                    self.subTest(arguments=arguments),
                    patch.object(sys, "argv", ["trellis2_clean_mesh.py", str(source), *arguments]),
                ):
                    self.assertEqual(await main(), 1)
                self.assertFalse(source.with_name("asset_zero_area_cleaned.glb").exists())

    async def test_writes_a_new_file_without_changing_the_source(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "hospital.glb"
            raw = textured_box_with_degenerate_face().export(file_type="glb")
            source.write_bytes(raw)
            output = source.with_name("hospital_zero_area_cleaned.glb")
            with patch.object(
                sys,
                "argv",
                [
                    "trellis2_clean_mesh.py",
                    str(source),
                    "--facility-kind",
                    "hospital",
                ],
            ):
                self.assertEqual(await main(), 0)

            self.assertEqual(source.read_bytes(), raw)
            self.assertTrue(output.is_file())
            report = inspect_glb(output.read_bytes(), "building", "hospital")
            self.assertEqual(report.meshes[0].zero_area_faces, 0)

    async def test_does_not_overwrite_existing_output(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "hospital.glb"
            output = Path(directory) / "cleaned.glb"
            source.write_bytes(textured_box_with_degenerate_face().export(file_type="glb"))
            output.write_bytes(b"keep")
            with patch.object(
                sys,
                "argv",
                [
                    "trellis2_clean_mesh.py",
                    str(source),
                    "--facility-kind",
                    "hospital",
                    "--output",
                    str(output),
                ],
            ):
                self.assertEqual(await main(), 1)
            self.assertEqual(output.read_bytes(), b"keep")

    async def test_refuses_to_overwrite_source(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "hospital.glb"
            raw = textured_box_with_degenerate_face().export(file_type="glb")
            source.write_bytes(raw)
            with patch.object(
                sys,
                "argv",
                [
                    "trellis2_clean_mesh.py",
                    str(source),
                    "--facility-kind",
                    "hospital",
                    "--output",
                    str(source),
                ],
            ):
                self.assertEqual(await main(), 1)
            self.assertEqual(source.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
