import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/providers.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  final _nameController = TextEditingController();
  bool _isRegister = false;
  String _selectedRole = 'both';

  @override
  void dispose() {
    _phoneController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    final phone = _phoneController.text.trim();
    if (phone.length < 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid phone number')),
      );
      return;
    }

    final auth = context.read<AuthProvider>();
    bool success;

    if (_isRegister) {
      final name = _nameController.text.trim();
      if (name.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your name')),
        );
        return;
      }
      success = await auth.register(phone: phone, name: name, role: _selectedRole);
    } else {
      success = await auth.login(phone);
    }

    if (!mounted) return;

    if (success) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const HomeScreen()),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(auth.error ?? 'An error occurred'),
          backgroundColor: Colors.red[700],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Logo
              Icon(
                Icons.wifi_tethering_rounded,
                size: 80,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(
                'DataShare',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'Share data, not cost. Community driven.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 48),

              // Form
              if (_isRegister) ...[
                TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Name',
                    prefixIcon: Icon(Icons.person_outline),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone Number',
                  prefixIcon: Icon(Icons.phone_outlined),
                  hintText: '+91 98765 43210',
                ),
              ),

              if (_isRegister) ...[
                const SizedBox(height: 24),
                Text('I want to:', style: theme.textTheme.titleMedium),
                const SizedBox(height: 12),
                _RoleOption(
                  title: 'Donate Data',
                  icon: Icons.volunteer_activism,
                  selected: _selectedRole == 'donor',
                  onTap: () => setState(() => _selectedRole = 'donor'),
                ),
                const SizedBox(height: 8),
                _RoleOption(
                  title: 'Receive Data',
                  icon: Icons.wifi,
                  selected: _selectedRole == 'receiver',
                  onTap: () => setState(() => _selectedRole = 'receiver'),
                ),
                const SizedBox(height: 8),
                _RoleOption(
                  title: 'Both (Donate & Receive)',
                  icon: Icons.swap_horiz,
                  selected: _selectedRole == 'both',
                  onTap: () => setState(() => _selectedRole = 'both'),
                ),
              ],

              const SizedBox(height: 32),

              Consumer<AuthProvider>(
                builder: (context, auth, _) {
                  return ElevatedButton(
                    onPressed: auth.isLoading ? null : _handleSubmit,
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: auth.isLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              _isRegister ? 'Register' : 'Login',
                              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                            ),
                    ),
                  );
                },
              ),

              const SizedBox(height: 16),

              TextButton(
                onPressed: () => setState(() => _isRegister = !_isRegister),
                child: Text(
                  _isRegister ? 'Already have an account? Login' : "Don't have an account? Register",
                  style: const TextStyle(color: Color(0xFF3B82F6)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoleOption extends StatelessWidget {
  final String title;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _RoleOption({required this.title, required this.icon, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF3B82F6).withOpacity(0.15) : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? const Color(0xFF3B82F6) : Colors.white.withOpacity(0.06),
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icon, color: selected ? const Color(0xFF3B82F6) : const Color(0xFF94A3B8)),
            const SizedBox(width: 12),
            Text(title, style: TextStyle(
              color: selected ? const Color(0xFF3B82F6) : const Color(0xFFCBD5E1),
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            )),
            const Spacer(),
            Icon(
              selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
              color: selected ? const Color(0xFF3B82F6) : const Color(0xFF64748B),
            ),
          ],
        ),
      ),
    );
  }
}
