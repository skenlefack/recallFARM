Execute le lot $ARGUMENTS : lis docs/plan/lots/$ARGUMENTS.md, applique le cycle de l'orchestrateur (section 6 du plan), rends le rapport.

Cycle :
1. Cadrage : relis le fichier du lot, verifie les prerequis et decisions.
2. Contrats : fais produire par `architecte` les contrats (OpenAPI, schemas, vecteurs) et l'ADR.
3. Decoupage : une tache par agent, perimetres de fichiers disjoints, graphe de dependances.
4. Delegation : brief autonome par agent dans sa branche feat/<lot>-<agent>.
5. Integration : a chaque rapport, verifie (relance les tests, lis le diff). Fusionne dans int/<lot>.
6. Controle : `relecteur`, `securite-conformite` et `ux-fidelite` relisent. Boucle jusqu'a zero bloquant.
7. Recette : `qa-automatisation` joue la recette sur la pile docker propre.
8. Cloture : PR vers main avec rapport, CHANGELOG, journal mis a jour.
