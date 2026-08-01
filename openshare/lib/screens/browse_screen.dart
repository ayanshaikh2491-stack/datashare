import 'dart:async';
import 'package:flutter/material.dart';
import '../services/websocket_service.dart';
import '../services/test_hooks.dart';

class BrowseScreen extends StatefulWidget {
  const BrowseScreen({super.key});

  @override
  State<BrowseScreen> createState() => _BrowseScreenState();
}

class _BrowseScreenState extends State<BrowseScreen> {
  final ws = WebSocketService();
  final _serverUrlController = TextEditingController(
    text: TestHooks.serverUrl ?? 'wss://ayanshaikh2-datashare-relay.hf.space',
  );
  List<Map<String, dynamic>> _donors = [];
  bool _isConnected = false;
  bool _isScanning = false;
  bool _isConnecting = false;
  StreamSubscription? _sub;
  bool _autoSelected = false;
  bool _handedOff = false;

  @override
  void initState() {
    super.initState();
    _sub = ws.messages.listen(_handleMessage);
    if (TestHooks.serverUrl != null) {
      _serverUrlController.text = TestHooks.serverUrl!;
    }
    if (TestHooks.autoBrowse) {
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) _connectToServer();
      });
    }
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _sub?.cancel();
    // Keep the socket alive when handing off to ConnectedScreen.
    if (_isConnected && !_handedOff) ws.disconnect();
    super.dispose();
  }

  void _handleMessage(Map<String, dynamic> msg) {
    if (!mounted) return;
    switch (msg['type']) {
      case 'DONOR_LIST':
        setState(() {
          _donors = List<Map<String, dynamic>>.from(msg['donors'] ?? []);
          _isScanning = false;
        });
        if (TestHooks.autoBrowse && _donors.isNotEmpty && !_autoSelected) {
          _autoSelected = true;
          final first = _donors.first;
          debugPrint(
              'OPENSHARE_AUTO_SELECT donor=${first['id']} name=${first['name']}');
          _connectToDonor(first['id'] as String);
        }
        break;
      case 'SESSION_STARTED':
        setState(() => _isConnecting = false);
        _handedOff = true;
        Navigator.pushReplacementNamed(context, '/connected', arguments: ws);
        break;
      case 'ERROR':
        setState(() => _isConnecting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${msg['message']}')),
        );
        break;
      case 'RECONNECTING':
        setState(() {
          _isConnected = false;
          _isScanning = true;
        });
        break;
      case 'RECONNECTED':
        setState(() => _isConnected = true);
        ws.requestDonors();
        break;
      case 'DISCONNECTED':
        setState(() {
          _isConnected = false;
          _donors = [];
          _isScanning = false;
        });
        break;
    }
  }

  Future<void> _connectToServer() async {
    final url = _serverUrlController.text.trim();
    if (url.isEmpty) return;

    setState(() => _isScanning = true);

    var connected = false;
    for (var attempt = 0; attempt < 3 && mounted && !connected; attempt++) {
      connected = await ws.connect(url);
      if (!connected && mounted) {
        await Future.delayed(const Duration(seconds: 2));
      }
    }

    if (!connected && mounted) {
      setState(() => _isScanning = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to connect to server. Check your internet and try again.')),
      );
      return;
    }

    ws.enableAutoReconnect();
    setState(() => _isConnected = true);
    ws.requestDonors();
  }

  void _scan() {
    setState(() => _isScanning = true);
    ws.requestDonors();
  }

  void _connectToDonor(String donorId) {
    setState(() => _isConnecting = true);
    ws.selectDonor(donorId, receiverInfo: {
      'name': 'OpenShare User',
      'device': 'Android',
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Browse Networks'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_isConnected) ws.disconnect();
            Navigator.pop(context);
          },
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            if (!_isConnected) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E2E),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Text(
                  'Connect to find donors sharing their internet.\n'
                  'No server URL needed - connects automatically.',
                  style: TextStyle(color: Colors.white70, fontSize: 15),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _connectToServer,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6C63FF),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text('Connect', style: TextStyle(fontSize: 17)),
                ),
              ),
            ],
            if (_isConnected) ...[
              Row(
                children: [
                  const Text('Available Donors',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const Spacer(),
                  Text('${_donors.length} online',
                      style: const TextStyle(color: Colors.green)),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: _isScanning ? null : _scan,
                    icon: _isScanning
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.refresh),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Expanded(
                child: _donors.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.signal_wifi_off,
                                size: 64, color: Colors.white24),
                            const SizedBox(height: 16),
                            const Text('No donors available',
                                style: TextStyle(color: Colors.white38)),
                            const SizedBox(height: 8),
                            TextButton(
                              onPressed: _scan,
                              child: const Text('Tap to scan again'),
                            ),
                          ],
                        ),
                      )
                    : ListView.separated(
                        itemCount: _donors.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, i) {
                          final d = _donors[i];
                          return Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E1E2E),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                  color: Colors.white10),
                            ),
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 8),
                              leading: Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF6C63FF)
                                      .withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Icon(
                                  Icons.phone_android,
                                  color: Color(0xFF6C63FF),
                                ),
                              ),
                              title: Text(
                                d['name'] ?? 'Unknown Donor',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600),
                              ),
                              subtitle: Text(
                                d['network'] ?? 'Unknown',
                                style: const TextStyle(color: Colors.white54),
                              ),
                              trailing: _isConnecting
                                  ? const SizedBox(
                                      width: 24,
                                      height: 24,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2),
                                    )
                                  : ElevatedButton(
                                      onPressed: () =>
                                          _connectToDonor(d['id'] ?? ''),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: const Color(0xFF6C63FF),
                                        foregroundColor: Colors.white,
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(10),
                                        ),
                                      ),
                                      child: const Text('Connect'),
                                    ),
                            ),
                          );
                        },
                      ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
