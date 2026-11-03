import os
import subprocess
import sys
import importlib.util
from pathlib import Path

webui_dir = Path("/app/stable-diffusion-webui")

if importlib.util.find_spec("taming") is None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--prefer-binary",
            "taming-transformers-rom1504==0.0.6",
        ],
        check=True,
    )

os.execv(
    sys.executable,
    [sys.executable, "-u", str(webui_dir / "launch.py"), *sys.argv[1:]],
)