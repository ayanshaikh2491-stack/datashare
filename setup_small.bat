@echo off
setlocal
set JAVA_HOME=C:\tools\jdk17_extracted\jdk-17.0.2
set ANDROID_HOME=%USERPROFILE%\android-sdk
set ANDROID_SDK_ROOT=%USERPROFILE%\android-sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%

echo JCODE_PROGRESS {"percent":10,"message":"Installing small android-30 image"}
call sdkmanager.bat "system-images;android-30;default;x86_64" 2>&1
if errorlevel 1 (echo JCODE_CHECKPOINT {"message":"image install FAILED"} & exit /b 1)

echo JCODE_PROGRESS {"percent":70,"message":"Creating AVD"}
call avdmanager.bat create avd -n openshare_test -k "system-images;android-30;default;x86_64" -d pixel_5 --force 2>&1
if errorlevel 1 (echo JCODE_CHECKPOINT {"message":"AVD create FAILED"} & exit /b 1)

echo JCODE_PROGRESS {"percent":100,"message":"Ready"}
echo JCODE_CHECKPOINT {"message":"AVD openshare_test ready"}
