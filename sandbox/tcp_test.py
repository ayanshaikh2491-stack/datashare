import asyncio, json, sys
sys.stdout.reconfigure(encoding='utf-8')

WS_URL = "ws://localhost:3000/ws-vpn"

async def main():
    print("=" * 50)
    print("DATASHARE - TCP RELAY TEST")
    print("=" * 50)
    
    import websockets
    
    received_msg = asyncio.Event()
    
    async def donor():
        async with websockets.connect(f"{WS_URL}?userId=donor_fix&mode=donor&token=a1") as ws:
            # Read messages until we get the new_connection
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=15)
                if isinstance(msg, str):
                    d = json.loads(msg)
                    t = d.get("type","")
                    if t == "vpn_connected":
                        print("[OK] Donor connected")
                    elif t in ("vpn_session_created", "paired"):
                        print("[OK] Donor paired")
                    elif t == "new_connection":
                        print(f"[RECV] Donor got new_connection: {d}")
                        # Send connection_established back
                        await ws.send(json.dumps({
                            "type": "connection_established",
                            "connectionId": d.get("connectionId")
                        }))
                        print("[SEND] connection_established sent")
                    elif t == "tcp_data":
                        print(f"[RECV] Donor got tcp_data: {d.get('data','')}")
                        # Send response
                        await ws.send(json.dumps({
                            "type": "tcp_data",
                            "connectionId": d.get("connectionId"),
                            "data": "hello_from_donor"
                        }))
                        print("[SEND] tcp_data response sent")
                
    async def receiver():
        await asyncio.sleep(0.3)
        async with websockets.connect(f"{WS_URL}?userId=recv_fix&mode=receiver&donorId=donor_fix&token=a2") as ws:
            paired = False
            while not paired:
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                if isinstance(msg, str):
                    d = json.loads(msg)
                    t = d.get("type","")
                    if t == "vpn_connected":
                        print("[OK] Receiver connected")
                    elif t in ("vpn_session_created", "paired"):
                        print("[OK] Receiver paired")
                        paired = True
            
            await asyncio.sleep(0.5)
            
            # Send new_connection
            await ws.send(json.dumps({
                "type": "new_connection",
                "destIp": "8.8.8.8",
                "destPort": 80,
                "srcPort": 54321,
                "connectionId": 1
            }))
            print("[SEND] new_connection sent")
            
            # Wait for connection_established
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                if isinstance(msg, str):
                    d = json.loads(msg)
                    t = d.get("type","")
                    if t == "connection_established":
                        print(f"[RECV] Receiver got connection_established!")
                        
                        # Send tcp_data
                        await asyncio.sleep(0.3)
                        await ws.send(json.dumps({
                            "type": "tcp_data",
                            "connectionId": 1,
                            "data": "GET / HTTP/1.1"
                        }))
                        print("[SEND] tcp_data sent")
                        
                    elif t == "tcp_data":
                        print(f"[RECV] Receiver got tcp_data: {d.get('data','')}")
                        if d.get("data") == "hello_from_donor":
                            print()
                            print("=" * 50)
                            print("SUCCESS! TCP relay working!")
                            print("=" * 50)
                            print()
                            print("Receiver -> new_connection -> Server -> Donor")
                            print("Donor -> connection_established -> Server -> Receiver") 
                            print("Receiver -> tcp_data -> Server -> Donor")
                            print("Donor -> tcp_data(response) -> Server -> Receiver")
                            print()
                            print("YAHI HAI DONOR SE RECEIVER TAK INTERNET SHARING!")
                            print("(socket approach - no root needed)")
                            received_msg.set()
                        return
    
    await asyncio.gather(donor(), receiver())
    await asyncio.wait_for(received_msg.wait(), timeout=20)
    print("\n[PASS] All TCP relay messages work!")

if __name__ == "__main__":
    asyncio.run(main())
