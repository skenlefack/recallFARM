# Decisions D-03 et D-07 — Questionnaire

## D-07 — Agregateur SMS et paiement

### Questions a trancher
1. **Approche generale** : agregateur unique (1 contrat) ou integration directe par operateur (2 contrats) ?
2. **Budget mensuel** pour SMS et frais de transaction ?
3. **Volume estime** : combien de SMS/mois au pilote ? (ex: 500 eleveurs × 4 rappels × 2 SMS = ~4000 SMS/mois)
4. **Operateurs a couvrir** : Orange uniquement ? Orange + MTN ? + Camtel ?
5. **Sandbox disponible** : le fournisseur propose-t-il un environnement de test gratuit ?

### Fournisseurs a evaluer
- [ ] Africa's Talking (agregateur) — sandbox gratuite, API REST simple
- [ ] Infobip (agregateur) — multi-canal
- [ ] Orange CM API directe — contacter le service entreprise Orange Cameroun
- [ ] MTN MoMo API directe — portail developper.mtn.com

### Documents a fournir par le fournisseur
- [ ] Cle API sandbox / compte de test
- [ ] Grille tarifaire (SMS, USSD, paiement)
- [ ] SLA (taux de livraison garanti, latence)
- [ ] Documentation technique (REST API, webhooks)
- [ ] Conditions de contrat (engagement, minimum)

---

## D-03 — Code court USSD

### Questions a trancher
1. **Besoin reel** : un menu USSD est-il indispensable pour le pilote, ou le SMS bidirectionnel suffit-il ?
2. **Operateur** : Orange ? MTN ? Les deux ?
3. **Code court** : partage (moins cher, *xxx*yyy#) ou dedie (plus cher, *yyy#) ?
4. **Budget** : frais d'obtention + abonnement mensuel ?
5. **Delai** : l'obtention prend 4 a 8 semaines — est-ce compatible avec le calendrier pilote ?

### Alternatives si USSD non disponible a temps
- **SMS bidirectionnel** : l'eleveur repond "OK 1234" au SMS de rappel → confirmation
- **WhatsApp** : boutons interactifs (mais D-04 non tranche)
- **App mobile** : le parcours principal

### Actions immediates (meme avant decision)
- [ ] Contacter Orange Cameroun entreprise pour les conditions
- [ ] Contacter MTN Cameroun pour les conditions
- [ ] Ouvrir un compte sandbox chez un agregateur (Africa's Talking = gratuit)

---

## Matrice de decision

| Critere | Poids | Agregateur | Orange direct | MTN direct |
|---------|-------|-----------|---------------|------------|
| Couverture operateurs | 30% | +++  | + | + |
| Cout par SMS | 20% | ++ | +++ | +++ |
| Temps d'integration | 20% | +++ | ++ | ++ |
| Sandbox disponible | 15% | +++ | ? | ++ |
| Support local | 15% | + | +++ | ++ |

**A remplir par le proprietaire du produit.**
