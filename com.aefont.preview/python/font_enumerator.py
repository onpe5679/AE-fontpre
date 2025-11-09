#!/usr/bin/env python3
"""
Font Enumerator - EnumFontFamiliesExW를 직접 호출하여 시스템 폰트 열거

이 모듈은 Windows GDI API인 EnumFontFamiliesExW를 ctypes로 직접 호출하여
Tkinter와 동일한 방식으로 시스템 폰트를 열거합니다.
동적으로 로드된 폰트(FR_PRIVATE 포함)도 정확히 감지할 수 있습니다.
"""

import ctypes
from ctypes import wintypes
from typing import Dict, List, Set


# Constants
DEFAULT_CHARSET = 1
LF_FACESIZE = 32


class LOGFONTW(ctypes.Structure):
    """Windows LOGFONTW structure"""
    _fields_ = [
        ('lfHeight', wintypes.LONG),
        ('lfWidth', wintypes.LONG),
        ('lfEscapement', wintypes.LONG),
        ('lfOrientation', wintypes.LONG),
        ('lfWeight', wintypes.LONG),
        ('lfItalic', wintypes.BYTE),
        ('lfUnderline', wintypes.BYTE),
        ('lfStrikeOut', wintypes.BYTE),
        ('lfCharSet', wintypes.BYTE),
        ('lfOutPrecision', wintypes.BYTE),
        ('lfClipPrecision', wintypes.BYTE),
        ('lfQuality', wintypes.BYTE),
        ('lfPitchAndFamily', wintypes.BYTE),
        ('lfFaceName', wintypes.WCHAR * LF_FACESIZE)
    ]


# EnumFontFamiliesExW callback function type
FONTENUMPROC = ctypes.WINFUNCTYPE(
    ctypes.c_int,  # return type
    ctypes.POINTER(LOGFONTW),  # lpelfe
    wintypes.LPVOID,  # lpntme (not used)
    wintypes.DWORD,  # fonttype
    wintypes.LPARAM  # lparam (user data)
)


class FontEnumerator:
    """
    Windows GDI API를 사용하여 시스템 폰트를 열거하는 클래스
    
    Tkinter의 font.families()와 동일한 결과를 얻지만,
    더 정확한 폰트 메타데이터(weight, charset 등)도 함께 수집합니다.
    """
    
    def __init__(self):
        self.font_families: Dict[str, Dict] = {}
        self.gdi32 = ctypes.windll.gdi32
        self.user32 = ctypes.windll.user32
        
        # Setup function signatures
        self.gdi32.EnumFontFamiliesExW.argtypes = [
            wintypes.HDC,  # hdc
            ctypes.POINTER(LOGFONTW),  # lpLogfont
            FONTENUMPROC,  # lpProc
            wintypes.LPARAM,  # lParam
            wintypes.DWORD  # dwFlags
        ]
        self.gdi32.EnumFontFamiliesExW.restype = ctypes.c_int
    
    def enumerate_all_fonts(self) -> List[str]:
        """
        시스템의 모든 폰트 패밀리를 열거합니다.
        
        Returns:
            List[str]: 폰트 패밀리 이름 리스트 (정렬됨)
        """
        # Get device context
        hdc = self.user32.GetDC(None)
        if not hdc:
            return []
        
        try:
            # Setup LOGFONTW for enum
            lf = LOGFONTW()
            lf.lfCharSet = DEFAULT_CHARSET  # All charsets
            lf.lfFaceName = ''  # Empty means enumerate all
            
            # Create callback
            callback = FONTENUMPROC(self._enum_callback)
            
            # Enumerate fonts
            self.gdi32.EnumFontFamiliesExW(
                hdc,
                ctypes.byref(lf),
                callback,
                0,  # lParam (not used)
                0   # dwFlags (reserved, must be 0)
            )
        finally:
            self.user32.ReleaseDC(None, hdc)
        
        # Filter out vertical writing fonts (starting with '@')
        families = [
            name for name in self.font_families.keys()
            if not name.startswith('@')
        ]
        
        return sorted(families)
    
    def _enum_callback(self, lpelfe, lpntme, fonttype, lparam):
        """
        EnumFontFamiliesExW의 콜백 함수
        
        각 폰트마다 호출되며, 폰트 정보를 수집합니다.
        
        Returns:
            int: 1 to continue enumeration, 0 to stop
        """
        try:
            logfont = lpelfe.contents
            face_name = logfont.lfFaceName
            
            if face_name and face_name not in self.font_families:
                # Store font metadata
                self.font_families[face_name] = {
                    'charset': logfont.lfCharSet,
                    'weight': logfont.lfWeight,
                    'italic': logfont.lfItalic,
                    'fonttype': fonttype
                }
        except Exception:
            # Ignore errors in callback to prevent enumeration failure
            pass
        
        return 1  # Continue enumeration
    
    def get_font_metadata(self, face_name: str) -> Dict:
        """
        특정 폰트의 메타데이터를 반환합니다.
        
        Args:
            face_name: 폰트 패밀리 이름
            
        Returns:
            Dict: 폰트 메타데이터 (charset, weight, italic 등)
        """
        return self.font_families.get(face_name, {})
    
    def get_all_metadata(self) -> Dict[str, Dict]:
        """
        모든 폰트의 메타데이터를 반환합니다.
        
        Returns:
            Dict[str, Dict]: 폰트 이름을 키로 하는 메타데이터 딕셔너리
        """
        return dict(self.font_families)


def enumerate_system_fonts() -> List[str]:
    """
    시스템 폰트를 열거하는 편의 함수
    
    Returns:
        List[str]: 정렬된 폰트 패밀리 이름 리스트
    """
    enumerator = FontEnumerator()
    return enumerator.enumerate_all_fonts()


if __name__ == '__main__':
    # Test the enumerator
    print("Enumerating system fonts...")
    fonts = enumerate_system_fonts()
    print(f"Found {len(fonts)} font families:")
    for font in fonts[:10]:  # Print first 10
        print(f"  - {font}")
    if len(fonts) > 10:
        print(f"  ... and {len(fonts) - 10} more")
