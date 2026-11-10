// Helpers to load the shared vectors / packs (paths relative to apps/mobile).
import 'dart:convert';
import 'dart:io';

import 'package:recallfarm/core/params/resolution.dart';

const String kParamsRoot = '../../packages/params';

Map<String, dynamic> loadJson(String relative) {
  final file = File('$kParamsRoot/$relative');
  if (!file.existsSync()) {
    throw StateError('Shared vector file not found: ${file.absolute.path} '
        '(run tests from apps/mobile)');
  }
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

List<ParamPack> loadBasePacks() => [
      for (final name in const [
        'global.core',
        'filiere.volaille',
        'filiere.canin',
        'pays.CM',
      ])
        ParamPack.fromJson(loadJson('packs/$name.json')),
    ];
