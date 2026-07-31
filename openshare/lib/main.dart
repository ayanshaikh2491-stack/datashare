import 'package:flutter/material.dart';
import 'screens/home_screen.dart';
import 'screens/share_screen.dart';
import 'screens/browse_screen.dart';
import 'screens/connected_screen.dart';

void main() {
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
        '/connected': (context) => const ConnectedScreen(),
      },
    );
  }
}
