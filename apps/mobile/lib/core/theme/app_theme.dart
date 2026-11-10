import 'package:flutter/material.dart';

import 'tokens.dart';
import 'typography.dart';

class AppTheme {
  AppTheme._();

  static ThemeData dark() {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: RfColors.lime,
      onPrimary: RfColors.bg,
      secondary: RfColors.cyan,
      onSecondary: RfColors.bg,
      tertiary: RfColors.amber,
      onTertiary: RfColors.bg,
      error: RfColors.coral,
      onError: RfColors.alertBg,
      surface: RfColors.bg,
      onSurface: RfColors.text,
      surfaceContainerHighest: RfColors.panel,
      outline: RfColors.border,
      outlineVariant: RfColors.line,
    );
    final text = RfType.textTheme(RfColors.text);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: RfColors.bg,
      textTheme: text,
      dividerColor: RfColors.lineSoft,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      appBarTheme: AppBarTheme(
        backgroundColor: RfColors.bg,
        foregroundColor: RfColors.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: RfType.title(size: 22, color: RfColors.text),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: RfColors.panel,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        labelStyle: RfType.body(size: 14, color: RfColors.textSoft),
        hintStyle: RfType.body(size: 14, color: RfColors.textMuted),
        errorStyle: RfType.body(size: 12, color: RfColors.coral),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RfRadii.field),
          borderSide: const BorderSide(color: RfColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RfRadii.field),
          borderSide: const BorderSide(color: RfColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RfRadii.field),
          borderSide: const BorderSide(color: RfColors.lime, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RfRadii.field),
          borderSide: const BorderSide(color: RfColors.coral),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RfRadii.field),
          borderSide: const BorderSide(color: RfColors.coral, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: RfColors.lime,
          foregroundColor: RfColors.bg,
          minimumSize: const Size(RfSpace.minTouch, 52),
          shape: const StadiumBorder(),
          textStyle: RfType.body(size: 16, weight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: RfColors.text,
          minimumSize: const Size(RfSpace.minTouch, RfSpace.minTouch),
          side: const BorderSide(color: RfColors.border),
          shape: const StadiumBorder(),
          textStyle: RfType.body(size: 15),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: RfColors.lime,
          minimumSize: const Size(RfSpace.minTouch, RfSpace.minTouch),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: RfColors.panel2,
        contentTextStyle: RfType.body(size: 14, color: RfColors.text),
        behavior: SnackBarBehavior.floating,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: RfColors.navBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: RfColors.panel,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(RfRadii.alertTile)),
        titleTextStyle: RfType.title(size: 20, color: RfColors.text),
        contentTextStyle: RfType.body(size: 14, color: RfColors.textSoft),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? RfColors.bg : RfColors.textMuted),
        trackColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? RfColors.lime : RfColors.panel2),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? RfColors.lime : Colors.transparent),
        checkColor: const WidgetStatePropertyAll(RfColors.bg),
        side: const BorderSide(color: RfColors.border, width: 1.5),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: RfColors.lime),
    );
  }

  /// Cream theme used by the dog profile (MobileChien).
  static ThemeData cream() {
    final base = dark();
    return base.copyWith(
      colorScheme: base.colorScheme.copyWith(
        primary: RfColors.brand,
        onPrimary: RfColors.white,
        surface: RfColors.cream,
        onSurface: RfColors.creamText,
      ),
      scaffoldBackgroundColor: RfColors.cream,
      textTheme: RfType.textTheme(RfColors.creamText),
      appBarTheme: base.appBarTheme.copyWith(
        backgroundColor: RfColors.cream,
        foregroundColor: RfColors.creamText,
      ),
    );
  }
}
