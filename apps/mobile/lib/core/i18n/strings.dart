import 'package:flutter/widgets.dart';

import 'strings_en.dart';
import 'strings_fr.dart';

/// Minimal, codegen-free i18n. French is the source language; English falls back
/// to French, then to the key itself. Placeholders: `{name}`.
class S {
  const S(this.lang);
  final String lang;

  static const supported = ['fr', 'en'];

  static S of(BuildContext context) {
    final code = Localizations.maybeLocaleOf(context)?.languageCode ?? 'fr';
    return S(supported.contains(code) ? code : 'fr');
  }

  String t(String key, [Map<String, Object?> params = const {}]) {
    var s = (lang == 'en' ? kStringsEn[key] : null) ?? kStringsFr[key] ?? key;
    if (params.isNotEmpty) {
      params.forEach((k, v) => s = s.replaceAll('{$k}', '${v ?? ''}'));
    }
    return s;
  }
}

extension TrContext on BuildContext {
  String tr(String key, [Map<String, Object?> params = const {}]) => S.of(this).t(key, params);
  String get lang => S.of(this).lang;
}
