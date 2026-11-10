import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import 'alert_actions.dart';

/// E72 — alerts list (severity, rule, value, since, status, escalation level).
class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      try {
        await AlertActions(ref).refresh();
      } catch (_) {
        // offline: local rows are shown
      }
    });
  }

  Color _severityColor(String? s) => s == 'critique' ? RfColors.coral : (s == 'attention' ? RfColors.amber : RfColors.cyan);

  Future<void> _resolve(Map<String, dynamic> alert) async {
    final cause = TextEditingController();
    final action = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(c.tr('resolve_alert')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: cause, decoration: InputDecoration(labelText: '${c.tr('cause')} *')),
            const SizedBox(height: 10),
            TextField(controller: action, decoration: InputDecoration(labelText: '${c.tr('action_taken')} *')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(c.tr('cancel'))),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(c.tr('confirm'))),
        ],
      ),
    );
    final causeText = cause.text.trim();
    final actionText = action.text.trim();
    // Controllers are left to the GC: the dialog may still be animating out.
    if (ok != true) return;
    if (!mounted) return;
    if (causeText.isEmpty || (alert['severity'] == 'critique' && actionText.isEmpty)) {
      showSnack(context, context.tr('err_required'));
      return;
    }
    await AlertActions(ref).resolve(alert, causeText, actionText);
  }

  @override
  Widget build(BuildContext context) {
    final alerts = ref.watch(alertsProvider);
    final lang = context.lang;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('alerts'), subtitle: context.tr('alerts_subtitle')),
            Expanded(
              child: AsyncBuilder<List<Map<String, dynamic>>>(
                value: alerts,
                builder: (list) {
                  if (list.isEmpty) return EmptyState(message: context.tr('alerts_empty'));
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, i) {
                      final a = list[i];
                      final sev = a['severity']?.toString();
                      final status = a['status']?.toString() ?? 'ouverte';
                      final open = status == 'ouverte' || status == 'escaladee';
                      final escalation = a['escalation'] is List ? (a['escalation'] as List) : const [];
                      final level = escalation.where((e) => e is Map && e['done'] == true).length;
                      return Panel(
                        borderColor: open ? _severityColor(sev) : RfColors.line,
                        onTap: sev == 'critique' && open ? () => context.push('/alerts/${a['id']}/critical') : null,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: BoxDecoration(color: _severityColor(sev), shape: BoxShape.circle),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    (a['title'] ?? a['rule'] ?? context.tr('alert')).toString(),
                                    style: RfType.body(size: 15, weight: FontWeight.w600, color: RfColors.text),
                                  ),
                                ),
                                Text(context.tr('alert_status_$status'),
                                    style: RfType.body(size: 12, color: RfColors.textMuted)),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              [
                                if (a['value'] != null) '${a['value']} ${a['unit'] ?? ''}'.trim(),
                                if (a['opened_at'] != null)
                                  Fmt.date(a['opened_at'].toString().substring(0, 10), lang),
                                if (level > 0) context.tr('escalation_level', {'n': level}),
                              ].join(' · '),
                              style: RfType.mono(size: 12, color: RfColors.textMuted),
                            ),
                            if (open) ...[
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                children: [
                                  PillButton(
                                    label: context.tr('acknowledge'),
                                    kind: sev == 'critique' ? PillKind.coral : PillKind.amber,
                                    onPressed: () => AlertActions(ref).ack(a),
                                  ),
                                  PillButton(
                                    label: context.tr('resolve'),
                                    kind: PillKind.outline,
                                    bold: false,
                                    onPressed: () => _resolve(a),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
