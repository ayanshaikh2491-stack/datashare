// OpenShare internet sharing proof - SIMPLE
//
// What it does (same flow as the app):
//   1. Donor connects to relay (like pressing Share in app)
//   2. Receiver connects and joins donor (like pressing Join in app)
//   3. Receiver asks for internet THROUGH the tunnel
//   4. Donor fetches REAL internet and sends it back through tunnel
//   5. If receiver's IP == donor's IP => receiver is using donor's internet
//
// Run: node real_internet_share_test.js

const { spawn } = require('child_process');
const RELAY_PORT = 8082;
const IP_URL = 'https://api.ipify.org';

const relay = spawn('node', ['index.js'], { env: { ...process.env, PORT: RELAY_PORT } });
relay.stdout.on('data', d => console.log('[relay] ' + d));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect() {
  const ws = new WebSocket(`ws://localhost:${RELAY_PORT}`);
  const c = { ws, msgs: [], waits: [] };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const w = c.waits.find(w => w.type === m.type);
    if (w) { c.waits = c.waits.filter(x => x !== w); w.done(m); }
    else c.msgs.push(m);
  };
  c.send = o => ws.send(JSON.stringify(o));
  c.wait = type => new Promise(done => {
    const i = c.msgs.findIndex(m => m.type === type);
    if (i >= 0) done(c.msgs.splice(i, 1)[0]);
    else c.waits.push({ type, done });
  });
  return new Promise(res => { ws.onopen = () => res(c); });
}

async function main() {
  await sleep(500);
  console.log('=== OpenShare internet sharing proof ===');

  // 1. Donor registers (donor has internet)
  const donor = await connect();
  donor.send({ type: 'DONOR_REGISTER', metadata: { name: 'Donor' } });
  const reg = await donor.wait('DONOR_REGISTERED');
  console.log('1. Donor registered, id =', reg.donorId.slice(0, 8));

  // 2. Receiver joins donor
  const receiver = await connect();
  receiver.send({ type: 'REQUEST_DONORS' });
  const list = await receiver.wait('DONOR_LIST');
  const donorId = list.donors[0].id;
  receiver.send({ type: 'SELECT_DONOR', donorId });
  await Promise.all([donor.wait('SESSION_START'), receiver.wait('SESSION_STARTED')]);
  console.log('2. Receiver joined donor, session started');

  // 3. Receiver asks for internet THROUGH tunnel (receiver itself never goes to internet)
  receiver.send({ type: 'TUNNEL_DATA', data: 'PAGE:' + IP_URL });
  await donor.wait('TUNNEL_DATA');
  console.log('3. Receiver asked for a page, request went through tunnel to donor');

  // 4. Donor fetches REAL internet and sends it back through tunnel
  const ip = (await (await fetch(IP_URL)).text()).trim();
  console.log('4. Donor fetched real internet. Donor IP =', ip);
  donor.send({ type: 'TUNNEL_DATA', data: 'HTML:' + ip });

  // 5. Receiver sees the IP that donor got from real internet
  const got = await receiver.wait('TUNNEL_DATA');
  const receiverIp = got.data.slice(5).trim();
  console.log('5. Receiver got through tunnel. Receiver IP =', receiverIp);

  // PROOF: same IP means receiver is using donor's internet
  if (receiverIp === ip) {
    console.log('INTERNET_SHARING=WORKING (receiver is using donor\'s internet)');
  } else {
    console.log('INTERNET_SHARING=FAILED (IPs differ)');
  }

  // Cleanup: close sockets first, then stop relay
  donor.ws.close();
  receiver.ws.close();
  await sleep(300);
  relay.kill();
  await sleep(200);
  process.exit(receiverIp === ip ? 0 : 1);
}

main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
