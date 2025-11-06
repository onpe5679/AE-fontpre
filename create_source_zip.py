import os
import zipfile
from pathlib import Path

def create_source_zip():
    """Create a zip file with only essential source code files"""
    
    base_dir = Path('/mnt/c/DevAT/AE-fontpre')
    source_dir = base_dir / 'com.aefont.preview'
    output_zip = base_dir / 'AE-Font-Preview-Source.zip'
    
    # Files and directories to include
    include_patterns = [
        'CSXS/manifest.xml',
        'css/styles.css',
        'js/CSInterface.js',
        'js/debug.js',
        'js/fontFamily.js',
        'js/fontLoader.js',
        'js/fontRender.js',
        'js/main.js',
        'js/services/pythonPreviewClient.js',
        'js/services/pythonProcessManager.js',
        'jsx/hostscript.jsx',
        'python/font_server.py',
        'python/font_name_resolver.py',
        'python/requirements.txt',
        'index.html',
    ]
    
    # Create zip file
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for pattern in include_patterns:
            file_path = source_dir / pattern
            if file_path.exists():
                # Add file with relative path
                arcname = f'com.aefont.preview/{pattern}'
                zipf.write(file_path, arcname)
                print(f'Added: {arcname}')
            else:
                print(f'Warning: {pattern} not found')
    
    print(f'\n✓ Created: {output_zip}')
    print(f'Size: {output_zip.stat().st_size / 1024:.2f} KB')

if __name__ == '__main__':
    create_source_zip()
