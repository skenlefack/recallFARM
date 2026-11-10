import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/glyphs.dart';
import 'alert_actions.dart';

final _alertProvider = FutureProvider.autoDispose.family<Map<String, dynamic>?, String>((ref, id) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).alert(id);
});

/// Critical alert, full screen coral — reproduced from MobileAlerte.dc.html.
class CriticalAlertScreen extends ConsumerStatefulWidget {
  const CriticalAlertScreen({super.key, required this.alertId});
  final String alertId;

  @override
  ConsumerState<CriticalAlertScreen> createState() => _CriticalAlertScreenState();
}

class _CriticalAlertScreenState extends ConsumerState<CriticalAlertScreen> {
  bool _busy = false;

  Future<void> _ack(Map<String, dynamic> alert) async {
    setState(() => _busy = true);
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final msg = context.tr('ack_recorded');
    try {
      await AlertActions(ref).ack(alert);
      messenger.showSnackBar(SnackBar(content: Text(msg)));
      if (router.canPop()) {
        router.pop();
      } else {
        router.go('/farm-live');
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final alertAsync = ref.watch(_alertProvider(widget.alertId));
    final lang = context.lang;
    return Theme(
      data: Theme.of(context).copyWith(scaffoldBackgroundColor: RfColors.alertBg),
      child: Scaffold(
        backgroundColor: RfColors.alertBg,
        body: AsyncBuilder<Map<String, dynamic>?>(
          value: alertAsync,
          builder: (alert) {
            if (alert == null) {
              return SafeArea(
                child: Column(children: [
                  ScreenHeader(title: context.tr('alert'), color: RfColors.alertText),
                  EmptyState(message: context.tr('not_found')),
                ]),
              );
            }
            final escalation = [
              for (final e in (alert['escalation'] is List ? alert['escalation'] as List : const []))
                if (e is Map) Map<String, dynamic>.from(e)
            ];
            final level = escalation.where((e) => e['done'] == true).length;
            final value = alert['value'];
            final unit = (alert['unit'] ?? '').toString();
            final place = (alert['housing_name'] ?? alert['device_name'] ?? alert['title'] ?? '').toString();
            final since = alert['duration_min'] ?? alert['for_min'];
            final headline = value is num
                ? '$place :\n${Fmt.number(value, lang, maxDigits: 1)} ${unit == 'C' ? '°C' : unit}'
                    '${since == null ? '' : ' ${context.tr('since_min', {'n': since})}'}'
                : (alert['title'] ?? context.tr('critical_alert')).toString();
            return Stack(
              children: [
                const Positioned.fill(child: CustomPaint(painter: _RingsPainter())),
                SafeArea(
                  child: LayoutBuilder(builder: (context, c) {
                    return SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 24, 24, 30),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(minHeight: c.maxHeight - 54),
                        child: IntrinsicHeight(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                context.tr('critical_alert_level', {'n': level == 0 ? 1 : level}).toUpperCase(),
                                textAlign: TextAlign.center,
                                style: RfType.mono(size: 12, color: RfColors.coral, letterSpacing: 0.96),
                              ),
                              const SizedBox(height: 60),
                              Center(
                                child: Container(
                                  width: 120,
                                  height: 120,
                                  decoration: const BoxDecoration(color: RfColors.coral, shape: BoxShape.circle),
                                  child: const Center(
                                    child: RfGlyph(Glyph.flame, size: 52, color: RfColors.alertBg, strokeWidth: 2.5),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 50),
                              Semantics(
                                header: true,
                                liveRegion: true,
                                child: Text(
                                  headline,
                                  textAlign: TextAlign.center,
                                  style: RfType.title(size: 32, weight: FontWeight.w800, color: RfColors.alertText)
                                      .copyWith(height: 1.1),
                                ),
                              ),
                              const SizedBox(height: 8),
                              if (alert['message'] != null)
                                Text(
                                  alert['message'].toString(),
                                  textAlign: TextAlign.center,
                                  style: RfType.body(size: 15, color: RfColors.alertMuted, height: 1.5),
                                ),
                              const SizedBox(height: 18),
                              if (escalation.isNotEmpty) _EscalationPanel(items: escalation, lang: lang),
                              const Spacer(),
                              const SizedBox(height: 18),
                              PillButton(
                                label: context.tr('take_charge'),
                                kind: PillKind.coral,
                                fontSize: 17,
                                padding: const EdgeInsets.all(17),
                                busy: _busy,
                                onPressed: () => _ack(alert),
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(child: _callButton(context, escalation)),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: PillButton(
                                      label: context.tr('see_camera'),
                                      kind: PillKind.outlineCoral,
                                      bold: false,
                                      padding: const EdgeInsets.all(13),
                                      onPressed: () => showSnack(context, context.tr('camera_v2')),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _callButton(BuildContext context, List<Map<String, dynamic>> escalation) {
    Map<String, dynamic>? next;
    for (final e in escalation) {
      if (e['done'] != true && e['phone'] != null) {
        next = e;
        break;
      }
    }
    final target = next;
    final name = (target?['name'] ?? target?['target'] ?? '').toString();
    return PillButton(
      label: name.isEmpty ? context.tr('call') : context.tr('call_name', {'name': name}),
      kind: PillKind.outlineCoral,
      bold: false,
      padding: const EdgeInsets.all(13),
      onPressed: target == null
          ? null
          : () => launchUrl(Uri(scheme: 'tel', path: target['phone'].toString())),
    );
  }
}

class _EscalationPanel extends StatelessWidget {
  const _EscalationPanel({required this.items, required this.lang});
  final List<Map<String, dynamic>> items;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    DateTime? at(Map<String, dynamic> e) => DateTime.tryParse(e['at']?.toString() ?? '')?.toLocal();
    final first = at(items.first);
    final last = at(items.last);
    double progress = 0;
    if (first != null && last != null && last.isAfter(first)) {
      progress = (now.difference(first).inSeconds / last.difference(first).inSeconds).clamp(0.0, 1.0).toDouble();
    }
    String who(Map<String, dynamic> e) {
      final target = (e['target'] ?? '').toString();
      if (target == 'owner' || target == 'proprietaire' || e['is_me'] == true) return context.tr('you');
      final name = e['name']?.toString();
      return name == null ? target : '${context.tr('role_$target')} : $name';
    }

    String when(Map<String, dynamic> e) {
      final t = at(e);
      if (e['done'] == true) {
        return context.tr('notified_at', {'time': t == null ? '' : Fmt.time(t, lang)});
      }
      if (t == null) return '';
      final mins = t.difference(now).inMinutes;
      return context.tr('in_min', {'n': mins < 0 ? 0 : mins});
    }

    final rows = <Widget>[];
    for (var i = 0; i < items.length; i++) {
      final e = items[i];
      final done = e['done'] == true;
      final color = i == 0 ? RfColors.alertText : (done ? RfColors.alertMuted : (i >= 2 ? RfColors.alertFaint : RfColors.alertMuted));
      rows.add(Row(
        children: [
          Expanded(child: Text(who(e), style: RfType.body(size: 13, color: color))),
          Text(when(e), style: RfType.mono(size: 13, color: done ? RfColors.coral : color)),
        ],
      ));
      if (i == 1 || (items.length == 1 && i == 0)) {
        rows.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 4,
              color: RfColors.coral,
              backgroundColor: RfColors.alertTrack,
            ),
          ),
        ));
      }
    }
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: RfColors.coral.withValues(alpha: 0.08),
        border: Border.all(color: RfColors.alertLine),
        borderRadius: BorderRadius.circular(RfRadii.tile),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const SizedBox(height: 8),
            rows[i],
          ],
        ],
      ),
    );
  }
}

/// Concentric coral rings centred on the alert badge (MobileAlerte background).
class _RingsPainter extends CustomPainter {
  const _RingsPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 390;
    final center = Offset(195 * sx, 250 * (size.height / 844));
    const rings = [(70.0, 0.5), (110.0, 0.28), (155.0, 0.14), (205.0, 0.07)];
    for (final r in rings) {
      canvas.drawCircle(
        center,
        r.$1 * sx,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = RfColors.coral.withValues(alpha: r.$2),
      );
    }
  }

  @override
  bool shouldRepaint(_RingsPainter oldDelegate) => false;
}
