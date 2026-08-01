@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
echo === RESTARTING ADB ===
adb kill-server
timeout /t 2 /nobreak >nul
adb start-server
timeout /t 3 /nobreak >nul
adb devices -l
echo === DONE ===
