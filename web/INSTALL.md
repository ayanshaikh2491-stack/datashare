# 📦 DataShare v5.2.0-vpn-fix - Installation Guide

## 📲 Download APK

### Option 1: GitHub Release (Recommended)
```
Phone Chrome mein kholo:
https://github.com/ayanshaikh2491-stack/datashare/releases/tag/v5.2.0-vpn-fix

→ "DataShare-v5.2.0-vpn-fix.apk" download karo
```

### Option 2: Direct from Server (after Render deploy)
```
https://datashare-server.onrender.com/app-release.apk
```

---

## ⚙️ Install on Android

1. **Download APK** (upar se)
2. **Open file** → Chrome ya Downloads se
3. **Allow unknown sources** (agar pehli baar hai):
   ```
   Settings → Security → Install unknown apps
   → (Chrome ya Files app) → Allow
   ```
4. **Install** → **Open**

---

## 🚀 How to Use

### Donor Mode (Jo data share karega)

```
1. Phone 1: Open DataShare app
2. Tap "Donor Mode"
3. Tap "Start Sharing"
4. Copy Donor ID (e.g., "donor_abc123")
5. Send Donor ID to Receiver (WhatsApp wagerah)
```

### Receiver Mode (Jo data le raha hai)

```
1. Phone 2: Open DataShare app
2. Tap "Receiver Mode"
3. Enter Donor ID (jo donor ne diya)
4. Tap "Connect"
5. ✅ Connected! Chrome kholo → data aayega
```

---

## 🔄 Auto-Update System

Future updates **apne aap** honge — kuch nahi karna!

```
Current APK (v6) → Server version check karega
→ Agar naya version ho → "Update Available" dialog
→ "Download" click → Naya APK auto install
→ ✅ Done!
```

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| Blank screen | Install v5.2.0-vpn-fix (yeh wala) |
| Data stuck after start | Install naya version |
| WebSocket disconnect | Server pe fix deployed hai |
| "Can't connect" | Check internet, Donor ID sahi hai? |

---

## 📊 Version History

| Version | Name | Fixes |
|---------|------|-------|
| 7 | 5.2.0-vpn-fix | WS fix, TCP seq, UI fix, WakeLock |
| 6 | 5.1.0-color-fix | Color scheme, UI updates |
| 5 | 5.0.0-vpn | Initial VPN tunnel release |
