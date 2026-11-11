import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/api/token_store.dart';
import 'package:recallfarm/core/router/app_router.dart';
import 'package:recallfarm/core/session/session.dart';

import 'memory_db.dart';

class _CountingSession extends AppSession {
  _CountingSession(super.db, super.tokens);
  int listeners = 0;

  @override
  void addListener(VoidCallback listener) {
    listeners++;
    super.addListener(listener);
  }

  @override
  void removeListener(VoidCallback listener) {
    listeners--;
    super.removeListener(listener);
  }
}

// Review m3: the router must not leave listeners on the session after dispose.
void main() {
  test('buildRouter: every session listener is removed by router.dispose()', () async {
    final db = await memoryLocalDb();
    final session = _CountingSession(db, TokenStore());
    final router = buildRouter(session, GlobalKey<NavigatorState>());
    expect(session.listeners, greaterThan(0));
    router.dispose();
    expect(session.listeners, 0);
    await db.close();
  });
}
