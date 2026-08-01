@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%

echo === Phone 1 (OnePlus) - package & version ===
adb -s 2aeb78a9 shell pm list packages | findstr /i openshare
adb -s 2aeb78a9 shell dumpsys package com.openshare.openshare | findstr /i "versionName"

echo === Phone 2 (Infinix) - package & version ===
adb -s 099543138O150531 shell pm list packages | findstr /i openshare
adb -s 099543138O150531 shell dumpsys package com.openshare.openshare | findstr /i "versionName"
echo === DONE ===
