font_server.exe 위치
===================

이 디렉토리에 font_server.exe 파일을 넣으세요.

빌드 방법:
----------
1. Windows PowerShell 열기
2. cd C:\DevAT\AE-fontpre\com.aefont.preview\python
3. python build_exe.py

빌드 완료 후 자동으로 이 경로에 복사됩니다:
C:\DevAT\AE-fontpre\com.aefont.preview\bin\win\font_server.exe

수동 복사:
----------
만약 수동으로 복사하려면:
python/dist/font_server.exe → 이 디렉토리로 복사

확인:
-----
제대로 설치되었는지 확인:
1. 이 디렉토리에 font_server.exe 파일이 있어야 함
2. 더블클릭해서 실행
3. 브라우저에서 http://localhost:8765/ping 접속
4. {"status": "ok"} 응답 확인
