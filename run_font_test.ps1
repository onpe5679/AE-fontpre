# PowerShell용 GDI 폰트 테스트 스크립트
# UTF-8 인코딩 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "GDI 폰트 이름 테스트 실행" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# 스크립트 디렉토리로 이동
Set-Location -Path $PSScriptRoot

# Python 실행
try {
    python test_font_name_gdi.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Python 실행 중 오류 발생 (종료 코드: $LASTEXITCODE)" -ForegroundColor Red
    }
} catch {
    Write-Host ""
    Write-Host "Python을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "Python이 설치되어 있고 PATH에 등록되어 있는지 확인하세요." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "아무 키나 눌러 종료"
    exit 1
}

Write-Host ""
Write-Host ""
Write-Host "테스트 완료! 아무 키나 눌러 종료..." -ForegroundColor Green
Read-Host
