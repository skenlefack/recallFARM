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

## Questions QA (2026-11-10, lot P0.4)

- **Q-QA-01** — Le dossier cite docs/dossier/ ; le depot contient doc-projets/RecallFarm-dossier-v2.2/. La matrice T-01..T-55 est suivie dans docs/plan/tracabilite-mvp.md sans modifier le dossier. Faut-il deplacer ou renommer le dossier ?
- **Q-QA-02** — EF-CON-03 demande « JSON + CSV » : seul le JSON existe. Livrer le CSV ou amender l exigence (decision PO) ?
- **Q-QA-03** — RG-ABO-01 prevoit une « lecture seule » des modules payants apres la grace ; le code retire les modules (retour a la formule Decouverte). Comportement voulu ?
- **Q-QA-04** — Cible de couverture des moteurs Dart : `flutter test --coverage` ne mesure que les lignes (pas les branches). Accepter 100 % des lignes comme equivalent de 100 % des branches, ou ajouter un outil de couverture de branches (ADR) ?


## Questions ouvertes — P1.1 / P1.2 integrations (agent integrations, 2026-11-10)

| ID | Question | Hypothese retenue en attendant |
|----|----------|--------------------------------|
| Q-INT-01 | Un remboursement (`POST /admin/payments/:id/refund`) doit-il retrograder ou raccourcir l'abonnement paye ? | Non : le paiement passe `rembourse`, l'abonnement n'est pas touche ; l'administrateur ajuste a la main. A trancher par le PO. |
| Q-INT-02 | « Parcours <= 3 ecrans » (P1.1, 02 E80) : l'ecran de fin compte-t-il ? E80 decrit lui-meme 4 affichages pour « confirmer un acte ». | 3 ecrans de saisie au plus (menu compris), le message de fin en plus ; les pages « 0. Suite » prolongent un meme ecran. |
| Q-INT-03 | Declaration de mortalite par USSD sur un lot de ponte : le formulaire du pack exige les oeufs du jour, la saisie echoue (« completez le journal dans l'application ») si aucun journal du jour n'existe. Faut-il un ecran « oeufs » ou rendre le champ facultatif pour le canal USSD ? | Comportement inchange (hors perimetre integrations) : a router vers moteurs-parametrage / backend-elevage. |
| Q-INT-04 | Qui peut rembourser ? | Administrateur plateforme seulement (`platform_admin`) ; lecture des paiements et rapports : `ops`, `support`. |
| Q-INT-05 | Pages officielles de l'agregateur (D-07) a citer dans l'ADR : aucun agregateur retenu. | Descripteur generique ; les pages seront citees avec le premier fichier de connecteur reel. |
| Q-INT-06 | Libelle « Suite » et textes du menu USSD : en dur en francais dans l'API (comme avant). Les passer en `message_template` du pack pays ? | `more.label` configurable par connecteur ; les textes du menu restent a migrer vers le pack. |


## Questions mobile-socle (P0.1, 2026-11-10)

| ID | Question | Contexte | Proposition |
|----|----------|----------|-------------|
| Q-MOB-01 | Accepter Android 7 (API 24) comme minimum au lieu d'Android 6 (API 23) ? | Mesure 2026-11-10 : avec minSdk 23 le build release echoue (« minSdkVersion 23 cannot be smaller than version 24 declared in library [:url_launcher_android] ») et Flutter 3.38 avertit que l'API 23 sera abandonnee. Forcer (`tools:overrideLibrary`) exposerait a des plantages. | **TRANCHE le 10/11/2026 par le proprietaire du produit : Android 7 minimum, minSdk 24 accepte** (`flutter.minSdkVersion`, deja applique). **TRANCHE 2026-11-10 par le proprietaire du produit : Android 7 (API 24) minimum.** |
| Q-MOB-02 | D-09 (polices embarquees ou Google Fonts) : tranche par le lot P0.1 ? | Le lot P0.1 §1 demande « embarque les polices (pas de telechargement a l'execution) » alors que D-09 est « En attente ». `GoogleFonts.getFont(nom)` conservait toute la table des ~1 500 familles dans libapp.so. | Polices embarquees (sous-ensemble latin, OFL) appliquees dans ce lot, ADR-003. A confirmer par le proprietaire du produit (D-09). |
| Q-MOB-03 | Dossier v2.2 absent du depot | `docs/dossier/` n'existe pas dans le depot : les ID ENF de performance/taille ne peuvent pas etre cites exactement (seul ENF-PER-04 « APK <= 25 Mo » apparait dans apps/mobile/README.md). | Ajouter le dossier au depot ou fournir les ID ENF de demarrage a froid et de synchro 2G. |


## Questions securite-conformite (CVE image API, 2026-11-12, branche fix/api-cve-high)

| ID | Question | Contexte | Hypothese / risque accepte temporaire |
|----|----------|----------|---------------------------------------|
| Q-SEC-01 | xlsx 0.18.5 (CVE-2023-30533 pollution de prototype, CVE-2024-22363 ReDoS, HIGH) : quelle remediation ? | Aucune version corrigee sur le registre npm (0.18.5 = derniere). Correctif officiel : `xlsx` 0.20.3 depuis `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (source hors registre : installation refusee par la politique de l'outil, decision humaine requise). Alternatives : retirer l'import `.xlsx` (CSV seul, deja supporte), ou remplacer la bibliotheque (nouvelle dependance = ADR). Atteignable : `POST /v1/imports` avec un fichier `.xlsx` -> `XLSX.read` sur contenu non fiable ; reserve aux gestionnaires d'organisation authentifies (`assertOrgManager` est appele en tete du handler, avant `XLSX.read`), 5 Mo max. | **TRANCHE 2026-11-13 par le proprietaire du produit : xlsx 0.20.3 depuis le CDN officiel SheetJS, empreinte figee (ADR-006), plus controle anti zip-bomb et lecture bornee a 20 000 lignes.** |
