# CHANGELOG — dossier RecallFarm v2.1 → v2.2 (27/10/2026)

## Origine
La v2.2 intègre le **document conceptuel** du 26/10/2026, qui couvre :
- le paramétrage ;
- le suivi à distance ;
- les normes internationales ;
- le dimensionnement ;
- le modèle économique ;
- l'organisation ;
- la feuille de route ;
- le pilote ;
- la commercialisation ;
- les indicateurs ;
- les risques.

Elle s'appuie aussi sur l'étude des systèmes mondiaux de gestion des fermes.

## Nouveaux fichiers

| Fichier | Contenu |
|---|---|
| `12-parametrage.md` | 5 niveaux de packs, politiques de surcharge, 15 types d'objets, format JSON signé, langage d'expressions (CEL), 6 moteurs, gouvernance à quatre yeux, studio S01 à S10, EF-PAR-01 à 12 |
| `13-suivi-a-distance-iot.md` | architecture capteurs → passerelle → plateforme → alerte ; MQTT ; catalogue de 11 profils de capteurs ; cycle des alertes ; astreinte ; EF-IOT-01 à 14 |
| `14-normes-conformite-interoperabilite.md` | matrice normes → exigences → preuves ; EF-CMP-01 à 08 ; antimicrobiens EF-AMU-01/02 ; interopérabilité EF-INT-01 à 09 |
| `15-exploitation-dimensionnement.md` | volumes, SLO, environnements, hébergement par pays, infrastructure, CI/CD, sauvegardes, supervision, procédures RB-01 à RB-09, support, coûts |
| `16-methodes-organisation.md` | équipe et effort, gouvernance, Scrum, DoR et DoD, monorepo, stratégie de test, propriété, registre des décisions D-01 à D-10 |
| `17-pilote-deploiement-indicateurs.md` | décisions de passage, pilote de Yaoundé, ouverture des pays, indicateurs et leur calcul, catalogue d'événements d'usage, tableaux de bord |

## Fichiers modifiés

| Fichier | Modifications principales |
|---|---|
| `01` | objectifs OBJ-05 à 07 ; périmètre (IoT inclus, WAHIS automatique exclu) ; dépendances ; 2 nouveaux personas ; permissions (capteurs, paramètres, studio) ; modules §4.26 PAR, §4.27 IOT, §4.28 INT/CMP/AMU, §4.29 VTR, §4.30 ANA ; formules Pro canin, Structure par tranche, option Ferme connectée (EF-ABO-05 à 07) ; USSD au pilote, assistant WhatsApp, vocal (EF-NOT-05 à 07) ; machines à états du pack et de l'alerte ; version V3 |
| `02` | moteur de formulaires comme source des champs ; écrans E70 à E81 (ferme en direct, courbes, alertes, assistant d'installation, astreinte, mode vétérinaire, imports, exports, menu USSD, retour utilisateur) |
| `03` | `attributes` et `param_version` (§0.4) ; tables de paramétrage (§15) ; tables du suivi à distance, dont `telemetry` en TimescaleDB (§16) ; principes actifs, transfert de propriété, feature flags, exports et imports (§17) ; nouvelles énumérations |
| `04` | modules params, alerts, iot-ingest, interop, analytics ; moteurs jumeaux et vecteurs de test ; entrepôt analytique ; hébergement par région et plan de contrôle central |
| `05` | §23 paramétrage et studio ; §24 suivi à distance ; §25 exports et imports, ICAR ADE ; §26 API publique OAuth 2.0 ; §27 mode vétérinaire ; §28 analytique ; champs antimicrobiens ; `/inbox` |
| `06` | infrastructure séparée de l'équipe (B29 socle, B30 par utilisateur) ; facteur de réévaluation du budget de développement (B31) ; seuil de rentabilité corrigé |
| `07` | réécrit : 4 versions, décisions de passage, socle de paramétrage aux sprints 1 et 2, epics paramétrage, IoT, interopérabilité, vétérinaire, pilotage |
| `08` | ENF-PAR, ENF-IOT, ENF-ANA, ENF-INT ; résidence des données |
| `09` | glossaire v2.2 ; profils de capteurs ; principes actifs |
| `10` | correspondance filière → pack → capteurs ; règle de passage d'une filière en production |
| `11` | T-37 à T-55 ; traçabilité des nouveaux domaines ; livrables (moteurs, packs, studio, IoT, infrastructure) ; lot 4 (V3) |

## Changements de périmètre et de calendrier
- Le **socle de paramétrage** entre dans le MVP (sprints 1 et 2), avec les packs `global.core`, `filiere.volaille`, `filiere.canin` et `pays.CM`.
- L'**import en masse** et l'**analytique** passent au MVP, car ils sont nécessaires au pilote.
- Le **test USSD** entre dans le MVP (EF-NOT-05).
- Les **capteurs IoT** passent de « hors périmètre » à la V3 ; les **caméras** restent en V2 et rejoignent le moteur d'alertes commun.
- Les **exports nationaux** et l'**ICAR ADE** arrivent en V2, l'**API publique en écriture** en V3.

## Impact sur le modèle financier (scénario de base)

| Indicateur | v2.1 | v2.2 (budget de dev × 1) | v2.2 (budget de dev × 2,5) |
|---|---|---|---|
| Coûts fixes mensuels au mois 1 | 1,50 M FCFA | 1,81 M FCFA (dont 0,3 M d'infrastructure) | idem |
| Coûts fixes mensuels au mois 36 | 1,50 M FCFA | ≈ 2,51 M FCFA | idem |
| Premier mois à marge positive | mois 26 | mois 33 | mois 33 |
| Point bas de trésorerie | −33,3 M FCFA | −46,5 M FCFA | −91,5 M FCFA |
| Équilibre mensuel (Pro seuls / Structure seuls) | 683 / 77 | 820 / 92 | 820 / 92 |

Avec une infrastructure chiffrée et un budget de développement réaliste, le besoin de financement passe de 33 M à **45 à 90 M FCFA** environ. Leviers : contrats Institution, prix Structure par tranche, Pro canin, financements non dilutifs (voir le document conceptuel, section 11).

## Points à valider
Le registre des décisions (`16` §7, D-01 à D-10) remplace la liste « à valider » de la v2.1. Les valeurs proposées en v2.1 restent soumises à la décision D-06.
