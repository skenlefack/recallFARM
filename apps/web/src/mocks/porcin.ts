/** Mock fixture: filiere.porcin, published 1.4.0 and draft 2.0.0 (the pack shown in Studio.dc.html). */
import type { PackContent, PackObject } from '../api/types';

const kpis = [
  ['sevres_par_truie_an', 'Sevrés par truie et par an', 'porcelets/truie/an'],
  ['nes_vivants_portee', 'Nés vivants par portée', 'porcelets'],
  ['mortalite_sous_mere', 'Mortalité sous la mère', '%'],
  ['poids_sevrage', 'Poids au sevrage', 'kg'],
  ['taux_mise_bas', 'Taux de mise bas', '%'],
  ['intervalle_sevrage_saillie', 'Intervalle sevrage-saillie', 'j'],
  ['mortalite_post_sevrage', 'Mortalité en post-sevrage', '%'],
  ['gmq_post_sevrage', 'GMQ post-sevrage', 'g/j'],
  ['gmq_engraissement', 'GMQ engraissement', 'g/j'],
  ['ic_engraissement', "Indice de consommation", 'kg/kg'],
  ['mortalite_engraissement', 'Mortalité en engraissement', '%'],
  ['cout_kg_vif', 'Coût du kilo vif', 'XAF/kg'],
];

const alertRules = [
  ['mortalite_brutale_porc', 'Mortalité brutale (suspicion PPA)', 'critique'],
  ['ecrasement_porcelets', 'Écrasements répétés', 'attention'],
  ['chute_appetit_truie', "Chute d'appétit d'une truie", 'attention'],
  ['diarrhee_portee', 'Diarrhée sur une portée', 'attention'],
  ['chaleur_maternite', 'Chaleur en maternité', 'critique'],
  ['eau_coupee', "Coupure d'eau", 'critique'],
  ['retard_mise_bas', 'Mise bas en retard', 'attention'],
  ['toux_engraissement', 'Toux en engraissement', 'info'],
  ['stock_aliment_bas', "Stock d'aliment bas", 'info'],
];

function step(code: string, label: string, short: string, type: 'soin' | 'vaccin', offset: number, min: number, max: number, extra: Record<string, unknown> = {}) {
  return { code, label, short_label: short, type, offset_days: offset, route: 'injection', override: { offset_days: { policy: 'bornee', min, max } }, ...extra };
}

function protocols(draft: boolean): PackObject[] {
  const main: PackObject = {
    kind: 'vaccination_protocol',
    code: 'porcelet_naissance_sevrage',
    title: 'Porcelets, de la naissance au sevrage',
    species: 'porcin',
    reference: 'birth_date',
    mandatory: false,
    validator: 'veterinaire',
    withdrawal_meat: true,
    end: { label: 'Sevrage', offset_days: 28 },
    override: { steps: { policy: 'bornee' } },
    steps: draft
      ? [
          step('fer_j3', 'Fer injectable', 'Fer', 'soin', 3, 2, 5),
          step('castration_j7', 'Castration', 'Castration', 'soin', 7, 3, 10, { condition: 'animal.sexe == "M"', route: 'chirurgie' }),
          step('mycoplasme_d1', 'Mycoplasme · dose 1', 'Mycoplasme', 'vaccin', 10, 7, 21, { disease: 'mycoplasme' }),
          step('mycoplasme_rappel', 'Mycoplasme · rappel', 'Rappel', 'vaccin', 14, 14, 21, { disease: 'mycoplasme', after_step: 'mycoplasme_d1' }),
        ]
      : [
          step('fer_j3', 'Fer injectable', 'Fer', 'soin', 2, 2, 5),
          step('castration_j7', 'Castration', 'Castration', 'soin', 7, 3, 10, { route: 'chirurgie' }),
          step('mycoplasme_d1', 'Mycoplasme · dose 1', 'Mycoplasme', 'vaccin', 10, 7, 21, { disease: 'mycoplasme' }),
        ],
  };
  const others: [string, string][] = [
    ['truie_gestante', 'Truies gestantes'],
    ['verrat', 'Verrats'],
    ['post_sevrage', 'Post-sevrage'],
    ['engraissement', 'Engraissement'],
    ['cochette_entree', 'Cochettes à l’entrée'],
    ['ppa_biosecurite', 'Biosécurité PPA (rappels de contrôle)'],
  ];
  return [
    main,
    ...others.map(([code, title], i) => ({
      kind: 'vaccination_protocol',
      code,
      title,
      species: 'porcin',
      reference: 'start_date',
      mandatory: false,
      steps: [step(`${code}_1`, `Vermifuge · ${title.toLowerCase()}`, 'Vermifuge', 'soin', 7 + i * 3, 3, 30)],
    })),
  ];
}

const forms: PackObject[] = [
  {
    kind: 'form',
    code: 'daily_log_portee',
    title: 'Journal de la portée',
    applies_to: 'daily_log',
    species: 'porcin',
    preview_subject: 'Portée P-118',
    fields: [
      { code: 'piglets_alive', type: 'integer', label: 'porcelets_vivants', required: true, min: 0, max: 30, default: 11, maps_to: 'present_count' },
      { code: 'mortality', type: 'integer', label: 'morts_depuis_hier', required: true, min: 0, default: 0, maps_to: 'mortality' },
      { code: 'iron_given', type: 'boolean', label: 'fer_administre', default: true, maps_to: 'attributes.iron_given' },
      { code: 'crushing', type: 'boolean', label: 'ecrasement', visible_if: 'log.mortality > 0', maps_to: 'attributes.crushing' },
      { code: 'mortality_rate', type: 'computed', label: 'taux_mortalite', unit: '%', expr: 'log.piglets_alive > 0 ? round(log.mortality / (log.piglets_alive + log.mortality) * 100, 1) : null' },
      { code: 'sow_appetite', type: 'select', label: 'appetit_truie', options: ['normal', 'faible', 'nul'], default: 'normal', widget: 'chips', maps_to: 'attributes.sow_appetite' },
      { code: 'notes', type: 'text', label: 'notes', maps_to: 'notes' },
    ],
  },
  {
    kind: 'form',
    code: 'portee',
    title: 'Mise bas',
    applies_to: 'litter',
    species: 'porcin',
    fields: [
      { code: 'sow', type: 'subject_ref', label: 'truie', required: true, subject: 'animal' },
      { code: 'farrowing_date', type: 'date', label: 'date_mise_bas', required: true },
      { code: 'born_alive', type: 'integer', label: 'nes_vivants', required: true, min: 0, max: 30 },
      { code: 'stillborn', type: 'integer', label: 'mort_nes', min: 0, max: 30, default: 0 },
      { code: 'assisted', type: 'boolean', label: 'mise_bas_assistee' },
      { code: 'assist_reason', type: 'text', label: 'motif_assistance', visible_if: 'log.assisted == true', required_if: 'log.assisted == true' },
      { code: 'photo', type: 'photo', label: 'photo_portee' },
    ],
  },
  {
    kind: 'form',
    code: 'animal_porcin',
    title: 'Fiche animal',
    applies_to: 'animal',
    species: 'porcin',
    fields: [
      { code: 'tag', type: 'rfid', label: 'boucle', required: true, pattern: '^[0-9]{15}$' },
      { code: 'sex', type: 'select', label: 'sexe', options: ['M', 'F'], required: true },
      { code: 'birth_date', type: 'date', label: 'date_naissance' },
      { code: 'breed', type: 'select', label: 'race', options: ['large_white', 'landrace', 'pietrain', 'locale', 'croisee'] },
      { code: 'purchase_price', type: 'money', label: 'prix_achat', currency: 'XAF' },
      { code: 'location', type: 'geo', label: 'position' },
    ],
  },
  {
    kind: 'form',
    code: 'saillie',
    title: 'Saillie ou insémination',
    applies_to: 'reproduction_event',
    species: 'porcin',
    fields: [
      { code: 'dam', type: 'subject_ref', label: 'truie', required: true, subject: 'animal' },
      { code: 'method', type: 'select', label: 'methode', options: ['monte', 'insemination'], required: true },
      { code: 'sire', type: 'subject_ref', label: 'verrat', subject: 'animal', visible_if: "log.method == 'monte'" },
      { code: 'dose_ref', type: 'qr', label: 'dose_semence', visible_if: "log.method == 'insemination'" },
      { code: 'when', type: 'datetime', label: 'date_heure', required: true },
    ],
  },
  {
    kind: 'form',
    code: 'sortie',
    title: 'Sortie (vente, réforme, mort)',
    applies_to: 'exit',
    species: 'porcin',
    fields: [
      { code: 'reason', type: 'multiselect', label: 'motif', options: ['vente', 'reforme', 'mort', 'abattage'] },
      { code: 'weight', type: 'decimal', label: 'poids_kg', unit: 'kg', min: 0, max: 400 },
      { code: 'price', type: 'money', label: 'prix', currency: 'XAF', visible_if: "'vente' in log.reason" },
      { code: 'signature', type: 'signature', label: 'signature_acheteur', visible_if: "'vente' in log.reason" },
    ],
  },
];

const i18nBase: Record<string, string> = {
  porcelets_vivants: 'Porcelets vivants',
  morts_depuis_hier: 'Morts depuis hier',
  fer_administre: 'Fer administré',
  ecrasement: 'Écrasement constaté',
  taux_mortalite: 'Mortalité du jour',
  appetit_truie: 'Appétit de la truie',
  notes: 'Notes',
  truie: 'Truie',
  verrat: 'Verrat',
  date_mise_bas: 'Date de mise bas',
  nes_vivants: 'Nés vivants',
  mort_nes: 'Mort-nés',
  mise_bas_assistee: 'Mise bas assistée',
  motif_assistance: "Motif de l'assistance",
  photo_portee: 'Photo de la portée',
  boucle: 'N° de boucle (15 chiffres)',
  sexe: 'Sexe',
  M: 'Mâle',
  F: 'Femelle',
  date_naissance: 'Date de naissance',
  race: 'Race',
  large_white: 'Large White',
  landrace: 'Landrace',
  pietrain: 'Piétrain',
  locale: 'Locale',
  croisee: 'Croisée',
  prix_achat: "Prix d'achat",
  position: 'Position GPS',
  methode: 'Méthode',
  monte: 'Monte naturelle',
  insemination: 'Insémination',
  dose_semence: 'Dose de semence (QR)',
  date_heure: 'Date et heure',
  motif: 'Motif de sortie',
  vente: 'Vente',
  reforme: 'Réforme',
  mort: 'Mort',
  abattage: 'Abattage',
  poids_kg: 'Poids (kg)',
  prix: 'Prix',
  signature_acheteur: "Signature de l'acheteur",
  normal: 'Normal',
  faible: 'Faible',
  nul: 'Nul',
  injection: 'injection',
  chirurgie: 'acte chirurgical',
  eau_de_boisson: 'eau de boisson',
  oculaire: 'voie oculaire',
  orale: 'voie orale',
  mycoplasme: 'Mycoplasme',
  porcin: 'Porcins',
};

function i18n(objects: PackObject[]): Record<string, string> {
  const out: Record<string, string> = { ...i18nBase };
  for (const o of objects) {
    out[o.code] = (o.title as string) ?? (o.label as string) ?? o.code;
    const steps = (o.steps as { code: string; label: string }[] | undefined) ?? [];
    steps.forEach((s) => (out[s.code] = s.label));
  }
  // phase and category labels, en variants counted separately
  ['maternite', 'post_sevrage', 'engraissement', 'gestante', 'vide', 'lactation', 'reforme_prevue', 'quarantaine'].forEach((k) => (out[`phase_${k}`] = k.replace('_', ' ')));
  for (let i = 1; out && Object.keys(out).length < 186; i++) out[`aide_${i}`] = `Aide contextuelle ${i}`;
  return out;
}

export function porcinPack(draft: boolean): PackContent {
  const objects: PackObject[] = [
    { kind: 'production_type', code: 'naissage', species: 'porcin', phases: [{ code: 'maternite', max_days: 28 }] },
    { kind: 'production_type', code: 'post_sevrage', species: 'porcin', phases: [{ code: 'post_sevrage', max_days: 42 }] },
    { kind: 'production_type', code: 'engraissement', species: 'porcin', phases: [{ code: 'engraissement', max_days: 120 }] },
    { kind: 'production_type', code: 'naissage_engraissement', species: 'porcin', phases: [{ code: 'maternite', max_days: 28 }, { code: 'engraissement', max_days: 140 }] },
    ...protocols(draft),
    ...forms,
    ...kpis.map(([code, title, unit]) => ({ kind: 'kpi', code, title, unit, expr: 'null' })),
    ...alertRules.map(([code, title, severity]) => ({ kind: 'alert_rule', code, title, severity, source: 'daily_logs', when: 'log.mortality >= 2' })),
    { kind: 'task_template', code: 'lavage_maternite', title: 'Lavage et vide sanitaire de la maternité', trigger: { type: 'relatif_evenement', event: 'sevrage', offset_days: 1 } },
    { kind: 'task_template', code: 'controle_chaleurs', title: 'Contrôle des chaleurs', trigger: { type: 'relatif_evenement', event: 'sevrage', offset_days: 4 } },
    { kind: 'task_template', code: 'echographie', title: 'Échographie de gestation', trigger: { type: 'relatif_evenement', event: 'saillie', offset_days: 28 } },
    ...['temperature_maternite', 'eau_debit', 'nh3_engraissement', 'porte_quarantaine'].map((code) => ({ kind: 'sensor_profile', code, title: code.replace('_', ' ') })),
    { kind: 'projection_model', code: 'porcins_v1', title: 'Projection naissage-engraissement' },
  ];
  return {
    pack: 'filiere.porcin',
    version: draft ? '2.0.0' : '1.4.0',
    level: 'filiere',
    requires: { 'global.core': '^1.4.0' },
    objects,
    i18n: { fr: i18n(objects) },
    tests: Array.from({ length: 24 }, (_, i) => ({ kind: i < 18 ? 'reminder_vector' : 'projection_golden', name: `cas_${i + 1}` })),
  };
}
