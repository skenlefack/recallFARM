Appelle l'agent `relecteur` sur la branche courante (git diff main...), puis `securite-conformite`,
puis `ux-fidelite` pour tout ecran modifie. Consolide leurs constats dans docs/plan/revues/<lot>.md.
Renvoie chaque BLOQUANT a l'agent proprietaire du fichier avec le scenario de defaillance.
Quand tous les correctifs sont integres, relance les trois revues sur le nouveau diff.
Arrete quand une revue complete ne trouve plus aucun BLOQUANT. Ne fusionne jamais avant.
