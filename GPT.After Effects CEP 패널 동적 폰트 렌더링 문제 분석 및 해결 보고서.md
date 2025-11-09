  # After Effects CEP 패널 동적 폰트 렌더링 문제 분석 및 해결 보고서

## 1. 기술 분석: Windows 폰트 시스템 동작 원리와 GDI vs Tkinter 차이 {#기술-분석-windows-폰트-시스템-동작-원리와-gdi-vs-tkinter-차이}

### Windows 폰트 로딩과 열거

Windows에서는 시스템 부팅 시 또는 로그인 시 레지스트리의 **Fonts**
항목을 읽어 폰트를 메모리에
로드합니다[\[1\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=When%20GDI%20is%20initialized%20during,those%20APIs%20for%20each%20entry)[\[2\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs).
전통적으로 전역(system-wide) 설치 폰트는
`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`에 등록되고
`C:\Windows\Fonts`에 저장됩니다. Windows 10부터는 **사용자별(User)**
폰트 개념이 도입되어, 개별 사용자만 사용할 폰트는
`HKCU\Software\...\Fonts`에 등록되며
`%LOCALAPPDATA%\Microsoft\Windows\Fonts` 등에
저장됩니다[\[3\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs).
GDI와 DirectWrite 모두 이러한 **설치(registered)** 폰트를 읽어 세션에
로드하며, 응용 프로그램은 이 **로딩된(font-loaded)** 폰트 목록을 통해
폰트를 사용할 수
있습니다[\[4\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=Installed%20vs)[\[5\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=When%20you%20get%20an%20enumeration,as%20fonts%20for%20that%20user).

**EnumFontFamiliesEx**와 같은 GDI API를 호출하면 현재 **해당
프로세스에서 사용 가능한** 폰트들을
열거합니다[\[5\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=When%20you%20get%20an%20enumeration,as%20fonts%20for%20that%20user).
여기에는 시스템 전역 폰트뿐만 아니라, **현재 사용자용으로 설치된
폰트**도
포함됩니다[\[6\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs).
일반적인 경우, 이 열거 결과는 제어판이나 Word 등의 폰트 목록과 일치하며,
GDI는 각 폰트의 **패밀리 이름**(예: \"Arial\")을 기반으로 폰트
페이스(예: \"Arial Bold\")들을 계층적으로 열거합니다. 반면 Tkinter의
`font.families()` 메서드는 내부적으로 Tcl/Tk가 GDI의 폰트 API를 사용하여
**GUI 컨텍스트에서 사용 가능한 모든 폰트 패밀리 이름**을 얻습니다. 결국
Tkinter도 GDI와 동일한 **시스템 폰트 테이블**을 참조하므로, 원칙적으로
`families()` 결과는 EnumFontFamiliesEx와 같아야 합니다. 실제로
Tkinter에서 `font.families()` 호출 시 **현재 프로세스**에서 인식되는
모든 폰트가 리스트업되며, FR_NOT_ENUM 등의 특수 플래그가 없는 한 GDI
열거와 동일한 폰트들이 포함됩니다.

**AddFontResourceEx** API는 실행 시간에 폰트 파일을 로드하여 폰트를
추가하는 기능을 제공합니다. 이 함수는 `fl` 플래그에 따라 폰트의 범위와
열거 가시성을 조정할 수
있습니다[\[7\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=one%20of%20the%20following%20values)[\[8\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=FR_NOT_ENUM%20Specifies%20that%20no%20process%2C,function%2C%20can%20enumerate%20this%20font):

- **FR_PRIVATE**(0x10): 해당 폰트를 **현재 프로세스에만** 추가합니다. 이
  경우 다른 프로세스는 이 폰트를 사용할 수 없으며, 폰트 이름이 공용
  폰트와 겹치면 현재 프로세스에서는 이 프라이빗 폰트가 우선
  사용됩니다[\[9\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=FR_PRIVATE%20Specifies%20that%20only%20the,process%20with%20the%20AddFontResourceEx%20function).
  프로세스가 종료되면 이렇게 추가한 폰트는 자동
  언로드됩니다[\[10\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=Value%20Meaning).
- **FR_NOT_ENUM**(0x20): 어떤 프로세스도 해당 폰트를 **열거(Enum)**하지
  못하게
  합니다[\[8\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=FR_NOT_ENUM%20Specifies%20that%20no%20process%2C,function%2C%20can%20enumerate%20this%20font).
  즉 폰트는 메모리에 로드되어 사용할 수는 있으나, EnumFontFamiliesEx나
  Tkinter `font.families()` 결과에는 나타나지
  않습니다[\[11\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,Must%20be%20zero).
  (FR_NOT_ENUM을 사용하는 경우에도 **FR_PRIVATE가 지정되지 않았다면**
  다른 프로세스도 이름을 알고 있다면 사용은 가능하나, 열거되지 않을
  뿐입니다.)

일반적으로 Windows는 Creative Cloud의 Adobe Fonts처럼 **동적 폰트
서비스**에서 활성화한 폰트를 사용자 세션에 로드할 때,
AddFontResourceEx를 호출해 폰트를 등록합니다. Adobe Fonts의 경우
사용자가 폰트를 활성화하면 해당 폰트를 **현재 사용자**에게 설치하고,
Creative Cloud가 WM_FONTCHANGE 브로드캐스트를 보내어 다른 앱들도 새
폰트를 인식하도록 합니다. 이때 Adobe Fonts나 산돌클라우드 폰트가
FR_PRIVATE로 로드되지는 않는 것으로 알려져 있습니다 (사용자가 모든
프로그램에서 폰트를 쓰길 원하기 때문) --- 대신 **일반 폰트처럼
설치**하되, 로그인 세션 종료 시 제거하는 방식일 가능성이 높습니다. 다만
서비스에 따라서는 폰트를 열거 목록에 노출하지 않기 위해 **FR_NOT_ENUM**
옵션을 활용했을 가능성도 있습니다 (예: 산돌클라우드 폰트를 사용자의
OS에는 로드하지만, 시스템 폰트 목록에는 표시하지 않는 식). FR_NOT_ENUM
폰트는 폰트 리스트 UI에는 숨겨지지만, 프로그램이 이름을 지정하면 사용은
가능하도록 설계되어
있습니다[\[11\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,Must%20be%20zero).
**FR_PRIVATE** 폰트는 그 폰트를 로드한 **같은 프로세스** 내에서만
보이며, 다른 프로세스 (예: After Effects CEP 패널의 별도 Python
프로세스)에서는 전혀 인식되지
않습니다[\[12\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=%23%20The%20new%20font,Scriptina%2020%7D%20pack%20.lab1).

**문제의 원인:** After Effects CEP 패널의 `font_server.py`가 GDI를
이용해 폰트를 그릴 때 일부 동적 폰트가 **기본 폰트로 대체(Render
fallback)**되는 이유는, 요약하면 **해당 폰트가 GDI에서 제대로 선택되지
않았기 때문**입니다. 그 기술적 배경을 몇 가지로 정리하면:

- **이름 해상도 문제:** GDI의 `CreateFontIndirectW`는
  `LOGFONT.lfFaceName`으로 지정한 이름과 가장 잘 맞는 폰트를 선택합니다.
  만약 이 이름이 시스템에 **없는 폰트 이름**이거나 정확히 일치하지
  않으면 GDI는 비슷한 폰트나 기본 폰트로
  **대체(substitute)**합니다[\[13\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=It%27s%20not%20CreateFontIndirect%20that%27s%20doing,you%20the%20same%20LOGFONT%20back)[\[14\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=LOGFONT).
  예를 들어 코드에서 \"산돌고딕 Bold\"라는 전체 이름을 전달했는데 GDI는
  해당 이름을 모르는 경우, 기본적으로 같은 패밀리나 기본 글꼴로 텍스트를
  그리게 됩니다. Tkinter의 `families()`는 **실제 GDI가 인식하는 패밀리
  이름**을 반환하기 때문에, Tkinter를 통해 렌더링할 때는 올바른 이름이
  사용되어 폰트가 적용됩니다. 반면, font_server.py는 FontTools로 추출한
  PostScript 이름이나 풀네임을 사용했을 가능성이 있는데, GDI에서는
  **폰트 패밀리 이름(ID 1)**이 아니면 인식하지 못해 대체가 일어난 것으로
  보입니다. 실제로 GDI는 오래된 API라 OpenType Name ID 16/17(영문
  타이포그래피 패밀리 이름 등)을 직접 제공하지 않으며, 오직 전통적인
  Family/Style 이름(ID 1/2)을 통해 폰트를
  구분합니다[\[15\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=,anything%20to%20indicate%20it%20is).
  따라서 Adobe나 산돌 폰트처럼 패밀리/서브패밀리 이름과 PostScript
  이름이 다를 경우, **올바른 이름 매핑이 중요**합니다.

- **폰트 로드 여부:** 해당 폰트가 현재 프로세스에 **로드되어 있지 않은
  경우** GDI는 원하는 폰트를 찾지 못해 기본 폰트를 사용합니다. 예를 들어
  산돌클라우드 폰트가 **산돌 클라우드 프로그램 프로세스에서만
  FR_PRIVATE로 로드**되어 있고, Windows 전역 설치가 아니라면, CEP 패널의
  Python 프로세스에서는 그 폰트가 존재하지 않는 것이 됩니다. 이 경우
  `CreateFontIndirectW`는 요청한 이름을 찾지 못하고 결과적으로 Arial
  등의 기본 글꼴로 대체합니다. 한편 Tkinter를 font_preview.py에서 구동한
  경우, 만약 **Tkinter가 산돌 클라우드와 같은 프로세스**(예: 산돌
  프로그램 내부)에서 실행됐다면 폰트를 인식할 수 있겠지만, 별도
  프로세스에서 실행했다면 GDI와 마찬가지로 보이지 않았을 것입니다.
  사용자가 Tkinter로 테스트했을 때 문제없이 렌더링되었다면, 아마도 해당
  폰트들은 FR_PRIVATE가 아니라 **전역/사용자 폰트로 로드**되어 있었고,
  단지 GDI 이름 매칭 실패로 font_server.py에서 못 쓴 것으로 추정됩니다.
  (Adobe Fonts의 경우 활성화 시 **사용자 폰트**로 설치되므로,
  Tkinter/FontServer 프로세스 모두에서 인식됩니다.)

- **FR_NOT_ENUM 영향:** 만약 동적 폰트가 AddFontResourceEx로 FR_NOT_ENUM
  옵션으로 로드되었다면, **어떤 프로세스도 열거하지 못하므로**
  font_server.py의 Tkinter 기반 폰트 나열에는 빠질 수 있습니다. 하지만
  FR_NOT_ENUM 폰트라도 GDI `CreateFont`로 이름을 직접 지정하면 사용은
  가능합니다[\[11\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,Must%20be%20zero).
  따라서 font_server.py에서 해당 폰트 파일을 찾아 **이름을 알고
  있었다면** CreateFontIndirectW로 렌더링을 시도할 수는 있습니다.
  문제는, **이름 충돌 또는 잘못된 이름**으로 인해 CreateFontIndirectW가
  **다른 글꼴을 선택**했을 가능성이 높습니다. 예를 들어 Adobe 폰트
  \"Source Han Sans\"가 FR_NOT_ENUM으로 로드되어 있고, font_server.py가
  이 폰트의 PostScript 이름(\"SourceHanSansKR-Regular\")을 사용했다면
  GDI는 이를 몰라 기본글꼴로 그렸을 것입니다. 반면 Tkinter
  `families()`는 해당 폰트의 패밀리 이름(\"Source Han Sans KR\")을
  반환했을 것이고, Tkinter로 렌더링할 땐 정확한 폰트가 적용되었을
  겁니다.

- **문자셋/로케일 이슈:** GDI의 EnumFontFamiliesEx와
  CreateFontIndirectW는 `LOGFONT.lfCharSet`에 지정된 문자셋을 참고하여
  폰트를 찾습니다. font_server.py 코드를 보면
  `lfCharSet = DEFAULT_CHARSET`으로 설정하고
  있는데[\[16\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=logfont,lfFaceName%20%3D%20face),
  GDI는 DEFAULT_CHARSET인 경우 해당 이름과 가장 잘 맞는 글꼴을
  선택하지만, 로케일에 따라 다르게 작동하기도
  합니다[\[17\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=3).
  예를 들어 \"MS Gothic\" 폰트를 DEFAULT_CHARSET으로 요청하면 영문
  OS에서는 \"MS Gothic\"이 선택되지만, 일본어 로캘에서는 이름이 같아도
  내부적으로 \"ＭＳ ゴシック\"를 선택하는
  식입니다[\[17\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=3).
  대체로 DEFAULT_CHARSET이면 큰 문제는 없지만, 폰트에 따라 Unicode
  문자셋이 아닌 OEM/DBCS charset 이름으로만 등록된 경우 열거에 누락될 수
  있습니다. Tkinter `families()`는 이러한 폰트도 모두 문자열로
  반환하지만, font_server.py의 GDI 스캔은 이러한 세부사항을 놓쳤을
  가능성도 있습니다 (다만 DRM 폰트 사례와 직접 연관성은 낮습니다).

**정리:** Tkinter에서 동일한 폰트들이 정상 렌더링된 반면 GDI 경로에서는
기본 폰트로 대체된 이유는 **주로 폰트 이름 식별과 접근 범위 차이**
때문입니다. Windows GDI는 폰트가 **현재 프로세스에 로드**되어 있고
**정확한 패밀리 이름**으로 요청될 때에만 올바른 렌더링을 합니다.
Tkinter는 내부적으로 **유효한 폰트 패밀리 이름**을 사용하여 폰트를
지정하기 때문에 렌더링에 성공했습니다. 반면 font_server.py 초기 구현은
동적 폰트의 **이름 해상도(name resolution)**를 충분히 처리하지 못해
GDI가 엉뚱한 대체를 하게 되었거나, 혹은 폰트가 애초에 그 프로세스에
**로드되지 않은 상태**였을 수 있습니다. 또한 AddFontResourceEx의 특수
옵션(FR_PRIVATE/FR_NOT_ENUM)으로 인해 **GDI 열거와 접근에 제약**이 걸린
폰트들의 경우, 별도 처리 없이 기본 폰트로 그려졌을 것입니다. 이 모든
원인을 해결하려면 GDI와 Windows 폰트 시스템의 동작을 정확히 이해하여,
**폰트 이름 매핑 로직 개선과 폰트 접근성 확보(필요 시 폰트 로드)**가
필요합니다.

## 2. 해결책 옵션 비교: font_server.py의 렌더 커버리지를 높이는 방안 {#해결책-옵션-비교-font_server.py의-렌더-커버리지를-높이는-방안}

문제 원인을 토대로 세 가지 해결 방향을 고려할 수 있습니다. 각 방안의
개요와 장단점을 정리하면 다음과 같습니다:

| **옵션**                                                                 | **설명**                                                                                                                                                                                                                                                                                                                                                                                                         | **장점**                                                                                                                                                                                                                                                      | **단점**                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **A. GDI 이름 해상도 보강** \<br\>(PostScript 이름, 패밀리 이름 등 활용) | GDI `CreateFontIndirectW`에 폰트를 생성할 때 **여러 이름 정보**를 시도하여 올바른 폰트를 선택하도록 하는 방법입니다. FontTools로 추출한 패밀리명(ID 1), 전체 이름(ID 4), PostScript명(ID 6), **타이포그래픽 패밀리명**(ID 16) 등을 모두 확보한 뒤, GDI가 인식할 만한 이름을 선택/변환합니다. 또한 폰트 이름에 Bold/Italic 등이 포함된 경우 LOGFONT의 `lfWeight`, `lfItalic` 플래그를 맞춰주는 작업도 포함됩니다. | \- 기존 GDI 렌더링 경로를 크게 변경하지 않고 **정확도만 향상**시킬 수 있습니다. \<br\>- CreateFontIndirectW를 통해 렌더링하면 GDI 서브픽셀 렌더링, 힌팅 등 **OS 기본 렌더링 품질**을 유지합니다. \<br\>- 별도 GUI 의존성 없이 순수 Python+ctypes로 구현 가능. | \- 다양한 폰트의 네이밍 규칙을 모두 포괄하는 로직을 짜야 하므로 **구현 복잡도**가 높습니다. (예: \"산돌고딕체 Bold\" vs \"SandollGothic-Bold\" vs \"Sandoll Gothic\" 등 케이스별 처리) \<br\>- 폰트가 현재 프로세스에 **로드되지 않은 경우** 이름을 제대로 맞춰도 여전히 렌더링 실패합니다. (즉, 근본적으로 폰트 접근 불가인 상황은 해결 못함) \<br\>- FR_PRIVATE로 로드된 폰트는 아예 접근 불가이므로 이 옵션만으로는 그런 폰트를 다룰 수 없습니다. |

\| **B. Tkinter/별도 엔진 활용** \<br\>(Tkinter Canvas 또는 PIL로 직접
그리기) \| GDI를 우회하고 **Tkinter의 폰트 렌더링** 기능이나 파이썬
Imaging Library(PIL)의 FreeType 엔진을 사용하여 폰트 미리보기를
생성합니다. 예를 들어, Tkinter에서 `Canvas` 위젯에 텍스트를 그린 뒤
이미지를 캡처하거나, PIL의 `ImageFont.truetype`으로 폰트 파일을 직접
불러와 그립니다. font_preview.py에서 Tkinter로 미리보기를 성공한 것처럼,
**고수준 라이브러리**에 폰트 처리를 맡기는 방식입니다. \| - 구현이
비교적 **간단**합니다. (예: PIL은 폰트 파일 경로만 주면 그 폰트를 바로
렌더링) \<br\>- Tkinter/PIL은 GDI 폰트 테이블에 없더라도 **폰트 파일만
있다면** 출력이 가능하므로, FR_PRIVATE나 미설치 폰트도 파일 확보 시
처리할 수 있습니다. \<br\>- Tkinter는 내부적으로 GDI를 사용할지라도 폰트
이름을 알아서 처리해주므로 개발자가 일일이 이름 매핑할 필요가 없습니다.
\| - **성능/의존성** 이슈: Tkinter 사용 시 매번 Canvas를 그려
캡처하거나, PIL의 FreeType 렌더링을 사용하는 것은 GDI 직접 호출보다 느릴
수 있습니다. 폰트 수십\~수백 개를 미리보기 생성 시 **속도 저하** 우려가
있습니다. \<br\>- Tkinter는 GUI 스레드에서 동작하므로 CEP 패널 환경에서
**메인 스레드 UI와 충돌**하지 않도록 주의가 필요합니다. (예: tkinter를
백그라운드로 돌리려면 `withdraw()` 사용 등) \<br\>- PIL의 렌더링은 GDI와
**윤곽선 해석이나 hinting 방식**이 달라 약간의 렌더링 차이가 발생할 수
있습니다. (대부분 품질 상 문제 없으나, 극소수 폰트는 GDI ClearType과
차이) \<br\>- 새로운 라이브러리 사용에 따른 **패널 배포 용량 증가**나
복잡성 상승. (Python에 Tk/PIL 포함은 기본이지만 환경에 따라 세팅 필요)
\|

\| **C. 하이브리드 접근** \<br\>(레지스트리+파일 스캔 + GDI 기본 +
필요시 Tkinter/PIL 폴백) \| 현재 font_server.py처럼 **여러 경로를
병행**하여 폰트를 검색·렌더링하는 방식입니다. 구체적으로:
\<ul\>\<li\>프로세스 시작 시 Tkinter `font.families()`나 GDI
EnumFontFamiliesEx로 **사용 가능한 폰트 목록**을
얻고,\</li\>\<li\>레지스트리(HKLM\...Fonts + HKCU Fonts)와 폰트
디렉토리(Windows\Fonts, LocalAppData\Fonts, 산돌 클라우드 폴더 등)를
**스캔**하여 폰트 이름→파일 경로 매핑을
구축합니다,\</li\>\<li\>미리보기를 요청받으면 우선 GDI로 렌더링을
시도하고, **문제가 감지되면** 대안 경로로 그립니다 (예: GDI에서 텍스트
폭이 지나치게 작아 기본폰트로 예상되면 Tkinter/PIL로 다시
렌더).\</li\>\</ul\> 또한 이름 해상도도 옵션 A 수준으로 보강하고, 필요시
`AddFontResourceEx`를 사용해 **런타임 폰트 로드**까지 수행할 수
있습니다. \| - 각 방법의 **장점을 조합**하여 대부분의 상황을 다 커버할
수 있습니다. 일반 폰트는 GDI로 빠르게 처리하고, 특이 케이스만 다른
엔진을 쓰면 효율적입니다. \<br\>- 문제가 되는 폰트에 한해서만 대체
경로를 쓰므로 **품질과 호환성**을 최대한 유지합니다 (예: 대부분 GDI
출력, 예외적으로 PIL 출력). \<br\>- 폰트 파일 스캔 캐시를 통해
PostScript명, 패밀리명 등 **다양한 이름을 맵핑**해둘 수 있어 이름 충돌을
줄입니다. \<br\>- 폰트 로드까지 수행하면 이론상 **어떤 폰트든 출력
가능**합니다 (예: 남의 프로세스에만 로드된 폰트도 파일만 있으면
AddFontResourceEx로 로드). \| - 구현이 가장 **복잡**합니다. 폰트 목록
관리, 캐시, 폴백 로직, 리소스 정리(AddFontResourceEx로 로드한 폰트 제거
등)까지 고려해야 합니다. \<br\>- 두 가지 경로의 **렌더링 일관성** 문제가
있습니다. 예를 들어 GDI와 PIL의 안티앨리어싱 차이로 미세하게 다르게 보일
수 있습니다. 패널 내 모든 미리보기에 통일성을 주려면 일부 폰트만 다른
엔진으로 그릴 때 티가 날 수 있습니다. \<br\>- 최악의 경우 성능 면에서
A/B의 단점을 모두 가질 수도 있습니다. (잘못 구현하면 모든 폰트에 대해
GDI 실패 → PIL 시도 등 오버헤드) \<br\>- 유지보수가 어려워질 수 있으며,
Windows API와 서드파티 엔진 양쪽을 모두 신경써야 하므로 **버그 발생
가능성**이 높아집니다. \|

위 표에서 보듯 **옵션 A**는 GDI 경로를 개선하는 것으로 **근본적인 정확도
향상**에 초점이 있고, **옵션 B**는 애초에 GDI를 통하지 않아 **확실한
렌더링**을 얻는 접근입니다. **옵션 C**는 이러한 방법들을 조합해 장점을
취하되, 구현 난이도가 상승하는 타협안입니다.

### 권장 방안: **Option C (하이브리드 방식)**

현 상황에서는 **하이브리드 방식 (옵션 C)**이 가장 타당한 해결책으로
판단됩니다. 이유는 다음과 같습니다:

- **동적 폰트 환경 대응:** 이름 이슈만 있는 폰트라면 옵션 A로
  해결되겠지만, 혹시 폰트가 FR_PRIVATE 등으로 로드되어 GDI에 **존재하지
  않는 경우** 옵션 A만으로는 손쓸 수 없습니다. 옵션 C에서는 파일 스캔 +
  AddFontResourceEx 같은 전략으로 이런 폰트도 다룰 수 있습니다. 즉 **DRM
  기반 폰트처럼 변칙적인 상황까지 포괄**할 수 있습니다.

- **기존 코드/호환성 활용:** font_server.py가 이미 Tkinter 목록,
  fontTools 스캔, GDI 렌더링을 일부 구현해둔 만큼, 이를 확장한 C 방식이
  **개발 효율**이 높습니다. 실제 코드에서도 FontNameResolver로 이름
  해상도 보강(A)와 Tkinter 목록 사용(B)을 병행하고 있으므로, 설계 취지에
  부합하게 그 노선을 발전시키는 게 좋습니다.

- **렌더링 퀄리티 및 성능 균형:** 일괄적으로 Tkinter/PIL로 그리는
  B방식은 구현은 쉽지만 GDI ClearType 렌더링과 달라 보일 수 있고, CPU
  사용량도 증가합니다. 반면 C방식에서는 **대부분 GDI로 그리고 예외만
  다른 방식**을 쓰므로, 사용자에게 **일관된 품질**을 제공하면서 성능도
  필요 최소한만 희생하게 됩니다.

- **미래 확장성:** 하이브리드 접근은 추후 Mac 지원 등 이식성 측면에서도
  도움이 됩니다. 예를 들어 Mac에서는 CTFont/Quartz로 기본 렌더링을
  하다가 예외 시 대체 경로를 쓰는 식으로, 구조를 비슷하게 가져갈 수
  있습니다. 하나의 방법에 올인하는 것보다 상황별 최적 경로를 선택하는
  구조가 유지보수에 유리합니다.

물론 옵션 C는 구현 복잡도가 높으므로, **명확한 우선순위와 폴백 조건**을
잘 정의하는 것이 중요합니다. 다음 섹션에서는 권장안(C)의 구현 전략을
구체적으로 설명합니다.

## 3. 구현 가이드: 하이브리드 폰트 렌더링 개선 {#구현-가이드-하이브리드-폰트-렌더링-개선}

선택한 **옵션 C**를 구현하려면 세 가지 핵심 부분이 있습니다: **폰트
데이터 수집**, **이름 해상도 및 렌더링**, **폴백 처리 로직**. 각각에
대한 방안을 코드 예시와 함께 제시합니다.

### 3.1 폰트 목록 및 경로 수집 {#폰트-목록-및-경로-수집}

먼저 font_server.py가 이미 수행하고 있듯, **여러 출처**에서 폰트 정보를
모아야 합니다. 구체적으로:

- **Tkinter/GDI 열거를 통한 사용 가능한 폰트 패밀리 수집:** Tkinter의
  `font.families()` (혹은 EnumFontFamiliesEx)로 현재 프로세스에 로드된
  **폰트 패밀리 이름 리스트**를 얻습니다. 이는 최종 사용자에게 보여줄
  **폰트 목록**이자, GDI로 렌더링할 때 유효한 **패밀리 명**의 집합이
  됩니다. `FontRegistry` 클래스 초기화 시 한 번 실행하고 결과를 캐싱하면
  됩니다. (이미 코드에서 `self._families`로 보관하고 있음).

- **윈도우 레지스트리 조회:** `winreg` 모듈로 HKLM의 Fonts 키 (및
  필요하면 HKCU Fonts 키)를 열어서 폰트 이름별 파일 경로를 읽습니다.
  이때 `값 이름`이 일반적으로 폰트의 영어 이름 (예: \"Adobe 명조 Bold
  (TrueType)\")이고 `값 데이터`가
  파일명입니다[\[18\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=with%20winreg.OpenKey%28winreg.HKEY_LOCAL_MACHINE%2C%20r,join%28fonts_dir%2C%20font_path)[\[19\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=NT%5C%5CCurrentVersion%5C%5CFonts,exists%28font_path%29%3A%20norm_key%20%3D%20normalize%28font_name).
  레지스트리의 값 이름은 **폰트 실제 이름과 정확히 일치하지 않을 수**
  있으므로, FontRegistry에서는 이 이름들을 정규화하여 `_cache`에
  등록해야 합니다. 예를 들어 \"Adobe 명조 Bold (TrueType)\"라는
  레지스트리 항목에서 파일 경로를 얻었다면, FontTools로 **폰트 파일 안의
  실제 패밀리명**(\"Adobe Myungjo\")을 추출해 `_cache`에 추가하면 더
  정확합니다. (font_server.py 코드에서는 일단 레지스트리 이름을 그대로
  normalize하여 `_cache`에 넣고 `_remember_alias`
  처리[\[20\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=try%3A%20font_name%2C%20font_value%2C%20_%20%3D,remember_alias%28font_name)를
  하고 있는데, 가능하면 fontTools로 내부 이름 재검증을 권장합니다.)

- **폰트 디렉토리 스캔:** 레지스트리에 없는 폰트 (예: 사용자가
  `%LOCALAPPDATA%\Fonts`에 설치한 개인 폰트나, Adobe/Sandoll 클라우드
  앱이 자체 관리하는 폰트 폴더)를 커버하기 위해 **파일 시스템 스캔**이
  필요합니다. 이미 코드에서는 Windows 기본 폴더와 산돌 클라우드 관련
  경로를 지정해
  놓았습니다[\[21\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=search_dirs%20%3D%20,LocalLow%27%20%2F%20%27SandollCloud%27%20%2F%20%27fonts).
  이 리스트를 유지하되, **Adobe Fonts 경로**도 추가로 고려할 수
  있습니다. Adobe Fonts는 활성화 시 `%LOCALAPPDATA%\Adobe\Fonts` 또는
  `%AppData%\Adobe\CoreSync` 아래에 폰트를 저장할 가능성이 있으므로,
  Adobe 관련 경로도 조사해보는 것이 좋습니다. 스캔한 폰트 파일들은
  FontTools의 TTFont을 사용해 name table을 파싱, **모든 NameID
  문자열**을
  수집합니다[\[22\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20extract_font_names,fonts)[\[23\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=except%20KeyError%3A%20continue%20for%20record,decode%28errors%3D%27ignore).
  이렇게 얻은 모든 이름(패밀리, 풀네임, PostScript 등)을 normalize하여
  `_aliases`와 `_cache`에 추가하면, 후에 이름 해상도할 때 요긴합니다.

위 과정을 통해 `FontRegistry._cache`에는 **정규화된 폰트이름 →
파일경로** 매핑이 채워지고, `_aliases`에는 정규화 이름 → 원본 다양한
이름들 세트가 채워집니다. `FontRegistry.families`에는 UI 표시용 패밀리
목록이 저장됩니다. 이 준비 단계에서 신경쓸 점:

- **이름 Normalize 통일:** 대소문자, 공백, 하이픈 차이 등을 무시하기
  위해 `normalize(name)` 함수를 일관되게
  적용합니다[\[24\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20normalize%28name%3A%20str%29%20,isalnum).
  font_server.py 구현처럼 영문/숫자만 추출하거나 소문자로 바꾸는 등
  기준을 세워 `_cache` 키로 써야 합니다.

- **중복 및 에일리어스(alias):** 동일한 폰트가 여러 이름으로 발견될 수
  있습니다. (예: \"Pretendard SemiBold\" vs \"Pretendard Semibold\"
  한글/영문 등) `_aliases` 맵을 활용해 이런 이름들을 묶어 관리하면
  나중에 `aliases_for(name)` 형태로 UI나 디버깅에 활용할 수
  있습니다[\[25\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20aliases_for,font_name).

- **Windows 버전 호환성:** Windows 7에서는 HKCU 폰트가 없고
  `%LOCALAPPDATA%\Fonts`도 존재하지 않지만, 코드가 해당 경로가 없으면
  건너뛰므로 문제 없습니다. Windows 10/11에서 HKCU Fonts (개인설치
  폰트)는 반드시 스캔해야 하므로, `winreg.OpenKey(HKCU, ...\Fonts)`도
  시도하는 게 안전합니다. 만약 권한 문제로 HKCU 접근이 어렵다면 (일부
  CEP sandbox 이슈), 파일 경로 스캔으로 대체 가능합니다.

- **산돌/Adobe 폰트 특이사항:** 산돌클라우드 폴더의 폰트는 보통 사용자가
  로그인하면 해당 폴더에 TTF/OTF로 풀어두는 것으로 보입니다. 하지만 혹시
  파일이 **암호화**되어 있거나 특수 확장자일 경우 FontTools가 못 읽을 수
  있으니 예외 처리가 필요합니다 (이미 코드에서 try/except로 감싸고 로그
  출력하도록 되어
  있음[\[26\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=try%3A%20for%20name%20in%20extract_font_names,exc)).
  Adobe Fonts의 경우에도 최신 Type 1이나 Variable font일 가능성이
  있는데, fontTools는 대부분 포맷을 지원하므로 큰 문제는 없습니다.

### 3.2 폰트 이름 해상도 및 GDI 렌더링 {#폰트-이름-해상도-및-gdi-렌더링}

이제 본격적으로 **미리보기 생성 요청**(`GET /preview/` 또는
`POST /batch-preview`)이 들어왔을 때의 처리를 설계합니다. 입력으로는
폰트 표시 이름, 텍스트, 크기 등이 주어집니다. font_server.py의 경우
`font_name`, `text`, `size` (및 style)이
제공됩니다[\[27\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20_handle_preview%28self%29%3A%20font_name%20%3D%20self,size%2C%20160%29%29%20try).

1.  **폰트 이름 해상도:** 우선 사용자가 선택한 `font_name` (예:
    \"산돌멋쟁이 Bold\")을 GDI가 이해할 수 있는 **face name**으로
    변환해야 합니다. FontRegistry와 fontTools 정보가 이미 메모리에
    있으므로, `FontNameResolver` 같은 유틸리티 클래스를 이용합니다. 실제
    코드에서 `FontNameResolver.resolve()`를 호출해 `faceName`, `weight`,
    `italic`를 얻고
    있습니다[\[28\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=,faceName)[\[29\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=%27%7Bface_name%7D%27%20%28weight%3D%7Bfont_weight%7D%2C%20italic%3D%7Bfont_italic%7D%2C%20source%3D%7Bresolved%5B%27source%27%5D%7D%29,is).
    이 로직을 참고하여 구현 시 주안점:

    - **PostScript 이름 우선 사용:** `postscript_name` 파라미터가 있다면
      (batch-preview에서는 JSON으로 줄 수 있음) 이를 최우선 참고합니다.
      FontNameResolver는 PS 이름이 있는 경우 해당 폰트의 **패밀리명
      추출**을
      시도합니다[\[30\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,strip%28%29%20else).
      예컨대 PS 이름 \"SandollCloud-Bold\"와 display_name \"SandollCloud
      Bold\"가 주어지면, display_name에서 스타일 부분(\"Bold\")을 제거한
      \"SandollCloud\"를 faceName으로
      선택합니다[\[30\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,strip%28%29%20else)[\[31\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=weight%2C%20italic%20%3D%20parse_style_flags,face_name%2C%20%27weight%27%3A%20weight%2C%20%27italic%27%3A%20italic).
      이렇게 하면 GDI에서 lfFaceName \"SandollCloud\"에
      weight=700(Bold)로 폰트를 생성하게 되어, 정확한 Bold 웨이트를
      선택할 가능성이 큽니다. 만약 PS 이름만 있고 display_name이 없으면
      어쩔 수 없이 PS 이름 자체를 faceName으로 쓰지만, GDI에서는 PS
      이름을 잘 모르므로 그런 경우는 드뭅니다. (다행히 Adobe/Sandoll
      폰트는 활성화되면 OS에 등록된 이름이 있기 마련입니다.)

    - **스타일 문자열 처리:** 폰트 이름에 \"Bold\", \"Italic\" 등이
      포함되어 있거나 별도 style 파라미터로 들어오면, 이를 파싱해
      `font_weight`(100\~900)과 `font_italic`(0/1)을 결정합니다.
      FontNameResolver의 `parse_style_flags` 함수는 여러 언어의 스타일
      키워드를 포괄하여 weight/italic을 산출하고
      있습니다[\[32\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,bold)[\[33\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=italic%20%3D%200%20if%20any,italic%20%3D%201).
      이 함수를 활용하거나 유사한 로직을 구현합니다. 핵심은, **폰트
      이름에서 Bold/Light 등을 제거한 패밀리 이름을 얻고**, Bold 등이
      있으면 LOGFONT.lfWeight에 반영하는 것입니다. 예를 들어
      \"나눔스퀘어라운드 ExtraBold\" → faceName \"나눔스퀘어라운드\",
      weight = 800.

    - **패밀리 이름 최후 수단:** PS 이름도 없고 display_name도
      체계화되지 않은 경우(옵션 3)에는 family_name(예: UI에서 패밀리
      따로 전달)이나 display_name 자체를 그대로 faceName으로
      씁니다[\[34\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,%27faceName%27%3A%20face_name%2C%20%27weight%27%3A%20weight).
      이때도 weight/italic는 한번 계산해두고요.

    - **해상도 결과 검사:** Resolver를 통해 얻은 faceName이 실제 GDI
      폰트 테이블에 있는지 검증할 필요가 있습니다. FontRegistry의
      `families` 리스트를 참고하여, 해당 faceName이 존재하지 않으면
      대소문자/공백 변환 등 다시 시도할 수 있습니다. 그러나
      font_server.py에서는 일단 Resolver 결과를 신뢰하고
      CreateFontIndirectW를 호출하고, 이후 실패 시 예외를 던지거나
      fallback으로 가는
      구조입니다[\[35\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=hfont%20%3D%20gdi32,CreateFontIndirectW%20failed)[\[36\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=calc_flags%20,DrawTextW%20failed%20during%20measurement).

2.  **GDI DC 및 Font 생성:** 이름이 결정되면 GDI로 텍스트를 그립니다.
    Ctypes로 `CreateCompatibleDC(NULL)`를 호출해 메모리 DC (`hdc`)를
    만들고[\[37\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=hdc%20%3D%20gdi32,CreateCompatibleDC%20failed),
    `LOGFONTW` 구조체를 설정한 뒤 `CreateFontIndirectW(&logfont)`로
    HFONT를
    생성합니다[\[38\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=logfont%20%3D%20LOGFONTW%28%29%20logfont,Use%20resolved%20face%20name)[\[35\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=hfont%20%3D%20gdi32,CreateFontIndirectW%20failed).
    이 과정에서 실패(`hfont == 0`)하면 바로 예외 처리(fallback으로)
    넘어갑니다[\[35\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=hfont%20%3D%20gdi32,CreateFontIndirectW%20failed).
    성공했다면 `SelectObject(hdc, hfont)`로 폰트를 DC에 선택합니다.

    - **실패 시 AddFontResourceEx 시도:** 만약 CreateFontIndirectW가
      실패했다면, **폰트가 아예 없는 경우**일 가능성이 높습니다. 이때
      곧바로 Tk/PIL 폴백으로 가기 전에, 한 번 **폰트 파일을 로드**해보는
      대안을 고려할 수 있습니다.
      `FontRegistry.resolve_path(font_name)`으로 폰트 파일 경로를 얻을
      수 있다면,
      `AddFontResourceExW(경로, FR_PRIVATE | FR_NOT_ENUM, 0)`을 호출하여
      임시로 이 프로세스에 폰트를 추가할 수
      있습니다[\[39\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,will%20remove%20all%20the%20%27temporary)[\[12\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=%23%20The%20new%20font,Scriptina%2020%7D%20pack%20.lab1).
      `FR_PRIVATE`를 줘도 같은 프로세스 내에서 바로 사용 가능하니
      문제없고, `FR_NOT_ENUM`를 함께 주어 다른 열거에 영향 주지 않도록
      할 수도 있습니다. 호출 결과가 0이면 로드 실패이므로 폴백하고,
      성공하면 다시 CreateFontIndirectW를 재시도합니다. 이렇게 하면 예를
      들어 산돌클라우드 폰트 파일이 존재하지만 GDI에 안 올라온 상황에서,
      **실시간으로 폰트를 로드**하여 사용할 수 있게 됩니다. (추후
      RemoveFontResourceEx로 정리 필요하지만, 프로세스 종료시 자동
      언로드되므로 상주해도 큰 문제는 없습니다.)

- # ctypes 준비 (전역 설정)
      gdi32.AddFontResourceExW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.PVOID]
      gdi32.AddFontResourceExW.restype = wintypes.INT

      # ... CreateFontIndirectW(hfont) 실패한 경우 ...
      font_path = REGISTRY.resolve_path(font_name)
      if font_path:
          res = gdi32.AddFontResourceExW(font_path, 0x10 | 0x20, None)  # FR_PRIVATE|FR_NOT_ENUM
          if res > 0:
              user32.SendMessageW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0)  # 다른 GUI에 폰트변경 통지 (필요시)
              hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))

  위 예시는 폰트 파일 경로가 있을 때만 AddFontResourceEx를 시도하고,
  로드 성공 시 다시 폰트를 만들어보는 흐름입니다. (HWND_BROADCAST로
  WM_FONTCHANGE 보내는 부분은 혹시 UI에 실시간 적용하려는 경우이지,
  여기서는 font_server 프로세스에서만 쓰면 되므로 꼭 필요하진 않습니다.)
  이 방법은 font_server 프로세스 메모리에 해당 폰트가 올라오므로 이후
  GDI 호출에서 제대로 폰트를 찾을 확률이 높습니다.

  - **텍스트 측정 및 비트맵 생성:** HFONT를 선택한 후 `DrawTextW`를
    `DT_CALCRECT` 모드로 호출해 텍스트 크기를
    잽니다[\[40\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=,byref%28calc_rect%29%2C%20calc_flags%29%20%3D%3D%200)[\[41\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=measured_width%20%3D%20max%28calc_rect.right%20,calc_rect.top%2C%20size).
    그 다음 `CreateDIBSection`으로 해당 크기의 비트맵(HBITMAP)을
    생성하고 DC에
    선택합니다[\[42\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=bits%20%3D%20ctypes,CreateDIBSection%20failed).
    배경 투명/텍스트색 설정 후, 다시 `DrawTextW`로 실제 텍스트를
    그립니다[\[43\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=,byref%28draw_rect%29%2C%20draw_flags%29%20%3D%3D%200).
    이때 font_server.py 구현처럼 흰 글씨로 그리고 나중에 픽셀 알파를
    조정하는 방식은 PNG로 투명텍스트를 얻기 위한
    테크닉입니다[\[44\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=buffer%20%3D%20ctypes.string_at%28bits%2C%20final_width%20,r%20or%20g%20or%20b)[\[45\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=alpha%20%3D%20max,0%2C%200%2C%200%2C%200).
    이 부분은 그대로 활용하면 되고, 또는 처음부터 RGBA DIB에 검정 글씨
    쓰고 투명 배경으로 처리하는 방법도 있습니다. 중요한 것은, 이
    단계에서 **폰트가 제대로 선택되었는지 확인**하는 것입니다.

  - **렌더링 결과 검증:** GDI는 요청한 폰트를 찾지 못하면 **대체
    폰트**로 그리기 때문에, 우리가 얻은 비트맵이 올바른 폰트의 것인지
    확인해야 합니다. 몇 가지 방법이 있습니다:

    i.  **GetTextFace API**: HFONT를 DC에 선택한 후
        `GetTextFaceW(hdc, ...)`를 호출하면 현재 선택된 글꼴의 이름을
        얻을 수
        있습니다[\[46\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=If%20you%20select%20the%20HFONT,best%20match%20to%20the%20LOGFONT).
        이 이름을 원래 기대한 faceName과 비교해서 다르면, substitution이
        일어난 것으로 판단할 수 있습니다. 예를 들어 \"Adobe 명조\"를
        원했는데 GetTextFace가 \"굴림\"을 반환하면 실패입니다. 다만
        GetTextFace가 로케일에 따라 다른 언어 이름을 줄 수 있어 단순
        string 비교에는 주의해야
        합니다[\[17\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=3).
        Normalize해서 비교하거나, 애초에 **DrawTextW 후 비트맵 픽셀
        분석**같은 직관적 방법도 있습니다.
    ii. **텍스트 폭 비교**: 기본 폰트로 그려졌다면 글리프 모양은 달라도
        폭이 같을 수도 있지만, Bold vs Regular 등의 차이는 폭 변화로
        감지 가능할 수 있습니다. 그러나 일반적이지 않은 방법이므로
        GetTextFace 사용을 권장합니다.
    iii. **비트맵 해시**: 미리 **기본 폰트(Ariel 등)**로 같은 텍스트를
         그려본 비트맵과 현재 비트맵을 비교해 같으면 실패로 보는 방법도
         생각해볼 수 있습니다. 하지만 각 텍스트 내용마다 해야 하므로
         비효율적입니다.

  GetTextFaceW 방식으로 substitution을 감지하면, 해당 요청에 대해서는
  GDI 결과를 폐기하고 **다른 방법으로 다시 렌더**해야 합니다 (다음 단계
  참조).

3.  **렌더 폴백 (Tkinter/PIL)**: GDI 경로가 어떤 이유로든 실패했다면
    이제 **대체 렌더링**을 수행합니다. 폴백 경로로는 두 가지가
    유력합니다: **Tkinter Canvas 이용** 또는 **PIL.ImageFont 이용**. 둘
    다 font_server.py에서 import되어 있으므로 환경 구성이 되어있다고
    가정합니다. 각각의 구현 방법은 아래와 같습니다.

    - **Tkinter Canvas 방식:** 숨겨진 Tkinter 루트
      (`root = Tk(); root.withdraw()`)를 만들어 두었으므로 그대로
      활용하면 됩니다. 새로운 윈도우를 나타내지 않도록 `withdraw()`는
      필수입니다[\[47\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=return).
      그런 다음 `Canvas` 위젯을 생성하여 `create_text`로 원하는 텍스트를
      그립니다. Canvas의 `font` 옵션에는 `(패밀리, 크기, 옵션)` 튜플이나
      `tkinter.font.Font` 객체를 지정할 수 있습니다. 예를 들어:

- root = REGISTRY._root  # 기존에 생성한 Tk root
      canvas = Canvas(root, width=final_width, height=final_height)
      canvas.create_text(0, 0, text=text, font=(face_name, size, style_flags), fill="white", anchor="nw")
      canvas.update()  # 캔버스 렌더링 업데이트
      canvas.postscript(file="out.ps", colormode='color')

  `postscript()`를 사용하면 해당 Canvas 내용을 벡터 형태로 EPS 파일로
  저장할 수 있습니다. 그러나 이를 다시 이미지로 변환해야 하는데, PIL에서
  `.ps` 파일을 읽을 수 있으면 좋지만 GhostScript 필요 등 복잡합니다.
  대신, Canvas를 직접 이미지로 얻는 편법으로 **TKPhotoImage**를 사용할
  수 있습니다. `postscript` 출력 대신, Tkinter의 `ImageGrab` (Windows
  전용)이나 `canvas.postscript` 결과를 BytesIO로 받아 PIL로 열 수도
  있습니다. 구현 난이도와 품질을 고려하면, Tk Canvas로 벡터 그린 후
  **안티앨리어싱 없이 rasterize**되는 점 등 제약이 있어 이보다는 차라리
  PIL을 직접 쓰는 방법이 나을 수 있습니다.

  - **PIL (Pillow) 방식:** PIL의 `ImageFont.truetype`으로 폰트 파일을
    직접 로드해 그리는 방법입니다. FontRegistry에서 `font_path`를 이미
    구했으므로, 이것을 사용합니다. 폴백 시나리오에서는 GDI가 실패한
    폰트는 아마도 **폰트 파일은 있지만 GDI에서 인식 못한 경우**일
    겁니다. 따라서 파일 경로로 TrueType 폰트를 불러와 PIL로 그림을
    그리면 확실합니다. 예를 들어:

  <!-- -->

      from PIL import Image, ImageDraw, ImageFont
      font_path = REGISTRY.resolve_path(font_name)
      pil_font = ImageFont.truetype(font_path, size)
      # 이미지 캔버스 준비 (배경 투명)
      img = Image.new("RGBA", (final_width, final_height), (0,0,0,0))
      draw = ImageDraw.Draw(img)
      draw.text((0, 0), text, font=pil_font, fill=(255,255,255,255))  # 흰색 텍스트
      # 필요하면 텍스트 영역 bounding box 조정 등

  위 코드로 얻은 `img`가 우리가 원하는 미리보기 이미지입니다.
  font_server.py의 GDI 경로는 흰 텍스트+투명 배경 형태 PNG 데이터를
  반환하고 있으므로, PIL로도 동일하게 맞추는 것이 좋습니다. 다만 PIL의
  `draw.text`는 기본적으로 안티앨리어싱된 RGBA 텍스트를 그려주므로 별도
  알파 보정은 필요 없습니다 (font_server.py GDI 경로에서 하는 픽셀
  처리[\[48\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=for%20y%20in%20range,0%2C%200%2C%200%2C%200)는
  GDI가 ClearType 비트맵으로 뽑는 걸 투명도로 변환하기 위한 것입니다).
  PIL 경로에서는 곧바로 RGBA 완성본을 얻을 수 있습니다.

  PIL을 사용할 때 고려 사항: **폰트 파일 접근 권한**과 **FreeType
  버전**입니다. CEP 환경의 Python이 해당 경로를 읽을 권한이 있어야 하고,
  PIL이 내장한 FreeType이 최신 OpenType Variation이나 CFF2도 지원하는
  버전이어야 합니다. 최신 Pillow라면 문제될 가능성은 낮습니다.

  - **폴백 경로 선택 기준:** 어느 폴백 방법을 쓸지는 개발 편의와 성능을
    따져 결정합니다. Tkinter Canvas는 이미 FontRegistry에 Tk 객체가
    있으니 쉽게 쓸 수 있지만, 이미지로 추출하는 과정이 PIL 방법에 비해
    오히려 복잡합니다. PIL은 직접 폰트 렌더링이라 straightforward하지만,
    **폰트 파일이 없으면** 못 쓴다는 단점이 있습니다. 그러나
    FontRegistry가 경로 캐시를 갖추고 있으니 거의 모든 폰트에 대해
    `resolve_path`가 있을 것입니다 (특히 GDI에서 못 찾은 폰트는
    registry나 Windows\Fonts에 없었을 가능성이 높고, 대신 스캔으로
    찾았으리라 추정됨).

  그러므로 구현에서는 **PIL 경로를 1차 폴백**으로 삼고, 만약
  `resolve_path`조차 실패하는 극단적 경우(폰트파일 모름)라면 **Tkinter
  Canvas로 시도**해볼 수 있습니다. Canvas 방식은 폰트가 GDI 테이블에
  올라와 있기만 하면 이름으로 그릴 수 있으므로, 이 시나리오는
  \"font_server 프로세스에서는 인식 못했지만 Tk 자기자신은 알고 있는
  폰트\"일 때입니다. 현실적으로 그런 경우는 없을 듯하지만 (FR_PRIVATE로
  다른 프로세스에만 로드된 폰트라면 Tk도 모름), 논리적으로 분기 넣어둘
  수 있습니다.

  - **결과 합치기:** 폴백으로 얻은 PIL 이미지(`img`)는 최종적으로 base64
    인코딩되어 HTTP 응답으로 나가야 합니다. font_server.py에서는 이미
    BytesIO에 PNG로 저장해 base64로 변환하는 코드가
    있습니다[\[49\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=output%20%3D%20io,SelectObject%28hdc%2C%20old_bitmap).
    이를 재사용하여, 폴백 경로도 동일하게 PNG 인코딩을 거치면 됩니다.
    투명 배경 RGBA 이미지를 PNG로 저장하면 문제없습니다. 최종 응답
    JSON에 `'data:image/png;base64,...'` 형태로 포함하거나, 미리보기
    단건 요청 (`/preview/`)의 경우 직접 PNG 바이너리를 보낼 수도
    있겠습니다만, 기존 방식을 따릅니다.

### 3.3 Windows 호환성과 성능 고려 {#windows-호환성과-성능-고려}

- **호환성 (OS 및 환경):** 이 솔루션은 Win7 이상 대부분의 Windows
  버전에서 동작합니다. AddFontResourceEx와 관련 GDI API들은 Windows
  2000부터 지원이라 버전 이슈는
  없습니다[\[50\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=Requirement%20Value%20Minimum%20supported%20client,dll).
  다만 Windows 10부터 생긴 **사용자 설치 폰트** 경로를 빠뜨리지 않고
  처리해야 한다는 점을
  재강조합니다[\[3\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs).
  또한 32비트 vs 64비트 환경에서 ctypes와 winreg 사용에 유의하여, 경로
  문자열 Unicode 처리나 registry Wow6432Node 경로 이슈 등을 점검해야
  합니다. 현재 코드에서는 `winreg` 기본키를 그대로 쓰고 있는데, 32bit
  Python이 64bit OS HKLM\Software\Microsoft\Windows
  NT\CurrentVersion\Fonts를 열면 레지스트리 리디렉션 없이 접근하므로
  상관없지만, 만약 문제가 생기면 `winreg.KEY_WOW64_64KEY` 플래그 사용을
  고려해야 합니다.

- **성능:** 폰트 **목록 구축 단계**는 수백 개\~수천 개 폰트에서
  동작하므로, 초기 비용이 꽤 있습니다. FontTools로 모든 폰트 파일의 name
  table을 파싱하는 것은 특히 무겁습니다. 하지만 font_server.py처럼
  **서버 프로세스가 백그라운드로 기동**되어 대기한다고 하면, 초기 수 초
  이내의 작업은 허용될 것입니다. 최적화를 위해 fontTools TTFont를
  `lazy=True`로 열고 필요한 name만 가져오는 최적화는 이미 되어
  있습니다[\[51\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=suffix%20%3D%20font_path,for%20font%20in%20fonts%3A%20try).
  또 한 가지, 특정 폴더 (특히 Windows\Fonts)는 수백 개 이상의 파일이
  있을 수 있는데, 이걸 전부 스캔하지 않고 **레지스트리의 경로 정보
  활용**으로 커버하는 점도 효율적입니다. 이미 구현된 대로 HKLM
  레지스트리에서 찾은 폰트들은 따로 파일 방문을 안 해도 되므로
  중복작업이 줄어듭니다.

<!-- -->

- 미리보기 **렌더링 단계**의 성능은 주로 GDI DrawText(텍스트 출력)와
  PIL의 text drawing이 차지합니다. GDI 경로는 C++ 레벨에서 돌아 매우
  빠르고, DrawText로 작은 텍스트 한 줄 그리는 건 수백 μs 이내일
  것입니다. PIL 경로는 Python 레이어에서 루프를 좀 돌지만 C의 FreeType을
  호출하므로 빠른 편입니다. 개별 폴백 렌더링이 수 ms 수준이라, 수십 개
  배치 미리보기도 문제없을 것으로 보입니다. 다만 Tkinter Canvas 경로는
  실제 윈도우 DC에 그리는 거라 비교적 느리고, 또 GUI 메인 루프가 없으면
  update() 등 호출이 번거롭습니다. 가급적 PIL을 폴백으로 쓰는 이유도
  성능 차원에서 합리적입니다.

  **멀티스레딩:** font_server.py가 HTTPServer를 쓰므로 기본적으로
  싱글스레드 혹은 단순 ThreadingMixIn으로 처리할텐데, Tkinter는 메인
  스레드 전용입니다. 이미 FontRegistry 생성 시 Tk를 주 스레드에서
  초기화해두고 이후 사용 시 **락(\_lock)**으로 동시 호출을 피하고
  있습니다[\[52\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=class%20FontRegistry%3A%20def%20__init__%28self%29%20,load).
  이 부분을 확실히 관리해야 합니다. 즉 동시에 여러 /preview 요청이 와도
  한 번에 하나씩 폰트 렌더링을 수행하거나, 아니면 GDI 경로는
  멀티스레드OK지만 Tk/PIL 경로는 임계구역으로 보호하는 식으로 짜야
  합니다. PIL 자체는 GIL(글로벌 인터프리터 락) 영향 정도만 있고
  thread-safe하므로 큰 문제는 없겠지만, Tkinter 객체 접근은 한 스레드로
  제한하는 것이 안전합니다.

  **메모리 관리:** AddFontResourceEx로 동적으로 로드한 폰트는 **프로세스
  메모리에 남아**있습니다. 수가 많지 않다면 무시해도 되나, 빈번히
  로드/언로드해야 한다면 RemoveFontResourceEx를 고려해야 합니다. 본
  애플리케이션에서는 특정 문제가 있는 폰트 몇 개에 대해서만 이 작업을 할
  것이므로, 대부분 경우 폰트 수십 MB 추가 로드는 큰 영향 없습니다.
  오히려 FontTools TTFont 객체들이 차지하는 메모리를 초기화 후 닫거나,
  PIL Image 객체 등 사용 후 메모리 해제하는 것이 더 중요할 수 있습니다.
  하지만 Python GC가 정리할 것이므로 일반적인 사용량에서는 위험 요소는
  아니라고 판단됩니다.

### 3.4 코드 스니펫: 종합 예시 {#코드-스니펫-종합-예시}

아래는 위에서 설명한 구현을 간략히 표현한 **의사 코드**입니다. 실제
코드에서는 예외 처리와 최적화가 더 들어가야 하지만, 흐름 이해를 위해
핵심 부분만 나열합니다:

    def render_font_preview(font_name: str, text: str, size: int) -> bytes:
        # 1. GDI 이름 해상도
        resolved = FontNameResolver().resolve(display_name=font_name)
        face_name = resolved['faceName']
        font_weight = resolved['weight']
        font_italic = resolved['italic']

        # 2. GDI CreateFont & Render
        hdc = gdi32.CreateCompatibleDC(0)
        logfont = LOGFONTW()
        logfont.lfHeight = -abs(int(size))
        logfont.lfWeight = font_weight
        logfont.lfItalic = font_italic
        logfont.lfCharSet = DEFAULT_CHARSET
        # ... (other logfont fields as default)
        logfont.lfFaceName = face_name[:LF_FACESIZE-1]
        hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        if not hfont:
            # 폰트 로드 시도
            font_path = REGISTRY.resolve_path(font_name)
            if font_path:
                res = gdi32.AddFontResourceExW(font_path, 0x10|0x20, None)
                if res:
                    hfont = gdi32.CreateFontIndirectW(ctypes.byref(logfont))
        if not hfont:
            raise RuntimeError("Font not found")

        old_font = gdi32.SelectObject(hdc, hfont)
        # 텍스트 영역 계산
        rect = RECT(0, 0, 0, 0)
        user32.DrawTextW(hdc, text, -1, ctypes.byref(rect), DT_CALCRECT)
        width = rect.right - rect.left or 1
        height = rect.bottom - rect.top or size
        # 비트맵 생성
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = width
        bmi.bmiHeader.biHeight = -height  # top-down
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32  # RGBA
        bits = ctypes.c_void_p()
        hbitmap = gdi32.CreateDIBSection(hdc, ctypes.byref(bmi), DIB_RGB_COLORS,
                                         ctypes.byref(bits), None, 0)
        old_bmp = gdi32.SelectObject(hdc, hbitmap)
        gdi32.SetBkMode(hdc, TRANSPARENT)
        gdi32.SetTextColor(hdc, 0x00FFFFFF)  # white
        user32.DrawTextW(hdc, text, -1, ctypes.byref(RECT(0,0,width,height)), DT_NOPREFIX)
        # GDI substitution 확인
        current_face = (ctypes.c_wchar * LF_FACESIZE)()
        gdi32.GetTextFaceW(hdc, LF_FACESIZE, current_face)
        if current_face.value.lower().strip() != face_name.lower().strip():
            # 폴백: PIL로 렌더
            pil_image = render_with_pil(font_name, text, size, width, height)
            # (pil_image는 이미 RGBA PNG로 저장 가능한 객체라고 가정)
            return pil_image.tobytes("png")  # 또는 base64 인코딩 등
        else:
            # GDI 비트맵 -> PNG 변환
            buf_size = width * height * 4
            raw_buf = ctypes.string_at(bits, buf_size)
            image = Image.frombuffer('RGBA', (width, height), raw_buf, 'raw', 'BGRA', 0, 1)
            # 흰 글씨 -> 알파 변환
            pixels = image.load()
            for y in range(height):
                for x in range(width):
                    r,g,b,a = pixels[x,y]
                    if r or g or b:
                        alpha = max(r,g,b)
                        pixels[x,y] = (255,255,255, alpha)
                    else:
                        pixels[x,y] = (0,0,0,0)
            output = io.BytesIO()
            image.save(output, format='PNG')
            return output.getvalue()
        # 리소스 해제 (hfont, hbitmap, DC 등) - 생략

위 코드는 이해를 돕기 위한 요약이며, 실제 구현에서는 예외를 캐치해서 PIL
폴백으로 가거나, batch-preview 여러 폰트를 처리하는 루프 등을 감안해야
합니다. 특히 GetTextFaceW 비교 부분은 단순 string 비교 대신 좀 더 확실한
체크가 필요할 수도 있습니다 (예: 기본 폰트로 대체될 경우 보통
`"Microsoft Sans Serif"` 등 특정 이름이 나오므로 그것을 조건으로 삼는
방법도 있음).

### 3.5 구현상의 추가 고려사항 {#구현상의-추가-고려사항}

- **UI 표시 이름과 실제 렌더링 폰트의 매칭**: FontNameResolver를 통해
  사용자가 보는 폰트 이름과 GDI face name 간 매핑을 처리했지만, 혹시
  UI에 표시되는 폰트 이름 자체를 바꾸는 것도 고려할 수 있습니다. 예를
  들어 Adobe Fonts의 \"Source Han Sans Bold\"는 GDI에 \"Source Han
  Sans\"로 등록되었다면, 목록에서 굳이 Bold를 붙여 표시하지 않고 그냥
  패밀리로 묶어 표시하는 게 일관될 수 있습니다. 그러나 CEP 패널 UI/UX
  요구사항에 따라 다르므로, 필요한 경우 `_aliases` 정보를 활용해 사용자
  친화적 이름을 보여주는 개선도 가능하겠습니다.

- **Fallback 순서 로깅**: 폴백이 발생하면 어떤 폰트에서 GDI 실패→PIL
  성공으로 갔는지 로깅하여 나중에 해당 폰트를 처리하는 별도 규칙을
  추가할 수 있습니다. 예를 들어 특정 폰트는 GDI에서 항상 안 되니
  처음부터 PIL로 처리하도록 최적화하는 것이죠. 이러한 튜닝은 우선 모든
  폰트에서 잘 동작한 후, 로그를 분석해 할 수 있을 것입니다.

- **ClearType vs Grayscale**: GDI의 DrawText는 ClearType(서브픽셀)
  렌더링이 기본이며, PIL은 서브픽셀을 지원하지 않고 그레이스케일
  안티앨리아싱만 있습니다. font_server.py의 픽셀 알파 변환
  로직[\[48\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=for%20y%20in%20range,0%2C%200%2C%200%2C%200)은
  ClearType 출력을 투명 텍스트로 바꾸기 위한 것입니다. PIL 폴백의 경우
  서브픽셀이 없으므로 이미 알파채널을 곧바로 사용해도 되며, 굳이 그 픽셀
  루프를 돌 필요가 없습니다. **다만 결과적으로 미세한 두께 차이**가 날
  수 있습니다. 일반 텍스트 미리보기에서는 큰 문제 아니지만, 혹시라도
  디자이너 눈에 다를 수 있어 모든 폰트를 PIL로 통일하지 않는 이유이기도
  합니다. ClearType 효과까지 맞추려면 더 복잡한 처리가 필요하므로,
  여기서는 폴백 출력 정도는 약간 다르더라도 허용하는 것으로 합니다.

- **Windows API 호출 오류 처리**: ctypes로 GDI를 호출할 때 예기치 못한
  실패가 있을 수 있습니다. 예를 들면 CreateDIBSection이 메모리 부족으로
  실패하거나, DrawTextW가 글리프가 없어서 0을
  리턴하거나[\[53\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=calc_flags%20,DrawTextW%20failed%20during%20measurement),
  AddFontResourceEx가 잘못된 폰트파일로 0을 반환하는 경우입니다. 이런
  상황별 대처를 고려하여, 실패 시 해당 미리보기 요청을 **에러로
  표시**하거나 최소한 기본 폰트라도 렌더링해서 제공하는 등의 로직을 둘
  수 있습니다. 현재 font_server.py 구조에서는 오류 발생 시 HTTP 500을
  리턴하게 될 텐데, UX 측면에서는 글자 대신 \"(폰트 렌더링 실패)\" 같은
  이미지를 주는 것도 방법입니다. 물론 최종 목표는 그런 일이 없도록 하는
  것이고, 이 설계로 대부분 해결될 것으로 기대합니다.

## 4. 테스트 시나리오와 결과 검증 {#테스트-시나리오와-결과-검증}

제안된 개선을 구현한 후에는 다음과 같은 시나리오를 통해 **유효성
검증**을 해야 합니다:

1.  **Adobe Fonts 활성화 폰트 테스트:** Adobe Creative Cloud에서 임의의
    글꼴(예: *Adobe 한글 본고딕*)을 활성화한 뒤, After Effects CEP
    패널에서 해당 폰트의 미리보기를 요청합니다. 개선 전에는 해당
    폰트명이 리스트에는 있어도 미리보기가 기본 폰트로 나왔을 가능성이
    있습니다. 개선 후에는 **정확한 글꼴 형태로 렌더링되는지**
    확인합니다. 예를 들어 \'가나다\' 텍스트를 미리보기했을 때 본고딕
    특유의 둥근 모서리가 나타나는지, 두께가 정확한지 등을 눈으로
    검증합니다. 또한 font_server.py 로그에
    `Resolved 'Adobe 본고딕 Bold' → 'Adobe 본고딕' (weight=700)...` 같은
    메시지[\[54\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=face_name%20%3D%20resolved,resolved%5B%27source)가
    뜨고, GetTextFaceW 결과가 폴백 없이 잘 처리됐는지도 확인합니다.

2.  **산돌클라우드 폰트 테스트:** 산돌클라우드 프로그램을 실행하고 사용
    가능한 폰트 중 하나를 선택합니다. CEP 패널에서 해당 폰트를 목록에
    표시하고 미리보기를 생성해 봅니다. 만약 산돌 폰트가 **산돌
    프로그램에서만 로드**되는 폰트라면, font_server 개선판이
    AddFontResourceEx를 통해 로드하는지 로그로 확인합니다. 그리고
    **화면에 해당 폰트 글꼴이 제대로 그려지는지** 봅니다. 특히 산돌
    폰트들은 DRM이 걸려 있을 수 있어, 혹시 PIL로 그릴 때 문제가 없는지도
    살핍니다. (만약 PIL이 fontTools로 추출은 됐지만 실제 렌더링 불가한
    폰트라면, 검은 사각형 등이 나올 수 있습니다. 이런 경우는 산돌측
    보호기술이라 대응 어려울 수 있지만, 일반적으로 활성화된 폰트파일은
    정상 TrueType일 것입니다.)

3.  **다양한 스타일의 폰트 테스트:** 폰트 이름에 Bold/Italic 등이 포함된
    케이스들을 시험합니다. 예를 들어 *\"굴림체\"* vs *\"굴림체 Bold\"*,
    *\"Arial Black Italic\"* 등의 폰트를 미리보기 생성합니다. 옵션 A의
    이름 해상도가 제대로 동작했다면 굴림체 Bold도 굴림체+weight=700으로
    처리되어 GDI Bold 렌더링이 될 것이고, Arial Black Italic도 faceName
    \"Arial Black\"+italic=1 설정으로 렌더링될 것입니다. 출력 이미지를
    눈으로 확인하고, 혹은 GetTextFaceW로 얻은 실제 적용 폰트명이
    의도대로인지 확인합니다.

4.  **폴백 경로 검증:** 의도적으로 GDI 경로를 실패시키는 테스트를
    합니다. 예를 들어 font_server 코드에 강제로 `return None` (또는
    hfont=0)하도록 한 뒤 폴백이 실행되게 한 후, PIL로 그린 결과와 GDI
    기본 폰트 결과를 비교합니다. *\"FallbackTestFont\"*라는 가짜
    이름으로 요청을 보내 PIL 폴백이 작동하는지도 볼 수 있습니다.
    정상적인 폰트지만 GDI에서 이름 못 찾을 상황을 에뮬레이트해 보는
    것이죠. 폴백된 이미지가 읽을 수 있을 정도로 텍스트가 보이면
    성공입니다. 특히 흰색 텍스트/투명 배경 형식이 동일하게 구현됐는지
    확인해야 합니다. (배경이 투명 PNG인지, 텍스트 부분 알파값이 적절한지
    등)

5.  **성능 테스트:** 폰트 수가 많은 환경(수백 개 이상의 폰트 설치)에서
    `/fonts` API 호출 시간과 `/batch-preview`(다수 폰트 미리보기 요청)
    처리 시간을 측정합니다. 예를 들어 100개 폰트에 대해 batch-preview로
    16px \"Ag\" 텍스트 이미지를 생성해보면, 응답이 과도하게 지연되지
    않아야 합니다. GDI 경로는 매우 빠르므로 대부분 문제 없겠으나,
    폴백으로 PIL이 많이 쓰이면 CPU 사용이 늘 수 있습니다. 특정 사용자
    환경에서 성능 문제가 보고된다면, 폴백 사용을 최소화하도록 추가
    튜닝(예: 자주 쓰이는 폰트는 미리 GDI에 로드)하거나, 또는 일정 크기
    이하에서는 텍스트를 미리 렌더링 캐싱하는 등의 방법도 고려
    가능합니다. 초기 로드 시간도 1\~2초 이내인지 확인하여, 패널 열었을
    때 폰트 목록/미리보기가 빠르게 뜨는지 UX를 점검합니다.

6.  **Windows 7/8 구형 OS 테스트 (선택):** 가능하다면 Windows 7 환경에서
    본 솔루션을 실행해 폰트 나열과 미리보기가 잘 되는지 확인합니다.
    Windows 7에는 *Malgun Gothic* 등 기본 한글 폰트가 있고, 산돌/Adobe
    폰트 서비스는 지원 안 할 수 있지만, 대신 임의의 새로운 폰트를 임시
    로드(AddFontResourceEx)해서 미리보기하는 시나리오를 시험합니다. 구형
    OS에서 문제 없다면 Windows 10/11에서는 더 안정적으로 동작할
    것입니다.

테스트 결과 기대되는 바는, **어떤 경우에도 폰트 미리보기가 빈 이미지나
잘못된 글꼴로 나오지 않고, 정확한 폰트 모양을 보여주는 것**입니다. 특히
Adobe Fonts나 산돌클라우드 폰트처럼 이전에 기본 글꼴로 표시되던 사례가
모두 해결되어야 합니다. 만약 일부 폰트가 끝까지 실패한다면
(`AddFontResourceEx`마저 0 반환 등), 해당 폰트 파일이 손상되었거나
DRM으로 보호되어 **OS API로 로드 불가**한 케이스일 수 있습니다. 그런
폰트는 사실상 다른 앱에서도 사용할 수 없는 경우가 많으므로, 패널
차원에서 \"렌더 불가\" 표시를 해주는 식으로 처리할 수밖에 없습니다.
다행히 대부분의 동적 웹폰트 서비스는 사용자 단에서 TrueType을 받는
구조이기에, 본 솔루션으로 충분히 렌더링 가능할 것으로 보입니다.

마지막으로, 개선된 font_server.py를 실제 After Effects CEP 패널과 연동해
실사용 테스트를 수행합니다. 여러 폰트를 선택해보며 미리보기가 즉각 즉각
잘 바뀌는지, 패널 메모리 누수나 CPU 점유가 안정적인지도 살펴봅니다.
이러한 과정을 통해 본 보고서에서 제안한 방법이 **실제 현장의 DRM 기반
동적 폰트 문제를 성공적으로 해결**함을 검증할 수 있을 것입니다.

**참고문헌:** Windows 폰트 API 동작
원리[\[5\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=When%20you%20get%20an%20enumeration,as%20fonts%20for%20that%20user)[\[11\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,Must%20be%20zero),
GDI 폰트 대체
메커니즘[\[13\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=It%27s%20not%20CreateFontIndirect%20that%27s%20doing,you%20the%20same%20LOGFONT%20back),
Tkinter를 통한 폰트 로드
사례[\[12\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=%23%20The%20new%20font,Scriptina%2020%7D%20pack%20.lab1)
등이 본 솔루션의 이론적 기반이 되었습니다. 이 자료들을 바탕으로 구현한
개선안은, After Effects CEP 패널에서 **GDI와 Tkinter의 폰트 취급
차이**를 메꾸고 모든 설치 폰트를 정확히 렌더링할 것으로 기대됩니다.
[\[55\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=Normally%20when%20fonts%20are%20loaded,be%20used%20to%20limit%20that)[\[39\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,will%20remove%20all%20the%20%27temporary)

[\[1\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=When%20GDI%20is%20initialized%20during,those%20APIs%20for%20each%20entry)
[\[2\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs)
[\[3\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs)
[\[4\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=Installed%20vs)
[\[5\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=When%20you%20get%20an%20enumeration,as%20fonts%20for%20that%20user)
[\[6\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=System%20vs)
[\[15\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=,anything%20to%20indicate%20it%20is)
[\[55\]](https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts#:~:text=Normally%20when%20fonts%20are%20loaded,be%20used%20to%20limit%20that)
Best way to Pursue Enumerating Fonts - Stack Overflow

<https://stackoverflow.com/questions/61532842/best-way-to-pursue-enumerating-fonts>

[\[7\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=one%20of%20the%20following%20values)
[\[8\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=FR_NOT_ENUM%20Specifies%20that%20no%20process%2C,function%2C%20can%20enumerate%20this%20font)
[\[9\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=FR_PRIVATE%20Specifies%20that%20only%20the,process%20with%20the%20AddFontResourceEx%20function)
[\[10\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=Value%20Meaning)
[\[50\]](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa#:~:text=Requirement%20Value%20Minimum%20supported%20client,dll)
AddFontResourceExA function (wingdi.h) - Win32 apps \| Microsoft Learn

<https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexa>

[\[11\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,Must%20be%20zero)
[\[12\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=%23%20The%20new%20font,Scriptina%2020%7D%20pack%20.lab1)
[\[39\]](https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em#:~:text=,will%20remove%20all%20the%20%27temporary)
How to use new fonts without installing\'em

<https://wiki.tcl-lang.org/page/How+to+use+new+fonts+without+installing%27em>

[\[13\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=It%27s%20not%20CreateFontIndirect%20that%27s%20doing,you%20the%20same%20LOGFONT%20back)
[\[14\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=LOGFONT)
[\[17\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=3)
[\[46\]](https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call#:~:text=If%20you%20select%20the%20HFONT,best%20match%20to%20the%20LOGFONT)
windows - How can I find what font was actually used for my CreateFont
call? - Stack Overflow

<https://stackoverflow.com/questions/7154858/how-can-i-find-what-font-was-actually-used-for-my-createfont-call>

[\[16\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=logfont,lfFaceName%20%3D%20face)
[\[18\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=with%20winreg.OpenKey%28winreg.HKEY_LOCAL_MACHINE%2C%20r,join%28fonts_dir%2C%20font_path)
[\[19\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=NT%5C%5CCurrentVersion%5C%5CFonts,exists%28font_path%29%3A%20norm_key%20%3D%20normalize%28font_name)
[\[20\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=try%3A%20font_name%2C%20font_value%2C%20_%20%3D,remember_alias%28font_name)
[\[21\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=search_dirs%20%3D%20,LocalLow%27%20%2F%20%27SandollCloud%27%20%2F%20%27fonts)
[\[22\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20extract_font_names,fonts)
[\[23\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=except%20KeyError%3A%20continue%20for%20record,decode%28errors%3D%27ignore)
[\[24\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20normalize%28name%3A%20str%29%20,isalnum)
[\[25\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20aliases_for,font_name)
[\[26\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=try%3A%20for%20name%20in%20extract_font_names,exc)
[\[27\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=def%20_handle_preview%28self%29%3A%20font_name%20%3D%20self,size%2C%20160%29%29%20try)
[\[28\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=,faceName)
[\[29\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=%27%7Bface_name%7D%27%20%28weight%3D%7Bfont_weight%7D%2C%20italic%3D%7Bfont_italic%7D%2C%20source%3D%7Bresolved%5B%27source%27%5D%7D%29,is)
[\[35\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=hfont%20%3D%20gdi32,CreateFontIndirectW%20failed)
[\[36\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=calc_flags%20,DrawTextW%20failed%20during%20measurement)
[\[37\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=hdc%20%3D%20gdi32,CreateCompatibleDC%20failed)
[\[38\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=logfont%20%3D%20LOGFONTW%28%29%20logfont,Use%20resolved%20face%20name)
[\[40\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=,byref%28calc_rect%29%2C%20calc_flags%29%20%3D%3D%200)
[\[41\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=measured_width%20%3D%20max%28calc_rect.right%20,calc_rect.top%2C%20size)
[\[42\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=bits%20%3D%20ctypes,CreateDIBSection%20failed)
[\[43\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=,byref%28draw_rect%29%2C%20draw_flags%29%20%3D%3D%200)
[\[44\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=buffer%20%3D%20ctypes.string_at%28bits%2C%20final_width%20,r%20or%20g%20or%20b)
[\[45\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=alpha%20%3D%20max,0%2C%200%2C%200%2C%200)
[\[47\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=return)
[\[48\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=for%20y%20in%20range,0%2C%200%2C%200%2C%200)
[\[49\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=output%20%3D%20io,SelectObject%28hdc%2C%20old_bitmap)
[\[51\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=suffix%20%3D%20font_path,for%20font%20in%20fonts%3A%20try)
[\[52\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=class%20FontRegistry%3A%20def%20__init__%28self%29%20,load)
[\[53\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=calc_flags%20,DrawTextW%20failed%20during%20measurement)
[\[54\]](file://file_0000000055f47207b59de115af2d4aca#:~:text=face_name%20%3D%20resolved,resolved%5B%27source)
font_server.py

<file://file_0000000055f47207b59de115af2d4aca>

[\[30\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,strip%28%29%20else)
[\[31\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=weight%2C%20italic%20%3D%20parse_style_flags,face_name%2C%20%27weight%27%3A%20weight%2C%20%27italic%27%3A%20italic)
[\[32\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,bold)
[\[33\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=italic%20%3D%200%20if%20any,italic%20%3D%201)
[\[34\]](file://file_0000000051187207b49f8bbd2e511f7a#:~:text=,%27faceName%27%3A%20face_name%2C%20%27weight%27%3A%20weight)
font_name_resolver.py

<file://file_0000000051187207b49f8bbd2e511f7a>
