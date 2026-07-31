# OpenShare - Project Context

## Project Overview

OpenShare lets you share mobile data internet with another person anywhere in the world. No hotspot, no WiFi tethering. Works over any internet connection via a relay server.

## Project Structure

```
datashare/
├── server/                  # Node.js relay server (WebSocket + TCP tunnel)
│   ├── index.js             # WebSocket server with donor discovery + data relay
│   └── package.json
├── openshare/               # Flutter Android app
│   ├── android/
│   │   └── app/src/main/java/.../
│   │       ├── MainActivity.kt         # Flutter-Native bridge
│   │       └── VpnTunnelService.kt     # Android VPN tunnel
│   └── lib/
│       ├── main.dart                    # App entry + routing
│       ├── screens/
│       │   ├── home_screen.dart         # Main menu
│       │   ├── share_screen.dart        # Donor: start sharing
│       │   ├── browse_screen.dart       # Receiver: find donors
│       │   └── connected_screen.dart    # Active connection
│       └── services/
│           ├── websocket_service.dart   # WebSocket client
│           └── vpn_helper.dart          # VPN bridge (Dart)
└── setup.bat               # One-click setup
```

## Build Environment

| Component | Version | Location |
|-----------|---------|----------|
| Flutter | 3.27.4 | `C:\flutter\flutter` |
| Dart | 3.6.2 | (bundled with Flutter) |
| Java | OpenJDK 17.0.2 | `C:\tools\jdk17_extracted\jdk-17.0.2` |
| Android SDK | cmdline-tools 22.0 | `C:\Users\TAUSHEF\android-sdk` |

## Android SDK Packages Installed

- `build-tools;33.0.1`
- `build-tools;34.0.0`
- `build-tools;35.0.0`
- `platforms;android-34`
- `platforms;android-35`
- `platform-tools` (adb)

## Build Commands

```bash
# Set env vars first
set JAVA_HOME=C:\tools\jdk17_extracted\jdk-17.0.2
set ANDROID_HOME=%USERPROFILE%\android-sdk
set ANDROID_SDK_ROOT=%USERPROFILE%\android-sdk

# Get Flutter packages
cd openshare
flutter pub get

# Build APK
flutter build apk --debug

# APK output: openshare/build/app/outputs/flutter-apk/app-debug.apk
```

## Known Fixes Applied

1. **`local.properties`** - Added `sdk.dir` pointing to Android SDK
2. **`app/build.gradle`** - Added `ext { kotlin_version = "1.8.22" }` block (was missing, causing build failure)
3. **Installed build-tools 33.0.1** - Required by Flutter Gradle plugin internally

## Build Status

✅ **Release APK built and signed** (31 July 2026):
- `openshare/build/app/outputs/flutter-apk/app-release.apk` (20.7 MB)
- Copy: `OpenShare-v1.0.0-release.apk` (project root)
- Signed with own keystore (CN=OpenShare), valid until 2053

## Signing (Release)

- Keystore: `openshare/android/upload-keystore.jks` (backup: `OpenShare-keystore-backup.jks`)
- Credentials: `openshare/android/key.properties` (git-ignored)
- Alias: `openshare` | Password stored in key.properties
- ⚠️ Losing the keystore = can never update the app. Keep backup safe.
- Build release: `cd openshare && flutter build apk --release` (build_release.bat)

## Server

- Node.js relay server in `server/` directory
- Uses `ws` (WebSocket) and `uuid` packages
- Port: 8080 (configurable via PORT env)
- Run: `cd server && node index.js`
- For testing: `npx ngrok http 8080` to expose publicly

## Architecture

- Donor phone runs VpnService to intercept all device traffic
- Traffic is tunneled through WebSocket via the relay server
- Receiver phone connects to donor through the relay
- Discovery: donors broadcast availability; receivers see list and pick one
