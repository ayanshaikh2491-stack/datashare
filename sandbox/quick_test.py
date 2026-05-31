import asyncio, json, sys, os
sys.stdout.reconfigure(encoding='utf-8')

WS_URL = "ws://localhost:3000/ws-vpn"
DONOR_ID = "test_donor_3"

async def main():
    print("=" * 50)
    print("DATASHARE VPN - E2E TEST V3 (Binary Relay)")
    print("=" * 50)

    test_passed = asyncio.Event()
    result_data = {}

    async def donor():
        try:
            import websockets
            async with websockets.connect(f"{WS_URL}?userId={DONOR_ID}&mode=donor&token=abc125") as ws:
                # Handle messages until paired
                paired = False
                while not paired:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        t = d.get("type", "")
                        if t == "vpn_connected":
                            print("[OK] Donor connected")
                        elif t in ("vpn_session_created", "paired"):
                            print("[OK] Donor paired!")
                            paired = True
                
                # Wait for binary URL from receiver
                print("[..] Donor waiting for data...")
                msg = await asyncio.wait_for(ws.recv(), timeout=15)
                
                if isinstance(msg, bytes):
                    url = msg.decode('utf-8')
                    print(f"[RECV] Donor got URL: {url}")
                    
                    # REAL HTTP request to internet
                    import urllib.request
                    req = urllib.request.Request(url, headers={'User-Agent': 'DataShare-VPN/1.0'})
                    resp = urllib.request.urlopen(req, timeout=15)
                    content = resp.read()
                    print(f"[PASS] REAL INTERNET! HTTP {resp.status}, {len(content)} bytes")
                    
                    # Send response as BINARY (so server relays it!)
                    await ws.send(content)
                    print(f"[OK] Response ({len(content)} bytes) sent as BINARY via tunnel")
                    result_data['internet_ok'] = True
                    result_data['bytes'] = len(content)
                    result_data['status'] = resp.status
                        
        except Exception as e:
            print(f"[FAIL] Donor error: {e}")

    async def receiver():
        try:
            import websockets
            await asyncio.sleep(0.3)
            async with websockets.connect(f"{WS_URL}?userId=test_recv_3&mode=receiver&donorId={DONOR_ID}&token=xyz791") as ws:
                paired = False
                while not paired:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        t = d.get("type", "")
                        if t == "vpn_connected":
                            print("[OK] Receiver connected")
                        elif t in ("vpn_session_created", "paired"):
                            print("[OK] Receiver paired!")
                            paired = True
                
                await asyncio.sleep(0.5)
                
                # Send URL as BINARY
                test_url = "http://example.com"
                await ws.send(test_url.encode('utf-8'))
                print(f"[SEND] Receiver sent URL as BINARY: {test_url}")
                
                # Wait for binary response from donor
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    if isinstance(msg, bytes):
                        preview = msg[:200].decode('utf-8', errors='replace')
                        print(f"[PASS] RECEIVER GOT BINARY RESPONSE! {len(msg)} bytes")
                        print(f"[DATA] {preview[:100]}")
                        if b"Example Domain" in msg or b"HTML" in msg:
                            result_data['html_preview'] = preview[:60]
                            test_passed.set()
                        return
                    elif isinstance(msg, str):
                        # Log text messages
                        print(f"[TEXT] {msg[:60]}")
        except Exception as e:
            print(f"[FAIL] Receiver error: {e}")

    try:
        import websockets
    except ImportError:
        print("[FAIL] pip install websockets")
        return 1

    await asyncio.gather(donor(), receiver())
    
    try:
        await asyncio.wait_for(test_passed.wait(), timeout=30)
        print()
        print("=" * 50)
        print("+++++++ TEST PASSED! INTERNET THROUGH VPN! +++++++")
        print()
        print("  [Receiver] --URL(binary)--> [Server] --relay--> [Donor]")
        print("                                                        |")
        print("                                                  [REAL HTTP]")
        print("                                                  example.com")
        print("                                                        |")
        print("  [Receiver] <--HTML(binary)-- [Server] <--relay-- [Donor]")
        print()
        print(f"  HTTP OK, {result_data.get('bytes', 0)} bytes received")
        print(f"  Preview: {result_data.get('html_preview', '')}")
        print()
        print("!!!!!!!!! DATA RELAY WORKING !!!!!!!!!")
    except asyncio.TimeoutError:
        print()
        print("=" * 50)
        print("TEST FAILED - Timeout")
    
    return 0 if test_passed.is_set() else 1

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
