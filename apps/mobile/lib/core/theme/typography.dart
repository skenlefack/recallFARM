import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Fonts of the mock-ups: Bricolage Grotesque (titles), IBM Plex Sans (body),
/// IBM Plex Mono (numbers). They are bundled in `assets/fonts/` (latin subset,
/// SIL OFL 1.1) so the first launch is fully offline and nothing is downloaded
/// on 2G. A glyph missing from the subset falls back to the platform font.
class RfType {
  RfType._();

  static const String titleFamily = 'BricolageGrotesque';
  static const String bodyFamily = 'IBMPlexSans';
  static const String monoFamily = 'IBMPlexMono';

  /// Set to false in widget tests to use the platform font instead of the
  /// bundled families.
  static bool useBundledFonts = true;

  static TextStyle _font(String family, TextStyle base) =>
      useBundledFonts ? base.copyWith(fontFamily: family) : base;

  static TextStyle title({double size = 22, FontWeight weight = FontWeight.w700, Color? color, double? letterSpacing}) =>
      _font(
        titleFamily,
        TextStyle(
          fontSize: size,
          fontWeight: weight,
          color: color,
          letterSpacing: letterSpacing ?? -0.02 * size,
          height: 1.15,
        ),
      );

  static TextStyle body({double size = 14, FontWeight weight = FontWeight.w400, Color? color, double? height}) =>
      _font(bodyFamily, TextStyle(fontSize: size, fontWeight: weight, color: color, height: height));

  static TextStyle mono({double size = 13, FontWeight weight = FontWeight.w400, Color? color, double? letterSpacing}) =>
      _font(monoFamily, TextStyle(fontSize: size, fontWeight: weight, color: color, letterSpacing: letterSpacing));

  static TextTheme textTheme(Color color) {
    final base = body(color: color);
    return TextTheme(
      displaySmall: title(size: 30, weight: FontWeight.w800, color: color),
      headlineMedium: title(size: 27, color: color),
      headlineSmall: title(size: 25, color: color),
      titleLarge: title(size: 22, color: color),
      titleMedium: body(size: 16, weight: FontWeight.w600, color: color),
      titleSmall: body(size: 14, weight: FontWeight.w600, color: color),
      bodyLarge: base.copyWith(fontSize: 15),
      bodyMedium: base.copyWith(fontSize: 14),
      bodySmall: base.copyWith(fontSize: 12),
      labelLarge: body(size: 14, weight: FontWeight.w600, color: color),
      labelMedium: body(size: 12, color: color),
      labelSmall: body(size: 11, color: color),
    );
  }

  static bool _licensesRegistered = false;

  /// Adds the SIL OFL notices of the bundled fonts to the licence page
  /// (`showLicensePage`), as the OFL requires when redistributing the fonts.
  static void registerFontLicenses() {
    if (_licensesRegistered) return;
    _licensesRegistered = true;
    LicenseRegistry.addLicense(() async* {
      for (final (pkg, file) in const [
        ('Bricolage Grotesque', 'OFL-BricolageGrotesque.txt'),
        ('IBM Plex Sans', 'OFL-IBMPlexSans.txt'),
        ('IBM Plex Mono', 'OFL-IBMPlexMono.txt'),
      ]) {
        yield LicenseEntryWithLineBreaks([pkg], await rootBundle.loadString('assets/fonts/$file'));
      }
    });
  }
}
