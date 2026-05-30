import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../services/websocket_service.dart';

class AuthProvider extends ChangeNotifier {
  UserModel? _user;
  bool _isLoading = false;
  String? _error;
  bool _isLoggedIn = false;

  UserModel? get user => _user;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isLoggedIn => _isLoggedIn;

  Future<void> init() async {
    await StorageService.init();
    if (StorageService.isLoggedIn) {
      ApiService.setToken(StorageService.token!);
      _isLoggedIn = true;
      try {
        final result = await ApiService.getProfile();
        if (result['success'] == true) {
          _user = UserModel.fromJson(result['data']['user']);
        }
      } catch (e) {
        print('Init error: $e');
      }
      notifyListeners();
    }
  }

  Future<bool> login(String phone) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await ApiService.login(phone);
      if (result['success'] == true) {
        final token = result['data']['token'] as String;
        final userData = result['data']['user'] as Map<String, dynamic>;

        ApiService.setToken(token);
        await StorageService.saveToken(token);
        await StorageService.saveUserInfo(
          id: userData['id'],
          phone: userData['phone'],
          name: userData['name'] ?? '',
          role: userData['role'] ?? 'both',
        );

        _user = UserModel.fromJson(userData);
        _isLoggedIn = true;

        // Connect WebSocket
        WebSocketService().connect(_user!.id, _user!.role);
      } else {
        _error = result['error'] ?? 'Login failed';
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
    return true;
  }

  Future<bool> register({
    required String phone,
    required String name,
    String role = 'both',
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await ApiService.register(phone: phone, name: name, role: role);
      if (result['success'] == true) {
        final token = result['data']['token'] as String;
        final userData = result['data']['user'] as Map<String, dynamic>;

        ApiService.setToken(token);
        await StorageService.saveToken(token);
        await StorageService.saveUserInfo(
          id: userData['id'],
          phone: userData['phone'],
          name: userData['name'] ?? '',
          role: userData['role'] ?? 'both',
        );

        _user = UserModel.fromJson(userData);
        _isLoggedIn = true;
      } else {
        _error = result['error'] ?? 'Registration failed';
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
    return true;
  }

  Future<void> logout() async {
    await StorageService.clearAll();
    WebSocketService().disconnect();
    _user = null;
    _isLoggedIn = false;
    ApiService.setToken('');
    notifyListeners();
  }
}

class DonorProvider extends ChangeNotifier {
  DonorModel? _donor;
  bool _isOnline = false;
  bool _isLoading = false;
  String? _error;
  List<Map<String, dynamic>> _pendingRequests = [];
  List<Map<String, dynamic>> _activeConnections = [];

  DonorModel? get donor => _donor;
  bool get isOnline => _isOnline;
  bool get isLoading => _isLoading;
  String? get error => _error;
  List<Map<String, dynamic>> get pendingRequests => _pendingRequests;
  List<Map<String, dynamic>> get activeConnections => _activeConnections;
  int get availableSlots => _donor?.availableSlots ?? 0;

  Future<void> register() async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.registerDonor();
      if (result['success'] == true) {
        _donor = DonorModel.fromJson(result['data']['donor']);
      } else {
        _error = result['error'];
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> goOnline({required double lat, required double lng}) async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.goOnline(lat: lat, lng: lng);
      if (result['success'] == true) {
        _donor = DonorModel.fromJson(result['data']['donor']);
        _isOnline = true;
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> goOffline() async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.goOffline();
      if (result['success'] == true) {
        _donor = DonorModel.fromJson(result['data']['donor']);
        _isOnline = false;
        _pendingRequests.clear();
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> acceptReceiver(String receiverId) async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.acceptReceiver(receiverId);
      if (result['success'] == true) {
        _pendingRequests.removeWhere((r) => r['id'] == receiverId);
        if (_donor != null) {
          _donor = DonorModel.fromJson({
            ..._donor!.toJson(),
            'current_receivers': _donor!.currentReceivers + 1,
          });
        }
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> rejectReceiver(String receiverId) async {
    try {
      final result = await ApiService.rejectReceiver(receiverId: receiverId);
      if (result['success'] == true) {
        _pendingRequests.removeWhere((r) => r['id'] == receiverId);
        return true;
      }
      return false;
    } catch (e) {
      _error = e.toString();
      return false;
    }
  }

  Future<bool> disconnectReceiver(String receiverId) async {
    try {
      final result = await ApiService.disconnectReceiver(receiverId: receiverId);
      if (result['success'] == true) {
        _activeConnections.removeWhere((c) => c['receiver_id'] == receiverId);
        if (_donor != null) {
          _donor = DonorModel.fromJson({
            ..._donor!.toJson(),
            'current_receivers': _donor!.currentReceivers - 1,
          });
        }
        return true;
      }
      return false;
    } catch (e) {
      _error = e.toString();
      return false;
    }
  }

  Future<void> refreshStatus() async {
    try {
      final result = await ApiService.getDonorStatus();
      if (result['success'] == true) {
        _donor = DonorModel.fromJson(result['data']['donor']);
        _activeConnections = List<Map<String, dynamic>>.from(result['data']['active_connections'] ?? []);
        _isOnline = _donor?.isOnline ?? false;
      }
    } catch (e) {
      print('Refresh status error: $e');
    }
    notifyListeners();
  }

  void addPendingRequest(Map<String, dynamic> request) {
    _pendingRequests.add(request);
    notifyListeners();
  }

  Future<bool> updateDonorSettings({Map<String, dynamic>? settings, int? maxReceivers}) async {
    _isLoading = true;
    notifyListeners();

    try {
      if (settings != null) {
        final result = await ApiService.updateDonorSettings(settings: settings);
        if (result['success'] == true) {
          _donor = DonorModel.fromJson(result['data']['donor']);
          return true;
        } else {
          _error = result['error'];
          return false;
        }
      }
      if (maxReceivers != null) {
        if (_donor != null) {
          _donor = DonorModel.fromJson({
            ..._donor!.toJson(),
            'max_receivers': maxReceivers,
          });
          return true;
        }
      }
      return false;
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}

class ReceiverProvider extends ChangeNotifier {
  ReceiverModel? _receiver;
  bool _isConnected = false;
  bool _isLoading = false;
  String? _error;
  List<DonorModel> _availableDonors = [];
  ConnectionModel? _activeConnection;
  double _dataUsed = 0;
  double _dataLimit = 500;

  ReceiverModel? get receiver => _receiver;
  bool get isConnected => _isConnected;
  bool get isLoading => _isLoading;
  String? get error => _error;
  List<DonorModel> get availableDonors => _availableDonors;
  ConnectionModel? get activeConnection => _activeConnection;
  double get dataUsed => _dataUsed;
  double get dataLimit => _dataLimit;
  int get percentUsed => _dataLimit > 0 ? ((_dataUsed / _dataLimit) * 100).round() : 0;

  Future<void> register() async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.registerReceiver();
      if (result['success'] == true) {
        _receiver = ReceiverModel.fromJson(result['data']['receiver']);
      } else {
        _error = result['error'];
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> requestData({required double lat, required double lng}) async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.requestData(lat: lat, lng: lng, dataNeededMb: 100);
      if (result['success'] == true) {
        _availableDonors = (result['data']['donors'] as List?)
            ?.map((d) => DonorModel.fromJson(d))
            .toList() ?? [];
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> connectToDonor(String donorId) async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.connectToDonor(donorId);
      if (result['success'] == true) {
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> autoConnect() async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.autoConnect();
      if (result['success'] == true) {
        _activeConnection = ConnectionModel.fromJson(result['data']['connection']);
        _isConnected = true;
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> disconnect() async {
    _isLoading = true;
    notifyListeners();

    try {
      final result = await ApiService.disconnect();
      if (result['success'] == true) {
        _isConnected = false;
        _activeConnection = null;
        _dataUsed = 0;
        return true;
      } else {
        _error = result['error'];
        return false;
      }
    } catch (e) {
      _error = e.toString();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> refreshStatus() async {
    try {
      final result = await ApiService.getReceiverStatus();
      if (result['success'] == true) {
        _receiver = ReceiverModel.fromJson(result['data']['receiver']);
        _isConnected = result['data']['connected'] ?? false;
        if (_isConnected && result['data']['active_connection'] != null) {
          _activeConnection = ConnectionModel.fromJson(result['data']['active_connection']);
        }
      }
    } catch (e) {
      print('Refresh status error: $e');
    }
    notifyListeners();
  }

  void updateUsage(double used, double limit) {
    _dataUsed = used;
    _dataLimit = limit;
    notifyListeners();
  }

  void setConnected(bool connected) {
    _isConnected = connected;
    if (!connected) {
      _activeConnection = null;
      _dataUsed = 0;
    }
    notifyListeners();
  }
}
