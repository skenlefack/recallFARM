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

## Questions mobile-socle (P0.1, 2026-11-10)

| ID | Question | Contexte | Proposition |
|----|----------|----------|-------------|
| Q-MOB-01 | Accepter Android 7 (API 24) comme minimum au lieu d'Android 6 (API 23) ? | Mesure 2026-11-10 : avec minSdk 23 le build release echoue (« minSdkVersion 23 cannot be smaller than version 24 declared in library [:url_launcher_android] ») et Flutter 3.38 avertit que l'API 23 sera abandonnee. Forcer (`tools:overrideLibrary`) exposerait a des plantages. | Applique : minSdk = 24 (`flutter.minSdkVersion`). A valider par le proprietaire du produit ; alternative couteuse : figer url_launcher_android et Flutter. |
| Q-MOB-02 | D-09 (polices embarquees ou Google Fonts) : tranche par le lot P0.1 ? | Le lot P0.1 §1 demande « embarque les polices (pas de telechargement a l'execution) » alors que D-09 est « En attente ». `GoogleFonts.getFont(nom)` conservait toute la table des ~1 500 familles dans libapp.so. | Polices embarquees (sous-ensemble latin, OFL) appliquees dans ce lot, ADR-003. A confirmer par le proprietaire du produit (D-09). |
| Q-MOB-03 | Dossier v2.2 absent du depot | `docs/dossier/` n'existe pas dans le depot : les ID ENF de performance/taille ne peuvent pas etre cites exactement (seul ENF-PER-04 « APK <= 25 Mo » apparait dans apps/mobile/README.md). | Ajouter le dossier au depot ou fournir les ID ENF de demarrage a froid et de synchro 2G. |
