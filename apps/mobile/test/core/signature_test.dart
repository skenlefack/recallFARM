import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/params/signature.dart';

/// Ed25519 verification used for signed packs (RG-PAR) and offline entitlements.
/// Vectors: RFC 8032 §7.1 (tests 1 and 2) + fixtures signed by Node's crypto
/// (the API's implementation), so a change of Dart crypto library is caught.
void main() {
  List<int> hex(String s) => Ed25519Verifier.hexDecode(s);

  group('RFC 8032 §7.1', () {
    test('test 1 (empty message)', () async {
      final pk = hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
      final sig = hex('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555'
          'fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
      expect(await Ed25519Verifier.verify(pk, const [], sig), isTrue);
      expect(await Ed25519Verifier.verify(pk, const [0], sig), isFalse);
    });

    test('test 2 (one byte)', () async {
      final pk = hex('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');
      final sig = hex('92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da'
          '085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00');
      expect(await Ed25519Verifier.verify(pk, const [0x72], sig), isTrue);
      final tampered = [...sig]..[0] ^= 1;
      expect(await Ed25519Verifier.verify(pk, const [0x72], tampered), isFalse);
    });

    test('malformed inputs return false, never throw', () async {
      expect(await Ed25519Verifier.verify(const [1, 2, 3], const [1], const [4, 5]), isFalse);
      expect(await Ed25519Verifier.verify(List.filled(32, 0), const [1], List.filled(64, 0)), isFalse);
    });
  });

  group('Node-signed fixtures (API side)', () {
    const spki = 'MCowBQYDK2VwAyEAifaiepC9VhqTeqGuR1kCLtwf+kjEBSTNgQLW8RVrCnc=';
    const jws = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.'
        'eyJwbGFuIjoicHJvIiwiZmVhdHVyZXMiOlsic21zIl0sImV4cGlyZXNfYXQiOiIyMDI3LTAxLTAxVDAwOjAwOjAwWiJ9.'
        'KHac_aP2EVIMZcWaiihqxCzUGF3wq76iUolD_-b2Hd_XN0HjXQy_Uo4cphOvZacUZuzBuHSV9tIW1gVabZo4Cw';

    test('public key shapes: SPKI, PEM, JWK, raw', () {
      final raw = Ed25519Verifier.parsePublicKey({'public_key': spki})!;
      expect(raw, hasLength(32));
      const pem = '-----BEGIN PUBLIC KEY-----\n$spki\n-----END PUBLIC KEY-----';
      expect(Ed25519Verifier.parsePublicKey(pem), raw);
      expect(Ed25519Verifier.parsePublicKey({'kty': 'OKP', 'x': Ed25519Verifier.b64UrlNoPad(raw)}), raw);
      expect(Ed25519Verifier.parsePublicKey(base64.encode(raw)), raw);
      expect(Ed25519Verifier.parsePublicKey(42), isNull);
    });

    test('EdDSA JWS verified offline; tampering rejected', () async {
      final pk = Ed25519Verifier.parsePublicKey(spki)!;
      final payload = await Ed25519Verifier.verifyJws(jws, pk);
      expect(payload, isNotNull);
      expect(payload!['plan'], 'pro');
      final parts = jws.split('.');
      final forged = Ed25519Verifier.b64UrlNoPad(utf8.encode('{"plan":"premium"}'));
      expect(await Ed25519Verifier.verifyJws('${parts[0]}.$forged.${parts[2]}', pk), isNull);
      expect(await Ed25519Verifier.verifyJws('a.b', pk), isNull);
      expect(Ed25519Verifier.peekJws(jws)!['plan'], 'pro');
    });

    test('signed pack: canonical JSON hash + signature over the hash string', () async {
      final pk = Ed25519Verifier.parsePublicKey(spki)!;
      final content = {'version': '1.0.0', 'code': 'x', 'a': [1, 2]};
      const hash = 'd6fed8c01e3df19ddb0dca1c9323b89e29606ad3bd2bd15c7c3f256854675744';
      const sig = '5HxL+2jXbAHxpzQ4yXlII/2ZQLW2qtClj+kYsvVNKQUjrl2mtCrNuqlKV4BSMH9Jh1O5VPJHxpHXhygiRZDACg==';
      expect(Ed25519Verifier.canonicalJson(content), '{"a":[1,2],"code":"x","version":"1.0.0"}');
      expect(
        await Ed25519Verifier.verifyPack(
            publicKey: pk, rawBody: utf8.encode(jsonEncode(content)), content: content, hash: 'sha256:$hash', signature: sig),
        isTrue,
      );
      // content changed after signing → hash mismatch
      expect(
        await Ed25519Verifier.verifyPack(
            publicKey: pk,
            rawBody: const [],
            content: {...content, 'a': [1, 3]},
            hash: hash,
            signature: sig),
        isFalse,
      );
      expect(
        await Ed25519Verifier.verifyPack(publicKey: pk, rawBody: const [], content: content, hash: null, signature: sig),
        isFalse,
      );
    });
  });
}
