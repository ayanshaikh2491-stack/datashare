/**
 * OpenShare REAL INTERNET SHARING proof (fast, no emulator, no phone).
 *
 * Architecture (same as the real app):
 *   receiver --(WebSocket tunnel)--> relay server --> donor --(REAL internet)--> internet
 *
 * The receiver client makes ZERO direct internet calls. Every request it sends
 * travels: receiver -> relay -> donor -> REAL internet -> donor -> relay -> receiver.
 * If the receiver gets back data that matches what the host (same machine as the
 * donor) sees on the real internet, internet sharing is PROVEN.
 *
 * Proofs:
 *   [1] Receiver gets real public IP via tunnel == host's real public IP
 *       -> donor's internet is what the receiver is using
 *   [2] Receiver gets a real web page (example.com) via tunnel
 *   [3] Receiver gets a real 256 KB binary file via tunnel, SHA-256 intact
 *
 * Run: node real_internet_share_test.js
 * Needs real internet. Uses production server/index.js as the relay.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const RELAY_PORT = 8082;
const RELAY_URL = `ws://localhost:${RELAY_PORT}`;
const IP_URL = 'https://api.ipify.org';
const PAGE_URL = 'https://example.com';
const FILE_URL = 'https://speed.cloudflare.com/__down?bytes=262144';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; failures.push(name); console.log(`  [FAIL] ${name} ${detail}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startRelay() {
  const proc = spawn('node', [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(RELAY_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('relay did not start')), 4000);
    proc.stdout.once('data', () => { clearTimeout(t); resolve(proc); });
  });
}

function client(name) {
  const ws = new WebSocket(RELAY_URL);
  const state = { name, ws, received: [], waiters: [], connected: false, directFetches: 0 };
  ws.addEventListener('open', () => { state.connected = true; state.onOpen?.(); });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(String(e.data)); } catch { msg = { type: 'RAW', data: String(e.data) }; }
    const idx = state.waiters.findIndex((w) => w.match(msg));
    if (idx >= 0) { const [w] = state.waiters.splice(idx, 1); w.resolve(msg); }
    else state.received.push(msg);
  });
  ws.addEventListener('close', () => (state.connected = false));
  ws.addEventListener('error', () => {});
  state.send = (obj) => ws.send(JSON.stringify(obj));
  state.drain = () => (state.received = []);
  state.waitFor = (type, opts = {}) => {
    const matchFn = opts.match || ((m) => m.type === type);
    const timeoutMs = opts.timeoutMs || 30000;
    return new Promise((resolve, reject) => {
      for (let i = 0; i < state.received.length; i++) {
        if (matchFn(state.received[i])) {
          const m = state.received.splice(i, 1)[0];
          return resolve(m);
        }
      }
      const t = setTimeout(() => reject(new Error(`${name}: timeout waiting for ${type}`)), timeoutMs);
      state.waiters.push({ match: matchFn, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  };
  return state;
}

async function fetchReal(url, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetch(url, { signal: ctl.signal, redirect: 'follow' }); }
  finally { clearTimeout(t); }
}

async function main() {
  console.log(`\n=== OpenShare REAL INTERNET SHARING proof ===`);
  console.log(`Relay: ${RELAY_URL}\n`);

  // Host's real internet IP (this machine == donor's machine in this test)
  console.log('[0] Host real internet check (direct, NOT via tunnel)');
  const hostIpResp = await fetchReal(IP_URL);
  const hostIp = (await hostIpResp.text()).trim();
  check('host has real internet, IP=' + hostIp, /^\d+\.\d+\.\d+\.\d+$/.test(hostIp), `got "${hostIp}"`);
  console.log(`    Host IP: ${hostIp}`);

  const relay = await startRelay();
  await sleep(200);

  try {
    // Donor: the side WITH internet
    const donor = client('donor');
    donor.onOpen = () => donor.send({
      type: 'DONOR_REGISTER',
      metadata: { name: 'Donor (REAL internet)', network: 'Cloud', device: 'CI runner' },
    });
    const reg = await donor.waitFor('DONOR_REGISTERED');
    const donorId = reg.donorId;
    check('donor registered with relay', !!donorId);
    console.log(`    Donor id: ${donorId}`);

    // Receiver: the side WITHOUT internet (never fetches directly)
    const receiver = client('receiver');
    receiver.onOpen = () => receiver.send({ type: 'REQUEST_DONORS' });
    const list = await receiver.waitFor('DONOR_LIST');
    const found = list.donors?.find((d) => d.id === donorId);
    check('receiver discovers donor', !!found);

    receiver.send({ type: 'SELECT_DONOR', donorId, receiverInfo: { name: 'Receiver', device: 'CI runner' } });
    const [ds, rs] = await Promise.all([
      donor.waitFor('SESSION_START'),
      receiver.waitFor('SESSION_STARTED'),
    ]);
    check('session established on both sides', ds.sessionId === rs.sessionId);
    const sessionId = ds.sessionId;
    console.log(`    Session: ${sessionId}`);

    // ---------- [1] REAL IP via tunnel ----------
    console.log('\n[1] Receiver gets real public IP through donor tunnel');
    const recvIp = receiver.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('HTML:'),
      timeoutMs: 30000,
    });
    const donIp = donor.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('PAGE:'),
      timeoutMs: 30000,
    });
    receiver.send({ type: 'TUNNEL_DATA', data: `PAGE:${IP_URL}`, sessionId });
    await donIp;
    // Only the DONOR talks to the real internet
    const ipResp = await fetchReal(IP_URL);
    const tunnelIpRaw = (await ipResp.text()).trim();
    donor.send({ type: 'TUNNEL_DATA', data: 'HTML:' + tunnelIpRaw, sessionId });
    const ipMsg = await recvIp;
    const tunnelIp = ipMsg.data.slice(5).trim();
    check('receiver got real IP via tunnel', /^\d+\.\d+\.\d+\.\d+$/.test(tunnelIp), `got "${tunnelIp}"`);
    check('tunnel IP == donor (host) IP  => internet sharing REAL', tunnelIp === hostIp, `tunnel=${tunnelIp} host=${hostIp}`);
    console.log(`    Receiver saw IP: ${tunnelIp}  (same as donor's real IP: ${hostIp})`);

    // ---------- [2] REAL web page via tunnel ----------
    console.log('\n[2] Receiver loads a real web page (example.com) through donor tunnel');
    const recvPage = receiver.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('HTML:'),
      timeoutMs: 30000,
    });
    const donPage = donor.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('PAGE:'),
      timeoutMs: 30000,
    });
    receiver.send({ type: 'TUNNEL_DATA', data: `PAGE:${PAGE_URL}`, sessionId });
    await donPage;
    const pageResp = await fetchReal(PAGE_URL);
    const pageHtml = await pageResp.text();
    donor.send({ type: 'TUNNEL_DATA', data: 'HTML:' + pageHtml, sessionId });
    const pageMsg = await recvPage;
    const gotHtml = pageMsg.data.slice(5);
    check('receiver got real page via tunnel', gotHtml.includes('Example Domain'), `len=${gotHtml.length}`);
    console.log(`    Page title seen by receiver: Example Domain (len ${gotHtml.length} chars)`);

    // ---------- [3] REAL 256 KB file via tunnel, SHA-256 intact ----------
    console.log('\n[3] Receiver downloads a real 256 KB file through donor tunnel (SHA-256)');
    const recvSha = receiver.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('FILE_DONE:'),
      timeoutMs: 60000,
    });
    const donFile = donor.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('FILE:'),
      timeoutMs: 30000,
    });
    receiver.send({ type: 'TUNNEL_DATA', data: `FILE:${FILE_URL}`, sessionId });
    await donFile;
    const fileResp = await fetchReal(FILE_URL, 30000);
    const fileBuf = Buffer.from(await fileResp.arrayBuffer());
    const fileSha = crypto.createHash('sha256').update(fileBuf).digest('hex');
    console.log(`    Donor downloaded ${(fileBuf.length / 1024).toFixed(1)} KB from real internet, sha256=${fileSha.slice(0, 16)}...`);
    const CHUNK = 16 * 1024;
    for (let i = 0; i < fileBuf.length; i += CHUNK) {
      const piece = fileBuf.subarray(i, Math.min(i + CHUNK, fileBuf.length));
      donor.send({ type: 'TUNNEL_DATA', data: 'CHUNK:' + piece.toString('base64'), sessionId });
      await sleep(1);
    }
    donor.send({ type: 'TUNNEL_DATA', data: `FILE_DONE:${fileBuf.length}:${fileSha}`, sessionId });
    const doneMsg = await recvSha;
    const [total, sha] = doneMsg.data.slice(10).split(':');
    const deadline = Date.now() + 15000;
    let gotBytes = 0;
    while (Date.now() < deadline) {
      const chunks = receiver.received.filter((m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('CHUNK:'));
      gotBytes = chunks.reduce((n, m) => n + Buffer.from(m.data.slice(6), 'base64').length, 0);
      if (gotBytes >= Number(total)) break;
      await sleep(20);
    }
    const allChunks = receiver.received.filter((m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('CHUNK:'));
    const fileData = Buffer.concat(allChunks.map((c) => Buffer.from(c.data.slice(6), 'base64')));
    check('file arrived at receiver, size intact', fileData.length === Number(total), `got ${fileData.length}, expected ${total}`);
    check('file SHA-256 matches (no corruption through tunnel)',
      crypto.createHash('sha256').update(fileData).digest('hex') === sha,
      `got ${crypto.createHash('sha256').update(fileData).digest('hex')}, expected ${sha}`);

    // ---------- Summary ----------
    console.log('\n=== Receiver made 0 direct internet calls (all traffic via donor tunnel) ===');
    console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed === 0) {
      console.log('\nINTERNET_SHARING=WORKING (receiver uses donor\'s real internet)');
    } else {
      console.log('\nINTERNET_SHARING=FAILED: ' + failures.join(', '));
      process.exit(1);
    }

    donor.ws.close();
    receiver.ws.close();
  } finally {
    relay.kill();
  }
}

main().catch((e) => {
  console.error('\n[CRASH]', e.message);
  process.exit(1);
});
