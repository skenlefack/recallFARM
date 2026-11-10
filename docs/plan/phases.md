# RecallFarm — Feuille de route : 5 phases, 29 lots, 4 portes

Chaque porte se franchit sur preuves ; la phase suivante ne demarre pas avant.

---

## Phase 0 — Stabiliser le MVP (2 a 3 semaines) → porte "socle sain"

### P0.1 — Mobile compile et prouve sur appareil
**Agents** : mobile-socle (chef), mobile-ecrans, puis qa-automatisation et ux-fidelite.
**But** : l'application Flutter jamais compilee devient un APK qui s'installe, demarre et passe ses tests.

1. mobile-socle : `flutter create --platforms=android,ios --org app.recallfarm .` sans ecraser lib/ ;
   AndroidManifest (INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM), minSdk 23, desugaring,
   cleartext limite a 10.0.2.2 en debug ; flutter pub get ; corrige TOUTES les erreurs et
   avertissements de flutter analyze ; embarque les polices (pas de telechargement a l'execution).
2. mobile-socle : flutter test (moteurs sur les vecteurs communs) : 100 % vert sans toucher aux vecteurs.
3. mobile-ecrans : chaque ecran s'affiche sans exception sur emulateur 360x640 et 412x915 ;
   goldens par ecran ; corrige les debordements.
4. qa-automatisation : integration_test du parcours pilote contre la pile docker.
5. ux-fidelite : captures des 6 ecrans maquettes contre docs/design/Mobile*.dc.html.

**Acceptation** : APK release signe < 25 Mo ; demarrage a froid < 3 s sur emulateur 2 Go ; analyze 0 ;
tests 100 % ; parcours pilote vert 3 fois de suite ; aucune perte apres 50 cycles mode avion.

### P0.2 — Livraison conteneurisee reelle
**Agents** : devops-sre, puis securite-conformite.
**But** : la pile se construit, se deploie et se surveille, sur une recette publique.

1. Construire les images api et web, les scanner (Trivy : 0 critique), corriger les Dockerfiles.
2. `make up` depuis un clone propre : tous les services healthy en < 3 min ; make seed ; parcours web OK.
3. Environnement de recette sur VM (2 vCPU, 4 Go) : Caddy + Let's Encrypt, pare-feu, deploiement auto.
4. Observabilite : journaux JSON, Prometheus, Grafana, Loki, alertes.
5. Sauvegardes : profil backup active, restauration automatisee mensuelle testee.

**Acceptation** : URL de recette en HTTPS (note A SSL Labs) ; restauration prouvee ; runbook a jour.

### P0.3 — Solder la dette du MVP
**Agents** : integrations, moteurs-parametrage, backend-elevage ; puis relecteur.

- integrations : regroupement rappels du meme jour (RG-NOT-02), rate limiting Redis, file persistante.
- moteurs-parametrage : publication protocole → recalcul rappels, deploiement progressif (EF-PAR-09).
- backend-elevage : compte provisoire hors ligne rattache a OTP, suppression de compte, PostGIS obligatoire.

**Acceptation** : chaque dette a un test qui echouait avant le correctif ; e2e complet vert.

### P0.4 — Banc de tests de non-regression
**Agents** : qa-automatisation et moteurs-parametrage ; puis relecteur.

1. Lanceur de parite (/parite) : vecteurs TS et Dart compares, job CI bloquant.
2. Tests de proprietes (fast-check / glados) : 10 000 expressions, compare TS/Dart.
3. e2e web Playwright sur la pile docker.
4. Tests de contrat : chaque reponse e2e validee contre openapi.json.
5. Charge k6 : 300 utilisateurs, p95 < 300 ms, 0 erreur.

**Acceptation** : CI < 15 min, tous les jobs bloquants, rapport de charge archive.

---

## Phase 1 — Pret pour le pilote de Yaounde (3 a 4 semaines) → porte "Go pilote"

### P1.1 — SMS et USSD reels
**Agents** : integrations (chef), qa-automatisation.
**Prerequis** : D-07 (agregateur choisi), D-03 (code court USSD obtenu).

1. Documentation officielle de l'agregateur ; ADR.
2. Adaptateur SMS reel : envoi, DLR, SMS entrants, GSM-7, comptage segments, cout.
3. Adaptateur USSD reel : sessions, menu du pack pays, < 3 ecrans, <= 160 caracteres.
4. Bascule simulateur/reel par configuration.
5. Tests : fixtures + essais reels sur 3 numeros (Orange, MTN, Camtel).

**Acceptation** : 100 SMS reels, livraison > 95 %, confirmation SMS/USSD < 30 s.

### P1.2 — Paiement mobile money reel
**Agents** : integrations (chef), backend-economie-reseau, securite-conformite.

1. Adaptateurs Orange Money et MTN MoMo : push USSD, webhook, statut, remboursement, sandbox.
2. Machine a etats paiement/abonnement : relances, grace, retrogradation, recu PDF.
3. Prix Structure par tranche (EF-ABO-05), variante Pro canin (EF-ABO-06).
4. Rapprochement quotidien fournisseur ↔ base.
5. securite-conformite : revue webhooks, audit.

**Acceptation** : 20 paiements sandbox, 3 reels rembourses, 0 double encaissement, droits hors ligne.

### P1.3 — Conformite des donnees personnelles
**Agents** : securite-conformite (chef), backend-elevage, web-frontend, mobile-ecrans.
**References** : dossier 14 (EF-CMP-01 a 08), Malabo, loi camerounaise 2024/017.

1. Registre des traitements, mentions, CGU, consentements par finalite.
2. Droits : acces/export, rectification, suppression, opposition.
3. Durees de conservation, journal d'audit inalterable.
4. AIPD, procedure de violation (72 h).

**Acceptation** : chaque droit exerce de bout en bout depuis mobile et web.

### P1.4 — Analytique produit et pilotage du pilote
**Agents** : donnees-interop (chef), web-frontend, mobile-socle.

1. Catalogue d'evenements (dossier 17 §5), file locale, envoi groupe.
2. Entrepot : tables agregees quotidiennes.
3. Tableaux de pilotage web.

**Acceptation** : indicateurs recalcules a la main = valeurs affichees.

### P1.5 — Enrolement en masse des cooperatives
**Agents** : donnees-interop, web-frontend.

Import CSV/XLSX : modele, apercu, erreurs par ligne, dedoublonnage E.164, rapport, SMS d'invitation.
**Acceptation** : 5 000 lignes avec 3 % d'erreurs < 60 s.

### P1.6 — Recette du pilote
**Agents** : qa-automatisation (chef), correctifs par les proprietaires.

T-01 a T-55, recette mobile sur 3 telephones, 2G, 5 utilisateurs tests.
**Acceptation** : rapport docs/plan/recette-pilote.md, decision Go/No-Go.

---

## Phase 2 — V1 : exploitation complete, canin pro, revenus (10 a 12 semaines) → porte "Go payant"

P2.1 et P2.2 d'abord (packs et studio), puis P2.3 a P2.10 en deux vagues de quatre.

### P2.1 — Gouvernance des packs et studio interne
**Agents** : moteurs-parametrage (chef), web-frontend, relecteur.
Etats brouillon→en_revue→teste→publie→retire ; moteur de workflows generique ; ecrans S01-S07.

### P2.2 — Quatre nouvelles filieres par packs
**Agent** : moteurs-parametrage. Porcin, petits ruminants, bovin, lapin. Zero code d'espece.

### P2.3 — Cheptel avance, reproduction et genealogie de rente
**Agents** : backend-elevage, mobile-ecrans. Logements, mouvements, pesees, portees, pedigrees.

### P2.4 — Biosecurite, signalement et antimicrobiens
**Agents** : backend-elevage, mobile-ecrans, securite-conformite. Check-lists, signalement, delais d'attente.

### P2.5 — Tresorerie et simulateur de projection
**Agents** : moteurs-parametrage, backend-economie-reseau, mobile-ecrans. Tests dores 6 filieres.

### P2.6 — Activite canine professionnelle
**Agents** : backend-economie-reseau, mobile-ecrans, web-frontend. Dressage, pension, factures.

### P2.7 — Marche et mise en relation
**Agents** : backend-economie-reseau, mobile-ecrans, integrations. Annuaire, demandes, WhatsApp.

### P2.8 — Structure, mode agent et PWA
**Agents** : backend-economie-reseau, web-frontend, mobile-socle, securite-conformite.

### P2.9 — Mode veterinaire de terrain
**Agents** : backend-economie-reseau, mobile-ecrans, integrations. E75-E77.

### P2.10 — WhatsApp, retour utilisateur et registres d'audit
**Agents** : integrations, donnees-interop, mobile-ecrans.

---

## Phase 3 — V2 : surveillance, video, echelle (mois 7 a 12) → porte "Go expansion"

### P3.1 — Cameras
### P3.2 — Campagnes de vaccination et surveillance de la rage
### P3.3 — Exports vers les systemes nationaux
### P3.4 — Studio ouvert aux Structures et bac a sable
### P3.5 — API publique en lecture
### P3.6 — Expansion Senegal et Cote d'Ivoire, certification ISO 27001

---

## Phase 4 — V3 : ferme connectee et intelligence (mois 13 a 24)

### P4.1 — Capteurs et passerelle de ferme
### P4.2 — Alertes predictives et assistant conversationnel
### P4.3 — Ouverture de la plateforme
