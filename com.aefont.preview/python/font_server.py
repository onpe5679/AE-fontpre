#!/usr/bin/env python3
"""Local font helper for AE Font Preview.

Exposes a small HTTP API for listing system fonts and rendering previews
using Tkinter/Pillow so that fonts unavailable to Chromium's renderer
can still be shown inside the CEP panel.

Endpoints:
    GET  /ping
    GET  /fonts
    POST /batch-preview { fonts: [name], text: str, size: int }

Windows-only prototype (mac build TBD).
"""

import base64
import io
import json
import math
import os
import sys
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
import ctypes
from ctypes import wintypes

try:
    from tkinter import Tk, Canvas
    from tkinter.font import Font, families
except ImportError:
    Tk = None  # type: ignore

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = ImageDraw = ImageFont = None  # type: ignore

try:    
    import winreg
except ImportError:
    winreg = None  # type: ignore

try:
    from fontTools.ttLib import TTFont, TTCollection
except ImportError:
    TTFont = None  # type: ignore
    TTCollection = None  # type: ignore

try:
    from font_name_resolver import FontNameResolver, parse_style_flags
except ImportError:
    FontNameResolver = None  # type: ignore
    parse_style_flags = None  # type: ignore

try:
    from font_matcher import should_treat_as_substitution
except ImportError:
    should_treat_as_substitution = None  # type: ignore

# Temporarily disable new modules - they have ctypes issues
# TODO: Fix and re-enable later
FontEnumerator = None
GDIRenderer = None


FALLBACK_FONT = "Arial"

gdi32 = ctypes.windll.gdi32  # type: ignore[attr-defined]
user32 = ctypes.windll.user32  # type: ignore[attr-defined]

LF_FACESIZE = 32
FW_NORMAL = 400
DEFAULT_CHARSET = 1
OUT_DEFAULT_PRECIS = 0
CLIP_DEFAULT_PRECIS = 0
ANTIALIASED_QUALITY = 4
DEFAULT_PITCH = 0
TRANSPARENT = 1
DT_NOPREFIX = 0x00000800
DT_WORDBREAK = 0x00000010
DT_CALCRECT = 0x00000400
DT_SINGLELINE = 0x00000020


class LOGFONTW(ctypes.Structure):
    _fields_ = [
        ("lfHeight", wintypes.LONG),
        ("lfWidth", wintypes.LONG),
        ("lfEscapement", wintypes.LONG),
        ("lfOrientation", wintypes.LONG),
        ("lfWeight", wintypes.LONG),
        ("lfItalic", wintypes.BYTE),
        ("lfUnderline", wintypes.BYTE),
        ("lfStrikeOut", wintypes.BYTE),
        ("lfCharSet", wintypes.BYTE),
        ("lfOutPrecision", wintypes.BYTE),
        ("lfClipPrecision", wintypes.BYTE),
        ("lfQuality", wintypes.BYTE),
        ("lfPitchAndFamily", wintypes.BYTE),
        ("lfFaceName", wintypes.WCHAR * LF_FACESIZE)
    ]


class RECT(ctypes.Structure):
    _fields_ = [('left', wintypes.LONG), ('top', wintypes.LONG), ('right', wintypes.LONG), ('bottom', wintypes.LONG)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD)
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 1)]


DIB_RGB_COLORS = 0

if not hasattr(wintypes, 'HGDIOBJ'):
    wintypes.HGDIOBJ = wintypes.HANDLE

gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
gdi32.CreateCompatibleDC.restype = wintypes.HDC
gdi32.CreateFontIndirectW.argtypes = [ctypes.POINTER(LOGFONTW)]
gdi32.CreateFontIndirectW.restype = wintypes.HFONT
gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
gdi32.SelectObject.restype = wintypes.HGDIOBJ
gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
gdi32.DeleteObject.restype = wintypes.BOOL
gdi32.DeleteDC.argtypes = [wintypes.HDC]
gdi32.DeleteDC.restype = wintypes.BOOL
gdi32.SetBkMode.argtypes = [wintypes.HDC, wintypes.INT]
gdi32.SetBkMode.restype = wintypes.INT
gdi32.SetTextColor.argtypes = [wintypes.HDC, wintypes.COLORREF]
gdi32.SetTextColor.restype = wintypes.COLORREF
gdi32.CreateDIBSection.argtypes = [wintypes.HDC, ctypes.POINTER(BITMAPINFO), wintypes.UINT, ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD]
gdi32.CreateDIBSection.restype = wintypes.HBITMAP
gdi32.GetTextFaceW.argtypes = [wintypes.HDC, ctypes.c_int, wintypes.LPWSTR]
gdi32.GetTextFaceW.restype = ctypes.c_int
user32.DrawTextW.argtypes = [wintypes.HDC, wintypes.LPCWSTR, ctypes.c_int, ctypes.POINTER(RECT), wintypes.UINT]
user32.DrawTextW.restype = ctypes.c_int


def debug(msg):
    print(f"[font_server] {msg}")


def normalize(name: str) -> str:
    if not name and name != 0:
        return ''
    lowered = name.lower().replace('\u3000', ' ').strip()
    lowered = lowered.lstrip('@')  # vertical writing indicator
    return ''.join(ch for ch in lowered if ch.isalnum())


class FontRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache = {}
        self._aliases = {}
        self._families = []
        self._root = None
        self._load()

    @property
    def families(self):
        return list(self._families)

    def _load(self) -> None:
        # Try to use FontEnumerator (EnumFontFamiliesExW) first - more accurate
        if FontEnumerator is not None:
            try:
                enumerator = FontEnumerator()
                gdi_families = enumerator.enumerate_all_fonts()
                
                # Also get Tkinter families for comparison
                if Tk is not None:
                    self._root = Tk()
                    self._root.withdraw()
                    tkinter_families = sorted(set(families()))
                    
                    # Compare for debugging
                    gdi_set = set(gdi_families)
                    tk_set = set(f for f in tkinter_families if not f.startswith('@'))
                    if gdi_set != tk_set:
                        debug(f"Font enumeration comparison: GDI={len(gdi_set)}, Tkinter={len(tk_set)}")
                        only_gdi = gdi_set - tk_set
                        only_tk = tk_set - gdi_set
                        if only_gdi:
                            debug(f"  Only in GDI: {list(only_gdi)[:5]}...")
                        if only_tk:
                            debug(f"  Only in Tkinter: {list(only_tk)[:5]}...")
                
                # Use GDI enumeration result (more accurate)
                self._families = gdi_families
                for family in self._families:
                    self._remember_alias(family)
                
                debug(f"Loaded {len(self._families)} font families from EnumFontFamiliesExW")
            except Exception as e:
                debug(f"FontEnumerator failed: {e}, falling back to Tkinter")
                self._load_with_tkinter()
        else:
            # Fallback to Tkinter if FontEnumerator not available
            self._load_with_tkinter()

        if winreg is not None:
            self._load_from_registry()
        self._scan_font_directories()
        
        # Debug: Print all recognized fonts with paths
        self._print_font_debug_info()
    
    def _load_with_tkinter(self):
        """Fallback method using Tkinter"""
        if Tk is None:
            debug('Tkinter not available; font registry disabled.')
            return

        self._root = Tk()
        self._root.withdraw()
        all_families = sorted(set(families()))
        filtered = []
        for family in all_families:
            if family.startswith('@'):
                continue
            filtered.append(family)
            self._remember_alias(family)
        self._families = filtered
        debug(f"Loaded {len(self._families)} font families from Tkinter")

    def _load_from_registry(self):
        try:
            fonts_dir = os.environ.get('WINDIR', 'C:\\Windows')
            fonts_dir = os.path.join(fonts_dir, 'Fonts')
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts") as reg_key:
                for i in range(winreg.QueryInfoKey(reg_key)[1]):
                    try:
                        font_name, font_value, _ = winreg.EnumValue(reg_key, i)
                        font_path = font_value
                        if not os.path.isabs(font_path):
                            font_path = os.path.join(fonts_dir, font_path)
                        if os.path.exists(font_path):
                            norm_key = normalize(font_name)
                            self._cache.setdefault(norm_key, font_path)
                            self._remember_alias(font_name)
                    except OSError:
                        continue
        except OSError as exc:
            debug(f'Failed to read registry fonts: {exc}')

    def _scan_font_directories(self):
        if TTFont is None:
            debug('fontTools not available; skipping directory scan.')
            return

        search_dirs = [
            Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts',
            Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'Windows' / 'Fonts',
            Path(os.environ.get('LOCALAPPDATA', '')) / 'SandollCloud' / 'fonts',
            Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'SandollCloud' / 'fonts',
            Path(os.environ.get('APPDATA', '')) / 'SandollCloud' / 'fonts',
            Path.home() / 'AppData' / 'LocalLow' / 'SandollCloud' / 'fonts'
        ]

        # Track fontTools scan results
        self._fonttools_scan_results = []

        visited = set()
        for directory in search_dirs:
            if not directory or not directory.exists():
                continue
            try:
                for font_path in iter_font_files(directory):
                    font_path = font_path.resolve()
                    if font_path in visited:
                        continue
                    visited.add(font_path)
                    try:
                        all_names = extract_font_names(font_path)
                        
                        # Store scan results for debug output
                        self._fonttools_scan_results.append({
                            'path': str(font_path),
                            'names': sorted(all_names)
                        })
                        
                        for name in all_names:
                            key = normalize(name)
                            if key:
                                self._remember_alias(name)
                                # Store path for all name variants (English + Korean + etc.)
                                if key not in self._cache:
                                    self._cache[key] = str(font_path)
                        
                        # Additional: Store path without language-specific chars for broader matching
                        # This helps match "210 수퍼사이즈" to "210 Supersize"
                        if all_names:
                            for name in all_names:
                                # Create a simplified key without any language-specific chars
                                simple_key = ''.join(c.lower() for c in name if c.isalnum() and ord(c) < 128)
                                if simple_key and simple_key not in self._cache:
                                    self._cache[simple_key] = str(font_path)
                    except Exception as exc:
                        debug(f'Error reading font {font_path}: {exc}')
                        continue
            except OSError as exc:
                debug(f'Error scanning {directory}: {exc}')

    def resolve_path(self, font_name: str):
        key = normalize(font_name)
        return self._cache.get(key)

    def aliases_for(self, font_name: str):
        key = normalize(font_name)
        aliases = self._aliases.get(key, set())
        if aliases:
            return sorted(aliases)
        return [font_name]

    def _remember_alias(self, name: str):
        key = normalize(name)
        if not key:
            return
        self._aliases.setdefault(key, set()).add(name)
    
    def _print_font_debug_info(self):
        """서버 시작 시 모든 폰트 정보를 파일로 저장"""
        from datetime import datetime
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        debug_dir = Path('font_debug')
        debug_dir.mkdir(exist_ok=True)
        
        # 1. Tkinter families with all name variants (English + Korean + etc.)
        tkinter_file = debug_dir / f'1_tkinter_families_with_names_{timestamp}.txt'
        with open(tkinter_file, 'w', encoding='utf-8') as f:
            f.write(f"Tkinter Font Families - ALL NAME VARIANTS ({len(self._families)} total)\n")
            f.write("=" * 80 + "\n\n")
            
            for i, family in enumerate(sorted(self._families), 1):
                f.write(f"{i:4d}. {family}\n")
                
                # Get aliases (other names for the same font)
                aliases = self.aliases_for(family)
                if len(aliases) > 1:
                    f.write(f"      Aliases: {', '.join(a for a in aliases if a != family)}\n")
                
                # Try to find the font file and extract all names
                path = self.resolve_path(family)
                if path:
                    f.write(f"      File: {path}\n")
                    try:
                        # Extract all names from the font file
                        all_names = extract_font_names(Path(path))
                        if all_names:
                            # Show English and Korean names
                            eng_names = [n for n in all_names if all(ord(c) < 128 or not c.isalpha() for c in n)]
                            kor_names = [n for n in all_names if any(ord(c) >= 0xAC00 and ord(c) <= 0xD7A3 for c in n)]
                            
                            if eng_names:
                                f.write(f"      English names: {', '.join(sorted(set(eng_names))[:3])}\n")
                            if kor_names:
                                f.write(f"      Korean names: {', '.join(sorted(set(kor_names))[:3])}\n")
                    except Exception as e:
                        f.write(f"      (Could not read names: {e})\n")
                else:
                    f.write(f"      (No file path found)\n")
                
                f.write("\n")
        
        # 2. fontTools scan results (English + Korean + all names extracted from font files)
        fonttools_file = debug_dir / f'2_fonttools_scan_{timestamp}.txt'
        with open(fonttools_file, 'w', encoding='utf-8') as f:
            f.write("fontTools Scan Results - ALL FONT NAMES (English + Korean + etc.)\n")
            f.write("=" * 80 + "\n\n")
            f.write(f"Total font files scanned: {len(getattr(self, '_fonttools_scan_results', []))}\n\n")
            
            for result in getattr(self, '_fonttools_scan_results', []):
                f.write(f"File: {result['path']}\n")
                f.write(f"Names found ({len(result['names'])}):\n")
                for name in result['names']:
                    f.write(f"  - {name}\n")
                f.write("\n")
        
        # 3. All cache entries (normalized key -> path)
        cache_file = debug_dir / f'3_cache_mapping_{timestamp}.json'
        with open(cache_file, 'w', encoding='utf-8') as f:
            # Sort by key for readability
            sorted_cache = dict(sorted(self._cache.items()))
            json.dump(sorted_cache, f, ensure_ascii=False, indent=2)
        
        # 4. Aliases mapping
        aliases_file = debug_dir / f'4_aliases_{timestamp}.json'
        with open(aliases_file, 'w', encoding='utf-8') as f:
            sorted_aliases = {}
            for key in sorted(self._aliases.keys()):
                sorted_aliases[key] = sorted(list(self._aliases[key]))
            json.dump(sorted_aliases, f, ensure_ascii=False, indent=2)
        
        # 5. Final mapping: family -> path
        final_mapping_file = debug_dir / f'5_final_family_to_path_{timestamp}.txt'
        with open(final_mapping_file, 'w', encoding='utf-8') as f:
            f.write("Final Font Family to Path Mapping\n")
            f.write("=" * 80 + "\n\n")
            
            with_path = 0
            without_path = 0
            
            for family in sorted(self._families):
                path = self.resolve_path(family)
                if path:
                    with_path += 1
                    f.write(f"✓ {family}\n")
                    f.write(f"  → {path}\n\n")
                else:
                    without_path += 1
                    f.write(f"✗ {family}\n")
                    f.write(f"  → (No path found)\n\n")
            
            f.write("\n" + "=" * 80 + "\n")
            f.write(f"Summary: {with_path} fonts with paths, {without_path} without paths\n")
        
        debug(f"Font debug info saved to {debug_dir}/ directory")
        debug(f"  - {tkinter_file.name}")
        debug(f"  - {cache_file.name}")
        debug(f"  - {aliases_file.name}")
        debug(f"  - {final_mapping_file.name}")


def iter_font_files(directory: Path):
    patterns = ['**/*.ttf', '**/*.otf', '**/*.ttc', '**/*.otc']
    for pattern in patterns:
        for font_path in directory.glob(pattern):
            yield font_path


def extract_font_names(font_path: Path):
    names = set()
    if TTFont is None:
        return names
    suffix = font_path.suffix.lower()
    try:
        if suffix in {'.ttc', '.otc'} and TTCollection is not None:
            collection = TTCollection(font_path, lazy=True)
            fonts = collection.fonts
        else:
            fonts = [TTFont(font_path, lazy=True)]
        for font in fonts:
            try:
                name_table = font['name']
            except KeyError:
                continue
            for record in name_table.names:
                try:
                    value = record.toUnicode()
                except Exception:
                    try:
                        value = record.string.decode('utf-16-be')
                    except Exception:
                        value = record.string.decode(errors='ignore')
                if value:
                    names.add(value)
    except Exception as exc:
        debug(f'Failed to parse names from {font_path}: {exc}')
    return names


def layout_text_lines_pil(text: str, font, max_width: int, fallback_size: int):
    content = text or ' '
    max_width = int(max_width or 0)
    if Image is None or ImageDraw is None or font is None:
        lines = content.split('\n')
        lines = [line if line else ' ' for line in lines] or [' ']
        line_height = max(1, int(math.ceil(fallback_size * 1.3)))
        canvas_width = max(max_width, max(len(line) for line in lines) * max(fallback_size // 2, 1), 1)
        canvas_height = line_height * len(lines) + max(2, int(line_height * 0.1))
        return lines, canvas_width, canvas_height, line_height, 0
    dummy = Image.new('RGB', (10, 10))
    draw = ImageDraw.Draw(dummy)
    lines = ['']
    for ch in content:
        if ch == '\r':
            continue
        if ch == '\n':
            lines.append('')
            continue
        current = lines[-1]
        candidate = current + ch
        width_candidate = draw.textlength(candidate, font=font)
        if max_width > 0 and width_candidate > max_width and current:
            lines.append(ch)
        else:
            lines[-1] = candidate
    lines = [line if line else ' ' for line in lines] or [' ']
    measured_width = 0
    for line in lines:
        measured_width = max(measured_width, draw.textlength(line, font=font))
    canvas_width = max(measured_width, max_width) if max_width > 0 else max(measured_width, 1)
    try:
        ascent, descent = font.getmetrics()
        metrics_height = ascent + descent
    except Exception:
        metrics_height = fallback_size
    line_height = max(1, int(math.ceil(metrics_height * 1.3)))
    sample = lines[0] if lines and lines[0].strip() else 'Ag'
    try:
        bbox = draw.textbbox((0, 0), sample, font=font)
        top_offset = max(0, -(bbox[1] if bbox else 0))
    except Exception:
        top_offset = 0
    bottom_padding = max(2, int(math.ceil(line_height * 0.1)))
    canvas_height = top_offset + line_height * len(lines) + bottom_padding
    return lines, canvas_width, canvas_height, line_height, top_offset


def render_with_gdi(font_name: str, text: str, size: int, target_width: int = 0,
                    postscript_name: str = None, style: str = None):
    """
    GDI를 사용해 폰트를 렌더링합니다.
    
    Returns:
        Tuple[Optional[str], bool]: (이미지 데이터, substitution 발생 여부)
        - 성공 시: (data:image/png;base64,..., False/True)
        - 실패 시: (None, False)
    """
    if Image is None:
        debug("[GDI] PIL not available")
        return (None, False)

    target_width = int(target_width or 0)
    
    # Resolve font name using the resolver
    if FontNameResolver:
        resolver = FontNameResolver()
        resolved = resolver.resolve(
            display_name=font_name,
            postscript_name=postscript_name,
            style=style
        )
        face_name = resolved['faceName']
        font_weight = resolved['weight']
        font_italic = resolved['italic']
        debug(f"[GDI] Resolved: '{font_name}' → faceName='{face_name}', weight={font_weight}, italic={font_italic}, source={resolved['source']}")
    else:
        # Fallback if resolver not available
        face_name = postscript_name if postscript_name else font_name
        font_weight = FW_NORMAL
        font_italic = 0
        debug(f"[GDI] No resolver, using face_name='{face_name}'")
    
    # GDI rendering
    hdc = gdi32.CreateCompatibleDC(0)
    if not hdc:
        debug("[GDI] CreateCompatibleDC failed")
        return None

    hfont = None
    hbitmap = None
    old_font = old_bitmap = None

    try:
        debug(f"[GDI] Creating LOGFONT: faceName='{face_name}', size={size}, weight={font_weight}, italic={font_italic}")
        
        logfont = LOGFONTW()
        logfont.lfHeight = -abs(int(size))
        logfont.lfWeight = font_weight
        logfont.lfCharSet = DEFAULT_CHARSET
        logfont.lfOutPrecision = OUT_DEFAULT_PRECIS
        logfont.lfClipPrecision = CLIP_DEFAULT_PRECIS
        logfont.lfQuality = ANTIALIASED_QUALITY
        logfont.lfPitchAndFamily = DEFAULT_PITCH
        logfont.lfItalic = font_italic
        logfont.lfFaceName = face_name[:LF_FACESIZE - 1]

        hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        if not hfont:
            debug(f"[GDI] CreateFontIndirectW failed for '{face_name}'")
            return (None, False)

        old_font = gdi32.SelectObject(hdc, hfont)
        debug(f"[GDI] Font created and selected")
        
        # CHECK FOR FONT SUBSTITUTION using GetTextFaceW
        substitution_detected = False
        actual_face = ctypes.create_unicode_buffer(LF_FACESIZE)
        result = gdi32.GetTextFaceW(hdc, LF_FACESIZE, actual_face)
        
        if result > 0:
            actual_name = actual_face.value
            
            # Use smart font matching to detect real substitution
            if should_treat_as_substitution:
                # Check if this is real substitution or just name variant
                is_real_substitution = should_treat_as_substitution(face_name, actual_name)
                
                if is_real_substitution:
                    substitution_detected = True
                    debug(f"[GDI] ⚠ REAL substitution: requested '{face_name}' but got '{actual_name}'")
                    debug(f"[GDI]   → This is a different font, will consider PIL fallback")
                else:
                    # Same font family, just different name (e.g., English vs Korean)
                    debug(f"[GDI] ✓ Font OK: requested '{face_name}', got '{actual_name}' (same family)")
            else:
                # Fallback to simple comparison if font_matcher not available
                expected_norm = face_name.lower().strip()
                actual_norm = actual_name.lower().strip()
                
                if expected_norm != actual_norm:
                    substitution_detected = True
                    debug(f"[GDI] ⚠ Font name mismatch: requested '{face_name}' but got '{actual_name}'")
                else:
                    debug(f"[GDI] ✓ Font verified: '{actual_name}' matches request")
        else:
            debug("[GDI] Warning: GetTextFaceW failed, proceeding anyway")

        # Measure text
        calc_rect = RECT(0, 0, target_width if target_width > 0 else 0, 0)
        calc_flags = DT_NOPREFIX | DT_CALCRECT
        if target_width > 0:
            calc_flags |= DT_WORDBREAK
        else:
            calc_flags |= DT_SINGLELINE
        
        if user32.DrawTextW(hdc, text or ' ', -1, ctypes.byref(calc_rect), calc_flags) == 0:
            debug("[GDI] DrawTextW measurement failed")
            return (None, False)

        measured_width = max(calc_rect.right - calc_rect.left, 1)
        measured_height = max(calc_rect.bottom - calc_rect.top, size)
        
        final_width = target_width if target_width > 0 else measured_width
        final_width = max(final_width, measured_width, 1)
        final_height = measured_height
        
        debug(f"[GDI] Text measured: {measured_width}x{measured_height}, final canvas: {final_width}x{final_height}")

        # Create DIB section
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = final_width
        bmi.bmiHeader.biHeight = -final_height  # top-down DIB
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0  # BI_RGB

        bits = ctypes.c_void_p()
        hbitmap = gdi32.CreateDIBSection(hdc, ctypes.byref(bmi), DIB_RGB_COLORS, ctypes.byref(bits), None, 0)
        if not hbitmap:
            debug("[GDI] CreateDIBSection failed")
            return (None, False)

        old_bitmap = gdi32.SelectObject(hdc, hbitmap)
        gdi32.SetBkMode(hdc, 1)  # TRANSPARENT
        gdi32.SetTextColor(hdc, 0x00FFFFFF)  # white text

        # Draw text
        draw_rect = RECT(0, 0, final_width, final_height)
        draw_flags = DT_NOPREFIX
        if target_width > 0:
            draw_flags |= DT_WORDBREAK
        else:
            draw_flags |= DT_SINGLELINE
        
        if user32.DrawTextW(hdc, text or ' ', -1, ctypes.byref(draw_rect), draw_flags) == 0:
            debug("[GDI] DrawTextW drawing failed")
            return (None, False)

        debug("[GDI] Text drawn successfully")

        # Convert to PIL image
        buffer = ctypes.string_at(bits, final_width * final_height * 4)
        image = Image.frombuffer('RGBA', (final_width, final_height), buffer, 'raw', 'BGRA', 0, 1).copy()
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        # Convert white text to alpha channel
        pixels = image.load()
        for y in range(final_height):
            for x in range(final_width):
                r, g, b, a = pixels[x, y]
                if r or g or b:
                    alpha = max(r, g, b)
                    pixels[x, y] = (255, 255, 255, alpha)
                else:
                    pixels[x, y] = (0, 0, 0, 0)

        output = io.BytesIO()
        image.save(output, format='PNG')
        encoded = base64.b64encode(output.getvalue()).decode('utf-8')
        
        if substitution_detected:
            debug(f"[GDI] ✓ Rendered with substituted font (may not be accurate)")
        else:
            debug(f"[GDI] ✓ Rendering successful for '{face_name}'")
        
        return (f'data:image/png;base64,{encoded}', substitution_detected)
    except Exception as e:
        debug(f"[GDI] Exception: {type(e).__name__}: {e}")
        import traceback
        debug(f"[GDI] Traceback:\n{traceback.format_exc()}")
        return (None, False)
    finally:
        if old_font:
            gdi32.SelectObject(hdc, old_font)
        if old_bitmap:
            gdi32.SelectObject(hdc, old_bitmap)
        if hfont:
            gdi32.DeleteObject(hfont)
        if hbitmap:
            gdi32.DeleteObject(hbitmap)
        if hdc:
            gdi32.DeleteDC(hdc)


REGISTRY = FontRegistry()


class FontServerHandler(BaseHTTPRequestHandler):
    server_version = 'FontServer/0.1'

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        # silence default HTTP logging
        return

    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_GET(self):  # noqa: N802
        debug(f'GET {self.path}')
        if self.path == '/ping':
            self._send_json({'status': 'ok'})
            return

        if self.path == '/fonts':
            self._handle_fonts()
            return

        if self.path.startswith('/preview/'):
            self._handle_preview()
            return

        self.send_error(404)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):  # noqa: N802
        debug(f'POST {self.path}')
        if self.path == '/batch-preview':
            self._handle_batch_preview()
            return

        self.send_error(404)

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def _handle_fonts(self):
        fonts = []
        for family in REGISTRY.families:
            meta = {
                'name': family,
                'family': family,
                'style': 'Regular',
                'paths': [REGISTRY.resolve_path(family)] if REGISTRY.resolve_path(family) else [],
                'forceBitmap': False,
                'aliases': REGISTRY.aliases_for(family)
            }
            fonts.append(meta)

        payload = {
            'fonts': fonts,
            'count': len(fonts)
        }
        self._send_json(payload)

    def _handle_preview(self):
        font_name = self.path.replace('/preview/', '', 1)
        text = self._get_query_param('text') or 'Sample'
        try:
            size = int(round(float(self._get_query_param('size') or '24')))
        except (TypeError, ValueError):
            size = 24
        size = max(8, min(size, 160))
        try:
            width_param = self._get_query_param('width')
            viewport_width = int(round(float(width_param))) if width_param else 0
        except (TypeError, ValueError):
            viewport_width = 0
        image = self._render_font_image(font_name, text, size, viewport_width)
        self._send_json({'fontName': font_name, 'image': image, 'requestId': None})

    def _handle_batch_preview(self):
        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            self.send_error(400, 'Invalid JSON body')
            return

        fonts = body.get('fonts', [])
        text = body.get('text', 'Sample')
        try:
            size = int(round(float(body.get('size', 24))))
        except (TypeError, ValueError):
            size = 24
        size = max(8, min(size, 160))

        previews = []
        for entry in fonts:
            if isinstance(entry, dict):
                font_name = entry.get('name') or entry.get('fontName') or entry.get('font')
                viewport_width = entry.get('width') or entry.get('maxWidth') or 0
                request_id = entry.get('requestId')
                postscript_name = entry.get('postScriptName') or entry.get('postscript')  # Extract PostScript name
                style = entry.get('style')  # Extract style
            else:
                font_name = str(entry)
                viewport_width = 0
                request_id = None
                postscript_name = None
                style = None
            if not font_name:
                continue
            try:
                viewport_width = int(round(float(viewport_width))) if viewport_width else 0
            except (TypeError, ValueError):
                viewport_width = 0
            request_id = str(request_id) if request_id is not None else None
            debug(f'Requested preview: {font_name} (PS: {postscript_name}, Style: {style}, size={size}, width={viewport_width})')
            try:
                image = self._render_font_image(font_name, text, size, viewport_width, postscript_name, style)
            except Exception as exc:  # noqa: BLE001
                debug(f'Error rendering {font_name}: {exc}')
                fallback_width = viewport_width or 320
                image = self._render_fallback(text, fallback_width, size)
            previews.append({'fontName': font_name, 'image': image, 'requestId': request_id})

        self._send_json({'previews': previews})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_query_param(self, key: str):
        from urllib.parse import parse_qs, urlsplit

        parts = urlsplit(self.path)
        params = parse_qs(parts.query)
        values = params.get(key)
        return values[0] if values else None

    def _render_font_image(self, font_name: str, text: str, size: int, viewport_width: int = 0,
                           postscript_name: str = None, style: str = None):
        """
        폰트 이미지를 렌더링합니다.
        
        렌더링 전략:
        1. GDI 렌더링 시도 (빠르고 OS 기본 품질)
        2. Font substitution 감지 시 PIL로 폴백
        3. 폰트 파일이 있으면 PIL로 직접 렌더링
        4. 모든 것이 실패하면 기본 폴백 이미지
        """
        text_value = text or ' '
        requested_width = int(viewport_width or 0)
        effective_size = max(8, min(int(round(size * 1.1)), 220))

        if Image is None or ImageFont is None:
            debug('Pillow not available; relying on GDI only.')
            gdi_image = render_with_gdi(font_name, text_value, effective_size, requested_width, 
                                       postscript_name, style)
            if gdi_image:
                return gdi_image
            return self._render_fallback(text_value, requested_width, effective_size)

        # Strategy: Try GDI first, fallback to PIL if substitution detected or GDI fails
        font_path = REGISTRY.resolve_path(font_name)
        debug(f'Font path for {font_name}: {font_path}')
        
        # Try GDI first (fastest, best quality for most fonts)
        gd_result, substituted = render_with_gdi(font_name, text_value, effective_size, requested_width,
                                                  postscript_name, style)
        
        # If GDI succeeded and no substitution: use it
        if gd_result and not substituted:
            return gd_result
        
        # If GDI succeeded but substitution occurred: try PIL if we have the font file
        if gd_result and substituted and font_path:
            debug(f'GDI used substituted font for {font_name}, trying PIL with actual font file')
            # Continue to PIL fallback below
        elif gd_result and substituted and not font_path:
            # Substitution but no font file:  just use GDI result
            debug(f'GDI substitution detected but no font file available, using GDI result')
            return gd_result
        elif not gd_result:
            # GDI completely failed
            debug(f'GDI rendering failed for {font_name}, trying PIL fallback')
        
        # PIL fallback - try to load font file directly
        pil_font = None
        if font_path:
            try:
                pil_font = ImageFont.truetype(font_path, effective_size)
                debug(f'✓ PIL loaded font from: {font_path}')
            except Exception as e:
                debug(f'Failed to load font file {font_path}: {e}')
        
        # If no font path or loading failed, try default font
        if pil_font is None:
            try:
                pil_font = ImageFont.truetype(FALLBACK_FONT, effective_size)
                debug(f'Using fallback font: {FALLBACK_FONT}')
            except Exception:
                pil_font = ImageFont.load_default()
                debug('Using PIL default font')

        # Render with PIL
        lines, canvas_width, canvas_height, line_height, top_offset = layout_text_lines_pil(
            text_value, pil_font, requested_width, effective_size
        )
        canvas_width = max(1, int(canvas_width))
        canvas_height = max(1, int(canvas_height))

        img = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        y = top_offset
        for line in lines:
            draw.text((0, y), line, font=pil_font, fill=(255, 255, 255, 255))
            y += line_height

        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        encoded = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return f'data:image/png;base64,{encoded}'

    def _render_fallback(self, text: str, width: int, size: int):
        try:
            if Image is None:
                raise RuntimeError('Pillow unavailable')
            lines, canvas_width, canvas_height, line_height, top_offset = layout_text_lines_pil(
                text or ' ', None, width, size
            )
            fallback_width = max(1, int(canvas_width))
            fallback_height = max(1, int(canvas_height))
            img = Image.new('RGBA', (fallback_width, fallback_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            y = top_offset
            for line in lines:
                draw.text((0, y), line, fill=(255, 255, 255, 255))
                y += line_height
            buffer = io.BytesIO()
            img.save(buffer, format='PNG')
            encoded = base64.b64encode(buffer.getvalue()).decode('utf-8')
            return f'data:image/png;base64,{encoded}'
        except Exception:
            placeholder_png = (
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
            )
            return f'data:image/png;base64,{placeholder_png}'

    def _send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(data)


def run_server(port: int = 8765):
    server = HTTPServer(('127.0.0.1', port), FontServerHandler)
    debug(f'Starting font server on port {port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        debug('Shutting down font server.')
        server.server_close()


if __name__ == '__main__':
    if os.name != 'nt':
        debug('Windows-only prototype. Exiting.')
        sys.exit(0)

    if Tk is None:
        debug('Tkinter is required but not available. Exiting.')
        sys.exit(1)

    run_server()
