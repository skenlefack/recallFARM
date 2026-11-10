// Pure Dart (no Flutter): Ed25519 helpers for pack signatures and entitlement JWS.
import 'dart:convert';

import 'package:crypto/crypto.dart' as crypto;
import 'package:cryptography/cryptography.dart';

class Ed25519Verifier {
  Ed25519Verifier._();

  static final Ed25519 _algo = Ed25519();

  /// Decodes base64 or base64url, with or without padding.
  static List<int> b64(String s) {
    var t = s.trim().replaceAll('-', '+').replaceAll('_', '/');
    t = t.replaceAll(RegExp(r'\s'), '');
    while (t.length % 4 != 0) {
      t += '=';
    }
    return base64.decode(t);
  }

  static String b64UrlNoPad(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

  /// Accepts the shapes `GET /params/public-key` may return:
  /// `{public_key|key: "<base64 raw 32 bytes | base64 SPKI DER | PEM>"}`,
  /// a JWK `{kty: "OKP", crv: "Ed25519", x: "<base64url>"}`, or a bare string.
  static List<int>? parsePublicKey(Object? raw) {
    if (raw is Map) {
      if (raw['x'] is String) return _fromString(raw['x'] as String);
      for (final k in const ['public_key', 'publicKey', 'key', 'pem', 'spki']) {
        if (raw[k] is String) return _fromString(raw[k] as String);
        if (raw[k] is Map) return parsePublicKey(raw[k]);
      }
      return null;
    }
    if (raw is String) return _fromString(raw);
    return null;
  }

  static List<int>? _fromString(String s) {
    try {
      var body = s;
      if (body.contains('-----BEGIN')) {
        body = body
            .split('\n')
            .where((l) => !l.startsWith('-----'))
            .join();
      }
      final bytes = b64(body);
      if (bytes.length == 32) return bytes;
      // SPKI DER for Ed25519 is 44 bytes: 12-byte prefix + 32-byte key.
      if (bytes.length == 44) return bytes.sublist(12);
      // Hex fallback.
      if (RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(s.trim())) return hexDecode(s.trim());
      return null;
    } catch (_) {
      if (RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(s.trim())) return hexDecode(s.trim());
      return null;
    }
  }

  static List<int> hexDecode(String hex) => [
        for (var i = 0; i + 1 < hex.length; i += 2) int.parse(hex.substring(i, i + 2), radix: 16)
      ];

  static String sha256Hex(List<int> bytes) => crypto.sha256.convert(bytes).toString();

  static Future<bool> verify(List<int> publicKey, List<int> message, List<int> signature) async {
    try {
      return await _algo.verify(
        message,
        signature: Signature(signature, publicKey: SimplePublicKey(publicKey, type: KeyPairType.ed25519)),
      );
    } catch (_) {
      return false;
    }
  }

  /// Verifies a compact JWS (`header.payload.signature`, alg EdDSA) and returns
  /// its payload, or null when the signature is invalid.
  static Future<Map<String, dynamic>?> verifyJws(String token, List<int> publicKey) async {
    final parts = token.split('.');
    if (parts.length != 3) return null;
    try {
      final header = jsonDecode(utf8.decode(b64(parts[0])));
      if (header is Map && header['alg'] != null && header['alg'] != 'EdDSA' && header['alg'] != 'Ed25519') {
        return null;
      }
      final ok = await verify(publicKey, ascii.encode('${parts[0]}.${parts[1]}'), b64(parts[2]));
      if (!ok) return null;
      final payload = jsonDecode(utf8.decode(b64(parts[1])));
      return payload is Map ? Map<String, dynamic>.from(payload) : null;
    } catch (_) {
      return null;
    }
  }

  /// Decodes a JWS payload WITHOUT verifying it (display only).
  static Map<String, dynamic>? peekJws(String token) {
    final parts = token.split('.');
    if (parts.length != 3) return null;
    try {
      final payload = jsonDecode(utf8.decode(b64(parts[1])));
      return payload is Map ? Map<String, dynamic>.from(payload) : null;
    } catch (_) {
      return null;
    }
  }

  /// Canonical JSON: keys sorted recursively, no whitespace.
  static String canonicalJson(Object? v) {
    if (v is Map) {
      final keys = v.keys.map((k) => k.toString()).toList()..sort();
      return '{${keys.map((k) => '${jsonEncode(k)}:${canonicalJson(v[k])}').join(',')}}';
    }
    if (v is List) return '[${v.map(canonicalJson).join(',')}]';
    return jsonEncode(v);
  }

  /// Pack signature check (assumption documented in README "Contract assumptions"):
  /// `hash` = sha256 hex of the served pack bytes (raw body, or canonical JSON of
  /// the pack content), optionally prefixed `sha256:`; `signature` = Ed25519 over
  /// the UTF-8 hash string, the raw hash bytes, or the canonical content bytes.
  static Future<bool> verifyPack({
    required List<int> publicKey,
    required List<int> rawBody,
    required Object? content,
    required String? hash,
    required String? signature,
  }) async {
    if (hash == null || signature == null) return false;
    final h = hash.startsWith('sha256:') ? hash.substring(7) : hash;
    final canonical = utf8.encode(canonicalJson(content));
    final candidates = {sha256Hex(rawBody), sha256Hex(canonical)};
    if (!candidates.contains(h.toLowerCase())) return false;
    final sig = b64(signature);
    if (await verify(publicKey, utf8.encode(h), sig)) return true;
    if (h.length == 64 && await verify(publicKey, hexDecode(h), sig)) return true;
    return verify(publicKey, canonical, sig);
  }
}
