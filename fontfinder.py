import ctypes
from ctypes import wintypes, POINTER, Structure, byref
import struct

class LOGFONT(Structure):
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
        ('lfFaceName', wintypes.WCHAR * 32)
    ]

def get_all_localized_names(font_name):
    """폰트 이름을 입력받아 모든 언어의 Family Name을 반환"""
    lf = LOGFONT()
    lf.lfHeight = -16  # ⭐ 크기 지정 필수!
    lf.lfWeight = 400
    lf.lfCharSet = 1
    lf.lfFaceName = font_name
    
    hfont = ctypes.windll.gdi32.CreateFontIndirectW(byref(lf))
    if not hfont:
        return {}
    
    hdc = ctypes.windll.user32.GetDC(None)
    hfont_old = ctypes.windll.gdi32.SelectObject(hdc, hfont)
    
    name_tag = 0x656D616E  # ⭐ 'name' in big-endian
    size = ctypes.windll.gdi32.GetFontData(hdc, name_tag, 0, None, 0)
    
    GDI_ERROR = 0xFFFFFFFF
    # 음수 값을 부호 있는 정수로 변환
    if size < 0:
        size = size & 0xFFFFFFFF
    
    if size == GDI_ERROR or size == 0 or size > 1000000:  # 1MB 이상이면 스킵
        ctypes.windll.gdi32.SelectObject(hdc, hfont_old)
        ctypes.windll.user32.ReleaseDC(None, hdc)
        ctypes.windll.gdi32.DeleteObject(hfont)
        return {}
    
    buffer = ctypes.create_string_buffer(size)
    result = ctypes.windll.gdi32.GetFontData(hdc, name_tag, 0, buffer, size)
    
    ctypes.windll.gdi32.SelectObject(hdc, hfont_old)
    ctypes.windll.user32.ReleaseDC(None, hdc)
    ctypes.windll.gdi32.DeleteObject(hfont)
    
    if result == GDI_ERROR:
        return {}
    
    data = buffer.raw
    if len(data) < 6:
        return {}
    
    try:
        count = struct.unpack('>H', data[2:4])[0]
        string_offset = struct.unpack('>H', data[4:6])[0]
        
        names = {}
        offset = 6
        
        for i in range(count):
            if offset + 12 > len(data):
                break
            
            platform_id = struct.unpack('>H', data[offset:offset+2])[0]
            language_id = struct.unpack('>H', data[offset+4:offset+6])[0]
            name_id = struct.unpack('>H', data[offset+6:offset+8])[0]
            length = struct.unpack('>H', data[offset+8:offset+10])[0]
            str_offset = struct.unpack('>H', data[offset+10:offset+12])[0]
            
            offset += 12
            
            if name_id != 1:  # Family name만
                continue
            
            str_pos = string_offset + str_offset
            if str_pos + length > len(data):
                continue
            
            name_data = data[str_pos:str_pos+length]
            
            try:
                if platform_id == 3:  # Windows
                    name_str = name_data.decode('utf-16-be')
                    
                    lang_map = {
                        0x0409: 'en',
                        0x0412: 'ko',
                        0x0411: 'ja',
                        0x0804: 'zh-CN',
                    }
                    
                    if language_id in lang_map:
                        names[lang_map[language_id]] = name_str
            except:
                continue
        
        return names
    except:
        return {}


# 사용
FONTENUMPROC = ctypes.WINFUNCTYPE(
    wintypes.INT, POINTER(LOGFONT), wintypes.LPVOID, 
    wintypes.DWORD, wintypes.LPARAM
)

def enumerate_all_fonts_with_multilingual():
    font_names = []
    
    def callback(lpelfe, lpntme, font_type, lparam):
        font_name = lpelfe.contents.lfFaceName
        if font_name and font_name not in font_names:
            font_names.append(font_name)
        return 1
    
    hdc = ctypes.windll.user32.GetDC(None)
    lf = LOGFONT()
    lf.lfCharSet = 1
    
    ctypes.windll.gdi32.EnumFontFamiliesExW(
        hdc, byref(lf), FONTENUMPROC(callback), 0, 0
    )
    ctypes.windll.user32.ReleaseDC(None, hdc)
    
    font_mapping = {}
    for font_name in font_names:
        all_names = get_all_localized_names(font_name)
        if all_names:
            font_mapping[font_name] = all_names
    
    return font_mapping

# 실행
import os

all_fonts = enumerate_all_fonts_with_multilingual()

ko_to_en = {}
for sys_name, names in all_fonts.items():
    if 'ko' in names and 'en' in names:
        ko_to_en[names['ko']] = names['en']

print(f"한글->영어 매핑: {len(ko_to_en)}개")
for ko, en in list(ko_to_en.items())[:5]:
    print(f"  {ko} -> {en}")

# 파일로 저장
output_file = os.path.join(os.path.dirname(__file__), "fonts_mapping.txt")
with open(output_file, "w", encoding="utf-8") as f:
    f.write("=== 폰트 다국어 이름 매핑 ===\n\n")
    f.write(f"한글->영어 매핑: {len(ko_to_en)}개\n")
    f.write("=" * 60 + "\n\n")
    
    for ko, en in sorted(ko_to_en.items()):
        f.write(f"{ko} -> {en}\n")

print(f"\n✅ 매핑이 저장되었습니다: {output_file}")
