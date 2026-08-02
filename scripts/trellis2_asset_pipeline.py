#!/usr/bin/env python3
"""
TRELLIS2 Asset Integration Pipeline
Converts generated GLB files into game-ready assets with metadata
"""

import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional

# Paths
WORKSPACE = Path("/workspace")
GENERATED_DIR = WORKSPACE / "generated"
SOURCE_DIR = GENERATED_DIR / "image2text"  # or text2image
ASSETS_DIR = GENERATED_DIR / "imported"
LOGS_DIR = GENERATED_DIR / "logs"

class AssetPipeline:
    """Pipeline for GLB → Game Asset conversion"""
    
    def __init__(self, asset_type: str = "ship", faction: str = "terran", variant: str = "default"):
        """
        Initialize asset pipeline
        
        Args:
            asset_type: 'ship', 'station', 'asteroid', 'artifact'
            faction: Faction identifier (terran, xylothian, korvax, etc.)
            variant: Variant identifier (e.g., 'fighter', 'cargo', 'scout')
        """
        self.asset_type = asset_type
        self.faction = faction
        self.variant = variant
        self.asset_dir = ASSETS_DIR / asset_type / faction / variant
        self.asset_dir.mkdir(parents=True, exist_ok=True)
        
        self.log_file = LOGS_DIR / "asset_pipeline.jsonl"
        
    def log_event(self, event_type: str, details: dict):
        """Log pipeline events"""
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "event_type": event_type,
            "asset_type": self.asset_type,
            "faction": self.faction,
            "variant": self.variant,
            **details
        }
        with open(self.log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
    
    def import_glb(self, source_glb: Path, metadata: Optional[dict] = None) -> bool:
        """
        Import GLB file as game asset
        
        Args:
            source_glb: Path to source GLB file
            metadata: Optional metadata (prompt, generation_time, etc.)
        
        Returns:
            Success status
        """
        try:
            if not source_glb.exists():
                self.log_event("import_error", {"error": f"File not found: {source_glb}"})
                return False
            
            # Generate asset ID from source filename
            asset_id = source_glb.stem
            
            # Copy GLB file
            dest_glb = self.asset_dir / f"{asset_id}.glb"
            shutil.copy2(source_glb, dest_glb)
            
            # Create metadata JSON
            asset_metadata = {
                "asset_id": asset_id,
                "asset_type": self.asset_type,
                "faction": self.faction,
                "variant": self.variant,
                "source_file": str(source_glb),
                "import_date": datetime.utcnow().isoformat(),
                "glb_size_bytes": dest_glb.stat().st_size,
                "metadata": metadata or {}
            }
            
            metadata_file = self.asset_dir / f"{asset_id}.json"
            with open(metadata_file, "w") as f:
                json.dump(asset_metadata, f, indent=2)
            
            # Log success
            self.log_event("import_success", {
                "asset_id": asset_id,
                "glb_path": str(dest_glb),
                "metadata_path": str(metadata_file),
                "size_bytes": asset_metadata["glb_size_bytes"]
            })
            
            return True
            
        except Exception as e:
            self.log_event("import_error", {"error": str(e)})
            return False
    
    def list_assets(self) -> list:
        """List all imported assets"""
        try:
            assets = []
            for glb_file in sorted(self.asset_dir.glob("*.glb")):
                metadata_file = glb_file.with_suffix(".json")
                
                asset = {
                    "id": glb_file.stem,
                    "glb_path": str(glb_file),
                    "glb_size_mb": glb_file.stat().st_size / (1024 ** 2)
                }
                
                if metadata_file.exists():
                    with open(metadata_file) as f:
                        asset["metadata"] = json.load(f)
                
                assets.append(asset)
            
            return assets
            
        except Exception as e:
            self.log_event("list_error", {"error": str(e)})
            return []
    
    def validate_glb(self, glb_path: Path) -> dict:
        """
        Validate GLB file structure
        
        Returns:
            Validation report with format info
        """
        try:
            with open(glb_path, "rb") as f:
                magic = f.read(4)
                if magic != b"glTF":
                    return {"valid": False, "error": "Invalid GLB magic number"}
                
                version = int.from_bytes(f.read(4), 'little')
                size = int.from_bytes(f.read(4), 'little')
                
                return {
                    "valid": True,
                    "magic": magic.decode('latin1'),
                    "version": version,
                    "file_size": glb_path.stat().st_size,
                    "declared_size": size,
                    "size_match": glb_path.stat().st_size == size
                }
        except Exception as e:
            return {"valid": False, "error": str(e)}


def demo_import():
    """Demo: Import a test asset"""
    print("\n" + "="*60)
    print("TRELLIS2 Asset Pipeline Demo")
    print("="*60)
    
    # Create pipeline for different asset types
    configs = [
        ("ship", "terran", "fighter"),
        ("ship", "terran", "cargo"),
        ("station", "terran", "main"),
    ]
    
    for asset_type, faction, variant in configs:
        print(f"\n[Asset: {faction}/{asset_type}/{variant}]")
        
        pipeline = AssetPipeline(
            asset_type=asset_type,
            faction=faction,
            variant=variant
        )
        
        # Check for generated GLB files
        glb_files = list(SOURCE_DIR.glob("*.glb"))
        
        if glb_files:
            # Import first GLB as demo
            source_glb = glb_files[0]
            metadata = {
                "prompt": "Test generation from TRELLIS2",
                "generation_time": "~45 seconds",
                "model": "TRELLIS-image-large"
            }
            
            print(f"  Importing: {source_glb.name}")
            success = pipeline.import_glb(source_glb, metadata)
            
            if success:
                print(f"  ✅ Imported to: {pipeline.asset_dir}/")
                assets = pipeline.list_assets()
                print(f"  📊 Total assets in variant: {len(assets)}")
                
                # Show first asset details
                if assets:
                    asset = assets[0]
                    print(f"     • GLB: {asset['glb_path']}")
                    print(f"     • Size: {asset['glb_size_mb']:.2f} MB")
                    if "metadata" in asset:
                        print(f"     • Prompt: {asset['metadata'].get('metadata', {}).get('prompt', 'N/A')}")
            else:
                print(f"  ❌ Import failed")
        else:
            print(f"  ⚠ No GLB files found in {SOURCE_DIR}")


if __name__ == "__main__":
    demo_import()
