// Test OpenShare relay WebSocket server
const WebSocket = require('ws');

const URL = 'wss://ayanshaikh2-datashare-relay.hf.space';

async function test() {
  console.log(`[TEST] Connecting to ${URL}...`);
  const ws = new WebSocket(URL);
  
  const timeout = setTimeout(() => {
    console.log('[TEST] TIMEOUT - no response in 15s');
    process.exit(1);
  }, 15000);

  ws.on('open', () => {
    console.log('[TEST] ✅ WebSocket connected!');
    // Test 1: Register as donor
    ws.send(JSON.stringify({
      type: 'DONOR_REGISTER',
      metadata: { name: 'Test Donor', network: 'test' }
    }));
    console.log('[TEST] Sent DONOR_REGISTER');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log(`[TEST] Received: ${JSON.stringify(msg)}`);
    if (msg.type === 'DONOR_REGISTERED') {
      console.log(`[TEST] ✅ Donor registered with ID: ${msg.donorId}`);
      // Test 2: Request donors as receiver
      ws.send(JSON.stringify({ type: 'REQUEST_DONORS' }));
      console.log('[TEST] Sent REQUEST_DONORS');
    }
    if (msg.type === 'DONOR_LIST') {
      console.log(`[TEST] ✅ Got donor list: ${JSON.stringify(msg.donors)}`);
      clearTimeout(timeout);
      console.log('[TEST] 🎉 ALL TESTS PASSED - server works!');
      ws.close();
      process.exit(0);
    }
  });

  ws.on('error', (err) => {
    console.log(`[TEST] ❌ WebSocket error: ${err.message}`);
    clearTimeout(timeout);
    process.exit(1);
  });

  ws.on('close', () => {
    console.log('[TEST] Connection closed');
    clearTimeout(timeout);
  });
}

test();
