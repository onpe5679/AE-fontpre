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
        self._families = []
        self._root = None
        self._load()

    @property
    def families(self):
        return list(self._families)

    def _load(self) -> None:
        if Tk is None:
            debug('Tkinter not available; font registry disabled.')
            return

        self._root = Tk()
        self._root.withdraw()
        all_families = sorted(set(families()))
        self._families = [family for family in all_families if not family.startswith('@')]
        debug(f"Loaded {len(self._families)} font families from Tkinter")

        if winreg is not None:
            self._load_from_registry()
        self._scan_font_directories()

    def _load_from_registry(self):
        try:
            fonts_dir = os.environ.get('WINDIR', 'C:\\Windows')
            fonts_dir = os.path.join(fonts_dir, 'Fonts')
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts") as key:
                for i in range(winreg.QueryInfoKey(key)[1]):
                    try:
                        font_name, font_value, _ = winreg.EnumValue(key, i)
                        font_path = font_value
                        if not os.path.isabs(font_path):
                            font_path = os.path.join(fonts_dir, font_path)
                        if os.path.exists(font_path):
                            self._cache.setdefault(normalize(font_name), font_path)
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
                            if key and key not in self._cache:
                                self._cache[key] = str(font_path)
                    except Exception as exc:
                        debug(f'Error reading font {font_path}: {exc}')
                        continue
            except OSError as exc:
                debug(f'Error scanning {directory}: {exc}')

    def resolve_path(self, font_name: str):
        key = normalize(font_name)
        return self._cache.get(key)


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


def render_with_gdi(font_name: str, text: str, size: int):
    if Image is None:
        return None

    hdc = gdi32.CreateCompatibleDC(0)
    if not hdc:
        raise RuntimeError('CreateCompatibleDC failed')

    hfont = None
    hbitmap = None
    old_font = old_bitmap = None

    try:
        logfont = LOGFONTW()
        logfont.lfHeight = -abs(int(size))
        logfont.lfWeight = FW_NORMAL
        logfont.lfCharSet = DEFAULT_CHARSET
        logfont.lfOutPrecision = OUT_DEFAULT_PRECIS
        logfont.lfClipPrecision = CLIP_DEFAULT_PRECIS
        logfont.lfQuality = ANTIALIASED_QUALITY
        logfont.lfPitchAndFamily = DEFAULT_PITCH
        face = font_name[:LF_FACESIZE - 1]
        logfont.lfFaceName = face

        hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        if not hfont:
            raise RuntimeError('CreateFontIndirectW failed')

        old_font = gdi32.SelectObject(hdc, hfont)

        rect = RECT(0, 0, 0, 0)
        flags = DT_WORDBREAK | DT_NOPREFIX | DT_CALCRECT
        if user32.DrawTextW(hdc, text, -1, ctypes.byref(rect), flags) == 0:
            raise RuntimeError('DrawTextW failed during measurement')

        width = rect.right - rect.left
        height = rect.bottom - rect.top
        width = max(width + 24, 160)
        height = max(height + 24, int(size * 2))

        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = width
        bmi.bmiHeader.biHeight = -height  # top-down DIB
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0  # BI_RGB

        bits = ctypes.c_void_p()
        hbitmap = gdi32.CreateDIBSection(hdc, ctypes.byref(bmi), DIB_RGB_COLORS, ctypes.byref(bits), None, 0)
        if not hbitmap:
            raise RuntimeError('CreateDIBSection failed')

        old_bitmap = gdi32.SelectObject(hdc, hbitmap)
        gdi32.SetBkMode(hdc, 1)  # TRANSPARENT
        gdi32.SetTextColor(hdc, 0x00202020)

        draw_rect = RECT(12, 12, width - 12, height - 12)
        if user32.DrawTextW(hdc, text, -1, ctypes.byref(draw_rect), DT_WORDBREAK | DT_NOPREFIX) == 0:
            raise RuntimeError('DrawTextW failed during draw')

        buffer = ctypes.string_at(bits, width * height * 4)
        image = Image.frombuffer('RGBA', (width, height), buffer, 'raw', 'BGRA', 0, 1).copy()
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        pixels = image.load()
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                if r or g or b:
                    pixels[x, y] = (r, g, b, 255)
                else:
                    pixels[x, y] = (0, 0, 0, 0)

        output = io.BytesIO()
        image.save(output, format='PNG')
        return f'data:image/png;base64,{base64.b64encode(output.getvalue()).decode("utf-8")}'
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

    def _iter_font_files(self, directory: Path):
        patterns = ['**/*.ttf', '**/*.otf', '**/*.ttc', '**/*.otc']
        for pattern in patterns:
            for font_path in directory.glob(pattern):
                yield font_path

    def _extract_font_names(self, font_path: Path):
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
                name_table = font['name']
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
                'forceBitmap': False
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
        image = self._render_font_image(font_name, text, size)
        self._send_json({'fontName': font_name, 'image': image})

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
        for font_name in fonts:
            debug(f'Requested preview: {font_name} (size={size})')
            try:
                image = self._render_font_image(font_name, text, size)
            except Exception as exc:  # noqa: BLE001
                debug(f'Error rendering {font_name}: {exc}')
                image = self._render_fallback(text, 400, size * 3)
            previews.append({'fontName': font_name, 'image': image})

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

    def _render_font_image(self, font_name: str, text: str, size: int):
        width = max(300, int(len(text) * size / 1.2) + 32)
        height = max(size * 3, int(size * 2.5))

        if Image is None or ImageFont is None:
            debug('Pillow not available; returning fallback preview.')
            return self._render_fallback(text, width, height)

        font_path = REGISTRY.resolve_path(font_name)
        debug(f'Resolve path for {font_name}: {font_path}')
        if not font_path:
            try:
                gdi_image = render_with_gdi(font_name, text, size)
                if gdi_image:
                    return gdi_image
            except Exception as gdi_error:
                debug(f'GDI fallback failed for {font_name}: {gdi_error}')
        try:
            if font_path:
                pil_font = ImageFont.truetype(font_path, size)
            else:
                pil_font = ImageFont.truetype(FALLBACK_FONT, size)
        except Exception:
            try:
                gdi_image = render_with_gdi(font_name, text, size)
                if gdi_image:
                    return gdi_image
            except Exception as gdi_error:
                debug(f'GDI fallback (second attempt) failed for {font_name}: {gdi_error}')
            pil_font = ImageFont.load_default()

        img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        baseline = height // 2
        try:
            ascent, descent = pil_font.getmetrics()
            text_width = draw.textlength(text, font=pil_font)
            text_height = ascent + descent
        except Exception:
            text_width = len(text) * size
            text_height = size

        x = 16
        y = max(8, baseline - text_height // 2)
        draw.text((x, y), text, font=pil_font, fill=(32, 32, 32, 255))

        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        encoded = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return f'data:image/png;base64,{encoded}'

    def _render_fallback(self, text: str, width: int, height: int):
        try:
            if Image is None:
                raise RuntimeError('Pillow unavailable')
            fallback_width = max(300, int(len(text) * 16) + 32)
            fallback_height = max(60, height)
            img = Image.new('RGBA', (fallback_width, fallback_height), (255, 255, 255, 0))
            draw = ImageDraw.Draw(img)
            draw.text((16, fallback_height // 3), text, fill=(120, 120, 120, 255))
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
