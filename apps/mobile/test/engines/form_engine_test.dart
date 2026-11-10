import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/params/form_engine.dart';
import 'package:recallfarm/core/params/resolution.dart';

import 'vectors.dart';

void main() {
  final res = Resolver.resolve(Resolver.selectPacks(
    loadBasePacks(),
    const FarmScope(country: 'CM', speculations: ['volaille', 'chien']),
  ));

  FormEngine engine(String code) => FormEngine(FormSpec.fromJson(res.get('form', code)!));

  test('daily log (ponte): visibility, required_if and computed laying rate', () {
    final e = engine('daily_log_volaille');
    final values = {...e.initialValues(), 'eggs': 1512, 'feed_kg': '236'};
    final ev = e.evaluate(values, context: {
      'subject': {'production_type': 'ponte'},
      'log': {'present_count': 1978},
    });
    expect(ev.isVisible('eggs'), isTrue);
    expect(ev.isRequired('eggs'), isTrue);
    expect(ev.isVisible('avg_weight_g'), isFalse);
    expect(ev.computed['laying_rate'], 76.4);
    expect(ev.isValid, isTrue, reason: ev.errors.toString());
    final payload = e.toPayload(values, ev);
    expect(payload['eggs'], 1512);
    expect(payload['feed_kg'], 236.0);
    expect(payload['mortality'], 0);
    expect((payload['attributes'] as Map)['behaviour'], 'normal');
    expect(payload.containsKey('laying_rate'), isFalse);
  });

  test('daily log (chair): eggs hidden, not required', () {
    final e = engine('daily_log_volaille');
    final ev = e.evaluate(e.initialValues(), context: {
      'subject': {'production_type': 'chair'},
      'log': {'present_count': 197},
    });
    expect(ev.isVisible('eggs'), isFalse);
    expect(ev.isRequired('eggs'), isFalse);
    expect(ev.isVisible('avg_weight_g'), isTrue);
    expect(ev.isValid, isTrue);
  });

  test('dog form: required, rfid and bounds', () {
    final e = engine('dog');
    var ev = e.evaluate({'chip_number': '12345', 'weight_kg': '200'});
    expect(ev.errors['name']?.code, 'required');
    expect(ev.errors['sex']?.code, 'required');
    expect(ev.errors['chip_number']?.code, 'rfid');
    expect(ev.errors['weight_kg']?.code, 'max');
    ev = e.evaluate({
      'name': 'Rex',
      'sex': 'M',
      'chip_number': '120 093 000 418 271',
      'weight_kg': '34,2',
      'birth_date': '2023-06-10',
    });
    expect(ev.isValid, isTrue, reason: ev.errors.toString());
    final payload = e.toPayload({
      'name': 'Rex',
      'sex': 'M',
      'chip_number': '120 093 000 418 271',
      'weight_kg': '34,2',
      'role': 'pension',
    }, ev);
    expect(payload['chip_number'], '120093000418271');
    expect((payload['attributes'] as Map)['weight_kg'], 34.2);
    expect((payload['attributes'] as Map)['role'], 'pension');
    final back = e.valuesFromRecord(payload);
    expect(back['weight_kg'], 34.2);
    expect(back['name'], 'Rex');
  });

  test('number parsing accepts french formats', () {
    expect(FormEngine.parseNumber('1 512'), 1512);
    expect(FormEngine.parseNumber('1 512,5'), 1512.5);
    expect(FormEngine.parseNumber('abc'), isNull);
  });
}
