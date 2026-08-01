import 'dart:async';
import 'package:flutter/material.dart';
import '../services/websocket_service.dart';
import '../services/tunnel_proxy.dart';
import '../services/test_hooks.dart';

class ShareScreen extends StatefulWidget {
  const ShareScreen({super.key});

  @override
  State<ShareScreen> createState() => _ShareScreenState();
}

class _ShareScreenState extends State<ShareScreen> {
  final ws = WebSocketService();
  final _serverUrlController = TextEditingController(
    text: TestHooks.serverUrl ?? 'wss://ayanshaikh2-datashare-relay.hf.space',
  );
  bool _isSharing = false;
  bool _isConnected = false;
  String? _connectedReceiver;
  StreamSubscription? _sub;
  DonorTunnel? _tunnel;

  @override
  void initState() {
    super.initState();
    if (TestHooks.serverUrl != null) {
      _serverUrlController.text = TestHooks.serverUrl!;
    }
    if (TestHooks.autoShare) {
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) _startSharing();
      });
    }
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _sub?.cancel();
    _tunnel?.dispose();
    if (_isSharing) ws.disconnect();
    super.dispose();
  }

  Future<void> _startSharing() async {
    final url = _serverUrlController.text.trim();
    if (url.isEmpty) return;

    setState(() => _isSharing = true);

    // Cold-start retry: a fresh HF space may need a few seconds to wake.
    var connected = false;
    for (var attempt = 0; attempt < 3 && mounted && !connected; attempt++) {
      connected = await ws.connect(url);
      if (!connected && mounted) {
        await Future.delayed(const Duration(seconds: 2));
      }
    }

    if (!connected && mounted) {
      setState(() => _isSharing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to connect to server. Check your internet and try again.')),
      );
      return;
    }

    ws.enableAutoReconnect();
    ws.registerAsDonor({
      'name': 'OpenShare Donor',
      'network': 'Mobile Data',
      'device': 'Android',
    });

    _tunnel = DonorTunnel(ws)..start();
    _sub = ws.messages.listen((msg) {
      if (!mounted) return;
      switch (msg['type']) {
        case 'DONOR_REGISTERED':
          setState(() => _isConnected = true);
          break;
        case 'RECONNECTING':
          setState(() => _isConnected = false);
          break;
        case 'RECONNECTED':
          setState(() => _isConnected = true);
          break;
        case 'SESSION_START':
          setState(() => _connectedReceiver = 'Receiver connected');
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('🔗 A receiver connected to you!'),
              backgroundColor: Colors.green,
            ),
          );
          break;
        case 'SESSION_END':
          setState(() => _connectedReceiver = null);
          break;
        case 'DISCONNECTED':
          setState(() {
            _isConnected = false;
            _isSharing = false;
            _connectedReceiver = null;
          });
          break;
      }
    });
  }

  void _stopSharing() {
    _sub?.cancel();
    _tunnel?.dispose();
    _tunnel = null;
    ws.disableAutoReconnect();
    ws.disconnect();
    setState(() {
      _isSharing = false;
      _isConnected = false;
      _connectedReceiver = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Share Internet'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_isSharing) _stopSharing();
            Navigator.pop(context);
          },
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (!_isSharing) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E2E),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Text(
                  'Tap Start to share your mobile internet.\n'
                  'No server URL needed - connects automatically.',
                  style: TextStyle(color: Colors.white70, fontSize: 15),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 24),
            ],
            if (_isSharing) ...[
              Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _isConnected
                      ? const Color(0xFF6C63FF).withValues(alpha: 0.2)
                      : Colors.orange.withValues(alpha: 0.2),
                  border: Border.all(
                    color: _isConnected
                        ? const Color(0xFF6C63FF)
                        : Colors.orange,
                    width: 4,
                  ),
                ),
                child: Icon(
                  _isConnected ? Icons.wifi_tethering : Icons.hourglass_top,
                  size: 56,
                  color:
                      _isConnected ? const Color(0xFF6C63FF) : Colors.orange,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                _isConnected ? 'Sharing...' : 'Connecting...',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _connectedReceiver != null
                    ? '✅ Someone is using your internet'
                    : 'Waiting for someone to connect...',
                style: const TextStyle(color: Colors.white60, fontSize: 15),
                textAlign: TextAlign.center,
              ),
              if (_connectedReceiver != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.green.withValues(alpha: 0.3)),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.check_circle, color: Colors.green, size: 18),
                      SizedBox(width: 8),
                      Text('Active',
                          style: TextStyle(color: Colors.green)),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 40),
            ],
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: _isSharing ? _stopSharing : _startSharing,
                style: ElevatedButton.styleFrom(
                  backgroundColor:
                      _isSharing ? Colors.red : const Color(0xFF6C63FF),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: Text(
                  _isSharing ? 'Stop Sharing' : 'Start Sharing',
                  style: const TextStyle(fontSize: 18),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
