import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DataShareApp());
}

class DataShareApp extends StatelessWidget {
  const DataShareApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DataShare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF6C63FF),
        scaffoldBackgroundColor: const Color(0xFF0f0f23),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF6C63FF),
          secondary: Color(0xFF6C63FF),
          surface: Color(0xFF1a1a2e),
        ),
      ),
      home: const WebViewScreen(),
    );
  }
}

class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  late WebViewController _controller;
  double _progress = 0;
  bool _loading = true;
  static const String serverUrl = 'https://ayanshaikh2-datashare-relay.hf.space';

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0f0f23))
      ..addJavaScriptChannel('DataShare', onMessageReceived: (JavaScriptMessage message) {
        // Handle messages from web app
        print('WebApp: ${message.message}');
      })
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (url) {
            setState(() {
              _loading = true;
              _progress = 0;
            });
          },
          onPageFinished: (url) {
            setState(() {
              _loading = false;
              _progress = 100;
            });
            // Inject cache-busting script
            _controller.runJavaScript('''
              (function() {
                var meta = document.createElement('meta');
                meta.httpEquiv = 'Cache-Control';
                meta.content = 'no-cache, no-store, must-revalidate';
                document.head.appendChild(meta);
              })();
            ''');
          },
          onProgress: (progress) {
            setState(() {
              _progress = progress / 100;
            });
          },
          onNavigationRequest: (request) {
            return NavigationDecision.navigate;
          },
        ),
      )
      // NOTE: do NOT clearCache() on every launch — that turns every
      // cold start into a full re-download. The server already sends
      // `Cache-Control: no-cache, no-store` for HTML, so users always
      // get the latest version without us nuking the WebView cache.
      ..loadRequest(Uri.parse(serverUrl));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            Container(
              color: const Color(0xFF0f0f23),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      '📦',
                      style: TextStyle(fontSize: 60),
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'DataShare',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'Loading latest version...',
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.white54,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Server may take 30-60s to wake on first load',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.white38,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: 200,
                      child: LinearProgressIndicator(
                        value: _progress,
                        backgroundColor: const Color(0xFF1a1a2e),
                        valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF6C63FF)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
