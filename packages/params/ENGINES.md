# Moteurs partagés — contrat MVP (serveur TypeScript ↔ mobile Dart)

Les deux implémentations doivent passer `vectors/resolution.json` et `vectors/reminders.json`.

## 1. Résolution des packs (dossier `12` §2)

Entrée : liste ordonnée de packs `global → filiere(s) → pays → org` + surcharges ferme (`farm_settings`).
Les objets sont identifiés par la clé `(kind, code)` (pour `message_template` : `(kind, code, channel, lang)`).

Fusion clé par clé, du général au particulier :
- un objet absent des niveaux supérieurs est **ajouté** ;
- pour un objet existant, chaque propriété de premier niveau du niveau inférieur remplace la précédente,
  **sauf** si la politique (`override` déclaré au niveau qui a défini l'objet) l'interdit :
  - `libre` (défaut si aucune politique) : remplacement ;
  - `verrouillee` : remplacement ignoré, rejet journalisé ;
  - `bornee` : pour un nombre, accepté si `min ≤ v ≤ max` ; pour `offset_days` des étapes, la variante
    `min_delta`/`max_delta` borne l'écart à la valeur d'origine ; sinon ignoré ;
  - `ajout_seulement` (listes d'objets à `code`) : les éléments du niveau inférieur sont ajoutés ou
    remplacent un élément de même `code` (sous réserve des autres politiques), aucun élément n'est retiré.
- Les chemins pointés (`recurring.every_days`) s'appliquent à la sous-propriété.
- Les surcharges de seuils (`params.<clé>`) d'une `alert_rule` utilisent la clé `override.<clé>`.
- La **provenance** de chaque propriété de premier niveau est `{ pack, version }` du dernier niveau retenu.
- Les rejets sont renvoyés dans `rejected: [{ kind, code, property, by_pack, reason }]`.

Sortie : `{ objects: { "<kind>:<code>": {...} }, provenance: { "<kind>:<code>": { "<prop>": "pack@version" } }, rejected: [...], param_version: "global.core@1.0.0+filiere.volaille@1.0.0+pays.CM@1.0.0" }`.

Sélection des filières : selon `farm.speculations` (`volaille` → `filiere.volaille`, `chien` → `filiere.canin`).

## 2. Moteur de rappels (dossier `12` §6.2, `01` EF-VAC)

Entrée : protocole résolu, sujet (`start_date` pour un lot, `birth_date` pour un chien), actes déjà
enregistrés (`health_events` avec `protocol_step` ou `disease` + `event_date`), date du jour.

1. Date de référence = `subject[protocol.reference]`.
2. Pour chaque étape : `due_date = référence + offset_days`. Une étape **réalisée** (acte avec même
   `protocol_step`) n'engendre plus de rappel ouvert.
3. Récurrence : après la dernière réalisation de `after_step` (ou d'un acte de la même `disease` plus
   récent), `due_date = dernière_date + every_days`, à l'infini (on ne matérialise que la prochaine).
   Si `after_step` n'est pas encore réalisée, pas d'occurrence récurrente. Le `step` de l'occurrence
   récurrente vaut `<disease>_recurrent` (ex. `rage_recurrent`).
4. Un acte saisi hors protocole avec `next_due` crée un rappel `manuel` à cette date.
5. Statut d'un rappel ouvert : `a_venir` si `today < due - 7` … en pratique :
   - `en_retard` si `today > due_date` ;
   - `aujourdhui` si `today == due_date` ;
   - `a_venir` sinon.
   Priorité : `haute` si la maladie est `notifiable` ou le protocole `mandatory`, sinon `normale`.
6. Plan d'envoi (pack pays `reminder_plan`) : pour chaque rappel ouvert, une notification par décalage
   `offset ∈ [-7, -1, 0, 3]` à `due_date + offset`, sur les canaux du plan ; les canaux `sms`/`whatsapp`
   ne sont retenus que si l'abonnement le permet (`rappels_sms`), sinon `app` seul.
7. Les étapes passées de plus de 30 jours non réalisées au moment de la **création** du sujet
   (sujet enregistré « en cours de vie ») sont marquées `ignore` (pas de rappel).

Sortie triée par `due_date` : `[{ step, disease, due_date, status, priority, kind: "protocole"|"recurrent"|"manuel" }]`.
