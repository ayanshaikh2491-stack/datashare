@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
echo === Installing on Phone 2 (Infinix) ===
adb -s 099543138O150531 install -r "C:\Users\TAUSHEF\datashare\OpenShare-v1.0.1-hf.apk"
echo === EXIT %errorlevel% ===
