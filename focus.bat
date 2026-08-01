@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
adb -s 2aeb78a9 shell dumpsys window | findstr /i "mCurrentFocus mFocusedApp"
echo === DONE ===
