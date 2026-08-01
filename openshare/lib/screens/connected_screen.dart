import 'dart:async';
import 'package:flutter/material.dart';
import '../services/websocket_service.dart';
import '../services/tunnel_proxy.dart';

class ConnectedScreen extends StatefulWidget {
  final WebSocketService ws;
  const ConnectedScreen({super.key, required this.ws});

  @override
  State<ConnectedScreen> createState() => _ConnectedScreenState();
}

class _ConnectedScreenState extends State<ConnectedScreen> {
  late final WebSocketService ws = widget.ws;
  StreamSubscription? _sub;
  DateTime _connectedAt = DateTime.now();
  int _bytesTransferred = 0;
  ReceiverProxy? _proxy;

  @override
  void initState() {
    super.initState();
    _connectedAt = DateTime.now();
    _sub = ws.messages.listen(_handleMessage);
    // Start local HTTP(S) proxy so apps on this device can use the donor's
    // internet through 127.0.0.1:8787.
    _proxy = ReceiverProxy(ws);
    _proxy!.start().catchError((e) {
      debugPrint('OPENSHARE_PROXY_START_FAIL $e');
    });
  }

  void _handleMessage(Map<String, dynamic> msg) {
    if (!mounted) return;
    switch (msg['type']) {
      case 'SESSION_END':
        Navigator.pushReplacementNamed(context, '/browse');
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Session ended'),
            backgroundColor: Colors.orange,
          ),
        );
        break;
      case 'TUNNEL_DATA':
        setState(() => _bytesTransferred += ((msg['data']?.length ?? 0) as int));
        break;
      case 'DISCONNECTED':
        Navigator.pushReplacementNamed(context, '/browse');
        break;
    }
  }

  String _formatDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes % 60;
    final s = d.inSeconds % 60;
    if (h > 0) return '${h}h ${m}m ${s}s';
    if (m > 0) return '${m}m ${s}s';
    return '${s}s';
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  void dispose() {
    _sub?.cancel();
    _proxy?.stop();
    // Session is over (user disconnected or donor ended); close the socket.
    ws.disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Connected'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: false,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 140,
              height: 140,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.green.withValues(alpha: 0.15),
                border: Border.all(color: Colors.green, width: 4),
              ),
              child: const Icon(Icons.wifi, size: 64, color: Colors.green),
            ),
            const SizedBox(height: 24),
            const Text(
              'Internet Connected!',
              style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'You are using internet from a donor',
              style: TextStyle(color: Colors.white60, fontSize: 15),
            ),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E2E),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _statItem(Icons.timer, 'Duration',
                      _formatDuration(DateTime.now().difference(_connectedAt))),
                  _statItem(Icons.swap_vert, 'Transferred',
                      _formatBytes(_bytesTransferred)),
                ],
              ),
            ),
            const SizedBox(height: 40),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: () {
                  ws.endSession();
                  Navigator.pushReplacementNamed(context, '/browse');
                },
                icon: const Icon(Icons.power_settings_new),
                label: const Text('Disconnect',
                    style: TextStyle(fontSize: 18)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statItem(IconData icon, String label, String value) {
    return Column(
      children: [
        Icon(icon, color: const Color(0xFF6C63FF), size: 28),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 13)),
        const SizedBox(height: 4),
        Text(value,
            style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 16)),
      ],
    );
  }
}
