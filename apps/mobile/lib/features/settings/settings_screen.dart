import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_config.dart';
import '../../core/data/providers.dart';
import '../../core/db/local_db.dart';
import '../../core/i18n/strings.dart';
import '../../core/sync/sync_engine.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';

final _rejectedProvider = FutureProvider.autoDispose<List<OutboxEntry>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(localDbProvider).rejectedEntries();
});

/// Settings: language, sync status (pending, last sync, rejected), notifications, logout.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final sync = ref.watch(syncEngineProvider);
    final rejected = ref.watch(_rejectedProvider).valueOrNull ?? const <OutboxEntry>[];
    final ent = ref.watch(entitlementsProvider).state;
    final lang = context.lang;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('settings')),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                children: [
                  SectionLabel(context.tr('language')),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      RfChip(label: 'Français', selected: lang == 'fr', onTap: () => _setLang(ref, 'fr')),
                      RfChip(label: 'English', selected: lang == 'en', onTap: () => _setLang(ref, 'en')),
                    ],
                  ),
                  const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('sync_status')),
                  const SizedBox(height: 8),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          context.tr('sync_phase_${sync.phase.name}'),
                          style: RfType.body(
                            size: 15,
                            weight: FontWeight.w600,
                            color: sync.phase == SyncPhase.error ? RfColors.coral : RfColors.text,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          [
                            context.tr('pending_n', {'n': sync.pending}),
                            sync.lastSyncAt == null
                                ? context.tr('never_synced')
                                : context.tr('last_sync', {
                                    'date': Fmt.date(sync.lastSyncAt!.toIso8601String(), lang),
                                    'time': Fmt.time(sync.lastSyncAt!, lang),
                                  }),
                          ].join(' · '),
                          style: RfType.body(size: 13, color: RfColors.textMuted),
                        ),
                        if (sync.lastError != null)
                          Text(sync.lastError!, style: RfType.mono(size: 11, color: RfColors.coral)),
                        if (!session.isAuthenticated)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(context.tr('provisional_account_hint'),
                                style: RfType.body(size: 12, color: RfColors.amber)),
                          ),
                        const SizedBox(height: 10),
                        PillButton(
                          label: context.tr('sync_now'),
                          kind: PillKind.outline,
                          busy: sync.phase == SyncPhase.syncing,
                          onPressed: () => ref.read(syncEngineProvider).sync(manual: true),
                        ),
                      ],
                    ),
                  ),
                  if (rejected.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Panel(
                      borderColor: RfColors.coral,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(context.tr('rejected_n', {'n': rejected.length}),
                              style: RfType.body(size: 14, color: RfColors.coral)),
                          for (final r in rejected.take(5))
                            Text('${r.entity} · ${r.lastError ?? ''}',
                                style: RfType.mono(size: 11, color: RfColors.textMuted)),
                          TextButton(
                            onPressed: () async {
                              await ref.read(localDbProvider).retryRejected();
                              await ref.read(syncEngineProvider).sync(manual: true);
                            },
                            child: Text(context.tr('retry')),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('notifications')),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(context.tr('allow_notifications'), style: RfType.body(size: 14, color: RfColors.text)),
                    subtitle: Text(context.tr('notifications_desc'),
                        style: RfType.body(size: 12, color: RfColors.textMuted)),
                    trailing: const Icon(Icons.notifications_active_outlined, color: RfColors.lime),
                    onTap: () => ref.read(notificationServiceProvider).requestPermission(),
                  ),
                  const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('account')),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(session.name ?? session.phone ?? '—', style: RfType.body(size: 14, color: RfColors.text)),
                    subtitle: Text(
                      '${session.phone ?? ''} · ${context.tr('plan_${ent.plan}')}',
                      style: RfType.body(size: 12, color: RfColors.textMuted),
                    ),
                  ),
                  Text('API ${AppConfig.apiBaseUrl}', style: RfType.mono(size: 10, color: RfColors.textMuted)),
                  const SizedBox(height: RfSpace.gap),
                  PillButton(
                    label: context.tr('logout'),
                    kind: PillKind.outlineCoral,
                    onPressed: () => _logout(context, ref),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _setLang(WidgetRef ref, String lang) async {
    final session = ref.read(sessionProvider);
    final api = ref.read(apiClientProvider);
    await session.setLanguage(lang);
    if (session.isAuthenticated) {
      try {
        await api.patch('/me', {'language': lang});
      } catch (_) {
        // retried implicitly at next /me refresh
      }
    }
  }

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final session = ref.read(sessionProvider);
    final ent = ref.read(entitlementsProvider);
    final pending = ref.read(syncEngineProvider).pending;
    final router = GoRouter.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(c.tr('logout')),
        content: Text(pending > 0 ? c.tr('logout_pending_warning', {'n': pending}) : c.tr('logout_confirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(c.tr('cancel'))),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(c.tr('logout'))),
        ],
      ),
    );
    if (ok != true) return;
    await ent.clear();
    await session.signOut();
    router.go('/onboarding/speculation');
  }
}
