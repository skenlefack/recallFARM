# Brancher un agregateur (SMS, WhatsApp, USSD, mobile money)

Aucun code a ecrire : on decrit le fournisseur dans un fichier JSON (voir ADR-002).
Exemple complet et valide : `providers.example.json` (les fournisseurs y sont fictifs).

## Etapes
1. Lire la documentation officielle de l'agregateur (envoi SMS, SMS entrants, accuses de reception,
   USSD, collecte mobile money, webhooks, signature).
2. Copier `providers.example.json` en `providers.json` (hors du depot sur le serveur) et adapter :
   - `base_url`, `auth` : comment s'authentifier ;
   - `sms.send.body` : le corps attendu, avec les variables ci-dessous ;
   - `sms.send.result.ref` : ou se trouve l'identifiant du message dans la reponse ;
   - `sms.inbound`, `sms.dlr`, `ussd.inbound` : noms des champs que l'agregateur nous envoie ;
   - `payment.initiate` et `payment.webhook.status_map` : statuts de l'agregateur → `confirme`, `echoue`, `en_attente` ;
   - `inbound_auth` : secret ou signature que l'agregateur joint a ses appels (obligatoire pour le paiement).
3. Mettre les secrets dans `.env` (`${env:NOM}` dans le fichier).
4. Dans `.env` : `PROVIDERS_CONFIG_FILE=/run/providers/providers.json`, `PUBLIC_API_URL=https://...`
   puis `SMS_PROVIDER=connector` et/ou `PAYMENT_PROVIDER=connector`.
5. Redemarrer l'API : si le fichier est faux, elle refuse de demarrer et liste les erreurs en francais.
6. Tester : `POST /v1/admin/connectors/<nom>/test-sms {"phone":"+237..."}` (administrateur plateforme).
7. Declarer chez l'agregateur les URL de rappel :
   `https://<api>/v1/connectors/<nom>/sms` · `/dlr` · `/ussd` · `/payment`.

## Variables disponibles dans les gabarits
| Canal | Variables |
|---|---|
| SMS / WhatsApp | `to` (au format `phone_format`), `to_e164`, `text`, `sender`, `segments`, `encoding` (gsm7/ucs2), `message_id` |
| Paiement | `payment_id`, `reference` (= payment_id), `amount_minor` (entier), `amount` (unite principale, texte), `currency`, `phone`, `phone_e164`, `method`, `description`, `callback_url`, `return_url` |
| Reponse USSD (`type: json`) | `message`, `continue` (booleen), `session_id` |

`"{{amount_minor}}"` seul dans une valeur garde le type nombre ; `"x-{{amount}}"` produit du texte.
Montants : toujours en unite mineure ISO 4217 ; `amount` est calcule sans virgule flottante.
