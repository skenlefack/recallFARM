# ADR-004 — Mobile : tests de LocalDb sur le poste avec sqflite_common_ffi

## Statut
ACCEPTE (mobile-socle, 2026-11-10), suite à la revue P0.1 (M2).

## Contexte
Les règles de fusion de la synchronisation (`LocalDb.applyRemoteAll`, `markPushedAll`, `mergeRemote` :
champs locaux non synchronisés prioritaires, garde `client_rev`, rappel confirmé prioritaire, lectures
par paquets de 500 identifiants) n'étaient testées qu'en intégration sur émulateur. SQLCipher
(`sqflite_sqlcipher`) est un plugin natif : il ne tourne pas dans `flutter test`.

## Décision
Ajouter `sqflite_common_ffi` en **dev_dependency uniquement** (aucun effet sur l'APK). `LocalDb.forTesting(Database)`
enveloppe une base SQLite FFI en mémoire avec le même schéma et le même SQL que sur le téléphone
(`Database` vient de `sqflite_common`, partagé par les deux paquets). Seule la couche de chiffrement
diffère ; elle reste couverte par `integration_test/db_key_migration_test.dart` sur appareil.

## Conséquences
- `flutter test` couvre la fusion et l'outbox sans appareil (`test/core/local_db_sync_test.dart`).
- Dépendance transitive `sqlite3` (FFI) en développement seulement.
- Retour arrière : retirer la dépendance et les tests qui utilisent `test/core/memory_db.dart`.
