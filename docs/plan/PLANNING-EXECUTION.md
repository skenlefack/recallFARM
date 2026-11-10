# RecallFarm — Politique et Planning Complet d'Execution

Date : 2026-10-27
Version : 1.0

---

## 1. Vue d'ensemble

RecallFarm passe du MVP livre a une application complete en **4 phases, 29 lots**, pilotes par
une equipe de **16 agents Claude Code specialises** coordonnes par un orchestrateur.

```
Phase 0 (sem 1-3)    Phase 1 (sem 4-7)    Phase 2 (sem 8-19)     Phase 3 (mois 7-12)  Phase 4 (mois 13-24)
Stabiliser MVP   -->  Pilote Yaounde  -->  V1 Complete       -->  V2 Echelle      -->  V3 Intelligence
4 lots               6 lots               10 lots                6 lots               3 lots
Porte: socle sain    Porte: Go pilote     Porte: Go payant       Porte: Go expansion  Livraison finale
```

---

## 2. Politique d'execution

### 2.1 Principes fondamentaux

1. **L'orchestrateur ne code pas** — il planifie, delegue, integre et refuse ce qui n'est pas prouve.
2. **Un fichier, un proprietaire** — jamais deux agents sur le meme fichier dans la meme vague.
3. **Le contrat avant le code** — toute API passe par l'architecte et openapi.json d'abord.
4. **Les vecteurs sont sacres** — seul l'architecte peut les modifier, avec justification.
5. **Preuve, pas recit** — un "c'est fait" sans sortie de commande est refuse.
6. **L'IA ne tranche pas le metier** — protocoles vaccinaux, prix, fournisseurs : le PO decide.

### 2.2 Circuit d'un lot

```
Cadrage --> Contrats (architecte) --> Decoupage en taches --> Delegation (agents en parallele)
    --> Integration (branche int/<lot>) --> Controle (relecteur + securite + ux)
    --> Recette (qa-automatisation) --> Cloture (PR vers main)
```

Boucle de correction entre Controle et Integration jusqu'a **zero bloquant**.

### 2.3 Portes qualite (dans l'ordre)

| # | Porte | Qui | Bloquant si |
|---|-------|-----|-------------|
| 1 | Build et tests | CI | lint, typage, unitaires, e2e, analyze, parite, Trivy |
| 2 | Non-regression | CI nocturne | e2e mobile, charge k6, restauration backup, migrations up/down/up |
| 3 | Revue de code | relecteur | tout BLOQUANT non traite |
| 4 | Securite et UX | securite-conformite, ux-fidelite | constat critique/eleve, violation AA serieuse |
| 5 | Recette | qa-automatisation + PO | scenarios non prouves |

### 2.4 Definition de termine (DoD)

Toute tache requiert ces 8 preuves :
1. Exigences couvertes listees par ID (EF-/RG-) avec le test associe
2. Lint + typage sans erreur ; couverture >= 80 % (moteurs : 100 % branches)
3. Execute pour de vrai : commande lancee, sortie collee
4. Migrations reversibles testees (up, down, up) ; seed idempotent
5. OpenAPI regenere et coherent
6. Accessibilite AA et i18n verifiees
7. Revue independante sans bloquant
8. Documentation a jour (README, CHANGELOG, runbook)

---

## 3. Equipe d'agents

### 3.1 Agents d'execution (14)

| Agent | Modele | Fichiers possedes | Phase active |
|-------|--------|-------------------|--------------|
| architecte | opus | docs/adr/, docs/contracts/, openapi.json | Toutes |
| moteurs-parametrage | opus | packages/params/, api/src/{params,studio}, mobile/lib/core/params | Toutes |
| backend-elevage | sonnet | api/src/{livestock,housing,journal,health,reproduction,genealogy,biosecurity,amu} | 0-2 |
| backend-economie-reseau | sonnet | api/src/{stock-sales,cashflow,canine,invoicing,market,vet,organisations} | 1-3 |
| integrations | opus | api/src/{notifications,billing}/providers, src/webhooks | 0-3 |
| donnees-interop | sonnet | api/src/{database,imports,exports,analytics,interop,public-api} | 1-3 |
| mobile-socle | opus | mobile/lib/core, android/, ios/, pubspec.yaml, integration_test/ | 0-4 |
| mobile-ecrans | sonnet | mobile/lib/features, test/widgets | 0-2 |
| web-frontend | sonnet | apps/web/ | 1-3 |
| iot-edge | opus | apps/iot-ingest/, apps/gateway-edge/, api/src/alerts | 3-4 |
| securite-conformite | opus | docs/security/, api/src/common/security (revue partout) | Toutes |
| qa-automatisation | sonnet | tests/, matrice T-01 a T-55 | Toutes |
| devops-sre | sonnet | infra/, .github/, docker-compose*.yml, Dockerfiles | 0-3 |

### 3.2 Agents de controle (2, droit de veto)

| Agent | Role | Modele |
|-------|------|--------|
| relecteur | Revue de code independante, lecture seule | opus |
| ux-fidelite | Controle maquettes, accessibilite AA, performance | sonnet |

---

## 4. Planning detaille

### Phase 0 — Stabiliser le MVP (Semaines 1-3)

```
Semaine 1          Semaine 2              Semaine 3
|----- P0.1 Mobile compile ----------|
|--- P0.2 Livraison conteneurisee ---|
                   |--- P0.3 Dette ---|
                                       |--- P0.4 Banc de tests ---|
```

| Lot | Duree | Vague 1 (parallele) | Vague 2 | Sortie |
|-----|-------|---------------------|---------|--------|
| P0.1 | 5-7j | mobile-socle, mobile-ecrans | qa-auto, ux-fidelite | APK installe, tests verts |
| P0.2 | 3-5j | devops-sre | securite-conformite | Images, recette HTTPS, TLS |
| P0.3 | 4-5j | backend-elevage, integrations, moteurs-param | relecteur | 5 dettes soldees |
| P0.4 | 3-4j | qa-auto, moteurs-param | relecteur | Parite CI, e2e, charge |

**Prerequis** : Flutter SDK 3.24.5 + Android SDK installes sur la machine de dev.
**Porte de passage** : socle sain (CI verte, APK, images Docker, 0 dette critique).

### Phase 1 — Pilote Yaounde (Semaines 4-7)

```
Semaine 4          Semaine 5          Semaine 6          Semaine 7
|--- P1.1 SMS/USSD ---|
|--- P1.2 Mobile money ---|
                  |--- P1.3 Conformite ---|
                  |--- P1.4 Analytique ---|
                                     |--- P1.5 Enrolement ---|
                                                        |--- P1.6 Recette ---|
```

| Lot | Duree | Agents | Decision prealable |
|-----|-------|--------|--------------------|
| P1.1 | 5-7j | integrations, qa-auto | **D-03** (code USSD), **D-07** (agregateur) |
| P1.2 | 5-7j | integrations, backend-eco, securite | **D-07** (contrat marchand) |
| P1.3 | 4-5j | securite (chef), backend-elevage, web, mobile | D-01 (hebergement) |
| P1.4 | 3-4j | donnees-interop, web, mobile-socle | — |
| P1.5 | 3-4j | donnees-interop, web | Liste reelle cooperatives |
| P1.6 | 5-7j | qa-auto (chef), tous | 3 telephones reels |

**ATTENTION** : P1.1 et P1.2 sont bloques par les decisions D-03 et D-07.
Lancer les demarches administratives (code USSD, contrat marchand) des le debut de Phase 0.
**Porte de passage** : Go pilote (rapport de recette, decision PO).

### Phase 2 — V1 Complete (Semaines 8-19)

**Vague 1 (sem 8-11)** : P2.1 (studio) + P2.2 (filieres) — fournissent les packs dont tout depend.

**Vague 2 (sem 12-15)** :
| P2.3 Cheptel avance | P2.4 Biosecurite | P2.5 Tresorerie | P2.6 Canin pro |

**Vague 3 (sem 16-19)** :
| P2.7 Marche | P2.8 Structure/PWA | P2.9 Veterinaire | P2.10 WhatsApp/audit |

| Lot | Exigences cles | Agents |
|-----|----------------|--------|
| P2.1 | EF-PAR-06 a 09, 11 ; S01-S07 | moteurs-param, web |
| P2.2 | Packs porcin, ruminants, bovin, lapin | moteurs-param |
| P2.3 | CHE, REP, GEN ; E15-E18, E24 | backend-elevage, mobile-ecrans |
| P2.4 | BIO, EF-AMU-01 ; E42-E43 | backend-elevage, mobile-ecrans |
| P2.5 | DEP, PRJ ; E28-E29 | backend-eco, moteurs-param, mobile |
| P2.6 | DRE, EF-ABO-06 ; E31-E35 | backend-eco, mobile, web |
| P2.7 | MAR ; E40-E41 | backend-eco, mobile, integrations |
| P2.8 | EF-ABO-05, PWA, webhooks, multi-pays | backend-eco, web, mobile-socle |
| P2.9 | EF-VTR-01 a 03 ; E75-E77 | backend-eco, mobile, integrations |
| P2.10 | EF-NOT-06, EF-ANA-03, EF-INT-08 | integrations, donnees-interop |

**Porte de passage** : Go payant (toutes filieres utilisables, facturation fonctionnelle).

### Phase 3 — V2 Echelle (Mois 7-12)

| Lot | Sujet | Agents |
|-----|-------|--------|
| P3.1 | Cameras (ONVIF, WebRTC, HLS) | iot-edge, mobile-socle, devops-sre |
| P3.2 | Campagnes vaccination, carte rage | backend-eco, donnees-interop, web |
| P3.3 | Exports DHIS2/ARIS/ICAR ADE | donnees-interop, securite |
| P3.4 | Studio ouvert, bac a sable | moteurs-param, web, securite |
| P3.5 | API publique en lecture (OAuth 2.0) | architecte, donnees-interop, securite |
| P3.6 | Expansion SN + CI, ISO 27001 | devops-sre, moteurs-param, integrations, securite |

### Phase 4 — V3 Intelligence (Mois 13-24)

| Lot | Sujet | Agents |
|-----|-------|--------|
| P4.1 | Capteurs IoT, MQTT, passerelle de ferme | iot-edge, mobile-socle, devops-sre |
| P4.2 | Alertes predictives, assistant WhatsApp | donnees-interop, integrations, securite |
| P4.3 | API ecriture, EPCIS, marque blanche, nouvelles filieres | architecte, moteurs-param, web |

---

## 5. Decisions prealables critiques

Ces decisions doivent etre prises par le proprietaire du produit AVANT les lots concernes.
Les agents ne tranchent jamais une decision metier.

| ID | Sujet | Bloque | Urgence | Action requise |
|----|-------|--------|---------|----------------|
| D-03 | Code court USSD | P1.1 | **Immediate** (delai operateur : 4-8 sem) | Contacter Orange/MTN Cameroun |
| D-07 | Agregateur SMS + paiement | P1.1, P1.2 | **Immediate** | Choisir : Orange direct, MTN direct, ou agregateur unique |
| D-01 | Hebergement par pays | P1.3, P3.6 | Sem 3 | VM unique Cameroun d'abord ? Quel fournisseur ? |
| D-02 | Drift vs sqflite_sqlcipher | P0.1 | Sem 1 | Confirmer le choix actuel par ecrit (ADR) |
| D-09 | Polices embarquees | P0.1 | Sem 1 | Confirmer : embarquer (APK + gros) ou telecharger |
| D-10 | Appareils de test reels | P0.1, P1.6 | Sem 1 | Acheter 2-3 telephones Android entree de gamme |
| D-04 | Fournisseur WhatsApp Business | P2.10 | Sem 12 | Meta direct ou via agregateur |
| D-05 | Fournisseur vocal (IVR) | P3.6 | Mois 7 | Operateur avec langues locales |
| D-06 | Analytique : ClickHouse ou PG | P1.4 | Sem 4 | ADR a rediger |
| D-08 | Auditeur ISO 27001 | P3.6 | Mois 6 | Identifier et mandater |

---

## 6. Gestion des risques

| Risque | Impact | Probabilite | Mitigation |
|--------|--------|-------------|------------|
| Mobile ne compile pas (P0.1) | Bloque tout | Elevee | Prioriser, dedier mobile-socle opus |
| Code USSD non obtenu a temps | Bloque P1.1 | Moyenne | Demarche immediate, fallback SMS only |
| Contrat mobile money retarde | Bloque P1.2 | Moyenne | Travailler en sandbox, deployer sur validation |
| Parite TS/Dart diverge | Regression silencieuse | Moyenne | Job CI /parite bloquant des P0.4 |
| Conflit de fusion entre agents | Perte de temps | Faible | Un fichier = un proprietaire strict |
| Contexte trop long (agent) | Qualite degradee | Moyenne | Une session par lot, journal.md |
| Decision metier non tranchee | Lot bloque | Moyenne | PO disponible sous 48h |

---

## 7. Regles operationnelles

### 7.1 Sessions de travail
- **Une session par lot** — ne pas enchainer les lots dans la meme conversation.
- L'orchestrateur resume l'etat dans `docs/plan/journal.md` avant de passer la main.
- 4 a 6 instances simultanees max ; au-dela, l'integration devient le goulet.

### 7.2 Branches et worktrees
- Chaque agent travaille dans `feat/<lot>-<agent>` (ex: `feat/P0.1-mobile-socle`).
- L'orchestrateur integre dans `int/<lot>` (ex: `int/P0.1`).
- Seul l'orchestrateur fusionne vers main, apres toutes les portes.

### 7.3 Securite
- **Jamais de cle de production** dans les prompts des agents.
- Agents travaillent sur sandbox ; mise en production = geste humain documente.
- Relire les migrations a la main avant la recette.

### 7.4 Modeles recommandes
- **Opus** : orchestrateur, architecte, relecteur, moteurs-param, integrations, mobile-socle, iot-edge, securite
- **Sonnet** : agents d'execution repetitifs (backend-*, mobile-ecrans, web, qa, devops, donnees-interop)
- **Haiku** : taches mecaniques (i18n, fixtures, formatage)

---

## 8. Comment demarrer

### Etape 1 : Prerequis (30 min)
```bash
# Verifier les outils
node --version    # >= 22
docker --version  # >= 24
flutter --version # >= 3.24.5
gh --version      # GitHub CLI

# La pile Docker est deja demarree (http://localhost:9080)
```

### Etape 2 : Initialiser Git (si pas fait)
```bash
cd C:/dev/recallFarm
git init
git add -A
git commit -m "chore: MVP initial + structure de pilotage multi-agents"
# Pousser sur GitHub avec branche main protegee (CI verte + 1 revue)
```

### Etape 3 : Installer Flutter + Android SDK
```bash
# Indispensable pour Phase 0 — le mobile n'a jamais ete compile
flutter doctor  # Verifier Android SDK, emulateur, etc.
```

### Etape 4 : Lancer Phase 0
```
# Dans Claude Code, a la racine du depot :
# Coller le prompt maitre (CLAUDE.md est deja en place)
# Puis : /lot P0.1
```

### Etape 5 : Decisions urgentes
Trancher D-02, D-09, D-10 immediatement.
Lancer les demarches D-03 et D-07 (delai administratif de 4-8 semaines).

---

## 9. Calendrier synthetique

```
Oct 2026         Nov 2026         Dec 2026         Jan-Mar 2027     Avr-Oct 2027
|== Phase 0 ==|  |==== Phase 1 ====|                |               |
  P0.1 Mobile     P1.1 SMS reel     |               |               |
  P0.2 Docker     P1.2 MoMo         |               |               |
  P0.3 Dette      P1.3 RGPD         |               |               |
  P0.4 Tests      P1.4 Analytics    |               |               |
                  P1.5 Import       |               |               |
                  P1.6 Recette      |               |               |
                                    |== Phase 2 ====|               |
                                     P2.1-P2.2 (Packs, Studio)     |
                                     P2.3-P2.6 (Elevage, Canin)    |
                                     P2.7-P2.10 (Reseau, WhatsApp) |
                                                    |== Phase 3 ====|
                                                     P3.1-P3.6
                                                                    |== Phase 4 ==
                                                                     P4.1-P4.3
PILOTE YAOUNDE ----------------->
                        GO PILOTE ^         GO PAYANT ^    GO EXPANSION ^
```

---

## 10. Commandes disponibles

| Commande | Usage |
|----------|-------|
| `/lot P0.1` | Executer un lot specifique |
| `/revue` | Lancer la revue de la branche courante |
| `/parite` | Verifier la parite TS/Dart des vecteurs |
| `/recette P0.1` | Recette complete d'un lot |
| `/etat` | Rapport d'avancement global |
