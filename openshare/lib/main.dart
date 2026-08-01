import 'package:flutter/material.dart';
import 'screens/home_screen.dart';
import 'screens/share_screen.dart';
import 'screens/browse_screen.dart';
import 'screens/connected_screen.dart';
import 'services/test_hooks.dart';
import 'services/websocket_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TestHooks.load();
  runApp(const OpenShareApp());
}

class OpenShareApp extends StatelessWidget {
  const OpenShareApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenShare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF6C63FF),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF121212),
      ),
      initialRoute: '/',
      routes: {
        '/': (context) => const HomeScreen(),
        '/share': (context) => const ShareScreen(),
        '/browse': (context) => const BrowseScreen(),
        '/connected': (context) => ConnectedScreen(
          ws: (ModalRoute.of(context)!.settings.arguments
                  as WebSocketService),
        ),
      },
    );
  }
}
