@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "IS_CLEAN_BUILD=false"
set "UPDATE_BEFORE_BUILD=false"

echo.
echo ============================================
echo   Vyact Windows Build
echo ============================================

echo.
echo Select build mode:
echo   1. Build current checkout
echo   2. Pull latest changes, then build
echo   3. Clean build current checkout
echo   4. Pull latest changes, then clean build
choice /c 1234 /n /m "Enter a number"
if errorlevel 4 (
    set "UPDATE_BEFORE_BUILD=true"
    set "IS_CLEAN_BUILD=true"
) else if errorlevel 3 (
    set "IS_CLEAN_BUILD=true"
) else if errorlevel 2 (
    set "UPDATE_BEFORE_BUILD=true"
)

if /i "!UPDATE_BEFORE_BUILD!"=="true" (
    echo.
    echo [0/5] Git pull...
    git pull
    if !errorlevel! neq 0 ( echo [FAIL] git pull 실패 & pause & exit /b 1 )
    echo [OK] Git pull 완료
)

:: ── 1. 원본 파일 백업 ─────────────────────────
echo.
echo [1/5] 원본 파일 백업...

copy /y "electron\main.js"        "electron\main.js.mac_backup"        >nul
copy /y "electron\package.json"   "electron\package.json.mac_backup"   >nul
copy /y "app\docker-compose.yml"  "app\docker-compose.yml.mac_backup"  >nul

echo [OK] 백업 완료

:: ── 2. 윈도우 전용 파일로 교체 ────────────────
echo.
echo [2/5] 윈도우 전용 파일 적용...

copy /y "win\electron\main.js"        "electron\main.js"        >nul
if !errorlevel! neq 0 ( echo [FAIL] win\electron\main.js 복사 실패 & call :RESTORE & pause & exit /b 1 )

copy /y "win\electron\package.json"   "electron\package.json"   >nul
if !errorlevel! neq 0 ( echo [FAIL] win\electron\package.json 복사 실패 & call :RESTORE & pause & exit /b 1 )

copy /y "win\electron\icon.ico"       "electron\icon.ico"       >nul
if !errorlevel! neq 0 ( echo [FAIL] win\electron\icon.ico 복사 실패 & call :RESTORE & pause & exit /b 1 )

copy /y "win\app\docker-compose.yml"  "app\docker-compose.yml"  >nul
if !errorlevel! neq 0 ( echo [FAIL] win\app\docker-compose.yml 복사 실패 & call :RESTORE & pause & exit /b 1 )

echo [OK] 윈도우 파일 적용 완료

:: ── 3. Frontend 빌드 ──────────────────────────
echo.
echo [3/5] Frontend build...
cd frontend
call npm install
if !errorlevel! neq 0 ( echo [FAIL] npm install 실패 & cd .. & call :RESTORE & pause & exit /b 1 )
call npm run build
if !errorlevel! neq 0 ( echo [FAIL] Frontend build 실패 & cd .. & call :RESTORE & pause & exit /b 1 )
cd ..
echo [OK] Frontend build 완료

:: ── 4. Electron 빌드 ──────────────────────────
echo.
echo [4/5] Electron build...
cd electron
if exist dist rmdir /s /q dist
if /i "!IS_CLEAN_BUILD!"=="true" if exist node_modules rmdir /s /q node_modules
call npm install
if !errorlevel! neq 0 ( echo [FAIL] npm install 실패 & cd .. & call :RESTORE & pause & exit /b 1 )
:: Windows 빌드에는 macOS 코드사이닝(winCodeSign)이 불필요.
:: 해당 아카이브의 심볼릭 링크 추출 시 권한 오류로 빌드가 실패하므로 서명을 비활성화한다.
set CSC_IDENTITY_AUTO_DISCOVERY=false
:: 이전 실패로 손상된 winCodeSign 캐시가 남아 있으면 제거(서명 비활성화 시 재사용되지 않음).
if /i "!IS_CLEAN_BUILD!"=="true" if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
call npm run build
if !errorlevel! neq 0 ( echo [FAIL] Electron build 실패 & cd .. & call :RESTORE & pause & exit /b 1 )
cd ..
echo [OK] Electron build 완료

:: ── 5. 결과물 수집 ────────────────────────────
echo.
echo [5/5] Collecting artifacts...
if not exist dist mkdir dist
copy "electron\dist\*.exe" "dist\" >nul 2>&1

:: ── 원본 복원 ─────────────────────────────────
call :RESTORE

echo.
echo ============================================
echo   Build Complete
echo ============================================
echo   Output: %~dp0dist\
echo.
dir /b "dist\*.exe" 2>nul

pause
endlocal
exit /b 0

:: ── 복원 서브루틴 ─────────────────────────────
:RESTORE
echo.
echo [RESTORE] 원본 파일 복원 중...
if exist "electron\main.js.mac_backup"       ( copy /y "electron\main.js.mac_backup"       "electron\main.js"        >nul )
if exist "electron\package.json.mac_backup"  ( copy /y "electron\package.json.mac_backup"  "electron\package.json"   >nul )
if exist "app\docker-compose.yml.mac_backup" ( copy /y "app\docker-compose.yml.mac_backup" "app\docker-compose.yml"  >nul )
del /q "electron\main.js.mac_backup"        2>nul
del /q "electron\package.json.mac_backup"   2>nul
del /q "app\docker-compose.yml.mac_backup"  2>nul
if exist "electron\icon.ico" ( del /q "electron\icon.ico" 2>nul )
echo [RESTORE] 원본 복원 완료
exit /b 0
