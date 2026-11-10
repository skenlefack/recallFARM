# RecallFarm — Demandes inter-agents

Quand un agent a besoin de modifier un fichier qu'il ne possede pas, il ecrit sa demande ici.
L'orchestrateur la route vers le proprietaire du fichier.

| Date | Demandeur | Fichier(s) | Proprietaire | Action demandee | Statut |
|------|-----------|------------|--------------|-----------------|--------|
| 2026-11-10 | integrations | apps/web, apps/mobile (ecran de paiement) | web-frontend, mobile-ecrans | Checkout idempotent : envoyer `id` (UUID v4 cree a l'appui, reutilise pour toute relance du meme paiement) dans `POST /v1/subscriptions/checkout` (ou l'en-tete `Idempotency-Key`). Une relance renvoie `replayed: true` et le meme `payment_id` ; une relance d'un refus renvoie la meme erreur 422 `PAY-INIT`. `409 CONFLICT` (`rule: PAY-IDEMPOTENCY`) si le meme id sert a une autre demande. | Ouvert |
| 2026-11-10 | integrations | apps/web, apps/mobile (suivi du paiement) | web-frontend, mobile-ecrans | Nouveaux statuts de paiement : `a_verifier` (issue inconnue apres plusieurs interrogations : afficher « Paiement en cours de verification, nous vous prevenons »), `remboursement_en_cours`, `rembourse`. `GET /plans` ne renvoie plus que les moyens de paiement reellement branches. | Ouvert |
| 2026-11-10 | integrations | apps/web (administration) | web-frontend | Ecrans admin : liste `GET /v1/admin/payments?status=a_verifier`, bouton « Interroger » (`POST /v1/admin/payments/:id/check`), « Rembourser » avec motif (`POST /v1/admin/payments/:id/refund`, administrateur plateforme), rapports `GET /v1/admin/payments/reconciliations`. | Ouvert |
