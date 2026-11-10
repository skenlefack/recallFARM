/// Build-time configuration (`--dart-define`).
class AppConfig {
  AppConfig._();

  /// API base URL. Android emulator → host gateway: http://10.0.2.2:8080/v1
  static const String apiBaseUrl =
      String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:8080/v1');

  /// Country used when creating a farm offline (prefilled; editable in E04).
  static const String defaultCountry =
      String.fromEnvironment('DEFAULT_COUNTRY', defaultValue: 'CM');

  /// Allow google_fonts to download fonts at runtime (set false once fonts are bundled).
  static const bool allowFontFetching =
      bool.fromEnvironment('ALLOW_FONT_FETCHING', defaultValue: true);

  /// Sync period while the app is in the foreground.
  static const Duration syncPeriod = Duration(minutes: 15);

  /// Push batch size (dossier 05 §20).
  static const int pushBatchSize = 200;

  /// Pull page size.
  static const int pullLimit = 500;

  /// Local notification time for reminders (local time).
  static const int reminderHour = 8;

  static const Duration connectTimeout = Duration(seconds: 20);
  static const Duration receiveTimeout = Duration(seconds: 40);
}
