# Font Server - Windows 실행 파일 빌드 가이드

## 📋 사전 요구사항

- **Python 3.8+** 설치됨
- **Windows** 환경

## 🚀 빌드 방법

### 1️⃣ 의존성 설치

```bash
cd com.aefont.preview/python
pip install -r requirements.txt
```

### 2️⃣ 실행 파일 빌드

```bash
python build_exe.py
```

빌드 완료 후 다음 위치에 생성됩니다:
```
com.aefont.preview/bin/win/font_server.exe
```

### 3️⃣ 테스트

```bash
cd ../bin/win
font_server.exe
```

브라우저에서 확인:
- http://localhost:8765/ping
- http://localhost:8765/fonts

종료: `Ctrl+C`

---

## 📦 빌드 결과

### 파일 구조
```
com.aefont.preview/
├── bin/
│   └── win/
│       └── font_server.exe  ← 실행 파일 (약 15-20MB)
├── python/
│   ├── font_server.py       ← 원본 소스
│   ├── requirements.txt
│   ├── build_exe.py
│   ├── BUILD.md
│   ├── dist/                ← PyInstaller 출력
│   └── build/               ← 임시 빌드 파일
```

### 빌드 옵션 설명

`build_exe.py` 내부 PyInstaller 옵션:
```python
--onefile         # 단일 실행 파일 (DLL 포함)
--noconsole       # 콘솔 창 숨김 (백그라운드 실행)
--name=font_server  # 출력 파일명
--strip           # 디버그 심볼 제거 (크기 감소)
--hidden-import   # Tkinter 명시적 포함
```

---

## 🔧 트러블슈팅

### ❌ "Pillow not found"
```bash
pip install Pillow>=10.0.0
```

### ❌ "PyInstaller not found"
```bash
pip install pyinstaller>=6.0.0
```

### ❌ "Tkinter not available"
Python이 Tkinter와 함께 설치되었는지 확인:
```bash
python -c "import tkinter; print('OK')"
```

Windows에서 Python 재설치 시 "tcl/tk and IDLE" 옵션 체크

### ❌ 실행 파일이 너무 큼 (>50MB)
정상입니다. 다음이 포함되어 있습니다:
- Python 인터프리터
- Tkinter/Tcl/Tk 라이브러리
- Pillow 이미지 처리 라이브러리

압축을 원하면 UPX 사용 (선택):
```bash
# build_exe.py에서 --noupx 제거
```

---

## 📝 수동 빌드 (고급)

build_exe.py를 사용하지 않고 직접 빌드:

```bash
pyinstaller --onefile --noconsole --name=font_server ^
  --hidden-import=tkinter ^
  --hidden-import=tkinter.font ^
  --hidden-import=PIL._tkinter_finder ^
  --strip --noupx ^
  font_server.py
```

---

## 🔒 코드 사이닝 (배포용)

SmartScreen 경고를 없애려면 코드 사이닝 필요:

### 1. 인증서 구매
- DigiCert, Sectigo 등
- EV 인증서 권장 ($300-400/년)

### 2. 서명
```bash
signtool sign /f certificate.pfx /p password /t http://timestamp.digicert.com font_server.exe
```

### 3. 확인
```bash
signtool verify /pa font_server.exe
```

---

## 🍎 macOS 빌드 (예정)

현재 Windows 전용입니다. macOS 지원 예정:

```bash
# macOS에서
python build_exe_mac.py
# → bin/mac/font_server
```

---

## 📚 참고 자료

- [PyInstaller 공식 문서](https://pyinstaller.org/)
- [Tkinter 번들링](https://github.com/pyinstaller/pyinstaller/wiki/Recipe-Tkinter)
- [코드 사이닝](https://docs.microsoft.com/en-us/windows/win32/seccrypto/signtool)
