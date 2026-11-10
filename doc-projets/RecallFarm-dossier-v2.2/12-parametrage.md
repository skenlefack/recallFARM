# 12 — Paramétrage : métamodèle, moteurs et studio (v2.2)

> Version 2.2 — 27/10/2026. **Nouveau fichier**, qui traduit en spécification le concept de paramétrage du document conceptuel (section 4).
> Il fait autorité pour : la structure des jeux de paramètres (« packs »), la résolution entre niveaux, le langage d'expressions, les moteurs génériques, la gouvernance des publications et le studio.

## 1. Principe

**Le code ne connaît aucune espèce : il ne connaît que des moteurs.** Tout ce qui varie d'une filière, d'un pays, d'une organisation ou d'une exploitation à l'autre est décrit dans des **packs** :
- versionnés et validés par un schéma ;
- publiés après revue par un référent ;
- signés par le serveur ;
- synchronisés vers les téléphones comme des référentiels.

Ajouter une filière, adapter un pays ou ajuster un protocole ne demande **aucune nouvelle version de l'application**.

Exigences : **EF-PAR-01 à EF-PAR-12** (voir §11 et `01` §4.26).

## 2. Les cinq niveaux et la résolution

| Niveau | Code | Contenu typique | Qui publie | Exemple d'identifiant |
|---|---|---|---|---|
| 1. Référentiel global | `global` | espèces, maladies, intrants, unités, devises, correspondances avec les normes | équipe RecallFarm + comité scientifique | `global.core@3.1.0` |
| 2. Profil de filière | `filiere` | types de production, phases, formulaires, indicateurs, calendriers, check-lists, modèles de projection, règles d'alerte par défaut | référent de la filière | `filiere.porcin@2.0.0` |
| 3. Pack pays | `pays` | protocoles nationaux, maladies à déclaration, langues, devise, prix des formules, modèles de messages, correspondances d'export | référent pays + équipe | `pays.CM@1.4.0` |
| 4. Organisation | `org` | protocoles maison, tarifs, rôles personnalisés, modèles de messages, champs supplémentaires | administrateur Structure (⭐ studio ouvert en V2) | `org.<uuid>@0.3.0` |
| 5. Exploitation | `ferme` | seuils d'alerte, objectifs, astreinte, indicateurs affichés | propriétaire | stocké en table (`farm_settings`), pas en pack |

### 2.1 Algorithme de résolution
Pour un objet de paramétrage donné (par exemple le protocole « rage » pour l'espèce chien) et une exploitation donnée, l'algorithme est le suivant :
1. Charger les packs applicables : `global` → `filiere` (selon les spéculations de l'exploitation) → `pays` (selon `farms.country`) → `org` (selon `farms.organisation_id`) → `ferme`.
2. Fusionner **clé par clé**, du général au particulier.
3. Chaque propriété porte une **politique de surcharge** déclarée au niveau qui la définit :

| Politique | Effet |
|---|---|
| `libre` | tout niveau inférieur peut la remplacer |
| `bornée` | un niveau inférieur peut la modifier dans un intervalle `[min, max]` ou une liste autorisée |
| `ajout_seulement` | un niveau inférieur peut ajouter des éléments à une liste, jamais en retirer (ex. étapes de protocole obligatoires) |
| `verrouillée` | aucune surcharge (ex. rappel antirabique annuel obligatoire fixé par le pays) |

4. Le résultat est l'**objet résolu**. Sa valeur est mise en cache et accompagnée de sa **provenance** : niveau et version qui ont fourni chaque propriété. La provenance s'affiche dans le studio et dans l'aide en ligne (« Intervalle fixé par le pack pays CM 1.4.0 »).

### 2.2 Règles
- **RG-PAR-01** : une surcharge qui viole la politique est refusée à la publication (validation statique) et ignorée à l'exécution (journalisation `param_override_rejected`).
- **RG-PAR-02** : la résolution est déterministe et identique sur le mobile et sur le serveur. Une même bibliothèque, compilée en Dart et en TypeScript, est testée sur les mêmes jeux.
- **RG-PAR-03** : une donnée saisie garde la référence de la version de pack qui a servi à la saisir (`param_version` sur les événements). Une publication ultérieure ne réinterprète jamais l'historique.

## 3. Types d'objets paramétrables

| Type (`kind`) | Rôle | Moteur consommateur | Niveaux autorisés |
|---|---|---|---|
| `species_profile` | espèce, mode de gestion, gestation, catégories d'animaux, phases | cheptel, reproduction | global, filière |
| `production_type` | atelier (chair, ponte, naissage, engraissement, lait…), phases et durées | cheptel, journal, projection | filière |
| `form` | formulaire : champs, types, unités, validations, conditions d'affichage, ordre | formulaires | filière, pays, org |
| `kpi` | indicateur : formule, unité, seuils de couleur, agrégation, place au tableau de bord | calculs | filière, org, ferme (affichage) |
| `vaccination_protocol` | maladie, étapes, intervalles, voie, obligation, délais d'attente | rappels | global, pays, org |
| `task_template` | tâche type : déclencheur, décalage, récurrence | rappels et tâches | filière, pays, org, ferme |
| `alert_rule` | condition sur le journal, un capteur ou un rappel ; gravité ; canaux ; destinataires ; escalade | alertes | filière, pays, org, ferme (seuils) |
| `checklist` | items, items critiques, score, fréquence | formulaires + calculs | filière, pays, org |
| `projection_model` | unité d'entrée, paramètres par défaut, formules, tests de contrôle | calculs | filière, pays |
| `workflow` | états et transitions d'une entité configurable (ex. séjour en pension, campagne) | états et workflows | global, org |
| `message_template` | texte SMS, WhatsApp, vocal ; variables ; langue | notifications | pays, org |
| `plan` | formule, fonctions, quotas, prix par pays | droits et offres | global, pays |
| `export_mapping` | correspondance avec DHIS2, ARIS, EMA-i+, GARC, ICAR ADE, EPCIS | exports | global, pays |
| `i18n` | libellés de tous les objets ci-dessus | tous | tous |
| `sensor_profile` | type de capteur, unité, plage, fréquence, calibrage | suivi à distance (`13`) | global, filière |

## 4. Format d'un pack

Un pack est un document JSON validé par un **JSON Schema** (draft 2020-12) publié dans le dépôt `recallfarm-schemas`. Il est compressé (gzip) et signé (Ed25519) à la publication.

```json
{
  "pack": "filiere.porcin",
  "version": "2.0.0",
  "level": "filiere",
  "requires": { "global.core": "^3.0.0" },
  "status": "published",
  "objects": [
    {
      "kind": "production_type",
      "code": "naissage_engraissement",
      "species": "porcin",
      "phases": [
        { "code": "maternite", "max_days": 42 },
        { "code": "post_sevrage", "max_days": 30 },
        { "code": "engraissement", "max_days": 140 }
      ]
    },
    {
      "kind": "task_template",
      "code": "fer_porcelet_j3",
      "trigger": { "type": "relatif_evenement", "event": "mise_bas", "offset_days": 3 },
      "category": "soin_neonatal",
      "override": { "offset_days": { "policy": "bornee", "min": 2, "max": 5 } }
    },
    {
      "kind": "kpi",
      "code": "sevres_par_truie_an",
      "expr": "sum(litters.weaned_count, period='365d') / count(animals, role='reproductrice', status='actif')",
      "unit": "porcelets/truie/an",
      "thresholds": { "red": "< 18", "amber": "< 22" }
    },
    {
      "kind": "alert_rule",
      "code": "mortalite_brutale_porc",
      "source": "daily_logs",
      "when": "log.mortality >= 2 && avg(log.mortality, window='7d') < 0.5",
      "severity": "critique",
      "action": { "propose": "disease_signal", "suspected": ["peste_porcine_africaine"] },
      "override": { "when": { "policy": "verrouillee" } }
    }
  ],
  "i18n": { "fr": { "fer_porcelet_j3": "Fer au porcelet (J3)" }, "en": { "fer_porcelet_j3": "Piglet iron (D3)" } },
  "tests": [ { "kind": "projection_golden", "model": "porcins_v1", "inputs": "default", "expect": { "marge_brute": 3129686 }, "tolerance": 0.5 } ]
}
```

Conventions :
- `code` : stable, en snake_case, unique dans le pack. C'est la clé de surcharge entre niveaux.
- **Versionnage sémantique** :
  - *majeur* : suppression ou renommage d'un code, changement de type d'un champ ;
  - *mineur* : ajout d'un objet ou d'un champ facultatif ;
  - *correctif* : texte, seuil, libellé.
- `requires` : dépendances entre packs. Le publieur refuse un pack dont les dépendances ne sont pas satisfaites.

## 5. Le langage d'expressions (`expr`)

- **Choix** : un sous-ensemble de **CEL** (Common Expression Language), sans effet de bord, sans boucle non bornée, sans accès au réseau ni au système de fichiers. L'évaluateur est disponible en Go, Java, C++ et JavaScript ; un portage Dart est à réaliser ou à intégrer (voir l'option ci-dessous).
- **Variables exposées** : `subject` (lot, animal ou chien), `log` (journal du jour), `event` (événement déclencheur), `farm`, `params` (paramètres résolus), `reading` (mesure de capteur), `now`.
- **Fonctions** : `sum`, `avg`, `min`, `max`, `count` (avec filtres et fenêtre `window='7d'`), `days_between`, `age_days`, `round`, `if`, `coalesce`, `percentile` (côté serveur seulement), `unit(x, 'kg')`.
- **Garanties** :
  - type vérifié à la publication ;
  - budget d'évaluation de 10 ms et 10 000 opérations par expression sur le mobile ;
  - résultat identique sur mobile et serveur (tests croisés obligatoires).
- **Option d'implémentation à trancher au sprint 1** : (a) CEL avec un évaluateur Dart à écrire (plus portable, coût d'environ 15 jours-homme) ; (b) JSONLogic, déjà disponible en Dart et en TypeScript, moins lisible pour les référents. Recommandation : **CEL**, avec un éditeur assisté dans le studio.

## 6. Les six moteurs génériques

| Moteur | Entrées | Sorties | Où il s'exécute | Exigences |
|---|---|---|---|---|
| Formulaires et validations | `form`, `i18n`, valeurs | écran rendu, erreurs, `attributes` JSON validé | mobile, PWA ; revalidation serveur | EF-PAR-04 |
| Rappels et tâches | `vaccination_protocol`, `task_template`, événements | `reminders`, `tasks` | mobile (local) et serveur (envois) | EF-VAC-*, EF-TAC-* |
| Calculs, indicateurs, projection | `kpi`, `projection_model`, données | valeurs, séries, scénarios | mobile et serveur | EF-KPI-*, EF-PRJ-* |
| Alertes | `alert_rule`, journal, mesures, rappels | `alert_events`, notifications, propositions d'action | mobile (journal), passerelle de ferme (capteurs critiques), serveur | EF-IOT-*, RG-JOU-06 |
| États et workflows | `workflow` | transitions autorisées, actions | serveur (autorité), mobile (anticipation hors ligne) | EF-PAR-08 |
| Droits, offres, exports | `plan`, `export_mapping` | droits signés, fichiers d'export | serveur ; droits en cache sur le mobile | EF-ABO-*, EF-SUR-*, EF-INT-* |

### 6.1 Moteur de formulaires

**Types de champs.** `text`, `integer`, `decimal` (avec `unit`), `date`, `datetime`, `select` (référentiel ou liste), `multiselect`, `boolean`, `photo`, `geo`, `rfid` (lecture d'une boucle ou d'une puce ISO 11784/11785), `qr`, `subject_ref` (lot, animal ou chien), `money` (unité mineure + devise), `signature`, `computed` (expression, lecture seule).

**Attributs d'un champ :**

| Attribut | Rôle |
|---|---|
| `code` | identifiant du champ |
| `label` | libellé (i18n) |
| `required` | champ obligatoire |
| `default` | valeur par défaut (valeur ou expression) |
| `min`, `max` | bornes |
| `pattern` | format attendu |
| `visible_if` | condition d'affichage (expression) |
| `required_if` | condition d'obligation (expression) |
| `help` | aide contextuelle |
| `sensitive` | le champ n'est jamais exporté hors de l'exploitation |
| `maps_to` | colonne standard, pour les champs communs, ou `attributes.<code>` |

**Stockage.**
- Les champs communs à toutes les filières sont des colonnes (`03`).
- Les champs propres à une filière ou une organisation vont dans `attributes jsonb`, validé par le JSON Schema généré à partir du formulaire et indexé (GIN, plus des index d'expression sur les champs filtrés).
- Aucune création de table ou de colonne à la volée.

**Évolution.** Retirer un champ ne supprime jamais les valeurs saisies : elles restent lisibles dans l'historique. Renommer un champ impose une version majeure et une table de correspondance.

### 6.2 Moteur de rappels et de tâches
- **Déclencheurs** : `date_fixe`, `age` (jours depuis la naissance ou l'entrée), `relatif_evenement` (mise-bas, saillie, mise en place, sortie de lot, acte), `recurrent` (RRULE), `protocole` (étape suivante d'un protocole).
- Chaque occurrence crée un `reminders` et porte le `param_version` utilisé.
- Les plans de canaux (J-7, J-1, J, J+3) et les plafonds viennent du pack pays (`message_template`, `plan`).

### 6.3 Moteur d'alertes
**Sources** : `daily_logs`, `telemetry` (`13`), `reminders` (rappel manqué critique), `stock_movements` (rupture, péremption), `camera_events`.

**Forme d'une règle :**

| Élément | Contenu |
|---|---|
| `when` | expression booléenne |
| `for` | durée minimale de la condition, ex. `30m` |
| `severity` | `info`, `attention`, `critique` |
| `channels` | canaux de notification |
| `recipients` | `owner`, `astreinte`, `veterinaire`, `organisation` |
| `escalation` | délais et niveaux d'escalade |
| `cooldown` | délai minimal avant une nouvelle alerte |
| `propose` | action proposée : tâche, signalement, demande de service |

**Exécution :**
- au plus près de la donnée : les règles marquées `edge: true` s'exécutent sur la passerelle de ferme (`13`) ;
- les règles sur le journal s'exécutent sur le mobile hors ligne ;
- les règles sur les mesures transmises s'exécutent au serveur.

## 7. Gouvernance des publications

| État | Qui | Ce qui se passe |
|---|---|---|
| `brouillon` | auteur (référent, administrateur Structure) | édition libre dans le studio, validation de schéma en continu |
| `en_revue` | réviseur (un autre référent, obligatoire pour `global`, `filiere` et `pays`) | commentaires, comparaison avec la version publiée |
| `teste` | automatique | tests du pack (dorés, croisés mobile/serveur, résolution avec les packs dépendants, simulation sur un jeu de données de recette) |
| `publie` | publieur (rôle `param_publisher`) | signature, diffusion par la synchronisation, journal de publication |
| `retire` | publieur | les nouvelles saisies utilisent la version précédente ; l'historique reste lisible |

Règles :
- **RG-PAR-04 (quatre yeux)** : un pack `global`, `filiere` ou `pays` ne peut pas être publié par son auteur. Pour un pack `org`, l'auteur peut publier, sauf si l'organisation a activé la revue.
- **RG-PAR-05** : un pack qui modifie un protocole sanitaire obligatoire exige la validation d'un référent vétérinaire (`role = referent_sanitaire`).
- **RG-PAR-06 (retour arrière)** : on revient à la version précédente en une action. Le retour arrière est lui-même une publication tracée.
- **RG-PAR-07 (déploiement progressif)** : la publication peut cibler d'abord un pourcentage d'exploitations ou une liste pilote.

## 8. Diffusion vers les téléphones
- Les packs résolus applicables à l'utilisateur descendent par `GET /sync/pull?entities=params`, sous forme d'un manifeste (identifiants, versions, empreintes) puis des packs modifiés.
- Le mobile vérifie la signature avant activation. Un pack non signé ou corrompu est rejeté et l'application garde la version précédente.
- Taille cible : moins de 200 Ko compressés pour un utilisateur à 2 filières (ENF-PER-03).

## 9. Studio de paramétrage (application web)

| Écran | Objet | Version |
|---|---|---|
| S01 — Catalogue des packs | liste par niveau, version, état, dépendances, adoption | V1 |
| S02 — Éditeur de formulaire | glisser-déposer des champs, propriétés, conditions, aperçu mobile en direct | V1 |
| S03 — Éditeur de protocole | étapes, intervalles, obligations, délais d'attente ; frise de rappels simulée sur un animal fictif | V1 |
| S04 — Éditeur d'indicateurs et de règles | expression avec complétion, vérification de type, essai sur des données de recette | V1 |
| S05 — Éditeur de projection | paramètres par défaut, formules, tests dorés (import des valeurs des classeurs) | V1 |
| S06 — Modèles de messages | textes par langue, variables, aperçu SMS (compte de caractères et de segments) | V1 |
| S07 — Revue et publication | comparaison avec la version publiée (diff), commentaires, tests, publication, retour arrière, déploiement progressif | V1 |
| S08 — Bac à sable | exploitation fictive : simule 90 jours de saisie et affiche rappels, alertes et indicateurs | V2 |
| S09 — Packs d'organisation | sous-ensemble ouvert aux administrateurs Structure (protocoles maison, champs supplémentaires, messages) | V2 |
| S10 — Bibliothèque partagée | packs publiés par des organisations, réutilisables après revue | V3 |

## 10. Packs à livrer

| Pack | Contenu | Version |
|---|---|---|
| `global.core` | espèces, maladies (avec indicateurs « à déclaration » et « zoonose »), intrants, unités, devises, correspondances OMSA et ICAR | MVP |
| `filiere.volaille` | chair, ponte, poulette | MVP |
| `filiere.canin` | élevage, dressage, pension, K9 (V2) | MVP |
| `filiere.porcin`, `filiere.petits_ruminants`, `filiere.bovin`, `filiere.lapin` | voir `10-filieres.md` | V1 |
| `pays.CM` | Cameroun | MVP |
| `pays.SN`, `pays.CI` | Sénégal, Côte d'Ivoire | V2 |
| `filiere.pisciculture`, `filiere.apiculture` | nouvelles filières, preuve du concept | V3 |

## 11. Exigences

| ID | Exigence | Priorité · Version |
|---|---|---|
| EF-PAR-01 | Les objets du §3 sont lus depuis des packs ; aucun comportement propre à une espèce n'est codé en dur | M · MVP |
| EF-PAR-02 | Résolution à 5 niveaux avec les politiques de surcharge du §2, identique sur mobile et serveur | M · MVP |
| EF-PAR-03 | Packs signés, versionnés, synchronisés, vérifiés hors ligne | M · MVP |
| EF-PAR-04 | Moteur de formulaires générique (types et attributs du §6.1), stockage `attributes` validé | M · MVP |
| EF-PAR-05 | Langage d'expressions (§5) partagé mobile/serveur, avec tests croisés | M · MVP |
| EF-PAR-06 | Gouvernance des publications (§7) : états, quatre yeux, retour arrière | M · V1 |
| EF-PAR-07 | Studio S01 à S07 pour les référents internes | S · V1 |
| EF-PAR-08 | Moteur de workflows configurables (séjour en pension, campagne, demande de service) | S · V1 |
| EF-PAR-09 | Déploiement progressif d'une publication (pourcentage ou liste pilote) | S · V1 |
| EF-PAR-10 | Bac à sable S08 et studio ouvert aux Structures (S09) | S · V2 |
| EF-PAR-11 | Provenance visible de chaque paramètre résolu (niveau, version) | S · V1 |
| EF-PAR-12 | Bibliothèque partagée de packs (S10) | C · V3 |

## 12. Données ajoutées (détail dans `03` §15)
`param_packs`, `param_pack_versions`, `param_reviews`, `param_assignments`, `param_publications`, `farm_settings` ; colonne `attributes jsonb` et colonne `param_version` sur les entités saisies (`batches`, `animals`, `dogs`, `daily_logs`, `health_events`, `reproduction_events`, `checklist_runs`…).
