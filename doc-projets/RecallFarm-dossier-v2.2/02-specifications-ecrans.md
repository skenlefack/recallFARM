# 02 — Spécifications écran par écran (v2.2)

> Version 2.2 — 27/10/2026. Ajouts v2.2 : E70 à E81 (suivi à distance, mode vétérinaire de terrain, imports et exports, USSD, retour utilisateur) ; les écrans du studio (S01 à S10) sont décrits dans `12` §9. Tous les formulaires sont rendus par le **moteur de formulaires** à partir des packs : les tableaux de champs ci-dessous sont les valeurs par défaut des packs `global.core` et `filiere.*`. Référence visuelle : `maquette/recallfarm-maquette.html`. La correspondance entre les écrans de la maquette et les codes E-xx est donnée en fin de document.
> Pour chaque écran : objet, champs, actions, validations, états (vide / erreur / hors ligne), formule minimale (🆓 Découverte, ⭐ Pro, 🏢 Structure) et version.

Navigation principale par barre d'onglets : **Accueil · Cheptel · Santé · Marché · Plus**.

Conventions :
- Un champ obligatoire est marqué `*`. Les erreurs s'affichent sous le champ, en rouge, et bloquent l'enregistrement.
- Sans réseau, un bandeau « Hors ligne — enregistré, sera synchronisé » s'affiche ; l'enregistrement reste possible.
- **Montants** : affichés dans la devise de l'exploitation (symbole issu de `ref_currencies`), jamais « FCFA » en dur ; saisie sans décimale pour XOF/XAF/GNF.
- Un module non inclus dans la formule affiche un écran de verrou : explication, bouton « Passer Pro » ou « Passer Structure ». Ce verrou fonctionne hors ligne.

---

## Onboarding et compte

### E01 — Choix de la spéculation · MVP 🆓
- **Contenu** : grille des spéculations (aviculture, petits ruminants, bovins, porcins, cuniculture, élevage canin, dressage/éducation, pension canine, vétérinaire, coopérative), avec icône, libellé et description.
- **Actions** : sélectionner, puis E02. ⭐ Plusieurs spéculations possibles.
- **États** : affiché à la première ouverture uniquement ; accessible ensuite via la puce de spéculation en haut d'écran.

### E02 — Création de compte · MVP 🆓
- **Champs** : indicatif pays*, téléphone* (E.164), OTP* (6 chiffres), e-mail (optionnel).
- **Actions** : envoyer l'OTP, vérifier. Hors ligne : création d'un compte local provisoire, rattaché à la synchronisation.
- **Validations** : format E.164 ; OTP requis en ligne ; RG-AUT-01.

### E03 — Consentements · MVP 🆓 *(nouveau)*
- **Contenu** : résumé lisible de la politique de confidentialité (lien vers le texte complet, versionné) ; cases séparées : CGU* ; partage avec mon vétérinaire ou ma Structure ; contribution anonyme à la surveillance sanitaire ; messages WhatsApp ; messages SMS.
- **Actions** : Continuer, ce qui crée un enregistrement `consents` par case. Les choix sont modifiables plus tard dans E65.
- **Validations** : CGU obligatoires ; les autres cases sont facultatives.

### E04 — Exploitation · MVP 🆓
- **Champs** : nom de l'exploitation* (3–80 caractères), pays* (prérempli selon la carte SIM ou le GPS), région, GPS (capture optionnelle), superficie (ha ≥ 0), responsable (défaut : l'utilisateur). La devise est affichée, déduite du pays et modifiable.
- **Actions** : Enregistrer ; proposer « Activer le calendrier type de ma filière » (EF-ONB-04), puis E10.

---

## Accueil et cheptel

### E10 — Accueil · MVP 🆓
- **Contenu** : salutation, spéculation active, nom de l'exploitation ; bloc **« Rappels du jour »** (rappels et tâches, triés par priorité, les critiques en premier) ; **3 KPIs** de la filière (voir `10`) ; **6 actions rapides** adaptées à la filière ; bandeau « Inspirations Afrique ».
- **Actions** : ouvrir un rappel (E21) ; « Voir tous les rappels » (E20) ; actions rapides vers les formulaires ; changer de spéculation (E01).
- **États** : vide → « Aucun rappel aujourd'hui — ajoutez un animal pour commencer », avec un bouton d'action.

### E11 — Cheptel (liste) · MVP 🆓
- **Contenu** : lots, animaux individuels ou chiens, avec vignette, titre, statut et chevron ; regroupement par logement (V1).
- **Actions** : « + Ajouter » (E12) ; « Journal du jour » (E13) ; ouvrir une fiche (E14 ou E30) ; ⭐ « Logements » (E15).
- **États** : vide → invitation à ajouter ; filtres par statut, logement, espèce et type de production (V1).

### E12 — Formulaire d'ajout (adaptatif) · MVP 🆓

**Lot/bande** (volaille, petits ruminants, porcins, lapins) :

| Champ | Type | Oblig. | Validation | Défaut |
|---|---|---|---|---|
| Code du lot | texte | Oui | unique par exploitation | suggestion B01, B02… |
| Espèce | liste | Oui | `species` selon la spéculation | préréglé |
| Type de production | liste | Oui | `production_type` permis pour l'espèce | selon la spéculation |
| Souche / race | texte | Non | — | — |
| Effectif initial | entier | Oui | ≥ 1 | — |
| Date de mise en place | date | Oui | ≤ aujourd'hui | aujourd'hui |
| Âge à l'entrée (jours) | entier | Non | ≥ 0 | 1 (poussins d'un jour) |
| Provenance | texte | Non | — | — |
| Logement | liste | Non | `housing_units` hors vide sanitaire (RG-CHE-02) | — |
| Coût d'achat | montant | Non | ≥ 0 | — |

**Animal individuel** (bovins ; reproducteurs de toutes espèces de rente) : identifiant/boucle* (unique), espèce* (préréglée), sexe*, race, date de naissance ou d'entrée, rôle (reproducteur/reproductrice/production/jeune/travail), statut reproductif, logement ; ⭐ père, mère (listes filtrées par espèce et par sexe ; ou référence extérieure), référence de registre.

**Chien** : nom* (2–40 caractères), race, sexe*, date de naissance (≤ aujourd'hui), robe, gabarit, identification (puce/tatouage/photo/aucune + valeur), tempérament, statut* (compagnie/reproducteur/travail/dressage/pension ; défaut compagnie), propriétaire (moi ou un client) ; bloc santé : dernière rage (date), prochain rappel (calculé, > dernière rage) ; ⭐ père, mère, référence LOF.

- **Actions** : Enregistrer, retour à E11 avec le message « Enregistré ». Si une dernière rage est saisie, l'acte et le rappel correspondants sont créés.

### E13 — Journal quotidien (adaptatif) · MVP 🆓

Champs communs : date* (≤ aujourd'hui ; défaut aujourd'hui), sujet* (lot actif ou animal), effectif présent (défaut : dernier connu), mortalité du jour (0 ≤ x ≤ effectif), réformes, aliment (kg) et intrant consommé (liste des stocks), eau (L), observations.

Champs propres à chaque filière :

| Filière | Champs ajoutés | Calcul affiché en temps réel |
|---|---|---|
| Volaille — ponte | œufs pondus, œufs cassés, température | taux de ponte (RG-JOU-01) |
| Volaille — chair | température ; poids moyen (lien vers une pesée) | mortalité cumulée, IC si une pesée existe |
| Bovins / caprins laitiers | lait produit (L), lait vendu ou collecté (L) — par vache ou pour le troupeau | lait/vache/jour |
| Porcins, lapins, petits ruminants | — | mortalité cumulée |

- **Actions** : Enregistrer le jour, retour à E10. Une deuxième saisie le même jour pour le même sujet modifie la première (RG-JOU-05).
- **Validations** : RG-JOU-03 (erreur bloquante) ; nombres ≥ 0.
- **Comportement** : une mortalité anormale (RG-JOU-06) affiche un bandeau rouge avec le bouton « Signaler une suspicion » (E42).

### E14 — Fiche lot / animal (générique) · MVP 🆓
- **Entête** : identité, logement, statut, effectif courant ou âge.
- **Indicateurs** : ceux de la filière (voir `10`).
- **Onglets** : Santé (actes et rappels) ; Journal ; Reproduction ⭐ ; Généalogie ⭐ (V1) ; Pesées (V1) ; Mouvements (V1) ; Notes.
- **Bannière** : délai d'attente en cours, en ambre (« Vente de viande/lait/œufs bloquée jusqu'au … »).
- **Actions** : Vacciner/soigner (E22) ; Vendre (E25) ; Reproduction (E24) ; Pesée (E17) ; Mouvement (E18) ; Vérifier un accouplement (E16) ; Caméra du box (E63, si le logement a une caméra) ; Archiver.

### E15 — Logements · V1 🆓 *(nouveau)*
- **Liste** : bâtiments et leurs sous-unités (cages, cases, box), avec occupation/capacité et vide sanitaire en cours (date de fin).
- **Formulaire** : type*, nom*, rattachement (parent), capacité, surface (m²).
- **Actions** : démarrer un vide sanitaire (date de fin ; crée une tâche « Désinfection » et un rappel de fin).

### E16 — Généalogie et consanguinité · V1 ⭐ *(addendum A ; maquette « scr-conso »)*
- **Bloc « Vérifier un accouplement »** : mâle* (liste des reproducteurs de l'espèce), femelle* ; bouton « Calculer ».
- **Résultat** : coefficient F en %, verdict (✅ acceptable / ⚠️ à éviter), mention « coefficient minoré — pedigree incomplet sur N générations » si c'est le cas, ancêtres communs listés.
- **Bloc « Pedigree »** : arbre sur 3 générations (5 en V2, avec défilement) ; message « Ascendants enregistrés · aucune boucle détectée » ou liste des incohérences (EF-GEN-05).
- **Actions** : Enregistrer la vérification (`mating_checks`) ; « Planifier la saillie » (ouvre E24 prérempli).
- **États** : moins de 2 reproducteurs de sexe opposé → « Ajoutez un mâle et une femelle reproducteurs pour vérifier un accouplement ».

### E17 — Pesée · V1 🆓 *(nouveau)*
Champs : sujet*, date*, poids moyen (kg)* (> 0), taille de l'échantillon (lot), notes. Affiche le GMQ depuis la pesée précédente et l'écart à la courbe de référence de la souche, quand elle est connue.

### E18 — Mouvement · V1 🆓 *(nouveau)*
Champs : sujet*, type de mouvement*, date*, nombre (lot), provenance/destination, contrepartie, pièce justificative (n° de laissez-passer ou de certificat, photo). Pour une sortie de type vente, propose de créer la vente (E25).

---

## Santé, rappels, tâches, biosécurité

### E20 — Santé et vaccination (liste) · MVP 🆓
- **Contenu** : bouton « + Enregistrer une vaccination / un soin » (E22) ; **Rappels à venir**, avec échéance colorée (rouge : critique ou manqué ; ambre : aujourd'hui ou J-1) ; **Historique récent** ; filtre par sujet et par maladie.
- **Actions** : ouvrir un rappel (E21) ; ouvrir un certificat (E23).

### E21 — Détail d'un rappel · MVP 🆓 *(nouveau)*
- **Contenu** : sujet, maladie ou objet, échéance, état, canaux prévus, historique des envois (pour un rappel ⭐ envoyé par le serveur).
- **Actions** : **Confirmer** (ouvre E22 prérempli : maladie, produit et date du jour, puis confirmation et rappel suivant) ; **Reporter** (nouvelle date ≤ +14 j) ; **Demander un vétérinaire** (E41 prérempli, `source_reminder_id`) ; **Annuler** (motif obligatoire).

### E22 — Formulaire vaccination / soin · MVP 🆓

| Champ | Type | Oblig. | Validation | Défaut |
|---|---|---|---|---|
| Sujet | liste (lot/animal/chien) | Oui | sujet actif | depuis le contexte |
| Type d'intervention | segment | Oui | `event_type` | vaccination |
| Maladie / cible | liste | Oui si vaccination | `ref_diseases` filtré par espèce | — |
| Produit | texte ou liste (stock) | Non | — | dernier produit utilisé |
| N° de lot du produit | texte | Non | — | — |
| Dose / voie | texte | Non | — | selon le protocole |
| Date | date | Oui | ≤ aujourd'hui | aujourd'hui |
| Prochain rappel | date | Non | > date | calculé par le protocole (RG-VAC-01) |
| Délai d'attente viande / lait / œufs | dates | Non | ≥ date (traitement) | — |
| Coût | montant | Non | ≥ 0 | — |
| Réalisé par | texte ou prestataire | Non | — | moi |
| Sortie de stock | case | Non | stock suffisant (alerte non bloquante) | cochée si le produit vient du stock |

- **Comportement** : le choix maladie + espèce prérègle l'intervalle de rappel et affiche « rappel envoyé à J-7, J-1, jour J » avec les canaux effectifs (push ; ⭐ SMS/WhatsApp).
- **Actions** : « Enregistrer & programmer le rappel », retour à E20.

### E23 — Certificat de vaccination · MVP ⭐
- **Contenu** : type (par exemple antirabique), **QR code**, identité de l'animal (nom, race, identification masquée partiellement) et du propriétaire, vaccin, n° de lot, date, date de validité, vétérinaire.
- **Actions** : Partager (PDF ou WhatsApp). Disponible hors ligne : le QR encode l'identifiant de l'acte et une signature HMAC vérifiable au serveur (`GET /certificates/verify`).

### E24 — Reproduction · V1 ⭐
- **Champs** : femelle* (animal ou chienne), événement* (chaleurs / saillie / IA / diagnostic de gestation / tarissement / mise-bas / avortement / sevrage), date*, mâle (liste) ou référence extérieure / semence, résultat (diagnostic), mise-bas prévue (calculée, ajustable), notes.
- **Comportement** : pour une **saillie ou une IA** avec un mâle connu, la consanguinité est calculée automatiquement ; si le verdict est « à éviter », un bandeau ⚠️ apparaît (EF-GEN-04) et il faut confirmer avant d'enregistrer. Une alerte de mise-bas est programmée.
- **Mise-bas** : nés vivants*, morts-nés ; puis « Créer les jeunes » : soit un lot (porcelets, lapereaux, agneaux : code et logement), soit des individus (veaux, chiots : nom ou identifiant, sexe, poids de naissance).

### E25 — Vente / production · MVP 🆓
- **Champs** : produit* (`product` filtré par filière), quantité* (> 0), unité (défaut selon le produit), prix unitaire* (≥ 0), client (texte ou liste), paiement* (mobile money/espèces/crédit ; défaut mobile money), statut du paiement, sujet (optionnel).
- **Calcul** : montant = quantité × prix (RG-VEN-01), affiché en direct.
- **Validations** : blocage si le sujet est sous délai d'attente (RG-VEN-02).

### E26 — Dépense · MVP 🆓
- **Champs** : catégorie* (`expense_category`), description, quantité, montant* (≥ 0), mode de paiement, fournisseur, affectation (lot/animal, optionnelle), date*.
- **Action** : pour les catégories aliment, fourrage et vétérinaire, proposer « Ajouter au stock » (crée l'entrée en E27).

### E27 — Alimentation et stocks · MVP 🆓 *(nouveau)*
- **Liste** : intrants avec stock actuel, unité, autonomie estimée en jours (V1), alerte de seuil (V1), péremption à moins de 30 jours (V1).
- **Formulaire de mouvement** : intrant*, sens* (entrée/sortie/ajustement), quantité* (> 0), coût unitaire, fournisseur, n° de lot, date de péremption (produits vétérinaires), destination (lot/animal pour une sortie), date*.
- **Validations** : une sortie supérieure au stock affiche une alerte non bloquante (« stock négatif »).

### E28 — Trésorerie et économie · V1 ⭐ *(nouveau)*
- **Contenu** : par mois et par devise : recettes, dépenses, solde, cumul ; marge brute par lot ou par atelier ; coût de revient par unité (kg vif, œuf, litre, chiot) ; part de l'aliment dans les charges.
- **Actions** : filtrer par période ; exporter en CSV ou PDF.

### E29 — Projection / simulateur · V1 ⭐ *(nouveau)*
- **Contenu** : choix de la filière et de l'atelier (chair, ponte, naissage…) ; **unité d'entrée** en grand (ex. « Nombre de truies ») ; paramètres repliables (préremplis depuis `ref_projection_defaults`) ; résultats en 3 blocs, comme dans les classeurs : Performance, Structure & intrants, Économie.
- **Actions** : modifier un paramètre recalcule tout instantanément ; Enregistrer le scénario ; comparer 2 scénarios ; « Utiliser mes données réelles » (V2).
- **Mentions** : « Marge brute sur coûts variables, avant amortissement » (bovins et porcins) ; « Montée en régime : premières ventes vers le mois 5 » (lapins).

### E40 — Marché et mise en relation · V1 🆓
- **Contenu** : filtre par type de prestataire ; liste (vignette, nom, spécialité, distance, note V2, badge « vérifié ») ; bouton « Demander » (E41) ; encart mode agent 🏢.
- **États** : hors ligne → liste en cache avec la mention « certaines fiches peuvent être obsolètes ».

### E41 — Demande de service · V1 🆓
- **Champs** : prestataire (prérempli, lecture seule), besoin* (`service_need`), animal ou lot concerné, date souhaitée, lieu, message.
- **Action** : Envoyer (dans l'app et par WhatsApp au prestataire) ; suivi du statut (§5.3 de `01`). Hors ligne : la demande est mise en file et part à la synchronisation.

### E42 — Signaler une suspicion · V1 🆓 *(nouveau)*
- **Champs** : sujet, maladie suspectée (liste ou « je ne sais pas »), signes cliniques* (cases), date d'apparition, nombre d'animaux touchés, nombre de morts, photos (optionnelles).
- **Comportement** : si la maladie est réglementée, un bandeau rouge rappelle l'obligation de déclaration et le bouton **« Prévenir mon vétérinaire / ma Structure »** apparaît (avec le consentement de partage). Conseils de confinement affichés selon la maladie (ex. PPA : ne déplacer aucun porc).
- **Actions** : Enregistrer ; Envoyer (statut `envoye`).

### E43 — Check-list de biosécurité · V1 ⭐ *(nouveau)*
- **Contenu** : items de la check-list de la filière (Oui / Non / Sans objet), items critiques marqués ; score en % et liste des manquements critiques.
- **Actions** : Enregistrer ; un manquement critique crée une tâche corrective (J+1).

### E44 — Tâches et calendrier · MVP 🆓 *(nouveau)*
- **Contenu** : vue liste « Aujourd'hui / Cette semaine / En retard » ; vue calendrier (V1).
- **Formulaire** : titre*, catégorie, sujet (optionnel), date d'échéance*, récurrence (aucune / quotidienne / hebdomadaire / mensuelle / personnalisée), responsable (V1).
- **Actions** : cocher « fait » ; activer un calendrier type de filière (V1).

---

## Activité canine

### E30 — Fiche chien · MVP 🆓
- **Contenu** : entête (nom, race, sexe, âge, photo), identification, statut, propriétaire ; **état de la rage** (en ambre à 30 jours de l'échéance, en rouge si elle est échue) ; carnet de santé (historique) ; ⭐ encart consanguinité (coefficient, père, mère) ; portées (chiennes).
- **Actions** : Vacciner (E22) ; Certificat (E23) ; Saillie (E24) ; Vérifier un accouplement (E16) ; Caméra du box (E63) ; Céder (vente + transfert, RG-CAN-02).

### E31 — Dressage et éducation · V1 ⭐
- **Contenu** : 3 KPIs (clients, séances par semaine, chiens en pension) ; boutons « + Nouvelle séance » (E32), « + Client » (E33), « Pension » (E34) ; programmes (badges) ; chiens en cours (niveau, propriétaire, prochaine séance) ; « Facturer un client » (E35).
- **États** : vide → « Ajoutez un client et son chien pour planifier une séance ».

### E32 — Formulaire de séance · V1 ⭐

| Champ | Type | Oblig. | Validation | Défaut |
|---|---|---|---|---|
| Client & chien | liste | Oui | client actif | — |
| Programme | liste | Oui | `training_programs` | — |
| Date / heure | datetime | Oui | — | demain, même heure |
| Durée (min) | entier | Non | > 0 | 45 |
| Lieu | liste | Non | centre/domicile/terrain | centre |
| Progression / exercices validés | texte long | Non | — | — |
| Niveau | entier | Non | 1–4 | dernier niveau |
| Présent | booléen | Non | renseigné après la séance | — |

- **Comportement** : un rappel de séance est envoyé au client (WhatsApp/SMS selon son consentement) et au dresseur (push).

### E33 — Client · V1 ⭐ *(nouveau)*
Champs : nom complet*, téléphone, accepte WhatsApp (case), notes ; chiens rattachés (ajout ou création) ; contrat ou consentement (photo ou case datée).

### E34 — Pension · V1 ⭐ *(nouveau)*
- **Liste** : chiens présents, box, date d'entrée, sortie prévue.
- **Admission** : chien*, client*, box, date d'entrée*, sortie prévue, tarif par jour (défaut : tarif du centre) ; **check-list d'admission** : rage à jour (contrôle automatique à partir du carnet ; si elle est échue, admission `differe` avec proposition de vaccination), CHPPiL, toux de chenil (recommandée), antiparasitaires, alimentation fournie, contact d'urgence.
- **Sortie** : date de sortie, puis génération des lignes de facture (nombre de journées × tarif).

### E35 — Devis / facture · V1 ⭐ *(nouveau)*
- **Champs** : client*, type (devis/facture), lignes (description*, quantité*, prix unitaire*) — import des séances et journées non facturées ; échéance ; notes.
- **Calculs** : montant par ligne, total, déjà payé, reste dû.
- **Actions** : Émettre (numéro définitif à la synchronisation ; « PROV-… » hors ligne) ; Partager en PDF ou WhatsApp ; Encaisser (mobile money : initie la demande de paiement ; espèces : enregistrement manuel) ; Convertir un devis en facture.

### E36 — Unités K9 · V2 🏢 *(nouveau)*
Liste des unités, chiens affectés, maître-chien, aptitudes, certification valide jusqu'au …, prochain recyclage, indicateur **« apte au service »** (vert/rouge).

---

## Plus, organisation, abonnement

### E50 — Formules et abonnement · MVP 🆓
- **Contenu** : bascule mensuel/annuel (« 2 mois offerts ») ; 3 cartes (Découverte, **Pro** mise en avant, Structure) avec le prix dans la devise du pays et les fonctions (tableau de gating, `01` §4.22) ; encart Institution.
- **Actions** : « Choisir Pro », puis choix de l'opérateur et du numéro, puis paiement mobile money (push USSD ou redirection) ; écran d'attente de confirmation ; statut de l'abonnement et date d'expiration.
- **États** : en grâce → bandeau « Votre formule a expiré le … — renouvelez avant le … » ; suspendu → modules payants en lecture seule.

### E60 — Plus (menu) · MVP 🆓
Liens : Formules (E50) ; Dressage et pension (E31) ; Surveillance et rage (E61, 🏢) ; Formations audio ; Inspirations (E62) ; Caméras (E63) ; Généalogie et consanguinité (E16) ; Tâches (E44) ; Stocks (E27) ; Trésorerie (E28) ; Simulateur (E29) ; Mes données et consentements (E65). **Réglages** : rappels WhatsApp, SMS/USSD (interrupteurs = préférences de canal) ; heures calmes ; mode hors ligne ; thème clair/sombre ; langue ; code PIN.

### E61 — Surveillance et rage · V2 🏢
- **Contenu** : KPIs (couverture antirabique de la zone, morsures sur 30 jours, éleveurs suivis, campagnes actives) ; **carte de couverture** par zone (cellules de moins de 5 exploitations masquées) ; signalements par zone.
- **Actions** : « Lancer une campagne » (E66) ; « Exporter les données de surveillance » (format national).

### E62 — Inspirations (ce qui marche en Afrique) · MVP 🆓
Fiches DigiCow, Hello Tractor, mobile money, feature phones, coopératives, et leur application dans RecallFarm.

### E63 — Caméras et surveillance à distance · V2 ⭐ *(addendum B ; maquette « scr-cameras »)*
- **Contenu** : compteur « N caméras en ligne · M hors ligne » ; **mosaïque** des flux (LIVE, horodatage, nom) ; plein écran au toucher ; liste des **alertes récentes** (mouvement, hors ligne) avec vignette et clip de 20 s ; bouton « + Installer une caméra » (E64).
- **Réglages par caméra** : qualité (basse par défaut), détection de mouvement, vision nocturne, plages horaires d'alerte, personnes autorisées.
- **États** : hors ligne (réseau du téléphone) → « La vidéo nécessite une connexion » ; caméra hors ligne → vignette grise avec l'heure de dernière connexion ; quota atteint → message de formule.

### E64 — Installer une caméra (assistant) · V2 ⭐ *(nouveau)*
Étapes : 1) type de connexion (Wi-Fi / 4G) ; 2) scan du QR code de la caméra ou saisie de son identifiant ; 3) Wi-Fi : sélection du réseau et mot de passe (transmis à la caméra, jamais stocké en clair) ; 4) nom, zone, logement ; 5) test du flux, puis « Caméra en ligne ».

### E65 — Mes données et consentements · MVP 🆓 *(nouveau)*
- **Contenu** : liste des consentements (état, date, bouton révoquer ou accorder) ; organisations et vétérinaires ayant accès ; « Exporter mes données » (statut de la demande, lien de téléchargement valable 7 jours) ; « Supprimer mon compte » (avertissement, confirmation par OTP, annulable pendant 30 jours).

### E66 — Campagne de vaccination · V2 🏢 *(nouveau)*
Champs : maladie*, espèce*, zone* (sélection sur carte ou liste administrative), dates*, cible (nombre d'animaux), message de relance (modèle). Suivi : vaccinés / cible, couverture en %, relances envoyées, carte.

### E67 — Membres et portefeuille agent · V1 🏢 *(nouveau, PWA et mobile)*
Liste des membres (rôle, statut) ; inviter (téléphone et rôle) ; pour un agent, affecter les exploitations de son portefeuille (`farmer_scope`) ; un agent bascule d'un éleveur à l'autre par un sélecteur en tête d'écran, et ses saisies sont marquées « saisi par l'agent X ».

---

---

## Suivi à distance *(v2.2 — voir `13`)*

### E70 — Ma ferme en direct · V3 ⭐ (option Ferme connectée)
- **Contenu** : carte des logements (tuiles) avec, pour chacun, dernières mesures (température, humidité, eau, ammoniac), tendance sur 24 h (flèche), statut des capteurs (en ligne, batterie) et pastille d'alerte ouverte (rouge : critique, ambre : attention). Bandeau « Passerelle en ligne / hors ligne depuis … ».
- **Actions** : ouvrir un logement (E71) ; ouvrir les alertes (E72) ; installer un appareil (E73).
- **États** : hors ligne → dernières valeurs avec leur heure (« il y a 2 h ») ; aucun appareil → « Connectez vos premiers capteurs » + présentation de l'option.

### E71 — Logement : courbes · V3 ⭐
- Courbes par mesure sur 24 h, 7 j et 30 j, avec la zone de seuil colorée et les points d'alerte ; mortalité du journal superposée (barres) ; liste des appareils du logement.
- **Actions** : ajuster un seuil (dans les bornes du pack ; affichage de la provenance « borne fixée par filiere.volaille 1.2.0 ») ; voir la caméra du logement (E63).

### E72 — Alertes · V2 (caméras) / V3 (capteurs)
- **Liste** : gravité, logement, règle, valeur déclenchante, ouverte depuis, état, niveau d'escalade.
- **Détail** : courbe autour du déclenchement, clip vidéo si caméra, historique des notifications (qui, quel canal, délivré, acquitté).
- **Actions** : **Acquitter** (un geste) ; **Résoudre** (cause dans une liste + action en texte, obligatoire si critique) ; créer une tâche ; signaler une suspicion (E42) ; demander un vétérinaire (E41).

### E73 — Installer une passerelle ou un capteur (assistant) · V3 ⭐
Étapes :
1. Scanner le QR code de la passerelle (association, certificat).
2. Choisir le logement.
3. Ajouter les capteurs : scan du QR code, choix du profil (`sensor_profile`) et test de lecture en direct.
4. Vérifier les seuils proposés par le pack filière.
5. Définir l'astreinte (E74).
6. Résumé : « 3 capteurs en ligne ».

### E74 — Astreinte · V3 ⭐
Plages horaires par jour, personnes par niveau (1, 2), canal par niveau (push, SMS, appel vocal), délai d'escalade (défaut 15 min) ; test d'alerte (« Envoyer une alerte d'essai »).

---

## Mode vétérinaire de terrain *(v2.2 — EF-VTR)*

### E75 — Ma clientèle · V1 (rôle vétérinaire)
Recherche par téléphone ou par nom ; liste des éleveurs (dernier acte, rappels manqués, distance) ; bouton « + Nouvel éleveur » (E76).

### E76 — Nouvel éleveur (sans smartphone) · V1
Champs : téléphone de l'éleveur* (E.164), nom*, localité, spéculations*, premier sujet (lot, animal ou chien). Action : « Envoyer le code de consentement par SMS ». Saisie du code renvoyé par l'éleveur, ou confirmation par SMS. Message « Les rappels seront envoyés par SMS au … ».

### E77 — Tournée du jour · V1
Rappels manqués et rappels du jour de la clientèle, triés par distance (si GPS) ou par village ; actions groupées « acte fait » (ouvre E22 prérempli) ; facture (E35).

---

## Imports, exports, retour

### E78 — Import en masse · MVP (pilote) 🏢
Choix du type (cheptel, clients, historique sanitaire) ; téléchargement du modèle CSV ou XLSX ; dépôt du fichier ; aperçu avec erreurs par ligne ; validation (« 312 lignes importées, 4 rejetées : télécharger le rapport »).

### E79 — Exports · V1 (registres) / V2 (nationaux) 🏢
Registres d'élevage (PDF, CSV) ; exports d'agrégats (DHIS2, ARIS, GARC, EMA-i+) selon le pack pays, avec rappel des consentements et de la convention ; historique des exports (qui, quand, empreinte).

### E80 — Menu USSD (pilote) · MVP
Code court du pays (ex. `*xxx#`), sessions de moins de 3 minutes, 3 écrans au maximum par parcours :
```
RecallFarm
1. Rappels du jour
2. Confirmer un acte
3. Demander un vétérinaire
0. Quitter
```
- 1 → liste numérotée (« 1. Rex : rage, aujourd'hui ») ; choisir un numéro → « 1. Fait  2. Reporter de 7 j ».
- 2 → choisir le sujet → choisir l'acte du protocole → confirmation.
- 3 → choisir le besoin → « Demande envoyée au Dr … ».
- Textes et langues issus du pack pays (`message_template`) ; aucune donnée personnelle de tiers affichée.

### E81 — Signaler un problème · V1
Texte libre, capture d'écran facultative, case « joindre les journaux techniques » (sans donnée personnelle) ; accusé de réception et numéro de suivi.

## États système communs
- **Hors ligne** : bandeau discret et persistant ; les écritures affichent « en attente de synchronisation ». Aucune action n'est bloquée par l'absence de réseau, sauf l'OTP, le paiement, la vidéo des caméras et l'émission d'un numéro de facture définitif.
- **Erreur de synchronisation** : notification non intrusive ; la file est réessayée automatiquement avec un délai croissant ; aucune saisie locale n'est jamais perdue. Une fusion de conflit s'affiche dans l'historique de la fiche.
- **Chargement** : squelettes de liste, pas de spinner plein écran.
- **Accessibilité** : cibles tactiles ≥ 44 px, contraste AA, lisibilité en plein soleil, texte redimensionnable, libellés pour les lecteurs d'écran.

## Correspondance maquette ↔ écrans

| Maquette (`id`) | Écran | Maquette (`id`) | Écran |
|---|---|---|---|
| scr-onboard | E01 | scr-depenses | E26 |
| scr-home | E10 | scr-dressage | E31 |
| scr-cheptel | E11 | scr-form-seance | E32 |
| scr-form-animal | E12 | scr-chien | E30 |
| scr-journal | E13 | scr-marche | E40 |
| scr-sante | E20 | scr-form-service | E41 |
| scr-form-vaccin | E22 | scr-abo | E50 |
| scr-cert | E23 | scr-plus | E60 |
| scr-repro | E24 | scr-surv | E61 |
| scr-ventes | E25 | scr-insp | E62 |
| scr-cameras | E63 | scr-conso | E16 |

Écrans **sans maquette** (à maquetter) : E02–E04, E14, E15, E17, E18, E21, E27–E29, E33–E36, E42–E44, E64–E67 (v2.1) ; E70–E81 et studio S01–S10 (v2.2).
