#!/usr/bin/env python3
"""
GDI 폰트 이름 테스트 프로그램
한글 이름 vs 영문 이름 렌더링 테스트
"""

import ctypes
from ctypes import wintypes
import sys

# GDI32 DLL
gdi32 = ctypes.windll.gdi32
user32 = ctypes.windll.user32

# Constants
LF_FACESIZE = 32
FW_NORMAL = 400
DEFAULT_CHARSET = 1
OUT_DEFAULT_PRECIS = 0
CLIP_DEFAULT_PRECIS = 0
ANTIALIASED_QUALITY = 4
DEFAULT_PITCH = 0
DT_SINGLELINE = 0x00000020
DT_NOPREFIX = 0x00000800
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
    _fields_ = [
        ('left', wintypes.LONG),
        ('top', wintypes.LONG),
        ('right', wintypes.LONG),
        ('bottom', wintypes.LONG)
    ]

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
    _fields_ = [
        ("bmiHeader", BITMAPINFOHEADER),
        ("bmiColors", wintypes.DWORD * 1)
    ]

# Setup GDI function signatures
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
gdi32.GetObjectW.argtypes = [wintypes.HGDIOBJ, ctypes.c_int, ctypes.c_void_p]
gdi32.GetObjectW.restype = ctypes.c_int
user32.DrawTextW.argtypes = [
    wintypes.HDC,
    wintypes.LPCWSTR,
    ctypes.c_int,
    ctypes.POINTER(RECT),
    wintypes.UINT
]
user32.DrawTextW.restype = ctypes.c_int


def test_font_render(font_name, test_text="테스트 ABC 123"):
    """
    GDI로 폰트 렌더링 테스트
    
    Returns:
        bool: 렌더링 성공 여부
    """
    print(f"\n{'='*60}")
    print(f"테스트 폰트: '{font_name}'")
    print(f"테스트 텍스트: '{test_text}'")
    print(f"{'='*60}")
    
    hdc = None
    hfont = None
    hbitmap = None
    old_font = None
    old_bitmap = None
    
    try:
        # 1. DC 생성
        hdc = gdi32.CreateCompatibleDC(0)
        if not hdc:
            print("❌ CreateCompatibleDC 실패")
            return False
        print("✓ DC 생성 성공")
        
        # 2. LOGFONT 설정
        logfont = LOGFONTW()
        logfont.lfHeight = -48  # 48 포인트
        logfont.lfWeight = FW_NORMAL
        logfont.lfCharSet = DEFAULT_CHARSET
        logfont.lfOutPrecision = OUT_DEFAULT_PRECIS
        logfont.lfClipPrecision = CLIP_DEFAULT_PRECIS
        logfont.lfQuality = ANTIALIASED_QUALITY
        logfont.lfPitchAndFamily = DEFAULT_PITCH
        logfont.lfFaceName = font_name[:LF_FACESIZE - 1]
        
        print(f"✓ LOGFONT 설정 완료: lfFaceName='{logfont.lfFaceName}'")
        
        # 3. 폰트 생성
        hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        if not hfont:
            print("❌ CreateFontIndirectW 실패")
            return False
        print(f"✓ 폰트 핸들 생성 성공: 0x{hfont:X}")
        
        # 4. 폰트 선택
        old_font = gdi32.SelectObject(hdc, hfont)
        if not old_font:
            print("❌ SelectObject 실패")
            return False
        print(f"✓ 폰트 선택 성공")
        
        # 5. 실제 폰트 정보 확인 (GetObject)
        actual_logfont = LOGFONTW()
        result = gdi32.GetObjectW(hfont, ctypes.sizeof(LOGFONTW), ctypes.byref(actual_logfont))
        if result > 0:
            print(f"✓ 실제 매핑된 폰트: '{actual_logfont.lfFaceName}'")
            if actual_logfont.lfFaceName.lower() != font_name.lower():
                print(f"⚠️  요청한 폰트와 다른 폰트로 매핑됨!")
                print(f"   요청: '{font_name}'")
                print(f"   실제: '{actual_logfont.lfFaceName}'")
        
        # 6. 텍스트 측정
        calc_rect = RECT(0, 0, 0, 0)
        calc_flags = DT_SINGLELINE | DT_NOPREFIX | DT_CALCRECT
        result = user32.DrawTextW(hdc, test_text, -1, ctypes.byref(calc_rect), calc_flags)
        
        if result == 0:
            print("❌ DrawTextW 측정 실패")
            return False
        
        width = calc_rect.right - calc_rect.left
        height = calc_rect.bottom - calc_rect.top
        print(f"✓ 텍스트 측정 성공: {width}x{height} 픽셀")
        
        if width <= 0 or height <= 0:
            print("❌ 측정된 크기가 유효하지 않음")
            return False
        
        # 7. 비트맵 생성
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = width
        bmi.bmiHeader.biHeight = -height
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0
        
        bits = ctypes.c_void_p()
        hbitmap = gdi32.CreateDIBSection(hdc, ctypes.byref(bmi), 0, ctypes.byref(bits), None, 0)
        
        if not hbitmap:
            print("❌ CreateDIBSection 실패")
            return False
        print(f"✓ 비트맵 생성 성공")
        
        # 8. 비트맵 선택
        old_bitmap = gdi32.SelectObject(hdc, hbitmap)
        
        # 9. 텍스트 그리기
        gdi32.SetBkMode(hdc, 1)  # TRANSPARENT
        gdi32.SetTextColor(hdc, 0x00FFFFFF)  # White
        
        draw_rect = RECT(0, 0, width, height)
        draw_flags = DT_SINGLELINE | DT_NOPREFIX
        result = user32.DrawTextW(hdc, test_text, -1, ctypes.byref(draw_rect), draw_flags)
        
        if result == 0:
            print("❌ DrawTextW 그리기 실패")
            return False
        
        print(f"✓ 텍스트 렌더링 성공!")
        print(f"\n🎉 렌더링 완료!")
        print(f"   폰트: '{font_name}'")
        print(f"   크기: {width}x{height} 픽셀")
        
        return True
        
    except Exception as e:
        print(f"❌ 예외 발생: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        # Cleanup
        if old_font and hdc:
            gdi32.SelectObject(hdc, old_font)
        if old_bitmap and hdc:
            gdi32.SelectObject(hdc, old_bitmap)
        if hfont:
            gdi32.DeleteObject(hfont)
        if hbitmap:
            gdi32.DeleteObject(hbitmap)
        if hdc:
            gdi32.DeleteDC(hdc)


def main():
    print("\n" + "="*60)
    print("GDI 폰트 이름 렌더링 테스트")
    print("="*60)
    
    # 테스트할 폰트 이름들
    test_cases = [
        ("210 산토리니 B", "한글 이름"),
        ("210 Santorini B", "영문 이름"),
    ]
    
    results = {}
    
    for font_name, description in test_cases:
        success = test_font_render(font_name)
        results[font_name] = success
    
    # 결과 요약
    print("\n" + "="*60)
    print("테스트 결과 요약")
    print("="*60)
    
    for font_name, description in test_cases:
        status = "✅ 성공" if results[font_name] else "❌ 실패"
        print(f"{status} | {description:10s} | '{font_name}'")
    
    print("\n" + "="*60)
    print("결론")
    print("="*60)
    
    korean_success = results["210 산토리니 B"]
    english_success = results["210 Santorini B"]
    
    if korean_success and english_success:
        print("✅ 한글/영문 이름 모두 렌더링 성공!")
        print("   → GDI는 로케일 독립적으로 폰트를 매칭합니다.")
    elif korean_success and not english_success:
        print("⚠️  한글 이름만 성공, 영문 이름 실패")
        print("   → 폰트에 영문 이름이 없거나 매칭 실패")
    elif not korean_success and english_success:
        print("⚠️  영문 이름만 성공, 한글 이름 실패")
        print("   → 폰트에 한글 이름이 없거나 매칭 실패")
    else:
        print("❌ 모두 실패")
        print("   → 폰트가 설치되어 있지 않거나 다른 문제")
    
    print("="*60 + "\n")


if __name__ == "__main__":
    if sys.platform != "win32":
        print("❌ 이 프로그램은 Windows 전용입니다.")
        sys.exit(1)
    
    main()
