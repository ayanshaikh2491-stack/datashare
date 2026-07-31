import 'package:flutter/material.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'OpenShare',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 28),
        ),
        centerTitle: true,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_tethering, size: 100, color: Color(0xFF6C63FF)),
              const SizedBox(height: 24),
              const Text(
                'Share Internet Anywhere',
                style: TextStyle(fontSize: 20, color: Colors.white70),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 60),
              SizedBox(
                width: size.width * 0.8,
                height: 60,
                child: ElevatedButton.icon(
                  onPressed: () => Navigator.pushNamed(context, '/share'),
                  icon: const Icon(Icons.arrow_upward, size: 28),
                  label: const Text('Start Sharing', style: TextStyle(fontSize: 18)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6C63FF),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: size.width * 0.8,
                height: 60,
                child: ElevatedButton.icon(
                  onPressed: () => Navigator.pushNamed(context, '/browse'),
                  icon: const Icon(Icons.arrow_downward, size: 28),
                  label: const Text('Browse Networks',
                      style: TextStyle(fontSize: 18)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF3A3A5C),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 48),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E2E),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: Colors.white54, size: 20),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Donor shares their internet. Receiver connects and uses it. No hotspot needed.',
                        style: TextStyle(color: Colors.white54, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
