const config = require('../../config/env');
const logger = require('../utils/logger');

class HeadscaleService {
  constructor() {
    this.baseURL = config.HEADSCALE_URL;
    this.apiKey = config.HEADSCALE_API_KEY;
    this.namespace = config.HEADSCALE_NAMESPACE;
    this.initialized = false;
  }

  // Native fetch wrapper (Node.js 18+, no axios needed)
  async apiCall(method, path, data = null) {
    try {
      const url = `${this.baseURL}/api/v1${path}`;
      const options = {
        method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      };

      if (this.apiKey) {
        options.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      if (data) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return {};
    } catch (error) {
      logger.error(`Headscale API Error [${method} ${path}]:`, error.message);
      throw error;
    }
  }

  async createNamespace() {
    try {
      const result = await this.apiCall('POST', '/namespace', { name: this.namespace });
      logger.info(`✅ Headscale namespace created: ${this.namespace}`);
      return result;
    } catch (error) {
      if (error.message?.includes('exist') || error.message?.includes('409')) {
        logger.info(`ℹ️  Headscale namespace already exists: ${this.namespace}`);
        return { namespace: this.namespace, exists: true };
      }
      throw error;
    }
  }

  async registerNode(nodeName, userId) {
    try {
      const preAuthKey = await this.createPreAuthKey(this.namespace, {
        reusable: false,
        ephemeral: true,
        tags: ['tag:datashare']
      });

      logger.info(`📱 Node registered: ${nodeName} (user: ${userId})`);
      return {
        nodeName,
        preAuthKey: preAuthKey.key,
        namespace: this.namespace,
        headscaleUrl: this.baseURL
      };
    } catch (error) {
      logger.error(`❌ Failed to register node ${nodeName}:`, error.message);
      throw error;
    }
  }

  async createPreAuthKey(namespace, options = {}) {
    const { reusable = false, ephemeral = true, tags = [] } = options;
    return await this.apiCall('POST', '/key', { namespace, reusable, ephemeral, tags });
  }

  async getNodes() {
    return await this.apiCall('GET', `/namespace/${this.namespace}/nodes`);
  }

  async getNode(nodeId) {
    return await this.apiCall('GET', `/nodes/${nodeId}`);
  }

  async expireNode(nodeId) {
    await this.apiCall('DELETE', `/nodes/${nodeId}`);
    logger.info(`🔴 Node expired: ${nodeId}`);
    return true;
  }

  async renameNode(nodeId, newName) {
    await this.apiCall('POST', `/nodes/${nodeId}/rename`, { name: newName });
    return true;
  }

  async getRoutes() {
    return await this.apiCall('GET', '/routes');
  }

  async enableRoute(routeId) {
    return await this.apiCall('POST', `/routes/${routeId}/enable`);
  }

  async updateNodeRoutes(nodeId, routes, enabled) {
    await this.apiCall('POST', `/nodes/${nodeId}/routes`, { routes, enabled });
    return true;
  }

  async initialize() {
    if (this.initialized) return true;
    try {
      await this.createNamespace();
      this.initialized = true;
      logger.info('✅ Headscale initialized successfully');
      return true;
    } catch (error) {
      logger.error('❌ Headscale initialization failed:', error.message);
      return false;
    }
  }

  async healthCheck() {
    try {
      await this.apiCall('GET', '/health');
      return true;
    } catch (error) {
      return false;
    }
  }

  async setupExitNode(donorNodeId) {
    try {
      const routes = await this.getRoutes();
      if (routes.routes) {
        for (const route of routes.routes) {
          if (route.node.id === donorNodeId && route.advertised) {
            await this.enableRoute(route.id);
            logger.info(`🛣️  Route enabled: ${route.prefix} (donor: ${donorNodeId})`);
          }
        }
      }
      return true;
    } catch (error) {
      logger.error('Failed to setup exit node:', error.message);
      throw error;
    }
  }
}

module.exports = new HeadscaleService();
