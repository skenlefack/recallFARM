// Pure Dart — no Flutter imports. Contract: packages/params/ENGINES.md §1
import 'dart:convert';

/// A parameter pack as published (`packages/params/packs/*.json`).
class ParamPack {
  ParamPack({
    required this.code,
    required this.version,
    required this.level,
    required this.objects,
    this.country,
    this.currency,
    Map<String, Map<String, String>>? i18n,
    Map<String, dynamic>? raw,
  })  : i18n = i18n ?? const {},
        raw = raw ?? const {};

  factory ParamPack.fromJson(Map<String, dynamic> j) {
    final i18n = <String, Map<String, String>>{};
    final rawI18n = j['i18n'];
    if (rawI18n is Map) {
      rawI18n.forEach((lang, entries) {
        if (entries is Map) {
          i18n[lang.toString()] = {
            for (final e in entries.entries) e.key.toString(): e.value.toString()
          };
        }
      });
    }
    return ParamPack(
      code: j['pack'] as String,
      version: j['version'] as String,
      level: (j['level'] as String?) ?? 'global',
      country: j['country'] as String?,
      currency: j['currency'] as String?,
      objects: [
        for (final o in (j['objects'] as List? ?? const []))
          if (o is Map) Map<String, dynamic>.from(o)
      ],
      i18n: i18n,
      raw: j,
    );
  }

  final String code;
  final String version;
  final String level;
  final String? country;
  final String? currency;
  final List<Map<String, dynamic>> objects;
  final Map<String, Map<String, String>> i18n;
  final Map<String, dynamic> raw;

  String get label => '$code@$version';
}

class Rejection {
  const Rejection({
    required this.kind,
    required this.code,
    required this.property,
    required this.byPack,
    required this.reason,
  });

  final String kind;
  final String code;
  final String property;
  final String byPack;
  final String reason;

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'code': code,
        'property': property,
        'by_pack': byPack,
        'reason': reason,
      };

  @override
  String toString() => jsonEncode(toJson());
}

class Resolution {
  Resolution({
    required this.objects,
    required this.provenance,
    required this.rejected,
    required this.paramVersion,
    required this.i18n,
  });

  /// `"<kind>:<code>"` → resolved object.
  final Map<String, Map<String, dynamic>> objects;

  /// `"<kind>:<code>"` → `{prop: "pack@version"}`.
  final Map<String, Map<String, String>> provenance;
  final List<Rejection> rejected;
  final String paramVersion;

  /// Merged labels, lang → key → text (lower levels override upper ones).
  final Map<String, Map<String, String>> i18n;

  Map<String, dynamic>? get(String kind, String code) => objects['$kind:$code'];

  Iterable<Map<String, dynamic>> ofKind(String kind) =>
      objects.values.where((o) => o['kind'] == kind);

  /// Label lookup with fallback: [lang] → fr → key itself.
  String label(String key, String lang) =>
      i18n[lang]?[key] ?? i18n['fr']?[key] ?? key;

  static Resolution empty() => Resolution(
        objects: const {},
        provenance: const {},
        rejected: const [],
        paramVersion: '',
        i18n: const {},
      );
}

/// Farm context used to select packs.
class FarmScope {
  const FarmScope({required this.country, required this.speculations});
  final String country;
  final List<String> speculations;
}

const Map<String, String> kSpeculationToFiliere = {
  'volaille': 'filiere.volaille',
  'chien': 'filiere.canin',
};

class Resolver {
  Resolver._();

  /// Selects and orders packs: global → filière(s) (speculation order) → pays → org.
  static List<ParamPack> selectPacks(
    Iterable<ParamPack> available,
    FarmScope farm, {
    List<ParamPack> orgPacks = const [],
  }) {
    ParamPack? latest(String code) {
      ParamPack? best;
      for (final p in available) {
        if (p.code != code) continue;
        if (best == null || compareSemver(p.version, best.version) > 0) best = p;
      }
      return best;
    }

    final out = <ParamPack>[];
    final global = latest('global.core');
    if (global != null) out.add(global);
    final seen = <String>{};
    for (final s in farm.speculations) {
      final code = kSpeculationToFiliere[s];
      if (code == null || !seen.add(code)) continue;
      final p = latest(code);
      if (p != null) out.add(p);
    }
    final pays = latest('pays.${farm.country}');
    if (pays != null) out.add(pays);
    out.addAll(orgPacks);
    return out;
  }

  static String objectKey(Map<String, dynamic> o) {
    final kind = o['kind'];
    final code = o['code'];
    if (kind == 'message_template') {
      return '$kind:$code:${o['channel']}:${o['lang']}';
    }
    return '$kind:$code';
  }

  /// Resolves [packs] (already ordered) plus farm overrides
  /// (`{"<kind>:<code>": {partial object}}`, attributed to `ferme`).
  static Resolution resolve(
    List<ParamPack> packs, {
    Map<String, dynamic>? farmSettings,
  }) {
    final objects = <String, Map<String, dynamic>>{};
    final policies = <String, Map<String, dynamic>>{};
    final provenance = <String, Map<String, String>>{};
    final rejected = <Rejection>[];
    final i18n = <String, Map<String, String>>{};

    void merge(String key, Map<String, dynamic> incoming, String by) {
      final existing = objects[key]!;
      final policy = policies[key] ?? const <String, dynamic>{};
      final prov = provenance.putIfAbsent(key, () => <String, String>{});
      final kind = existing['kind'].toString();
      final code = existing['code'].toString();

      void reject(String property, String reason) {
        rejected.add(Rejection(
            kind: kind, code: code, property: property, byPack: by, reason: reason));
      }

      for (final entry in incoming.entries) {
        final prop = entry.key;
        final value = entry.value;
        if (prop == 'kind' || prop == 'code' || prop == 'override') continue;
        if (kind == 'message_template' && (prop == 'channel' || prop == 'lang')) continue;
        final old = existing[prop];

        // 1. Threshold params: policy declared under `override.<key>`.
        if (prop == 'params' && value is Map && old is Map) {
          final mergedParams = Map<String, dynamic>.from(old);
          var changed = false;
          value.forEach((k, v) {
            final reason = _check(policy[k.toString()], mergedParams[k], v);
            if (reason == null) {
              mergedParams[k.toString()] = _copy(v);
              changed = true;
            } else {
              reject('params.$k', reason);
            }
          });
          existing['params'] = mergedParams;
          if (changed) prov['params'] = by;
          continue;
        }

        // 2. Dotted policies (e.g. `recurring.every_days`) → sub-property merge.
        final dottedPrefix = '$prop.';
        final hasDotted = policy.keys.any((k) => k.startsWith(dottedPrefix));
        if (hasDotted && value is Map && old is Map) {
          final mergedSub = Map<String, dynamic>.from(old);
          var changed = false;
          value.forEach((k, v) {
            final reason = _check(policy['$prop.$k'], mergedSub[k], v);
            if (reason == null) {
              mergedSub[k.toString()] = _copy(v);
              changed = true;
            } else {
              reject('$prop.$k', reason);
            }
          });
          existing[prop] = mergedSub;
          if (changed) prov[prop] = by;
          continue;
        }

        final propPolicy = policy[prop];
        final policyName = propPolicy is Map ? propPolicy['policy'] : null;

        // 3. Lists of coded objects under `ajout_seulement`: add or replace by code.
        if (policyName == 'ajout_seulement' && value is List && old is List) {
          final result = [for (final e in old) _copy(e)];
          var changed = false;
          for (final item in value) {
            if (item is! Map || item['code'] == null) continue;
            final itemCode = item['code'].toString();
            final idx = result.indexWhere((e) => e is Map && e['code'].toString() == itemCode);
            if (idx < 0) {
              result.add(_copy(item));
              changed = true;
              continue;
            }
            final mergedItem = Map<String, dynamic>.from(result[idx] as Map);
            item.forEach((f, fv) {
              final field = f.toString();
              if (field == 'code') return;
              final reason = _check(policy[field], mergedItem[field], fv);
              if (reason == null) {
                mergedItem[field] = _copy(fv);
                changed = true;
              } else {
                reject('$prop.$itemCode.$field', reason);
              }
            });
            result[idx] = mergedItem;
          }
          existing[prop] = result;
          if (changed) prov[prop] = by;
          continue;
        }

        // 4. Plain property.
        final reason = _check(propPolicy, old, value);
        if (reason == null) {
          existing[prop] = _copy(value);
          prov[prop] = by;
        } else {
          reject(prop, reason);
        }
      }
    }

    for (final pack in packs) {
      final by = pack.label;
      for (final obj in pack.objects) {
        final key = objectKey(obj);
        if (!objects.containsKey(key)) {
          final copy = _copy(obj) as Map<String, dynamic>;
          objects[key] = copy;
          final ov = obj['override'];
          policies[key] = ov is Map ? Map<String, dynamic>.from(ov) : <String, dynamic>{};
          provenance[key] = {
            for (final k in obj.keys)
              if (k != 'kind' && k != 'code' && k != 'override') k: by
          };
        } else {
          merge(key, obj, by);
        }
      }
      pack.i18n.forEach((lang, entries) {
        i18n.putIfAbsent(lang, () => <String, String>{}).addAll(entries);
      });
    }

    if (farmSettings != null) {
      farmSettings.forEach((key, value) {
        if (value is! Map || !objects.containsKey(key)) return;
        merge(key, Map<String, dynamic>.from(value), 'ferme');
      });
    }

    return Resolution(
      objects: objects,
      provenance: provenance,
      rejected: rejected,
      paramVersion: packs.map((p) => p.label).join('+'),
      i18n: i18n,
    );
  }

  /// Returns null when [newValue] is accepted under [policy], else the reason.
  static String? _check(Object? policy, Object? oldValue, Object? newValue) {
    if (policy is! Map) return null; // libre by default
    final name = policy['policy'];
    switch (name) {
      case null:
      case 'libre':
      case 'ajout_seulement':
        return null;
      case 'verrouillee':
        return 'verrouillee';
      case 'bornee':
        if (newValue is! num) return 'bornee';
        final v = newValue.toDouble();
        final min = policy['min'];
        final max = policy['max'];
        if (min is num && v < min.toDouble()) return 'bornee';
        if (max is num && v > max.toDouble()) return 'bornee';
        final minDelta = policy['min_delta'];
        final maxDelta = policy['max_delta'];
        if (minDelta is num || maxDelta is num) {
          if (oldValue is! num) return null; // new element: nothing to bound against
          final delta = v - oldValue.toDouble();
          if (minDelta is num && delta < minDelta.toDouble()) return 'bornee';
          if (maxDelta is num && delta > maxDelta.toDouble()) return 'bornee';
        }
        return null;
      default:
        return null;
    }
  }

  static Object? _copy(Object? v) {
    if (v is Map) {
      return <String, dynamic>{for (final e in v.entries) e.key.toString(): _copy(e.value)};
    }
    if (v is List) return [for (final e in v) _copy(e)];
    return v;
  }
}

/// Compares `a.b.c` semantic versions (pre-release suffixes ignored).
int compareSemver(String a, String b) {
  List<int> parts(String v) => v
      .split('-')
      .first
      .split('.')
      .map((p) => int.tryParse(p) ?? 0)
      .toList();
  final pa = parts(a);
  final pb = parts(b);
  for (var i = 0; i < 3; i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}
