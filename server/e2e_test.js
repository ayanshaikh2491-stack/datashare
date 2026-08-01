/**
 * OpenShare Relay - End-to-end transfer test (no phone needed).
 * Runs entirely on this PC: 1 relay server + 2 simulated clients (donor & receiver).
 * Uses Node's built-in WebSocket client (no extra downloads).
 *
 * Run: node e2e_test.js [ws://localhost:8080]
 */
const URL = process.argv[2] || 'ws://localhost:8080';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name} ${detail}`);
  }
}

function client(name) {
  const ws = new WebSocket(URL);
  const state = {
    name,
    ws,
    received: [],
    connected: false,
    waiters: [],
  };

  ws.addEventListener('open', () => {
    state.connected = true;
    state.onOpen?.();
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      msg = { type: 'RAW', data: e.data };
    }
    // Wake a matching waiter first, otherwise queue the message
    const idx = state.waiters.findIndex((w) => w.match(msg));
    if (idx >= 0) {
      const [w] = state.waiters.splice(idx, 1);
      w.resolve(msg);
    } else {
      state.received.push(msg);
    }
  });

  ws.addEventListener('close', () => {
    state.connected = false;
    state.onClose?.();
  });
  ws.addEventListener('error', (e) => {
    state.onError?.(e);
  });

  state.send = (obj) => ws.send(JSON.stringify(obj));
  state.drain = () => { state.received = []; };
  state.waitFor = (type, opts = {}) => {
    const matchFn = opts.match || ((m) => m.type === type);
    const timeoutMs = opts.timeoutMs || 3000;
    return new Promise((resolve, reject) => {
      // Check queued messages first (consume from front)
      for (let i = 0; i < state.received.length; i++) {
        if (matchFn(state.received[i])) {
          const m = state.received.splice(i, 1)[0];
          return resolve(m);
        }
      }
      const t = setTimeout(
        () => reject(new Error(`${state.name}: timeout waiting for ${type}`)),
        timeoutMs
      );
      state.waiters.push({
        match: matchFn,
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
    });
  };

  return state;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n=== OpenShare Relay E2E Test ===`);
  console.log(`Server: ${URL}\n`);

  // ---------- Test 1: Donor registration ----------
  console.log('[1] Donor registration');
  const donor = client('donor');
  donor.onOpen = () => donor.send({ type: 'DONOR_REGISTER', metadata: { name: 'Test Donor', network: 'WiFi', device: 'Windows' } });
  const reg = await donor.waitFor('DONOR_REGISTERED');
  check('donor receives DONOR_REGISTERED', !!reg.donorId, `got: ${JSON.stringify(reg)}`);
  const donorId = reg.donorId;

  // ---------- Test 2: Receiver finds donor via DONOR_LIST ----------
  console.log('\n[2] Receiver discovery');
  const receiver = client('receiver');
  receiver.onOpen = () => receiver.send({ type: 'REQUEST_DONORS' });
  const list = await receiver.waitFor('DONOR_LIST');
  const found = list.donors?.find((d) => d.id === donorId);
  check('receiver sees donor in DONOR_LIST', !!found, `donors: ${JSON.stringify(list.donors)}`);
  check('donor metadata relayed', found?.name === 'Test Donor' && found?.network === 'WiFi');

  // ---------- Test 3: Session establishment ----------
  console.log('\n[3] Session start');
  receiver.send({ type: 'SELECT_DONOR', donorId, receiverInfo: { name: 'Test Receiver', device: 'Windows' } });
  const [donorStart, receiverStarted] = await Promise.all([
    donor.waitFor('SESSION_START'),
    receiver.waitFor('SESSION_STARTED'),
  ]);
  check('donor gets SESSION_START', !!donorStart.sessionId, JSON.stringify(donorStart));
  check('receiver gets SESSION_STARTED', !!receiverStarted.sessionId, JSON.stringify(receiverStarted));
  check('same sessionId on both sides', donorStart.sessionId === receiverStarted.sessionId);
  const sessionId = donorStart.sessionId;

  // ---------- Test 4: TUNNEL_DATA donor -> receiver ----------
  console.log('\n[4] Tunnel data (donor -> receiver)');
  const payload1 = 'hello-receiver-' + Math.random().toString(36).slice(2);
  donor.send({ type: 'TUNNEL_DATA', data: payload1, sessionId });
  const got1 = await receiver.waitFor('TUNNEL_DATA');
  check('receiver got relayed data', got1.data === payload1, `got: ${got1.data}`);

  // ---------- Test 5: TUNNEL_DATA receiver -> donor ----------
  console.log('\n[5] Tunnel data (receiver -> donor)');
  const payload2 = 'hello-donor-' + Math.random().toString(36).slice(2);
  receiver.send({ type: 'TUNNEL_DATA', data: payload2, sessionId });
  const got2 = await donor.waitFor('TUNNEL_DATA');
  check('donor got relayed data', got2.data === payload2, `got: ${got2.data}`);

  // ---------- Test 6: Donor appears busy while in session ----------
  console.log('\n[6] Busy donor rejection');
  const intruder = client('intruder');
  intruder.onOpen = () => {
    intruder.send({ type: 'REQUEST_DONORS' });
    setTimeout(() => intruder.send({ type: 'SELECT_DONOR', donorId }), 100);
  };
  const busy = await intruder.waitFor('ERROR', { match: (m) => m.type === 'ERROR' && m.message === 'Donor busy' });
  check('busy donor rejected with ERROR', busy.message === 'Donor busy', `got: ${busy.message}`);
  intruder.drain();

  // ---------- Test 7: SESSION_END cleans up ----------
  console.log('\n[7] Session end');
  receiver.send({ type: 'SESSION_END', sessionId });
  const [rEnd, dEnd] = await Promise.all([
    receiver.waitFor('SESSION_END'),
    donor.waitFor('SESSION_END'),
  ]);
  check('receiver gets SESSION_END', rEnd.sessionId === sessionId);
  check('donor gets SESSION_END', dEnd.sessionId === sessionId);

  await sleep(100);
  intruder.drain();
  intruder.send({ type: 'REQUEST_DONORS' });
  const list2 = await intruder.waitFor('DONOR_LIST', {
    match: (m) => m.type === 'DONOR_LIST' && m.donors?.some((d) => d.id === donorId),
    timeoutMs: 2000,
  });
  const available = list2.donors?.some((d) => d.id === donorId);
  check('donor available again after session end', available === true);

  // ---------- Test 8: Invalid JSON handling ----------
  console.log('\n[8] Invalid input handling');
  intruder.drain();
  intruder.ws.send('this is not json');
  const err = await intruder.waitFor('ERROR', { match: (m) => m.type === 'ERROR' && m.message === 'Invalid JSON' });
  check('invalid JSON gets ERROR', err.message === 'Invalid JSON', `got: ${err.message}`);

  // ---------- Test 9: Donor disconnect cleanup ----------
  console.log('\n[9] Donor disconnect cleanup');
  donor.ws.close();
  await sleep(150);
  intruder.drain();
  intruder.send({ type: 'REQUEST_DONORS' });
  const list3 = await intruder.waitFor('DONOR_LIST', {
    match: (m) => m.type === 'DONOR_LIST' && !m.donors?.some((d) => d.id === donorId),
    timeoutMs: 2000,
  });
  const gone = !list3.donors?.some((d) => d.id === donorId);
  check('donor removed from DONOR_LIST after disconnect', gone, JSON.stringify(list3.donors));

  // ---------- Test 10: Unknown donor ----------
  console.log('\n[10] Unknown donor');
  intruder.drain();
  intruder.send({ type: 'SELECT_DONOR', donorId: 'nonexistent-id' });
  const unknown = await intruder.waitFor('ERROR', { match: (m) => m.type === 'ERROR' && m.message === 'Donor not found' });
  check('unknown donor rejected with ERROR', unknown.message === 'Donor not found', `got: ${unknown.message}`);

  intruder.ws.close();
  receiver.ws.close();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('Failures:', failures.join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n❌ Test crashed:', e.message);
  process.exit(1);
});
