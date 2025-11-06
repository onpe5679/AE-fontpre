@echo off
chcp 65001 > nul
echo.
echo ====================================
echo GDI 폰트 이름 테스트 실행
echo ====================================
echo.

cd /d "%~dp0"

REM Python 경로 찾기
where python >nul 2>&1
if %errorlevel% equ 0 (
    python test_font_name_gdi.py
) else (
    echo Python을 찾을 수 없습니다.
    echo Python이 설치되어 있고 PATH에 등록되어 있는지 확인하세요.
    pause
    exit /b 1
)

echo.
echo.
echo 테스트 완료! 아무 키나 눌러 종료...
pause >nul
