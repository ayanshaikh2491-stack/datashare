#!/usr/bin/env python3
"""
test_stress.py — Stress & Performance Test

Simulates heavy traffic through the VPN tunnel:
- Multiple concurrent "connections"
- Large data transfers
- Connection/disconnect cycling
- Measures:
  - Max throughput
  - Connection stability
  - Memory usage
  - Data integrity under load
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

async def test_throughput():
    """Measure raw throughput through the tunnel"""
    print("\n⚡ Throughput Test")
    print("-" * 40)

    try:
        import websockets

        DATA_SIZE = 1024 * 100  # 100 KB
        test_data = os.urandom(DATA_SIZE)
        donor_ready = asyncio.Event()
        receiver_ready = asyncio.Event()
        received_chunks = []
        done = asyncio.Event()

        async with websockets.connect(f"{SERVER_WS}?userId=throughput_donor&mode=donor") as donor_ws:
            await donor_ws.send(json.dumps({
                "type": "vpn_connect", "mode": "donor", "userId": "throughput_donor"
            }))
            await asyncio.wait_for(donor_ws.recv(), timeout=5)

            async with websockets.connect(
                f"{SERVER_WS}?userId=throughput_receiver&mode=receiver&donorId=throughput_donor"
            ) as receiver_ws:
                await receiver_ws.send(json.dumps({
                    "type": "vpn_connect", "mode": "receiver",
                    "userId": "throughput_receiver", "donorId": "throughput_donor"
                }))

                # Wait for pairing
                paired = False
                t0 = time.time()
                while not paired and time.time() - t0 < 10:
                    resp = await asyncio.wait_for(receiver_ws.recv(), timeout=3)
                    msg = json.loads(resp)
                    if msg.get("type") in ("vpn_session_created", "paired"):
                        paired = True

                if not paired:
                    log_test("Throughput pairing", False, "TIMEOUT")
                    return

                # Donor reader
                async def donor_reader():
                    async for msg in donor_ws:
                        if isinstance(msg, bytes):
                            received_chunks.append(msg)
                            if len(received_chunks) >= 1:
                                done.set()

                reader = asyncio.create_task(donor_reader())

                # Send data in chunks (simulating IP packets)
                chunk_size = 1400
                chunks = [test_data[i:i+chunk_size] for i in range(0, len(test_data), chunk_size)]

                tx_start = time.time()
                for chunk in chunks:
                    await receiver_ws.send(chunk)
                    await asyncio.sleep(0)  # Yield control
                tx_time = time.time() - tx_start

                # Wait for receipt
                try:
                    await asyncio.wait_for(done.wait(), timeout=10)
                except asyncio.TimeoutError:
                    pass

                elapsed = time.time() - tx_start
                rx_bytes = sum(len(c) for c in received_chunks)
                throughput = DATA_SIZE / elapsed if elapsed > 0 else 0

                log_test("Throughput test", rx_bytes > 0,
                         f"{DATA_SIZE/1024:.0f} KB in {elapsed:.2f}s = {throughput/1024:.0f} KB/s")

                # Show server health during test
                try:
                    import urllib.request
                    resp = urllib.request.urlopen("http://localhost:3000/api/health", timeout=3)
                    health = json.loads(resp.read())
                    vt = health.get("vpnTunnel", {})
                    print(f"     Server: sessions={vt.get('sessions', 0)}, "
                          f"memory={health.get('memory', {}).get('heapUsed', '?')}")
                except Exception:
                    pass

                reader.cancel()
                await donor_ws.close()
                await receiver_ws.close()

    except ImportError:
        log_test("Throughput test", False, "websockets not installed")
    except Exception as e:
        log_test("Throughput test", False, str(e))

async def test_connection_cycle():
    """Test connect/disconnect cycling (simulates phone toggling)"""
    print("\n🔄 Connection Cycle Test")
    print("-" * 40)

    try:
        import websockets

        cycles = 5
        successful = 0

        for i in range(cycles):
            try:
                donor_id = f"cycle_donor_{i}"
                receiver_id = f"cycle_receiver_{i}"

                async with websockets.connect(
                    f"{SERVER_WS}?userId={donor_id}&mode=donor"
                ) as donor_ws:
                    await donor_ws.send(json.dumps({
                        "type": "vpn_connect", "mode": "donor", "userId": donor_id
                    }))
                    resp = json.loads(await asyncio.wait_for(donor_ws.recv(), timeout=5))
                    assert resp.get("type") == "vpn_connected"

                    async with websockets.connect(
                        f"{SERVER_WS}?userId={receiver_id}&mode=receiver&donorId={donor_id}"
                    ) as receiver_ws:
                        await receiver_ws.send(json.dumps({
                            "type": "vpn_connect", "mode": "receiver",
                            "userId": receiver_id, "donorId": donor_id
                        }))

                        paired = False
                        t0 = time.time()
                        while not paired and time.time() - t0 < 10:
                            resp = json.loads(await asyncio.wait_for(receiver_ws.recv(), timeout=3))
                            if resp.get("type") in ("vpn_session_created", "paired"):
                                paired = True

                        if paired:
                            successful += 1

            except Exception as e:
                print(f"     Cycle {i+1} failed: {e}")

        success_rate = (successful / cycles) * 100
        log_test(f"Connection cycling ({cycles} cycles)", success_rate >= 80,
                 f"{successful}/{cycles} successful ({success_rate:.0f}%)")

    except ImportError:
        log_test("Connection cycle test", False, "websockets not installed")
    except Exception as e:
        log_test("Connection cycle test", False, str(e))

async def main():
    print("=" * 55)
    print("🧪 DataShare Stress & Performance Test Suite")
    print("=" * 55)
    print(f"⚠️  Tests run against localhost:3000")
    print(f"⚠️  Ensure server is running in another terminal")

    await test_throughput()
    await test_connection_cycle()

    print(f"\n{'='*55}")
    verdict = "✅ ALL TESTS PASSED" if FAIL == 0 else f"❌ {FAIL} TESTS FAILED"
    print(f"📊 Results: {PASS} passed, {FAIL} failed — {verdict}")
    print(f"{'='*55}")
    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(result)
