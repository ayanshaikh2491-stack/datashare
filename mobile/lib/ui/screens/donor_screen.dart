import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/providers.dart';

class DonorScreen extends StatefulWidget {
  const DonorScreen({super.key});

  @override
  State<DonorScreen> createState() => _DonorScreenState();
}

class _DonorScreenState extends State<DonorScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<DonorProvider>().refreshStatus());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final donor = context.watch<DonorProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Donate Data'),
        centerTitle: true,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          if (donor.isOnline)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text('${donor.availableSlots} slots', style: const TextStyle(color: Colors.green, fontSize: 12)),
                  ],
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Main toggle button
              _DonorToggle(donor: donor),
              const SizedBox(height: 32),

              // Stats cards
              if (donor.isOnline) ...[
                _StatsCard(donor: donor),
                const SizedBox(height: 24),
                _PendingRequests(donor: donor),
              ],

              // Info card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('How it works', style: theme.textTheme.titleLarge),
                      const SizedBox(height: 16),
                      _InfoStep(
                        icon: Icons.power_on,
                        title: 'Go Online',
                        description: 'Tap the button above to start sharing your data',
                      ),
                      const SizedBox(height: 12),
                      _InfoStep(
                        icon: Icons.people_outline,
                        title: 'Accept Requests',
                        description: 'When someone needs data, you\'ll get a request',
                      ),
                      const SizedBox(height: 12),
                      _InfoStep(
                        icon: Icons.monitor_heart_outlined,
                        title: 'Monitor Usage',
                        description: 'Watch real-time data usage for each connection',
                      ),
                      const SizedBox(height: 12),
                      _InfoStep(
                        icon: Icons.block,
                        title: 'Full Control',
                        description: 'Disconnect anyone, anytime with one tap',
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DonorToggle extends StatelessWidget {
  final DonorProvider donor;
  const _DonorToggle({required this.donor});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: donor.isLoading ? null : () async {
        if (donor.isOnline) {
          await donor.goOffline();
        } else {
          final result = await donor.goOnline(lat: 28.6139, lng: 77.2090); // Default Delhi
          if (!context.mounted) return;
          if (result) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('You are now online and sharing data!')),
            );
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(donor.error ?? 'Failed to go online'), backgroundColor: Colors.red[700]),
            );
          }
        }
      },
      child: Container(
        height: 200,
        decoration: BoxDecoration(
          color: donor.isOnline
              ? const Color(0xFF3B82F6).withOpacity(0.15)
              : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: donor.isOnline ? const Color(0xFF3B82F6) : Colors.white.withOpacity(0.06),
            width: 2,
          ),
          boxShadow: donor.isOnline
              ? [BoxShadow(color: const Color(0xFF3B82F6).withOpacity(0.3), blurRadius: 30, spreadRadius: 5)]
              : [],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              donor.isOnline ? Icons.wifi_tethering_rounded : Icons.wifi_tethering_off_rounded,
              size: 64,
              color: donor.isOnline ? const Color(0xFF3B82F6) : const Color(0xFF64748B),
            ),
            const SizedBox(height: 12),
            Text(
              donor.isOnline ? 'SHARING DATA' : 'GO ONLINE',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: donor.isOnline ? const Color(0xFF3B82F6) : const Color(0xFF94A3B8),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              donor.isOnline ? 'Tap to stop sharing' : 'Tap to start sharing',
              style: const TextStyle(color: Color(0xFF64748B)),
            ),
            if (donor.isLoading) ...[
              const SizedBox(height: 16),
              const CircularProgressIndicator(color: Color(0xFF3B82F6)),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  final DonorProvider donor;
  const _StatsCard({required this.donor});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Active Connections', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: _StatItem(label: 'Connected', value: '${donor.donor?.currentReceivers ?? 0}')),
                Expanded(child: _StatItem(label: 'Available', value: '${donor.availableSlots}')),
                Expanded(child: _StatItem(label: 'Max', value: '${donor.donor?.maxReceivers ?? 3}')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label;
  final String value;
  const _StatItem({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Color(0xFF3B82F6))),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
      ],
    );
  }
}

class _PendingRequests extends StatelessWidget {
  final DonorProvider donor;
  const _PendingRequests({required this.donor});

  @override
  Widget build(BuildContext context) {
    if (donor.pendingRequests.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Center(
            child: Column(
              children: [
                Icon(Icons.hourglass_empty, size: 48, color: Colors.grey[600]),
                const SizedBox(height: 12),
                Text('No pending requests', style: TextStyle(color: Colors.grey[600])),
              ],
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Pending Requests', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        ...donor.pendingRequests.map((request) => Card(
          child: ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person)),
            title: const Text('Data Request'),
            subtitle: Text('Needs ${request['data_needed_mb'] ?? 100} MB'),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.red),
                  onPressed: () => donor.rejectReceiver(request['id']),
                ),
                IconButton(
                  icon: const Icon(Icons.check, color: Colors.green),
                  onPressed: () async {
                    final result = await donor.acceptReceiver(request['id']);
                    if (!context.mounted) return;
                    if (result) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Receiver accepted!')),
                      );
                    }
                  },
                ),
              ],
            ),
          ),
        )),
      ],
    );
  }
}

class _InfoStep extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  const _InfoStep({required this.icon, required this.title, required this.description});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFF3B82F6).withOpacity(0.1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: const Color(0xFF3B82F6), size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(description, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }
}
