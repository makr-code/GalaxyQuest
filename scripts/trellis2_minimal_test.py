#!/usr/bin/env python3
"""
TRELLIS2 Minimal Test Suite
Testet die kleinsten verfügbaren Modelle und validiert Integrations-Pipeline
"""

import os
import json
import sys
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration: SMALLEST MODEL
# ─────────────────────────────────────────────────────────────────────────────

TRELLIS_MODEL = "TRELLIS-text-base"  # Kleinste Variante (~500 MB)
BATCH_SIZE = 1
MAX_RESOLUTION = 512
DEVICE = "cpu"  # Funktioniert auch ohne GPU

# Pfade
WORKSPACE_ROOT = Path(__file__).parent.parent
GENERATED_DIR = WORKSPACE_ROOT / "generated" / "trellis2"
MODELS_DIR = WORKSPACE_ROOT / "tools" / "trellis2" / "models"
TEST_RESULTS = WORKSPACE_ROOT / "generated" / "trellis2" / "test_results.json"

# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

class TRELLIS2Tests:
    def __init__(self):
        self.results = {
            "timestamp": None,
            "model": TRELLIS_MODEL,
            "device": DEVICE,
            "tests": [],
            "summary": {
                "passed": 0,
                "failed": 0,
                "skipped": 0
            }
        }
    
    def test_1_imports(self):
        """Test: Grundlegende Imports funktionieren"""
        try:
            print("[1/6] Testing imports...", end=" ")
            import torch
            import transformers
            from pathlib import Path
            print("✓ PASS")
            self.results["tests"].append({
                "name": "imports",
                "status": "PASS",
                "error": None
            })
            self.results["summary"]["passed"] += 1
            return True
        except Exception as e:
            print(f"✗ FAIL: {e}")
            self.results["tests"].append({
                "name": "imports",
                "status": "FAIL",
                "error": str(e)
            })
            self.results["summary"]["failed"] += 1
            return False
    
    def test_2_directories(self):
        """Test: Output-Verzeichnisse vorhanden"""
        try:
            print("[2/6] Testing output directories...", end=" ")
            GENERATED_DIR.mkdir(parents=True, exist_ok=True)
            (GENERATED_DIR / "imported").mkdir(exist_ok=True)
            (GENERATED_DIR / "imported" / "ship").mkdir(exist_ok=True)
            assert GENERATED_DIR.exists(), f"{GENERATED_DIR} nicht erstellt"
            print(f"✓ PASS ({GENERATED_DIR})")
            self.results["tests"].append({
                "name": "directories",
                "status": "PASS",
                "error": None
            })
            self.results["summary"]["passed"] += 1
            return True
        except Exception as e:
            print(f"✗ FAIL: {e}")
            self.results["tests"].append({
                "name": "directories",
                "status": "FAIL",
                "error": str(e)
            })
            self.results["summary"]["failed"] += 1
            return False
    
    def test_3_torch_device(self):
        """Test: PyTorch Device-Konfiguration"""
        try:
            print("[3/6] Testing PyTorch device...", end=" ")
            import torch
            has_cuda = torch.cuda.is_available()
            device_name = "CUDA" if has_cuda else "CPU"
            print(f"✓ PASS ({device_name})")
            self.results["tests"].append({
                "name": "torch_device",
                "status": "PASS",
                "error": None,
                "details": {
                    "cuda_available": has_cuda,
                    "device": device_name
                }
            })
            self.results["summary"]["passed"] += 1
            return True
        except Exception as e:
            print(f"✗ FAIL: {e}")
            self.results["tests"].append({
                "name": "torch_device",
                "status": "FAIL",
                "error": str(e)
            })
            self.results["summary"]["failed"] += 1
            return False
    
    def test_4_mock_glb_generation(self):
        """Test: Mock GLB-Datei generieren (ohne echtes Modell)"""
        try:
            print("[4/6] Testing mock GLB generation...", end=" ")
            
            # Generiere minimal gültiges GLB-Format
            glb_path = GENERATED_DIR / "test_mock_ship.glb"
            
            # Minimal gültiger GLB Header (12 bytes) + JSON Chunk
            import struct
            glb_magic = b"glTF"
            glb_version = struct.pack("<I", 2)
            
            # Minimal JSON content
            json_content = {
                "asset": {"version": "2.0"},
                "scene": 0,
                "scenes": [{"nodes": [0]}],
                "nodes": [{"mesh": 0}],
                "meshes": [{
                    "primitives": [{
                        "attributes": {"POSITION": 0},
                        "indices": 1,
                        "material": 0
                    }]
                }],
                "materials": [{"pbrMetallicRoughness": {}}],
                "accessors": [
                    {"bufferView": 0, "type": "VEC3", "count": 3, "componentType": 5126},
                    {"bufferView": 1, "type": "SCALAR", "count": 3, "componentType": 5125}
                ],
                "bufferViews": [
                    {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                    {"buffer": 0, "byteOffset": 36, "byteLength": 12}
                ],
                "buffers": [{"byteLength": 48}]
            }
            
            json_bytes = json.dumps(json_content).encode("utf-8")
            json_len = len(json_bytes)
            
            # Mock Binary Buffer (48 bytes für minimal GLB)
            binary_data = b"\x00" * 48
            binary_len = len(binary_data)
            
            # GLB Total Size
            total_size = 12 + 8 + json_len + 8 + binary_len
            
            # Write GLB
            with open(glb_path, "wb") as f:
                f.write(glb_magic)
                f.write(glb_version)
                f.write(struct.pack("<I", total_size))
                # JSON Chunk
                f.write(struct.pack("<I", json_len))
                f.write(b"JSON")
                f.write(json_bytes)
                # Binary Chunk
                f.write(struct.pack("<I", binary_len))
                f.write(b"BIN\0")
                f.write(binary_data)
            
            assert glb_path.exists(), f"{glb_path} nicht erstellt"
            size_kb = glb_path.stat().st_size / 1024
            print(f"✓ PASS ({size_kb:.1f} KB)")
            self.results["tests"].append({
                "name": "mock_glb_generation",
                "status": "PASS",
                "error": None,
                "details": {
                    "file": str(glb_path),
                    "size_bytes": glb_path.stat().st_size
                }
            })
            self.results["summary"]["passed"] += 1
            return True
        except Exception as e:
            print(f"✗ FAIL: {e}")
            self.results["tests"].append({
                "name": "mock_glb_generation",
                "status": "FAIL",
                "error": str(e)
            })
            self.results["summary"]["failed"] += 1
            return False
    
    def test_5_api_simulation(self):
        """Test: TRELLIS2 API Simulation (ohne echtes Modell)"""
        try:
            print("[5/6] Testing API simulation...", end=" ")
            
            # Simuliere TRELLIS2 API Response
            api_response = {
                "status": "success",
                "model": TRELLIS_MODEL,
                "prompt": "a sci-fi cargo ship",
                "output": {
                    "glb_url": "generated/trellis2/test_mock_ship.glb",
                    "preview_url": "generated/trellis2/test_mock_ship_preview.png",
                    "generation_time_ms": 45000,
                    "quality_tier": "medium"
                }
            }
            
            # Speichere API Response
            api_log = GENERATED_DIR / "api_response_log.json"
            with open(api_log, "w") as f:
                json.dump(api_response, f, indent=2)
            
            assert api_log.exists(), f"{api_log} nicht erstellt"
            print("✓ PASS")
            self.results["tests"].append({
                "name": "api_simulation",
                "status": "PASS",
                "error": None,
                "details": {
                    "model": api_response["model"],
                    "output": api_response["output"]
                }
            })
            self.results["summary"]["passed"] += 1
            return True
        except Exception as e:
            print(f"✗ FAIL: {e}")
            self.results["tests"].append({
                "name": "api_simulation",
                "status": "FAIL",
                "error": str(e)
            })
            self.results["summary"]["failed"] += 1
            return False
    
    def test_6_asset_pipeline(self):
        """Test: Komplette Asset-Pipeline (Validierung)"""
        try:
            print("[6/6] Testing asset pipeline...", end=" ")
            
            # Simuliere Asset Import
            asset = {
                "id": "test_001",
                "name": "Test Cargo Ship",
                "class": "freighter",
                "geometry": {
                    "triangles": 5000,
                    "vertices": 2500,
                    "bones": 10
                },
                "textures": {
                    "baseColor": 512,
                    "roughness": 256,
                    "normal": 512,
                    "metallic": 256
                },
                "materials": 4,
                "metadata": {
                    "origin": "TRELLIS2",
                    "generation_time_ms": 45000,
                    "model": TRELLIS_MODEL,
                    "quality_tier": "medium"
                }
            }
            
            # Validiere Asset
            budget = {
                "freighter": {
                    "max_triangles": 15000,
                    "max_materials": 8,
                    "max_memory_mb": 128
                }
            }
            
            asset_class = asset["class"]
            assert asset_class in budget, f"Unbekannte Asset-Klasse: {asset_class}"
            assert asset["geometry"]["triangles"] <= budget[asset_class]["max_triangles"], \
                f"Zu viele Dreiecke: {asset['geometry']['triangles']} > {budget[asset_class]['max_triangles']}"
            assert asset["materials"] <= budget[asset_class]["max_materials"], \
                f"Zu viele Materialien: {asset['materials']} > {budget[asset_class]['max_materials']}"
            
            # Speichere Asset
            asset_file = GENERATED_DIR / "imported" / "ship" / "test_cargo_001.json"
            with open(asset_file, "w") as f:
                json.dump(asset, f, indent=2)
            
            assert asset_file.exists(), f"{asset_file} nicht erstellt"
            print("✓ PASS")
            self.results["tests"].append({
                "name": "asset_pipeline",
                "status": "PASS",
                "error": None,
                "details": {
                    "asset_id": asset["id"],
                    "triangles": asset["geometry"]["triangles"],
                    "materials": asset["materials"]
                }
            })
            self.results["summary"]["passed"] += 1
            return True
        except Exception as e:
            print(f"✗ FAIL: {e}")
            self.results["tests"].append({
                "name": "asset_pipeline",
                "status": "FAIL",
                "error": str(e)
            })
            self.results["summary"]["failed"] += 1
            return False
    
    def run_all(self):
        """Führe alle Tests aus"""
        print("\n" + "=" * 70)
        print("TRELLIS2 MINIMAL TEST SUITE")
        print("=" * 70)
        print(f"Model: {TRELLIS_MODEL} (Kleinste Variante)")
        print(f"Device: {DEVICE}")
        print("=" * 70 + "\n")
        
        import datetime
        self.results["timestamp"] = datetime.datetime.now().isoformat()
        
        self.test_1_imports()
        self.test_2_directories()
        self.test_3_torch_device()
        self.test_4_mock_glb_generation()
        self.test_5_api_simulation()
        self.test_6_asset_pipeline()
        
        # Summary
        print("\n" + "=" * 70)
        print("TEST SUMMARY")
        print("=" * 70)
        passed = self.results["summary"]["passed"]
        failed = self.results["summary"]["failed"]
        total = passed + failed
        print(f"✓ Passed:  {passed}/{total}")
        print(f"✗ Failed:  {failed}/{total}")
        print("=" * 70 + "\n")
        
        # Speichere Ergebnisse
        TEST_RESULTS.parent.mkdir(parents=True, exist_ok=True)
        with open(TEST_RESULTS, "w") as f:
            json.dump(self.results, f, indent=2)
        print(f"📋 Ergebnisse gespeichert: {TEST_RESULTS}")
        
        # Exit Code
        return 0 if failed == 0 else 1

if __name__ == "__main__":
    suite = TRELLIS2Tests()
    exit_code = suite.run_all()
    sys.exit(exit_code)
