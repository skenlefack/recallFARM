import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../api/api_client.dart';
import '../db/local_db.dart';
import 'resolution.dart';
import 'signature.dart';

/// Parameter packs on the device: bundled copies (assets/packs, trusted, used on
/// first launch and fully offline) + packs pulled from `/params/manifest`, whose
/// Ed25519 signature is verified against the cached platform public key.
class ParamsRepository {
  ParamsRepository(this.db, this.api);

  final LocalDb db;
  final ApiClient api;

  static const bundledPacks = [
    'global.core',
    'filiere.volaille',
    'filiere.canin',
    'pays.CM',
  ];

  List<ParamPack>? _cache;
  final Map<String, Resolution> _resolved = {};

  /// Inserts bundled packs when absent (idempotent).
  Future<void> ensureBundled() async {
    for (final code in bundledPacks) {
      final raw = await rootBundle.loadString('assets/packs/$code.json');
      final pack = ParamPack.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      if (!await db.hasPack(pack.code, pack.version)) {
        await db.savePack(
          code: pack.code,
          version: pack.version,
          level: pack.level,
          content: raw,
          source: 'bundled',
        );
      }
    }
    invalidate();
  }

  void invalidate() {
    _cache = null;
    _resolved.clear();
  }

  Future<List<ParamPack>> allPacks() async {
    final cached = _cache;
    if (cached != null) return cached;
    final rows = await db.packs();
    final list = <ParamPack>[];
    for (final r in rows) {
      try {
        list.add(ParamPack.fromJson(jsonDecode(r['content'] as String) as Map<String, dynamic>));
      } catch (_) {
        // corrupted row: ignore, the next manifest pull will replace it
      }
    }
    _cache = list;
    return list;
  }

  /// Resolution for a farm (cached per farm/scope until packs change).
  Future<Resolution> resolve({
    required String country,
    required List<String> speculations,
    String? organisationId,
    Map<String, dynamic>? farmSettings,
  }) async {
    final key = '$country|${speculations.join(',')}|${organisationId ?? ''}|${jsonEncode(farmSettings)}';
    final hit = _resolved[key];
    if (hit != null) return hit;
    final packs = await allPacks();
    final orgPacks = <ParamPack>[];
    final latestOrg = <String, ParamPack>{};
    for (final p in packs) {
      if (p.level != 'org') continue;
      final cur = latestOrg[p.code];
      if (cur == null || compareSemver(p.version, cur.version) > 0) latestOrg[p.code] = p;
    }
    orgPacks.addAll(latestOrg.values);
    final selected = Resolver.selectPacks(
      packs,
      FarmScope(country: country, speculations: speculations),
      orgPacks: orgPacks,
    );
    final res = Resolver.resolve(selected, farmSettings: farmSettings);
    _resolved[key] = res;
    return res;
  }

  /// `GET /params/public-key` (cached at login, used for packs and entitlements).
  Future<List<int>?> fetchPublicKey() async {
    final body = await api.get('/params/public-key');
    return Ed25519Verifier.parsePublicKey(body);
  }

  /// Pulls the manifest and downloads missing pack versions. Returns the number
  /// of packs installed; packs whose signature fails are skipped (and counted in
  /// [rejected]).
  Future<({int installed, int rejected})> pullManifest({String? farmId, required List<int>? publicKey}) async {
    final res = await api.dio.get<dynamic>('/params/manifest',
        queryParameters: {if (farmId != null) 'farm_id': farmId});
    final entries = ApiClient.asList(res.data);
    var installed = 0;
    var rejected = 0;
    for (final e in entries) {
      final code = (e['pack'] ?? e['code'])?.toString();
      final version = e['version']?.toString();
      if (code == null || version == null) continue;
      if (await db.hasPack(code, version)) continue;
      if (publicKey == null) {
        rejected++;
        continue;
      }
      final r = await api.dio.get<List<int>>(
        '/params/packs/$code/versions/$version',
        options: Options(responseType: ResponseType.bytes),
      );
      final bytes = r.data ?? const <int>[];
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map) {
        rejected++;
        continue;
      }
      final body = Map<String, dynamic>.from(decoded);
      Map<String, dynamic> pack;
      if (body['objects'] is List) {
        pack = body;
      } else if (body['content'] is Map) {
        pack = Map<String, dynamic>.from(body['content'] as Map);
      } else {
        rejected++;
        continue;
      }
      pack.putIfAbsent('pack', () => code);
      pack.putIfAbsent('version', () => version);
      final hash = (e['hash'] ?? body['hash'])?.toString();
      final signature = (e['signature'] ?? body['signature'])?.toString();
      final ok = await Ed25519Verifier.verifyPack(
        publicKey: publicKey,
        rawBody: body['objects'] is List ? bytes : utf8.encode(Ed25519Verifier.canonicalJson(body['content'])),
        content: body['objects'] is List ? body : body['content'],
        hash: hash,
        signature: signature,
      );
      if (!ok) {
        rejected++;
        continue;
      }
      await db.savePack(
        code: code,
        version: version,
        level: pack['level']?.toString(),
        content: jsonEncode(pack),
        hash: hash,
        signature: signature,
        source: 'server',
      );
      installed++;
    }
    if (installed > 0) invalidate();
    return (installed: installed, rejected: rejected);
  }
}
