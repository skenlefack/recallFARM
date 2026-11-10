# 16 — Organisation, méthodes de développement et registre des décisions (v2.2)

> Version 2.2 — 27/10/2026. **Nouveau fichier.** Il reprend la section 12 du document conceptuel et fixe les règles de travail communes à toute l'équipe, interne ou prestataire.

## 1. Équipe et effort (estimation à confirmer par appel d'offres)

| Rôle | MVP (≈ 3 mois) | V1 (≈ 3 mois) | V2 resserrée (≈ 6 mois) | V3 |
|---|---|---|---|---|
| Chef de produit / chef de projet | 1 | 1 | 1 | 1 |
| Architecte, responsable technique | 1 | 1 | 1 | 1 |
| Développeurs mobiles (Flutter) | 2 | 2 | 2 | 2 |
| Développeurs serveur (NestJS) | 2 | 2 | 3 | 3 |
| Développeur web (PWA, studio) | 0,5 | 1 | 1 | 1 |
| UX/UI et recherche terrain | 1 | 1 | 0,5 | 0,5 |
| Testeur (QA, appareils réels) | 1 | 1 | 1 | 1 |
| DevOps et sécurité | 0,5 | 0,5 | 1 | 1 |
| Ingénieur IoT et vidéo | — | — | 1 | 2 |
| Data et IA (alertes prédictives, assistant) | — | — | — | 1 |
| Référents métier (vétérinaire, zootechniciens) | 0,3 | 0,5 | 0,5 | 0,5 |
| DPO | 0,2 | 0,2 | 0,2 | 0,2 |
| **Jours-homme (20 jours par mois)** | **≈ 570** | **≈ 600** | **≈ 350 à 1 440** selon le périmètre | à chiffrer |

**Budget indicatif MVP + V1 + V2 resserrée** : ≈ 1 500 jours-homme, soit 75 à 150 M FCFA pour un taux journalier de 50 000 à 100 000 FCFA (hypothèse). C'est 2,5 à 5 fois les 30 M FCFA du modèle financier v2.1 ; le modèle v2.2 rend ce facteur paramétrable (`06`, cellule B30).

## 2. Instances de gouvernance

| Instance | Membres | Fréquence | Décide |
|---|---|---|---|
| Comité de pilotage | fondateur, chef de produit, prestataire, financeurs | mensuel | périmètre, budget, jalons, décisions de passage |
| Comité produit | chef de produit, responsable technique, UX, référent | toutes les 2 semaines (fin de sprint) | priorités, acceptation des user stories |
| Comité scientifique | épidémiologiste vétérinaire (Jean-Marc), zootechniciens par filière, service vétérinaire du pays pilote | trimestriel et à chaque pack | publication des packs `global`, `filiere` et `pays` |
| Comité données et éthique | DPO, juriste, représentant des éleveurs | semestriel | consentements, partages, conventions, analyses d'impact |
| Comité d'architecture | responsable technique, développeurs principaux, DevOps | mensuel et à la demande | décisions d'architecture (ADR) |

## 3. Méthode
- **Scrum** en sprints de 2 semaines : planification, point quotidien de 15 min, revue avec démonstration sur appareil réel, rétrospective.
- **Carnet de commandes** dans un outil de suivi (Jira, Linear ou GitLab Issues), structuré en epics = modules de `01`. Chaque user story référence ses exigences (EF-…) et ses tests (T-…), ce qui alimente la matrice de traçabilité de `11`.
- **Definition of Ready** : critères d'acceptation écrits ; écran maquetté s'il y en a un ; données identifiées dans `03` ; endpoint identifié dans `05` ; paramètres identifiés (pack, objet) ; dépendances levées.
- **Definition of Done** :
  - code relu par au moins une personne ;
  - tests unitaires et d'intégration écrits et au vert ;
  - couverture des moteurs ≥ 85 % (≥ 70 % pour le reste) ;
  - contrat OpenAPI à jour ;
  - libellés externalisés (fr/en) ;
  - accessibilité vérifiée ;
  - fonctionnement hors ligne testé ;
  - journalisation et métriques en place ;
  - documentation mise à jour ;
  - démonstration acceptée par le chef de produit.

## 4. Organisation du code

**Monorepo** (pnpm et Melos, ou Nx), une seule source pour les schémas et les moteurs :

| Dossier | Contenu |
|---|---|
| `apps/mobile` | Flutter |
| `apps/web` | PWA React : tableaux de bord, studio |
| `apps/api` | NestJS, modules par domaine (`04` §3) |
| `apps/camera-service` | service vidéo (V2) |
| `apps/iot-ingest` | ingestion des capteurs (V3) |
| `packages/schemas` | JSON Schemas des packs et des entités, d'où sont générés les types Dart et TypeScript |
| `packages/engines-ts`, `packages/engines-dart` | moteurs de résolution, d'expressions, de rappels, de projection et de consanguinité |
| `packages/test-vectors` | jeux de tests croisés, communs aux deux langages |
| `packs/` | packs de paramètres sources (JSON), relus comme du code |
| `infra/` | Terraform, Helm |
| `docs/` | ce dossier, les ADR, les procédures d'exploitation |

**Branches et versions :**
- branches courtes issues de `main` et demandes de fusion ;
- messages de commit au format « conventional commits » ;
- versionnage sémantique de l'API (`/v1`) et des packs ;
- notes de version générées automatiquement.

**Standards** :
- TypeScript strict, ESLint, Prettier ; Dart avec `flutter_lints` et analyse stricte ;
- migrations de base versionnées et réversibles ;
- aucune requête SQL construite par concaténation ;
- journaux structurés (JSON) sans donnée personnelle en clair.

## 5. Stratégie de test

| Niveau | Outils | Cible |
|---|---|---|
| Unitaire | Jest, flutter_test | moteurs ≥ 85 % de couverture |
| Tests croisés des moteurs | `packages/test-vectors` exécutés en Dart et en TypeScript | 100 % des vecteurs identiques |
| Tests dorés de projection | valeurs des classeurs (`10`) | ±0,5 |
| Contrat d'API | Schemathesis ou Dredd sur OpenAPI | 100 % des endpoints |
| Intégration | Testcontainers (PostgreSQL, Redis, MQTT) | parcours de synchronisation, paiement, SMS |
| Bout en bout | Patrol ou integration_test (mobile), Playwright (web) | 5 parcours structurants du document conceptuel |
| Hors ligne | coupure réseau simulée, mode avion, horloge décalée | T-01, T-07, T-33, T-34 |
| Charge | k6 | 2× la pointe prévue (`15` §1) |
| Sécurité | SAST, analyse des dépendances, test d'intrusion externe | avant chaque version majeure |
| Terrain | 8 à 12 éleveurs par filière prioritaire, appareils d'entrée de gamme, zone de réseau faible | ≥ 90 % des tâches clés réussies sans aide |

## 6. Propriété et réversibilité
Le code, les schémas, les packs, les données et la documentation appartiennent à RecallFarm. Chaque lot livre :
- les sources ;
- la documentation d'installation et d'exploitation ;
- les procédures d'exploitation ;
- un environnement reconstruisible à partir du dépôt (infrastructure décrite en code).

## 7. Registre des décisions

| ID | Décision | Options | Recommandation | Échéance | Statut |
|---|---|---|---|---|---|
| D-01 | Hébergement au Cameroun | (a) centre de données national ; (b) cloud en Afrique du Sud + autorisation de transfert | (a) pour le pilote si un hébergeur certifié est disponible, sinon (b) avec un dossier d'autorisation déposé au mois 0 | avant le pilote | ouverte |
| D-02 | Langage d'expressions | CEL (évaluateur Dart à écrire) ; JSONLogic (existant) | CEL | sprint 1 | ouverte |
| D-03 | USSD dans le MVP | MVP (test) ou V1 | test USSD au pilote (menu « rappels du jour, confirmer ») | sprint 2 | ouverte |
| D-04 | Budget de développement | 30 M FCFA (modèle v2.1) ou rechiffrage | rechiffrer par 2 ou 3 prestataires ; facteur paramétré dans `06` | avant l'amorçage | ouverte |
| D-05 | Mode de réalisation | prestataire au forfait ; noyau interne + régie | noyau interne (chef de produit, responsable technique) + régie ou prestataire | mois 0 | ouverte |
| D-06 | Valeurs proposées en v2.1 | grâce de 7 jours, 3 messages par jour, quotas de caméras, seuil de consanguinité ≥ 6,25 %, k-anonymat de 5 | valider en comité produit | sprint 1 | ouverte |
| D-07 | Agrégateurs de paiement et de SMS (pays pilote) | à consulter | 2 fournisseurs par service | sprint 3 | ouverte |
| D-08 | Matériel IoT de référence | appel d'offres en V3 | passerelle LoRaWAN + 4G, capteurs du catalogue `13` §3 | V2 | ouverte |
| D-09 | Rappel Newcastle | J18–J21 ou J21–J28 | à trancher par le référent | avant `filiere.volaille` 1.0 | ouverte |
| D-10 | Prix Pro canin et prix Structure par tranche | grille à tester | test au pilote (2 prix) | Go payant | ouverte |

Chaque décision prise devient un **ADR** (Architecture Decision Record) dans `docs/adr/`, au format : contexte, décision, conséquences, date, décideurs.
