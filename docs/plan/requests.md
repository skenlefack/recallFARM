# RecallFarm — Demandes inter-agents

Quand un agent a besoin de modifier un fichier qu'il ne possede pas, il ecrit sa demande ici.
L'orchestrateur la route vers le proprietaire du fichier.

| Date | Demandeur | Fichier(s) | Proprietaire | Action demandee | Statut |
|------|-----------|------------|--------------|-----------------|--------|
| 2026-11-10 | mobile-ecrans | apps/mobile/lib/core/i18n/strings_{fr,en}.dart | mobile-socle | Fusionner les cles de apps/mobile/lib/features/subscription/subscription_strings.dart (pay_*, plans_retry) dans le catalogue central, puis supprimer SubTr. Les cles pay_orange_money / pay_mtn_momo ne sont plus utilisees (libelles = pack pays) et peuvent etre retirees. | ouverte |
