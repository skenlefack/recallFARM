import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/features/onboarding/consents_screen.dart';

import '../widgets/harness.dart';

void main() {
  // EF-CON / RG-CON-01: the queued body must match POST /me/consents (dossier 05):
  // the API refuses unknown fields with 422, so an extra field means no consent is ever stored.
  test('ConsentStore queues only contract fields, one record per change', () async {
    final db = FakeDb();
    final store = ConsentStore(db);

    await store.record({'cgu_confidentialite': true, 'messages_sms': false});
    await store.record({'cgu_confidentialite': true, 'messages_sms': true});

    expect(db.queued, hasLength(3));
    for (final (method, path, body) in db.queued) {
      expect(method, 'POST');
      expect(path, '/me/consents');
      expect(body!.keys.toSet(), {'id', 'scope', 'granted', 'text_version', 'channel'});
      expect(body['channel'], 'app');
    }
    expect([for (final q in db.queued) (q.$3!['scope'], q.$3!['granted'])], [
      ('cgu_confidentialite', true),
      ('messages_sms', false),
      ('messages_sms', true),
    ]);
    expect(await store.load(), containsPair('messages_sms', true));
  });
}
