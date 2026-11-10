# 08 — Exigences non fonctionnelles et gouvernance des données (v2.2)

> Version 2.2 — 27/10/2026. Ajouts v2.2 : ENF-PAR, ENF-IOT, ENF-ANA, ENF-INT ; objectifs de service détaillés dans `15` §2 ; normes et preuves dans `14`. Les cibles mesurables du cahier des charges v2.0 (.docx) sont reprises ici et complétées.

## 1. Cibles mesurables

| Réf. | Exigence | Cible mesurable | Vérification |
|---|---|---|---|
| ENF-OFF-01 | Hors ligne | 100 % des saisies, consultations, calculs (KPIs, projection, consanguinité) et rappels locaux sans réseau. Exceptions : OTP, paiement, vidéo, numéro de facture définitif | test en mode avion (`11` T-01, T-07) |
| ENF-PER-01 | Démarrage | < 3 s à froid sur un appareil de référence d'entrée de gamme (Android 8, 2 Go de RAM) | mesure sur appareil réel |
| ENF-PER-02 | Réactivité locale | < 100 ms par lecture ou écriture locale ; < 300 ms pour un calcul de consanguinité sur 5 générations | profilage |
| ENF-PER-03 | Consommation de données | < 5 Mo par mois en usage courant, hors médias et vidéo | compteur réseau sur 30 jours |
| ENF-PER-04 | Taille de l'application | APK ≤ 25 Mo (split par ABI) | build CI |
| ENF-PER-05 | Vidéo (option caméras) | basse résolution par défaut ≤ 300 kbit/s ; démarrage du flux < 5 s en 4G | test terrain |
| ENF-DIS-01 | Disponibilité de l'API | ≥ 99,5 % par mois | supervision |
| ENF-SYN-01 | Synchronisation | aucune perte de saisie ; tout conflit est résolu et journalisé ; un rattrapage de 30 jours hors ligne se synchronise en < 2 min en 3G | test T-07 |
| ENF-NOT-01 | Délivrabilité | ≥ 95 % des SMS de rappel délivrés à J-1 (selon les accusés de l'agrégateur) | `outbound_messages` |
| ENF-CMP-01 | Compatibilité | Android ≥ 8.0 (API 26) ; iOS ensuite ; feature phones via SMS/USSD | matrice d'appareils |
| ENF-ACC-01 | Accessibilité | cibles tactiles ≥ 44 px, contraste AA, texte redimensionnable à 200 %, lisibilité en plein soleil | audit |
| ENF-I18N-01 | Multilingue | fr et en au MVP ; langues locales pour le vocal et les SMS en V2 ; 0 libellé en dur | analyse statique |
| ENF-PAR-01 | Packs de paramètres | < 200 Ko compressés pour un utilisateur à 2 filières ; résolution complète < 300 ms au démarrage ; évaluation d'une expression < 10 ms | mesure sur appareil de référence |
| ENF-PAR-02 | Équivalence mobile/serveur | 100 % des vecteurs de test identiques entre Dart et TypeScript | CI (`16` §5) |
| ENF-IOT-01 | Latence d'alerte | mesure → notification d'une alerte critique < 2 min dans 95 % des cas (en ligne) ; sirène locale < 30 s (passerelle) | test T-38, T-39 |
| ENF-IOT-02 | Autonomie de la passerelle | 7 jours de mesures en mémoire ; 24 h sur batterie | test matériel |
| ENF-ANA-01 | Analytique respectueuse | aucun contenu saisi ni identifiant direct dans les événements ; désactivable ; identifiant pseudonyme renouvelé chaque année | revue de code, T-52 |
| ENF-INT-01 | Exports | export DHIS2 d'un mois pour un pays < 10 min ; fichiers d'export signés (sha256) | test T-45 |
| ENF-SEC-01 | Sécurité | chiffrement en transit et de la base locale ; audit de toutes les écritures ; test d'intrusion avant la mise en production V1 | rapport de pentest |

## 2. Hors ligne et résilience réseau
- Toutes les fonctions de saisie, de consultation et de calcul, et le déclenchement des rappels, fonctionnent sans réseau.
- Synchronisation en tâche de fond, files persistantes, réessais avec délai croissant ; **aucune perte de saisie**.
- Dégradation gracieuse : les listes en cache sont marquées « peut être obsolète ».

## 3. Performance
Voir le §1. Payloads compacts (gzip), images en basse résolution par défaut (≤ 200 Ko), synchronisation incrémentale, pagination.

## 4. Compatibilité et appareils
Android d'abord (large parc d'appareils anciens) ; iOS ensuite ; feature phones adressés par **SMS/USSD** et **vocal**.

## 5. Internationalisation et accessibilité
- Libellés externalisés ; référentiels traduisibles ; **français** par défaut, anglais ; ajout de **langues locales** (au moins pour le vocal et les SMS).
- Formats de date, de nombre et de **monnaie** localisés selon `ref_currencies` (XOF, XAF, GNF : pas de décimales ; CDF, MGA : 2 décimales).
- Accessibilité : voir ENF-ACC-01.

## 6. Sécurité
- TLS 1.2+ ; **base locale chiffrée** (SQLCipher) ; jetons dans Keystore/Keychain ; code PIN optionnel.
- Authentification OTP + JWT court (15 min) + refresh (30 jours, rotation, révocation à la déconnexion).
- **Autorisation** par rôle et par **portée** : un agent n'accède qu'aux exploitations de son portefeuille, un prestataire qu'à ses demandes, une personne qu'aux caméras auxquelles elle a été autorisée.
- Contrôle de formule au serveur (`PLAN_REQUIRED`) en plus du gating local signé.
- Audit de toutes les écritures (y compris les saisies d'agent) ; rate limiting ; validation stricte des entrées ; protection contre l'injection.
- Webhooks entrants (paiement, SMS, WhatsApp) et sortants signés par HMAC, avec protection contre le rejeu.
- Certificats QR signés (HMAC), vérifiables sans exposer de donnée personnelle.
- Caméras : connexion sortante uniquement, identifiants Wi-Fi jamais stockés en clair, jetons de flux de 5 minutes, liens de clips signés et courts.
- Sauvegardes chiffrées ; plan de restauration testé chaque trimestre ; secrets gérés hors du code.

## 7. Gouvernance et confidentialité des données
- **GOV-01 Propriété** : les données d'un animal ou d'une exploitation appartiennent à leur propriétaire. L'utilisateur peut **exporter** (EF-CON-03) et **supprimer** (EF-CON-04) ses données.
- **GOV-02 Consentement** explicite, horodaté, versionné, révocable et à portée définie (`consents.scope`), avant toute contribution à la surveillance ou tout partage avec une organisation, un vétérinaire ou un prestataire.
- **GOV-03 Cloison** stricte entre les données individuelles identifiantes (schéma `app`) et les agrégats de surveillance (schéma `surveillance`) ; k-anonymat ≥ 5 exploitations par cellule diffusée ; pas de revente de données individuelles.
- **GOV-04 Conformité** : alignement sur les lois nationales de protection des données des pays cibles (plusieurs pays UEMOA et CEMAC ont une autorité et une loi, souvent inspirées du RGPD) : information claire, base légale, droits d'accès, de rectification et de suppression, registre des traitements, désignation d'un responsable ; localisation de l'hébergement à préciser par marché ; **option d'hébergement souverain** pour les déploiements Institution.
- **GOV-05 Partage sanitaire** : les données de couverture (dont la rage) et les signalements partagés avec les services vétérinaires suivent une convention définie avec le référent (Jean-Marc), compatible avec les cadres de l'OMSA et les réseaux nationaux.
- **GOV-06 Minimisation** : ne collecter que ce qui sert une fonction. Les numéros d'identification (puce) sont partiellement masqués sur les certificats partagés.
- **GOV-07 Conservation** : clips vidéo 7 jours (paramétrable, 30 jours au maximum) ; journaux d'envoi 24 mois ; journaux d'audit 5 ans ; données de compte jusqu'à la suppression demandée, plus le délai légal.
- **GOV-08 Vidéo** : la caméra filme l'élevage. L'utilisateur est informé qu'il doit signaler la présence de caméras aux personnes qui travaillent sur le site, conformément au droit local ; aucun flux n'est partagé avec des tiers.

## 8. Fiabilité et exploitation
- Disponibilité : ENF-DIS-01 ; files et idempotence pour tolérer les coupures.
- Observabilité : logs centralisés, suivi des erreurs (Sentry), métriques d'usage **anonymisées**, tableaux de délivrabilité des messages.
- Migrations de schéma versionnées et réversibles ; environnements `dev`, `staging` et `prod`.

## 9. Qualité et tests
- Tests unitaires (rappels, indicateurs, stocks, consanguinité, montants multi-devises), tests d'intégration (synchronisation, paiement, SMS), tests hors ligne (coupure réseau simulée), tests sur des appareils bas de gamme réels.
- **Tests dorés** du moteur de projection, alignés sur les classeurs de référence (`11` T-30).
- Jeux de données de recette : référentiels préchargés ; cas de rappels rage, PPR et Newcastle ; pedigrees de contrôle (demi-frères, pleins frères, cousins germains).

## 10. Éthique et bien-être
- Messages utiles et non intrusifs : fréquence plafonnée (RG-NOT-02), heures calmes, désinscription par canal.
- Pas de revente de données individuelles ; la monétisation des données se limite aux **agrégats consentis**, au bénéfice de la santé publique.


## 11. Ajouts v2.2
- **Paramétrage** : un pack invalide ne peut pas être publié ; un pack corrompu ou non signé n'est jamais activé sur un téléphone (la version précédente reste active).
- **Suivi à distance** : connexions sortantes uniquement ; certificats par passerelle ; règles et mises à jour signées ; les mesures appartiennent à l'exploitation et ne sont jamais partagées avec un fabricant.
- **Interopérabilité** : tout export d'agrégat respecte le k-anonymat et les consentements ; chaque export est journalisé avec son empreinte.
- **Résidence des données** : les données personnelles restent dans la région de production de leur pays (`04` §17, `15` §4).
