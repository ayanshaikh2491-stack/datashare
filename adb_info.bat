@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
adb devices -l
echo ===
adb -s 2aeb78a9 shell getprop ro.product.brand
adb -s 2aeb78a9 shell getprop ro.build.version.release
adb -s 2aeb78a9 shell getprop ro.product.model
echo === DONE ===
