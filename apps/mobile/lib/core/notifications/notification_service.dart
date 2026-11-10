import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../config/app_config.dart';
import '../data/models.dart';
import '../util/dates.dart';

/// Reminder notifications scheduled on the device from the local reminder
/// computation, so they work fully offline (dossier 04 §4.7): J-7, J-1, J, J+3
/// at 08:00 local time. Server SMS/WhatsApp are independent.
class NotificationService {
  NotificationService([FlutterLocalNotificationsPlugin? plugin])
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _ready = false;

  /// Route payloads of tapped notifications (e.g. `/health/reminder/<key>`).
  final StreamController<String> _taps = StreamController<String>.broadcast();
  Stream<String> get taps => _taps.stream;

  static const offsets = [-7, -1, 0, 3];
  static const _maxScheduled = 60;
  static const _reminderIdBase = 100000;

  static const _reminderChannel = AndroidNotificationDetails(
    'rf_reminders',
    'Rappels sanitaires',
    channelDescription: 'Rappels de vaccination et de soins (J-7, J-1, J, J+3)',
    importance: Importance.high,
    priority: Priority.high,
  );

  static const _alertChannel = AndroidNotificationDetails(
    'rf_alerts',
    'Alertes critiques',
    channelDescription: 'Alertes de la ferme connectée',
    importance: Importance.max,
    priority: Priority.max,
    fullScreenIntent: true,
    category: AndroidNotificationCategory.alarm,
  );

  Future<void> init() async {
    if (_ready) return;
    try {
      tzdata.initializeTimeZones();
      const settings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      );
      await _plugin.initialize(
        settings,
        onDidReceiveNotificationResponse: (NotificationResponse r) {
          final p = r.payload;
          if (p != null && p.isNotEmpty) _taps.add(p);
        },
      );
      final launch = await _plugin.getNotificationAppLaunchDetails();
      final payload = launch?.notificationResponse?.payload;
      if ((launch?.didNotificationLaunchApp ?? false) && payload != null) {
        scheduleMicrotask(() => _taps.add(payload));
      }
      _ready = true;
    } catch (e) {
      debugPrint('notifications unavailable: $e');
    }
  }

  /// Android 13+ runtime permission (POST_NOTIFICATIONS).
  Future<bool> requestPermission() async {
    if (!_ready) return false;
    final android =
        _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final granted = await android?.requestNotificationsPermission();
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    final iosGranted = await ios?.requestPermissions(alert: true, badge: true, sound: true);
    return (granted ?? true) && (iosGranted ?? true);
  }

  static int _stableId(String s) {
    var h = 0x811C9DC5;
    for (final c in s.codeUnits) {
      h ^= c;
      h = (h * 0x01000193) & 0x7FFFFFFF;
    }
    return h;
  }

  /// Reschedules all reminder notifications. [title]/[body] build localized texts.
  Future<int> scheduleReminders(
    List<ReminderView> reminders, {
    required String Function(ReminderView r, int offset) title,
    required String Function(ReminderView r, int offset) body,
  }) async {
    if (!_ready) return 0;
    final pending = await _plugin.pendingNotificationRequests();
    for (final p in pending) {
      if (p.id >= _reminderIdBase) await _plugin.cancel(p.id);
    }
    final now = DateTime.now();
    var count = 0;
    final slots = <({ReminderView r, int offset, DateTime at})>[];
    for (final r in reminders.where((r) => r.isOpen)) {
      for (final off in offsets) {
        final day = Dates.toLocal(Dates.addDays(r.dueDate, off));
        if (day == null) continue;
        final at = DateTime(day.year, day.month, day.day, AppConfig.reminderHour);
        if (at.isAfter(now)) slots.add((r: r, offset: off, at: at));
      }
    }
    slots.sort((a, b) => a.at.compareTo(b.at));
    for (final s in slots.take(_maxScheduled)) {
      final id = _reminderIdBase + (_stableId('${s.r.key}|${s.offset}') % 900000000);
      try {
        await _plugin.zonedSchedule(
          id,
          title(s.r, s.offset),
          body(s.r, s.offset),
          // Absolute instant: the local 08:00 converted to UTC (no tz database lookup needed).
          tz.TZDateTime.from(s.at, tz.UTC),
          const NotificationDetails(android: _reminderChannel, iOS: DarwinNotificationDetails()),
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
          payload: '/health/reminder/${Uri.encodeComponent(s.r.key)}',
        );
        count++;
      } catch (e) {
        debugPrint('schedule failed: $e');
      }
    }
    return count;
  }

  /// Immediate critical alert notification (MobileAlerte opens on tap).
  Future<void> showCriticalAlert(String alertId, String title, String body) async {
    if (!_ready) return;
    await _plugin.show(
      _stableId('alert|$alertId') % _reminderIdBase,
      title,
      body,
      const NotificationDetails(android: _alertChannel, iOS: DarwinNotificationDetails()),
      payload: '/alerts/$alertId/critical',
    );
  }
}
