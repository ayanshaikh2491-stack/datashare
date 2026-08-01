# OpenShare Relay Design (v2) — 2-Mode Internet Sharing

Date: 2026-08-01
Status: Approved by user (2026-08-01)

## Problem

- App "Server failed to connect" error deta hai, both donor and receiver side.
- HF Space (`ayanshaikh2/datashare-relay`) is running, but WebSocket probe returned 400 via raw handshake. Proper `ws` client connects fine and returns a real DONOR_LIST. So server works; reliability (sleep/wake, stale sockets) needs hardening.
- User wants: server should never error, run 24/7 free, and a receiver with **zero internet** should still be able to use the donor's internet.
- User chose: **relay-based** approach (not WebRTC), with **Mode 1: cloud relay** and **Mode 2: local WiFi-direct relay** (option 1 = donor-hosted local WiFi network, not Bluetooth).

## Goal / Success Criteria

1. Donor taps **Start** → connects automatically to cloud relay (no URL typing). **Stop** → disconnects.
2. Donor also hosts a **local "OpenShare" WiFi network** (no internet, only phone-to-phone link) so a zero-internet receiver can join and use donor's mobile data.
3. Server never sleeps: **pinger** hits the HF space every 5 minutes.
4. Server cleans dead connections: heartbeat + stale cleanup (no ghost donors, no "Donor busy" stuck states).
5. Every build runs a cloud test producing a log file with `INTERNET_SHARING=WORKING` (donor IP == receiver IP), plus a local-mode test producing its own log proof.

## Architecture

### Server (`server/`)

Node.js + `ws` (already exists). Add:

- **Health endpoint** `GET /` → 200 `{"ok":true}` for pinger (plain HTTP on same port; `ws` server + tiny http server together).
- **Pinger** (can run in CI cron or a small always-on script): every 5 min `GET https://ayanshaikh2-datashare-relay.hf.space/` to keep HF space awake.
- **Heartbeat:** server pings each client every 30s; if no pong within 15s → terminate + cleanup. (Keeps donor list honest.)
- **Stale cleanup:** if a donor/receiver is gone (closed/error), remove from `donors`/`sessions` and broadcast donor list.
- **Logging:** append-line log of every connect/disconnect/session start/end with timestamp → readable proof file.
- Keep message protocol as-is (`DONOR_REGISTER`, `REQUEST_DONORS`, `SELECT_DONOR`, `SESSION_STARTED`, `TUNNEL_DATA`, `OPEN_TCP`, `TCP_READY`, `TCP_DATA`, `TCP_CLOSE`, `SESSION_END`) — app already speaks it.

### App (`openshare/`)

- **ShareScreen:** "Start Sharing" button → `ws.connect(defaultUrl)` (default already correct) → register donor → also start **local AP mode** (see below). "Stop" → disconnect + stop local mode.
- **Auto-reconnect:** on `DISCONNECTED`/`ERROR`, retry connect every 2s up to N times, then show error once.
- **Mode 2 local relay:** donor phone creates a **WiFi hotspot-like local network named "OpenShare"** with **no internet** (Android `WifiManager.LocalOnlyHotspot` API — no carrier involvement, no data used). Receiver scans and joins it, then connects to donor's local relay server (`ws://10.0.0.1:8080` style) and shares donor's mobile data via the existing TCP tunnel + receiver proxy path.
  - Note: LocalOnlyHotspot requires location permission on Android; document that. If not available, fall back to cloud mode with a clear message.
- **Receiver UI:** "Browse" shows donors from cloud; if no internet, user can join "OpenShare" local network first, then Browse (local relay serves donor list).

### CI (`.github/workflows/internet-proof.yml`)

- Existing fast proof run stays (internet share test + arm64 debug APK).
- Add **local-mode proof test** (2 virtual nodes on same machine over loopback/localhost acting as donor+receiver) producing log with `INTERNET_SHARING=WORKING`.
- Upload logs + APK as artifacts (already done).

## Error Handling

- Connection fail → auto-reconnect, then user-visible single error.
- HF space cold start (first request after sleep) → pinger prevents; if still slow, client waits up to 15s.
- Donor busy / not found → clear snackbar, refresh donor list.
- Local hotspot failure → show reason (location permission etc), keep cloud mode working.

## Testing

- Local: `node server/real_internet_share_test.js` + local-mode test → both must print `INTERNET_SHARING=WORKING`.
- Cloud: GitHub Actions run → artifacts `internet-proof.log` + `local-proof.log` + APK.
- Manual: install APK, tap Start on donor, Browse+Connect on receiver with WiFi only; verify donor IP == receiver IP via app status or log.

## Out of Scope (YAGNI)

- WebRTC, Bluetooth mode, account/auth, multi-hop, end-to-end encryption, paid hosting.
- Fixing HF's raw-400 handshake behavior (server works via proper ws client; documented as environment quirk).
