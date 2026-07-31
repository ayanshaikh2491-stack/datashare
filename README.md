# OpenShare

**Share Internet Anywhere - No Hotspot, No WiFi, Unlimited Distance**

OpenShare lets you share your mobile data internet with another person anywhere in the world. No hotspot, no WiFi tethering needed. Works over any internet connection via a relay server.

## How It Works

```
Donor (has internet)                      Receiver (needs internet)
      │                                            │
      │─── WebSocket Connect ──→ [Relay Server] ←──│
      │                            │               │
      │←───── Pair & Route ────────│───────────────│
      │                            │               │
      │←======= VpnService =======│========= VpnService ======→
      │   (intercept traffic)     │   (forward via tunnel)   │
      │                            │               │
      └────────── Internet flows via tunnel ───────→ Internet ✅
```

### Flow (Simple)

1. **Donor** opens app → taps **Start Sharing** → connects to relay server
2. **Receiver** opens app → taps **Browse Networks** → sees available donors
3. **Receiver** taps a donor → instantly connected
4. Receiver gets internet through donor's data connection

## Project Structure

```
datashare/
├── server/              # Node.js relay server
│   ├── index.js         # WebSocket server + TCP tunnel
│   └── package.json
├── openshare/           # Flutter Android app
│   ├── android/
│   │   └── app/src/main/java/.../
│   │       ├── MainActivity.kt     # Flutter ↔ Native bridge
│   │       └── VpnTunnelService.kt # Android VPN tunnel
│   └── lib/
│       ├── main.dart               # App entry + routing
│       ├── screens/
│       │   ├── home_screen.dart     # Main menu
│       │   ├── share_screen.dart    # Donor: start sharing
│       │   ├── browse_screen.dart   # Receiver: find donors
│       │   └── connected_screen.dart # Active connection
│       └── services/
│           ├── websocket_service.dart # WebSocket client
│           └── vpn_helper.dart       # VPN bridge (Dart)
└── setup.bat             # One-click setup script
```

## Requirements

### For Building

| Tool | Minimum Version | Download |
|------|----------------|----------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Flutter | 3.x | [flutter.dev](https://flutter.dev) |
| Android SDK | 34 | Part of Android Studio |
| Java | 11+ | [adoptium.net](https://adoptium.net) |

### For Running

- Two Android phones (Android 8+ / API 26+)
- A relay server (VPS, Railway, Render, or local machine)

## Quick Start

### 1. Setup

```bash
# Install dependencies
cd server
npm install

cd ../openshare
flutter pub get
```

### 2. Start Relay Server

```bash
cd server
node index.js
# Server starts on port 8080
```

**For internet access:** Deploy to a cloud server (Railway, Render, DigitalOcean) so both phones can reach it. Or run on your PC and expose with `ngrok http 8080`.

### 3. Build APK

```bash
cd openshare
flutter build apk --debug
```

APK will be at: `openshare/build/app/outputs/flutter-apk/app-debug.apk`

### 4. Usage

**On Phone 1 (Donor - has internet):**
1. Install APK and open OpenShare
2. Tap **Start Sharing**
3. Enter relay server URL: `ws://your-server-ip:8080`
4. Tap **Start Sharing**
5. Status shows "Sharing..." and waits for receiver

**On Phone 2 (Receiver - needs internet):**
1. Install APK and open OpenShare
2. Tap **Browse Networks**
3. Enter same relay server URL
4. Tap **Connect**
5. Available donors appear in list
6. Tap **Connect** next to a donor
7. VPN permission request → tap **OK**
8. Internet works! 🎉

## Deployment

### Deploy Relay Server (Free)

**Option 1: Railway (easiest)**
```bash
# Push server/ folder to GitHub, connect to Railway
# Railway auto-detects Node.js and sets PORT env
```

**Option 2: Render**
```bash
# Connect GitHub repo
# Start command: node index.js
```

**Option 3: VPS (DigitalOcean, etc.)**
```bash
# Copy server/ to your VPS
npm install
node index.js
# Use PM2 to keep it running: pm2 start index.js --name openshare
```

## Architecture

| Component | Tech | Purpose |
|-----------|------|---------|
| Relay Server | Node.js + WebSocket | Discovery + data relay |
| Mobile App | Flutter + Kotlin | UI + VPN tunnel |
| VPN Tunnel | Android VpnService | Intercept device traffic |
| Data Channel | WebSocket via server | Transfer tunnel data |

## Security Notes

- **Version 1:** Open network - anyone can join any donor
- Future versions: Authentication, encryption, whitelist

## Roadmap

- [x] Basic relay server
- [x] Flutter UI with donor/receiver flows
- [x] Android VPN tunnel service
- [ ] Build APK with proper signing
- [ ] Request/approval system
- [ ] End-to-end encryption
- [ ] P2P fallback (WireGuard)
- [ ] Desktop clients (Windows, macOS)

## License

MIT
