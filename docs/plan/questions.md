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
