<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# AE Font Preview 폰트 표시 문제 분석 및 해결 방안

## 문제 요약

After Effects CEP 패널의 폰트 미리보기 프로그램에서 **Tkinter GUI는 모든 폰트를 정상 표시**하지만, **HTTP 서버는 일부 폰트를 기본 폰트로 표시**하는 불일치 문제가 발생합니다. 특히 산돌클라우드, 디자인210, 어도비폰트 등 DRM 폰트에서 문제가 두드러집니다.[^1]

## 원인 분석

### 1. Windows 폰트 시스템의 동작 원리

**Windows는 두 가지 방식으로 폰트를 관리합니다**:[^2][^3]

#### 정적 설치 폰트

- Windows 레지스트리에 등록: `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
- 시스템 또는 사용자 폴더에 저장:[^3]
    - `C:\Windows\Fonts` (시스템 전체)
    - `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (사용자별)


#### 동적 로드 폰트

- `AddFontResourceEx()` API로 런타임에 로드[^4][^5]
- **FR_PRIVATE 플래그**: 해당 프로세스에서만 접근 가능[^5][^4]
- **FR_NOT_ENUM 플래그**: 열거조차 불가능[^5]
- 프로세스 종료 시 `RemoveFontResourceEx()`로 제거


### 2. Tkinter의 성공 요인

**Tkinter는 내부적으로 `EnumFontFamiliesExW` API를 호출합니다**:[^6][^2]

```
tkinter.font.families()
  └─> Tcl/Tk의 'font families' 명령
      └─> Windows: tkWinFont.c 구현
          └─> EnumFontFamiliesExW() API 호출
```

`EnumFontFamiliesExW`는 **현재 프로세스의 GDI Font Table을 조회**하므로:[^2][^3]

- 레지스트리에 등록된 폰트
- **현재 프로세스에서 `AddFontResourceEx(FR_PRIVATE)`로 로드된 폰트** ✓
- 모두 열거 가능

**Tkinter의 폰트 렌더링**:[^6]

```python
font = Font(family=font_name, size=size)
# → CreateFontIndirectW() 직접 호출
# → EnumFontFamiliesExW로 얻은 정확한 이름 사용
```


### 3. font_server.py의 실패 요인

**font_server.py는 3단계 접근 방식을 사용합니다**:[^7]

#### 1단계: 폰트 목록 수집

- Tkinter `families()` 호출 ✓
- Windows 레지스트리 스캔 (정적 폰트만)
- 파일 시스템 스캔 (물리적 파일만)
- fontTools로 TTF/OTF 파싱

**문제**: 레지스트리와 파일 스캔으로는 동적 로드된 DRM 폰트의 **정확한 경로와 이름**을 찾을 수 없습니다.[^7]

#### 2단계: 폰트 이름 변환 (FontNameResolver)

```python
# font_name_resolver.py
def resolve(display_name, postscript_name, family_name, style):
    # Priority 1: PostScript 이름 기반 변환
    # Priority 2: Display 이름
    # Priority 3: Family 이름
    # Fallback: Arial
```

**핵심 문제**: After Effects가 제공하는 이름과 실제 시스템에 등록된 이름이 다를 수 있습니다:[^1]


| AE 제공 이름 | 시스템 실제 이름 | 결과 |
| :-- | :-- | :-- |
| "산돌 고딕" | "산돌고딕 Neo1 Regular" | 매칭 실패 ✗ |
| "SandollGothic-Regular" | "Sandoll Gothic Neo1" | 매칭 실패 ✗ |

#### 3단계: GDI 렌더링

```python
def render_with_gdi(font_name, ...):
    resolved = FontNameResolver.resolve(...)
    face_name = resolved['faceName']
    
    logfont.lfFaceName = face_name  # ← 잘못된 이름
    hfont = CreateFontIndirectW(logfont)  # ← 실패!
```

**`CreateFontIndirectW`는 정확한 폰트 이름을 요구합니다**:[^8][^9]

- Face name 불일치 시 penalty 부과[^8]
- 일치하는 폰트가 없으면 기본 폰트로 폴백[^10]
- **이름 대체(substitution)는 일부 경우에만 작동**[^8]


### 4. 산돌클라우드 DRM 메커니즘 (추정)

산돌클라우드는 다음과 같이 동작하는 것으로 추정됩니다:[^11][^12]

```
산돌클라우드 앱 실행
├─ 1. 암호화된 폰트 파일 다운로드 (임시 위치)
├─ 2. AddFontResourceEx(경로, FR_PRIVATE, 0) 호출
│     └─ 현재 프로세스(산돌클라우드 앱)에서만 접근
│     └─ 다른 프로세스는 접근 불가
└─ 3. 앱 종료 시 RemoveFontResourceEx() 호출
```

**그러나 실제로는 FR_PRIVATE 없이 로드되어 모든 프로세스가 접근 가능한 것으로 보입니다**. 그렇지 않다면 Tkinter도 접근할 수 없었을 것입니다.[^11]

## 해결 방안

### 권장 방안: EnumFontFamiliesExW 직접 호출

**Tkinter와 동일한 방식을 Python ctypes로 구현합니다**:[^13][^6]

#### 장점

1. **동적 로드 폰트 완전 지원**: FR_PRIVATE 폰트 포함[^3][^2]
2. **정확한 폰트 이름 획득**: Windows Font Mapper가 사용하는 실제 이름[^2][^8]
3. **이름 매칭 문제 해결**: 변환 없이 직접 사용
4. **Tkinter와 100% 일치**: 동일한 API 사용[^6]

#### 구현 방법

**1단계: 새 모듈 생성 (`font_enumeration.py`)**[^13]

```python
import ctypes
from ctypes import wintypes

class LOGFONTW(ctypes.Structure):
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

FONTENUMPROC = ctypes.WINFUNCTYPE(
    ctypes.c_int,
    ctypes.POINTER(LOGFONTW),
    wintypes.LPVOID,
    wintypes.DWORD,
    wintypes.LPARAM
)

class FontEnumerator:
    def __init__(self):
        self.font_families = {}
        self.gdi32 = ctypes.windll.gdi32
        self.user32 = ctypes.windll.user32
    
    def enumerate_all_fonts(self):
        """EnumFontFamiliesExW를 사용하여 모든 폰트 열거"""
        hdc = self.user32.GetDC(None)
        
        try:
            lf = LOGFONTW()
            lf.lfCharSet = 1  # DEFAULT_CHARSET
            lf.lfFaceName = ''  # 모든 폰트
            
            callback = FONTENUMPROC(self._enum_callback)
            
            self.gdi32.EnumFontFamiliesExW(
                hdc,
                ctypes.byref(lf),
                callback,
                0, 0
            )
        finally:
            self.user32.ReleaseDC(None, hdc)
        
        # '@' 세로쓰기 폰트 제외
        families = [name for name in self.font_families.keys() 
                   if not name.startswith('@')]
        return sorted(families)
    
    def _enum_callback(self, lpelfe, lpntme, fonttype, lparam):
        """콜백 함수: 각 폰트마다 호출됨"""
        logfont = lpelfe.contents
        face_name = logfont.lfFaceName
        
        if face_name and face_name not in self.font_families:
            self.font_families[face_name] = {
                'charset': logfont.lfCharSet,
                'weight': logfont.lfWeight,
                'italic': logfont.lfItalic
            }
        
        return 1  # 계속 열거
```

**2단계: FontRegistry 수정**[^7]

```python
class FontRegistry:
    def _load(self):
        # Tkinter 방식 (검증용)
        tkinter_families = sorted(set(families()))
        
        # GDI 직접 호출 (신규)
        enumerator = FontEnumerator()
        gdi_families = enumerator.enumerate_all_fonts()
        
        # 비교 로그
        tkinter_set = set(tkinter_families)
        gdi_set = set(gdi_families)
        
        if tkinter_set != gdi_set:
            debug(f"Difference: Tkinter={len(tkinter_set)}, GDI={len(gdi_set)}")
        
        # GDI 결과 사용 (더 정확)
        self._families = gdi_families
        
        for family in self._families:
            self._remember_alias(family)
```

**3단계: render_with_gdi() 간소화**[^7]

```python
def render_with_gdi(font_name, text, size, target_width=0,
                    postscript_name=None, style=None):
    # 이름 후보 우선순위
    candidates = [
        (font_name, 'original'),
        (postscript_name, 'postscript'),
    ]
    
    # FontNameResolver는 최후 수단으로만 사용
    
    for face_candidate, source in candidates:
        if not face_candidate:
            continue
        
        logfont = LOGFONTW()
        logfont.lfHeight = -abs(int(size))
        logfont.lfCharSet = 1  # DEFAULT_CHARSET
        logfont.lfFaceName = face_candidate[:31]
        
        hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        
        if hfont:
            debug(f"✓ Font created: {face_candidate} (from {source})")
            # 렌더링 계속...
            break
        else:
            debug(f"✗ Failed: {face_candidate} (from {source})")
    
    # Arial 폴백...
```


### 대체 방안: Fuzzy Name Matching

EnumFontFamiliesExW 구현이 어려운 경우, **이름 매칭 로직을 개선**할 수 있습니다:

```python
def fuzzy_match(ae_name, system_names):
    # 1. 정규화 및 완전 일치
    normalized_ae = normalize(ae_name)
    for name in system_names:
        if normalize(name) == normalized_ae:
            return name
    
    # 2. 토큰 기반 Jaccard 유사도
    ae_tokens = set(normalized_ae.split())
    best_match = None
    best_score = 0
    
    for name in system_names:
        name_tokens = set(normalize(name).split())
        score = len(ae_tokens & name_tokens) / len(ae_tokens | name_tokens)
        if score > best_score and score > 0.6:
            best_score = score
            best_match = name
    
    return best_match
```

**하지만 이는 근본적인 해결책이 아닙니다.** 정확한 이름을 얻는 것이 가장 확실합니다.[^8]

## 예상 결과

**구현 후 기대 효과**:

1. **폰트 목록 100% 일치**: Tkinter GUI와 HTTP 서버가 동일한 목록 표시[^2][^6]
2. **렌더링 성공률 향상**: 정확한 이름으로 `CreateFontIndirectW` 성공[^9][^8]
3. **DRM 폰트 완전 지원**: 산돌클라우드, 어도비폰트 등 정상 렌더링[^11]
4. **이름 변환 오류 제거**: FontNameResolver 의존도 감소[^1]

## 추가 디버깅

문제가 지속되면 다음 로그를 추가하여 원인을 파악하세요:

```python
def render_with_gdi(...):
    debug(f"Font request: {font_name}")
    debug(f"  PostScript: {postscript_name}")
    debug(f"  Style: {style}")
    
    for face_candidate, source in candidates:
        logfont.lfFaceName = face_candidate[:31]
        hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        
        if hfont:
            debug(f"  ✓ Success: {face_candidate} (from {source})")
            break
        else:
            debug(f"  ✗ Failed: {face_candidate} (from {source})")
```


## 결론

**핵심 원인은 폰트 이름 불일치입니다.** Tkinter는 `EnumFontFamiliesExW`로 정확한 이름을 얻어 성공하지만, font_server.py는 중간 변환 과정에서 이름이 틀어집니다.[^1][^6][^2][^8]

**해결책은 Tkinter와 동일한 방식을 사용하는 것입니다**: Python ctypes로 `EnumFontFamiliesExW`를 직접 호출하여 정확한 폰트 이름을 획득하고, `CreateFontIndirectW`에 그대로 전달합니다. 이를 통해 레지스트리 스캔의 한계를 극복하고 동적 로드 폰트까지 완벽히 지원할 수 있습니다.[^4][^5][^3][^13][^2]

구현 예상 시간은 **4-5시간**이며, 단계별 코드는 첨부된 구현 가이드를 참고하시기 바랍니다.
<span style="display:none">[^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^52][^53][^54][^55][^56][^57][^58][^59][^60][^61][^62][^63][^64][^65][^66]</span>

<div align="center">⁂</div>

[^1]: font_name_resolver.py

[^2]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-enumfontfamiliesexw

[^3]: https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts

[^4]: https://stackoverflow.com/questions/11569159/addfontresource-vs-addfontresourceex

[^5]: https://www.plantation-productions.com/Webster/Win32Asm/GDIRef.pdf

[^6]: https://stackoverflow.com/questions/60579711/how-tkinter-font-families-function-gets-a-list-of-available-font

[^7]: font_preview.py

[^8]: https://alpha-supernova.dev.filibeto.org/lib/ossc/doc/libwmf-0.1.21/notes/fontmap.htm

[^9]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createfontindirecta

[^10]: https://learn.microsoft.com/en-us/answers/questions/1405458/how-gdi-set-logfont-lffacename

[^11]: https://www.sandollcloud.com/font-subscription/1/Sandoll

[^12]: https://www.sandoll.co.kr/story/?bmode=view\&idx=14931441

[^13]: https://stackoverflow.com/questions/51256688/python-windows-enum-installed-fonts

[^14]: font_server.py

[^15]: main.js

[^16]: https://community.adobe.com/t5/after-effects-discussions/에프터-이펙트에서-한글-폰트-미리보기가-안-됩니다/td-p/15101573

[^17]: https://community.adobe.com/t5/after-effects-discussions/글꼴-미리보기-오류/td-p/14637864

[^18]: https://www.reddit.com/r/AfterEffects/comments/k8j5l2/after_effects_not_displaying_font_correctly/

[^19]: https://kin.naver.com/qna/dirs/10203/docs/470461399?d1id=1\&qb=7ZWc6riAIO2PsO2KuCDsoIHsmqk%3D

[^20]: https://kin.naver.com/qna/dirs/10203/docs/470461399

[^21]: https://www.tutorialspoint.com/how-to-list-available-font-families-in-tkinter

[^22]: https://netghost.narod.ru/vcpp6/ch07/ch07.htm

[^23]: https://stackoverflow.com/questions/64070050/how-to-get-a-list-of-installed-windows-fonts-using-python

[^24]: https://www.vbforums.com/showthread.php?767809-RESOLVED-Problem-using-AddFontResourceEx

[^25]: https://flylib.com/books/en/4.460.1.28/1/

[^26]: https://www.youtube.com/watch?v=aQcUXbGzg90

[^27]: https://gist.github.com/fretje/9c9a81a0e30554b5797e8f5bb792f866

[^28]: https://www-user.tu-chemnitz.de/~heha/hs/chm/petzold.chm/petzoldi/ch17e.htm

[^29]: https://www.geeksforgeeks.org/python/tkinter-fonts/

[^30]: https://showmiso.tistory.com/87

[^31]: https://python.flowdas.com/library/tkinter.font.html

[^32]: https://learn.microsoft.com/ko-kr/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa

[^33]: https://github.com/python-pillow/Pillow/issues/974

[^34]: https://learn.microsoft.com/en-us/windows/win32/gdiplus/-gdiplus-creating-a-private-font-collection-use

[^35]: https://pillow.readthedocs.io/en/stable/reference/ImageFont.html

[^36]: https://learn.microsoft.com/en-us/windows/win32/gdi/font-and-text-functions

[^37]: https://daco2020.tistory.com/832

[^38]: https://www.vbforums.com/showthread.php?892398-Enumerate-All-Installed-Fonts-Using-GDI

[^39]: https://supermemi.tistory.com/entry/Python-PIL-PIL-Image-text-FontImageFont-글씨-크기-폰트-변경하기

[^40]: https://www.chromium.org/developers/design-documents/directwrite-font-cache/

[^41]: https://stackoverflow.com/questions/5414639/python-imaging-library-text-rendering

[^42]: https://microsoft.tistory.com/724

[^43]: https://dadev.tistory.com/entry/Python-Pillow-이용한-이미지에-텍스트-추가

[^44]: https://www.vbforums.com/showthread.php?903439-Private-Font-and-GDI

[^45]: https://blog.naver.com/monkey5255/221594654820

[^46]: https://ssotori.tistory.com/259

[^47]: https://www.tcl-lang.org/man/tcl8.5/TkCmd/font.htm

[^48]: https://docs.python.org/ko/3/library/ctypes.html

[^49]: https://tkdocs.com/tutorial/fonts.html

[^50]: https://docs.python.org/ko/3.7/library/ctypes.html

[^51]: https://groups.google.com/g/comp.lang.python/c/rKybL2-hY-U

[^52]: https://community.adobe.com/t5/premiere-pro-discussions/adobe-premiere-pro에서-산돌구름-sandoll-cloud-폰트-사용-시-텍스트가-비정상적으로-출력되거나-내보내기-시-폰트가-사라지는-현상-발생/m-p/15275861

[^53]: https://labex.io/ko/tutorials/python-how-to-interact-with-windows-api-in-python-391548

[^54]: https://www.askpython.com/python-modules/tkinter/tkinter-font-class

[^55]: https://learn.microsoft.com/ko-kr/answers/questions/4321040/windows-font-cache-service

[^56]: https://www.youtube.com/watch?v=neexS0HK9TY

[^57]: https://learn.microsoft.com/en-us/previous-versions/dd162618(v=vs.85)

[^58]: https://stackoverflow.com/questions/16769758/get-a-font-filename-based-on-the-font-handle-hfont

[^59]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-enumfontfamiliesexa

[^60]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createfonta

[^61]: https://stackoverflow.com/questions/78617271/get-gdi-font-parameters

[^62]: https://danac.tistory.com/75

[^63]: https://learn.microsoft.com/en-us/windows/win32/directwrite/font-selection

[^64]: https://forums.codeguru.com/showthread.php?500522-Need-clarification-about-CreateFontIndirect

[^65]: https://blog.naver.com/sjhghj/140100475161

[^66]: https://blog.naver.com/msyang59/222037922294

