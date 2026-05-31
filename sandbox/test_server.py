#!/usr/bin/env python3
"""
test_server.py — Server health check & WebSocket connectivity test
Tests that the DataShare server is running and WebSocket endpoints work.
"""

import json
import sys
import time
import urllib.request
import urllib.error

SERVER_URL = "http://localhost:3000"
WS_URL = "ws://localhost:3000/ws-vpn"
PASS = 0
FAIL = 0

def log_test(name, status, detail=""):
    global PASS, FAIL
    mark = "✅" if status else "❌"
    if status:
        PASS += 1
    else:
        FAIL += 1
    print(f"  {mark} {name}" + (f" — {detail}" if detail else ""))

def test_health():
    print("\n📡 Server Health Check")
    try:
        resp = urllib.request.urlopen(f"{SERVER_URL}/api/health", timeout=5)
        data = json.loads(resp.read())
        log_test("Health endpoint", data.get("status") == "ok",
                 f"v{data.get('version', '?')}, uptime={data.get('uptime', 0):.1f}s")
        if "vpnTunnel" in data:
            vt = data["vpnTunnel"]
            log_test("VPN Tunnel WebSocket", True,
                     f"sessions={vt['sessions']}, donors={vt['donors']}, receivers={vt['receivers']}")
        return data
    except Exception as e:
        log_test("Health endpoint", False, str(e))
        return None

def test_ws_connect():
    print("\n🔌 WebSocket Connection Test")
    try:
        import asyncio
        import websockets

        async def test():
            async with websockets.connect(f"{WS_URL}?userId=test_donor_1&mode=donor") as ws:
                # Send handshake
                await ws.send(json.dumps({
                    "type": "vpn_connect", "mode": "donor", "userId": "test_donor_1"
                }))
                resp = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(resp)
                log_test("Donor connect", data.get("type") == "vpn_connected",
                         f"got {data.get('type', 'unknown')}")
                await ws.close()
                return True

        asyncio.run(test())
        return True
    except ImportError:
        log_test("WebSocket connect", False, "websockets module not installed")
        return False
    except Exception as e:
        log_test("WebSocket connect", False, str(e))
        return False

def main():
    print("=" * 55)
    print("🧪 DataShare Server Health Test")
    print("=" * 55)

    test_health()
    test_ws_connect()

    print(f"\n{'='*55}")
    print(f"📊 Results: {PASS} passed, {FAIL} failed")
    print(f"{'='*55}")

    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
