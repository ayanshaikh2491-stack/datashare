# OpenShare

**Share Internet Anywhere - No Hotspot Needed, Unlimited Distance**

OpenShare lets you share your mobile data internet with another person anywhere in the world via a free 24/7 relay server. It also works with zero internet: the donor phone creates a private "OpenShare" WiFi and the receiver joins it directly.

## How It Works

```
Cloud mode (any distance):
[Donor with internet] --WebSocket--> [free relay on HF Space] <--WebSocket-- [Receiver]
        Internet flows through the donor's data via the relay tunnel.

Local mode (zero internet):
[Donor] hosts "OpenShare" WiFi + in-app relay (port 8080)
[Receiver with NO internet] joins "OpenShare" WiFi, taps "Connect Local", gets donor's internet.
```

## Quick Start (App)

1. Install `app-debug.apk` on two Android phones (Android 8+).
2. Donor: open app → tap **Start Sharing**. No URL needed — connects to the free relay automatically.
3. Receiver: open app → tap **Browse Networks** → **Connect**. Tap a donor → VPN permission → internet works! 🎉

No server setup needed. The relay runs free on Hugging Face Spaces and is kept alive 24/7 by a GitHub Actions keep-alive workflow.

## Local Mode (Zero Internet)

- Donor: tap **Start Sharing** while on cellular data. The app creates an "OpenShare" WiFi network (Android 8+ local-only hotspot) and starts an in-app relay on port 8080.
- Receiver (no internet at all): open WiFi settings → join the "OpenShare" network → back in the app → tap **Connect Local (no internet)** → donor appears → tap Connect.
- Works fully offline between the two phones; only the donor needs mobile data.

## Running the Server Yourself (Optional)

```bash
cd server
npm install
node index.js            # listens on PORT (default 8080)
```

Health check: `curl http://localhost:8080/` → `{"ok":true}`

Keep it free with the included GitHub Actions workflow (`.github/workflows/keepalive.yml`) that pings the deployed server every 5 minutes.

## Running the Tests

```bash
node server/relay_test.js              # server health + heartbeat + cleanup + session
node server/real_internet_share_test.js # real end-to-end internet proof (needs node 18+ and a network)
cd openshare && flutter test           # app unit tests
```

CI (GitHub Actions) runs all tests and builds the APK on every push.

## Building the APK

```bash
cd openshare
flutter build apk --debug
# Output: openshare/build/app/outputs/flutter-apk/app-debug.apk
```

## Project Structure

```
datashare/
├── server/                    # Node.js relay server
│   ├── index.js               # WebSocket server + TCP tunnel + heartbeat cleanup
│   ├── keepalive.js           # Self-ping helper (keeps the free Space awake)
│   ├── relay_test.js          # Health + heartbeat + cleanup + session tests
│   ├── real_internet_share_test.js  # Real end-to-end internet proof
│   └── package.json
├── .github/workflows/
│   ├── openshare-e2e.yml      # CI: tests + APK build on push
│   ├── keepalive.yml          # Pings the relay every 5 min (never sleeps)
│   └── internet-proof.yml     # Real internet proof run
├── openshare/                 # Flutter Android app
│   ├── android/app/src/main/kotlin/com/openshare/openshare/
│   │   ├── MainActivity.kt    # Flutter ↔ Native bridge (VPN + local hotspot)
│   │   └── VpnTunnelService.kt # Android VPN tunnel
│   ├── lib/
│   │   ├── main.dart          # App entry + routing
│   │   ├── screens/
│   │   │   ├── home_screen.dart      # Main menu
│   │   │   ├── share_screen.dart     # Donor: Start/Stop sharing
│   │   │   ├── browse_screen.dart    # Receiver: find donors + Connect Local
│   │   │   └── connected_screen.dart # Active connection
│   │   └── services/
│   │       ├── websocket_service.dart # WebSocket client + auto-reconnect
│   │       ├── tunnel_proxy.dart      # TCP tunnel proxy
│   │       ├── vpn_helper.dart        # VPN bridge (Dart)
│   │       ├── local_relay_server.dart # In-app relay for local mode
│   │       └── local_hotspot.dart     # Android LocalOnlyHotspot bridge
│   └── test/                   # flutter unit tests (relay, ws, widget)
└── README.md
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
- The free relay (default, no setup) or your own server

## Architecture

| Component | Tech | Purpose |
|-----------|------|---------|
| Relay Server | Node.js + WebSocket | Donor discovery + data relay, heartbeat cleanup |
| Free Hosting | Hugging Face Space + keep-alive cron | 24/7 relay |
| Mobile App | Flutter + Kotlin | UI + VPN tunnel |
| Local Mode | Kotlin LocalOnlyHotspot + Dart in-app relay | Zero-internet sharing |

## Security Notes

- Open network: anyone can join any donor. Authentication/encryption planned.
- Future versions: Authentication, encryption, whitelist

## License

MIT
