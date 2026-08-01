@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
adb -s 2aeb78a9 shell monkey -p com.openshare.openshare -c android.intent.category.LAUNCHER 1
echo ===
adb -s 2aeb78a9 shell dumpsys activity activities | findstr /i "mResumedActivity"
echo === DONE ===
