@echo off
setlocal
set JAVA_HOME=C:\tools\jdk17_extracted\jdk-17.0.2
set ANDROID_HOME=%USERPROFILE%\android-sdk
set ANDROID_SDK_ROOT=%USERPROFILE%\android-sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\emulator;%ANDROID_HOME%\platform-tools;%PATH%

echo JCODE_PROGRESS {"percent":5,"message":"Starting emulator headless"}
start "emulator" /b emulator.exe -avd openshare_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -memory 2048 > %TEMP%\emulator.log 2>&1

echo Waiting for device...
adb wait-for-device
echo JCODE_PROGRESS {"percent":30,"message":"Device online, waiting for boot"}

:loop
set BOOTED=
for /f "tokens=*" %%i in ('adb shell getprop sys.boot_completed 2^>nul') do set BOOTED=%%i
if "%BOOTED%"=="1" goto booted
timeout /t 5 /nobreak >nul
goto loop

:booted
echo JCODE_PROGRESS {"percent":60,"message":"Boot completed"}
adb devices
echo JCODE_CHECKPOINT {"message":"Emulator booted"}
