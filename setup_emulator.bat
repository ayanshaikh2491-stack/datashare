@echo off
setlocal
set JAVA_HOME=C:\tools\jdk17_extracted\jdk-17.0.2
set ANDROID_HOME=%USERPROFILE%\android-sdk
set ANDROID_SDK_ROOT=%USERPROFILE%\android-sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%

echo JCODE_PROGRESS {"percent":5,"message":"Installing emulator package"}
call sdkmanager.bat "emulator" 2>&1
if errorlevel 1 (echo JCODE_CHECKPOINT {"message":"emulator install FAILED"} & exit /b 1)

echo JCODE_PROGRESS {"percent":30,"message":"Installing system image android-34 x86_64"}
call sdkmanager.bat "system-images;android-34;google_apis;x86_64" 2>&1
if errorlevel 1 (echo JCODE_CHECKPOINT {"message":"system image FAILED"} & exit /b 1)

echo JCODE_PROGRESS {"percent":60,"message":"Accepting licenses"}
call sdkmanager.bat --licenses < nul 2>&1

echo JCODE_PROGRESS {"percent":80,"message":"Creating AVD"}
echo no | call avdmanager.bat create avd -n openshare_test -k "system-images;android-34;google_apis;x86_64" -d pixel_5 2>&1
if errorlevel 1 (echo JCODE_CHECKPOINT {"message":"AVD create FAILED"} & exit /b 1)

echo JCODE_PROGRESS {"percent":100,"message":"Setup complete"}
echo JCODE_CHECKPOINT {"message":"Emulator + AVD ready"}
