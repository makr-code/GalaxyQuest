"""Generate a local rigged MakeHuman/MPFB base character for WebGPU dev previews.

Run with Blender 4.4+:
    blender --background --python scripts/export_mpfb_herald_base.py -- [output.glb]
"""

from __future__ import annotations

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType

import bpy


def load_mpfb_service(service_name: str, class_name: str) -> type:
    package_name = next((name for name in sys.modules if name.endswith(".mpfb")), None)
    if package_name is None:
        raise RuntimeError("Enable the official MPFB extension in Blender before exporting.")
    module: ModuleType = importlib.import_module(f"{package_name}.services.{service_name}")
    return getattr(module, class_name)


def ensure_mpfb_enabled() -> None:
    module_name = "bl_ext.blender_org.mpfb"
    if module_name not in bpy.context.preferences.addons:
        try:
            bpy.ops.preferences.addon_enable(module=module_name)
        except Exception as error:
            raise RuntimeError("Enable MPFB 2 in Blender Extensions before exporting.") from error


def get_output_path() -> Path:
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    workspace = Path(__file__).resolve().parents[1]
    output = Path(arguments[0]) if arguments else workspace / "generated/dev-only/heralds/generic_humanoid_base.glb"
    return output.resolve()


def add_bone_action(armature, action_name: str, bone_name: str, keyframes: list[tuple[int, float]]) -> None:
    if armature.data.bones.get(bone_name) is None:
        raise RuntimeError(f"MPFB game_engine rig is missing required bone {bone_name}.")
    animation_data = armature.animation_data_create()
    action = bpy.data.actions.new(action_name)
    animation_data.action = action
    pose_bone = armature.pose.bones[bone_name]
    pose_bone.rotation_mode = "XYZ"
    for frame, angle in keyframes:
        pose_bone.rotation_euler = (angle, 0.0, 0.0)
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
    animation_data.action = None
    track = animation_data.nla_tracks.new()
    track.name = action_name
    strip = track.strips.new(action_name, keyframes[0][0], action)
    strip.action_frame_start = keyframes[0][0]
    strip.action_frame_end = keyframes[-1][0]


def export_lod_variant(
    basemesh,
    label: str,
    ratio: float,
    output_path: Path,
    export_service,
    object_service,
) -> dict:
    root = export_service.create_character_copy(basemesh, name_suffix=f"_webgpu_{label}")
    try:
        mesh = object_service.find_object_of_type_amongst_nearest_relatives(root, "Basemesh")
        if mesh is None:
            raise RuntimeError(f"Could not find MPFB basemesh for {label} LOD.")
        export_service.bake_modifiers_remove_helpers(
            mesh,
            bake_masks=True,
            bake_subdiv=True,
            remove_helpers=True,
            also_proxy=True,
        )
        armature_modifier = next((modifier for modifier in mesh.modifiers if modifier.type == "ARMATURE"), None)
        decimate = mesh.modifiers.new(f"WebGPU_{label}_Decimate", "DECIMATE")
        decimate.ratio = ratio
        decimate.use_collapse_triangulate = True
        if armature_modifier is not None:
            while mesh.modifiers.find(decimate.name) > mesh.modifiers.find(armature_modifier.name):
                bpy.context.view_layer.objects.active = mesh
                mesh.select_set(True)
                bpy.ops.object.modifier_move_up(modifier=decimate.name)

        evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        evaluated_mesh = evaluated.to_mesh()
        triangles = sum(max(0, len(polygon.vertices) - 2) for polygon in evaluated_mesh.polygons)
        evaluated.to_mesh_clear()

        bpy.ops.object.select_all(action="DESELECT")
        root.select_set(True)
        for child in object_service.get_list_of_children(root):
            child.select_set(True)
        bpy.context.view_layer.objects.active = root
        result = bpy.ops.export_scene.gltf(
            filepath=str(output_path),
            export_format="GLB",
            use_selection=True,
            export_skins=True,
            export_animations=True,
            export_animation_mode="NLA_TRACKS",
            export_apply=True,
            export_yup=True,
        )
        if "FINISHED" not in result or not output_path.is_file() or output_path.stat().st_size < 4096:
            raise RuntimeError(f"Blender did not produce the {label} LOD GLB at {output_path}.")
        return {"label": label, "ratio": ratio, "triangles": triangles,
                "file": output_path.name, "bytes": output_path.stat().st_size}
    finally:
        for child in object_service.get_list_of_children(root):
            bpy.data.objects.remove(child, do_unlink=True)
        bpy.data.objects.remove(root, do_unlink=True)


def export_base_character(output_path: Path) -> None:
    ensure_mpfb_enabled()
    human_service = load_mpfb_service("humanservice", "HumanService")
    export_service = load_mpfb_service("exportservice", "ExportService")
    object_service = load_mpfb_service("objectservice", "ObjectService")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    basemesh = human_service.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
    )
    armature = human_service.add_builtin_rig(basemesh, "game_engine", import_weights=True)
    if armature is None:
        raise RuntimeError("MPFB did not create its game_engine armature.")
    add_bone_action(armature, "Idle_Breathing", "spine_03", [(1, 0.0), (30, 0.018), (60, 0.0)])
    add_bone_action(armature, "Greeting_Wave", "upperarm_r", [(1, 0.0), (8, -0.72), (13, -0.95), (18, -0.72), (25, 0.0)])

    export_root = export_service.create_character_copy(basemesh, name_suffix="_webgpu_export")
    export_basemesh = object_service.find_object_of_type_amongst_nearest_relatives(export_root, "Basemesh")
    if export_basemesh is None:
        raise RuntimeError("Could not find the copied MPFB basemesh for export.")
    export_service.bake_modifiers_remove_helpers(
        export_basemesh,
        bake_masks=True,
        bake_subdiv=True,
        remove_helpers=True,
        also_proxy=True,
    )

    bpy.ops.object.select_all(action="DESELECT")
    export_root.select_set(True)
    for child in object_service.get_list_of_children(export_root):
        child.select_set(True)
    bpy.context.view_layer.objects.active = export_root

    if not hasattr(bpy.ops.export_scene, "gltf"):
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_apply=True,
        export_yup=True,
    )
    if "FINISHED" not in result or not output_path.is_file() or output_path.stat().st_size < 4096:
        raise RuntimeError(f"Blender did not produce a valid GLB at {output_path}.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    variants = [
        export_lod_variant(
            basemesh, label, ratio,
            output_path.with_name(f"{output_path.stem}_lod_{label}{output_path.suffix}"),
            export_service, object_service,
        )
        for label, ratio in (("medium", 0.4), ("low", 0.15))
    ]
    manifest = {
        "asset": output_path.name,
        "source": "Local MakeHuman Community base mesh via MPFB 2 game_engine rig",
        "rig": "game_engine",
        "purpose": "Development-only WebGPU herald prototype",
        "high": {"file": output_path.name, "ratio": 1.0, "bytes": output_path.stat().st_size},
        "lods": variants,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "redistribution": "Review MakeHuman/MPFB asset licensing before any public release.",
    }
    output_path.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[MPFB] Exported {output_path} ({output_path.stat().st_size} bytes)")


if __name__ == "__main__":
    export_base_character(get_output_path())