# DataShare VPN - Windows Build Script
# Run this in PowerShell to build the APK
# Requirements: Android Studio installed with SDK

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DataShare VPN - APK Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find Android SDK
$sdkPaths = @(
    "$env:LOCALAPPDATA\Android\Sdk",
    "C:\Android\android-sdk",
    "$env:ANDROID_HOME",
    "$env:ANDROID_SDK_ROOT"
)

$androidSdk = $null
foreach ($path in $sdkPaths) {
    if ($path -and (Test-Path "$path\platforms")) {
        $androidSdk = $path
        break
    }
}

if (-not $androidSdk) {
    Write-Host "ERROR: Android SDK not found!" -ForegroundColor Red
    Write-Host "Please install Android Studio first." -ForegroundColor Yellow
    Write-Host "Download: https://developer.android.com/studio" -ForegroundColor Yellow
    exit 1
}

Write-Host "SDK found: $androidSdk" -ForegroundColor Green

# Set environment variables
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk

# Find Java
$javaPaths = @(
    "$env:ProgramFiles\Android\Android Studio\jbr\bin",
    "$env:ProgramFiles\Android\Android Studio\jre\bin",
    "$env:LOCALAPPDATA\Android\Sdk\jdk\bin"
)

$javaHome = $null
foreach ($path in $javaPaths) {
    if ($path -and (Test-Path "$path\java.exe")) {
        $javaHome = Split-Path $path -Parent
        break
    }
}

if (-not $javaHome) {
    Write-Host "ERROR: JDK not found!" -ForegroundColor Red
    Write-Host "Using JAVA_HOME if set..." -ForegroundColor Yellow
    $javaHome = $env:JAVA_HOME
}

if ($javaHome) {
    $env:JAVA_HOME = $javaHome
    $env:PATH = "$javaHome\bin;$env:PATH"
    Write-Host "Java: $javaHome" -ForegroundColor Green
}

# Navigate to project
$projectDir = Split-Path $MyInvocation.MyCommand.Path -Parent
Set-Location $projectDir

Write-Host ""
Write-Host "Project: $projectDir" -ForegroundColor Green
Write-Host ""

# Check if gradlew exists
if (-not (Test-Path "gradlew.bat")) {
    Write-Host "Gradle wrapper not found. Downloading..." -ForegroundColor Yellow
    
    # Download gradle wrapper
    $gradleWrapperUrl = "https://services.gradle.org/distributions/gradle-8.2-bin.zip"
    $gradleZip = "$env:TEMP\gradle-8.2-bin.zip"
    
    if (-not (Test-Path $gradleZip)) {
        Write-Host "Downloading Gradle 8.2..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $gradleWrapperUrl -OutFile $gradleZip
    }
    
    # Extract gradle
    $gradleDir = "$env:TEMP\gradle-8.2"
    if (-not (Test-Path $gradleDir)) {
        Expand-Archive -Path $gradleZip -DestinationPath $env:TEMP -Force
    }
    
    # Generate wrapper
    & "$gradleDir\bin\gradle.bat" wrapper --gradle-version 8.2
}

# Build debug APK
Write-Host ""
Write-Host "Building Debug APK..." -ForegroundColor Cyan
Write-Host ""

if (Test-Path "gradlew.bat") {
    .\gradlew.bat assembleDebug --stacktrace
} else {
    # Use gradle directly
    & "$env:TEMP\gradle-8.2\bin\gradle.bat" assembleDebug --stacktrace
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESS!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    
    # Find APK
    $apkPath = "app\build\outputs\apk\debug\app-debug.apk"
    if (Test-Path $apkPath) {
        $apkPath = Resolve-Path $apkPath
        Write-Host "APK location: $apkPath" -ForegroundColor Green
        Write-Host ""
        Write-Host "Install to device: adb install $apkPath" -ForegroundColor Cyan
        Write-Host ""
        
        # Auto-install if adb available
        if (Get-Command adb -ErrorAction SilentlyContinue) {
            Write-Host "Installing to connected device..." -ForegroundColor Cyan
            adb install -r $apkPath
            if ($LASTEXITCODE -eq 0) {
                Write-Host "App installed successfully!" -ForegroundColor Green
            }
        }
    }
} else {
    Write-Host ""
    Write-Host "BUILD FAILED!" -ForegroundColor Red
    Write-Host "Check the error messages above." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
