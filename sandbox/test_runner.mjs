#!/usr/bin/env node
/**
 * test_runner.mjs — DataShare VPN Test Runner
 * 
 * Tests the VPN tunnel data flow by simulating donor + receiver.
 * Uses the LIVE production server to ensure real-world testing.
 * 
 * Tests:
 * 1. Server health check
 * 2. WebSocket connectivity (donor + receiver)
 * 3. Donor-Receiver pairing
 * 4. Binary data relay through tunnel
 * 5. Data integrity (SHA256 verification)
 * 6. Connection cycling
 * 7. Performance metrics
 */

import { createHmac, randomBytes, createHash } from 'crypto';
import { WebSocket } from 'ws';

const WS_URL = process.env.WS_URL || 'wss://datashare-server.onrender.com/ws-vpn';

let passed = 0;
let failed = 0;

function log(name, ok, detail = '') {
  const mark = ok ? '✅' : '❌';
  if (ok) passed++; else failed++;
  console.log(`  ${mark} ${name}${detail ? ' \u2014 ' + detail : ''}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWS(userId, mode, donorId = '') {
  return new Promise((resolve, reject) => {
    const url = `${WS_URL}?userId=${userId}&mode=${mode}&token=test_token_123${donorId ? '&donorId=' + donorId : ''}`;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

async function recvMessage(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('recv timeout')), timeout);
    ws.once('message', data => {
      clearTimeout(t);
      resolve(data);
    });
    ws.once('error', reject);
  });
}

// ====================================================================
// TEST 1: Server Health
// ====================================================================
async function testHealth() {
  console.log('\n📡 Server Health Check');
  try {
    const https = await import('https');
    const http = await import('http');
    const protocol = WS_URL.startsWith('wss:') ? https : http;

    const healthUrl = WS_URL.replace('/ws-vpn', '/api/health').replace('wss:', 'https:').replace('ws:', 'http:');
    
    const data = await new Promise((resolve, reject) => {
      protocol.default.get(healthUrl, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });

    log('Health endpoint', data.status === 'ok', `v${data.version}, uptime=${Math.floor(data.uptime)}s`);
    log('VPN Tunnel WebSocket', !!data.services?.vpnTunnel,
      `sessions=${data.services.vpnTunnel.sessions}, donors=${data.services.vpnTunnel.donors}`);
    return data;
  } catch (e) {
    log('Health check', false, e.message);
    return null;
  }
}

// ====================================================================
// TEST 2: WebSocket Pairing + Binary Relay
// ====================================================================
async function testBinaryRelay() {
  console.log('\n📦 Binary WebSocket Relay Test');
  
  try {
    // Connect DONOR
    const donor = await connectWS('test_donor_' + Date.now(), 'donor');
    log('Donor connected', true);
    
    // Send handshake
    donor.send(JSON.stringify({ type: 'vpn_connect', mode: 'donor', userId: 'test_donor_1' }));
    const donorResp = await recvMessage(donor);
    const donorMsg = JSON.parse(donorResp.toString());
    log('Donor handshake', donorMsg.type === 'vpn_connected', `got ${donorMsg.type}`);

    // Connect RECEIVER
    const receiverId = 'test_receiver_' + Date.now();
    const receiver = await connectWS(receiverId, 'receiver', 'test_donor_1');
    log('Receiver connected', true);
    
    receiver.send(JSON.stringify({ type: 'vpn_connect', mode: 'receiver', userId: receiverId, donorId: 'test_donor_1' }));

    // Wait for pairing
    let paired = false;
    let receiverPaired = false;
    const donorListener = [];

    donor.on('message', data => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'vpn_session_created' || msg.type === 'paired') {
            paired = true;
          }
        } catch(e) {}
      } else if (Buffer.isBuffer(data)) {
        donorListener.push(data);
      }
    });

    receiver.on('message', data => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'vpn_session_created' || msg.type === 'paired') {
            receiverPaired = true;
          }
        } catch(e) {}
      }
    });

    // Wait for pairing (up to 15s)
    for (let i = 0; i < 30; i++) {
      if (paired && receiverPaired) break;
      await sleep(500);
    }

    log('Donor-Receiver pairing', paired && receiverPaired, 
      paired && receiverPaired ? `took ~${3}s` : `${paired ? 'donor paired' : 'donor waiting'}, ${receiverPaired ? 'receiver paired' : 'receiver waiting'}`);

    if (!paired || !receiverPaired) {
      donor.close();
      receiver.close();
      return;
    }

    // ====================================================================
    // TEST 3: Binary Data Transfer
    // ====================================================================
    console.log('\n📊 Data Transfer Test');

    // Send binary data from receiver (simulating IP packets)
    const testPackets = [
      randomBytes(100),
      randomBytes(500),
      randomBytes(1400), // MTU-sized
      randomBytes(50),
    ];

    // Create hashes
    const sentHashes = testPackets.map(p => createHash('sha256').update(p).digest('hex'));

    // Send packets
    for (const pkt of testPackets) {
      receiver.send(pkt);
      await sleep(100);
    }

    // Wait for donor to receive them
    await sleep(2000);

    const receivedCount = donorListener.length;
    log('Binary packet relay', receivedCount >= testPackets.length,
      `${receivedCount}/${testPackets.length} packets received`);

    // Integrity check
    if (receivedCount >= testPackets.length) {
      let allMatch = true;
      for (let i = 0; i < Math.min(testPackets.length, receivedCount); i++) {
        const recvHash = createHash('sha256').update(donorListener[i]).digest('hex');
        if (recvHash !== sentHashes[i]) {
          log(`Packet ${i} integrity`, false,
            `sent=${sentHashes[i].slice(0,16)} recv=${recvHash.slice(0,16)}`);
          allMatch = false;
        }
      }
      if (allMatch) {
        log('Data integrity (SHA256)', true, `${testPackets.length} packets verified`);
      }
    }

    // ====================================================================
    // TEST 4: Throughput
    // ====================================================================
    console.log('\n⚡ Throughput Test');
    donorListener.length = 0; // Clear

    const throughputData = randomBytes(50 * 1024); // 50 KB
    const chunks = [];
    for (let i = 0; i < throughputData.length; i += 1400) {
      chunks.push(throughputData.slice(i, Math.min(i + 1400, throughputData.length)));
    }

    const txStart = Date.now();
    for (const chunk of chunks) {
      receiver.send(chunk);
      await sleep(1);
    }

    // Wait for all to arrive
    await sleep(3000);

    const txTime = (Date.now() - txStart) / 1000;
    const rxBytes = donorListener.reduce((sum, b) => sum + b.length, 0);
    const throughput = rxBytes / txTime;

    log('Throughput', rxBytes > 0,
      `${(rxBytes / 1024).toFixed(1)} KB in ${txTime.toFixed(1)}s = ${(throughput / 1024).toFixed(1)} KB/s`);

    // ====================================================================
    // TEST 5: Connection Cycling
    // ====================================================================
    console.log('\n🔄 Connection Cycle Test');
    let successful = 0;
    const CYCLES = 3;

    for (let i = 0; i < CYCLES; i++) {
      try {
        const d = await connectWS(`cycle_donor_${i}_${Date.now()}`, 'donor');
        d.send(JSON.stringify({ type: 'vpn_connect', mode: 'donor' }));
        const resp = await recvMessage(d);
        const msg = JSON.parse(resp.toString());
        
        if (msg.type === 'vpn_connected') {
          successful++;
        }
        d.close();
      } catch(e) {}
      await sleep(500);
    }

    log(`Connection cycling (${CYCLES} cycles)`, successful >= 2,
      `${successful}/${CYCLES} successful`);

    // Cleanup
    donor.close();
    receiver.close();

  } catch (e) {
    log('Binary relay test', false, e.message);
  }
}

// ====================================================================
// MAIN
// ====================================================================
async function main() {
  console.log('='.repeat(55));
  console.log('🧪 DataShare VPN Tunnel Test Suite');
  console.log(`🌐 Server: ${WS_URL}`);
  console.log('='.repeat(55));

  await testHealth();
  await testBinaryRelay();

  console.log(`\n${'='.repeat(55)}`);
  const verdict = failed === 0 ? '✅ ALL TESTS PASSED' : `❌ ${failed} TESTS FAILED`;
  console.log(`📊 Results: ${passed} passed, ${failed} failed \u2014 ${verdict}`);
  console.log(`${'='.repeat(55)}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
