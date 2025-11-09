#!/usr/bin/env python3
"""Build script for font_server.exe using PyInstaller."""

import os
import sys
import subprocess
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
SERVER_SCRIPT = SCRIPT_DIR / "font_server.py"
SPEC_FILE = SCRIPT_DIR / "font_server.spec"
DIST_DIR = SCRIPT_DIR / "dist"
BUILD_DIR = SCRIPT_DIR / "build"


def check_dependencies():
    """Ensure PyInstaller and Pillow are installed."""
    print("Checking dependencies...")
    try:
        import PIL
        print(f"✓ Pillow {PIL.__version__} found")
    except ImportError:
        print("✗ Pillow not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow>=10.0.0"])
    
    try:
        import PyInstaller
        print(f"✓ PyInstaller {PyInstaller.__version__} found")
    except ImportError:
        print("✗ PyInstaller not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller>=6.0.0"])


def clean_build():
    """Remove previous build artifacts."""
    print("\nCleaning previous build...")
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
        print(f"  Removed {BUILD_DIR}")
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
        print(f"  Removed {DIST_DIR}")
    if SPEC_FILE.exists():
        SPEC_FILE.unlink()
        print(f"  Removed {SPEC_FILE}")


def build_exe():
    """Build the executable using PyInstaller."""
    print("\nBuilding font_server.exe...")
    
    # PyInstaller command
    cmd = [
        "pyinstaller",
        "--onefile",              # Single executable
        "--noconsole",            # No console window (background server)
        "--name=font_server",     # Output name
        "--clean",                # Clean cache
        "--noconfirm",            # Overwrite without asking
        
        # Hidden imports (no Tkinter dependency required)
        # Add data files (none needed for this script)
        
        # Optimize
        "--strip",
        "--noupx",
        
        str(SERVER_SCRIPT)
    ]
    
    subprocess.check_call(cmd, cwd=SCRIPT_DIR)
    print("✓ Build completed!")


def copy_to_bin():
    """Copy the built executable to the bin/win directory."""
    exe_src = DIST_DIR / "font_server.exe"
    bin_dir = SCRIPT_DIR.parent / "bin" / "win"
    
    if not exe_src.exists():
        print(f"\n✗ Error: {exe_src} not found!")
        return False
    
    bin_dir.mkdir(parents=True, exist_ok=True)
    exe_dest = bin_dir / "font_server.exe"
    
    print(f"\nCopying executable...")
    shutil.copy2(exe_src, exe_dest)
    print(f"  {exe_src} → {exe_dest}")
    
    file_size = exe_dest.stat().st_size / (1024 * 1024)
    print(f"  File size: {file_size:.2f} MB")
    
    return True


def main():
    print("=" * 60)
    print("Font Server - Windows Executable Builder")
    print("=" * 60)
    
    if not SERVER_SCRIPT.exists():
        print(f"✗ Error: {SERVER_SCRIPT} not found!")
        sys.exit(1)
    
    try:
        check_dependencies()
        clean_build()
        build_exe()
        
        if copy_to_bin():
            print("\n" + "=" * 60)
            print("✓ Build successful!")
            print("=" * 60)
            print(f"\nExecutable location:")
            print(f"  {SCRIPT_DIR.parent / 'bin' / 'win' / 'font_server.exe'}")
            print("\nTo test:")
            print("  cd ../bin/win")
            print("  ./font_server.exe")
            print("  # Open browser: http://localhost:8765/ping")
        else:
            sys.exit(1)
            
    except subprocess.CalledProcessError as e:
        print(f"\n✗ Build failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
