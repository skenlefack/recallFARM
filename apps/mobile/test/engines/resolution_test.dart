import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/params/resolution.dart';

import 'vectors.dart';

Object? _path(Map<String, dynamic> obj, String dotted) {
  Object? cur = obj;
  for (final part in dotted.split('.')) {
    if (cur is Map) {
      cur = cur[part];
    } else {
      return null;
    }
  }
  return cur;
}

void main() {
  final base = loadBasePacks();
  final vectors = loadJson('vectors/resolution.json');
  final cases = (vectors['cases'] as List).cast<Map<String, dynamic>>();

  group('resolution.json (shared vectors)', () {
    for (final c in cases) {
      test(c['name'] as String, () {
        final farm = c['farm'] as Map<String, dynamic>;
        final scope = FarmScope(
          country: farm['country'] as String,
          speculations: (farm['speculations'] as List).cast<String>(),
        );
        final org = c['org_pack'] is Map
            ? [ParamPack.fromJson(Map<String, dynamic>.from(c['org_pack'] as Map))]
            : <ParamPack>[];
        final packs = Resolver.selectPacks(base, scope, orgPacks: org);
        final res = Resolver.resolve(
          packs,
          farmSettings: c['farm_settings'] is Map
              ? Map<String, dynamic>.from(c['farm_settings'] as Map)
              : null,
        );
        final expected = c['expect'] as Map<String, dynamic>;

        if (expected.containsKey('param_version')) {
          expect(res.paramVersion, expected['param_version']);
        }
        final kindCode = expected['kind_code'] as String?;
        final obj = kindCode == null ? null : res.objects[kindCode];
        if (kindCode != null) {
          expect(obj, isNotNull, reason: 'object $kindCode not resolved');
        }
        for (final e in expected.entries) {
          switch (e.key) {
            case 'kind_code':
            case 'param_version':
              break;
            case 'rejected':
              expect(
                res.rejected.map((r) => r.toJson()).toList(),
                (e.value as List).map((x) => Map<String, dynamic>.from(x as Map)).toList(),
              );
              break;
            case 'step_codes':
              {
                final steps = (obj!['steps'] as List).cast<Map>();
                expect(steps.map((s) => s['code']).toList(), e.value);
                break;
              }
            case 'step_offsets':
              {
                final steps = (obj!['steps'] as List).cast<Map>();
                (e.value as Map).forEach((code, offset) {
                  final step = steps.firstWhere((s) => s['code'] == code);
                  expect(step['offset_days'], offset, reason: 'offset of $code');
                });
                break;
              }
            default:
              // dotted property path on the resolved object
              expect(_path(obj!, e.key), e.value, reason: e.key);
          }
        }
      });
    }
  });

  test('provenance records the last retained level', () {
    final packs = Resolver.selectPacks(
      base,
      const FarmScope(country: 'CM', speculations: ['chien']),
    );
    final res = Resolver.resolve(packs);
    expect(res.provenance['vaccination_protocol:chien_cm']!['steps'], 'pays.CM@1.0.0');
    expect(res.label('rage', 'en'), 'Rabies');
    expect(res.label('puce', 'en'), 'Microchip (15 digits)');
    expect(res.label('robe', 'en'), 'Robe'); // falls back to fr
  });
}
