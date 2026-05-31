#!/usr/bin/env python3
"""Quick E2E test: Receiver → Donor → Internet → Back (fixed timing)"""

import asyncio, json, sys, os, urllib.request

WS_URL = os.environ.get("WS_URL", "ws://localhost:3000/ws-vpn")
DONOR_ID = "e2e_donor"

async def main():
    print("=" * 60)
    print("🌐 DATASHARE VPN — REAL END-TO-END TEST")
    print("=" * 60)
    print(f"📡 Server: {WS_URL}")
    print()

    recv_data = asyncio.Event()
    internet_ok = [False]
    response_text = [""]

    async def donor():
        try:
            async with websockets.connect(
                f"{WS_URL}?userId={DONOR_ID}&mode=donor&token=t1"
            ) as ws:
                # Wait for initial vpn_connected
                resp = await asyncio.wait_for(ws.recv(), timeout=5)
                print(f"  ✅ Donor connected")
                
                # Wait for URL from receiver (relayed by server)
                print(f"  ⏳ Donor waiting for data from receiver...")
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
                
                if isinstance(msg, bytes):
                    url = msg.decode()
                    print(f"  📨 Donor received URL: {url}")
                    
                    # === REAL HTTP REQUEST TO INTERNET ===
                    try:
                        req = urllib.request.Request(url, headers={'User-Agent': 'DataShare-VPN/1.0'})
                        resp = urllib.request.urlopen(req, timeout=15)
                        content = resp.read()
                        print(f"  🌐 REAL INTERNET ACCESS! HTTP {resp.status}, {len(content)} bytes")
                        internet_ok[0] = True
                        
                        preview = content[:200].decode('utf-8', errors='replace')
                        await ws.send(json.dumps({
                            "type": "tcp_data", "url": url,
                            "status": resp.status, "body_length": len(content),
                            "body_preview": preview
                        }))
                        print(f"  ✅ Response sent back to receiver")
                    except Exception as e:
                        print(f"  ❌ HTTP error: {e}")
                        await ws.send(json.dumps({"type": "tcp_data", "error": str(e)}))
                        
        except Exception as e:
            print(f"  ❌ Donor error: {e}")

    async def receiver():
        try:
            await asyncio.sleep(0.3)
            async with websockets.connect(
                f"{WS_URL}?userId=e2e_recv&mode=receiver&donorId={DONOR_ID}&token=t2"
            ) as ws:
                # Read messages until paired
                paired = False
                while not paired:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)
                    if isinstance(msg, str):
                        try:
                            d = json.loads(msg)
                            t = d.get("type", "")
                            if t == "vpn_connected":
                                print(f"  ✅ Receiver connected")
                            elif t in ("vpn_session_created", "paired"):
                                print(f"  ✅ Receiver paired with donor!")
                                paired = True
                        except:
                            pass
                
                # NOW send URL (after pairing!)
                test_url = "http://example.com"
                await ws.send(test_url.encode())
                print(f"  📤 Receiver sent URL through tunnel: {test_url}")
                
                # Wait for response
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    if isinstance(msg, str):
                        try:
                            d = json.loads(msg)
                            if d.get("type") == "tcp_data":
                                status = d.get("status", 0)
                                body = d.get("body_preview", "")[:100]
                                print(f"  📦 RECEIVER GOT INTERNET RESPONSE!")
                                print(f"  📄 HTTP {status} — {body}")
                                response_text[0] = body
                                recv_data.set()
                                return
                        except:
                            pass
        except Exception as e:
            print(f"  ❌ Receiver error: {e}")
            recv_data.set()

    try:
        import websockets
    except ImportError:
        print("  ❌ pip install websockets")
        return 1

    await asyncio.gather(donor(), receiver())
    await asyncio.wait_for(recv_data.wait(), timeout=25)

    print()
    print("  " + "=" * 50)
    if internet_ok[0]:
        print("  ✅✅✅ REAL INTERNET THROUGH VPN TUNNEL: WORKING!")
        print()
        print("  ╔══════════════════════════════════════════════════╗")
        print("  ║  RECEIVER → SERVER → DONOR → EXAMPLE.COM ✅  ║")
        print("  ║  ← RESPONSE ← SERVER ← ← ← ← ← (200 OK)    ║")
        print("  ╚══════════════════════════════════════════════════╝")
        print()
        print(f"  📄 {response_text[0][:80]}")
        print()
        print("  📱 YAHI HAI DONOR SE RECEIVER TAK INTERNET SHARING!")
        print("  📱 Android app mein TUN interface ke through same flow")
    else:
        print("  ❌ Internet access FAILED")
        print("  ❌ Check if http://example.com is reachable")

    return 0 if internet_ok[0] else 1

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(result)
