# AE Font Preview - After Effects 폰트 프리뷰 플러그인

After Effects 2022 이상을 지원하는 CEP(Common Extensibility Platform) 기반 폰트 프리뷰 플러그인입니다. 시스템에 설치된 모든 폰트를 불러와 실시간으로 미리보기하고, 선택된 폰트를 텍스트 레이어에 즉시 적용할 수 있습니다.

## 주요 기능

- ✅ **시스템 폰트 자동 감지**: Windows/Mac에 설치된 모든 폰트 목록 표시
- ✅ **실시간 프리뷰**: 사용자 지정 텍스트로 폰트 미리보기
- ✅ **다국어 지원**: 한국어, 영어, 일본어 인터페이스
- ✅ **폰트 검색**: 폰트 이름으로 빠른 검색 기능
- ✅ **크기 조절**: 프리뷰 폰트 크기 동적 조절 (12px-72px)
- ✅ **일괄 적용**: 선택된 여러 텍스트 레이어에 폰트 동시 적용
- ✅ **다크 테마**: After Effects 테마와 자동 연동

## 시스템 요구사항

- **After Effects**: 2022 버전 이상 (v22.0+)
- **운영체제**: Windows 10/11 또는 macOS 10.15+
- **메모리**: 최소 4GB RAM (8GB 이상 권장)

## 설치 방법

### 방법 1: ZXP Installer 사용 (권장)

1. [ZXP Installer](https://zxpinstaller.com/)와 같은 ZXP 설치 도구를 다운로드하여 설치합니다.
2. ZXP Installer를 실행하고 `AE-Font-Preview.zxp` 파일을 드래그 앤 드롭하여 설치합니다.

### 방법 2: 수동 설치

#### 1. 플러그인 파일 복사

1. `AE-fontpre` 폴더의 모든 내용을 다음 위치에 `com.aefontpre.preview` 라는 이름의 폴더를 만들어 복사합니다:

**Windows:**
```
C:\Program Files\Common Files\Adobe\CEP\extensions\com.aefontpre.preview
```

또는 사용자별 설치:
```
%AppData%\Roaming\Adobe\CEP\extensions\com.aefontpre.preview
```

**macOS:**
```
/Library/Application Support/Adobe/CEP/extensions/com.aefontpre.preview
```

또는 사용자별 설치:
```
~/Library/Application Support/Adobe/CEP/extensions/com.aefontpre.preview
```

#### 2. 디버그 모드 활성화 (개발/테스트용)

**Windows:**
1. 레지스트리 편집기 열기 (`regedit`)
2. 다음 경로로 이동: `HKEY_CURRENT_USER\Software\Adobe\CSXS.12`
3. `PlayerDebugMode` DWORD 값 생성 및 값으로 `1` 설정

**macOS:**
```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode -bool true
```

### 3. After Effects 재시작

After Effects를 재시작하면 플러그인이 자동으로 로드됩니다.

## 사용 방법

### 1. 플러그인 열기

After Effects 메뉴에서:
```
Window > Extensions > AE Font Preview
```

### 2. 폰트 미리보기

1. **미리보기 텍스트 입력**: 상단 텍스트 영역에 원하는 텍스트 입력
   - 기본값: "가나다라마바사 ABCD 1234 あいうえお"
2. **폰트 크기 조절**: 슬라이더로 프리뷰 크기 조절 (12px-72px)
3. **폰트 목록**: 자동으로 로드된 폰트 목록에서 미리보기 확인
4. **폰트 검색**: 검색창에 폰트 이름 입력으로 필터링

### 3. 폰트 적용

1. 원하는 폰트 클릭하여 선택 (파란색 하이라이트 표시)
2. After Effects에서 텍스트 레이어 선택
3. **"선택된 폰트 적용"** 버튼 클릭
4. 선택된 모든 텍스트 레이어에 폰트가 적용됨

### 4. 언어 변경

우측 상단 언어 선택기에서:
- 한국어
- English
- 日本語

## 파일 구조

```
com.aefontpre.preview/
├── manifest.xml          # CEP 확장 매니페스트
├── index.html            # 메인 HTML 파일
├── css/
│   └── styles.css        # 스타일시트
├── js/
│   ├── app/              # 프런트엔드 모듈 (i18n, Python 브리지, 유틸)
│   ├── services/         # Python 헬퍼 통신 모듈
│   ├── fontLoader.js     # 웹폰트 로딩 유틸
│   ├── fontRender.js     # 렌더링 계획 계산
│   └── main.js           # UI 오케스트레이션
├── jsx/
│   └── hostscript.jsx    # ExtendScript 백엔드
└── python/
    ├── font_server.py    # Windows GDI 기반 로컬 폰트 서버
    └── font_inspector.py # GDI name 테이블 파서
```

## 주요 기능 상세

### 폰트 목록 가져오기

플러그인은 두 가지 방법으로 폰트 목록을 가져옵니다:

1. **After Effects 텍스트 레이어**: 임시 텍스트 레이어를 생성하여 시스템 폰트 목록 가져오기
2. **Python GDI 헬퍼**: CEP(Chromium)가 렌더링하지 못하는 FR_PRIVATE/동적 폰트는 로컬 Python 서버가 GDI로 직접 렌더링한 이미지를 제공합니다.

### 지원되는 폰트

- **라틴 문자**: Arial, Times New Roman, Helvetica 등
- **한국어**: 맑은 고딕, 돋움, 굴림, 바탕, 궁서 등
- **일본어**: MS Gothic, MS Mincho, Meiryo 등
- **중국어**: SimSun, Microsoft YaHei 등

### 텍스트 레이어 제어

- 선택된 여러 텍스트 레이어에 동시 폰트 적용
- 폰트 적용 실패 시 상세 오류 메시지 표시
- 텍스트 레이어가 아닌 레이어는 자동으로 건너뛰기

## 문제 해결

### 플러그인이 메뉴에 표시되지 않을 경우

1. **설치 경로 확인**: 올바른 CEP extensions 폴더에 설치되었는지 확인
2. **디버그 모드**: PlayerDebugMode가 활성화되었는지 확인
3. **After Effects 버전**: 2022 이상 버전인지 확인
4. **매니페스트 버전**: manifest.xml의 버전 범위 확인

### 폰트 목록이 표시되지 않을 경우

1. **활성 컴포지션**: 컴포지션이 열려있는지 확인
2. **권한 문제**: After Effects에 파일 시스템 접근 권한이 있는지 확인
3. **폰트 새로고침**: "폰트 새로고침" 버튼 클릭

### 폰트 적용이 실패할 경우

1. **레이어 선택**: 텍스트 레이어가 선택되었는지 확인
2. **폰트 유효성**: 선택된 폰트가 시스템에 설치되어 있는지 확인
3. **컴포지션 활성화**: 활성 컴포지션이 있는지 확인

### Python 폰트 헬퍼가 반복적으로 재시작하거나 패널이 새로고침될 경우

- `Ctrl+F12` (Windows) 또는 `Cmd+F12` (macOS)로 CEP 로그를 확인해 에러 메시지를 확인합니다.
- 임시로 Python 헬퍼를 비활성화하려면 패널이 열린 상태에서 개발자 콘솔(또는 `Window > Extensions > Adobe Extension Debugger`)에 아래 명령을 실행하세요.

```javascript
localStorage.setItem('AEFP_DISABLE_PYTHON', '1');
location.reload();
```

- 다시 활성화하려면 값을 `0`으로 바꾸거나 항목을 삭제하세요.

## 개발 정보

### 기술 스택

- **프론트엔드**: HTML5, CSS3, JavaScript (ES6+)
- **백엔드**: ExtendScript (JSX)
- **통신**: Adobe CEP CSInterface API
- **UI 프레임워크**: 순수 HTML/CSS (외부 라이브러리 없음)

### 커스터마이징

플러그인은 오픈 소스이며 다음과 같이 커스터마이징 가능:

- **테마**: `css/styles.css`에서 색상 및 레이아웃 수정
- **언어**: `js/main.js`의 `translations` 객체에 새로운 언어 추가
- **기능**: `jsx/hostscript.jsx`에서 ExtendScript 기능 확장

## 라이선스

이 플러그인은 MIT 라이선스 하에 배포됩니다. 자유롭게 사용, 수정, 재배포 가능합니다.

## 지원 및 피드백

버그 리포트, 기능 요청, 개선 제안은 다음 채널을 통해 전달해주세요:

- GitHub Issues (저장소 주소)
- 이메일: [개발자 이메일]

## 버전 히스토리

### v1.0.0 (2025-11-03)
- 초기 릴리스
- 기본 폰트 프리뷰 기능
- 한국어/영어/일본어 지원
- After Effects 2022+ 호환성

---

**제작**: AE Font Preview Development Team  
**최종 업데이트**: 2025년 11월 3일
# AE-fontpre
