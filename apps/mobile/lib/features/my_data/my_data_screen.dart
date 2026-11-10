import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/widgets/common.dart';
import '../onboarding/consents_screen.dart';

/// E65 — my data & consents: toggle consents, export request, account deletion (OTP).
class MyDataScreen extends ConsumerStatefulWidget {
  const MyDataScreen({super.key});

  @override
  ConsumerState<MyDataScreen> createState() => _MyDataScreenState();
}

class _MyDataScreenState extends ConsumerState<MyDataScreen> {
  Map<String, bool>? _consents;
  String? _exportStatus;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final db = ref.read(localDbProvider);
    final local = await ConsentStore(db).load();
    if (mounted) setState(() => _consents = local);
    final req = await db.getKvJson('export_request');
    if (mounted && req != null) setState(() => _exportStatus = req['status']?.toString());
  }

  Future<void> _toggle(String scope, bool value) async {
    if (scope == 'cgu_confidentialite' && !value) {
      showSnack(context, context.tr('cgu_required'));
      return;
    }
    final next = {...?_consents, scope: value};
    final db = ref.read(localDbProvider);
    final sync = ref.read(syncEngineProvider);
    setState(() => _consents = next);
    await ConsentStore(db).record(next);
    await sync.sync();
  }

  Future<void> _export() async {
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    final db = ref.read(localDbProvider);
    final messenger = ScaffoldMessenger.of(context);
    final offlineMsg = context.tr('needs_network');
    try {
      final r = await api.post('/me/export');
      await db.setKvJson('export_request', r);
      if (mounted) setState(() => _exportStatus = r['status']?.toString() ?? 'recue');
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.isNetwork ? offlineMsg : e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final session = ref.read(sessionProvider);
    final api = ref.read(apiClientProvider);
    final messenger = ScaffoldMessenger.of(context);
    final offlineMsg = context.tr('needs_network');
    final code = TextEditingController();
    try {
      await api.post('/auth/otp/request', {'phone': session.phone}, true);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.isNetwork ? offlineMsg : e.message)));
      return;
    }
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(c.tr('delete_account')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(c.tr('delete_account_warning')),
            const SizedBox(height: 12),
            TextField(
              controller: code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(labelText: c.tr('otp_code')),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(c.tr('cancel'))),
          TextButton(
            onPressed: () => Navigator.pop(c, true),
            child: Text(c.tr('delete'), style: const TextStyle(color: RfColors.coral)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final r = await api.delete('/me', {'otp_code': code.text.trim()});
      messenger.showSnackBar(SnackBar(
        content: Text(r['scheduled_for'] == null ? 'OK' : '${r['scheduled_for']}'),
      ));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.isNetwork ? offlineMsg : e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final consents = _consents;
    final authed = ref.watch(sessionProvider.select((s) => s.isAuthenticated));
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('my_data'), subtitle: context.tr('my_data_subtitle')),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                children: [
                  SectionLabel(context.tr('consents')),
                  if (consents == null) const SkeletonList(rows: 3),
                  if (consents != null)
                    for (final s in kConsentScopes)
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: consents[s] ?? false,
                        onChanged: (v) => _toggle(s, v),
                        title: Text(context.tr('consent_$s'), style: RfType.body(size: 14, color: RfColors.text)),
                        subtitle: Text(context.tr('consent_${s}_desc'),
                            style: RfType.body(size: 12, color: RfColors.textMuted)),
                      ),
                  const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('export_my_data')),
                  const SizedBox(height: 8),
                  Text(
                    _exportStatus == null ? context.tr('export_desc') : context.tr('export_status_$_exportStatus'),
                    style: RfType.body(size: 13, color: RfColors.textSoft),
                  ),
                  const SizedBox(height: 8),
                  PillButton(
                    label: context.tr('request_export'),
                    kind: PillKind.outline,
                    busy: _busy,
                    onPressed: authed ? _export : null,
                  ),
                  const SizedBox(height: RfSpace.gap * 2),
                  SectionLabel(context.tr('delete_account'), color: RfColors.coral),
                  const SizedBox(height: 8),
                  Text(context.tr('delete_account_desc'), style: RfType.body(size: 13, color: RfColors.textSoft)),
                  const SizedBox(height: 8),
                  PillButton(
                    label: context.tr('delete_account'),
                    kind: PillKind.outlineCoral,
                    onPressed: authed ? _delete : null,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
