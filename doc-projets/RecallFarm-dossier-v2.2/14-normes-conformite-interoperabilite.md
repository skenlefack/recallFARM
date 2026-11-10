# 14 — Normes, conformité et interopérabilité (v2.2)

> Version 2.2 — 27/10/2026. **Nouveau fichier.** Il traduit la section 3 du document conceptuel en exigences vérifiables, avec le propriétaire de chaque norme et la preuve attendue en recette.
> Exigences d'interopérabilité : **EF-INT-01 à EF-INT-09**. Exigences de conformité : **EF-CMP-01 à EF-CMP-08**.

## 1. Matrice normes → exigences → preuves

| Norme ou référentiel | Ce qu'elle impose | Exigences RecallFarm | Preuve en recette | Propriétaire |
|---|---|---|---|---|
| Code terrestre et Manuel de l'OMSA ; liste des maladies à déclaration ; WAHIS | notification, définitions de cas | `ref_diseases.notifiable`, EF-BIO-03, EF-INT-05 | T-28, T-45 | référent sanitaire |
| Stratégie mondiale d'éradication de la PPR (2030) ; « Zéro décès dû à la rage d'ici 2030 » | couverture vaccinale mesurée, campagnes | EF-VAC-07, EF-SUR-01/02, certificat antirabique | T-01, T-35, T-36 | référent sanitaire |
| OMSA, base ANIMUSE (usage des antimicrobiens chez l'animal) | quantités par classe d'antimicrobien | EF-AMU-01/02 (§3) | T-46 | référent sanitaire |
| Codex Alimentarius (limites maximales de résidus) | délais d'attente | EF-VAC-05, RG-VEN-02 | T-20 | référent sanitaire |
| Normes de bien-être de l'OMSA | densité, eau, soins | densités et besoins en eau dans les packs ; alertes eau et chaleur (`13`) | T-41 | référent filière |
| ISO 11784 / ISO 11785 ; ISO 24631 | identifiant RFID à 15 chiffres (code pays ISO 3166 numérique + numéro national) | champ `rfid` du moteur de formulaires ; contrôle du format ; lecture Bluetooth (V2) | T-47 | architecte |
| ICAR, Animal Data Exchange (v1.5.0) | schémas d'échange pour animaux, événements et traitements | EF-INT-01 | T-48 | architecte |
| GS1 / EPCIS 2.0 | événements de traçabilité | EF-INT-07 (V3) | — | architecte |
| GLOBALG.A.P., guides FAO de bonnes pratiques | registres, hygiène, biosécurité | check-lists, exports de registres (EF-INT-08) | T-29 | référent filière |
| Convention de Malabo (UA, en vigueur depuis le 8 juin 2023) ; loi camerounaise n° 2024/017 (en vigueur depuis le 23 juin 2026) ; loi sénégalaise 2008-12 ; loi ivoirienne 2013-450 ; RGPD (résidents de l'UE) | consentement, minimisation, droits, autorisation des transferts, sécurité | EF-CON-*, EF-CMP-01 à 05, hébergement par pays (`15`) | T-24, T-25, T-49 | DPO |
| ISO/IEC 27001:2022 | système de management de la sécurité | EF-CMP-06, `08` §6, `15` | audit de certification (fin V2) | responsable sécurité |
| OWASP ASVS niveau 2 (serveur), MASVS-L2 (mobile) | contrôles de sécurité applicative | `08` §6 | rapport de test d'intrusion | responsable sécurité |
| ISO/IEC 25010 | modèle de qualité | ENF de `08` | rapport de recette | QA |
| WCAG 2.2 niveau AA | accessibilité | ENF-ACC-01 | audit d'accessibilité | UX |
| OpenAPI 3.1 ; OAuth 2.0 / OpenID Connect ; ISO 8601, ISO 3166, ISO 4217, ISO 639 | contrats d'API, authentification, formats | `05` | contrôle automatique du contrat (CI) | architecte |
| API Mobile Money de la GSMA ; règles BCEAO et BEAC | interface de paiement, conformité des intermédiaires | EF-ABO-*, agrégateur agréé | T-08 | responsable produit |
| MQTT, LoRaWAN, ONVIF, RTSP, WebRTC | protocoles ouverts | `13` | T-37 à T-41 | ingénieur IoT |

## 2. Conformité « données personnelles »

| ID | Exigence | Priorité · Version |
|---|---|---|
| EF-CMP-01 | Registre des traitements tenu à jour (finalité, base légale, données, durée, destinataires, transferts) pour chaque pays ouvert | M · MVP |
| EF-CMP-02 | Analyses d'impact (AIPD) pour : géolocalisation des exploitations, vidéo, partage avec l'État, scores pour les financeurs | M · avant la mise en service de chaque traitement |
| EF-CMP-03 | Déclaration ou autorisation auprès de l'autorité nationale avant ouverture d'un pays ; autorisation de transfert si les données sont hébergées hors du pays | M · MVP (Cameroun) |
| EF-CMP-04 | Délégué à la protection des données désigné, joignable depuis l'application (E65) | M · MVP |
| EF-CMP-05 | Notification des violations de données à l'autorité et aux personnes concernées dans les délais légaux ; procédure testée une fois par an | M · V1 |
| EF-CMP-06 | Politique de sécurité conforme à l'ISO/IEC 27001 ; certification visée à la fin de la V2 | S · V2 |
| EF-CMP-07 | Charte publique des données en 10 points (propriété, non-revente, agrégats consentis, portabilité, effacement…) | M · MVP |
| EF-CMP-08 | Conventions de partage signées avec chaque service vétérinaire destinataire d'agrégats | M · avant tout export |

## 3. Usage des antimicrobiens (nouveau module AMU)
- **EF-AMU-01 [S · V1]** : chaque traitement antimicrobien (`health_events.event_type = traitement`) enregistre le principe actif, la classe (référentiel OMSA/OMS) et la quantité de produit, ou le nombre de doses et la concentration.
- **EF-AMU-02 [C · V2]** : agrégats anonymes par classe d'antimicrobien, espèce, zone et année, exportables dans un format compatible avec la collecte ANIMUSE du pays (avec consentement `surveillance_agregats`).
- Référentiel ajouté : `ref_active_substances` (substance, classe, importance critique selon la liste OMS).

## 4. Interopérabilité

| ID | Exigence | Format | Version |
|---|---|---|---|
| EF-INT-01 | API d'export et d'import des animaux, événements, traitements et reproduction au format **ICAR ADE** | JSON (schémas ICAR ADE v1.5) | V2 |
| EF-INT-02 | Export d'agrégats vers **DHIS2** (couverture vaccinale, signalements, campagnes) par jeu de données, selon une correspondance du pack pays | API web DHIS2 / ADX | V2 |
| EF-INT-03 | Export vers **ARIS** (UA-BIRA), selon le format convenu avec l'UA-BIRA | à obtenir (CSV ou API) | V2 |
| EF-INT-04 | Export des vaccinations canines et des morsures vers la **plateforme GARC** (programmes rage) | format GARC | V2 |
| EF-INT-05 | Préparation des notifications de foyers au format **EMA-i+ / EMPRES-i+**, à valider par le service vétérinaire (aucun envoi automatique à WAHIS : c'est la prérogative de l'État) | format FAO | V2 |
| EF-INT-06 | **API publique** documentée (OpenAPI 3.1), authentification OAuth 2.0 (code d'autorisation + PKCE pour les applications, identifiants client pour les serveurs), quotas par client, webhooks signés | REST JSON | V3 (lecture seule en V2 pour l'offre Institution) |
| EF-INT-07 | Export des mouvements et des ventes en **EPCIS 2.0** pour les filières à l'export | JSON-LD EPCIS | V3 |
| EF-INT-08 | Export des registres d'élevage (traitements, mouvements, mortalité) en PDF et CSV, pour les audits et les inspections | PDF, CSV | V1 |
| EF-INT-09 | Import en masse (CSV ou tableur) du cheptel et de l'historique sanitaire, avec rapport d'erreurs, pour l'enrôlement des coopératives | CSV, XLSX | MVP (pour l'enrôlement du pilote) |

**Principes d'interopérabilité :**
- Chaque export repose sur une **correspondance paramétrée** (`export_mapping`, `12` §3), versionnée par pays. Un changement de format national ne demande pas de développement.
- Les exports d'agrégats passent par le schéma `surveillance`. Ils respectent le k-anonymat (RG-SUR-02) et les consentements.
- Chaque export est journalisé : qui, quand, quoi, vers où, et l'empreinte du fichier.
