Execute les vecteurs de packages/params/vectors/ en TypeScript et en Dart, compare les sorties
cas par cas, et echoue au premier ecart avec le detail.

Etapes :
1. cd apps/api && npm test -- --testPathPattern=vectors
2. cd apps/mobile && flutter test test/engines/
3. Compare les resultats ligne par ligne.
4. Si un ecart : affiche le vecteur, la sortie TS, la sortie Dart, et la difference.
5. Rapport : nombre de vecteurs, nombre passes, nombre echoues, details des ecarts.
