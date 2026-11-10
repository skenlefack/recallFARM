import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'vectors.dart';

/// The app bundles a copy of packages/params/packs in assets/packs for first-run
/// offline use. This test fails when the copies drift from the source of truth.
void main() {
  for (final name in const ['global.core', 'filiere.volaille', 'filiere.canin', 'pays.CM']) {
    test('assets/packs/$name.json is identical to packages/params', () {
      final source = File('$kParamsRoot/packs/$name.json').readAsStringSync();
      final bundled = File('assets/packs/$name.json').readAsStringSync();
      expect(bundled, source, reason: 'run: cp ../../packages/params/packs/*.json assets/packs/');
    });
  }
}
