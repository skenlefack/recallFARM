import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/providers.dart';
import '../../core/db/local_db.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import 'onboarding_scaffold.dart';

/// Consent scopes of dossier 03 `consent_scope` shown at onboarding (E03) and in E65.
const kConsentScopes = [
  'cgu_confidentialite',
  'partage_veterinaire',
  'partage_organisation',
  'surveillance_agregats',
  'messages_whatsapp',
  'messages_sms',
];
const kConsentTextVersion = 'cgu-2026-10';

/// Local copy of the latest consent per scope (kv `consents`) + queued POST /me/consents.
class ConsentStore {
  ConsentStore(this.db);
  final LocalDb db;

  Future<Map<String, bool>> load() async {
    final j = await db.getKvJson('consents') ?? {};
    return {for (final s in kConsentScopes) s: j[s] == true};
  }

  Future<void> record(Map<String, bool> choices) async {
    final current = await db.getKvJson('consents') ?? {};
    for (final e in choices.entries) {
      if (current[e.key] == e.value) continue;
      current[e.key] = e.value;
      // Every change is a new record (dossier 05 §2); replayed when online.
      await db.queueAction('POST', '/me/consents', {
        'id': Ids.newId(),
        'scope': e.key,
        'granted': e.value,
        'text_version': kConsentTextVersion,
        'channel': 'app',
      });
    }
    await db.setKvJson('consents', current);
  }
}

/// E03 — consents: CGU mandatory, other boxes optional.
class ConsentsScreen extends ConsumerStatefulWidget {
  const ConsentsScreen({super.key});

  @override
  ConsumerState<ConsentsScreen> createState() => _ConsentsScreenState();
}

class _ConsentsScreenState extends ConsumerState<ConsentsScreen> {
  final Map<String, bool> _choices = {for (final s in kConsentScopes) s: false};
  bool _busy = false;

  Future<void> _continue() async {
    setState(() => _busy = true);
    final session = ref.read(sessionProvider);
    await ConsentStore(ref.read(localDbProvider)).record(_choices);
    await session.setConsentsDone();
  }

  @override
  Widget build(BuildContext context) {
    final cguOk = _choices['cgu_confidentialite'] == true;
    return OnboardingScaffold(
      step: 3,
      title: context.tr('onb_consents_title'),
      subtitle: context.tr('onb_consents_subtitle'),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Panel(
            child: Text(context.tr('privacy_summary'),
                style: RfType.body(size: 13, color: RfColors.textSoft, height: 1.5)),
          ),
          const SizedBox(height: 12),
          for (final scope in kConsentScopes)
            CheckboxListTile(
              value: _choices[scope],
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              onChanged: (v) => setState(() => _choices[scope] = v ?? false),
              title: Text(
                context.tr('consent_$scope') + (scope == 'cgu_confidentialite' ? ' *' : ''),
                style: RfType.body(size: 14, color: RfColors.text),
              ),
              subtitle: Text(context.tr('consent_${scope}_desc'),
                  style: RfType.body(size: 12, color: RfColors.textMuted)),
            ),
        ],
      ),
      actions: PillButton(
        label: context.tr('continue'),
        fontSize: 16,
        padding: const EdgeInsets.all(16),
        expand: true,
        busy: _busy,
        onPressed: cguOk ? _continue : null,
      ),
    );
  }
}
