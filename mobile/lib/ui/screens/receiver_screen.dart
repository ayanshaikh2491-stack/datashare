import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/providers.dart';
import '../../models/models.dart';

class ReceiverScreen extends StatefulWidget {
  const ReceiverScreen({super.key});

  @override
  State<ReceiverScreen> createState() => _ReceiverScreenState();
}

class _ReceiverScreenState extends State<ReceiverScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<ReceiverProvider>().refreshStatus());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final receiver = context.watch<ReceiverProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Receive Data'),
        centerTitle: true,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          if (receiver.isConnected)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.circle, color: Colors.green, size: 8),
                    SizedBox(width: 6),
                    Text('CONNECTED', style: TextStyle(color: Colors.green, fontSize: 12)),
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
              // Connection status card
              if (receiver.isConnected)
                _ConnectedCard(receiver: receiver)
              else
                _FindDonorCard(receiver: receiver),

              const SizedBox(height: 24),

              // Auto connect button
              if (!receiver.isConnected && !receiver.isLoading)
                ElevatedButton.icon(
                  onPressed: receiver.isLoading ? null : () async {
                    final result = await receiver.autoConnect();
                    if (!context.mounted) return;
                    if (result) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Connected to donor! 🎉')),
                      );
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(receiver.error ?? 'Failed to connect'),
                          backgroundColor: Colors.red[700],
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.auto_awesome),
                  label: const Padding(
                    padding: EdgeInsets.all(14),
                    child: Text('Auto Connect — Best Donor', style: TextStyle(fontSize: 16)),
                  ),
                ),

              if (receiver.isLoading) ...[
                const SizedBox(height: 16),
                const Center(child: CircularProgressIndicator()),
              ],

              const SizedBox(height: 24),

              // Available donors list
              if (receiver.availableDonors.isNotEmpty)
                _DonorList(donors: receiver.availableDonors),

              // Info card
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('How it works', style: theme.textTheme.titleLarge),
                      const SizedBox(height: 16),
                      _InfoStep(
                        icon: Icons.search,
                        title: 'Find Donor',
                        description: 'Auto-connect or choose from available donors',
                      ),
                      const SizedBox(height: 12),
                      _InfoStep(
                        icon: Icons.link,
                        title: 'Connect',
                        description: 'Secure VPN tunnel is created automatically',
                      ),
                      const SizedBox(height: 12),
                      _InfoStep(
                        icon: Icons.public,
                        title: 'Browse Free',
                        description: 'Use Instagram, YouTube, browser — all apps',
                      ),
                      const SizedBox(height: 12),
                      _InfoStep(
                        icon: Icons.timer_outlined,
                        title: 'Daily Limits',
                        description: '5 donors/day, 2GB total — fair usage for all',
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

class _ConnectedCard extends StatelessWidget {
  final ReceiverProvider receiver;
  const _ConnectedCard({required this.receiver});

  @override
  Widget build(BuildContext context) {
    final percentUsed = receiver.percentUsed;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.wifi, color: Colors.green, size: 64),
            const SizedBox(height: 12),
            const Text('CONNECTED', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green)),
            const SizedBox(height: 24),

            // Data usage
            Text(
              '${receiver.dataUsed.toStringAsFixed(0)} / ${receiver.dataLimit.toStringAsFixed(0)} MB',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),

            // Progress bar
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: LinearProgressIndicator(
                value: percentUsed / 100,
                minHeight: 8,
                backgroundColor: Colors.grey[800],
                valueColor: AlwaysStoppedAnimation<Color>(
                  percentUsed > 80 ? Colors.red : percentUsed > 50 ? Colors.orange : Colors.green,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text('$percentUsed% used', style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 24),

            // Disconnect button
            OutlinedButton.icon(
              onPressed: () async {
                final result = await receiver.disconnect();
                if (!context.mounted) return;
                if (result) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Disconnected')),
                  );
                }
              },
              icon: const Icon(Icons.link_off),
              label: const Text('Disconnect'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Colors.red),
                padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 32),
                minimumSize: const Size(double.infinity, 50),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FindDonorCard extends StatelessWidget {
  final ReceiverProvider receiver;
  const _FindDonorCard({required this.receiver});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(
              receiver.isLoading ? Icons.hourglass_top : Icons.wifi_search,
              size: 64,
              color: receiver.isLoading ? Colors.orange : const Color(0xFF3B82F6),
            ),
            const SizedBox(height: 16),
            Text(
              receiver.isLoading
                  ? 'Searching for donors...'
                  : receiver.availableDonors.isEmpty
                      ? 'Need Data?'
                      : '${receiver.availableDonors.length} Donors Available',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              receiver.isLoading
                  ? 'Finding the best donor for you'
                  : receiver.availableDonors.isEmpty
                      ? 'Tap auto connect to find a donor'
                      : 'Choose a donor or auto connect',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF64748B)),
            ),
          ],
        ),
      ),
    );
  }
}

class _DonorList extends StatelessWidget {
  final List<DonorModel> donors;
  const _DonorList({required this.donors});

  @override
  Widget build(BuildContext context) {
    final receiver = context.read<ReceiverProvider>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Available Donors', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        ...donors.map((donor) => Card(
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: const Color(0xFF3B82F6).withOpacity(0.2),
              child: const Icon(Icons.volunteer_activism, color: Color(0xFF3B82F6)),
            ),
            title: Text('Donor #${donor.id.substring(0, 8)}'),
            subtitle: Text('Limit: ${donor.dataLimitMb} MB • Slots: ${donor.availableSlots}'),
            trailing: ElevatedButton(
              onPressed: () async {
                final result = await receiver.connectToDonor(donor.id);
                if (!context.mounted) return;
                if (result) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Connection request sent!')),
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(receiver.error ?? 'Failed'), backgroundColor: Colors.red[700]),
                  );
                }
              },
              child: const Text('Connect'),
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
