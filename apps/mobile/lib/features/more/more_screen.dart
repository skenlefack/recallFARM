import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/widgets/common.dart';

String? _lockedLabel(BuildContext context, String? feature, bool Function(String) has) =>
    feature != null && !has(feature) ? context.tr('pro_badge') : null;

/// E60 — « Plus » menu.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ent = ref.watch(entitlementsProvider).state;
    final specs = ref.watch(sessionProvider.select((s) => s.speculations));
    final items = <(String, String, IconData, String?)>[
      ('health', '/health', Icons.vaccines_outlined, null),
      ('tasks', '/tasks', Icons.check_circle_outline, null),
      ('stocks', '/stocks', Icons.inventory_2_outlined, null),
      ('sales', '/sales', Icons.sell_outlined, null),
      ('expenses', '/expenses', Icons.receipt_long_outlined, null),
      ('alerts', '/alerts', Icons.notification_important_outlined, null),
      if (specs.contains('chien')) ('genealogy', '/genealogy', Icons.account_tree_outlined, 'genealogie'),
      ('plans', '/subscription', Icons.workspace_premium_outlined, null),
      ('my_data', '/my-data', Icons.privacy_tip_outlined, null),
      ('settings', '/settings', Icons.settings_outlined, null),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 10, RfSpace.gutter, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(context.tr('nav_more'), style: RfType.title(size: 27, color: RfColors.text)),
              ),
            ),
            const ConnectionBadge(),
          ],
        ),
        const SizedBox(height: 6),
        Text(context.tr('current_plan', {'plan': context.tr('plan_${ent.plan}')}),
            style: RfType.body(size: 13, color: RfColors.textMuted)),
        const SizedBox(height: RfSpace.gap),
        for (final it in items)
          ChevronRow(
            title: context.tr(it.$1),
            subtitle: _lockedLabel(context, it.$4, ent.has),
            onTap: () => context.push(it.$2),
            leading: null,
          ),
        const SizedBox(height: RfSpace.gap),
        const PendingSyncBanner(),
      ],
    );
  }
}
