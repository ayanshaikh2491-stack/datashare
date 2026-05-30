# 🚢 DATASHARE — Handoff File

> **Last Updated:** 2026-05-29
> **Status:** PLANNING → Ready for Development
> **Memory:** YE FILE KAAM KAREGI — Jo ho gaya, jo karna hai, sab yahan hai!

---

## 📋 PROJECT VISION

**Problem:** Logon ka daily mobile data (2GB) khatam ho jaata hai. Unhe kaam karna hai (Instagram, YouTube, AI/agency work, browsing) par data nahi hai.

**Solution:** Jiske paas UNLIMITED data hai (Donor), woh apna data share kare unke saath jinko data chahiye (Receiver). Open source, free, community-driven.

**Key Concept:** "Data Bank" — Jiske paas hai woh de, jisko chahiye woh le. Paise nahi, community hai.

---

## 🏗️ FINAL ARCHITECTURE (DECIDED)

```
┌─────────────────────────────────────────────────────┐
│           MESH NETWORK (Tailscale/Headscale)        │
│  Handles: NAT Traversal, Encryption, P2P Tunnel     │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
    ┌──────────▼──────┐    ┌──────────▼──────────┐
    │  DONOR (Anywhere)│   │ RECEIVER (Anywhere) │
    │  📱 Unlimited 5G │   │ 📱 Data Khatam      │
    │  📱 DataShare App│   │ 📱 DataShare App    │
    └─────────────────┘    └─────────────────────┘
               │                      │
               └──────────┬───────────┘
                          │
               ┌──────────▼───────────┐
               │   SUPABASE (FREE)    │
               │  • User Database     │
               │  • Matching Engine   │
               │  • Usage Tracking    │
               │  • Limits Enforcement│
               │  • Connection Logs   │
               └──────────────────────┘
```

---

## 🎯 KEY DECISIONS (JO FINAL HUI):

| Decision | Final Choice | Reason |
|----------|-------------|--------|
| **Mesh Network** | Tailscale (primary) + Headscale (fallback) | Easy setup + Open source backup |
| **Database** | Supabase Free Tier | ₹0 cost, PostgreSQL, realtime |
| **Backend** | Node.js + Express + WebSocket | Real-time matching + monitoring |
| **Mobile App** | Flutter | Android + iOS, single codebase |
| **VPN Protocol** | WireGuard (via Tailscale) | Fast, secure, built-in |
| **NAT Traversal** | Tailscale DERP / Headscale relay | CGNAT pe kaam karta hai |
| **Cost** | ₹0/month (Oracle Free Tier + Supabase Free) | 100% free |
| **License** | MIT (Open Source) | Koi bhi use/modify kar sakta hai |
| **Location** | Koi restriction nahi | Delhi ↔ Mumbai bhi kaam karega |

---

## 🔒 SECURITY & LIMITS SYSTEM (DESIGNED)

### Donor Controls:
- Per User Data Limit (default: 500 MB)
- Max Concurrent Users (default: 3)
- Time Limit Per Session (default: 60 min)
- Daily Total Limit (default: 5 GB)
- Emergency Stop Button
- Manual Disconnect Any User
- Blocklist

### Receiver Global Limits:
- Max 5 donors per day
- Max 2GB total data per day
- 10 min cooldown between connections
- Only 1 active connection at a time

### Protection Layers:
1. **Layer 1:** Donor Control (user-set limits)
2. **Layer 2:** Server Enforcement (VPS auto-enforces)
3. **Layer 3:** Receiver Limits (global rules)
4. **Layer 4:** Abuse Detection (pattern monitoring)
5. **Layer 5:** Emergency Controls (one-tap stop)

---

## 📱 APP FLOW (STEP BY STEP)

### DONOR FLOW:
1. App install → Phone number login (OTP)
2. "Donor Mode" select
3. Settings configure (limits, max users, time)
4. "Go Online" button → VPS ko inform
5. WireGuard/Tailscale server start (background)
6. Phone charge pe rakh
7. Jab receiver connect kare → notification aaye
8. Accept/Reject kar sakta hai
9. Real-time monitoring (data used, time, users)
10. Kisi ko bhi disconnect kar sakta hai
11. "Go Offline" jab chahe

### RECEIVER FLOW:
1. App install → Phone number login (OTP)
2. "Receiver Mode" select
3. "Need Data" button → VPS ko request
4. VPS matching karta hai → available donors dikhta hai
5. Donor choose karta hai (or auto-match)
6. Donor accept kare → VPN config auto-apply
7. Connection established → Internet ACTIVE
8. Sab apps chalega (Instagram, YouTube, browser, PC)
9. Limit cross → Auto disconnect
10. 10 min cooldown → Naya donor dhundh → Repeat

---

## 🗄️ SUPABASE DATABASE SCHEMA (DESIGNED)

```sql
-- users
id, phone, name, role (donor/receiver/both), created_at, is_active

-- donors
id, user_id, location (lat/lng), max_receivers, current_receivers, 
wireguard_public_key, wireguard_endpoint, status (online/offline/busy), 
last_seen, settings (JSON: limits, time, daily_total)

-- receivers
id, user_id, location, data_needed_mb, status (waiting/connected/disconnected)

-- connections
id, donor_id, receiver_id, started_at, ended_at, data_used_mb, 
status (active/completed/rejected), disconnect_reason

-- usage_logs
id, connection_id, receiver_id, timestamp, data_mb, activity_type

-- blocklist
id, donor_id, receiver_id, reason, blocked_at
```

---

## 🔧 VPS SERVER API ENDPOINTS (PLANNED)

```
POST /api/donor/register     — Donor registration
POST /api/donor/go-online    — Donor goes online
POST /api/donor/go-offline   — Donor goes offline
POST /api/donor/accept       — Donor accepts receiver
POST /api/donor/reject       — Donor rejects receiver
POST /api/donor/disconnect   — Donor disconnects a user
POST /api/donor/settings     — Update donor limits

POST /api/receiver/request   — Receiver needs data
POST /api/receiver/connect   — Receiver connects to donor
POST /api/receiver/disconnect — Receiver disconnects
GET  /api/receiver/available-donors — List available donors

POST /api/usage/report       — Report data usage
GET  /api/monitoring/stats   — Real-time stats

WebSocket /ws               — Real-time notifications
```

---

## 📂 PROJECT STRUCTURE

```
datashare/
├── 📄 HANDOFF.md            ← YE FILE (memory/sab kuch yahan)
├── 📄 README.md             ← Project intro
│
├── server/                  ← VPS Backend
│   ├── config/              ← Environment config
│   └── src/
│       ├── routes/          ← API endpoints
│       ├── middleware/      ← Auth, validation
│       ├── services/        ← Business logic
│       └── utils/           ← Helpers
│
├── mobile/                  ← Flutter App
│   ├── lib/
│   │   ├── models/          ← Data models
│   │   ├── services/        ← API, Tailscale, Supabase
│   │   ├── providers/       ← State management
│   │   └── ui/
│   │       ├── screens/     ← App screens
│   │       └── widgets/     ← Reusable components
│   ├── android/
│   └── ios/
│
├── docs/                    ← Documentation
└── supabase/                ← DB migrations, SQL
```

---

## ⚠️ PROBLEMS SOLVED:

| Problem | Solution |
|---------|----------|
| Donor/Receiver alag city mein | ✅ VPN over internet — distance matter nahi |
| NAT/CGNAT issue | ✅ Tailscale/Headscale handles automatically |
| Donor ka phone screen lock | ✅ Foreground Service + Wake Lock |
| Battery drain | ✅ Charger pe rakh + optimize |
| Receiver data 0 bytes | ❌ Minimum 10-50MB chahiye (connection ke liye) |
| Koi bhi abuse kare | ✅ Multi-layer limits + auto-disconnect |
| Donor ka control nahi | ✅ Full control panel + emergency stop |
| Security/virus risk | ✅ VPN tunnel, no machine access |
| Tailscale paid ho jaaye | ✅ Headscale fallback ready |
| Koi cost nahi chahiye | ✅ Oracle Free + Supabase Free = ₹0 |

---

## ⏳ PENDING / KARNA HAI:

### Phase 1: Server (Backend)
- [ ] Setup Node.js + Express server
- [ ] Supabase connection + DB schema
- [ ] Donor/Receiver API endpoints
- [ ] WebSocket for real-time notifications
- [ ] Matching algorithm
- [ ] Usage monitoring service
- [ ] Limit enforcement logic
- [ ] Authentication (OTP via Firebase/Supabase)

### Phase 2: Mesh Network
- [ ] Tailscale integration code
- [ ] Headscale fallback adapter
- [ ] Nebula adapter (optional)
- [ ] Mesh provider abstraction layer
- [ ] Auto-connection setup

### Phase 3: Mobile App (Flutter)
- [ ] Flutter project setup
- [ ] Auth screens (login, OTP)
- [ ] Donor mode UI + settings
- [ ] Receiver mode UI + donor list
- [ ] Connection status screen
- [ ] Real-time monitoring dashboard
- [ ] Settings screen
- [ ] Tailscale integration (mobile)
- [ ] Foreground service (Android)
- [ ] Notifications

### Phase 4: Documentation
- [ ] README (Hindi + English)
- [ ] Setup guide
- [ ] Contributing guide
- [ ] API documentation

### Phase 5: Deployment
- [ ] Oracle Free Tier VPS setup
- [ ] Supabase project setup
- [ ] Tailscale/Headscale config
- [ ] CI/CD pipeline
- [ ] GitHub repo public

---

## 🔑 TECH STACK

| Component | Technology | Cost |
|-----------|-----------|------|
| Backend | Node.js + Express + WebSocket | Free |
| Database | Supabase (PostgreSQL) | Free |
| Mesh Network | Tailscale → Headscale fallback | Free |
| Mobile App | Flutter (Android + iOS) | Free |
| Auth | Supabase Auth (OTP) | Free |
| Hosting | Oracle Cloud Free Tier | Free |
| CI/CD | GitHub Actions | Free |
| Domain | free subdomain | Free |

---

## 💡 IMPORTANT NOTES (BHULNA NAHI):

1. **Receiver ko minimum 10-50MB chahiye** — bina kisi connection ke connect nahi ho sakta
2. **Donor ka phone charger pe hona chahiye** — battery drain se bachne ke liye
3. **Tailscale 20 devices free** — shuru mein kaafi hai
4. **Headscale fallback ready rakhna** — config file mein switch ho sake
5. **Multi-layer security** — donor ka data safe rahe
6. **Open source (MIT)** — koi bhi contribute kar sakta hai
7. **No cost** — sab free services use karni hain
8. **Any distance works** — Delhi se Mumbai bhi kaam karega
9. **All apps work** — Instagram, YouTube, browser, PC — sab
10. **Community-driven** — paise kamane nahi, logon ki madad karni hai

---

## 📞 CONTEXT (Kaise Shuru Hua):

> User ne poocha: "Tower se mobile tak data kaise aata hai, count kaise hota hai?"
> → Phir poocha: "Kya unlimited data ko store kar sakte hain?"
> → Phir: "Ghar pe 4G (2GB), bahar 5G unlimited — ghar pe kaise laayein?"
> → Phir: "Koi open source solution chahiye — free, community-driven"
> → Phir: "Donor aur receiver alag state mein ho toh?"
> → Phir: "Laptop nahi hai sab ke paas, phone se kaise?"
> → Phir: "Security ka kya? Hacker aa jaaye toh?"
> → Phir: "Donor ka control kaise hoga? Koi abuse na kare"
> → Phir: "VPS + Supabase + Tailscale architecture final hua"
> → Phir: "Tailscale free rahega? Headscale/Nebula fallback?"
> → FINALLY: **Ye project structure + handoff file bana!**

---

**YE HANDOFF FILE = HAMARI MEMORY! Jab bhi kaam continue karein, YE FILE PADH LO — sab yaad aa jaayega!** 🧠

---

**Next Step:** Bata kaunsa phase start karein? Server? Mobile App? Ya pehle README? 🚀
