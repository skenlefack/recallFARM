import 'package:flutter/widgets.dart';

import '../../core/i18n/strings.dart';

/// Strings of the subscription screen (EF-ABO-01/02). Kept next to the screen
/// until they are merged into core/i18n (see docs/plan/requests.md).
/// French is the source; English falls back to French, then to the core catalogue.
const Map<String, String> kSubStringsFr = {
  'pay_method': 'Moyen de paiement',
  'pay_no_method': 'Aucun moyen de paiement disponible pour votre pays.',
  'pay_sending': 'Envoi de la demande…',
  'pay_refused': 'Paiement non lancé. Rien n\'a été débité. Réessayez dans quelques minutes.',
  'pay_pending_check':
      'Paiement en cours de vérification. Ne relancez pas : nous vous prévenons dès sa confirmation.',
  'pay_still_pending':
      'Toujours en vérification. Ne payez pas une seconde fois. Revenez plus tard ou vérifiez maintenant.',
  'pay_check_now': 'Vérifier maintenant',
  'pay_connection_lost':
      'Connexion perdue. Si une demande est arrivée sur votre téléphone, validez-la ; sinon réessayez.',
  'pay_offline_follow': 'Hors ligne : le suivi reprendra au retour du réseau.',
  'pay_phone_invalid': 'Entrez un numéro de téléphone valide.',
  'plans_retry': 'Réessayer',
};

const Map<String, String> kSubStringsEn = {
  'pay_method': 'Payment method',
  'pay_no_method': 'No payment method available for your country.',
  'pay_sending': 'Sending the request…',
  'pay_refused': 'Payment not started. Nothing was charged. Try again in a few minutes.',
  'pay_pending_check': 'Payment being checked. Do not retry: we will tell you as soon as it is confirmed.',
  'pay_still_pending': 'Still being checked. Do not pay twice. Come back later or check now.',
  'pay_check_now': 'Check now',
  'pay_connection_lost': 'Connection lost. If a request reached your phone, approve it; otherwise try again.',
  'pay_offline_follow': 'Offline: tracking resumes when the network is back.',
  'pay_phone_invalid': 'Enter a valid phone number.',
  'plans_retry': 'Retry',
};

extension SubTr on BuildContext {
  /// Looks in the subscription catalogue first, then in the core catalogue.
  String trSub(String key, [Map<String, Object?> params = const {}]) {
    final en = lang == 'en';
    final own = (en ? kSubStringsEn[key] : null) ?? kSubStringsFr[key];
    if (own == null) return tr(key, params);
    var s = own;
    params.forEach((k, v) => s = s.replaceAll('{$k}', '${v ?? ''}'));
    return s;
  }
}
