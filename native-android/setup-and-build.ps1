# DataShare VPN — Full SDK Setup + APK Build
# This downloads Java 17, Android SDK, and builds the APK
$ErrorActionPreference = "Continue"

$projectDir = Split-Path $MyInvocation.MyCommand.Path -Parent
Set-Location $projectDir

$sdkDir = Join-Path $projectDir "android-sdk"
$toolsDir = Join-Path $sdkDir "cmdline-tools"
$latestDir = Join-Path $toolsDir "latest"
$javaDir = Join-Path $projectDir "jdk-17"

# Set environment variables
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir

# ============================================================
# Step 1: Download & Setup Java 17 (Temurin)
# ============================================================
if (Test-Path (Join-Path $javaDir "bin\java.exe")) {
    Write-Host "Java 17 already installed: $javaDir" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Step 1: Downloading Java 17 (Temurin)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    $javaUrl = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip"
    $javaZip = "$env:TEMP\jdk17.zip"

    if (-not (Test-Path $javaZip)) {
        Write-Host "Downloading Java 17 (~200MB)..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $javaUrl -OutFile $javaZip -UseBasicParsing
    }

    Write-Host "Extracting Java 17..." -ForegroundColor Yellow
    Expand-Archive -Path $javaZip -DestinationPath $projectDir -Force

    # Rename extracted folder to jdk-17
    $extracted = Get-ChildItem $projectDir -Directory | Where-Object { $_.Name -match "jdk-17" -or $_.Name -match "jdk-17\." } | Select-Object -First 1
    if ($extracted -and $extracted.FullName -ne $javaDir) {
        if (Test-Path $javaDir) { Remove-Item $javaDir -Recurse -Force }
        Rename-Item $extracted.FullName "jdk-17"
    }

    Remove-Item $javaZip -Force -ErrorAction SilentlyContinue
    Write-Host "Java 17 installed: $javaDir" -ForegroundColor Green
}

# Set JAVA_HOME
$env:JAVA_HOME = $javaDir
$env:PATH = "$javaDir\bin;$env:PATH"

$javaVersion = & "$javaDir\bin\java.exe" -version 2>&1 | Select-Object -First 1
Write-Host "Java version: $javaVersion" -ForegroundColor Green

# ============================================================
# Step 2: Download & Setup Android SDK Command-Line Tools
# ============================================================
if (Test-Path (Join-Path $latestDir "bin\sdkmanager.bat")) {
    Write-Host "Android SDK cmdline-tools already installed" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Step 2: Downloading Android SDK Tools" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    $sdkToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    $sdkToolsZip = "$env:TEMP\cmdline-tools.zip"

    if (-not (Test-Path $sdkToolsZip)) {
        Write-Host "Downloading SDK tools (~150MB)..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $sdkToolsUrl -OutFile $sdkToolsZip -UseBasicParsing
    }

    Write-Host "Extracting SDK tools..." -ForegroundColor Yellow

    # Create directory structure: sdk/cmdline-tools/latest/
    if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null }
    if (-not (Test-Path $latestDir)) { New-Item -ItemType Directory -Path $latestDir -Force | Out-Null }

    Expand-Archive -Path $sdkToolsZip -DestinationPath $env:TEMP\cmdline-extract -Force

    # Move cmdline-tools contents to latest
    $extractedCmdline = Get-ChildItem "$env:TEMP\cmdline-extract" -Directory | Select-Object -First 1
    if ($extractedCmdline) {
        Copy-Item "$($extractedCmdline.FullName)\*" $latestDir -Recurse -Force
    }

    Remove-Item $sdkToolsZip -Force -ErrorAction SilentlyContinue
    Remove-Item "$env:TEMP\cmdline-extract" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Android SDK tools installed: $latestDir" -ForegroundColor Green
}

# ============================================================
# Step 3: Install SDK Platform 34 + Build Tools
# ============================================================
$sdkManager = Join-Path $latestDir "bin\sdkmanager.bat"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 3: Installing SDK Platform 34" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check if already installed
if (-not (Test-Path (Join-Path $sdkDir "platforms\android-34"))) {
    Write-Host "Installing platform-34, build-tools, platform-tools..." -ForegroundColor Yellow

    # Accept licenses and install
    & $sdkManager --sdk_root=$sdkDir --licenses

    # Install the actual packages
    & $sdkManager --sdk_root=$sdkDir "platforms;android-34" "build-tools;34.0.0" "platform-tools"

    Write-Host "SDK Platform 34 installed" -ForegroundColor Green
} else {
    Write-Host "SDK Platform 34 already installed" -ForegroundColor Green
}

# ============================================================
# Step 4: Setup local.properties
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 4: Configuring local.properties" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$sdkDirEscaped = $sdkDir -replace '\\', '/'
Set-Content -Path (Join-Path $projectDir "local.properties") -Value "sdk.dir=$sdkDirEscaped"
Write-Host "local.properties created" -ForegroundColor Green

# ============================================================
# Step 5: Setup Gradle Wrapper
# ============================================================
if (-not (Test-Path (Join-Path $projectDir "gradlew.bat"))) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Step 5: Downloading Gradle 8.2" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    $gradleUrl = "https://services.gradle.org/distributions/gradle-8.2-bin.zip"
    $gradleZip = "$env:TEMP\gradle-8.2-bin.zip"

    if (-not (Test-Path $gradleZip)) {
        Write-Host "Downloading Gradle 8.2 (~130MB)..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $gradleUrl -OutFile $gradleZip -UseBasicParsing
    }

    Write-Host "Extracting Gradle 8.2..." -ForegroundColor Yellow
    Expand-Archive -Path $gradleZip -DestinationPath $env:TEMP -Force

    $gradleHome = Join-Path $env:TEMP "gradle-8.2"

    # Use gradle to generate wrapper
    & "$gradleHome\bin\gradle.bat" -p $projectDir wrapper --gradle-version 8.2 --stacktrace

    Write-Host "Gradle wrapper created" -ForegroundColor Green
} else {
    Write-Host "Gradle wrapper already exists" -ForegroundColor Green
}

# ============================================================
# Step 6: Build APK
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 6: Building APK" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

.\gradlew.bat assembleDebug --stacktrace

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESS!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green

    $apkPath = Join-Path $projectDir "app\build\outputs\apk\debug\app-debug.apk"
    if (Test-Path $apkPath) {
        $apkPath = Resolve-Path $apkPath

        # Copy to project root for easy access
        $destName = "DataShare-VPN-v5.2.0-debug.apk"
        $destPath = Join-Path $projectDir $destName
        Copy-Item $apkPath $destPath -Force

        Write-Host ""
        Write-Host "APK: $apkPath" -ForegroundColor Green
        Write-Host "Copied to: $destPath" -ForegroundColor Green
        Write-Host ""
        Write-Host "Install to device: adb install -r '$destPath'" -ForegroundColor Cyan
    }
} else {
    Write-Host ""
    Write-Host "BUILD FAILED!" -ForegroundColor Red
    Write-Host "Check the error messages above." -ForegroundColor Yellow
    exit 1
}
