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
- Limites connues : pas d'interrogation de statut de paiement ni de remboursement automatique
  (a ajouter au descripteur quand un agregateur sera retenu) ; pas de signature de requete sortante
  autre qu'OAuth2/bearer/basic (certains operateurs signent chaque requete : extension a prevoir).
- Le simulateur reste la valeur par defaut en developpement et en test.
- Les clients web et mobile proposent encore les deux moyens du pack CM en dur ; l'API accepte
  tout code de moyen present dans le pack pays (lecture dynamique via GET /plans a faire cote clients).
