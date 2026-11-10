import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/signature.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/widgets/common.dart';
import 'onboarding_scaffold.dart';

/// Country calling codes of the pilot countries (dossier 13 `country`).
const kDialCodes = {
  'CM': '+237',
  'SN': '+221',
  'CI': '+225',
  'ML': '+223',
  'BF': '+226',
  'BJ': '+229',
  'TG': '+228',
  'NE': '+227',
  'GA': '+241',
  'CG': '+242',
  'TD': '+235',
  'CF': '+236',
  'GN': '+224',
  'CD': '+243',
  'MG': '+261',
};

/// E02 — account creation: phone + OTP; offline → provisional local account.
class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController();
  String _country = 'CM';
  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  String? _devCode;
  int _retryAfter = 0;
  Timer? _timer;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _name.dispose();
    _timer?.cancel();
    super.dispose();
  }

  String get _e164 {
    final digits = _phone.text.replaceAll(RegExp(r'[^0-9]'), '');
    return '${kDialCodes[_country]}$digits';
  }

  bool get _phoneValid => RegExp(r'^\+[1-9][0-9]{7,14}$').hasMatch(_e164);

  void _startCountdown(int seconds) {
    _timer?.cancel();
    setState(() => _retryAfter = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _retryAfter <= 0) {
        t.cancel();
        return;
      }
      setState(() => _retryAfter--);
    });
  }

  Future<void> _requestCode() async {
    if (!_phoneValid) {
      setState(() => _error = context.tr('err_phone'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiClientProvider).post('/auth/otp/request', {'phone': _e164}, true);
      if (!mounted) return;
      setState(() {
        _codeSent = true;
        _devCode = kDebugMode ? r['dev_code']?.toString() : null;
      });
      _startCountdown((r['retry_after_s'] as num?)?.toInt() ?? 60);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.isNetwork ? context.tr('otp_offline') : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (!RegExp(r'^[0-9]{6}$').hasMatch(code)) {
      setState(() => _error = context.tr('err_otp'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    // Capture everything up-front: once the session changes, the router leaves
    // this screen and `ref` must not be used any more.
    final session = ref.read(sessionProvider);
    final api = ref.read(apiClientProvider);
    final tokens = ref.read(tokenStoreProvider);
    final ent = ref.read(entitlementsProvider);
    final sync = ref.read(syncEngineProvider);
    final typedName = _name.text.trim();
    final phone = _e164;
    try {
      final r = await api.post(
        '/auth/otp/verify',
        {
          'phone': phone,
          'code': code,
          if (session.provisional && session.userId != null) 'provisional_user_id': session.userId,
        },
        true,
      );
      await tokens.save(
        access: r['access_token'].toString(),
        refresh: r['refresh_token']?.toString(),
      );
      final user = ApiClient.asMap(r['user']);
      // Cache the platform public key (packs + entitlements verification) and /me.
      Map<String, dynamic>? me;
      try {
        final key = Ed25519Verifier.parsePublicKey(await api.get('/params/public-key'));
        if (key != null) await ent.setPublicKey(key);
        me = await api.get('/me');
        if (me['entitlements'] is Map) {
          await ent.update(Map<String, dynamic>.from(me['entitlements'] as Map));
        }
        if (typedName.isNotEmpty && me['name'] == null) {
          await api.patch('/me', {'name': typedName});
        }
      } on ApiException catch (_) {
        // non-blocking: retried by the sync engine
      }
      await session.signedIn(
        userId: (user['id'] ?? session.userId ?? '').toString(),
        phone: phone,
        name: typedName.isEmpty ? user['name'] as String? : typedName,
        language: user['language'] as String?,
      );
      if (me != null) await session.applyMe(me);
      unawaited(sync.sync(manual: true));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.isNetwork ? context.tr('otp_offline') : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _offline() async {
    if (!_phoneValid) {
      setState(() => _error = context.tr('err_phone'));
      return;
    }
    await ref.read(sessionProvider).createProvisional(
          phone: _e164,
          name: _name.text.trim().isEmpty ? null : _name.text.trim(),
        );
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    return OnboardingScaffold(
      step: 2,
      title: context.tr('onb_account_title'),
      subtitle: context.tr('onb_account_subtitle'),
      onBack: () => session.setSpeculations(const []),
      body: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              decoration: InputDecoration(labelText: context.tr('your_name_optional')),
            ),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 112,
                  child: DropdownButtonFormField<String>(
                    initialValue: _country,
                    isExpanded: true,
                    dropdownColor: RfColors.panel,
                    decoration: InputDecoration(labelText: context.tr('dial_code')),
                    items: [
                      for (final e in kDialCodes.entries)
                        DropdownMenuItem(
                          value: e.key,
                          child: Text('${e.key} ${e.value}', style: RfType.mono(size: 13, color: RfColors.text)),
                        ),
                    ],
                    onChanged: _codeSent ? null : (v) => setState(() => _country = v ?? 'CM'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _phone,
                    enabled: !_codeSent,
                    keyboardType: TextInputType.phone,
                    autofillHints: const [AutofillHints.telephoneNumberNational],
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ]'))],
                    style: RfType.mono(size: 18, color: RfColors.text),
                    decoration: InputDecoration(labelText: context.tr('phone'), hintText: '6 90 00 00 01'),
                  ),
                ),
              ],
            ),
            if (_codeSent) ...[
              const SizedBox(height: 14),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textAlign: TextAlign.center,
                style: RfType.mono(size: 24, color: RfColors.text, letterSpacing: 6),
                decoration: InputDecoration(labelText: context.tr('otp_code'), counterText: ''),
              ),
              if (_devCode != null)
                Text(context.tr('dev_code', {'code': _devCode}),
                    style: RfType.mono(size: 12, color: RfColors.cyan)),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _retryAfter > 0 || _busy ? null : _requestCode,
                  child: Text(_retryAfter > 0
                      ? context.tr('otp_resend_in', {'s': _retryAfter})
                      : context.tr('otp_resend')),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 10),
              Semantics(
                liveRegion: true,
                child: Text(_error!, style: RfType.body(size: 13, color: RfColors.coral)),
              ),
            ],
            const SizedBox(height: 16),
            Text(context.tr('onb_account_offline_hint'),
                style: RfType.body(size: 12, color: RfColors.textMuted, height: 1.5)),
          ],
        ),
      ),
      actions: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PillButton(
            label: context.tr(_codeSent ? 'verify' : 'send_code'),
            fontSize: 16,
            padding: const EdgeInsets.all(16),
            busy: _busy,
            onPressed: _codeSent ? _verify : _requestCode,
          ),
          const SizedBox(height: 8),
          PillButton(
            label: context.tr('continue_offline'),
            kind: PillKind.outline,
            bold: false,
            onPressed: _busy ? null : _offline,
          ),
        ],
      ),
    );
  }
}
