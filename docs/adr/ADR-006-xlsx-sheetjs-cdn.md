# ADR-006 — SheetJS (xlsx) 0.20.3 depuis le CDN officiel de l'editeur

Statut : ACCEPTE (proprietaire du produit, 2026-11-13, Q-SEC-01)

## Contexte
L'import d'eleveurs (`POST /v1/imports`) lit les fichiers `.xlsx` avec SheetJS. La version 0.18.5,
derniere publiee sur le registre npm, porte deux CVE HIGH atteignables (CVE-2023-30533 pollution de
prototype, CVE-2024-22363 ReDoS). L'editeur ne publie plus sur npm : les versions corrigees ne sont
distribuees que par `https://cdn.sheetjs.com`. La revue de securite a aussi montre que la limite de
5 Mo ne borne que la taille compressee : un classeur decompresse et analyse de facon synchrone peut
figer l'API ou la faire tomber en memoire (serveur partage, `mem_limit` 448 Mo).

## Decision
- `xlsx` 0.20.3, archive officielle `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` versionnee
  dans `apps/api/vendor/` (2,4 Mo) et referencee `file:vendor/xlsx-0.20.3.tgz` ; empreinte `sha512`
  identique a celle du CDN, figee dans `apps/api/package-lock.json` (`npm ci` refuse toute archive
  differente). Le build ne depend donc pas de la disponibilite du CDN (injoignable depuis le build
  Docker local lors de l'essai).
- On ne donne jamais a SheetJS le fichier recu (`src/imports-exports/xlsx-guard.ts`, `sanitizeXlsx`) :
  SheetJS decompresse toutes les entrees d'emblee avec son inflate JS en se fiant aux tailles des
  en-tetes locaux, qu'un fichier piege peut falsifier (revue : 2 Mo -> 2 Go de RAM). Le garde :
  zip pur commencant par un en-tete local (pas de repli OLE/HTML/SYLK) ; EOCD unique, trouvee comme
  SheetJS la cherche, disque unique, compteurs coherents ; en-tetes local et central concordants,
  pas de zip64 ; au plus 200 entrees, noms uniques, plages d'octets disjointes (pas d'entree lue
  deux fois) ; chaque entree reellement decompressee par zlib natif avec plafond de sortie et
  taille reelle = taille declaree ; total <= 16 Mo (environ 3 fois un import de 20 000 lignes).
  Le contenu verifie est reecrit en zip NON compresse, que SheetJS lit sans rien decompresser.
  Les archives a descripteur de donnees (Google Sheets, LibreOffice, outils Java) restent acceptees.
- Lecture bornee a 20 000 lignes (`sheetRows`), `cellHTML: false`. La plage de la feuille annoncee
  par le fichier (`<dimension>`) n'est jamais crue : `boundedSheetRange` refuse plus de 64 colonnes et
  coupe les lignes avant `sheet_to_json` (un fichier de 8 Ko annoncant A1:XFD20001 tuait le processus).
- Plancher de version teste (`src/common/security/dependency-floors.spec.ts`, xlsx >= 0.20.2).

## Consequences
- Une dependance hors du registre npm : la mise a jour se fait a la main (surveiller les annonces
  de SheetJS) ; Trivy et `npm audit` continuent de la scanner via le verrou.
- Mise a jour : telecharger la nouvelle archive du CDN, verifier son empreinte, remplacer le fichier
  de `vendor/` puis `npm install ./vendor/<archive>`.
- Alternatives ecartees : import CSV seul (une etape de plus pour les gestionnaires), garder 0.18.5
  en risque accepte (CVE atteignables), autre bibliotheque (reecriture et nouvelle surface).
- Mesures (2026-11-13, contre-revues) : bombe de 2 Mo refusee en < 5 ms ; 2 000 entrees sur les memes
  octets refusees en 5 ms (13,4 s avant) ; dimension A1:XFD20001 refusee (plantage memoire avant) ;
  classeur reel de 20 000 lignes : 11 ms de controle, 0,4 s de lecture.
- Risque residuel : un classeur honnete proche de 16 Mo decompresses bloque la boucle d'evenements
  environ 2,6 s pour environ 330 Mo de memoire (lecture synchrone : un plafond de concurrence en
  memoire n'y change rien). Borne par le role gestionnaire et le throttler. Suite : analyse dans un
  `worker_threads` avec `resourceLimits` et delai.
