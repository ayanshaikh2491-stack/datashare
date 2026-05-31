import asyncio, json, sys
sys.stdout.reconfigure(encoding='utf-8')

WS_URL = "ws://localhost:3000/ws-vpn"

async def test_all():
    print("=" * 55)
    print("DATASHARE VPN - COMPLETE TEST")
    print("=" * 55)
    passed = 0
    failed = 0
    
    # TEST 1: Binary relay (raw IP packets)
    print("\n[TEST 1] Binary relay (raw IP packets)")
    try:
        import websockets
        d_ready = asyncio.Event()
        
        async def donor1():
            async with websockets.connect(f"{WS_URL}?userId=donor_bin&mode=donor&token=t1") as ws:
                # Wait for pairing
                paired = False
                while not paired:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        if d.get("type") in ("vpn_session_created", "paired"):
                            paired = True
                d_ready.set()
                # Wait for binary from receiver
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                if isinstance(msg, bytes) and msg == b"hello_donor":
                    await ws.send(b"hello_receiver")
        
        async def receiver1():
            await asyncio.sleep(0.3)
            async with websockets.connect(f"{WS_URL}?userId=recv_bin&mode=receiver&donorId=donor_bin&token=t2") as ws:
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        if d.get("type") in ("vpn_session_created", "paired"):
                            await asyncio.sleep(0.5)
                            await ws.send(b"hello_donor")
                            resp = await asyncio.wait_for(ws.recv(), timeout=10)
                            if isinstance(resp, bytes) and resp == b"hello_receiver":
                                return True
                    elif isinstance(msg, bytes) and msg == b"hello_receiver":
                        return True
                return False
        
        result = await asyncio.wait_for(asyncio.gather(donor1(), receiver1()), timeout=20)
        # the gather returns [None, True] or similar - check if receiver1 returned True
        if True in result or len([x for x in result if x == True]) > 0:
            print("  [PASS] Binary relay works!")
            passed += 1
        else:
            print("  [FAIL] Binary relay failed")
            failed += 1
    except Exception as e:
        print(f"  [FAIL] {e}")
        failed += 1
    
    # TEST 2: Text message relay (new_connection / tcp_data)
    print("\n[TEST 2] Text message relay (TCP data)")
    try:
        d_ready2 = asyncio.Event()
        
        async def donor2():
            async with websockets.connect(f"{WS_URL}?userId=donor_txt&mode=donor&token=t3") as ws:
                paired = False
                while not paired:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        if d.get("type") in ("vpn_session_created", "paired"):
                            paired = True
                d_ready2.set()
                # Should receive new_connection text
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                if isinstance(msg, str):
                    d = json.loads(msg)
                    if d.get("type") == "new_connection":
                        print(f"    Donor got new_connection: {d.get('destIp')}:{d.get('destPort')}")
                        # Send connection_established back
                        await ws.send(json.dumps({"type": "connection_established", "connectionId": d.get("connectionId")}))
                        # Should receive tcp_data next
                        msg2 = await asyncio.wait_for(ws.recv(), timeout=10)
                        if isinstance(msg2, str):
                            d2 = json.loads(msg2)
                            if d2.get("type") == "tcp_data":
                                print(f"    Donor got tcp_data: {len(d2.get('data',''))} bytes")
                                # Send response
                                await ws.send(json.dumps({"type": "tcp_data", "connectionId": d2.get("connectionId"), "data": "response_ok"}))
                                return True
            return False
        
        async def receiver2():
            await asyncio.sleep(0.3)
            async with websockets.connect(f"{WS_URL}?userId=recv_txt&mode=receiver&donorId=donor_txt&token=t4") as ws:
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        if d.get("type") in ("vpn_session_created", "paired"):
                            await asyncio.sleep(0.5)
                            # Send new_connection
                            await ws.send(json.dumps({"type": "new_connection", "destIp": "8.8.8.8", "destPort": 80, "srcPort": 54321, "connectionId": 1}))
                        elif d.get("type") == "connection_established":
                            print(f"    Receiver got connection_established!")
                            # Send tcp_data
                            await ws.send(json.dumps({"type": "tcp_data", "connectionId": 1, "data": "GET / HTTP/1.1"}))
                        elif d.get("type") == "tcp_data":
                            print(f"    Receiver got tcp_data: {d.get('data','')}")
                            return True
                return False
        
        result = await asyncio.wait_for(asyncio.gather(donor2(), receiver2()), timeout=25)
        if True in [x for x in result if x == True]:
            print("  [PASS] Text message relay (TCP data) works!")
            passed += 1
        else:
            print("  [FAIL] Text relay failed")
            failed += 1
    except Exception as e:
        print(f"  [FAIL] {e}")
        failed += 1
    
    # RESULTS
    print(f"\n{'=' * 55}")
    print(f"RESULTS: {passed} passed, {failed} failed out of 2 tests")
    if failed == 0:
        print("ALL TESTS PASSED! Server relay is working!")
    else:
        print("Some tests failed")

if __name__ == "__main__":
    asyncio.run(test_all())
