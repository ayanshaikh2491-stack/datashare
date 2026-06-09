# DataShare Mobile Fix — End-to-End Working

**Date:** 2026-06-09
**Author:** Brainstorming session with user (Ayan)

## Problem Statement
Donor and receiver both experience app exit/crash on mobile. WebSocket notifications don't deliver, VPN connects but data doesn't flow. User needs end-to-end internet sharing that works on mobile without errors.

## Current State
- **App:** WebView wrapper (`mobile/lib/main.dart`) loads `https://datashare-server.onrender.com`
- **UI:** All in `web/index.html` (vanilla JS)
- **Server:** Express on Render free tier (`server/src/index.js`)
- **DB:** Supabase (PostgreSQL)
- **Two parallel systems:** WebRTC (direct P2P) and VPN tunnel (raw IP relay via `vpn-tunnel.service.js`)
- **Known bug:** `websocket.service.js` is imported by routes but never initialized — notifications are silent no-ops
- **Known bug:** Donor VPN crashes when starting TUN interface (partially fixed in `1014bb6`)

## Design

### Architecture Decision: Single Path — VPN Tunnel Only
Discard WebRTC as a separate system. All data flows through `vpn-tunnel.service.js` which already supports binary WebSocket relay. This eliminates:
- Dual-system complexity (WebRTC + VPN)
- Route import confusion (routes importing wrong service)
- Two separate code paths to debug

### Part 1: Server — Wire Routes to vpn-tunnel.service

**Problem:** Routes (`connect.js`, `donate.js`, etc.) import `../services/websocket.service` which is never initialized. `vpn-tunnel.service.js` is initialized in `index.js` but routes don't use it.

**Fix:**
1. Export `sendToUser` / `broadcastToReceivers` / client maps from `vpn-tunnel.service.js`
2. Update all route files to import from `vpn-tunnel.service` instead of `websocket.service`
3. Verify `vpn-tunnel.service.initVpnTunnel(server)` is called in `index.js` (already is)
4. Remove `websocket.service.js` initialization or delete dead code

**Result:** Donor receives real-time notification when receiver connects → data relay begins.

### Part 2: Donor VPN Crash Fix — Complete

**Problem:** Donor mode tries to create a TUN interface, which requires `VpnService.prepare()` and crashes the app.

**Fix in `DataShareVpnService.kt`:**
1. Donor mode → skip TUN interface creation entirely
2. Donor acts as pure WebSocket relay: receives binary frames from server, forwards to real network, sends responses back
3. `VpnService.prepare()` — only call on receiver, never on donor
4. `START_NOT_STICKY` — don't auto-restart on crash (avoids restart loops)
5. `addDisallowedApplication` — wrap in try-catch (some OEMs reject it)
6. Ensure `SERVER_URL` constant is correct and WebSocket connects on start

**Donor flow:**
```
Donor app → WebSocket connect to server → Register as donor
→ Receive binary frames from receiver (via server)
→ Forward to real Android network (HTTP/TCP sockets)
→ Read response → Send binary frame back to server → Receiver
```
No TUN, no VPN icon, no crash.

### Part 3: Receiver — VPN + Reconnect + Cold Start UX

**Problem 1:** Receiver VPN permission/connect flow may fail silently.
**Fix:** Ensure `VpnService.prepare()` returns valid intent, TUN is created with correct routes (10.8.0.0/24), and WebSocket connects before TUN starts reading.

**Problem 2:** Fixed 5s reconnect in `web/index.html` and Flutter service — hammers server during cold start.
**Fix:** Exponential backoff with jitter: 2s → 4s → 8s → 16s → 30s (max), with ±20% jitter.

**Problem 3:** Render free tier sleeps after 15 min inactivity → cold start takes 30-60s → user thinks app exited.
**Fix:** Show "Server is waking up, please wait..." message in WebView. Keep `loader` visible until WebSocket actually connects (not on a fixed timeout).

### End-to-End Flow (After Fix)
```
1. Donor: "Start Sharing" → WebSocket connect → Register as donor → Server online
2. Receiver: "Connect" → VPN permission → TUN created → WebSocket connect → Register as receiver
3. Server: vpn-tunnel.service notifies donor of receiver connection
4. Donor: Accepts → Server relays binary data receiver ↔ donor
5. Donor: Forwards to real internet, sends response back
6. Receiver: Gets internet through donor → User can browse/use apps
7. If server sleeps: Both clients reconnect with backoff, "waking up" message shown
```

### Files to Modify
| File | Change |
|------|--------|
| `server/src/routes/*.js` | Import from `vpn-tunnel.service` instead of `websocket.service` |
| `server/src/index.js` | Clean up dead websocket.service init, verify vpn-tunnel init |
| `native-android/app/src/main/java/com/datashare/DataShareVpnService.kt` | Donor skips TUN, receiver uses TUN, START_NOT_STICKY, try-catch addDisallowedApplication |
| `web/index.html` | Exponential backoff reconnect, cold start UX, loader management |
| `mobile/lib/services/websocket_service.dart` | Exponential backoff reconnect |

### Success Criteria
1. Donor starts sharing → app stays open and stable
2. Receiver connects → VPN activates → donor receives notification
3. Receiver internet works through donor (browse, YouTube, etc.)
4. Server cold start → "waking up" message → auto-reconnect works
5. No crashes on either device
