# 📱 DataShare — Flutter Mobile App

> **Community-driven data sharing platform** — Share your unlimited data with those who need it.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│           FLUTTER MOBILE APP                │
│                                             │
│  📄 main.dart           ← App entry         │
│  📦 providers/          ← State management   │
│  🔧 services/           ← API, WebSocket    │
│  📊 models/             ← Data models       │
│  🎨 ui/screens/         ← All screens       │
└─────────────────────────────────────────────┘
         ↕ HTTP + WebSocket
┌─────────────────────────────────────────────┐
│           BACKEND SERVER (Koyeb)            │
│  Node.js + Express + WebSocket              │
└─────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
mobile/
├── pubspec.yaml                  ← Dependencies
├── lib/
│   ├── main.dart                 ← App entry + theme
│   ├── models/
│   │   └── models.dart           ← User, Donor, Receiver, Connection
│   ├── services/
│   │   ├── api_service.dart      ← HTTP API calls
│   │   ├── websocket_service.dart ← Real-time WebSocket
│   │   └── storage_service.dart  ← Local storage (prefs)
│   ├── providers/
│   │   └── providers.dart        ← Auth, Donor, Receiver state
│   └── ui/screens/
│       ├── login_screen.dart     ← Login / Register
│       ├── home_screen.dart      ← Bottom navigation
│       ├── donor_screen.dart     ← Donor mode (share data)
│       ├── receiver_screen.dart  ← Receiver mode (get data)
│       └── settings_screen.dart  ← Profile + settings
```

---

## 🛠️ Setup

### 1. Install Flutter
```bash
# Windows (PowerShell as Admin)
winget install --id Google.Flutter

# Or download from: https://flutter.dev/docs/get-started/install
```

### 2. Verify Installation
```bash
flutter doctor
```

### 3. Get Dependencies
```bash
cd mobile
flutter pub get
```

### 4. Configure API URL
Edit `lib/services/api_service.dart`:
```dart
static const String baseUrl = 'https://your-app.koyeb.app'; // Your Koyeb URL
```

Edit `lib/services/websocket_service.dart`:
```dart
static const String wsUrl = 'wss://your-app.koyeb.app'; // Your Koyeb URL
```

### 5. Run the App
```bash
# Android emulator or connected device
flutter run

# Specific platform
flutter run -d chrome    # Web
flutter run -d windows   # Windows
flutter run -d android   # Android device
```

### 6. Build APK
```bash
flutter build apk --release
```

---

## 🎨 UI Screens

| Screen | Description |
|--------|-------------|
| **Login** | Phone + name registration, role selection |
| **Home** | Bottom nav: Donate, Receive, Settings |
| **Donate** | Go online/offline, manage connections, stats |
| **Receive** | Find donors, auto-connect, monitor usage |
| **Settings** | Profile, donor limits, logout |

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `http` | API calls to backend |
| `provider` | State management |
| `shared_preferences` | Local token storage |
| `web_socket_channel` | Real-time WebSocket |
| `intl` | Date/time formatting |
| `flutter_map` | Location display |
| `geolocator` | GPS location |

---

## 🎯 Features

### Donor Mode:
- ✅ Go online/offline with one tap
- ✅ Accept/reject connection requests
- ✅ Disconnect any user
- ✅ Set data limits, time limits, max users
- ✅ Real-time connection monitoring

### Receiver Mode:
- ✅ Find available donors
- ✅ Auto-connect to best donor
- ✅ Monitor data usage with progress bar
- ✅ See available donor list
- ✅ Daily limits enforced (5 donors, 2GB)

---

## 📝 License

MIT — Open Source, Community Driven 🤝
