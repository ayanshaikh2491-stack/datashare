// Quick local relay TCP-forwarding test (no deps beyond relay's own ws).
// The relay only forwards TCP messages; the real donor app opens sockets.
// Here the "donor" client simulates that: on OPEN_TCP it replies TCP_READY,
// echoes any TCP_DATA, and acknowledges TCP_CLOSE.
const { spawn } = require('child_process');
const relay = spawn('node', ['index.js'], {
  env: { ...process.env, PORT: '8099' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
relay.stdout.on('data', (d) => console.log('[relay]', d.toString().trim()));
relay.stderr.on('data', (d) => console.error('[relay-err]', d.toString().trim()));

const URL = 'ws://localhost:8099';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

function ok(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (cond) passed++;
  else failed++;
}

(async () => {
  await sleep(800);
  const donor = new WebSocket(URL);
  const receiver = new WebSocket(URL);
  let tcpId = null;
  let donorListSeen = false;
  let sessionStarted = false;

  donor.onopen = () =>
    donor.send(
      JSON.stringify({ type: 'DONOR_REGISTER', metadata: { name: 'D' } })
    );

  donor.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'DONOR_REGISTERED') ok('donor registered', !!m.donorId);
    if (m.type === 'SESSION_START') {
      ok('donor got SESSION_START', !!m.sessionId);
    }
    if (m.type === 'OPEN_TCP') {
      ok('donor received OPEN_TCP', m.host === 'example.com' && m.port === 80);
      tcpId = m.tcpId;
      donor.send(JSON.stringify({ type: 'TCP_READY', tcpId: m.tcpId }));
    }
    if (m.type === 'TCP_DATA') {
      const txt = Buffer.from(m.data, 'base64').toString('utf8');
      ok('donor received request bytes', txt.startsWith('GET /'));
      // Simulate an internet response flowing back through the tunnel
      donor.send(
        JSON.stringify({
          type: 'TCP_DATA',
          tcpId: m.tcpId,
          data: Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\nExample Domain').toString('base64'),
        })
      );
    }
    if (m.type === 'TCP_CLOSE') {
      ok('donor got TCP_CLOSE', m.tcpId === tcpId);
      finish();
    }
  };

  receiver.onopen = async () => {
    // Let the donor register first (broadcast happens on registration)
    await sleep(400);
    receiver.send(JSON.stringify({ type: 'REQUEST_DONORS' }));
  };

  receiver.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'DONOR_LIST') {
      if (!donorListSeen) {
        donorListSeen = true;
        const d = (m.donors || [])[0];
        ok('receiver sees donor in list', !!d);
        if (d) {
          receiver.send(
            JSON.stringify({ type: 'SELECT_DONOR', donorId: d.id, receiverInfo: {} })
          );
        }
      }
    }
    if (m.type === 'SESSION_STARTED') {
      ok('session started on receiver', !!m.sessionId);
      if (!sessionStarted) {
        sessionStarted = true;
        receiver.send(
          JSON.stringify({
            type: 'OPEN_TCP',
            tcpId: 't1',
            host: 'example.com',
            port: 80,
          })
        );
      }
    }
    if (m.type === 'TCP_READY') {
      ok('receiver got TCP_READY', m.tcpId === 't1');
      receiver.send(
        JSON.stringify({
          type: 'TCP_DATA',
          tcpId: 't1',
          data: Buffer.from('GET / HTTP/1.0\r\n\r\n').toString('base64'),
        })
      );
    }
    if (m.type === 'TCP_DATA') {
      const body = Buffer.from(m.data, 'base64').toString('utf8');
      ok('receiver got response bytes via tunnel', body.includes('Example Domain'));
      receiver.send(JSON.stringify({ type: 'TCP_CLOSE', tcpId: 't1' }));
    }
  };

  function finish() {
    relay.kill();
    console.log(`\n=== Relay TCP test: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  setTimeout(() => {
    console.log('TIMEOUT waiting for relay TCP test');
    relay.kill();
    process.exit(1);
  }, 10000);
})();
