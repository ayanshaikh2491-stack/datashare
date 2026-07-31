@echo off
set JAVA_HOME=C:\tools\jdk17_extracted\jdk-17.0.2
set ANDROID_HOME=%USERPROFILE%\android-sdk
set ANDROID_SDK_ROOT=%USERPROFILE%\android-sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd /d %USERPROFILE%\datashare\openshare
echo JCODE_PROGRESS {"percent":5,"message":"release build starting"}
call C:\flutter\flutter\bin\flutter.bat build apk --release
if errorlevel 1 (echo JCODE_CHECKPOINT {"message":"release build FAILED"} & exit /b 1)
echo JCODE_PROGRESS {"percent":100,"message":"release build complete"}
echo JCODE_CHECKPOINT {"message":"release APK built"}
