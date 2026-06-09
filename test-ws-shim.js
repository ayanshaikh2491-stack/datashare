// Smoke test for the websocket.service.js shim fix
// Verifies that sendToUser() actually delivers to a connected WS client.
const WebSocket = require('ws');

const SERVER = 'ws://localhost:3000';
const DONOR_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJiY2FhYzMwNi05YTgwLTQ0ZjAtYjJjNC0xNDRkZTdjYjZhMWIiLCJwaG9uZSI6ImRvbm9yMUB0ZXN0LmxvY2FsIiwicm9sZSI6ImRvbm9yIiwiaWF0IjoxNzgwNjY0NDk3LCJleHAiOjE3ODEyNjkyOTd9.Jnw4h_-nbQ9BhOBd52VThGjrcEqH3JmrMkxr4x7Ri0s';
const DONOR_ID = 'bcaac306-9a80-48f0-b2c4-144de7cb6a1b';

let received = [];

const donorWs = new WebSocket(`${SERVER}?userId=${DONOR_ID}&role=donor`);

donorWs.on('open', () => {
  console.log('✅ Donor WS connected');
  setTimeout(async () => {
    console.log('→ Triggering sendToUser via POST /api/donor/online...');
    const r = await fetch('http://localhost:3000/api/donor/online', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DONOR_TOKEN}`
      },
      body: JSON.stringify({ lat: 0, lng: 0 })
    });
    console.log('   HTTP status:', r.status);
  }, 500);
});

donorWs.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 Donor received:', msg.type, msg.donor ? `(${msg.donor.status})` : '');
  received.push(msg.type);
});

donorWs.on('error', (e) => console.error('❌ WS error:', e.message));

setTimeout(() => {
  console.log('\n=== TEST RESULT ===');
  console.log('Messages received by donor:', received);
  if (received.length > 0) {
    console.log('✅ PASS — donor received WS messages from server');
  } else {
    console.log('❌ FAIL — donor received no messages');
  }
  donorWs.close();
  process.exit(received.length > 0 ? 0 : 1);
}, 3000);
