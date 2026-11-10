# ADR-001 — Fournisseurs SMS, USSD et paiement mobile money

## Statut
EN ATTENTE — decisions D-03 et D-07 requises.

## Contexte
Le MVP utilise des simulateurs pour SMS, USSD et paiement mobile money. Le pilote de Yaounde necessite des fournisseurs reels. Les interfaces dans le code sont generiques (pattern adaptateur), ce qui permet de brancher un fournisseur reel sans modifier le code metier.

## Interfaces existantes (apps/api/src/)

### SMS (notifications/providers/)
- `SmsProvider` : `send(to, text, opts?) → { messageId, segments, cost? }`
- Simulateur : log en base dans `outbound_messages`
- Manquant pour le reel : DLR (accuse de reception), SMS entrant, comptage segments GSM-7

### Paiement (billing/providers/)
- `PaymentProvider` : `initiate(phone, amount, currency, ref) → { transactionId, status }`
- Webhook : signature HMAC-SHA256 verifiee
- Simulateur : endpoints /dev/payments/:id/{confirm,fail}
- Manquant pour le reel : interrogation de statut, remboursement, rapprochement quotidien

### USSD (notifications/)
- Menu defini dans le pack pays (pays.CM)
- Gestion de session basique (inbound USSD POST)
- Manquant : timeout operateur, gestion d'erreur reseau

## Options

### SMS (D-07)

| Option | Avantages | Inconvenients |
|--------|-----------|---------------|
| **Orange API directe** | Meilleur cout, DLR natifs | Integration unique Orange, pas MTN |
| **MTN API directe** | Couverture MTN | Integration unique MTN, pas Orange |
| **Agregateur (Africa's Talking)** | Multi-operateur, sandbox, API unifiee | Cout intermediaire, dependance tiers |
| **Agregateur (Infobip)** | Multi-canal (SMS+WhatsApp), global | Plus cher, complexite |

### USSD (D-03)

| Option | Avantages | Inconvenients |
|--------|-----------|---------------|
| **Code court via Orange** | Direct, moins cher | Uniquement abonnes Orange |
| **Code court via agregateur** | Multi-operateur | Delai 4-8 semaines, cout mensuel |
| **SMS bidirectionnel** | Pas de code USSD requis | Moins ergonomique, cout SMS |

### Paiement mobile money (D-07)

| Option | Avantages | Inconvenients |
|--------|-----------|---------------|
| **Orange Money API** | Direct, sandbox dispo | Uniquement Orange Money |
| **MTN MoMo API** | Direct, sandbox dispo | Uniquement MTN MoMo |
| **Agregateur unique** | Les deux operateurs | Cout intermediaire, contrat unique |

## Recommandation
Agregateur unique (type Africa's Talking) pour SMS + USSD + paiement, avec fallback direct si le cout est prohibitif. Un seul contrat, une seule integration, couverture multi-operateur.

## Consequences
- Les interfaces sont pretes dans le code
- L'adaptateur reel = 1 fichier par fournisseur (~200 lignes)
- Bascule simulateur/reel par variable d'environnement (SMS_PROVIDER, PAYMENT_PROVIDER)
- Cles en variables d'environnement, jamais dans le code
