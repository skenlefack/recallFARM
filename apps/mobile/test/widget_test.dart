// Kept so that `flutter create .` (CI bootstrap) does not generate its default
// counter test. Real tests live in test/engines and test/widgets.
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/i18n/strings.dart';

void main() {
  test('i18n falls back from English to French, then to the key', () {
    expect(const S('en').t('nav_home'), 'Home');
    expect(const S('en').t('consent_messages_sms_desc'), 'Reminders D-7, D-1, D-day, D+3.');
    expect(const S('en').t('err_withdrawal', {'date': 'x'}), contains('x'));
    expect(const S('fr').t('no_such_key'), 'no_such_key');
    expect(const S('fr').t('pending_sync_many', {'n': 3}), '3 saisies seront envoyées au retour du réseau.');
  });
}
