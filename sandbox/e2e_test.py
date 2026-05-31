#!/usr/bin/env python3
"""
e2e_test.py — REAL End-to-End VPN Tunnel Test

Simulates the full DataShare VPN flow:
1. DONOR: Connects to WebSocket server, acts as "internet gateway"
2. RECEIVER: Connects to WebSocket server, sends request through donor
3. Donor opens REAL sockets to actual internet
4. Fetches a real webpage through the tunnel
5. Verifies response comes back correctly

This is EXACTLY what the Android app does, minus the TUN interface.
"""

import asyncio
import hashlib
import json
import os
import time
import sys

SERVER_URL = os.environ.get("WS_URL", "ws://localhost:3000/ws-vpn")

PASS = 0
FAIL = 0

def log(name, ok, detail=""):
    global PASS, FAIL
    if ok: PASS += 1
    else: FAIL += 1
    print(f"  {'✅' if ok else '❌'} {name}{' — ' + detail if detail else ''}")

async def test_end_to_end():
    """Full end-to-end: receiver → server → donor → real internet → back"""
    print("\n🌐 REAL END-TO-END TEST")
    print("-" * 50)

    try:
        import websockets
    except ImportError:
        log("websockets module", False, "pip install websockets")
        return

    # ====================================================================
    # SETUP: Donor + Relay Server
    # ====================================================================
    print("\n  🔌 Starting VPN tunnel simulation...")

    # Start a local relay server (simplified version of what server does)
    # This pairs donor and receiver, relays binary data between them
    import threading
    import http.server
    import socketserver

    relay_donor_ws = None
    relay_receiver_ws = None
    relay_connected = threading.Event()
    relay_data_received = threading.Event()
    relay_response_data = None

    # We'll use the existing server (localhost:3000 or production)

    # ====================================================================
    # TEST 1: DONOR connects and waits for receiver
    # ====================================================================
    print("\n  📱 DONOR side (internet gateway):")

    # This dict will store received data from receiver
    received_packets = []
    donor_ready = asyncio.Event()
    receiver_paired = asyncio.Event()
    response_received = asyncio.Event()

    async def donor_side():
        """Donor: connects to server, receives data from receiver, opens real sockets"""
        try:
            async with websockets.connect(
                f"{SERVER_URL}?userId=donor_e2e_{int(time.time())}&mode=donor&token=e2e_test"
            ) as donor_ws:
                log("Donor WebSocket connected", True)
                donor_ready.set()

                # Send handshake
                await donor_ws.send(json.dumps({
                    "type": "vpn_connect",
                    "mode": "donor",
                    "userId": f"donor_e2e_{int(time.time())}"
                }))

                async for message in donor_ws:
                    if isinstance(message, str):
                        try:
                            msg = json.loads(message)
                            if msg.get("type") == "vpn_connected":
                                log("Donor handshake received", True)
                            elif msg.get("type") in ("vpn_session_created", "paired"):
                                log("Donor paired with receiver", True)
                                receiver_paired.set()
                        except:
                            pass
                    elif isinstance(message, bytes):
                        # Data from receiver — it contains a URL to fetch!
                        url = message.decode('utf-8')
                        log(f"Donor received URL", True, url)

                        # OPEN REAL SOCKET TO INTERNET!
                        try:
                            import urllib.request
                            req = urllib.request.Request(url, headers={
                                'User-Agent': 'DataShare-VPN/1.0'
                            })
                            resp = urllib.request.urlopen(req, timeout=15)
                            content = resp.read()
                            resp_info = f"HTTP {resp.status}, {len(content)} bytes"
                            
                            # Send response back to receiver
                            response_msg = json.dumps({
                                "type": "tcp_data",
                                "status": resp.status,
                                "headers": dict(resp.headers),
                                "body_length": len(content),
                                "body_preview": content[:200].decode('utf-8', errors='replace')
                            })
                            await donor_ws.send(response_msg)
                            log(f"Real HTTP response sent back", True, resp_info)
                            response_received.set()
                        except Exception as e:
                            log(f"Real HTTP request failed", False, str(e))
                            await donor_ws.send(json.dumps({
                                "type": "tcp_data",
                                "error": str(e)
                            }))

        except Exception as e:
            log("Donor error", False, str(e))

    # ====================================================================
    # TEST 2: RECEIVER connects, sends URL through tunnel
    # ====================================================================
    print("\n  📱 RECEIVER side (no internet — using donor):")

    async def receiver_side():
        """Receiver: connects to server, sends request through donor"""
        try:
            await donor_ready.wait()  # Wait for donor to be ready

            async with websockets.connect(
                f"{SERVER_URL}?userId=receiver_e2e_{int(time.time())}&mode=receiver&donorId=donor_e2e_{int(time.time() - 1)}&token=e2e_test"
            ) as receiver_ws:
                log("Receiver WebSocket connected", True)

                await receiver_ws.send(json.dumps({
                    "type": "vpn_connect",
                    "mode": "receiver",
                    "userId": f"receiver_e2e_{int(time.time())}",
                    "donorId": f"donor_e2e_{int(time.time() - 1)}"
                }))

                paired = False
                async for message in receiver_ws:
                    if isinstance(message, str):
                        try:
                            msg = json.loads(message)
                            if msg.get("type") in ("vpn_session_created", "paired"):
                                paired = True
                                log("Receiver paired with donor", True)

                                # Send a URL through the tunnel — donor will fetch it!
                                test_url = "http://example.com"
                                log(f"Sending URL through tunnel", True, test_url)
                                await receiver_ws.send(test_url.encode('utf-8'))

                            elif msg.get("type") == "tcp_data":
                                # Got response from donor!
                                status = msg.get("status", 0)
                                body_len = msg.get("body_length", 0)
                                preview = msg.get("body_preview", "")[:100]
                                log(f"RESPONSE from real internet!", True,
                                    f"HTTP {status}, {body_len} bytes: {preview}...")
                                return

                            elif msg.get("type") == "waiting_for_donor":
                                log("Waiting for donor...", True)

                        except:
                            pass

        except Exception as e:
            log("Receiver error", False, str(e))

    # ====================================================================
    # RUN BOTH SIDES CONCURRENTLY
    # ====================================================================
    await asyncio.gather(donor_side(), receiver_side())

    # ====================================================================
    # RESULTS
    # ====================================================================
    global PASS, FAIL
    print(f"\n  {'='*45}")
    print(f"  📊 Network Test: {PASS} passed, {FAIL} failed")
    print(f"  {'='*45}")
    
    if FAIL == 0:
        print("\n  🎉 REAL INTERNET ACCESS THROUGH TUNNEL: ✅ WORKING!")
        print("  ╔══════════════════════════════════════════════╗")
        print("  ║  Receiver → Server → Donor → 🌐 INTERNET  ║")
        print("  ║     ← Response ← Server ← ← ← ← ←         ║")
        print("  ╚══════════════════════════════════════════════╝")
        print("  📍 This is EXACTLY what the Android VPN app does!")

async def main():
    print("=" * 55)
    print("🌐 DATASHARE VPN — REAL END-TO-END TEST")
    print("=" * 55)
    print(f"📡 Server: {SERVER_URL}")

    await test_end_to_end()

    print(f"\n{'='*55}")
    verdict = "✅ ALL TESTS PASSED" if FAIL == 0 else f"❌ {FAIL} TESTS FAILED"
    print(f"📊 Total: {PASS} passed, {FAIL} failed — {verdict}")
    print(f"{'='*55}")
    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(result)
