import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// Golden images are generated and compared on Linux, the CI platform: text
/// rasterisation differs between operating systems (1-3 % of pixels), so a
/// golden can only be exact on one of them.
///
/// - Linux (CI, or the docker command in README): strict pixel comparison.
/// - Other OS: a pixel difference is reported as a warning, not a failure.
///   Overflow and tap-target assertions of the golden tests stay strict.
/// - RF_GOLDENS_STRICT=true forces the strict comparison everywhere.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  final strict = Platform.isLinux || Platform.environment['RF_GOLDENS_STRICT'] == 'true';
  if (!strict && goldenFileComparator is LocalFileComparator) {
    final base = (goldenFileComparator as LocalFileComparator).basedir;
    goldenFileComparator = _NonReferencePlatformComparator(base.resolve('flutter_test_config.dart'));
  }
  await testMain();
}

class _NonReferencePlatformComparator extends LocalFileComparator {
  _NonReferencePlatformComparator(super.testFile);

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final result = await GoldenFileComparator.compareLists(imageBytes, await getGoldenBytes(golden));
    if (!result.passed) {
      debugPrint(
        'AVERTISSEMENT golden $golden : ${(result.diffPercent * 100).toStringAsFixed(2)} % de pixels differents '
        'sur ${Platform.operatingSystem} (reference Linux, comparaison stricte en CI).',
      );
    }
    result.dispose();
    return true;
  }
}
