# 17 — Pilote, ouverture des pays et indicateurs de pilotage (v2.2)

> Version 2.2 — 27/10/2026. **Nouveau fichier.** Il reprend les sections 13 à 16 du document conceptuel. Il précise ce que l'équipe de développement doit fournir pour piloter le lancement : outils d'enrôlement, mesures, tableaux de bord et décisions de passage.

## 1. Décisions de passage

| Décision | Moment | Critères (tous requis) | Responsable |
|---|---|---|---|
| **Go pilote** | fin du MVP (≈ mois 3) | cas de test du lot MVP au vert ; essais sur 10 téléphones d'entrée de gamme ; SLO de `15` §2 respectés en `staging` sous charge ; déclarations de protection des données faites ; packs `global.core`, `filiere.volaille`, `filiere.canin`, `pays.CM` publiés | comité de pilotage |
| **Go payant** | fin du pilote (≈ mois 7) | ≥ 60 % de rappels confirmés à temps ; ≥ 40 % d'éleveurs actifs chaque semaine ; ≥ 5 % de conversion vers Pro ; 1 contrat Structure signé ; revue de capacité faite | comité de pilotage |
| **Go expansion** | ≈ mois 12 | couverture antirabique mesurée dans la zone pilote ; 1 convention avec un service vétérinaire ; coût d'acquisition < 3 mois de revenu par client ; packs `pays.SN` et `pays.CI` publiés | comité de pilotage |

## 2. Plan du pilote (Yaoundé, mois 4 à 6)

| Élément | Contenu |
|---|---|
| Zone | Yaoundé et périphérie (Mfou, Soa) ; un quartier à forte densité canine |
| Filières | chiens (rappel antirabique) et volaille périurbaine |
| Partenaires | service vétérinaire régional (MINEPIA), 2 à 3 cliniques, 1 coopérative avicole, 1 centre canin, 1 agrégateur de mobile money, 1 agrégateur SMS et USSD |
| Population | 300 éleveurs et propriétaires de chiens, 10 agents ou auxiliaires, 5 vétérinaires |
| Accompagnement | enrôlement assisté par les agents (mode agent), formation de 2 h, assistance par WhatsApp |
| Prix testés | Pro à 2 500 FCFA ; Pro canin à 2 prix (décision D-10) ; Structure de lancement |
| Sortie | rapport de pilote : indicateurs du §4, retours qualitatifs, anomalies, revue de capacité, décision Go payant |

**Outils à livrer pour le pilote** (inclus dans le MVP) :
- import en masse du cheptel et des clients (EF-INT-09, avancé au MVP pour le pilote) ;
- tableau de bord du pilote : indicateurs du §4, par agent et par filière ;
- formulaire de retour intégré à l'application (« Signaler un problème », avec capture d'écran et journaux techniques, sans donnée personnelle) ;
- interrupteurs de fonctionnalités (feature flags) par pays et par cohorte.

## 3. Ouverture d'un pays (procédure RB-09)

| Étape | Livrable | Qui |
|---|---|---|
| 1. Pack pays | `pays.XX` publié : protocoles nationaux, maladies à déclaration, langues, devise, prix, modèles de messages, correspondances d'export | référent pays + comité scientifique |
| 2. Juridique | déclaration ou autorisation à l'autorité de protection des données, décision d'hébergement, conditions générales locales, registre des traitements | DPO, juriste |
| 3. Partenaires techniques | agrégateur de mobile money, codes courts SMS et USSD, compte WhatsApp, installateurs de matériel | chef de produit |
| 4. Institutionnel | convention avec le service vétérinaire ; correspondance DHIS2 ou ARIS si demandée | fondateur |
| 5. Infrastructure | région d'hébergement (`prod-XX`) ou rattachement à une région existante | DevOps |
| 6. Terrain | recrutement et formation des agents, démonstrations | équipe commerciale |
| 7. Lancement | suivi renforcé pendant 8 semaines, revue à 30 et 60 jours | comité produit |

## 4. Indicateurs de pilotage (définitions et calcul)

| Famille | Indicateur | Définition | Source de calcul | Pilote | 36 mois |
|---|---|---|---|---|---|
| Phare | Rappels confirmés à temps | rappels `confirme` avec `confirmed_at ≤ due_date + 3 j` ÷ rappels dus sur la période | `reminders` | ≥ 60 % | ≥ 75 % |
| Usage | Éleveurs actifs chaque semaine | utilisateurs avec au moins une écriture ou confirmation dans la semaine ÷ inscrits | événements d'usage (§5) | ≥ 40 % | ≥ 45 % |
| Usage | Rétention à 90 jours | cohorte d'inscrits encore active au jour 90 | événements d'usage | ≥ 35 % | ≥ 50 % |
| Usage | Temps de saisie quotidien | médiane de la durée des sessions de saisie par exploitation | événements d'usage | < 5 min | < 3 min |
| Santé animale | Couverture antirabique | chiens vaccinés dans l'année ÷ population canine estimée de la zone | schéma `surveillance` | mesurée | ≥ 70 % en zone de campagne |
| Santé animale | Délai de signalement | médiane entre l'alerte de mortalité anormale et l'envoi du signalement | `disease_signals`, `alert_events` | mesuré | < 24 h |
| Santé animale | Mortalité des lots suivis | par filière, comparée aux références de `10` | `daily_logs` | mesurée | en baisse d'une année sur l'autre |
| Commercial | Conversion vers Pro | nouveaux Pro du mois ÷ inscrits du mois | `subscriptions` | ≥ 5 % | 4 % |
| Commercial | Contrats Structure et Institution | nombre de contrats actifs | `subscriptions`, contrats | 1 Structure | 53 Structure, ≥ 2 Institution |
| Commercial | Coût d'acquisition | dépenses d'acquisition ÷ nouveaux payants | comptabilité + `subscriptions` | mesuré | < 3 mois de revenu |
| Financier | Revenu mensuel récurrent | par devise | `payments`, `subscriptions` | — | 3,5 M FCFA (scénario de base) |
| Financier | Attrition | résiliations mensuelles Pro / Structure | `subscriptions` | mesurée | ≤ 3 % / ≤ 1 % |
| Financier | Coût des messages par payant | coût des `outbound_messages` ÷ payants | `outbound_messages` | mesuré | ≤ 120 FCFA par mois |
| Technique | Synchronisations réussies | lots appliqués sans erreur ÷ lots envoyés | journaux de synchronisation | ≥ 99 % | ≥ 99,5 % |
| Technique | SMS délivrés à J-1 | accusés de réception ÷ envoyés | `outbound_messages` | ≥ 95 % | ≥ 95 % |
| Suivi à distance | Alertes acquittées en moins de 15 min | acquittées à temps ÷ déclenchées | `alert_events` | — | ≥ 80 % |

## 5. Événements d'usage (analytique produit)
- **Principe** : des événements anonymisés par utilisateur (identifiant pseudonyme haché et salé, renouvelé chaque année), sans contenu saisi ni donnée personnelle. Ils sont envoyés par lots à la synchronisation et stockés dans l'entrepôt analytique. Ils sont désactivables dans les réglages.
- **Catalogue minimal** : `app_open`, `sync_completed` (durée, nombre de changements), `form_submitted` (code du formulaire, durée, mode hors ligne oui/non), `reminder_viewed`, `reminder_confirmed` (canal), `alert_acknowledged` (délai), `paywall_viewed` (fonction), `checkout_started`, `checkout_succeeded`, `service_request_sent`, `export_requested`, `feedback_sent`.
- **Propriétés communes** : version de l'application, version des packs, pays, filière, type d'appareil, qualité réseau (2G, 3G, 4G, Wi-Fi), langue.

## 6. Tableaux de bord à livrer

| Tableau | Public | Contenu | Version |
|---|---|---|---|
| Pilotage produit | comité de pilotage | indicateurs du §4, cohortes, entonnoir de conversion | MVP (pilote) |
| Exploitation | équipe technique | SLO, erreurs par version, file des SMS, synchronisation, paiements en attente | MVP |
| Structure | coopérative, clinique | éleveurs suivis, rappels, couverture, activité des agents | V1 |
| Surveillance | service vétérinaire | couverture par zone, signalements, campagnes, carte (k-anonymat) | V2 |
| Suivi à distance | exploitation | mesures, alertes, acquittements | V3 |
