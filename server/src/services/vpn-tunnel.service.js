/**
 * VPN Tunnel WebSocket Handler
 * 
 * Handles VPN tunnel connections between Donor and Receiver.
 * Routes IP packets between them through the server relay.
 * 
 * Protocol:
 * 1. Receiver connects → waits for donor
 * 2. Donor connects → paired with receiver
 * 3. Server relays binary packets between them
 * 4. Tracks MB usage in real-time
 */

const { WebSocketServer } = require('ws');
const logger = require('../utils/logger');

// Active VPN sessions: sessionId -> { donor, receiver }
const vpnSessions = new Map();

// Pending receivers waiting for donor: userId -> { ws, userId, token }
const pendingReceivers = new Map();

// Connected donors: userId -> { ws, userId, token }
const activeDonors = new Map();

// User stats tracking
const userStats = new Map();

/**
 * Initialize VPN WebSocket server on existing HTTP server
 * Handles BOTH:
 *   /ws-vpn    — Native Android VPN app
 *   /          — Web frontend (general WebSocket)
 */
function initVpnTunnel(server) {
    const vpnWss = new WebSocketServer({ 
        server,
        maxPayload: 1024 * 1024 // 1MB max packet
    });

    logger.info('WebSocket server initialized (handles /ws-vpn, /ws, and /)');

    vpnWss.on('connection', (ws, req) => {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        const params = url.searchParams;

        // Route based on path
        if (path === '/ws-vpn' || path.startsWith('/ws-vpn?')) {
            handleVpnConnection(ws, params);
        } else if (path === '/ws' || path === '/') {
            handleGeneralConnection(ws, params);
        } else {
            ws.close(1008, 'Unknown path');
        }
    });

    return vpnWss;
}

/**
 * Handle VPN tunnel connection (from native Android app)
 */
function handleVpnConnection(ws, params) {
    const userId = params.get('userId');
    const token = params.get('token');
    const mode = params.get('mode'); // 'donor' or 'receiver'
    const donorId = params.get('donorId');

    if (!userId || !token) {
        ws.close(1008, 'Missing userId or token');
        return;
    }

    logger.info(`VPN connection: ${userId} mode=${mode}`);

    const client = {
        ws,
        userId,
        token,
        mode,
        donorId,
        bytesSent: 0,
        bytesReceived: 0,
        connectedAt: Date.now()
    };

    // Initialize stats
    userStats.set(userId, { bytesSent: 0, bytesReceived: 0, lastSeen: Date.now() });

    ws.on('message', (data, isBinary) => {
        const stats = userStats.get(userId);
        if (stats) stats.lastSeen = Date.now();

        let textData = null;
        if (typeof data === 'string') {
            textData = data;
        } else if (Buffer.isBuffer(data)) {
            try {
                const str = data.toString('utf8');
                if (str.startsWith('{') || str.startsWith('[')) {
                    textData = str;
                }
            } catch (e) {}
        }

        if (textData) {
            try {
                const msg = JSON.parse(textData);
                handleTextMessage(ws, client, msg);
                return;
            } catch (e) {}
        }

        if (Buffer.isBuffer(data)) {
            handleBinaryPacket(ws, client, data);
        }
    });

    ws.on('close', () => {
        handleDisconnect(client);
    });

    ws.on('error', (err) => {
        logger.error(`VPN WebSocket error for ${userId}: ${err.message}`);
    });

    // Route to donor or receiver handler
    if (mode === 'donor') {
        handleDonorConnect(client);
    } else {
        handleReceiverConnect(client);
    }
}

/**
 * Handle general WebSocket connection (from web frontend)
 */
function handleGeneralConnection(ws, params) {
    const userId = params.get('userId') || 'anonymous';
    const role = params.get('role') || 'unknown';

    logger.info(`Web connection: ${userId} role=${role}`);

    // Store in general clients map
    if (!generalClients.has(userId)) {
        generalClients.set(userId, new Set());
    }
    generalClients.get(userId).add(ws);

    if (role === 'donor') {
        generalDonors.set(userId, ws);
    } else if (role === 'receiver') {
        generalReceivers.set(userId, ws);
    }

    // Send connected response
    ws.send(JSON.stringify({ type: 'connected', userId, timestamp: Date.now() }));

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleGeneralMessage(userId, role, message, ws);
        } catch (err) {
            logger.error('Web message parse error:', err.message);
        }
    });

    ws.on('close', () => {
        const userClients = generalClients.get(userId);
        if (userClients) {
            userClients.delete(ws);
            if (userClients.size === 0) generalClients.delete(userId);
        }
        generalDonors.delete(userId);
        generalReceivers.delete(userId);
        logger.info(`Web disconnected: ${userId}`);
    });

    ws.on('error', (err) => {
        logger.error(`Web error for ${userId}: ${err.message}`);
    });
}

// General WebSocket state (merged from websocket.service.js)
const generalClients = new Map();
const generalDonors = new Map();
const generalReceivers = new Map();

function handleGeneralMessage(userId, role, message, ws) {
    const { type, data } = message;

    switch (type) {
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        case 'donor_accepted':
            sendToGeneralUser(data.receiverId, {
                type: 'donor_accepted',
                donorId: userId,
                config: data.config
            });
            break;
        case 'donor_rejected':
            sendToGeneralUser(data.receiverId, {
                type: 'donor_rejected',
                donorId: userId,
                reason: data.reason
            });
            break;
        case 'disconnect':
            logger.info(`Disconnect requested by ${userId}`);
            break;
        default:
            logger.warn(`Unknown message type: ${type} from ${userId}`);
    }
}

function sendToGeneralUser(userId, message) {
    const userClients = generalClients.get(userId);
    if (!userClients || userClients.size === 0) {
        logger.warn(`No WebSocket clients for user: ${userId}`);
        return false;
    }
    const data = JSON.stringify(message);
    let sent = 0;
    userClients.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(data);
            sent++;
        }
    });
    return sent > 0;
}

function broadcastToGeneralDonors(message) {
    const data = JSON.stringify(message);
    generalDonors.forEach((ws, donorId) => {
        if (ws.readyState === 1) ws.send(data);
    });
}

function broadcastToGeneralReceivers(message) {
    const data = JSON.stringify(message);
    generalReceivers.forEach((ws, receiverId) => {
        if (ws.readyState === 1) ws.send(data);
    });
}

function getGeneralOnlineCount() {
    return {
        total: generalClients.size,
        donors: generalDonors.size,
        receivers: generalReceivers.size
    };
}

/**
 * Handle text messages (JSON protocol messages)
 */
function handleTextMessage(ws, client, msg) {
    const { type } = msg;

    switch (type) {
        case 'vpn_connect':
            logger.info(`${client.userId} (${client.mode}) VPN connect request`);
            ws.send(JSON.stringify({
                type: 'vpn_connected',
                message: 'VPN tunnel ready'
            }));
            break;

        case 'vpn_disconnect':
            logger.info(`${client.userId} VPN disconnect request`);
            handleDisconnect(client);
            ws.send(JSON.stringify({
                type: 'vpn_disconnected',
                message: 'VPN tunnel closed'
            }));
            break;

        case 'vpn_packet':
            // Base64-encoded packet
            if (msg.packet) {
                const packet = Buffer.from(msg.packet, 'base64');
                handleBinaryPacket(ws, client, packet);
            }
            break;

        case 'new_connection':
        case 'tcp_connect':
            // TCP connection request — relay to peer
            relayToPeer(client, JSON.stringify(msg));
            break;

        case 'connection_established':
            // TCP connection established — relay to receiver
            relayToPeer(client, JSON.stringify(msg));
            break;

        case 'tcp_data':
            // TCP data — relay to peer
            relayToPeer(client, JSON.stringify(msg));
            break;

        case 'tcp_close':
        case 'connection_closed':
            // TCP connection close — relay to peer
            relayToPeer(client, JSON.stringify(msg));
            break;

        default:
            logger.debug(`Unknown VPN message type: ${type}`);
    }
}

/**
 * Handle binary IP packets - route to peer
 */
function handleBinaryPacket(ws, client, data) {
    client.bytesSent += data.length;

    // Find the session this client is in
    let session = null;
    for (const [id, s] of vpnSessions) {
        if (s.donor?.userId === client.userId || s.receiver?.userId === client.userId) {
            session = s;
            break;
        }
    }

    if (!session) {
        // No session yet, drop packet
        return;
    }

    // Route packet to peer
    if (client.mode === 'receiver' && session.donor) {
        // Receiver → Donor
        session.donor.ws.send(data);
        session.donor.bytesReceived += data.length;
    } else if (client.mode === 'donor' && session.receiver) {
        // Donor → Receiver
        session.receiver.ws.send(data);
        session.receiver.bytesReceived += data.length;
    }

    // Update stats
    const stats = userStats.get(client.userId);
    if (stats) {
        stats.bytesSent += data.length;
    }
}

/**
 * Relay a text message to the connected peer
 */
function relayToPeer(client, message) {
    let session = null;
    for (const [id, s] of vpnSessions) {
        if (s.donor?.userId === client.userId || s.receiver?.userId === client.userId) {
            session = s;
            break;
        }
    }

    if (!session) return;

    const peer = session.donor?.userId === client.userId ? session.receiver : session.donor;
    if (peer) {
        peer.ws.send(message);
    }
}

/**
 * Handle donor connection
 */
function handleDonorConnect(client) {
    activeDonors.set(client.userId, client);
    logger.info(`Donor online: ${client.userId}`);

    // Check if any pending receiver was waiting for THIS specific donor
    let matched = false;
    for (const [recvId, receiver] of pendingReceivers) {
        if (receiver.donorId === client.userId) {
            logger.info(`Found matching receiver for donor ${client.userId}: ${recvId}`);
            createSession(client, receiver);
            matched = true;
            break;
        }
    }

    if (!matched) {
        // No one was specifically waiting for this donor — notify all pending
        logger.info(`No specific match for donor ${client.userId}, notifying ${pendingReceivers.size} pending receivers`);
        for (const [id, receiver] of pendingReceivers) {
            try {
                receiver.ws.send(JSON.stringify({
                    type: 'donor_online',
                    donorId: client.userId
                }));
            } catch (e) {
                logger.warn(`Failed to notify receiver ${id}: ${e.message}`);
            }
        }
    }
}

/**
 * Handle receiver connection
 */
function handleReceiverConnect(client) {
    if (client.donorId) {
        // Check if donor is already online
        const donor = activeDonors.get(client.donorId);
        if (donor) {
            createSession(donor, client);
            return;
        }
    }

    // No donor available, add to pending queue
    pendingReceivers.set(client.userId, client);
    logger.info(`Receiver waiting: ${client.userId} (target donor: ${client.donorId || 'any'})`);

    client.ws.send(JSON.stringify({
        type: 'waiting_for_donor',
        message: 'Waiting for donor to come online'
    }));
}

/**
 * Create a VPN session between donor and receiver
 */
function createSession(donor, receiver) {
    const sessionId = `vpn_${donor.userId}_${receiver.userId}_${Date.now()}`;

    const session = {
        id: sessionId,
        donor,
        receiver,
        createdAt: Date.now(),
        bytesTotal: 0
    };

    vpnSessions.set(sessionId, session);

    // Remove from pending
    pendingReceivers.delete(receiver.userId);

    logger.info(`VPN session created: ${sessionId}`);

    // Notify both parties
    donor.ws.send(JSON.stringify({
        type: 'vpn_session_created',
        sessionId,
        peerId: receiver.userId
    }));

    receiver.ws.send(JSON.stringify({
        type: 'vpn_session_created',
        sessionId,
        peerId: donor.userId
    }));

    // Update database with connection
    updateDatabase(session);
}

/**
 * Handle client disconnect
 */
function handleDisconnect(client) {
    logger.info(`VPN disconnect: ${client.userId} (${client.mode})`);

    // Remove from active donors
    activeDonors.delete(client.userId);

    // Remove from pending receivers
    pendingReceivers.delete(client.userId);

    // Remove from sessions
    for (const [id, session] of vpnSessions) {
        if (session.donor?.userId === client.userId || session.receiver?.userId === client.userId) {
            // Notify peer
            const peer = session.donor?.userId === client.userId ? session.receiver : session.donor;
            if (peer) {
                peer.ws.send(JSON.stringify({
                    type: 'peer_disconnected',
                    message: `${client.mode} disconnected`
                }));
            }
            vpnSessions.delete(id);
            logger.info(`VPN session closed: ${id}`);
            break;
        }
    }
}

/**
 * Update database with session stats
 */
async function updateDatabase(session) {
    try {
        const { supabase } = require('../services/supabase.service');

        await supabase.from('transfers').insert({
            donor_id: session.donor.userId,
            receiver_id: session.receiver.userId,
            status: 'active',
            data_transferred_mb: 0,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        logger.error(`Database update failed: ${err.message}`);
    }
}

/**
 * Get VPN stats for monitoring
 */
function getVpnStats() {
    const stats = {
        activeSessions: vpnSessions.size,
        activeDonors: activeDonors.size,
        pendingReceivers: pendingReceivers.size,
        sessions: []
    };

    for (const [id, session] of vpnSessions) {
        stats.sessions.push({
            id,
            donor: session.donor.userId,
            receiver: session.receiver.userId,
            donorBytes: session.donor.bytesReceived,
            receiverBytes: session.receiver.bytesSent,
            duration: Date.now() - session.createdAt
        });
    }

    return stats;
}

module.exports = {
    initVpnTunnel,
    getVpnStats,
    getGeneralOnlineCount,
    sendToGeneralUser,
    broadcastToGeneralDonors,
    broadcastToGeneralReceivers,
    // Expose the live client Maps so other modules (e.g. the
    // websocket.service.js shim) can read/write the same state that
    // handleGeneralConnection populates.
    generalClients,
    generalDonors,
    generalReceivers,
    vpnSessions,
    activeDonors,
    pendingReceivers
};
