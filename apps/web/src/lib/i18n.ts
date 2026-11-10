/** Mini dictionnaire fr/en (le francais est la langue par defaut ; l'anglais est prepare par cles). */
export type Locale = 'fr' | 'en';

const DICT: Record<Locale, Record<string, string>> = {
  fr: {
    'pay.init.title': 'Paiement refusé',
    'pay.init.body': "Votre opérateur n'a pas accepté la demande. Aucun montant n'a été prélevé. Vérifiez le numéro puis réessayez.",
    'pay.pending.title': 'Paiement en cours de vérification',
    'pay.pending.body': "Nous n'avons pas pu joindre votre opérateur. Ne payez pas une deuxième fois : nous suivons votre paiement et vous prévenons dès qu'il est confirmé.",
    'pay.confirmed': 'Paiement confirmé.',
    'pay.sending': 'Envoi de la demande…',
    'pay.pay': 'Payer',
    'pay.retry': 'Réessayer',
    'pay.method.legend': 'Moyen de paiement',
    'pay.method.none': 'Aucun moyen de paiement disponible pour le moment.',
    'pay.method.loading': 'Chargement des moyens de paiement…',
    'pay.number': 'Numéro {method}',
    'pay.footnote': 'Paiement par {methods}. Les prix Structure dépendent du nombre d’éleveurs suivis.',
    'pay.footnote.none': 'Les prix Structure dépendent du nombre d’éleveurs suivis.',
  },
  en: {
    'pay.init.title': 'Payment declined',
    'pay.init.body': 'Your operator did not accept the request. Nothing was charged. Check the number and try again.',
    'pay.pending.title': 'Payment being checked',
    'pay.pending.body': 'We could not reach your operator. Do not pay twice: we are tracking your payment and will tell you as soon as it is confirmed.',
    'pay.confirmed': 'Payment confirmed.',
    'pay.sending': 'Sending the request…',
    'pay.pay': 'Pay',
    'pay.retry': 'Try again',
    'pay.method.legend': 'Payment method',
    'pay.method.none': 'No payment method available right now.',
    'pay.method.loading': 'Loading payment methods…',
    'pay.number': '{method} number',
    'pay.footnote': 'Pay with {methods}. Structure prices depend on the number of farmers followed.',
    'pay.footnote.none': 'Structure prices depend on the number of farmers followed.',
  },
};

let locale: Locale = 'fr';
export function setLocale(l: Locale): void {
  locale = l;
}

export function t(key: string, vars?: Record<string, string>): string {
  const raw = DICT[locale][key] ?? DICT.fr[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '') : raw;
}
