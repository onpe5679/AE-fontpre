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
    from font_enumerator import FontEnumerator
except ImportError:
    FontEnumerator = None  # type: ignore

try:
    from gdi_renderer import GDIRenderer
except ImportError:
    GDIRenderer = None  # type: ignore


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
                        for name in extract_font_names(font_path):
                            key = normalize(name)
                            if key:
                                self._remember_alias(name)
                                if key not in self._cache:
                                    self._cache[key] = str(font_path)
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
    Font substitution 발생 시 None을 반환하여 PIL 폴백을 트리거합니다.
    """
    if Image is None or GDIRenderer is None:
        return None

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
        debug(f"Resolved '{font_name}' (PS: {postscript_name}, Style: {style}) → '{face_name}' (weight={font_weight}, italic={font_italic}, source={resolved['source']})")
    else:
        # Fallback if resolver not available
        face_name = postscript_name if postscript_name else font_name
        font_weight = FW_NORMAL
        font_italic = 0
        debug(f"Resolver unavailable, using '{face_name}' as-is")
    
    # Use new GDIRenderer with substitution detection
    renderer = GDIRenderer(debug_callback=debug)
    image_data, substitution_detected = renderer.render(
        face_name=face_name,
        text=text,
        size=size,
        weight=font_weight,
        italic=font_italic,
        target_width=target_width
    )
    
    if substitution_detected:
        debug(f"Font substitution detected for '{face_name}', will fallback to PIL")
        return None  # Signal caller to use PIL fallback
    
    return image_data


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
        try:
            gdi_image = render_with_gdi(font_name, text_value, effective_size, requested_width,
                                       postscript_name, style)
            if gdi_image:
                # GDI succeeded without substitution
                return gdi_image
            else:
                # GDI returned None - substitution detected or font not found
                debug(f'GDI rendering failed/substituted for {font_name}, trying PIL fallback')
        except Exception as gdi_error:
            debug(f'GDI error for {font_name}: {gdi_error}, trying PIL fallback')
        
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
