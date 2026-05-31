@echo off
setlocal
set JAVA_HOME=C:\android-sdk\java
set ANDROID_HOME=C:\android-sdk
set ANDROID_SDK_ROOT=C:\android-sdk
set GRADLE_HOME=C:\android-sdk\gradle-8.2
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;%GRADLE_HOME%\bin;%PATH%
cd /d %~dp0native-android
(echo sdk.dir=C:/android-sdk) > local.properties
echo === Building APK ===
gradle assembleDebug --no-daemon 2>&1
echo.
if exist app\build\outputs\apk\debug\app-debug.apk (
    echo SUCCESS!
    dir app\build\outputs\apk\debug\app-debug.apk
) else (
    echo FAILED
)
pause
