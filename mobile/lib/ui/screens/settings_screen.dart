import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/providers.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final donor = context.watch<DonorProvider>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        centerTitle: true,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Profile card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 30,
                        backgroundColor: theme.colorScheme.primary.withOpacity(0.2),
                        child: Text(
                          (auth.user?.name ?? 'U')[0].toUpperCase(),
                          style: TextStyle(fontSize: 28, color: theme.colorScheme.primary),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(auth.user?.name ?? 'User', style: theme.textTheme.titleLarge),
                            const SizedBox(height: 4),
                            Text(auth.user?.phone ?? '', style: theme.textTheme.bodyMedium),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: Colors.green.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                (auth.user?.role ?? 'both').toUpperCase(),
                                style: const TextStyle(color: Colors.green, fontSize: 10, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Donor settings (if donor)
              if (auth.user?.isDonor == true) ...[
                Text('Donor Settings', style: theme.textTheme.titleMedium),
                const SizedBox(height: 12),
                Card(
                  child: Column(
                    children: [
                      _SettingsTile(
                        icon: Icons.people_outline,
                        title: 'Max Receivers',
                        subtitle: '${donor.donor?.maxReceivers ?? 3} users at a time',
                        onTap: () => _showMaxReceiversDialog(context, donor),
                      ),
                      const Divider(height: 1, indent: 56),
                      _SettingsTile(
                        icon: Icons.data_usage_outlined,
                        title: 'Data Limit Per User',
                        subtitle: '${donor.donor?.dataLimitMb ?? 500} MB',
                        onTap: () => _showDataLimitDialog(context, donor),
                      ),
                      const Divider(height: 1, indent: 56),
                      _SettingsTile(
                        icon: Icons.timer_outlined,
                        title: 'Session Time Limit',
                        subtitle: '${donor.donor?.timeLimitMin ?? 60} minutes',
                        onTap: () => _showTimeLimitDialog(context, donor),
                      ),
                      const Divider(height: 1, indent: 56),
                      _SettingsTile(
                        icon: Icons.storage_outlined,
                        title: 'Daily Total Limit',
                        subtitle: '${donor.donor?.dailyTotalGb ?? 5} GB',
                        onTap: () => _showDailyLimitDialog(context, donor),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
              ],

              // App info
              Text('About', style: theme.textTheme.titleMedium),
              const SizedBox(height: 12),
              Card(
                child: Column(
                  children: [
                    _SettingsTile(
                      icon: Icons.info_outline,
                      title: 'Version',
                      subtitle: '1.0.0',
                    ),
                    const Divider(height: 1, indent: 56),
                    _SettingsTile(
                      icon: Icons.code_outlined,
                      title: 'Open Source',
                      subtitle: 'MIT License',
                    ),
                    const Divider(height: 1, indent: 56),
                    _SettingsTile(
                      icon: Icons.security_outlined,
                      title: 'Security',
                      subtitle: 'WireGuard Encrypted',
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Danger zone
              Card(
                color: Colors.red.withOpacity(0.1),
                child: ListTile(
                  leading: const Icon(Icons.logout, color: Colors.red),
                  title: const Text('Logout', style: TextStyle(color: Colors.red)),
                  subtitle: const Text('Sign out of your account'),
                  onTap: () => _showLogoutDialog(context, auth),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showMaxReceiversDialog(BuildContext context, DonorProvider donor) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Max Receivers'),
        content: const Text('How many users can connect at the same time?'),
        actions: [1, 2, 3, 4, 5].map((n) => TextButton(
          onPressed: () {
            donor.updateDonorSettings(maxReceivers: n);
            Navigator.pop(ctx);
          },
          child: Text('$n'),
        )).toList(),
      ),
    );
  }

  void _showDataLimitDialog(BuildContext context, DonorProvider donor) {
    final controller = TextEditingController(text: '${donor.donor?.dataLimitMb ?? 500}');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Data Limit Per User'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Limit in MB'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              final limit = int.tryParse(controller.text);
              if (limit != null) {
                donor.updateDonorSettings(settings: {'data_limit_mb': limit});
              }
              Navigator.pop(ctx);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _showTimeLimitDialog(BuildContext context, DonorProvider donor) {
    final controller = TextEditingController(text: '${donor.donor?.timeLimitMin ?? 60}');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Session Time Limit'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Limit in minutes'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              final limit = int.tryParse(controller.text);
              if (limit != null) {
                donor.updateDonorSettings(settings: {'time_limit_min': limit});
              }
              Navigator.pop(ctx);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _showDailyLimitDialog(BuildContext context, DonorProvider donor) {
    final controller = TextEditingController(text: '${donor.donor?.dailyTotalGb ?? 5}');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Daily Total Limit'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Limit in GB'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              final limit = int.tryParse(controller.text);
              if (limit != null) {
                donor.updateDonorSettings(settings: {'daily_total_gb': limit});
              }
              Navigator.pop(ctx);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _showLogoutDialog(BuildContext context, AuthProvider auth) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Logout'),
        content: const Text('Are you sure you want to logout?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              auth.logout();
              Navigator.pop(ctx);
            },
            child: const Text('Logout', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: const Color(0xFF3B82F6)),
      title: Text(title),
      subtitle: Text(subtitle, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
      trailing: onTap != null ? const Icon(Icons.chevron_right) : null,
      onTap: onTap,
    );
  }
}
