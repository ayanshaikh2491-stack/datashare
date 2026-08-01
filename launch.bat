@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
echo === PACKAGE ===
adb -s 2aeb78a9 shell pm list packages | findstr /i openshare
echo === LAUNCH ===
adb -s 2aeb78a9 shell monkey -p com.openshare.app -c android.intent.category.LAUNCHER 1
echo === DONE ===
