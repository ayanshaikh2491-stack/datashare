import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'https://ayanshaikh2-datashare-relay.hf.space';

  static String? _token;

  static void setToken(String token) {
    _token = token;
  }

  static Map<String, String> get _headers {
    final headers = {
      'Content-Type': 'application/json',
    };
    if (_token != null) {
      headers['Authorization'] = 'Bearer $_token';
    }
    return headers;
  }

  // Auth
  static Future<Map<String, dynamic>> register({
    required String phone,
    required String name,
    String role = 'both',
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/register'),
      headers: _headers,
      body: jsonEncode({'phone': phone, 'name': name, 'role': role}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> login(String phone) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: _headers,
      body: jsonEncode({'phone': phone}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getProfile() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/auth/me'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  // Donor
  static Future<Map<String, dynamic>> registerDonor() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/register'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> goOnline({
    required double lat,
    required double lng,
    String? deviceName,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/go-online'),
      headers: _headers,
      body: jsonEncode({
        'location': {'lat': lat, 'lng': lng},
        if (deviceName != null) 'device_name': deviceName,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> goOffline() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/go-offline'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> acceptReceiver(String receiverId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/accept'),
      headers: _headers,
      body: jsonEncode({'receiver_id': receiverId}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> rejectReceiver({
    required String receiverId,
    String? reason,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/reject'),
      headers: _headers,
      body: jsonEncode({
        'receiver_id': receiverId,
        if (reason != null) 'reason': reason,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> disconnectReceiver({
    required String receiverId,
    String? reason,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/disconnect'),
      headers: _headers,
      body: jsonEncode({
        'receiver_id': receiverId,
        if (reason != null) 'reason': reason,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateDonorSettings({
    int? maxReceivers,
    Map<String, dynamic>? settings,
  }) async {
    final body = <String, dynamic>{};
    if (maxReceivers != null) body['max_receivers'] = maxReceivers;
    if (settings != null) body['settings'] = settings;

    final response = await http.post(
      Uri.parse('$baseUrl/api/donor/settings'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getDonorStatus() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/donor/status'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  // Receiver
  static Future<Map<String, dynamic>> registerReceiver() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/receiver/register'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> requestData({
    required double lat,
    required double lng,
    int dataNeededMb = 100,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/receiver/request'),
      headers: _headers,
      body: jsonEncode({
        'location': {'lat': lat, 'lng': lng},
        'data_needed_mb': dataNeededMb,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> connectToDonor(String donorId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/receiver/connect'),
      headers: _headers,
      body: jsonEncode({'donor_id': donorId}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> autoConnect() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/receiver/auto-connect'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> disconnect() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/receiver/disconnect'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getAvailableDonors() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/receiver/available-donors'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getReceiverStatus() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/receiver/status'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  // Usage
  static Future<Map<String, dynamic>> reportUsage({
    required String connectionId,
    required double dataMb,
    String activityType = 'general',
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/usage/report'),
      headers: _headers,
      body: jsonEncode({
        'connection_id': connectionId,
        'data_mb': dataMb,
        'activity_type': activityType,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStats() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/monitoring/stats'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getDonorHistory() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/monitoring/donor-history'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getConnectionDetails(String id) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/monitoring/connection/$id'),
      headers: _headers,
    );
    return _handleResponse(response);
  }

  // Health check
  static Future<Map<String, dynamic>> healthCheck() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/health'),
    );
    return _handleResponse(response);
  }

  static Map<String, dynamic> _handleResponse(http.Response response) {
    try {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return {'success': true, 'data': body};
      }
      return {
        'success': false,
        'error': body['error'] ?? 'Unknown error',
        'code': body['code'],
        'statusCode': response.statusCode,
      };
    } catch (e) {
      return {
        'success': false,
        'error': 'Failed to parse response: ${e.toString()}',
        'statusCode': response.statusCode,
      };
    }
  }
}
