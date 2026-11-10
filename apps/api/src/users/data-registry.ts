export const DATA_REGISTRY = [
  {
    id: 'T-01', purpose: 'Gestion du compte utilisateur',
    legal_basis: 'Execution contractuelle (Loi 2024/017 art. 6)',
    data_categories: ['identite', 'telephone', 'langue'],
    recipients: ['RecallFarm'], retention: '3 ans apres derniere connexion',
  },
  {
    id: 'T-02', purpose: 'Suivi sanitaire du cheptel',
    legal_basis: 'Interet legitime (surveillance sanitaire)',
    data_categories: ['evenements_sante', 'rappels', 'vaccinations'],
    recipients: ['RecallFarm', 'veterinaire designe (avec consentement)'],
    retention: '5 ans',
  },
  {
    id: 'T-03', purpose: 'Envoi de rappels vaccinaux',
    legal_basis: 'Consentement (messages_sms)',
    data_categories: ['telephone', 'rappels'], recipients: ['RecallFarm', 'operateur SMS'],
    retention: 'Duree de l abonnement',
  },
  {
    id: 'T-04', purpose: 'Paiement mobile money',
    legal_basis: 'Execution contractuelle',
    data_categories: ['telephone', 'montant', 'reference_paiement'],
    recipients: ['RecallFarm', 'operateur mobile money'], retention: '10 ans (obligation comptable)',
  },
  {
    id: 'T-05', purpose: 'Surveillance epidemiologique agregee',
    legal_basis: 'Consentement (surveillance_agregats)',
    data_categories: ['donnees agregees k>=5'], recipients: ['Services veterinaires'],
    retention: '10 ans',
  },
  {
    id: 'T-06', purpose: 'Partage avec organisation (cooperative)',
    legal_basis: 'Consentement (partage_organisation)',
    data_categories: ['fermes', 'cheptel', 'indicateurs'],
    recipients: ['Organisation de rattachement'], retention: 'Duree du rattachement',
  },
  {
    id: 'T-07', purpose: 'Analytique produit',
    legal_basis: 'Interet legitime',
    data_categories: ['evenements anonymises'],
    recipients: ['RecallFarm'], retention: '2 ans',
  },
  {
    id: 'T-08', purpose: 'Sauvegarde et securite',
    legal_basis: 'Interet legitime',
    data_categories: ['toutes donnees (chiffrees)'],
    recipients: ['RecallFarm'], retention: '14 jours (sauvegardes)',
  },
];
