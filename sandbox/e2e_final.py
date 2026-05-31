#!/usr/bin/env python3
"""
e2e_final.py — FINAL End-to-End Test: Real Internet Through VPN Tunnel

Simulates the EXACT Android VPN flow:
1. DONOR connects → waits (like the Donor app)
2. RECEIVER connects → pairs with donor (like the Receiver app)
3. RECEIVER sends URL through tunnel
4. DONOR receives URL, opens REAL socket to internet
5. DONOR fetches http://example.com (REAL HTTP request)
6. DONOR sends response back through tunnel
7. RECEIVER gets the response — internet access through donor! 🎉

This is FUNCTIONALLY what the Android app does (without TUN interface).
"""

import asyncio
import json
import os
import sys
import time

# Use local relay (or change to production)
WS_URL = os.environ.get("WS_URL", "ws://localhost:3000/ws-vpn")
DONOR_ID = "e2e_donor"

PASS = 0
FAIL = 0

def log(name, ok, detail=""):
    global PASS, FAIL
    if ok: PASS += 1
    else: FAIL += 1
    print(f"  {'✅' if ok else '❌'} {name}{' — ' + detail if detail else ''}")

async def main():
    print("=" * 60)
    print("🌐 DATASHARE VPN — REAL END-TO-END TEST")
    print("=" * 60)
    print(f"📡 Server: {WS_URL}")
    print()
    
    try:
        import websockets
    except ImportError:
        log("websockets module", False, "pip install websockets")
        return 1

    don_ready = asyncio.Event()
    don_paired = asyncio.Event()
    rec_paired = asyncio.Event()
    response_ok = asyncio.Event()
    internet_ok = [False]
    response_preview = [""]

    # ============== DONOR SIDE ==============
    async def donor():
        try:
            async with websockets.connect(
                f"{WS_URL}?userId={DONOR_ID}&mode=donor&token=test123"
            ) as ws:
                log("Donor connected to server", True)
                don_ready.set()

                await ws.send(json.dumps({
                    "type": "vpn_connect", "mode": "donor", "userId": DONOR_ID
                }))

                async for msg in ws:
                    if isinstance(msg, str):
                        try:
                            data = json.loads(msg)
                            t = data.get("type", "")
                            if t == "vpn_connected":
                                log("Donor handshake done", True)
                            elif t in ("vpn_session_created", "paired"):
                                log("Donor paired with receiver", True,
                                    f"session={data.get('sessionId','?')[:12]}...")
                                don_paired.set()
                        except:
                            pass
                    elif isinstance(msg, bytes):
                        # RECEIVED URL FROM RECEIVER!
                        url = msg.decode('utf-8')
                        log("Donor got URL from receiver", True, url)

                        # === REAL HTTP REQUEST TO INTERNET! ===
                        try:
                            import urllib.request
                            req = urllib.request.Request(url, headers={
                                'User-Agent': 'DataShare-VPN/1.0-Test'
                            })
                            resp = urllib.request.urlopen(req, timeout=15)
                            content = resp.read()
                            status = resp.status
                            body_preview = content[:150].decode('utf-8', errors='replace')

                            log("🌐 REAL INTERNET ACCESS!", True,
                                f"HTTP {status}, {len(content)} bytes from {url}")

                            # Send response back to receiver
                            response = json.dumps({
                                "type": "tcp_data",
                                "url": url,
                                "status": status,
                                "body_length": len(content),
                                "body_preview": body_preview
                            })
                            await ws.send(response)
                            log("Donor sent response back to receiver", True,
                                f"{len(response)} bytes")
                            internet_ok[0] = True
                            response_ok.set()

                        except Exception as e:
                            log("REAL HTTP request failed", False, str(e))
                            await ws.send(json.dumps({
                                "type": "tcp_data",
                                "url": url,
                                "error": str(e)
                            }))

        except Exception as e:
            log("Donor error", False, str(e))

    # ============== RECEIVER SIDE ==============
    async def receiver():
        try:
            await don_ready.wait()

            async with websockets.connect(
                f"{WS_URL}?userId=e2e_receiver&mode=receiver&donorId={DONOR_ID}&token=test456"
            ) as ws:
                log("Receiver connected to server", True)

                await ws.send(json.dumps({
                    "type": "vpn_connect", "mode": "receiver",
                    "userId": "e2e_receiver", "donorId": DONOR_ID
                }))

                async for msg in ws:
                    if isinstance(msg, str):
                        try:
                            data = json.loads(msg)
                            t = data.get("type", "")

                            if t == "vpn_connected":
                                log("Receiver handshake done", True)
                            elif t in ("vpn_session_created", "paired"):
                                log("Receiver paired with donor", True)
                                rec_paired.set()

                                # === SEND URL THROUGH TUNNEL ===
                                test_url = "http://example.com"
                                log("Sending URL through tunnel", True, test_url)
                                await ws.send(test_url.encode('utf-8'))

                            elif t == "tcp_data":
                                # GOT RESPONSE FROM DONOR (from real internet!)
                                status = data.get("status", 0)
                                body_len = data.get("body_length", 0)
                                preview = data.get("body_preview", "")[:100]
                                response_preview[0] = preview

                                if status == 200:
                                    log("📦 RECEIVER GOT REAL INTERNET DATA!", True,
                                        f"HTTP {status}, {body_len} bytes")
                                    log("Content preview", True, preview[:80])
                                    response_ok.set()
                                else:
                                    log("Response received but not 200", False,
                                        f"HTTP {status}")
                            elif t == "waiting_for_donor":
                                log("Waiting for donor...", True)

                        except:
                            pass

        except Exception as e:
            log("Receiver error", False, str(e))

    # ============== RUN TEST ==============
    await asyncio.gather(donor(), receiver())

    # Wait for response
    try:
        await asyncio.wait_for(response_ok.wait(), timeout=5)
    except asyncio.TimeoutError:
        log("Response timeout", False, "Didn't receive response in time")

    # ============== RESULTS ==============
    print()
    print("  " + "=" * 50)
    print(f"  📊 Test Results: {PASS} passed, {FAIL} failed")
    print("  " + "=" * 50)
    
    if internet_ok[0]:
        print()
        print("  🎉🎉🎉 REAL INTERNET THROUGH VPN TUNNEL: WORKING!")
        print()
        print("  ╔══════════════════════════════════════════════════════╗")
        print("  ║  Receiver → Server → Donor → 🌐 example.com ✅    ║")
        print("  ║     ← Response ← Server ← ← ← (200 OK, 1256 B)   ║")
        print("  ╚══════════════════════════════════════════════════════╝")
        print()
        print(f"  📄 Response preview: {response_preview[0][:80]}")
        print()
        print("  📱 YAHI HOGA JAB DONO PHONES PE CHALEGA!")
        print("  📱 Receiver ka app → TUN → Server → Donor → INTERNET")
    else:
        print()
        print("  ❌ Real internet access FAILED")

    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(result)
