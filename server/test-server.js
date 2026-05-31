/**
 * DataShare Test Server — Lightweight version for testing
 * Only runs VPN tunnel WebSocket (no Supabase, no Headscale)
 */
const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: 'test' }));
});

// Import our vpn-tunnel service
const vpnTunnel = require('./src/services/vpn-tunnel.service');
vpnTunnel.initVpnTunnel(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Test server running on port ${PORT}`);
    console.log(`   WS: ws://localhost:${PORT}/ws-vpn`);
});
