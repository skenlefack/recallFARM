import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver.dart';

/// Host driver for `flutter drive` (used when the test APK is built separately,
/// e.g. Gradle `--offline`): writes `binding.reportData` (measures) to
/// build/integration_response_data.json and prints it.
///
/// flutter drive --driver=integration_test/driver/integration_test_driver.dart \
///   --target=integration_test/offline_sync_test.dart --use-application-binary=<apk> -d emulator-5554
Future<void> main() => integrationDriver(
      responseDataCallback: (data) async {
        if (data == null) return;
        final out = File('build/integration_response_data.json');
        await out.create(recursive: true);
        await out.writeAsString(const JsonEncoder.withIndent('  ').convert(data));
        stdout.writeln('reportData: ${jsonEncode(data)}');
      },
    );
