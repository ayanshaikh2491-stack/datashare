import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  static const String _tokenKey = 'auth_token';
  static const String _userIdKey = 'user_id';
  static const String _userPhoneKey = 'user_phone';
  static const String _userNameKey = 'user_name';
  static const String _userRoleKey = 'user_role';
  static const String _isDonorKey = 'is_donor';
  static const String _isReceiverKey = 'is_receiver';

  static SharedPreferences? _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  // Token
  static String? get token => _prefs?.getString(_tokenKey);
  static Future<void> saveToken(String token) async {
    await _prefs?.setString(_tokenKey, token);
  }
  static Future<void> clearToken() async {
    await _prefs?.remove(_tokenKey);
  }

  // User Info
  static String? get userId => _prefs?.getString(_userIdKey);
  static String? get userPhone => _prefs?.getString(_userPhoneKey);
  static String? get userName => _prefs?.getString(_userNameKey);
  static String? get userRole => _prefs?.getString(_userRoleKey);

  static Future<void> saveUserInfo({
    required String id,
    required String phone,
    required String name,
    required String role,
  }) async {
    await _prefs?.setString(_userIdKey, id);
    await _prefs?.setString(_userPhoneKey, phone);
    await _prefs?.setString(_userNameKey, name);
    await _prefs?.setString(_userRoleKey, role);
  }

  // Mode Selection
  static bool get isDonor => _prefs?.getBool(_isDonorKey) ?? false;
  static bool get isReceiver => _prefs?.getBool(_isReceiverKey) ?? false;

  static Future<void> setMode({required bool isDonor, required bool isReceiver}) async {
    await _prefs?.setBool(_isDonorKey, isDonor);
    await _prefs?.setBool(_isReceiverKey, isReceiver);
  }

  // Clear all
  static Future<void> clearAll() async {
    await _prefs?.clear();
  }

  // Check if logged in
  static bool get isLoggedIn => token != null && userId != null;
}
