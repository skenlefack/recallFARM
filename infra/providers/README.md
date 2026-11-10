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
| Reponse USSD (`text` ou `json`, et `headers`) | `message`, `continue` (valeur de `continue_values`, par defaut `true`/`false` en JSON, `CON`/`END` en texte), `session_id` |
| Statut de paiement (`payment.status`) | `payment_id`, `reference`, `provider_ref`, `amount_minor`, `amount`, `currency`, `phone`, `phone_e164`, `method` |
| Remboursement (`payment.refund`, `payment.refund_status`) | les memes + `refund_id` (cle d'idempotence stable pour le paiement, **obligatoire** dans le gabarit), `reason` ; `refund_ref` pour `refund_status` |
| Liste du jour (`payment.list`) | `date` (AAAA-MM-JJ, fuseau du pays), `from`, `to` (UTC ISO 8601) |

`"{{amount_minor}}"` seul dans une valeur garde le type nombre ; `"x-{{amount}}"` produit du texte.
Montants : toujours en unite mineure ISO 4217 ; `amount` est calcule sans virgule flottante.
Cout d'un SMS : garde seulement avec sa devise (`sms.send.result.currency` ou `sms.cost.currency`).

## USSD
| Champ | Role | Defaut |
|---|---|---|
| `ussd.inbound.text_mode` | `cumulative` : l'agregateur envoie toute la saisie (`1*2*4821`) ; `last` : seulement la derniere | `cumulative` |
| `ussd.inbound.separator` | separateur de la saisie cumulee | `*` |
| `ussd.max_chars` | taille maximale d'un ecran ; au-dela, pages terminees par « 0. Suite » | 160 |
| `ussd.session_ttl_s` | duree de vie de la session cote serveur (Redis ou table `ussd_sessions`) | 180 |
| `ussd.more` | touche et libelle de la page suivante | `{"key":"0","label":"Suite"}` |
| `ussd.response` | `{"type":"text","continue_prefix":"CON ","end_prefix":"END "}` ou `{"type":"json","body":{...},"continue_values":{"continue":"request","end":"end"}}` ; `headers` facultatifs (ex. `{"Freeflow":"{{continue}}"}` avec `continue_values` `FC`/`FB`) | texte `CON `/`END ` |

Chaque parcours du menu demande au plus 3 ecrans de saisie (menu compris) avant le message de fin.
Les sauts d'une meme session sont traites un par un (verrou de session : Redis, sinon verrou
consultatif PostgreSQL). Apres l'ecran de fin, tout nouveau saut de la session renvoie cet ecran
sans refaire l'action ; une relance identique (saisie cumulee) aussi. Une etape interrompue entre
l'action et l'enregistrement n'est jamais rejouee (« Saisie deja recue »). L'apostrophe
typographique est remplacee par l'apostrophe droite (GSM-7).

## Paiement : operations facultatives
- `payment.status` : requete de statut. **Interroger par notre reference** (`{{reference}}`) quand
  l'agregateur le permet : un paiement dont l'initiation a expire n'a pas de `provider_ref`, et une
  requete qui en a besoin n'est pas envoyee (le paiement reste « non interrogeable », sans conclusion).
  Un paiement sans issue est interroge a partir de
  `PAYMENT_STATUS_AFTER_MIN` minutes (5), puis a N, 2N, 4N... minutes plafonnees a
  `PAYMENT_STATUS_BACKOFF_CAP_MIN` (60) ; apres `PAYMENT_STATUS_MAX_ATTEMPTS` (6) essais, il passe
  a `a_verifier` (liste : `GET /v1/admin/payments?status=a_verifier`). Une confirmation tardive
  l'active toujours. Sans `payment.status`, le paiement passe a `a_verifier` au meme rythme.
- `payment.refund` : `POST /v1/admin/payments/:id/refund {"reason": "..."}` (administrateur
  plateforme), journalise dans `audit_log`. `{{refund_id}}` est obligatoire (url, en-tete ou corps).
  Un seul appel a la fois : une seconde demande pendant l'appel ou pendant un remboursement en
  attente recoit 409 `PAY-REFUND-IN-PROGRESS`. L'issue se lit seulement comme le descripteur le dit :
  `result.status_map` sur le corps, puis `result.http_map` sur le code HTTP (ex. `{"409": "rembourse"}`
  pour « deja rembourse ») ; sinon un 2xx vaut `en_attente` et tout autre code est inconnu (jamais
  un succes ni un refus par defaut). En attente ou inconnu : `payment.refund_status` (facultatif)
  est interroge par la tache planifiee ; sans lui, le remboursement est marque `a_verifier`.
  Une relance apres une issue inconnue reutilise le meme `refund_id`.
- `payment.list` : transactions du jour pour le rapprochement quotidien (produit apres
  `PAYMENT_RECONCILE_AT`, 02:00 heure du pays, pour la veille ; `GET /v1/admin/payments/reconciliations`).
  Sans liste, chaque paiement du jour est verifie par `payment.status` ; sans les deux, le
  connecteur apparait dans `non_verifies`.
- Checkout : le client envoie `id` (UUID v4 qu'il cree) ou l'en-tete `Idempotency-Key` ; un double
  envoi renvoie le meme paiement sans second appel a l'agregateur.

## Appels entrants
- `inbound_auth` HMAC : ajouter de preference `timestamp_header` (secondes, millisecondes ou ISO 8601),
  `tolerance_s` (300) et `signed_payload` (ex. `"{{timestamp}}.{{body}}"`) : un appel trop ancien
  est refuse (401). Un appel signe deja traite recoit la reponse habituelle (200, meme accuse ou meme
  ecran USSD) sans etre retraite ; si le traitement a echoue, la signature est liberee et la relance
  de l'agregateur est traitee. Sans Redis, la memoire anti-rejeu est propre a chaque instance :
  suffisant pour le pilote mono-instance, `REDIS_URL` obligatoire au-dela (un saut USSD rejoue sur une
  autre instance ne serait pas reconnu). Sans horodatage, un rejeu reste possible ; paiements et
  accuses restent sans effet (idempotents).
- Un connecteur inconnu recoit le meme 401 qu'un mauvais secret.
- `/sms` et `/dlr` acceptent aussi GET (parametres d'URL). Les corps JSON et formulaire sont lus,
  pas `text/plain`. Accuses WhatsApp : `/dlr?channel=whatsapp` (format `whatsapp.dlr`).
- Eviter `inbound_auth.type = "query"` : le secret finit dans les journaux du proxy.
