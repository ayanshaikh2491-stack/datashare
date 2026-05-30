import 'dart:convert';

class UserModel {
  final String id;
  final String phone;
  final String name;
  final String role; // donor, receiver, both
  final bool isActive;
  final DateTime createdAt;

  UserModel({
    required this.id,
    required this.phone,
    required this.name,
    required this.role,
    this.isActive = true,
    required this.createdAt,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] ?? '',
      phone: json['phone'] ?? '',
      name: json['name'] ?? '',
      role: json['role'] ?? 'both',
      isActive: json['is_active'] ?? true,
      createdAt: DateTime.parse(json['created_at'] ?? DateTime.now().toIso8601String()),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'phone': phone,
      'name': name,
      'role': role,
      'is_active': isActive,
      'created_at': createdAt.toIso8601String(),
    };
  }

  bool get isDonor => role == 'donor' || role == 'both';
  bool get isReceiver => role == 'receiver' || role == 'both';
}

class DonorModel {
  final String id;
  final String userId;
  final Map<String, dynamic>? location;
  final int maxReceivers;
  final int currentReceivers;
  final String status; // online, offline, busy
  final Map<String, dynamic> settings;
  final DateTime lastSeen;

  DonorModel({
    required this.id,
    required this.userId,
    this.location,
    this.maxReceivers = 3,
    this.currentReceivers = 0,
    this.status = 'offline',
    required this.settings,
    required this.lastSeen,
  });

  factory DonorModel.fromJson(Map<String, dynamic> json) {
    return DonorModel(
      id: json['id'] ?? '',
      userId: json['user_id'] ?? '',
      location: json['location'],
      maxReceivers: json['max_receivers'] ?? 3,
      currentReceivers: json['current_receivers'] ?? 0,
      status: json['status'] ?? 'offline',
      settings: json['settings'] ?? {},
      lastSeen: DateTime.parse(json['last_seen'] ?? DateTime.now().toIso8601String()),
    );
  }

  int get dataLimitMb => settings['data_limit_mb'] ?? 500;
  int get timeLimitMin => settings['time_limit_min'] ?? 60;
  int get dailyTotalGb => settings['daily_total_gb'] ?? 5;
  int get availableSlots => maxReceivers - currentReceivers;
  bool get isOnline => status == 'online' || status == 'busy';
}

class ReceiverModel {
  final String id;
  final String userId;
  final Map<String, dynamic>? location;
  final int dataNeededMb;
  final String status; // waiting, connected, disconnected

  ReceiverModel({
    required this.id,
    required this.userId,
    this.location,
    this.dataNeededMb = 0,
    this.status = 'disconnected',
  });

  factory ReceiverModel.fromJson(Map<String, dynamic> json) {
    return ReceiverModel(
      id: json['id'] ?? '',
      userId: json['user_id'] ?? '',
      location: json['location'],
      dataNeededMb: json['data_needed_mb'] ?? 0,
      status: json['status'] ?? 'disconnected',
    );
  }

  bool get isConnected => status == 'connected';
  bool get isWaiting => status == 'waiting';
}

class ConnectionModel {
  final String id;
  final String donorId;
  final String receiverId;
  final DateTime startedAt;
  final DateTime? endedAt;
  final double dataUsedMb;
  final String status; // active, completed, rejected
  final String? disconnectReason;

  ConnectionModel({
    required this.id,
    required this.donorId,
    required this.receiverId,
    required this.startedAt,
    this.endedAt,
    this.dataUsedMb = 0,
    this.status = 'active',
    this.disconnectReason,
  });

  factory ConnectionModel.fromJson(Map<String, dynamic> json) {
    return ConnectionModel(
      id: json['id'] ?? '',
      donorId: json['donor_id'] ?? '',
      receiverId: json['receiver_id'] ?? '',
      startedAt: DateTime.parse(json['started_at'] ?? DateTime.now().toIso8601String()),
      endedAt: json['ended_at'] != null ? DateTime.parse(json['ended_at']) : null,
      dataUsedMb: double.parse(json['data_used_mb']?.toString() ?? '0'),
      status: json['status'] ?? 'active',
      disconnectReason: json['disconnect_reason'],
    );
  }

  Duration get duration => DateTime.now().difference(startedAt);
  String get formattedDuration {
    final minutes = duration.inMinutes;
    final hours = minutes ~/ 60;
    final remainingMinutes = minutes % 60;
    if (hours > 0) {
      return '${hours}h ${remainingMinutes}m';
    }
    return '${remainingMinutes}m';
  }
}

class UsageLog {
  final String id;
  final String connectionId;
  final double dataMb;
  final String activityType;
  final DateTime timestamp;

  UsageLog({
    required this.id,
    required this.connectionId,
    required this.dataMb,
    this.activityType = 'general',
    required this.timestamp,
  });

  factory UsageLog.fromJson(Map<String, dynamic> json) {
    return UsageLog(
      id: json['id'] ?? '',
      connectionId: json['connection_id'] ?? '',
      dataMb: double.parse(json['data_mb']?.toString() ?? '0'),
      activityType: json['activity_type'] ?? 'general',
      timestamp: DateTime.parse(json['timestamp'] ?? DateTime.now().toIso8601String()),
    );
  }
}
