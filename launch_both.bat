@echo off
setlocal
set ANDROID_HOME=%USERPROFILE%\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%

echo === Launch Phone 1 ===
adb -s 2aeb78a9 shell am force-stop com.openshare.openshare
adb -s 2aeb78a9 shell monkey -p com.openshare.openshare -c android.intent.category.LAUNCHER 1 >nul 2>&1
timeout /t 4 /nobreak >nul
adb -s 2aeb78a9 exec-out screencap -p > C:\Users\TAUSHEF\datashare\screen_phone1.png

echo === Launch Phone 2 ===
adb -s 099543138O150531 shell am force-stop com.openshare.openshare
adb -s 099543138O150531 shell monkey -p com.openshare.openshare -c android.intent.category.LAUNCHER 1 >nul 2>&1
timeout /t 4 /nobreak >nul
adb -s 099543138O150531 exec-out screencap -p > C:\Users\TAUSHEF\datashare\screen_phone2.png

echo === DONE ===
