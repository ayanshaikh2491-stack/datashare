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
 */
function initVpnTunnel(server) {
    const vpnWss = new WebSocketServer({ 
        server, 
        path: '/ws-vpn',
        maxPayload: 1024 * 1024 // 1MB max packet
    });

    logger.info('VPN WebSocket server initialized on /ws-vpn');

    vpnWss.on('connection', (ws, req) => {
        const params = new URLSearchParams(req.url.split('?')[1]);
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

        ws.on('message', (data) => {
            userStats.get(userId)?.lastSeen = Date.now();

            // Handle text messages (JSON)
            if (typeof data === 'string') {
                try {
                    const msg = JSON.parse(data);
                    handleTextMessage(ws, client, msg);
                    return;
                } catch (e) {
                    logger.warn(`Invalid JSON from ${userId}: ${e.message}`);
                }
            }

            // Handle binary messages (IP packets)
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
    });

    return vpnWss;
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
        // Donor → Receiver (NAT response)
        session.receiver.ws.send(data);
        session.receiver.bytesReceived += data.length;
    }

    // Update stats
    if (userStats.has(client.userId)) {
        userStats.get(client.userId).bytesSent += data.length;
    }
}

/**
 * Handle donor connection
 */
function handleDonorConnect(client) {
    activeDonors.set(client.userId, client);
    logger.info(`Donor online: ${client.userId}`);

    // Check if any pending receiver wants this donor
    if (client.donorId) {
        const receiver = pendingReceivers.get(client.donorId);
        if (receiver) {
            createSession(client, receiver);
        }
    }

    // Notify pending receivers that donor is online
    for (const [id, receiver] of pendingReceivers) {
        receiver.ws.send(JSON.stringify({
            type: 'donor_online',
            donorId: client.userId
        }));
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
    vpnSessions,
    activeDonors,
    pendingReceivers
};
