import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Fonts of the mock-ups: Bricolage Grotesque (titles), IBM Plex Sans (body),
/// IBM Plex Mono (numbers). Resolved through google_fonts; if a family is missing
/// from the installed google_fonts version, the platform font is used instead.
/// For offline-first builds, bundle the TTF files (see README "Fonts offline").
class RfType {
  RfType._();

  /// Set to false in widget tests (no network) to use platform fonts.
  static bool useGoogleFonts = true;

  static TextStyle _font(String family, TextStyle base) {
    if (!useGoogleFonts) return base;
    try {
      return GoogleFonts.getFont(family, textStyle: base);
    } catch (_) {
      return base;
    }
  }

  static TextStyle title({double size = 22, FontWeight weight = FontWeight.w700, Color? color, double? letterSpacing}) =>
      _font(
        'Bricolage Grotesque',
        TextStyle(
          fontSize: size,
          fontWeight: weight,
          color: color,
          letterSpacing: letterSpacing ?? -0.02 * size,
          height: 1.15,
        ),
      );

  static TextStyle body({double size = 14, FontWeight weight = FontWeight.w400, Color? color, double? height}) =>
      _font('IBM Plex Sans', TextStyle(fontSize: size, fontWeight: weight, color: color, height: height));

  static TextStyle mono({double size = 13, FontWeight weight = FontWeight.w400, Color? color, double? letterSpacing}) =>
      _font('IBM Plex Mono',
          TextStyle(fontSize: size, fontWeight: weight, color: color, letterSpacing: letterSpacing));

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
}
