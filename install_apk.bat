@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
echo Installing APK on 2aeb78a9...
adb -s 2aeb78a9 install -r "C:\Users\TAUSHEF\datashare\OpenShare-v1.0.1-hf.apk"
echo === EXIT %errorlevel% ===
