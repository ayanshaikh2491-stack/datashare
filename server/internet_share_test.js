/**
 * OpenShare INTERNET SHARING test (no phone needed).
 *
 * Simulates the real sharing architecture on this PC:
 *   - "internet"        = local HTTP server (stands in for the real internet)
 *   - donor             = client with internet access (fetches via HTTP)
 *   - receiver          = client WITHOUT direct internet; gets everything
 *                         through the WebSocket tunnel
 *
 * Data path tested:  receiver -> tunnel -> relay -> donor -> internet -> donor -> tunnel -> relay -> receiver
 *
 * Proves: (1) donor & receiver connect, (2) session established,
 * (3) real HTTP traffic flows donor -> receiver through the tunnel,
 * (4) large file (512 KB) transfers intact (SHA-256 verified).
 *
 * Self-contained: starts its own relay + internet server, cleans up at the end.
 * Run: node internet_share_test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const RELAY_PORT = 8081;
const INTERNET_PORT = 9000;
const RELAY_URL = `ws://localhost:${RELAY_PORT}`;
const INTERNET_URL = `http://localhost:${INTERNET_PORT}`;

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

// ---------- 1. "Internet" server ----------
function startInternet() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/file')) {
      // Deterministic 512 KB pseudo-random file with SHA-256
      const size = 512 * 1024;
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) buf[i] = (i * 31 + 7) & 0xff;
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Sha256': sha });
      res.end(buf);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body><h1>INTERNET-WORKS</h1><p>url=${req.url}</p><p>time=${Date.now()}</p></body></html>`
      );
    }
  });
  return new Promise((resolve) => {
    server.listen(INTERNET_PORT, () => resolve(server));
  });
}

// ---------- 2. Relay server (production index.js) ----------
function startRelay() {
  const proc = spawn('node', [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(RELAY_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('relay did not start')), 4000);
    proc.stdout.once('data', () => {
      clearTimeout(t);
      resolve(proc);
    });
  });
}

// ---------- WebSocket client helper (Node 22+ native) ----------
function client(name, log = false) {
  const ws = new WebSocket(RELAY_URL);
  const state = { name, ws, received: [], waiters: [], connected: false, bytes: 0 };

  ws.addEventListener('open', () => {
    state.connected = true;
    state.onOpen?.();
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      msg = { type: 'RAW', data: String(e.data) };
    }
    if (log) console.log(`  [${name} GOT] ${JSON.stringify(msg).slice(0, 100)}`);
    const idx = state.waiters.findIndex((w) => w.match(msg));
    if (idx >= 0) {
      const [w] = state.waiters.splice(idx, 1);
      w.resolve(msg);
    } else {
      state.received.push(msg);
    }
  });
  ws.addEventListener('close', () => (state.connected = false));
  ws.addEventListener('error', () => {});

  state.send = (obj) => ws.send(JSON.stringify(obj));
  state.drain = () => (state.received = []);
  state.waitFor = (type, opts = {}) => {
    const matchFn = opts.match || ((m) => m.type === type);
    const timeoutMs = opts.timeoutMs || 8000;
    return new Promise((resolve, reject) => {
      for (let i = 0; i < state.received.length; i++) {
        if (matchFn(state.received[i])) {
          const m = state.received.splice(i, 1)[0];
          return resolve(m);
        }
      }
      const t = setTimeout(
        () => reject(new Error(`${name}: timeout waiting for ${type}`)),
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
  console.log(`\n=== OpenShare INTERNET SHARING Test ===`);
  console.log(`Relay: ${RELAY_URL}  |  Internet: ${INTERNET_URL}\n`);

  const internet = await startInternet();
  const relay = await startRelay();
  await sleep(200);

  try {
    // ---------- Setup: donor + receiver session ----------
    console.log('[1] Donor <-> Receiver connection');
    const donor = client('donor');
    donor.onOpen = () =>
      donor.send({
        type: 'DONOR_REGISTER',
        metadata: { name: 'Donor (WiFi)', network: 'WiFi', device: 'Windows' },
      });
    const reg = await donor.waitFor('DONOR_REGISTERED');
    const donorId = reg.donorId;
    check('donor registered', !!donorId);

    const receiver = client('receiver');
    receiver.onOpen = () => receiver.send({ type: 'REQUEST_DONORS' });
    const list = await receiver.waitFor('DONOR_LIST');
    const found = list.donors?.find((d) => d.id === donorId);
    check('receiver discovers donor', !!found);

    receiver.send({ type: 'SELECT_DONOR', donorId, receiverInfo: { name: 'Receiver', device: 'Windows' } });
    const [ds, rs] = await Promise.all([
      donor.waitFor('SESSION_START'),
      receiver.waitFor('SESSION_STARTED'),
    ]);
    check('session established on both sides', ds.sessionId === rs.sessionId);
    const sessionId = ds.sessionId;

    // ---------- Test A: Web page request through tunnel ----------
    console.log('\n[2] Webpage load through tunnel (donor internet -> receiver)');
    // Data path: receiver requests a page -> tunnel -> donor -> REAL HTTP fetch -> response back
    const donorPageWaiter = donor.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('PAGE:'),
      timeoutMs: 10000,
    });
    const pageWaiter = receiver.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('HTML:'),
      timeoutMs: 10000,
    });
    receiver.send({ type: 'TUNNEL_DATA', data: 'PAGE:http://localhost:9000/', sessionId });
    await donorPageWaiter;
    // Donor fetches the page from the "internet" (this is the sharing: donor's internet)
    const pageResp = await fetch(INTERNET_URL + '/');
    const pageHtml = await pageResp.text();
    donor.send({ type: 'TUNNEL_DATA', data: 'HTML:' + pageHtml, sessionId });
    const pageMsg = await pageWaiter;
    check('receiver got webpage content via tunnel', pageMsg.data?.includes('INTERNET-WORKS'), `got: ${String(pageMsg.data).slice(0, 80)}`);

    // ---------- Test B: 512 KB file transfer through tunnel ----------
    console.log('\n[3] 512 KB file transfer (donor internet -> receiver via tunnel)');
    // Register waiters FIRST, then send (never await before send - that deadlocks)
    const donorFileWaiter = donor.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('FILE:'),
      timeoutMs: 10000,
    });
    // Receiver collects chunks; waits for the FILE_DONE marker
    const shaWaiter = receiver.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('FILE_DONE:'),
      timeoutMs: 20000,
    });
    // Receiver requests the file through the tunnel
    receiver.send({ type: 'TUNNEL_DATA', data: 'FILE:http://localhost:9000/file', sessionId });
    await donorFileWaiter;
    // Donor fetches the file from the "internet"
    const fileResp = await fetch(INTERNET_URL + '/file');
    const fileBuf = Buffer.from(await fileResp.arrayBuffer());
    const fileSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
    // Donor streams it through the tunnel in 16 KB chunks
    const CHUNK = 16 * 1024;
    for (let i = 0; i < fileBuf.length; i += CHUNK) {
      const piece = fileBuf.subarray(i, Math.min(i + CHUNK, fileBuf.length));
      donor.send({
        type: 'TUNNEL_DATA',
        data: 'CHUNK:' + piece.toString('base64'),
        sessionId,
      });
      await sleep(1); // let relay flush
    }
    donor.send({ type: 'TUNNEL_DATA', data: `FILE_DONE:${fileBuf.length}:${fileSha256}`, sessionId });

    // Receiver reassembles: FILE_DONE was consumed by shaWaiter, chunks are queued
    const doneMsg = await shaWaiter;
    const [total, sha] = doneMsg.data.slice(10).split(':'); // 'FILE_DONE:' is 10 chars
    // Wait until all chunks have arrived (robust: poll until byte count matches)
    const deadline = Date.now() + 5000;
    let gotBytes = 0;
    while (Date.now() < deadline) {
      const chunks = receiver.received.filter(
        (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('CHUNK:')
      );
      gotBytes = chunks.reduce((n, m) => n + Buffer.from(m.data.slice(6), 'base64').length, 0);
      if (gotBytes >= Number(total)) break;
      await sleep(20);
    }
    const allChunks = receiver.received.filter(
      (m) => m.type === 'TUNNEL_DATA' && m.data?.startsWith('CHUNK:')
    );
    const fileData = Buffer.concat(allChunks.map((c) => Buffer.from(c.data.slice(6), 'base64')));
    check('file arrived at receiver', fileData.length === Number(total), `got ${fileData.length}, expected ${total}`);
    check('file checksum matches (data intact)', crypto.createHash('sha256').update(fileData).digest('hex') === sha, `got ${crypto.createHash('sha256').update(fileData).digest('hex')}`);

    // ---------- Test C: byte accounting (like Connected screen) ----------
    console.log('\n[4] Byte accounting');
    receiver.bytes = (pageMsg.data?.length || 0) + fileData.length;
    check('receiver transferred ' + (receiver.bytes / 1024).toFixed(1) + ' KB total', receiver.bytes > 0);

    // ---------- Test D: donor still shares after (session alive) ----------
    console.log('\n[5] Session still alive after transfers');
    donor.send({ type: 'TUNNEL_DATA', data: 'PING', sessionId });
    const ping = await receiver.waitFor('TUNNEL_DATA', {
      match: (m) => m.type === 'TUNNEL_DATA' && m.data === 'PING',
      timeoutMs: 5000,
    });
    check('tunnel still working after file transfer', ping.data === 'PING');

    donor.ws.close();
    receiver.ws.close();
  } finally {
    relay.kill();
    internet.closeAllConnections?.();
    internet.close();
  }

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
