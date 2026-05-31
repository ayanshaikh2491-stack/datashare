#!/usr/bin/env python3
"""
test_binary_protocol.py — Binary WebSocket Protocol Test

Tests the raw binary packet relay that the VPN app uses:
- Sends raw binary frames (simulating IP packets)
- Verifies they arrive correctly on the other side
- Measures latency and integrity
"""

import asyncio
import hashlib
import json
import os
import sys
import time

SERVER_WS = "ws://localhost:3000/ws-vpn"
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

async def test_binary_relay():
    """Test raw binary packet relay (the actual VPN protocol)"""
    print("\n📦 Binary Protocol Test")
    print("-" * 40)

    donor_received = []
    receiver_received = []
    donor_ready = asyncio.Event()
    receiver_ready = asyncio.Event()
    test_done = asyncio.Event()

    try:
        import websockets

        # Connect donor
        async with websockets.connect(f"{SERVER_WS}?userId=binary_donor&mode=donor") as donor_ws:
            await donor_ws.send(json.dumps({
                "type": "vpn_connect", "mode": "donor", "userId": "binary_donor"
            }))
            resp = await asyncio.wait_for(donor_ws.recv(), timeout=5)
            msg = json.loads(resp)
            assert msg.get("type") == "vpn_connected", f"Expected vpn_connected, got {msg.get('type')}"
            donor_ready.set()

            # Connect receiver
            async with websockets.connect(
                f"{SERVER_WS}?userId=binary_receiver&mode=receiver&donorId=binary_donor"
            ) as receiver_ws:
                await receiver_ws.send(json.dumps({
                    "type": "vpn_connect", "mode": "receiver",
                    "userId": "binary_receiver", "donorId": "binary_donor"
                }))

                # Wait for pairing
                paired = False
                timeout = time.time() + 10
                while not paired and time.time() < timeout:
                    try:
                        resp = await asyncio.wait_for(receiver_ws.recv(), timeout=2)
                        msg = json.loads(resp)
                        if msg.get("type") in ("vpn_session_created", "paired"):
                            paired = True
                    except (asyncio.TimeoutError, json.JSONDecodeError):
                        pass

                if not paired:
                    log_test("Binary test pairing", False, "TIMEOUT")
                    return False

                log_test("Binary test paired", True)

                # === TEST 1: Binary echo ===
                # Send binary packets from donor, they should go to receiver
                test_packets = [
                    os.urandom(100),
                    os.urandom(500),
                    os.urandom(1400),  # MTU-sized
                    os.urandom(50),
                ]

                # Set up donor reader
                async def read_donor():
                    async for msg in donor_ws:
                        if isinstance(msg, bytes):
                            donor_received.append(msg)
                        elif isinstance(msg, str):
                            pass
                        if len(donor_received) >= len(test_packets):
                            break

                # Set up receiver reader
                async def read_receiver():
                    async for msg in receiver_ws:
                        if isinstance(msg, bytes):
                            receiver_received.append(msg)
                        elif isinstance(msg, str):
                            pass
                        if len(receiver_received) >= len(test_packets):
                            test_done.set()
                            break

                # Start readers
                donor_reader = asyncio.create_task(read_donor())
                receiver_reader = asyncio.create_task(read_receiver())

                # Send packets from receiver (simulating app traffic)
                for i, pkt in enumerate(test_packets):
                    await receiver_ws.send(pkt)
                    await asyncio.sleep(0.05)

                # Wait for donor to receive them
                await asyncio.sleep(1)
                received_count = len(donor_received)

                if received_count >= len(test_packets):
                    log_test("Binary packet relay", True,
                             f"{received_count}/{len(test_packets)} packets received")

                    # Integrity check
                    all_match = True
                    for i, (sent, recv) in enumerate(zip(test_packets, donor_received)):
                        if sent != recv:
                            log_test(f"Packet {i} integrity", False,
                                     f"SHA256 sent={hashlib.sha256(sent).hexdigest()[:16]}... "
                                     f"recv={hashlib.sha256(recv).hexdigest()[:16]}...")
                            all_match = False
                            break

                    if all_match:
                        log_test("Binary data integrity (SHA256)", True,
                                 f"{len(test_packets)} packets verified")
                else:
                    log_test("Binary packet relay", False,
                             f"Expected {len(test_packets)}, got {received_count}")

                # Clean up
                donor_reader.cancel()
                receiver_reader.cancel()
                await donor_ws.close()
                await receiver_ws.close()

    except ImportError:
        log_test("Binary protocol test", False, "websockets not installed")
        return False
    except Exception as e:
        log_test("Binary protocol test", False, str(e))
        return False

    return True

async def main():
    print("=" * 55)
    print("🧪 DataShare Binary Protocol Test Suite")
    print("=" * 55)

    await test_binary_relay()

    print(f"\n{'='*55}")
    verdict = "✅ ALL TESTS PASSED" if FAIL == 0 else f"❌ {FAIL} TESTS FAILED"
    print(f"📊 Results: {PASS} passed, {FAIL} failed — {verdict}")
    print(f"{'='*55}")
    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(result)
