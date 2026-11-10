import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/features/onboarding/consents_screen.dart';

import '../core/memory_db.dart';

void main() {
  // EF-CON / RG-CON-01: the queued body must match POST /me/consents (dossier 05):
  // the API refuses unknown fields with 422, so an extra field means no consent is ever stored.
  // (Cherry-picked from fix/ci-vague3 e5f49a3; uses a real in-memory LocalDb instead of FakeDb.)
  test('ConsentStore queues only contract fields, one record per change', () async {
    final db = await memoryLocalDb();
    final store = ConsentStore(db);

    await store.record({'cgu_confidentialite': true, 'messages_sms': false});
    await store.record({'cgu_confidentialite': true, 'messages_sms': true});

    final queued = await db.pendingActions();
    expect(queued, hasLength(3));
    for (final a in queued) {
      expect(a.payload['method'], 'POST');
      expect(a.payload['path'], '/me/consents');
      final body = Map<String, dynamic>.from(a.payload['body'] as Map);
      expect(body.keys.toSet(), {'id', 'scope', 'granted', 'text_version', 'channel'});
      expect(body['channel'], 'app');
    }
    expect([
      for (final a in queued) ((a.payload['body'] as Map)['scope'], (a.payload['body'] as Map)['granted'])
    ], [
      ('cgu_confidentialite', true),
      ('messages_sms', false),
      ('messages_sms', true),
    ]);
    expect(await store.load(), containsPair('messages_sms', true));
    await db.close();
  });
}
