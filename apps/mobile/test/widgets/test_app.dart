import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:recallfarm/core/theme/app_theme.dart';

/// Minimal app shell for widget tests (no plugins, platform fonts).
Widget testApp(Widget child, {double textScale = 1.0}) => MaterialApp(
      theme: AppTheme.dark(),
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      builder: (context, c) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: c!,
      ),
      home: Scaffold(body: child),
    );
