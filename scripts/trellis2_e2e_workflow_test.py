#!/usr/bin/env python3
"""
TRELLIS2 End-to-End Workflow Test
Vollständiger Test: Prompt → Generation → Asset Pipeline → WebGL Viewer

Test Flow:
1. WebApp Erreichbarkeit prüfen
2. Test-Prompt generieren (oder real Text->3D)
3. GLB Datei validieren
4. Asset Pipeline durchlaufen
5. WebGL Viewer URLs vorbereiten
6. Gesamtzeit messen
"""

import json
import time
import requests
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, Tuple
import hashlib


class TRELLIS2E2ETest:
    """End-to-End Test für TRELLIS2 Workflow"""
    
    def __init__(self, workspace_root: str = "/workspace"):
        self.workspace = Path(workspace_root)
        self.generated_dir = self.workspace / "generated"
        self.images_dir = self.generated_dir / "image2text"
        self.logs_dir = self.generated_dir / "logs"
        self.viewer_path = Path(__file__).parent / "viewer.html"
        
        self.results = {
            "test_name": "TRELLIS2 E2E Workflow",
            "timestamp": datetime.utcnow().isoformat(),
            "phases": {},
            "total_time": 0,
            "success": False
        }
        
        self.start_time = time.time()
    
    def log_phase(self, phase_name: str, success: bool, details: dict):
        """Log test phase result"""
        self.results["phases"][phase_name] = {
            "success": success,
            "details": details,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"\n[{phase_name}] {status}")
        for key, value in details.items():
            print(f"  • {key}: {value}")
    
    # === PHASE 1: WebApp Connectivity ===
    def test_webapp_connectivity(self) -> bool:
        """Test Gradio WebApp is accessible"""
        print("\n" + "="*60)
        print("PHASE 1: WebApp Connectivity")
        print("="*60)
        
        try:
            response = requests.get("http://localhost:7862", timeout=5)
            
            details = {
                "url": "http://localhost:7862",
                "status_code": response.status_code,
                "content_type": response.headers.get('content-type', 'unknown'),
                "response_size": len(response.content),
                "time_ms": f"{response.elapsed.total_seconds() * 1000:.1f}"
            }
            
            success = response.status_code == 200
            self.log_phase("WebApp Connectivity", success, details)
            
            return success
            
        except Exception as e:
            self.log_phase("WebApp Connectivity", False, {"error": str(e)})
            return False
    
    # === PHASE 2: Create Test Asset (Mock or Real) ===
    def create_test_glb(self, filename: str = "test_generation.glb") -> Path:
        """Create minimal test GLB file or use existing"""
        print("\n" + "="*60)
        print("PHASE 2: Asset Generation (Test/Mock)")
        print("="*60)
        
        self.images_dir.mkdir(parents=True, exist_ok=True)
        glb_path = self.images_dir / filename
        
        # Check if we have existing GLB files
        existing_glbs = list(self.images_dir.glob("*.glb"))
        
        if existing_glbs:
            # Use existing generated GLB
            glb_path = existing_glbs[0]
            details = {
                "source": "existing_generated_file",
                "filename": glb_path.name,
                "size_mb": glb_path.stat().st_size / (1024 ** 2),
                "path": str(glb_path)
            }
            self.log_phase("Asset Generation", True, details)
            return glb_path
        
        # Create minimal test GLB (glTF binary format)
        # GLB Header: magic (glTF) + version + total_size
        magic = b"glTF"
        version = (2).to_bytes(4, 'little')
        
        # Minimal JSON chunk (scene with empty mesh)
        json_chunk = b'''{
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0,0,0], "max": [1,1,1]},
                {"bufferView": 1, "componentType": 5125, "count": 3, "type": "SCALAR"}
            ],
            "bufferViews": [
                {"buffer": 0, "byteLength": 36, "byteOffset": 0},
                {"buffer": 0, "byteLength": 12, "byteOffset": 36}
            ],
            "buffers": [{"byteLength": 48}],
            "asset": {"version": "2.0"}
        }'''
        
        # Minimal binary data: 3 vertices + 3 indices
        binary_data = b'\x00' * 48
        
        # Calculate sizes (aligned to 4 bytes)
        json_padded = json_chunk + b' ' * (4 - (len(json_chunk) % 4))
        binary_padded = binary_data + b' ' * (4 - (len(binary_data) % 4))
        
        json_chunk_header = (len(json_padded)).to_bytes(4, 'little') + b"JSON"
        binary_chunk_header = (len(binary_padded)).to_bytes(4, 'little') + b"BIN\x00"
        
        total_size = 20 + len(json_chunk_header) + len(json_padded) + len(binary_chunk_header) + len(binary_padded)
        
        # Write GLB file
        with open(glb_path, 'wb') as f:
            f.write(magic)
            f.write(version)
            f.write(total_size.to_bytes(4, 'little'))
            f.write(json_chunk_header)
            f.write(json_padded)
            f.write(binary_chunk_header)
            f.write(binary_padded)
        
        details = {
            "source": "generated_minimal_glb",
            "filename": glb_path.name,
            "size_bytes": glb_path.stat().st_size,
            "path": str(glb_path)
        }
        
        self.log_phase("Asset Generation", True, details)
        return glb_path
    
    # === PHASE 3: Validate GLB ===
    def validate_glb(self, glb_path: Path) -> bool:
        """Validate GLB file structure"""
        print("\n" + "="*60)
        print("PHASE 3: GLB Validation")
        print("="*60)
        
        try:
            with open(glb_path, 'rb') as f:
                magic = f.read(4)
                if magic != b"glTF":
                    self.log_phase("GLB Validation", False, {"error": "Invalid GLB magic number"})
                    return False
                
                version = int.from_bytes(f.read(4), 'little')
                size = int.from_bytes(f.read(4), 'little')
                
                file_size = glb_path.stat().st_size
                checksum = hashlib.sha256(glb_path.read_bytes()).hexdigest()[:16]
                
                details = {
                    "magic": magic.decode('latin1'),
                    "version": version,
                    "declared_size": size,
                    "actual_size": file_size,
                    "size_match": file_size == size,
                    "checksum": checksum,
                    "filename": glb_path.name
                }
                
                success = magic == b"glTF" and file_size == size
                self.log_phase("GLB Validation", success, details)
                return success
                
        except Exception as e:
            self.log_phase("GLB Validation", False, {"error": str(e)})
            return False
    
    # === PHASE 4: Asset Pipeline ===
    def test_asset_pipeline(self, glb_path: Path) -> Optional[Path]:
        """Test asset import pipeline"""
        print("\n" + "="*60)
        print("PHASE 4: Asset Pipeline Import")
        print("="*60)
        
        try:
            # Simulate asset import
            asset_id = glb_path.stem
            imported_dir = self.generated_dir / "imported" / "ship" / "terran" / "test"
            imported_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy GLB
            dest_glb = imported_dir / f"{asset_id}.glb"
            import shutil
            shutil.copy2(glb_path, dest_glb)
            
            # Create metadata
            metadata = {
                "asset_id": asset_id,
                "source_file": str(glb_path),
                "import_date": datetime.utcnow().isoformat(),
                "glb_size_bytes": dest_glb.stat().st_size,
                "metadata": {
                    "generation_method": "e2e_test",
                    "test_workflow": True
                }
            }
            
            metadata_file = imported_dir / f"{asset_id}.json"
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            details = {
                "asset_id": asset_id,
                "destination": str(dest_glb),
                "size_mb": dest_glb.stat().st_size / (1024 ** 2),
                "metadata_file": str(metadata_file)
            }
            
            self.log_phase("Asset Pipeline", True, details)
            return dest_glb
            
        except Exception as e:
            self.log_phase("Asset Pipeline", False, {"error": str(e)})
            return None
    
    # === PHASE 5: WebGL Viewer Setup ===
    def test_webgl_viewer(self, glb_path: Path) -> bool:
        """Setup WebGL viewer and verify accessibility"""
        print("\n" + "="*60)
        print("PHASE 5: WebGL Viewer Setup")
        print("="*60)
        
        try:
            # Create viewer HTML in asset directory
            viewer_dir = self.generated_dir / "viewer"
            viewer_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy viewer.html
            viewer_html = viewer_dir / "index.html"
            if self.viewer_path.exists():
                import shutil
                shutil.copy2(self.viewer_path, viewer_html)
            else:
                # Create minimal viewer
                viewer_html.write_text(f"""
                <!DOCTYPE html>
                <html>
                <head><title>TRELLIS2 Viewer</title></head>
                <body>
                    <h1>TRELLIS2 WebGL Viewer</h1>
                    <p>Model: {glb_path.name}</p>
                    <p>Size: {glb_path.stat().st_size / (1024**2):.2f} MB</p>
                </body>
                </html>
                """)
            
            # Create viewer config
            viewer_config = {
                "model_path": str(glb_path),
                "viewer_url": f"file://{viewer_html}",
                "model_name": glb_path.name,
                "model_size_mb": glb_path.stat().st_size / (1024 ** 2),
                "setup_time": datetime.utcnow().isoformat()
            }
            
            config_file = viewer_dir / "config.json"
            with open(config_file, 'w') as f:
                json.dump(viewer_config, f, indent=2)
            
            details = {
                "viewer_path": str(viewer_html),
                "config_file": str(config_file),
                "model_path": str(glb_path),
                "viewer_accessible": viewer_html.exists()
            }
            
            success = viewer_html.exists()
            self.log_phase("WebGL Viewer Setup", success, details)
            return success
            
        except Exception as e:
            self.log_phase("WebGL Viewer Setup", False, {"error": str(e)})
            return False
    
    # === PHASE 6: Database Registration (Simulated) ===
    def test_database_registration(self, glb_path: Path) -> bool:
        """Simulate database asset registration"""
        print("\n" + "="*60)
        print("PHASE 6: Database Registration")
        print("="*60)
        
        try:
            asset_record = {
                "asset_id": glb_path.stem,
                "faction": "terran",
                "type": "ship",
                "variant": "test",
                "glb_path": str(glb_path),
                "fingerprint": hashlib.sha256(glb_path.read_bytes()).hexdigest(),
                "file_size_bytes": glb_path.stat().st_size,
                "registration_date": datetime.utcnow().isoformat(),
                "status": "ready"
            }
            
            # Log registration
            registration_log = self.logs_dir / "e2e_registration.jsonl"
            with open(registration_log, 'a') as f:
                f.write(json.dumps(asset_record) + "\n")
            
            details = {
                "asset_id": asset_record["asset_id"],
                "faction": asset_record["faction"],
                "status": asset_record["status"],
                "fingerprint": asset_record["fingerprint"][:16] + "...",
                "registration_log": str(registration_log)
            }
            
            self.log_phase("Database Registration", True, details)
            return True
            
        except Exception as e:
            self.log_phase("Database Registration", False, {"error": str(e)})
            return False
    
    # === RUN ALL TESTS ===
    def run_all(self) -> dict:
        """Execute complete E2E test"""
        print("\n")
        print("╔" + "="*58 + "╗")
        print("║" + " "*58 + "║")
        print("║  🚀 TRELLIS2 END-TO-END WORKFLOW TEST".ljust(59) + "║")
        print("║" + " "*58 + "║")
        print("╚" + "="*58 + "╝")
        
        # Phase 1
        if not self.test_webapp_connectivity():
            print("\n⚠️  WebApp not reachable - test aborted")
            return self.results
        
        # Phase 2
        glb_path = self.create_test_glb()
        if not glb_path:
            print("\n❌ Asset generation failed")
            return self.results
        
        # Phase 3
        if not self.validate_glb(glb_path):
            print("\n❌ GLB validation failed")
            return self.results
        
        # Phase 4
        imported_glb = self.test_asset_pipeline(glb_path)
        if not imported_glb:
            print("\n❌ Asset pipeline failed")
            return self.results
        
        # Phase 5
        if not self.test_webgl_viewer(imported_glb):
            print("\n⚠️  WebGL viewer setup failed (non-critical)")
        
        # Phase 6
        self.test_database_registration(imported_glb)
        
        # Summary
        self.results["total_time"] = time.time() - self.start_time
        self.results["success"] = all(p.get("success", False) for p in self.results["phases"].values())
        
        print("\n" + "="*60)
        print("FINAL RESULTS")
        print("="*60)
        print(f"Total Time: {self.results['total_time']:.2f}s")
        print(f"Status: {'✅ ALL PASSED' if self.results['success'] else '❌ SOME FAILED'}")
        print(f"Phases Passed: {sum(1 for p in self.results['phases'].values() if p.get('success'))}/{len(self.results['phases'])}")
        
        # Save report
        report_file = self.logs_dir / "e2e_test_report.json"
        with open(report_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        print(f"\n📊 Report: {report_file}")
        
        return self.results


if __name__ == "__main__":
    import sys
    
    workspace = sys.argv[1] if len(sys.argv) > 1 else "/workspace"
    
    tester = TRELLIS2E2ETest(workspace)
    results = tester.run_all()
    
    # Exit with appropriate code
    sys.exit(0 if results["success"] else 1)
