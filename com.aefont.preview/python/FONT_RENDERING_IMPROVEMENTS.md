# AE Font Preview - 폰트 렌더링 개선 사항

## 개요

After Effects CEP 패널에서 동적 폰트(산돌클라우드, Adobe Fonts 등)의 렌더링 문제를 해결하기 위한 개선 작업입니다.

## 문제 분석

### 원인
1. **폰트 이름 불일치**: GDI가 요구하는 정확한 폰트 패밀리 이름과 실제 사용된 이름의 불일치
2. **Font Substitution**: GDI가 요청한 폰트를 찾지 못해 기본 폰트로 대체
3. **폰트 열거 부정확**: Tkinter와 다른 방식으로 폰트를 열거하여 동적 폰트 누락

### 기존 접근 방식의 한계
- Tkinter는 정확한 폰트 이름으로 렌더링 성공
- font_server.py의 GDI 렌더링은 이름 매핑 실패로 기본 폰트 사용

## 해결 방안

### 새로운 모듈 구조

```
com.aefont.preview/python/
├── font_enumerator.py      (신규) - EnumFontFamiliesExW 직접 호출
├── gdi_renderer.py          (신규) - GDI 렌더링 + Substitution 감지
├── font_name_resolver.py    (기존) - 폰트 이름 해상도
└── font_server.py           (개선) - 통합 및 폴백 로직
```

### 1. font_enumerator.py

**목적**: Windows GDI API를 직접 호출하여 Tkinter와 동일한 방식으로 폰트 열거

**핵심 기능**:
- `EnumFontFamiliesExW` API 직접 호출
- 동적으로 로드된 폰트(FR_PRIVATE 포함) 정확히 감지
- 폰트 메타데이터(charset, weight, italic) 수집

**장점**:
- Tkinter와 100% 동일한 폰트 목록
- 산돌클라우드/Adobe Fonts 등 동적 폰트 완벽 지원
- 더 정확한 시스템 폰트 이름 획득

### 2. gdi_renderer.py

**목적**: GDI 렌더링 + Font Substitution 감지

**핵심 기능**:
- `GetTextFaceW`로 실제 선택된 폰트 확인
- Substitution 발생 시 즉시 감지하여 PIL 폴백 트리거
- 깔끔한 리소스 관리

**작동 방식**:
```python
image_data, substitution_detected = renderer.render(...)
if substitution_detected:
    # PIL 폴백으로 전환
    return None
```

**장점**:
- 잘못된 폰트로 렌더링하는 것을 방지
- GDI ClearType 품질 유지 (성공 시)
- 명확한 에러 처리

### 3. font_server.py 개선

**렌더링 전략**:

```
1. GDI 렌더링 시도
   ├─ 성공 → GDI 이미지 반환 (최상 품질)
   ├─ Substitution 감지 → PIL 폴백
   └─ 실패 → PIL 폴백

2. PIL 폴백 (GDI 실패 시)
   ├─ 폰트 파일 경로로 직접 로드
   ├─ TrueType 렌더링
   └─ 성공 → PIL 이미지 반환

3. 최종 폴백
   └─ 기본 폰트 또는 플레이스홀더
```

**FontRegistry 개선**:
- `EnumFontFamiliesExW` 우선 사용
- Tkinter와 GDI 결과 비교 (디버깅용)
- 폴백으로 Tkinter 사용

## 구현 내용

### 주요 변경사항

1. **FontRegistry._load()** - 폰트 열거 개선
   ```python
   # EnumFontFamiliesExW 우선 사용
   enumerator = FontEnumerator()
   gdi_families = enumerator.enumerate_all_fonts()
   self._families = gdi_families  # 더 정확함
   ```

2. **render_with_gdi()** - Substitution 감지
   ```python
   renderer = GDIRenderer(debug_callback=debug)
   image_data, substitution_detected = renderer.render(...)
   
   if substitution_detected:
       return None  # PIL 폴백 신호
   ```

3. **_render_font_image()** - 강화된 폴백 로직
   ```python
   # GDI 시도
   gdi_image = render_with_gdi(...)
   if gdi_image:
       return gdi_image
   
   # PIL 폴백
   pil_font = ImageFont.truetype(font_path, size)
   # PIL로 렌더링...
   ```

## 기대 효과

### 렌더링 성공률 향상
- **산돌클라우드 폰트**: 기본 폰트 대체 → 정확한 렌더링
- **Adobe Fonts**: 기본 폰트 대체 → 정확한 렌더링
- **일반 시스템 폰트**: 기존과 동일하거나 개선

### 성능
- **대부분의 폰트**: GDI로 빠른 렌더링 (기존과 동일)
- **문제 폰트만**: PIL 폴백 사용 (약간 느림, 하지만 정확함)
- **전체적으로**: 효율적인 하이브리드 접근

### 호환성
- Windows 7 이상 모든 버전 지원
- 기존 코드와 하위 호환성 유지
- 새 모듈 없어도 Tkinter 폴백으로 작동

## 테스트 방법

### 1. 기본 테스트
```bash
cd com.aefont.preview/python
python font_server.py
```

서버가 시작되면 로그 확인:
```
[font_server] Loaded XXX font families from EnumFontFamiliesExW
[font_server] Starting font server on port 8765
```

### 2. 폰트 목록 확인
```bash
curl http://localhost:8765/fonts
```

### 3. 미리보기 테스트
```bash
# 일반 폰트
curl "http://localhost:8765/preview/Arial?text=Sample&size=24"

# 산돌클라우드 폰트 (설치되어 있다면)
curl "http://localhost:8765/preview/산돌고딕?text=테스트&size=24"
```

### 4. 디버그 로그 확인

정상 케이스:
```
[font_server] Resolved '폰트이름' → 'FaceName' (weight=400)
[font_server] ✓ Font verified: 'FaceName' (weight=400, italic=0)
```

Substitution 감지 케이스:
```
[font_server] Font substitution detected: requested 'X' but got 'Arial'
[font_server] GDI rendering failed/substituted, trying PIL fallback
[font_server] ✓ PIL loaded font from: C:\...\font.ttf
```

### 5. After Effects에서 테스트

1. After Effects 실행
2. 폰트 미리보기 패널 열기
3. 산돌클라우드/Adobe Fonts 폰트 선택
4. 미리보기가 정확한 폰트로 표시되는지 확인

## 롤백 방법

문제 발생 시 새 모듈을 제거하고 기존 방식 사용:

1. `font_enumerator.py` 삭제
2. `gdi_renderer.py` 삭제
3. `font_server.py`에서 import 제거:
   ```python
   # 이 줄들을 주석 처리
   # from font_enumerator import FontEnumerator
   # from gdi_renderer import GDIRenderer
   ```

Tkinter 폴백이 자동으로 작동합니다.

## 추가 개선 가능 사항

### 단기
- [ ] 폰트 캐싱 (반복 요청 시 성능 향상)
- [ ] 더 많은 DRM 폰트 서비스 경로 추가
- [ ] 에러 메시지 개선

### 중기
- [ ] Mac 지원 (CTFont/Quartz 사용)
- [ ] Linux 지원 (fontconfig/FreeType 사용)
- [ ] 폰트 미리보기 품질 설정

### 장기
- [ ] 폰트 변형(weight, width 등) 지원
- [ ] OpenType 기능 지원
- [ ] 폰트 메트릭 정보 제공

## 참고 문서

- GPT 분석 보고서: `GPT.After Effects CEP 패널 동적 폰트 렌더링 문제 분석 및 해결 보고서.md`
- 퍼플 분석 보고서: `퍼플_AE Font Preview 폰트 표시 문제 분석 및 해결 방안.md`
- 기존 수정 사항: `FONT_RENDERING_FIX.md`

## 작성자

구현 날짜: 2025-11-06
버전: 1.0
