# AE Font Preview 폰트 표시 문제 분석 및 해결 요청

## 문제 개요

After Effects CEP 패널용 폰트 미리보기 프로그램에서 폰트 표시 불일치 문제가 발생합니다.

### 현재 상황
- `font_preview.py` (Tkinter GUI): **모든 폰트가 정상 표시됨** (산돌 DRM 폰트 포함)
- `font_server.py` (HTTP 서버): **일부 폰트가 누락됨** (특히 산돌 동적 폰트)

### 핵심 질문
1. **왜 Tkinter는 모든 폰트를 표시하는가?**
2. **왜 현재 서버 체계는 일부 폰트를 놓치는가?**
3. **서버가 Tkinter와 동일한 폰트 목록을 얻으려면 어떻게 해야 하는가?**

## 기술적 배경

### 폰트 인식 방식 차이

**Tkinter 방식 (`font_preview.py`)**:
```python
from tkinter.font import families
all_system_fonts = sorted(families())  # 현재 세션의 모든 폰트 반환
```
- Windows GDI의 `EnumFontFamiliesEx()` API 사용
- 현재 프로세스에서 접근 가능한 **모든 폰트** 열거
- `AddFontResourceEx()`로 임시 로드된 폰트도 포함

**서버 방식 (`font_server.py`)**:
```python
# 레지스트리 스캔
winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\...\Fonts")
# 파일 시스템 스캔  
Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
Path(os.environ.get('LOCALAPPDATA', '')) / 'SandollCloud' / 'fonts'
```
- Windows 레지스트리 + 파일 시스템 스캔
- fontTools로 TTF/OTF 파일 파싱
- **정적 데이터만 확인** (동적 로드 폰트 놓침)

### 산돌클라우드 DRM 메커니즘

```
산돌클라우드 앱 실행
├─ 폰트 파일 다운로드 (암호화)
├─ AddFontResourceEx(폰트경로, FR_PRIVATE | FR_NOT_ENUM, 0)
├─ 현재 프로세스에서만 사용 가능
└─ 앱 종료 시 RemoveFontResourceEx() 호출
```

**Microsoft 문서 참고**:
> "This function allows a process to use fonts **without allowing other processes access** to the fonts."
> "Fonts added can be marked as **private and not enumerable**."

## 요청 사항

### 1. 원인 분석
- Windows 폰트 시스템의 동작 원리 상세 분석
- `EnumFontFamiliesEx()` vs 레지스트리 스캔의 차이점
- `FR_PRIVATE`/`FR_NOT_ENUM` 플래그의 영향
- Tkinter가 어떻게 DRM 폰트에 접근하는지 기술적 설명

### 2. 구체적인 해결 방안 제시
다음 중 가장 적합한 해결책을 제시하고 구현 방법을 상세히 설명:

**옵션 A**: GDI API 직접 사용
```python
# 서버에서 EnumFontFamiliesEx() 직접 호출
def enumerate_loaded_fonts():
    hdc = gdi32.CreateCompatibleDC(0)
    gdi32.EnumFontFamiliesExW(hdc, None, callback, 0, 0)
    # 현재 로드된 폰트 목록 반환
```

**옵션 B**: Tkinter와의 연동
```python
# Tkinter의 families() 결과를 서버에서 활용
tk_root = Tk()
tk_families = families()  # Tkinter가 찾은 모든 폰트
# 이 목록을 서버 API로 제공
```

**옵션 C**: 하이브리드 방식
- 레지스트리 + 파일 스캔 (현재)
- + GDI API 열거 (추가)
- + 산돌클라우드 특수 처리

### 3. 구현 가이드
- 선택한 해결책의 상세 구현 코드
- 성능 및 안정성 고려사항
- Windows 버전 호환성
- 예외 처리 및 에러 복구

### 4. 테스트 방법
- 해결책 적용 후 폰트 목록 비교 테스트
- 산돌 DRM 폰트 표시 확인
- 다양한 Windows 환경에서의 검증

## 첨부 파일

1. **전체 소스코드 ZIP**: AE-Font-Preview-Source.zip
2. **font_server.py**: 현재 HTTP 서버 구현
3. **font_preview.py**: Tkinter GUI 구현 (정상 동작 기준)

## 기대 결과

- **완벽한 폰트 동기화**: 서버가 Tkinter와 동일한 폰트 목록 제공
- **산돌 DRM 폰트 지원**: 동적으로 로드된 폰트도 표시
- **안정적인 해결책**: Windows 버전/환경에 구애받지 않는 솔루션

## 우선순위

1. **원인의 명확한 기술적 설명** (가장 중요)
2. **실현 가능한 구체적인 해결책**
3. **코드 수준의 구현 가이드**
4. **테스트 및 검증 방법**

이 문제를 해결하면 After Effects CEP 패널에서 시스템의 모든 폰트를 완벽하게 활용할 수 있게 됩니다.
