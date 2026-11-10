# RecallFarm — Questions en attente

Les agents ecrivent ici les questions qui bloquent ou ralentissent leur travail.
L'orchestrateur ou le proprietaire du produit repond et deplace la reponse dans le lot concerne.

## Decisions ouvertes (D-01 a D-10 du dossier)

| ID | Sujet | Statut | Reponse |
|----|-------|--------|---------|
| D-01 | Hebergement (pays, fournisseur) | **Decide 2026-11-10 (provisoire)** | Serveur RecallVet chez Infomaniak (Suisse) pour la recette, domaine recallfarm.com ; demenagement au Cameroun au passage en production reelle |
| D-02 | Drift vs sqflite_sqlcipher (mobile) | En attente | — |
| D-03 | Code court USSD (operateur, pays) | En attente (ne bloque plus le code) | Connecteur parametrable pret (ADR-002) : il suffira de decrire l'agregateur retenu |
| D-04 | Fournisseur WhatsApp Business | En attente | — |
| D-05 | Fournisseur vocal (IVR) | En attente | — |
| D-06 | Analytique : ClickHouse ou tables PG | En attente | — |
| D-07 | Agregateur SMS/paiement (Orange, MTN, agregateur unique) | En attente (ne bloque plus le code) | Connecteur parametrable pret (ADR-002) : n'importe quel agregateur se branche par fichier JSON |
| D-08 | Certification ISO 27001 : auditeur | En attente | — |
| D-09 | Polices embarquees ou Google Fonts | En attente | — |
| D-10 | Strategie de test sur appareils reels | En attente | — |

## Questions ouvertes — P1.1 / P1.2 integrations (agent integrations, 2026-11-10)

| ID | Question | Hypothese retenue en attendant |
|----|----------|--------------------------------|
| Q-INT-01 | Un remboursement (`POST /admin/payments/:id/refund`) doit-il retrograder ou raccourcir l'abonnement paye ? | Non : le paiement passe `rembourse`, l'abonnement n'est pas touche ; l'administrateur ajuste a la main. A trancher par le PO. |
| Q-INT-02 | « Parcours <= 3 ecrans » (P1.1, 02 E80) : l'ecran de fin compte-t-il ? E80 decrit lui-meme 4 affichages pour « confirmer un acte ». | 3 ecrans de saisie au plus (menu compris), le message de fin en plus ; les pages « 0. Suite » prolongent un meme ecran. |
| Q-INT-03 | Declaration de mortalite par USSD sur un lot de ponte : le formulaire du pack exige les oeufs du jour, la saisie echoue (« completez le journal dans l'application ») si aucun journal du jour n'existe. Faut-il un ecran « oeufs » ou rendre le champ facultatif pour le canal USSD ? | Comportement inchange (hors perimetre integrations) : a router vers moteurs-parametrage / backend-elevage. |
| Q-INT-04 | Qui peut rembourser ? | Administrateur plateforme seulement (`platform_admin`) ; lecture des paiements et rapports : `ops`, `support`. |
| Q-INT-05 | Pages officielles de l'agregateur (D-07) a citer dans l'ADR : aucun agregateur retenu. | Descripteur generique ; les pages seront citees avec le premier fichier de connecteur reel. |
| Q-INT-06 | Libelle « Suite » et textes du menu USSD : en dur en francais dans l'API (comme avant). Les passer en `message_template` du pack pays ? | `more.label` configurable par connecteur ; les textes du menu restent a migrer vers le pack. |
