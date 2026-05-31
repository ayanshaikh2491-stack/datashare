const WebSocket = require('ws');
const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // userId -> Set of connections
    this.donorClients = new Map(); // donorId -> client
    this.receiverClients = new Map(); // receiverId -> client
  }

  // Initialize WebSocket server
  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const userId = url.searchParams.get('userId');
      const role = url.searchParams.get('role'); // donor or receiver

      if (!userId) {
        ws.close(1008, 'userId required');
        return;
      }

      logger.info(`🔌 WebSocket connected: ${userId} (${role || 'unknown'})`);

      // Register client
      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set());
      }
      this.clients.get(userId).add(ws);

      if (role === 'donor') {
        this.donorClients.set(userId, ws);
      } else if (role === 'receiver') {
        this.receiverClients.set(userId, ws);
      }

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(userId, role, message, ws);
        } catch (err) {
          logger.error('WebSocket message parse error:', err.message);
        }
      });

      ws.on('close', () => {
        this.removeClient(userId, ws);
        if (role === 'donor') {
          this.donorClients.delete(userId);
        } else if (role === 'receiver') {
          this.receiverClients.delete(userId);
        }
        logger.info(`🔌 WebSocket disconnected: ${userId}`);
      });

      ws.on('error', (err) => {
        logger.error(`WebSocket error for ${userId}:`, err.message);
      });

      // Send heartbeat
      ws.send(JSON.stringify({ type: 'connected', userId, timestamp: Date.now() }));
    });

    logger.info('✅ WebSocket server initialized');
  }

  // Remove client from tracking
  removeClient(userId, ws) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.delete(ws);
      if (userClients.size === 0) {
        this.clients.delete(userId);
      }
    }
  }

  // Handle incoming messages
  handleMessage(userId, role, message, ws) {
    const { type, data } = message;

    switch (type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      case 'donor_accepted':
        this.sendToUser(data.receiverId, {
          type: 'donor_accepted',
          donorId: userId,
          config: data.config
        });
        break;
      case 'donor_rejected':
        this.sendToUser(data.receiverId, {
          type: 'donor_rejected',
          donorId: userId,
          reason: data.reason
        });
        break;
      case 'disconnect':
        logger.info(`🔴 Disconnect requested by ${userId}`);
        break;
      default:
        logger.warn(`Unknown message type: ${type} from ${userId}`);
    }
  }

  // Send message to specific user
  sendToUser(userId, message) {
    const userClients = this.clients.get(userId);
    if (!userClients || userClients.size === 0) {
      logger.warn(`No WebSocket clients for user: ${userId}`);
      return false;
    }

    const data = JSON.stringify(message);
    let sent = 0;
    userClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        sent++;
      }
    });

    if (sent > 0) {
      logger.debug(`📤 Sent ${message.type} to ${userId} (${sent} connections)`);
      return true;
    }
    return false;
  }

  // Send to all donors
  broadcastToDonors(message) {
    const data = JSON.stringify(message);
    this.donorClients.forEach((ws, donorId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  // Send to all receivers
  broadcastToReceivers(message) {
    const data = JSON.stringify(message);
    this.receiverClients.forEach((ws, receiverId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  // Get online count
  getOnlineCount() {
    return {
      total: this.clients.size,
      donors: this.donorClients.size,
      receivers: this.receiverClients.size
    };
  }
}

module.exports = new WebSocketService();
