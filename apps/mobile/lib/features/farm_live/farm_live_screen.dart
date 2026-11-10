import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/data/providers.dart';
import '../../core/db/local_db.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';

/// Last `GET /farms/:id/live` response cached for offline display.
Future<List<Map<String, dynamic>>> cachedLiveTiles(LocalDb db, String farmId) async {
  final j = await db.getKvJson('live.$farmId');
  final tiles = j?['data'] is Map ? (j!['data'] as Map)['tiles'] : null;
  return [
    for (final t in (tiles is List ? tiles : const []))
      if (t is Map) Map<String, dynamic>.from(t)
  ];
}

class LiveSnapshot {
  LiveSnapshot({required this.data, required this.fetchedAt, required this.fromCache});
  final Map<String, dynamic> data;
  final DateTime fetchedAt;
  final bool fromCache;

  Map<String, dynamic> get gateway => ApiClient.asMap(data['gateway']);
  List<Map<String, dynamic>> get tiles => [
        for (final t in (data['tiles'] is List ? data['tiles'] as List : const []))
          if (t is Map) Map<String, dynamic>.from(t)
      ];
}

/// Polls `GET /farms/:farmId/live` every 30 s while visible; falls back to cache.
final liveProvider = StreamProvider.autoDispose<LiveSnapshot?>((ref) async* {
  final farmId = ref.watch(sessionProvider.select((s) => s.farmId));
  if (farmId == null) {
    yield null;
    return;
  }
  final db = ref.read(localDbProvider);
  final api = ref.read(apiClientProvider);
  final cached = await db.getKvJson('live.$farmId');
  if (cached != null && cached['data'] is Map) {
    yield LiveSnapshot(
      data: Map<String, dynamic>.from(cached['data'] as Map),
      fetchedAt: DateTime.tryParse(cached['at']?.toString() ?? '') ?? DateTime.now(),
      fromCache: true,
    );
  }
  var alive = true;
  ref.onDispose(() => alive = false);
  while (alive) {
    try {
      final data = await api.get('/farms/$farmId/live');
      final now = DateTime.now();
      await db.setKvJson('live.$farmId', {'data': data, 'at': now.toUtc().toIso8601String()});
      yield LiveSnapshot(data: data, fetchedAt: now, fromCache: false);
    } on ApiException catch (e) {
      if (cached == null && !e.isNetwork) {
        yield LiveSnapshot(data: const {}, fetchedAt: DateTime.now(), fromCache: true);
      }
    }
    await Future<void>.delayed(const Duration(seconds: 30));
  }
});

String timeAgo(BuildContext context, DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inSeconds < 60) return context.tr('ago_s', {'n': d.inSeconds < 0 ? 0 : d.inSeconds});
  if (d.inMinutes < 60) return context.tr('ago_min', {'n': d.inMinutes});
  if (d.inHours < 24) return context.tr('ago_h', {'n': d.inHours});
  return context.tr('ago_d', {'n': d.inDays});
}

/// Threshold from the tile, or from the sensor profile default alert (`reading.value > 32`).
double? thresholdFor(Map<String, dynamic> tile, Resolution? res) {
  final t = tile['threshold'];
  if (t is num) return t.toDouble();
  if (res == null) return null;
  for (final p in res.ofKind('sensor_profile')) {
    if (p['metric'] != tile['metric']) continue;
    final when = (p['default_alert'] is Map ? (p['default_alert'] as Map)['when'] : null)?.toString();
    final m = when == null ? null : RegExp(r'reading\.value\s*[<>]=?\s*([0-9.]+)').firstMatch(when);
    if (m != null) return double.tryParse(m.group(1)!);
  }
  return null;
}

/// E70 — « Ma ferme en direct », reproduced from MobileFerme.dc.html.
class FarmLiveScreen extends ConsumerWidget {
  const FarmLiveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = ref.watch(liveProvider);
    final res = ref.watch(resolutionProvider).valueOrNull;
    final lang = context.lang;
    return ListView(
      padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 10, RfSpace.gutter, 24),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(context.tr('connected_farm'), style: RfType.body(size: 13, color: RfColors.textMuted)),
                  const SizedBox(height: 4),
                  Semantics(
                    header: true,
                    child: Text(context.tr('live'), style: RfType.title(size: 27, color: RfColors.text)),
                  ),
                ],
              ),
            ),
            TextButton(onPressed: () => context.push('/alerts'), child: Text(context.tr('alerts'))),
          ],
        ),
        const SizedBox(height: 14),
        AsyncBuilder<LiveSnapshot?>(
          value: live,
          loading: const SkeletonList(rows: 3),
          builder: (snap) {
            if (snap == null || snap.tiles.isEmpty) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (snap != null) _gateway(context, snap),
                  EmptyState(message: context.tr('live_empty')),
                ],
              );
            }
            final alerting = snap.tiles.where((t) => t['status'] == 'attention' || t['status'] == 'critique').toList();
            final others = snap.tiles.where((t) => !alerting.contains(t)).toList();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _gateway(context, snap),
                const SizedBox(height: 14),
                for (final t in alerting) ...[
                  _AlertTile(tile: t, threshold: thresholdFor(t, res), lang: lang),
                  const SizedBox(height: 14),
                ],
                LayoutBuilder(builder: (context, c) {
                  final cols = c.maxWidth > 300 ? 2 : 1;
                  final w = (c.maxWidth - (cols - 1) * 10) / cols;
                  return Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [for (final t in others) SizedBox(width: w, child: _SensorTile(tile: t, lang: lang))],
                  );
                }),
                const SizedBox(height: 14),
                const _CameraPlaceholder(),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _gateway(BuildContext context, LiveSnapshot snap) {
    final g = snap.gateway;
    final online = g['online'] == true && !snap.fromCache;
    final lastSeen = DateTime.tryParse(g['last_seen']?.toString() ?? '') ?? snap.fetchedAt;
    return Panel(
      radius: RfRadii.input,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: online ? RfColors.lime : RfColors.amber, shape: BoxShape.circle),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              context.tr(online ? 'gateway_online' : 'gateway_offline', {'n': snap.tiles.length}),
              style: RfType.body(size: 13, color: RfColors.text),
            ),
          ),
          Text(timeAgo(context, lastSeen.toLocal()), style: RfType.mono(size: 12, color: RfColors.textMuted)),
        ],
      ),
    );
  }
}

List<double> _series(Map<String, dynamic> t) => [
      for (final p in (t['series'] is List ? t['series'] as List : const []))
        if (p is num)
          p.toDouble()
        else if (p is Map && p['value'] is num)
          (p['value'] as num).toDouble()
    ];

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.tile, required this.threshold, required this.lang});
  final Map<String, dynamic> tile;
  final double? threshold;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final critical = tile['status'] == 'critique';
    final accent = critical ? RfColors.coral : RfColors.amber;
    final value = tile['value'] is num ? (tile['value'] as num).toDouble() : null;
    final unit = (tile['unit'] ?? '').toString();
    final series = _series(tile);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RfColors.amberPanel,
        border: Border.all(color: accent),
        borderRadius: BorderRadius.circular(RfRadii.alertTile),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${tile['name'] ?? ''} · ${context.tr('metric_${tile['metric']}')}',
                  style: RfType.body(size: 13, color: RfColors.amberText),
                ),
              ),
              Text(context.tr(critical ? 'status_critique' : 'status_attention'),
                  style: RfType.body(size: 13, weight: FontWeight.w600, color: accent)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(Fmt.number(value, lang, maxDigits: 1), style: RfType.mono(size: 40, color: RfColors.amberStrong)),
              const SizedBox(width: 8),
              Text(unit == 'C' ? '°C' : unit, style: RfType.body(size: 14, color: RfColors.amberText)),
              const Spacer(),
              if (threshold != null)
                Flexible(
                  child: Text(
                    context.tr('threshold_value', {'v': Fmt.number(threshold, lang), 'unit': unit == 'C' ? '°C' : unit}),
                    textAlign: TextAlign.end,
                    style: RfType.body(size: 12, color: RfColors.amberText),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Semantics(
            label: context.tr('chart_trend', {'from': Fmt.number(series.isEmpty ? null : series.first, lang), 'to': Fmt.number(value, lang)}),
            child: Sparkline(values: series, color: accent, height: 70, fill: true, threshold: threshold, strokeWidth: 1.8),
          ),
          const SizedBox(height: 10),
          PillButton(
            label: context.tr('act_on_device'),
            kind: critical ? PillKind.coral : PillKind.amber,
            onPressed: () => showSnack(context, context.tr('v3_feature')),
          ),
        ],
      ),
    );
  }
}

class _SensorTile extends StatelessWidget {
  const _SensorTile({required this.tile, required this.lang});
  final Map<String, dynamic> tile;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final value = tile['value'] is num ? tile['value'] as num : null;
    final unit = (tile['unit'] ?? '').toString();
    final metric = tile['metric']?.toString() ?? '';
    final status = tile['status']?.toString() ?? 'normal';
    final isLevel = unit == '%';
    final isWater = metric == 'water' || metric == 'water_flow';
    String shownUnit = unit == 'C' ? '°' : unit;
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text((tile['name'] ?? context.tr('metric_$metric')).toString(),
              style: RfType.body(size: 12, color: RfColors.textMuted)),
          const SizedBox(height: 6),
          Text.rich(TextSpan(children: [
            TextSpan(text: Fmt.number(value, lang, maxDigits: 1), style: RfType.mono(size: 24, color: RfColors.text)),
            TextSpan(
              text: shownUnit == '°' ? '°' : ' $shownUnit',
              style: shownUnit == '°'
                  ? RfType.mono(size: 24, color: RfColors.text)
                  : RfType.mono(size: 13, color: RfColors.textMuted),
            ),
          ])),
          const SizedBox(height: 6),
          if (isLevel)
            ClipRRect(
              borderRadius: BorderRadius.circular(5),
              child: LinearProgressIndicator(
                value: ((value ?? 0) / 100).clamp(0, 1).toDouble(),
                minHeight: 5,
                color: RfColors.cyan,
                backgroundColor: RfColors.lineSoft,
              ),
            )
          else if (isWater)
            Text(context.tr('auto_reported_journal'), style: RfType.body(size: 11, color: RfColors.textMuted))
          else
            Text(
              context.tr('status_$status'),
              style: RfType.body(
                size: 11,
                color: status == 'normal' || status == 'ok'
                    ? RfColors.lime
                    : (status == 'critique' ? RfColors.coral : RfColors.amber),
              ),
            ),
        ],
      ),
    );
  }
}

class _CameraPlaceholder extends StatelessWidget {
  const _CameraPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: context.tr('camera_gate'),
      child: InkWell(
        onTap: () => showSnack(context, context.tr('camera_v2')),
        borderRadius: BorderRadius.circular(RfRadii.tile),
        child: Container(
          height: 112,
          decoration: BoxDecoration(
            color: RfColors.panelDeep,
            border: Border.all(color: RfColors.lineSoft),
            borderRadius: BorderRadius.circular(RfRadii.tile),
          ),
          child: Stack(
            children: [
              const Positioned.fill(child: CustomPaint(painter: _GridPainter())),
              Positioned(
                left: 12,
                bottom: 12,
                child: Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: const BoxDecoration(color: RfColors.coral, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                    Text(context.tr('camera_gate'), style: RfType.body(size: 12, color: RfColors.text)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GridPainter extends CustomPainter {
  const _GridPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = RfColors.gridLine
      ..strokeWidth = 1;
    for (final f in const [1 / 3, 2 / 3]) {
      canvas.drawLine(Offset(0, size.height * f), Offset(size.width, size.height * f), p);
      canvas.drawLine(Offset(size.width * f, 0), Offset(size.width * f, size.height), p);
    }
  }

  @override
  bool shouldRepaint(_GridPainter oldDelegate) => false;
}
