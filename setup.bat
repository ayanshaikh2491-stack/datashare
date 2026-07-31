@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

echo ============================================
echo    OpenShare - Setup Script
echo    Internet Sharing without Hotspot
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from: https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js found

:: Check Flutter
where flutter >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Flutter not found. Install from: https://flutter.dev
    pause
    exit /b 1
)
echo [OK] Flutter found

:: Check Android SDK
if "%ANDROID_HOME%"=="" (
    if "%ANDROID_SDK_ROOT%"=="" (
        echo [WARN] Android SDK not found. Set ANDROID_HOME or run: flutter config --android-sdk
    ) else (
        set ANDROID_HOME=%ANDROID_SDK_ROOT%
    )
)
echo [OK] Proceeding...

:: Setup server
echo.
echo [1/3] Setting up Relay Server...
cd /d "%~dp0server"
call npm install
echo [OK] Server dependencies installed

:: Setup Flutter app
echo.
echo [2/3] Setting up Flutter app...
cd /d "%~dp0openshare"
call flutter pub get
echo [OK] Flutter dependencies installed

:: Done
echo.
echo [3/3] Build complete!
echo.
echo ============================================
echo    How to Run:
echo ============================================
echo.
echo 1. Start the relay server:
echo    cd server ^&^& node index.js
echo.
echo 2. Build the APK:
echo    cd openshare ^&^& flutter build apk --debug
echo.
echo 3. Install the APK on your phone
echo.
echo 4. On Phone 1 (Donor):
echo    - Open OpenShare app
echo    - Tap "Start Sharing"
echo    - Enter Server IP: ws://SERVER_IP:8080
echo    - Tap "Start Sharing"
echo.
echo 5. On Phone 2 (Receiver):
echo    - Open OpenShare app
echo    - Tap "Browse Networks"
echo    - Enter Server IP: ws://SERVER_IP:8080
echo    - Connect to donor
echo.
pause
