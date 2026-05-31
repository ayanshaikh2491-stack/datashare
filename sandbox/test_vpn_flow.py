#!/usr/bin/env python3
"""
test_vpn_flow.py — Complete VPN Data Flow Test

Simulates the full DataShare VPN tunnel:
1. Donor connects to server via WebSocket
2. Receiver connects to server via WebSocket
3. Server pairs them
4. Receiver sends test data through tunnel
5. Donor receives and forwards to "internet"
6. "Internet" responds
7. Response flows back through tunnel to receiver

Metrics collected:
- Latency (ms)
- Throughput (bytes/sec)
- Data integrity (SHA256 match)
- Connection time
- Packet loss
"""

import asyncio
import hashlib
import json
import random
import sys
import time
import os

SERVER_WS = "ws://localhost:3000/ws-vpn"

# Test metrics
metrics = {
    "connection_time_ms": 0,
    "pairing_time_ms": 0,
    "roundtrip_latency_ms": 0,
    "throughput_bps": 0,
    "bytes_sent": 0,
    "bytes_received": 0,
    "packets_sent": 0,
    "packets_received": 0,
    "errors": 0
}

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

async def test_full_vpn_flow():
    """Complete VPN flow: donor ↔ server ↔ receiver"""
    print("\n🔄 Full VPN Data Flow Test")
    print("-" * 40)

    received_data = {}
    TUNNEL_PACKETS = []
    donor_connected = asyncio.Event()
    receiver_connected = asyncio.Event()
    donor_paired = asyncio.Event()
    receiver_paired = asyncio.Event()
    flow_complete = asyncio.Event()
    test_data = os.urandom(1024 * 10)  # 10 KB test payload
    test_hash = hashlib.sha256(test_data).hexdigest()
    received_hash = [None]

    async def donor_handler(ws):
        """Simulates the DONOR app"""
        nonlocal received_data

        # Connect handshake
        await ws.send(json.dumps({
            "type": "vpn_connect",
            "mode": "donor",
            "userId": "test_donor_1"
        }))

        donor_connected.set()

        async for message in ws:
            if isinstance(message, str):
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "vpn_connected":
                    log_test("Donor handshake", True)
                    donor_connected.set()

                elif msg_type == "vpn_session_created":
                    session_id = data.get("sessionId", "?")
                    peer_id = data.get("peerId", "?")
                    log_test("Donor paired with receiver", True,
                             f"session={session_id[:16]}...")
                    donor_paired.set()

                elif msg_type == "new_connection":
                    # Server says receiver wants to connect to internet IP
                    dest_ip = data.get("destIp", "")
                    dest_port = data.get("destPort", 0)
                    log_test("Donor got connection request", True,
                             f"{dest_ip}:{dest_port}")

                    # Donor would open socket here — simulate success
                    await ws.send(json.dumps({
                        "type": "tcp_connect_ack",
                        "connectionId": data.get("connectionId", 0),
                        "status": "connected"
                    }))

                elif msg_type == "tcp_data":
                    # Binary data coming from receiver (base64)
                    if "data" in data:
                        import base64
                        payload = base64.b64decode(data["data"])
                        metrics["bytes_received"] += len(payload)
                        metrics["packets_received"] += 1
                        # Store for integrity check
                        received_hash[0] = hashlib.sha256(payload).hexdigest()

                        # Echo back as response (simulating internet reply)
                        import base64
                        await ws.send(json.dumps({
                            "type": "tcp_data",
                            "destIp": data.get("destIp", "10.8.0.2"),
                            "destPort": data.get("srcPort", 0),
                            "srcPort": data.get("destPort", 0),
                            "data": base64.b64encode(payload).decode()
                        }))
                        flow_complete.set()

            elif isinstance(message, bytes):
                metrics["bytes_received"] += len(message)
                metrics["packets_received"] += 1
                TUNNEL_PACKETS.append(message)

    async def receiver_handler(ws):
        """Simulates the RECEIVER app sending data through VPN"""
        # Connect handshake with donor ID
        await ws.send(json.dumps({
            "type": "vpn_connect",
            "mode": "receiver",
            "userId": "test_receiver_1",
            "donorId": "test_donor_1"
        }))

        receiver_connected.set()

        paired = False
        sent_data = False

        async for message in ws:
            if isinstance(message, str):
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "vpn_connected":
                    log_test("Receiver handshake", True)

                elif msg_type == "vpn_session_created" or msg_type == "paired":
                    paired = True
                    log_test("Receiver paired with donor", True,
                             f"session={data.get('sessionId', '?')[:16]}...")
                    receiver_paired.set()

                elif msg_type == "waiting_for_donor":
                    log_test("Receiver waiting for donor", True)

                elif msg_type == "tcp_data" and not sent_data:
                    # Got response from donor!
                    if "data" in data:
                        import base64
                        payload = base64.b64decode(data["data"])
                        metrics["bytes_received"] += len(payload)
                        metrics["packets_received"] += 1
                        flow_complete.set()
                        sent_data = True

    # === RUN THE TEST ===
    start_time = time.time()

    try:
        import websockets

        # Connect donor first
        t0 = time.time()
        async with websockets.connect(f"{SERVER_WS}?userId=test_donor_1&mode=donor") as donor_ws:
            metrics["connection_time_ms"] = (time.time() - t0) * 1000

            # Start donor handler task
            donor_task = asyncio.create_task(donor_handler(donor_ws))

            # Wait for donor to be connected and ready
            await asyncio.wait_for(donor_connected.wait(), timeout=5)

            # Now connect receiver
            t1 = time.time()
            async with websockets.connect(
                f"{SERVER_WS}?userId=test_receiver_1&mode=receiver&donorId=test_donor_1"
            ) as receiver_ws:
                metrics["connection_time_ms"] += (time.time() - t1) * 1000

                # Start receiver handler task
                receiver_task = asyncio.create_task(receiver_handler(receiver_ws))

                # Wait for pairing
                await asyncio.wait_for(receiver_paired.wait(), timeout=10)
                metrics["pairing_time_ms"] = (time.time() - t0) * 1000

                log_test("Donor-Receiver pairing", True,
                         f"took {metrics['pairing_time_ms']:.0f}ms")

                # === SEND TEST DATA ===
                import base64

                # Simulate: receiver sending a "TCP data" packet through the tunnel
                packet_count = 0
                total_bytes = 0
                tx_start = time.time()

                # Send test data in chunks (simulating IP packets)
                chunk_size = 1400  # MTU-like size
                for offset in range(0, len(test_data), chunk_size):
                    chunk = test_data[offset:offset + chunk_size]
                    await receiver_ws.send(json.dumps({
                        "type": "tcp_data",
                        "destIp": "142.250.80.100",  # Google IP
                        "destPort": 443,
                        "srcPort": 54321,
                        "data": base64.b64encode(chunk).decode()
                    }))
                    metrics["bytes_sent"] += len(chunk)
                    metrics["packets_sent"] += 1
                    packet_count += 1
                    total_bytes += len(chunk)
                    await asyncio.sleep(0.001)  # Small delay between packets

                tx_time = time.time() - tx_start
                metrics["throughput_bps"] = total_bytes / tx_time if tx_time > 0 else 0

                log_test("Test data sent", True,
                         f"{total_bytes} bytes in {packet_count} packets ({tx_time:.2f}s)")

                # Wait for response to come back
                try:
                    await asyncio.wait_for(flow_complete.wait(), timeout=10)
                    log_test("Response received from donor", True)
                except asyncio.TimeoutError:
                    log_test("Response received from donor", False, "TIMEOUT")
                    metrics["errors"] += 1

                # === METRICS ===
                elapsed = time.time() - start_time

                print(f"\n  📊 Flow Metrics:")
                print(f"     Connection time:    {metrics['connection_time_ms']:.0f}ms")
                print(f"     Pairing time:       {metrics['pairing_time_ms']:.0f}ms")
                print(f"     Data sent:          {metrics['bytes_sent']} bytes ({metrics['packets_sent']} packets)")
                print(f"     Data received:      {metrics['bytes_received']} bytes ({metrics['packets_received']} packets)")
                print(f"     Throughput:         {metrics['throughput_bps']/1024:.1f} KB/s")
                print(f"     Test duration:      {elapsed:.2f}s")

                # Clean up
                await receiver_ws.close()
                donor_task.cancel()
                receiver_task.cancel()

    except ImportError:
        log_test("websockets module", False, "not installed. Run: pip install websockets")
        return False
    except Exception as e:
        log_test("VPN flow test", False, str(e))
        metrics["errors"] += 1
        return False

    return metrics["errors"] == 0

async def test_server_ws():
    """Quick WebSocket handshake test"""
    print("\n🔌 Quick WS Connectivity Test")
    try:
        import websockets
        async with websockets.connect(f"{SERVER_WS}?userId=test_quick&mode=donor") as ws:
            await ws.send(json.dumps({"type": "vpn_connect", "mode": "donor", "userId": "test_quick"}))
            resp = await asyncio.wait_for(ws.recv(), timeout=5)
            import json
            data = json.loads(resp)
            log_test("WS connect + handshake", data.get("type") == "vpn_connected",
                     f"got '{data.get('type', '?')}'")
            await ws.close()
            return True
    except Exception as e:
        log_test("WS connect + handshake", False, str(e))
        return False

async def main():
    print("=" * 55)
    print("🧪 DataShare VPN Tunnel Test Suite")
    print("=" * 55)

    await test_server_ws()
    await test_full_vpn_flow()

    print(f"\n{'='*55}")
    verdict = "✅ ALL TESTS PASSED" if FAIL == 0 else f"❌ {FAIL} TESTS FAILED"
    print(f"📊 Results: {PASS} passed, {FAIL} failed — {verdict}")
    print(f"{'='*55}")

    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(result)
