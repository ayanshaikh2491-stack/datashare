# 🧪 DataShare VPN Test Sandbox

Test environment for the DataShare VPN tunnel system.

## Structure

```
sandbox/
├── README.md           ← This file
├── test_vpn_flow.py    ← Main test: donor ↔ server ↔ receiver data flow
├── test_server.py      ← Server health check & connectivity test
├── test_binary_protocol.py ← Binary WebSocket protocol test
├── test_stress.py      ← Stress test with simulated traffic
├── requirements.txt    ← Python deps
└── output/             ← Test results
```

## How to Run

```bash
# 1. Start server (in separate terminal)
cd server && npm start

# 2. Run tests
cd sandbox && python test_server.py
cd sandbox && python test_vpn_flow.py
```

## Test Flow

1. Server health check ✅
2. Donor connects via WebSocket ✅
3. Receiver connects via WebSocket ✅
4. Server pairs donor + receiver ✅
5. Donor sends test data through tunnel ✅
6. Receiver receives test data ✅
7. Data integrity check ✅
8. Binary protocol verification ✅
9. Performance metrics ✅
