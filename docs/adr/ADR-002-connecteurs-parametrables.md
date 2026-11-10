# ADR-002 — Connecteurs parametrables pour SMS, WhatsApp, USSD et mobile money

## Statut
ACCEPTE — 2026-11-10. Remplace la partie "un adaptateur par fournisseur" d'ADR-001.

## Contexte
Les decisions D-07 (agregateur SMS / paiement) et D-03 (code court USSD) bloquent P1.1, P1.2 et P1.6.
Le proprietaire du produit veut pouvoir brancher plus tard **n'importe quel agregateur** sans
nouveau developpement, comme les regles d'espece et de pays sont deja des packs.

## Decision
Un fournisseur est decrit par un **fichier JSON de connecteur**, pas par du code :
- requete sortante : URL, methode, format (json / formulaire), en-tetes, corps a gabarits `{{variable}}` ;
- authentification : aucune, bearer, basic, en-tete, parametre d'URL, OAuth2 client credentials (jeton mis en cache) ;
- lecture de la reponse par chemins (`data.id`), regle de succes (codes HTTP + champ metier) ;
- appels entrants (SMS recu, accuse de reception, etape USSD, resultat de paiement) : correspondance
  des champs, table de statuts, controle par secret partage ou signature HMAC SHA-256 / SHA-512 ;
- routage : quel connecteur pour `sms`, `whatsapp`, `ussd`, et pour chaque moyen de paiement du pack pays.

Les secrets ne sont jamais dans le fichier : `${env:NOM}` est lu dans l'environnement. Au demarrage,
la configuration est validee (structure + variables presentes) et l'API refuse de demarrer si elle est fausse.

Activation : `SMS_PROVIDER=connector`, `WHATSAPP_PROVIDER=connector`, `PAYMENT_PROVIDER=connector`,
avec `PROVIDERS_CONFIG_FILE=/chemin/providers.json` (ou `PROVIDERS_CONFIG` en JSON).
URL de rappel par connecteur : `/v1/connectors/<nom>/{sms,dlr,ussd,payment}`.

## Consequences
- Choisir un agregateur (D-07, D-03) devient une tache d'exploitation : ecrire son fichier a partir de
  sa documentation officielle, tester avec `POST /v1/admin/connectors/<nom>/test-sms`, puis router.
- Aucune dependance nouvelle (fetch natif de Node 22, crypto).
- Limites connues : pas de signature de requete sortante autre qu'OAuth2/bearer/basic (certains
  operateurs signent chaque requete : extension a prevoir) ; la liste des transactions du
  rapprochement est lue en une seule page ; les corps `text/plain` entrants ne sont pas lus.
- Le simulateur reste la valeur par defaut en developpement et en test.

## Complements P1.1 / P1.2 (2026-11-10, revue M5, M6, m3-m15)
Toujours sans code par fournisseur ni dependance nouvelle :
- **USSD** : `ussd.inbound.text_mode` = `cumulative` (`1*2*4821`) ou `last` (derniere saisie seule) ;
  l'etat de session est garde cote serveur (Redis si `REDIS_URL`, sinon table `ussd_sessions`,
  `session_ttl_s` = 180 s par defaut). Ecrans de `max_chars` (160) au plus, pagines par
  « 0. Suite » (`more`). Une relance identique de l'agregateur rejoue l'ecran sans refaire l'action.
  Reponse : prefixes texte libres (`continue_prefix`/`end_prefix`), ou gabarit JSON dont
  `{{continue}}` vaut `continue_values.continue`/`end` (`true`/`false`, `"CON"`/`"END"`, `"request"`/`"end"`...),
  en-tetes a gabarit (`Freeflow: FC/FB`).
- **Paiement** : operations facultatives `payment.status` (interrogation), `payment.refund`
  (remboursement, cle `{{refund_id}}` stable) et `payment.list` (transactions du jour pour le
  rapprochement). Paiement reste en attente : interrogations a N, 2N, 4N... minutes plafonnees,
  puis statut `a_verifier` visible de l'administration. Rapprochement quotidien stocke
  (`payment_reconciliations`). Checkout idempotent (`id` UUID v4 client ou `Idempotency-Key`).
- **Signatures entrantes** : `timestamp_header` + `tolerance_s` + `signed_payload`
  (`"{{timestamp}}.{{body}}"`) ; une signature n'est acceptee qu'une fois dans la fenetre (anti-rejeu).
- **Accuses de reception** : rattaches au connecteur et au canal (`/dlr?channel=whatsapp`), statut
  jamais en recul ; `{{message_id}}` = id de notre journal (cle d'idempotence chez l'agregateur).
- Sources consultees : aucun agregateur n'est encore retenu (D-03, D-07). Les formats prevus
  couvrent les familles d'API publiques courantes (saisie USSD cumulee type « CON/END », saisie
  derniere etape avec indicateur de session `FC/FB` ou `request/end`, paiements push USSD avec
  requete de statut et remboursement). Les pages officielles de l'agregateur retenu seront citees ici
  lors de l'ecriture de son fichier de connecteur (voir docs/plan/questions.md).
- Les clients web et mobile proposent encore les deux moyens du pack CM en dur ; l'API accepte
  tout code de moyen present dans le pack pays (lecture dynamique via GET /plans a faire cote clients).
