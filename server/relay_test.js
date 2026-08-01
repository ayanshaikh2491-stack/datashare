// Relay server test: health endpoint, heartbeat, stale cleanup, session flow.
// Run: node server/relay_test.js
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');

const PORT = 8090;
const HEARTBEAT_MS = 400;
const HB_TIMEOUT_MS = 200;
const WAIT_MS = 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, label) {
  if (cond) { console.log('PASS:', label); }
  else { console.error('FAIL:', label); process.exitCode = 1; }
}

function connect() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], waits: [] };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const w = c.waits.find(x => x.type === m.type);
    if (w) { c.waits = c.waits.filter(x => x !== w); w.done(m); }
    else c.msgs.push(m);
  };
  c.send = o => ws.send(JSON.stringify(o));
  // Bounded wait: fail fast if the server misbehaves instead of hanging.
  c.wait = (type, timeoutMs = WAIT_MS) => new Promise((done, fail) => {
    const i = c.msgs.findIndex(m => m.type === type);
    if (i >= 0) return done(c.msgs.splice(i, 1)[0]);
    const timer = setTimeout(() => fail(new Error(`timeout waiting for ${type}`)), timeoutMs);
    c.waits.push({ type, done: m => { clearTimeout(timer); done(m); } });
  });
  return new Promise(res => { ws.onopen = () => res(c); });
}

// Raw TCP socket that completes the WebSocket handshake but never answers
// pings: lets the test exercise the heartbeat timeout (silent termination).
function silentClient() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.createConnection(PORT, '127.0.0.1');
    sock.on('connect', () => {
      sock.write(
        `GET / HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    sock.on('error', reject);
    // The socket stays in paused mode until a data listener (or resume())
    // is attached; without it, TCP FIN from the server's terminate() never
    // surfaces as 'close'. resume() keeps the stream flowing so the
    // heartbeat-termination assertion can observe the disconnect.
    sock.resume();
    setTimeout(() => resolve(sock), 200); // give the handshake time to finish
  });
}

let relay;
async function main() {
  relay = spawn('node', ['index.js'], {
    cwd: __dirname, // runnable from anywhere, not just server/
    env: {
      ...process.env,
      PORT: String(PORT),
      HEARTBEAT_INTERVAL_MS: String(HEARTBEAT_MS),
      HEARTBEAT_TIMEOUT_MS: String(HB_TIMEOUT_MS),
    },
  });
  relay.stdout.on('data', d => process.stdout.write('[relay] ' + d));
  await sleep(800);

  // 1. Health endpoint (for keep-alive pinger)
  const health = await fetch(`http://localhost:${PORT}/`);
  assert(health.status === 200, 'GET / returns 200 (pinger health endpoint)');

  // 2. Session flow: donor registers, receiver joins
  const donor = await connect();
  donor.send({ type: 'DONOR_REGISTER', metadata: { name: 'Donor' } });
  await donor.wait('DONOR_REGISTERED');
  const receiver = await connect();
  receiver.send({ type: 'REQUEST_DONORS' });
  const list = await receiver.wait('DONOR_LIST');
  assert(list.donors.length === 1, 'donor appears in DONOR_LIST');
  receiver.send({ type: 'SELECT_DONOR', donorId: list.donors[0].id });
  await Promise.all([donor.wait('SESSION_START'), receiver.wait('SESSION_STARTED')]);
  assert(true, 'session starts between donor and receiver');

  // 3. Heartbeat keeps a healthy donor alive across several intervals.
  // The donor is hidden from DONOR_LIST while its session is active, so
  // liveness is proven by routing TUNNEL_DATA through the live session.
  await sleep(HEARTBEAT_MS * 5);
  donor.send({ type: 'TUNNEL_DATA', data: 'hb-probe' });
  const echo = await receiver.wait('TUNNEL_DATA');
  assert(echo.data === 'hb-probe', 'healthy donor survives heartbeat intervals (session still routes data)');

  // 3b. Heartbeat timeout: a silent client (no pong) is terminated.
  const silent = await silentClient();
  await Promise.race([
    new Promise(res => silent.once('close', res)),
    new Promise((_, fail) =>
      setTimeout(() => fail(new Error('silent client was not terminated by heartbeat timeout')),
        HEARTBEAT_MS + HB_TIMEOUT_MS + 1000)),
  ]);
  assert(true, 'silent client terminated by heartbeat timeout');

  // 4. Disconnect is cleaned up (donor list empty, session ended).
  // close() exercises the server 'close' cleanup path; Node's built-in
  // WebSocket client has no terminate().
  receiver.msgs.length = 0; // flush stale broadcasts BEFORE closing the donor
  const deadWs = donor.ws;
  deadWs.close();
  await sleep(600);
  receiver.send({ type: 'REQUEST_DONORS' });
  const list3 = await receiver.wait('DONOR_LIST');
  assert(list3.donors.length === 0, 'dead donor removed after disconnect');
  await receiver.wait('SESSION_END');
  assert(true, 'receiver notified SESSION_END after donor vanished');

  donor.ws.close();
  receiver.ws.close();
  relay.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch(e => {
  console.error('ERROR', e.message);
  if (relay) relay.kill();
  process.exit(1);
});
