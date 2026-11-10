import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/params/expr/expression.dart';

import 'vectors.dart';

void main() {
  final vectors = loadJson('vectors/expressions.json');
  final context = Map<String, Object?>.from(vectors['context'] as Map);
  final cases = (vectors['cases'] as List).cast<Map<String, dynamic>>();

  group('expressions.json (shared vectors)', () {
    for (final c in cases) {
      final expr = c['expr'] as String;
      test(expr, () {
        final r = Expressions.evaluate(expr, context);
        if (c.containsKey('error')) {
          expect(r.ok, isFalse, reason: 'expected error ${c['error']}, got $r');
          expect(r.error, c['error']);
        } else {
          expect(r.ok, isTrue, reason: 'unexpected error $r');
          expect(deepEquals(r.value, c['value']), isTrue,
              reason: 'expected ${c['value']}, got ${r.value}');
        }
      });
    }
  });

  group('extra expression behaviour', () {
    test('budget is enforced', () {
      // Flat list literal: 1 + 10 001 evaluated nodes > 10 000 budget, no deep recursion.
      final big = '[${List.filled(10001, '1').join(', ')}]';
      expect(Expressions.evaluate(big, const {}).error, 'budget');
    });
    test('missing field on null is null', () {
      expect(Expressions.evaluate('a.b.c', const {}).value, isNull);
    });
    test('unterminated string is a syntax error', () {
      expect(Expressions.evaluate("'abc", const {}).error, 'syntax');
    });
    test('laying rate form expression', () {
      final r = Expressions.evaluate(
        'log.present_count > 0 && has(log.eggs) ? round(log.eggs / log.present_count * 100, 1) : null',
        {
          'log': {'present_count': 1978, 'eggs': 1512}
        },
      );
      expect(r.value, 76.4);
    });
  });
}
