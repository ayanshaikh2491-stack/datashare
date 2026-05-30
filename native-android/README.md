# DataShare VPN - Native Android App v5.0

**Share mobile data WITHOUT hotspot** — Receiver's ALL apps use Donor's internet via VPN tunnel.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│  DONOR PHONE (Kotlin Android App)           │
│                                             │
│  📱 Mobile Data ON                          │
│  🌐 NatProxy: Receives packets → forwards   │
│     to internet → sends responses back      │
│  📊 Tracks MB usage                         │
└──────────────────┬──────────────────────────┘
                   │
                   │ WebSocket Tunnel
                   │ (wss://datashare-server)
                   │
┌──────────────────▼──────────────────────────┐
│  RECEIVER PHONE (Kotlin Android App)        │
│                                             │
│  🛡️ VpnService creates TUN interface        │
│  📡 ALL device traffic captured             │
│  🔄 Packets sent to donor via WebSocket     │
│  ✅ Instagram, YouTube, Browser, SAB CHALEGA│
└─────────────────────────────────────────────┘
```

## 📁 Project Structure

```
native-android/
├── app/
│   ├── build.gradle                    # Dependencies
│   └── src/main/
│       ├── AndroidManifest.xml         # Permissions, services
│       ├── java/com/datashare/
│       │   ├── vpn/
│       │   │   └── DataShareVpnService.kt    # VPN TUN service
│       │   ├── network/
│       │   │   ├── NetworkManager.kt         # WebSocket tunnel
│       │   │   └── NatProxy.kt               # NAT gateway (donor)
│       │   ├── ui/
│       │   │   ├── MainActivity.kt           # Main UI
│       │   │   └── SettingsActivity.kt       # Settings
│       │   └── service/
│       │       ├── VpnStateManager.kt        # VPN state tracking
│       │       ├── DataSharePreferences.kt   # Shared prefs
│       │       ├── ApiService.kt             # HTTP API client
│       │       └── BootReceiver.kt           # Auto-start on boot
│       └── res/
│           ├── layout/
│           │   ├── activity_main.xml
│           │   └── activity_settings.xml
│           ├── values/
│           │   ├── colors.xml
│           │   ├── strings.xml
│           │   └── themes.xml
│           └── drawable/
│               ├── btn_gradient_*.xml
│               └── ic_notification.xml
├── build.gradle                        # Root build config
├── settings.gradle                     # Gradle settings
├── gradle.properties                   # JVM settings
├── build-apk.ps1                       # Windows build script
└── README.md                           # This file
```

## 🔧 Build Requirements

1. **Android Studio** (latest) — https://developer.android.com/studio
2. **JDK 17** (bundled with Android Studio)
3. **Android SDK 34** (installed via Android Studio SDK Manager)
4. **Windows 10/11** (or Linux/macOS with gradle)

## 🚀 Build Steps

### Option 1: PowerShell Script (Windows)
```powershell
cd C:\Users\TAUSHEF\datashare\native-android
.\build-apk.ps1
```

### Option 2: Android Studio
1. Open `native-android/` folder in Android Studio
2. Wait for Gradle sync
3. Build → Build Bundle(s) / APK(s) → Build APK(s)
4. APK at: `app/build/outputs/apk/debug/app-debug.apk`

### Option 3: Command Line
```bash
cd native-android
./gradlew assembleDebug
# or on Windows:
gradlew.bat assembleDebug
```

## 📱 Install APK

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## 🎯 How It Works

1. **Donor** opens app → logs in → selects Donor mode → taps "Start Sharing"
2. **Receiver** opens app → logs in → selects Receiver mode → connects to donor
3. **VPN tunnel** established via WebSocket through server
4. **ALL receiver's traffic** goes through TUN interface → donor → internet
5. **Real-time MB tracking** — donor sees usage, receiver sees data consumed
6. **No hotspot needed** — pure VPN tunnel over WebSocket

## 🔐 Key Features

- ✅ **Full Internet Sharing** — All apps (Instagram, YouTube, Browser, etc.)
- ✅ **No Hotspot** — VPN tunnel via WebSocket
- ✅ **Real-time MB Tracking** — Auto-tracked in database
- ✅ **Auto-Reconnect** — Reconnects after reboot
- ✅ **Donor Controls** — Data limits, time limits, max receivers
- ✅ **Dark Theme** — Beautiful Material Design UI

## ⚠️ Limitations

- UDP traffic partially supported (DNS only)
- TCP only (HTTP/HTTPS) fully supported
- Requires donor's mobile data to be ON
- Both devices need internet access for initial connection

## 📊 Server Requirements

The existing Node.js server at `https://datashare-server.onrender.com` handles:
- User authentication
- Donor/receiver matching
- WebSocket relay between donor and receiver
- Usage tracking and limits

## 🔄 Version History

- **v5.0.0** — Native Android VPN app with TUN interface
- **v4.1.0** — In-app browser proxy (web app)
- **v4.0.0** — WebRTC file transfer
- **v3.0.0** — WebView wrapper
- **v2.0.0** — Basic web app
