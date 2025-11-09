#!/usr/bin/env python3
"""
GDI Renderer - Windows GDI를 사용한 폰트 렌더링

이 모듈은 Windows GDI API를 사용하여 폰트를 비트맵으로 렌더링합니다.
GetTextFaceW를 통해 font substitution을 감지하여 정확한 렌더링을 보장합니다.
"""

import ctypes
from ctypes import wintypes
import io
import base64
from typing import Iterable, Optional, Set, Tuple

try:
    from PIL import Image
except ImportError:
    Image = None


# GDI Constants
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
DIB_RGB_COLORS = 0


class LOGFONTW(ctypes.Structure):
    """Windows LOGFONTW structure"""
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
    """Windows RECT structure"""
    _fields_ = [
        ('left', wintypes.LONG),
        ('top', wintypes.LONG),
        ('right', wintypes.LONG),
        ('bottom', wintypes.LONG)
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    """Windows BITMAPINFOHEADER structure"""
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
    """Windows BITMAPINFO structure"""
    _fields_ = [
        ("bmiHeader", BITMAPINFOHEADER),
        ("bmiColors", wintypes.DWORD * 1)
    ]


def normalize_face_name(name: str) -> str:
    if not name:
        return ''
    return ''.join(ch.lower() for ch in str(name).strip() if ch.isalnum())


# Setup GDI32 and User32 function signatures
gdi32 = ctypes.windll.gdi32
user32 = ctypes.windll.user32

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
gdi32.CreateDIBSection.argtypes = [
    wintypes.HDC,
    ctypes.POINTER(BITMAPINFO),
    wintypes.UINT,
    ctypes.POINTER(ctypes.c_void_p),
    wintypes.HANDLE,
    wintypes.DWORD
]
gdi32.CreateDIBSection.restype = wintypes.HBITMAP
gdi32.GetTextFaceW.argtypes = [wintypes.HDC, ctypes.c_int, wintypes.LPWSTR]
gdi32.GetTextFaceW.restype = ctypes.c_int
user32.DrawTextW.argtypes = [
    wintypes.HDC,
    wintypes.LPCWSTR,
    ctypes.c_int,
    ctypes.POINTER(RECT),
    wintypes.UINT
]
user32.DrawTextW.restype = ctypes.c_int


class GDIRenderer:
    """
    Windows GDI를 사용한 폰트 렌더링 클래스
    
    Font substitution을 감지하여 잘못된 폰트가 사용되는 것을 방지합니다.
    """
    
    def __init__(self, debug_callback=None):
        """
        Args:
            debug_callback: 디버그 메시지를 출력할 콜백 함수
        """
        self.debug = debug_callback or (lambda msg: None)
        self.last_actual_face: str = ''
    
    def render(
        self,
        face_name: str,
        text: str,
        size: int,
        weight: int = FW_NORMAL,
        italic: int = 0,
        target_width: int = 0,
        alias_names: Optional[Iterable[str]] = None
    ) -> Tuple[Optional[str], bool]:
        """
        GDI를 사용하여 텍스트를 렌더링합니다.
        
        Args:
            face_name: GDI 폰트 페이스 이름
            text: 렌더링할 텍스트
            size: 폰트 크기 (포인트)
            weight: 폰트 굵기 (100-900)
            italic: 이탤릭 플래그 (0 또는 1)
            target_width: 목표 너비 (0이면 자동)
        
        Returns:
            Tuple[Optional[str], bool]: (base64 PNG 이미지, substitution 발생 여부)
                - 성공 시: (data:image/png;base64,..., False)
                - Substitution 발생 시: (None, True)
                - 실패 시: (None, False)
        """
        self.last_actual_face = ''

        if Image is None:
            self.debug("PIL not available for GDI rendering")
            return None, False
        
        hdc = gdi32.CreateCompatibleDC(0)
        if not hdc:
            self.debug("CreateCompatibleDC failed")
            return None, False
        
        hfont = None
        hbitmap = None
        old_font = old_bitmap = None
        
        try:
            alias_norms: Set[str] = {normalize_face_name(face_name)}
            if alias_names:
                for alias in alias_names:
                    norm_alias = normalize_face_name(alias)
                    if norm_alias:
                        alias_norms.add(norm_alias)

            # Create LOGFONT
            logfont = LOGFONTW()
            logfont.lfHeight = -abs(int(size))
            logfont.lfWeight = weight
            logfont.lfCharSet = DEFAULT_CHARSET
            logfont.lfOutPrecision = OUT_DEFAULT_PRECIS
            logfont.lfClipPrecision = CLIP_DEFAULT_PRECIS
            logfont.lfQuality = ANTIALIASED_QUALITY
            logfont.lfPitchAndFamily = DEFAULT_PITCH
            logfont.lfItalic = italic
            logfont.lfFaceName = face_name[:LF_FACESIZE - 1]
            
            # Create font with byref
            hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
            if not hfont:
                self.debug(f"CreateFontIndirectW failed for '{face_name}'")
                return None, False
            
            old_font = gdi32.SelectObject(hdc, hfont)
            
            # Check for font substitution using GetTextFaceW
            actual_face = ctypes.create_unicode_buffer(LF_FACESIZE)
            result = gdi32.GetTextFaceW(hdc, LF_FACESIZE, actual_face)
            
            substitution_detected = False

            if result > 0:
                actual_name = actual_face.value
                self.last_actual_face = actual_name
                actual_norm = normalize_face_name(actual_name)
                if actual_norm not in alias_norms:
                    substitution_detected = True
                    self.debug(
                        f"[GDI] Font substitution detected: requested '{face_name}' but got '{actual_name}'"
                    )
                else:
                    if actual_norm != normalize_face_name(face_name):
                        self.debug(
                            f"[GDI] Alias match: '{actual_name}' recognized as variant of '{face_name}'"
                        )
                    self.debug(f"[GDI] ✓ Font verified: '{actual_name}' (weight={weight}, italic={italic})")
            else:
                self.debug("[GDI] GetTextFaceW returned 0; proceeding without substitution check")

            if substitution_detected:
                return None, True

            # Measure text
            calc_rect = RECT(0, 0, target_width if target_width > 0 else 0, 0)
            calc_flags = DT_NOPREFIX | DT_CALCRECT
            if target_width > 0:
                calc_flags |= DT_WORDBREAK
            else:
                calc_flags |= DT_SINGLELINE
            
            if user32.DrawTextW(hdc, text or ' ', -1, ctypes.byref(calc_rect), calc_flags) == 0:
                self.debug("DrawTextW measurement failed")
                return None, False
            
            measured_width = max(calc_rect.right - calc_rect.left, 1)
            measured_height = max(calc_rect.bottom - calc_rect.top, size)
            
            final_width = target_width if target_width > 0 else measured_width
            final_width = max(final_width, measured_width, 1)
            final_height = measured_height
            
            # Create DIB section
            bmi = BITMAPINFO()
            bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bmi.bmiHeader.biWidth = final_width
            bmi.bmiHeader.biHeight = -final_height  # top-down DIB
            bmi.bmiHeader.biPlanes = 1
            bmi.bmiHeader.biBitCount = 32
            bmi.bmiHeader.biCompression = 0  # BI_RGB
            
            bits = ctypes.c_void_p()
            hbitmap = gdi32.CreateDIBSection(
                hdc, ctypes.byref(bmi), DIB_RGB_COLORS,
                ctypes.byref(bits), None, 0
            )
            if not hbitmap:
                self.debug("CreateDIBSection failed")
                return None, False
            
            old_bitmap = gdi32.SelectObject(hdc, hbitmap)
            
            # Set drawing mode
            gdi32.SetBkMode(hdc, TRANSPARENT)
            gdi32.SetTextColor(hdc, 0x00FFFFFF)  # white text
            
            # Draw text
            draw_rect = RECT(0, 0, final_width, final_height)
            draw_flags = DT_NOPREFIX
            if target_width > 0:
                draw_flags |= DT_WORDBREAK
            else:
                draw_flags |= DT_SINGLELINE
            
            if user32.DrawTextW(hdc, text or ' ', -1, ctypes.byref(draw_rect), draw_flags) == 0:
                self.debug("DrawTextW drawing failed")
                return None, False
            
            # Convert to PIL image
            buffer = ctypes.string_at(bits, final_width * final_height * 4)
            image = Image.frombuffer(
                'RGBA', (final_width, final_height),
                buffer, 'raw', 'BGRA', 0, 1
            ).copy()
            
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
            
            # Encode to base64
            output = io.BytesIO()
            image.save(output, format='PNG')
            encoded = base64.b64encode(output.getvalue()).decode('utf-8')
            return f'data:image/png;base64,{encoded}', False
            
        except Exception as e:
            self.debug(f"GDI rendering error: {e}")
            return None, False
        
        finally:
            # Cleanup
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


def render_with_gdi(
    face_name: str,
    text: str,
    size: int,
    weight: int = FW_NORMAL,
    italic: int = 0,
    target_width: int = 0,
    debug_callback=None
) -> Tuple[Optional[str], bool]:
    """
    GDI 렌더링 편의 함수
    
    Returns:
        Tuple[Optional[str], bool]: (이미지 데이터, substitution 발생 여부)
    """
    renderer = GDIRenderer(debug_callback)
    return renderer.render(face_name, text, size, weight, italic, target_width)
