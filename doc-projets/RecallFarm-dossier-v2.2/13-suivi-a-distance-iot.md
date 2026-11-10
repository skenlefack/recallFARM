# 13 — Suivi à distance : capteurs, passerelle, caméras et alertes (v2.2)

> Version 2.2 — 27/10/2026. **Nouveau fichier**, qui traduit en spécification la section 6 du document conceptuel. Il complète le module caméras (CAM, addendum B) déjà présent en v2.1.
> Exigences : **EF-IOT-01 à EF-IOT-14** et **EF-CAM-01 à EF-CAM-06** (inchangées).

## 1. Objectifs
1. Détecter à distance, et à temps, ce qui tue un lot ou fait perdre de l'argent : chaleur, manque d'eau, air vicié, rupture d'aliment, vol, intrusion, maladie (activité anormale).
2. Alerter **même sans Internet**, grâce à la passerelle de ferme.
3. Remplir automatiquement le journal (température, eau, poids) pour réduire la saisie.
4. Rester **ouvert sur le matériel** : protocoles standard, pas de verrouillage par un constructeur.

## 2. Architecture de bout en bout

| Étage | Composants | Protocoles | Responsabilités |
|---|---|---|---|
| Capteurs | température et humidité, ammoniac et CO2, débit et niveau d'eau, jauge de silo, balance, boucles et colliers d'activité, contact de porte, tension et batterie, caméras IP | LoRaWAN (classe A), BLE, Wi-Fi, Modbus ou RS-485 (filaire), ONVIF et RTSP (caméras) | mesurer, horodater, signaler la batterie |
| Passerelle de ferme | mini-ordinateur durci ou passerelle LoRaWAN, modem 4G/2G avec SIM, mémoire de 7 jours, relais de sirène, alimentation solaire et batterie | MQTT 3.1.1/5 sur TLS vers la plateforme ; SMS en secours | agréger, appliquer les règles `edge`, mettre en mémoire tampon, alerter localement, mettre à jour son propre logiciel et ses règles |
| Plateforme | courtier MQTT (EMQX ou Mosquitto en grappe), service d'ingestion, base de séries temporelles (TimescaleDB), moteur d'alertes, service vidéo (`camera-service`), escalade et astreinte | MQTT, HTTP, WebRTC | valider, stocker, agréger, évaluer les règles, notifier, archiver |
| Alerte et action | application (push), SMS, appel vocal, WhatsApp, sirène | voir `04` §6 | prévenir, acquitter, tracer l'action |

### 2.1 Sujets MQTT et charge utile
- Sujets : `rf/{country}/{farm_id}/{gateway_id}/telemetry`, `.../events`, `.../status` ; descendant : `.../config` (règles et seuils `edge`), `.../ota` (mise à jour).
- Charge utile compacte (CBOR ou JSON minifié) : `{ "d": "<device_id>", "t": 1767225600, "m": { "temp_c": 31.4, "rh": 68 }, "b": 87 }`.
- QoS 1, avec dédoublonnage par (`device_id`, `t`) ; envoi par paquets toutes les 5 minutes (paramétrable) ; envoi immédiat en cas d'alerte.
- Authentification : certificat client par passerelle (X.509), révocable ; listes de contrôle d'accès limitées aux sujets de l'exploitation.

### 2.2 Exigences de la passerelle (cahier des charges matériel)
- Fonctionne de 0 à 50 °C, dans la poussière et l'humidité (indice de protection IP54 au minimum en bâtiment d'élevage) ; autonomie de 24 h sur batterie.
- Mémoire tampon d'au moins 7 jours de mesures ; horloge synchronisée (NTP, ou horloge GSM en repli).
- Exécute les règles `edge` (sous-ensemble du langage d'expressions de `12` §5, évalué localement).
- Envoie un SMS d'alerte de secours par sa SIM, selon une liste de numéros signée par la plateforme.
- Mise à jour à distance signée, avec retour automatique à la version précédente en cas d'échec.
- Exemples de matériel compatible : passerelles LoRaWAN du commerce, ou mini-PC Linux (type Raspberry Pi industriel) avec concentrateur LoRa et modem 4G. Le choix final se fera par un appel d'offres matériel en V3.

## 3. Catalogue des profils de capteurs (`sensor_profile`)

| Code | Mesure | Unité | Plage | Fréquence par défaut | Filières | Règle par défaut (pack filière, à valider) |
|---|---|---|---|---|---|---|
| `temp_rh` | température, humidité relative | °C, % | -10–60, 0–100 | 5 min | volaille, lapin, porc, chenil | volaille adulte : > 32 °C pendant 30 min → critique ; poussins J0–J7 : < 30 °C → critique |
| `nh3` | ammoniac | ppm | 0–100 | 15 min | volaille, porc, lapin | > 25 ppm pendant 1 h → attention ; > 35 ppm → critique |
| `co2` | dioxyde de carbone | ppm | 0–5 000 | 15 min | volaille, porc | > 3 000 ppm pendant 1 h → attention |
| `water_flow` | débit d'eau | L/h | 0–2 000 | 5 min | toutes | débit nul pendant 2 h entre 6 h et 19 h → critique (appel vocal) |
| `water_level` | niveau de réservoir | % | 0–100 | 15 min | toutes | < 20 % → attention ; < 10 % → critique |
| `silo_level` | niveau de silo | kg ou % | — | 1 h | volaille, porc, lait | autonomie < 3 jours → tâche « commander l'aliment » |
| `scale` | poids moyen (balance de perchoir ou de passage) | kg | — | à chaque pesée | volaille, porc | écart > 10 % à la courbe de la souche → attention |
| `activity_tag` | activité, rumination | indice, min/jour | — | 1 h | bovins, petits ruminants | rumination -30 % sur 24 h → alerte santé ; pic d'activité → alerte chaleurs |
| `door_contact` | ouverture | booléen | — | événement | toutes | ouverture entre 20 h et 6 h → critique |
| `power` | tension secteur, batterie | V, % | — | 15 min | toutes | secteur coupé → attention ; batterie < 20 % → critique |
| `water_quality` (V3) | oxygène dissous, température de l'eau | mg/L, °C | — | 15 min | pisciculture | O2 < 4 mg/L → critique |

Les seuils sont des **valeurs par défaut** du pack filière, avec la politique `bornée` : l'exploitation peut les ajuster dans les bornes fixées par le référent.

## 4. Moteur d'alertes : cycle de vie

| État (`alert_events.status`) | Déclencheur | Suite |
|---|---|---|
| `ouverte` | la condition `when` est vraie pendant `for` | notification au niveau 1 de l'astreinte |
| `escaladee` | non acquittée après le délai (15 min par défaut) | niveau 2, puis appel vocal |
| `acquittee` | une personne prend en charge (app, réponse SMS, touche vocale) | l'escalade s'arrête |
| `resolue` | la condition redevient fausse pendant `for`, ou résolution manuelle | action obligatoire : cause et mesure prise (liste + texte libre) |
| `close` | après résolution | entre dans les indicateurs (délai d'acquittement, récurrence) |

Règles :
- **RG-IOT-01** : une même règle sur un même sujet ne se redéclenche pas pendant son `cooldown` (60 min par défaut) ; les répétitions incrémentent un compteur.
- **RG-IOT-02** : une alerte critique ne peut pas être fermée sans action renseignée.
- **RG-IOT-03** : une mortalité saisie dans les 48 h qui suivent une alerte critique sur le même logement est reliée à cette alerte (`alert_event_id` sur le journal), pour l'analyse des causes.
- **RG-IOT-04** : les plages d'astreinte (`oncall_schedules`) définissent qui est prévenu, à quelle heure et par quel canal. Sans astreinte définie, c'est le propriétaire.

## 5. Caméras (rappel de la v2.1 et compléments)
- Les exigences EF-CAM-01 à EF-CAM-06 et les règles RG-CAM-01 à RG-CAM-03 sont inchangées (voir `01` §4.23).
- Complément v2.2 : les événements de caméra (`camera_events`) passent par le **même moteur d'alertes** que les capteurs (`source = camera_events`). Ils bénéficient ainsi de l'astreinte, de l'escalade et de la traçabilité de l'action.
- Une caméra peut être rattachée à une passerelle de ferme (réseau local) ou se connecter directement au serveur vidéo en 4G.

## 6. Tableau de bord temps réel (écrans E70 à E74, voir `02`)
- Vue de la ferme par logement : dernières mesures, tendance sur 24 h, statut des capteurs (en ligne, batterie), alertes ouvertes.
- Courbes par capteur (24 h, 7 j, 30 j) avec les seuils affichés ; superposition de la mortalité du journal.
- Liste des alertes, avec filtre par gravité et par état ; acquittement en un geste.
- Hors ligne : affichage des dernières valeurs reçues avec leur horodatage (« il y a 2 h »).

## 7. Données (détail dans `03` §16)
`gateways`, `devices`, `telemetry` (hypertable TimescaleDB, rétention : brut 90 jours, agrégats horaires 2 ans, agrégats journaliers sans limite), `alert_rules` (résolues depuis les packs + seuils de l'exploitation), `alert_events`, `alert_notifications`, `oncall_schedules`, `device_commands` (configuration, mise à jour).

## 8. Exigences

| ID | Exigence | Priorité · Version |
|---|---|---|
| EF-IOT-01 | Association d'une passerelle à une exploitation par code QR ; certificat client émis et révocable | S · V3 |
| EF-IOT-02 | Association des capteurs à un logement, avec un profil de capteur (§3) | S · V3 |
| EF-IOT-03 | Ingestion MQTT avec dédoublonnage, horodatage, contrôle de plage, rejet des valeurs aberrantes (journalisé) | S · V3 |
| EF-IOT-04 | Stockage en séries temporelles avec agrégats et rétention du §7 | S · V3 |
| EF-IOT-05 | Règles d'alerte issues des packs, seuils ajustables par l'exploitation dans les bornes | S · V3 |
| EF-IOT-06 | Exécution des règles `edge` sur la passerelle, sirène et SMS de secours sans Internet | S · V3 |
| EF-IOT-07 | Astreinte, escalade et acquittement multicanal (app, SMS, voix) | S · V3 |
| EF-IOT-08 | Clôture d'une alerte critique avec action obligatoire ; lien avec la mortalité (RG-IOT-03) | S · V3 |
| EF-IOT-09 | Tableau de bord temps réel et courbes (§6) | S · V3 |
| EF-IOT-10 | Remplissage automatique du journal (température, eau, poids) à partir des mesures, avec mention « mesuré » | S · V3 |
| EF-IOT-11 | Supervision du parc : statut en ligne, batterie, version du logiciel ; mise à jour à distance signée | S · V3 |
| EF-IOT-12 | Les événements de caméra passent par le moteur d'alertes (§5) | S · V2 |
| EF-IOT-13 | Alertes prédictives (combinaison de mesures et du journal), avec évaluation de la précision avant activation | C · V3 |
| EF-IOT-14 | Quotas par formule (nombre de capteurs et de passerelles) et option « Ferme connectée » | S · V3 |

## 9. Sécurité et vie privée
- Connexions **sortantes uniquement** depuis la ferme ; aucun port ouvert sur le réseau de l'éleveur.
- Certificats par passerelle, rotation annuelle, révocation immédiate en cas de vol.
- Les mesures sont des données de l'exploitation : elles sont soumises aux mêmes consentements que le reste. Elles ne sont jamais partagées avec un fabricant de matériel.
- Les règles et les mises à jour envoyées aux passerelles sont signées par la plateforme.
