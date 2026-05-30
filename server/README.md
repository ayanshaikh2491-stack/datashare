# 🚀 DataShare Server - Backend

> **Node.js + Express + WebSocket** backend for DataShare — community-driven data sharing platform powered by **Headscale** (open-source Tailscale alternative).

---

## 📁 Project Structure

```
server/
├── config/
│   ├── env.js              # Configuration loader
│   └── .env.example        # Environment template
├── src/
│   ├── index.js            # Main entry point (Express + WebSocket)
│   ├── routes/
│   │   ├── auth.routes.js      # Auth: register, login, profile
│   │   ├── donor.routes.js     # Donor: online/offline, accept/reject, settings
│   │   ├── receiver.routes.js  # Receiver: request, connect, auto-match
│   │   └── usage.routes.js     # Usage: report data, monitoring, stats
│   ├── middleware/
│   │   ├── auth.middleware.js      # JWT authentication
│   │   └── validation.middleware.js # Request validation
│   ├── services/
│   │   ├── supabase.service.js     # Supabase database client
│   │   ├── headscale.service.js    # Headscale mesh network integration
│   │   ├── matching.service.js     # Donor-receiver matching algorithm
│   │   └── websocket.service.js    # Real-time WebSocket server
│   └── utils/
│       └── logger.js           # Winston logger
├── package.json
├── .gitignore
└── logs/                   # Auto-created log files
```

---

## 🛠️ Setup Instructions

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure Environment
```bash
cp config/.env.example config/.env
# Edit config/.env with your credentials
```

### 3. Setup Supabase Database
- Create a project at [supabase.com](https://supabase.com)
- Run the SQL migration: `supabase/schema.sql`
- Copy your `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to `.env`

### 4. Setup Headscale (Optional but Recommended)
```bash
# Install Headscale
# See: https://github.com/juanfont/headscale

# Start Headscale
headscale serve

# Get API key
headscale apikeys create

# Copy API key to HEADSCALE_API_KEY in .env
```

### 5. Start Server
```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3000`

---

## 🔑 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register with phone number |
| POST | `/api/auth/login` | Login with phone number |
| GET | `/api/auth/me` | Get current user profile |

### Donor
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/donor/register` | Register as donor |
| POST | `/api/donor/go-online` | Go online (start sharing) |
| POST | `/api/donor/go-offline` | Go offline |
| POST | `/api/donor/accept` | Accept a receiver |
| POST | `/api/donor/reject` | Reject a receiver |
| POST | `/api/donor/disconnect` | Disconnect a specific receiver |
| POST | `/api/donor/settings` | Update donor limits |
| GET | `/api/donor/status` | Get donor status |
| POST | `/api/donor/block` | Block a receiver |

### Receiver
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/receiver/register` | Register as receiver |
| POST | `/api/receiver/request` | Request data (find donors) |
| POST | `/api/receiver/connect` | Connect to specific donor |
| POST | `/api/receiver/auto-connect` | Auto-connect to best donor |
| POST | `/api/receiver/disconnect` | Disconnect from donor |
| GET | `/api/receiver/available-donors` | List available donors |
| GET | `/api/receiver/status` | Get receiver status |

### Usage & Monitoring
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/usage/report` | Report data usage |
| GET | `/api/monitoring/stats` | Real-time server stats |
| GET | `/api/monitoring/connection/:id` | Connection details |
| GET | `/api/monitoring/donor-history` | Donor's connection history |
| GET | `/api/health` | Health check |

### WebSocket
- **URL:** `ws://localhost:3000?userId=XXX&role=donor|receiver`
- Real-time notifications for connections, disconnections, usage updates

---

## 🗄️ Database (Supabase)

Tables created by `supabase/schema.sql`:

| Table | Purpose |
|-------|---------|
| `users` | User accounts (phone, name, role) |
| `donors` | Donor profiles, settings, status |
| `receivers` | Receiver profiles, status |
| `connections` | Active/completed connections |
| `usage_logs` | Per-connection data usage tracking |
| `blocklist` | Donor → Receiver blocks |

---

## 🌐 Headscale Integration

Headscale replaces Tailscale for 100% free, unlimited mesh networking:

```
┌──────────────┐         ┌──────────────┐
│   Donor      │◄───────►│  Headscale   │
│ (Mobile App) │         │  (VPS)       │
└──────────────┘         └──────┬───────┘
                                │
┌──────────────┐         ┌──────▼───────┐
│  Receiver    │◄───────►│  Headscale   │
│ (Mobile App) │         │  (VPS)       │
└──────────────┘         └──────────────┘
```

**Key Features:**
- Open source (MIT license)
- Unlimited devices (no 20-device limit like Tailscale)
- WireGuard protocol built-in
- NAT traversal via DERP relays
- Self-hosted on Oracle Free Tier VPS

---

## 🔒 Security

- **JWT Authentication** — All API routes protected
- **Row Level Security** — Supabase RLS policies
- **Rate Limiting** — 100 requests per 15 minutes
- **Helmet** — Security headers
- **CORS** — Cross-origin protection
- **Input Validation** — express-validator on all routes

---

## 📊 Monitoring

- **Winston Logging** — Console + file logs
- **WebSocket Real-time** — Live connection tracking
- **Health Endpoint** — `/api/health` shows service status
- **Stats Endpoint** — `/api/monitoring/stats` for real-time metrics

---

## 🚀 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | ✅ |
| `HEADSCALE_URL` | Headscale server URL | No* |
| `HEADSCALE_API_KEY` | Headscale API key | No* |
| `HEADSCALE_NAMESPACE` | Headscale namespace (default: datashare) | No |
| `JWT_SECRET` | JWT signing secret | ✅ |
| `JWT_EXPIRY` | Token expiry (default: 7d) | No |

*\*Optional — server works without Headscale but mesh features will be limited*

---

## 📝 License

MIT — Open Source, Community Driven 🤝
