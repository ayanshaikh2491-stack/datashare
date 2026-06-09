# DataShare Mobile Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all mobile issues so donor and receiver can connect and share internet end-to-end without crashes or errors.

**Architecture:** The web frontend (`web/index.html`) connects to Express server via WebSocket (`/ws`) for signaling, then uses WebRTC for data. The native Android VPN app (`native-android/`) connects to `/ws-vpn` for binary relay. Both paths share the same server. Critical bugs found: (1) web auth endpoints mismatch, (2) native Android WS token is not a JWT, (3) web `index.html` uses localStorage token but WS needs cookie auth.

**Tech Stack:** Node.js/Express, WebSocket, WebRTC, Kotlin (Android), Supabase

---

## File Map

| File | Change | Why |
|------|--------|-----|
| `server/src/routes/auth.routes.js` | Add `/login` and `/register` as aliases | Web frontend calls `/api/auth/login` and `/api/auth/register` — these routes don't exist (404) |
| `web/index.html` | Pass token as query param on WS URL + fix loader timing | WebSocket upgrade needs `?token=` as cookie fallback; loader hides too early |
| `native-android/app/src/main/java/com/datashare/NetworkManager.kt` | Auth via REST API to get real JWT before WS connect | Server WS upgrade requires valid JWT; fake token → 401 → instant disconnect |
| `native-android/app/src/main/java/com/datashare/VpnStateManager.kt` | Add `token` field | Store the JWT from auth for WS use |
| `server/src/services/vpn-tunnel.service.js` | Verify `parseCookie` helper exists | Needed for cookie-based token parsing on WS upgrade |

---

### Task 1: Fix auth route mismatch — `/api/auth/login` and `/api/auth/register` return 404

**Files:**
- Modify: `server/src/routes/auth.routes.js:124` (add routes before `module.exports`)

- [ ] **Step 1: Add login and register aliases**

The web frontend's `doLogin()` calls `api('/auth/login', ...)` and `doReg()` calls `api('/auth/register', ...)`. But the server only has `/login-or-register`. Both return 404.

Add these routes BEFORE `module.exports = router;` at line 124:

```javascript
// Alias: /login for backward compatibility with web frontend
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const { getSupabase } = require('../services/supabase.service');
    const { generateToken } = require('../middleware/auth.middleware');
    const logger = require('../utils/logger');

    let { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', email)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please register first.' });
    }

    const token = generateToken(user);
    setAuthCookie(res, token);
    logger.info(`User logged in: ${email}`);
    res.json({ message: 'Login successful', token, user });
  } catch (err) {
    logger.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Alias: /register for backward compatibility with web frontend
router.post('/register', async (req, res) => {
  try {
    const { email, name, role = 'both' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const { getSupabase } = require('../services/supabase.service');
    const { generateToken } = require('../middleware/auth.middleware');
    const logger = require('../utils/logger');

    let { data: user, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone', email)
      .maybeSingle();

    if (error) throw error;
    let isNew = false;

    if (!user) {
      if (!name) return res.status(400).json({ error: 'Name required to register' });
      const insert = await getSupabase()
        .from('users')
        .insert([{ phone: email, name, role, is_active: true }])
        .select()
        .single();
      if (insert.error) throw insert.error;
      user = insert.data;
      isNew = true;

      if (role === 'donor' || role === 'both') {
        await getSupabase().from('donors').insert([{
          user_id: user.id,
          status: 'offline',
          max_receivers: 3,
          settings: { data_limit_mb: 500, time_limit_min: 60, daily_total_gb: 5 }
        }]);
      }
      if (role === 'receiver' || role === 'both') {
        await getSupabase().from('receivers').insert([{
          user_id: user.id,
          status: 'disconnected',
          data_needed_mb: 0
        }]);
      }
    }

    const token = generateToken(user);
    setAuthCookie(res, token);
    logger.info(`User ${isNew ? 'registered' : 'already exists'}: ${email}`);
    res.status(isNew ? 201 : 200).json({ message: isNew ? 'User registered' : 'User already exists', token, user, isNew });
  } catch (err) {
    logger.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});
```

- [ ] **Step 2: Verify syntax**

Run: `cd server && node -e "require('./src/routes/auth.routes.js'); console.log('OK')"`
Expected: `OK` printed to console (Supabase warnings are fine)

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/auth.routes.js
git commit -m "fix: add /login and /register routes — web frontend was hitting 404"
```

---

### Task 2: Fix WebSocket auth — web clients need `?token=` query fallback

**Files:**
- Modify: `web/index.html:224` (the `connectWS` function)

- [ ] **Step 1: Update `connectWS()` to pass token in URL**

Current line 224:
```javascript
ws=new WebSocket('wss://datashare-server.onrender.com/ws?role='+myRole);
```

The server reads the token from either the `ds_token` cookie or `?token=` query param. The web client stores the JWT in `localStorage` — it may not be available as a cookie for the WS upgrade.

Replace line 224 with:
```javascript
var wsUrl='wss://datashare-server.onrender.com/ws?role='+myRole;
if(token)wsUrl+='&token='+encodeURIComponent(token);
ws=new WebSocket(wsUrl);
```

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "fix: pass JWT token in WS URL for web clients — cookie may not be available for upgrade"
```

---

### Task 3: Fix loader — hides before page is ready, looks like "app exited"

**Files:**
- Modify: `web/index.html:195` (loader timeout)
- Modify: `web/index.html:463` (enterApp function)
- Modify: `web/index.html:225` (ws.onopen handler)

- [ ] **Step 1: Remove premature loader hiding**

Delete line 195:
```javascript
setTimeout(function(){document.getElementById('loader').classList.add('hidden')},2800);
```

Replace with:
```javascript
// Loader stays visible until WS connects or enterApp() runs
// Safety timeout: show status message after 15s if still loading
setTimeout(function(){
  var loader=document.getElementById('loader');
  if(loader&&!loader.classList.contains('hidden')){
    loader.innerHTML='<div class="ld"><div class="spin"></div><p>Still loading... Server may be starting up. Please wait.</p></div>';
  }
},15000);
```

- [ ] **Step 2: Hide loader when `enterApp()` runs**

In `enterApp()` (around line 463), add at the start of the function (after `showScr('appS');`):
```javascript
var loader=document.getElementById('loader');if(loader)loader.classList.add('hidden');
```

- [ ] **Step 3: Hide loader when WS connects**

In `connectWS()`, the `ws.onopen` handler (line 225), add at the start of the handler:
```javascript
var loader=document.getElementById('loader');if(loader)loader.classList.add('hidden');
```

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "fix: loader stays visible until WS connects — no more blank screen on cold start"
```

---

### Task 4: Fix native Android WebSocket — must authenticate to get real JWT

**Files:**
- Create/modify: `native-android/app/src/main/java/com/datashare/VpnStateManager.kt` (add `token` field)
- Create/modify: `native-android/app/src/main/java/com/datashare/NetworkManager.kt` (add auth flow)

- [ ] **Step 1: Add `token` field to `VpnStateManager.kt`**

After line 29 (`@Volatile var receiverId: String = ""`), add:
```kotlin
@Volatile var token: String = ""
```

- [ ] **Step 2: Add imports to `NetworkManager.kt`**

Add after line 7 (`import java.util.concurrent.atomic.AtomicInteger`):
```kotlin
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.RequestBody
import java.io.IOException
```

- [ ] **Step 3: Update `doConnect()` in `NetworkManager.kt`**

Replace the `doConnect()` function (lines 74-130) with:

```kotlin
private fun doConnect() {
    // Ensure we have a JWT token before connecting
    val currentToken = if (token.isNotEmpty()) token else VpnStateManager.token
    if (currentToken.isEmpty()) {
        Log.w(TAG, "No JWT token — authenticating first")
        authenticateAndConnect()
        return
    }

    try {
        okHttpClient = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(PING_INTERVAL_SEC, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        val url = "${VpnStateManager.SERVER_URL}?userId=$userId&mode=$mode&donorId=$donorId&token=$currentToken"

        val request = Request.Builder()
            .url(url)
            .build()

        webSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket connected: $mode")
                reconnectAttempts = 0
                VpnStateManager.updateState(VpnStateManager.STATE_CONNECTED)
                listener.onConnected(userId)

                val hs = JSONObject().apply {
                    put("type", "vpn_connect")
                    put("mode", mode)
                    put("userId", userId)
                    if (mode == VpnStateManager.MODE_RECEIVER && donorId.isNotEmpty()) {
                        put("donorId", donorId)
                    }
                }
                ws.send(hs.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) = handleTextMessage(text)
            override fun onMessage(ws: WebSocket, bytes: ByteString) = handleBinaryFrame(bytes.toByteArray())

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WS closed: $code $reason")
                VpnStateManager.updateState(VpnStateManager.STATE_DISCONNECTED)
                listener.onDisconnected()
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: ${t.message}")
                if (response?.code == 401) {
                    Log.w(TAG, "401 — re-authenticating")
                    authenticateAndConnect()
                    return
                }
                VpnStateManager.updateState(VpnStateManager.STATE_ERROR)
                listener.onError(t.message ?: "Connection failed")
                scheduleReconnect()
            }
        })
    } catch (e: Exception) {
        Log.e(TAG, "Connect error: ${e.message}")
        listener.onError(e.message ?: "Connection failed")
        scheduleReconnect()
    }
}
```

- [ ] **Step 4: Add `authenticateAndConnect()` function**

Add after the `disconnect()` function (around line 243, before the binary frame parser section):

```kotlin
/**
 * Authenticate via REST API to get a JWT, then connect WebSocket.
 * The server's WS upgrade requires a valid JWT signed with JWT_SECRET,
 * which the app doesn't have — so we get the token from the auth API.
 */
private fun authenticateAndConnect() {
    shouldReconnect = true
    VpnStateManager.updateState(VpnStateManager.STATE_CONNECTING)

    val baseUrl = VpnStateManager.SERVER_URL
        .replace("wss://", "https://")
        .replace("/ws-vpn", "")

    val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    val json = JSONObject().apply {
        put("email", "$userId@datashare.local")
        put("name", "User ${userId.take(8)}")
        put("role", if (mode == VpnStateManager.MODE_DONOR) "donor" else "receiver")
    }

    val body = RequestBody.create(MediaType.parse("application/json"), json.toString())
    val request = Request.Builder()
        .url("$baseUrl/api/auth/login-or-register")
        .post(body)
        .build()

    client.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            Log.e(TAG, "Auth request failed: ${e.message}")
            listener.onError("Authentication failed: ${e.message}")
            scheduleReconnect()
        }

        override fun onResponse(call: Call, response: Response) {
            try {
                val respBody = response.body?.string() ?: ""
                val result = JSONObject(respBody)
                val authToken = result.getString("token")

                VpnStateManager.token = authToken
                token = authToken

                response.close()
                client.dispatcher().executorService().shutdownNow()

                // Now connect WebSocket with real JWT
                doConnect()
            } catch (e: Exception) {
                Log.e(TAG, "Auth response parse error: ${e.message}")
                listener.onError("Auth failed")
                scheduleReconnect()
            }
        }
    })
}
```

- [ ] **Step 5: Commit**

```bash
git add native-android/app/src/main/java/com/datashare/NetworkManager.kt native-android/app/src/main/java/com/datashare/VpnStateManager.kt
git commit -m "fix: native Android authenticates via REST API before WS — gets real JWT for upgrade"
```

---

### Task 5: Verify `parseCookie` helper exists in vpn-tunnel.service.js

**Files:**
- Verify/modify: `server/src/services/vpn-tunnel.service.js`

- [ ] **Step 1: Check if `parseCookie` is defined**

The WS upgrade at line 67 uses `parseCookie(req.headers.cookie, 'ds_token')`. Verify this function exists in the file:

```bash
grep -n "function parseCookie" server/src/services/vpn-tunnel.service.js
```

- [ ] **Step 2: Add if missing**

If not found, add before `initVpnTunnel` (around line 51):

```javascript
/** Parse a named cookie from the Cookie header */
function parseCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : null;
}
```

- [ ] **Step 3: Verify and commit**

Run: `cd server && node -e "require('./src/services/vpn-tunnel.service.js'); console.log('OK')"`

If changes were made:
```bash
git add server/src/services/vpn-tunnel.service.js
git commit -m "fix: add parseCookie helper for WS upgrade token parsing"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Load all server routes without errors**

```bash
cd server && node -e "
require('./src/routes/auth.routes');
require('./src/routes/donor.routes');
require('./src/routes/receiver.routes');
console.log('All routes loaded OK');
"
```

Expected: `All routes loaded OK` (Supabase connection warnings are fine)

- [ ] **Step 2: Final commit**

```bash
git status
git add -A
git commit -m "chore: DataShare mobile fix — all auth, WS, and loader issues resolved"
```

---

## Summary

| Task | Root Cause | Fix |
|------|-----------|-----|
| 1 | `/api/auth/login` → 404 (no route) | Add login/register aliases |
| 2 | WS upgrade fails — no token in URL | Pass `?token=` from localStorage |
| 3 | Loader hides at 2.8s regardless | Hide only when WS connects |
| 4 | Android WS uses fake token → 401 | Auth via REST API → get JWT → WS |
| 5 | `parseCookie` may be missing | Add helper function |
