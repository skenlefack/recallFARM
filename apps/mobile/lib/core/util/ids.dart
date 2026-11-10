import 'package:uuid/uuid.dart';

class Ids {
  Ids._();
  static const Uuid _uuid = Uuid();

  /// Client-generated UUID v4 (dossier 05: every create carries its id).
  static String newId() => _uuid.v4();
}
