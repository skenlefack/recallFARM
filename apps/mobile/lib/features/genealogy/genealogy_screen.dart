import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/inbreeding.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';

/// E16 — mating simulation & inbreeding, reproduced from MobileGenealogie.dc.html.
/// Uses `POST /mating-checks` online; computed locally (Wright) from the cached
/// pedigree (`dogs.sire_id/dam_id`) when offline or when the server is unreachable.
class GenealogyScreen extends ConsumerStatefulWidget {
  const GenealogyScreen({super.key, this.sireId, this.damId});
  final String? sireId;
  final String? damId;

  @override
  ConsumerState<GenealogyScreen> createState() => _GenealogyScreenState();
}

class _GenealogyScreenState extends ConsumerState<GenealogyScreen> {
  String? _sire;
  String? _dam;
  MatingCheckResult? _result;
  bool _local = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _sire = widget.sireId;
    _dam = widget.damId;
  }

  Map<String, PedigreeNode> _pedigree(List<Dog> dogs) => {
        for (final d in dogs) d.id: PedigreeNode(id: d.id, sireId: d.sireId, damId: d.damId, label: d.name),
      };

  Future<void> _compute(List<Dog> dogs) async {
    final sire = _sire;
    final dam = _dam;
    if (sire == null || dam == null) return;
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    final online = ref.read(connectivityProvider).online;
    MatingCheckResult? result;
    var local = false;
    if (online) {
      try {
        final r = await api.post('/mating-checks', {
          'id': Ids.newId(),
          'species': 'chien',
          'sire_type': 'dog',
          'sire_id': sire,
          'dam_type': 'dog',
          'dam_id': dam,
          'generations': 5,
        });
        result = MatingCheckResult.fromJson(r);
      } on ApiException catch (e) {
        if (e.isPlanRequired && mounted) showSnack(context, context.tr('feature_genealogie'));
      }
    }
    if (result == null) {
      result = Inbreeding(_pedigree(dogs)).check(sire, dam);
      local = true;
    }
    if (!mounted) return;
    setState(() {
      _result = result;
      _local = local;
      _busy = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final ent = ref.watch(entitlementsProvider);
    final dogsAsync = ref.watch(dogsProvider);
    final lang = context.lang;
    if (!ent.has('genealogie')) {
      return Scaffold(
        body: SafeArea(
          child: Column(children: [
            ScreenHeader(title: context.tr('simulate_mating')),
            LockedFeature(feature: 'genealogie', onUpgrade: () => context.push('/subscription')),
          ]),
        ),
      );
    }
    return Scaffold(
      body: SafeArea(
        child: AsyncBuilder<List<Dog>>(
          value: dogsAsync,
          builder: (dogs) {
            final males = dogs.where((d) => d.sex == 'M').toList();
            final females = dogs.where((d) => d.sex == 'F').toList();
            final byId = {for (final d in dogs) d.id: d};
            final sire = byId[_sire];
            final dam = byId[_dam];
            final breed = sire?.breed ?? dam?.breed;
            return Column(
              children: [
                ScreenHeader(
                  title: context.tr('simulate_mating'),
                  subtitle: [context.tr('dogs'), if (breed != null) breed].join(' · '),
                ),
                Expanded(
                  child: males.isEmpty || females.isEmpty
                      ? EmptyState(message: context.tr('genealogy_need_pair'))
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 16),
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: _parentCard(context, context.tr('sire'), sire, males, true, (v) {
                                    setState(() {
                                      _sire = v;
                                      _result = null;
                                    });
                                    _compute(dogs);
                                  }),
                                ),
                                SizedBox(
                                  width: 30,
                                  child: Text('×',
                                      textAlign: TextAlign.center, style: RfType.body(size: 16, color: RfColors.chevron)),
                                ),
                                Expanded(
                                  child: _parentCard(context, context.tr('dam'), dam, females, false, (v) {
                                    setState(() {
                                      _dam = v;
                                      _result = null;
                                    });
                                    _compute(dogs);
                                  }),
                                ),
                              ],
                            ),
                            const SizedBox(height: RfSpace.gap),
                            if (sire != null && dam != null) ...[
                              Panel(
                                radius: RfRadii.alertTile,
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                                child: Semantics(
                                  image: true,
                                  label: context.tr('pedigree_tree_label', {
                                    'sire': sire.name,
                                    'dam': dam.name,
                                    'common': (_result?.commonAncestors ?? const <String>[])
                                        .map((id) => byId[id]?.name ?? id)
                                        .join(', '),
                                  }),
                                  child: AspectRatio(
                                    aspectRatio: 330 / 250,
                                    child: CustomPaint(
                                      painter: PedigreePainter(
                                        sire: sire.id,
                                        dam: dam.id,
                                        nodes: _pedigree(dogs),
                                        common: (_result?.commonAncestors ?? const <String>[]).toSet(),
                                        litterLabel: context.tr('planned_litter'),
                                        commonLabel: context.tr('common_ancestor'),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: RfSpace.gap),
                              if (_busy) const LinearProgressIndicator(minHeight: 2),
                              if (_result != null) _gauge(context, _result!, byId, lang),
                            ] else
                              EmptyState(message: context.tr('pick_pair')),
                          ],
                        ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 14, RfSpace.gutter, 24),
                  child: Row(
                    children: [
                      Expanded(
                        child: PillButton(
                          label: context.tr('see_males'),
                          kind: PillKind.outline,
                          bold: false,
                          fontSize: 15,
                          padding: const EdgeInsets.all(14),
                          onPressed: dam == null ? null : () => _showUnrelated(context, dogs, dam, males),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: PillButton(
                          label: context.tr('plan'),
                          fontSize: 15,
                          padding: const EdgeInsets.all(14),
                          onPressed: _result == null ? null : () => showSnack(context, context.tr('v1_feature')),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _parentCard(BuildContext context, String role, Dog? dog, List<Dog> options, bool isSire,
      ValueChanged<String?> onPick) {
    final accent = isSire ? RfColors.cyan : RfColors.lime;
    return Semantics(
      button: true,
      label: '$role ${dog?.name ?? ''}',
      child: Material(
        color: isSire ? RfColors.sireBg : RfColors.damBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RfRadii.input),
          side: BorderSide(color: accent),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(RfRadii.input),
          onTap: () async {
            final picked = await showModalBottomSheet<String>(
              context: context,
              builder: (c) => ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.all(16),
                children: [
                  for (final d in options)
                    ListTile(
                      title: Text(d.name, style: RfType.body(size: 15, color: RfColors.text)),
                      subtitle: Text(d.breed ?? '', style: RfType.body(size: 12, color: RfColors.textMuted)),
                      onTap: () => Navigator.pop(c, d.id),
                    ),
                ],
              ),
            );
            if (picked != null) onPick(picked);
          },
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(role, style: RfType.body(size: 11, color: accent)),
                Text(dog?.name ?? context.tr('choose'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: RfType.body(size: 16, weight: FontWeight.w600, color: RfColors.text)),
                Text(
                  dog?.birthDate == null
                      ? ' '
                      : context.tr(isSire ? 'born_m' : 'born_f', {'y': dog!.birthDate!.substring(0, 4)}),
                  style: RfType.mono(size: 11, color: RfColors.textMuted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _gauge(BuildContext context, MatingCheckResult r, Map<String, Dog> byId, String lang) {
    final pct = r.expectedCoef * 100;
    final thresholdPct = r.threshold * 100;
    final position = (r.expectedCoef / r.threshold).clamp(0.0, 1.0).toDouble();
    final bad = r.verdict == 'a_eviter';
    final ok = r.verdict == 'ok';
    final border = bad ? RfColors.coral : (ok ? RfColors.lime : RfColors.amber);
    final common = r.commonAncestors.map((id) => byId[id]?.name ?? id).join(', ');
    final message = ok
        ? context.tr('verdict_ok')
        : (bad ? context.tr('verdict_bad', {'common': common}) : context.tr('verdict_attention', {'common': common}));
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ok ? RfColors.panel : RfColors.amberPanel,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(RfRadii.alertTile),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Expanded(
                child: Text(context.tr('inbreeding_coef'), style: RfType.body(size: 13, color: RfColors.amberText)),
              ),
              Text('${Fmt.dec(pct, lang, digits: 2)} %', style: RfType.mono(size: 26, color: RfColors.amberStrong)),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 16,
            child: LayoutBuilder(builder: (context, c) {
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: 0,
                    right: 0,
                    top: 4,
                    child: Container(
                      height: 8,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        gradient: const LinearGradient(
                          colors: [RfColors.lime, RfColors.lime, RfColors.amber, RfColors.amber],
                          stops: [0, 0.4, 0.4, 1],
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: (c.maxWidth * position - 1).clamp(0.0, c.maxWidth - 2).toDouble(),
                    top: 0,
                    child: Container(width: 2, height: 16, color: RfColors.amberStrong),
                  ),
                ],
              );
            }),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Text('0 %', style: RfType.mono(size: 10, color: RfColors.amberMuted)),
              const Spacer(),
              Text(context.tr('threshold_pct', {'v': Fmt.dec(thresholdPct, lang, digits: 2)}),
                  style: RfType.mono(size: 10, color: RfColors.amberMuted)),
            ],
          ),
          const SizedBox(height: 10),
          Text(message, style: RfType.body(size: 13, color: RfColors.amberText, height: 1.5)),
          if (!r.complete || _local) ...[
            const SizedBox(height: 6),
            Text(
              [
                if (!r.complete) context.tr('pedigree_incomplete'),
                if (_local) context.tr('computed_locally'),
              ].join(' · '),
              style: RfType.body(size: 11, color: RfColors.amberMuted),
            ),
          ],
        ],
      ),
    );
  }

  void _showUnrelated(BuildContext context, List<Dog> dogs, Dog dam, List<Dog> males) {
    final engine = Inbreeding(_pedigree(dogs));
    final scored = [
      for (final m in males) (m, engine.check(m.id, dam.id).expectedCoef),
    ]..sort((a, b) => a.$2.compareTo(b.$2));
    final lang = context.lang;
    showModalBottomSheet<void>(
      context: context,
      builder: (c) => ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(16),
        children: [
          Text(c.tr('males_by_coef'), style: RfType.title(size: 18, color: RfColors.text)),
          const SizedBox(height: 8),
          for (final s in scored)
            ListTile(
              title: Text(s.$1.name, style: RfType.body(size: 15, color: RfColors.text)),
              trailing: Text('${Fmt.dec(s.$2 * 100, lang, digits: 2)} %',
                  style: RfType.mono(size: 13, color: s.$2 == 0 ? RfColors.lime : RfColors.amber)),
              onTap: () {
                Navigator.pop(c);
                setState(() {
                  _sire = s.$1.id;
                  _result = null;
                });
                _compute(dogs);
              },
            ),
        ],
      ),
    );
  }
}

/// Pedigree tree over 3 generations (layout of the mock-up's 330×250 SVG).
class PedigreePainter extends CustomPainter {
  PedigreePainter({
    required this.sire,
    required this.dam,
    required this.nodes,
    required this.common,
    required this.litterLabel,
    required this.commonLabel,
  });

  final String sire;
  final String dam;
  final Map<String, PedigreeNode> nodes;
  final Set<String> common;
  final String litterLabel;
  final String commonLabel;

  String? _parent(String? id, bool father) {
    if (id == null) return null;
    final n = nodes[id];
    return father ? n?.sireId : n?.damId;
  }

  void _text(Canvas c, String s, Offset center, Color color, {double size = 10, String family = 'monospace'}) {
    final tp = TextPainter(
      text: TextSpan(text: s, style: TextStyle(color: color, fontSize: size, fontFamily: family)),
      textDirection: ui.TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: 76);
    tp.paint(c, center - Offset(tp.width / 2, tp.height / 2));
  }

  void _box(Canvas c, String? id, double cx, double top, double w, double h, double r,
      {Color fill = RfColors.panel2, Color stroke = RfColors.border, Color text = RfColors.text}) {
    final isCommon = id != null && common.contains(id);
    final rect = RRect.fromRectAndRadius(Rect.fromLTWH(cx - w / 2, top, w, h), Radius.circular(r));
    c.drawRRect(rect, Paint()..color = isCommon ? RfColors.ancestorBg : fill);
    c.drawRRect(
      rect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = isCommon ? RfColors.coral : stroke,
    );
    final label = id == null ? '?' : (nodes[id]?.label ?? id);
    _text(c, label.length > 7 ? '${label.substring(0, 6)}…' : label, Offset(cx, top + h / 2),
        isCommon ? RfColors.ancestorText : (id == null ? RfColors.textMuted : text));
  }

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 330, size.height / 250);
    final line = Paint()
      ..color = RfColors.border
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    // Connectors (same geometry as the mock-up).
    final p = Path()
      ..moveTo(165, 228)
      ..lineTo(165, 206)
      ..moveTo(82, 206)
      ..lineTo(248, 206)
      ..moveTo(82, 206)
      ..lineTo(82, 182)
      ..moveTo(248, 206)
      ..lineTo(248, 182);
    for (final x in const [82.0, 248.0]) {
      p
        ..moveTo(x, 160)
        ..lineTo(x, 140)
        ..moveTo(x - 40, 140)
        ..lineTo(x + 40, 140)
        ..moveTo(x - 40, 140)
        ..lineTo(x - 40, 118)
        ..moveTo(x + 40, 140)
        ..lineTo(x + 40, 118);
    }
    for (final x in const [42.0, 122.0, 208.0, 288.0]) {
      p
        ..moveTo(x, 96)
        ..lineTo(x, 76)
        ..moveTo(x - 20, 76)
        ..lineTo(x + 20, 76)
        ..moveTo(x - 20, 76)
        ..lineTo(x - 20, 58)
        ..moveTo(x + 20, 76)
        ..lineTo(x + 20, 58);
    }
    canvas.drawPath(p, line);

    final gp = <String?>[
      _parent(sire, true),
      _parent(sire, false),
      _parent(dam, true),
      _parent(dam, false),
    ];
    final ggp = <String?>[for (final g in gp) ...[_parent(g, true), _parent(g, false)]];
    const ggX = [22.0, 62.0, 102.0, 142.0, 188.0, 228.0, 268.0, 308.0];
    const gX = [42.0, 122.0, 208.0, 288.0];

    // Dashed arc between duplicate common ancestors among great-grandparents.
    final positions = <String, List<double>>{};
    for (var i = 0; i < 8; i++) {
      final id = ggp[i];
      if (id != null && common.contains(id)) positions.putIfAbsent(id, () => []).add(ggX[i]);
    }
    var labelled = false;
    for (final xs in positions.values) {
      if (xs.length < 2) continue;
      final arc = Path()
        ..moveTo(xs.first, 58)
        ..cubicTo(xs.first, 20, xs.last, 20, xs.last, 58);
      final coral = Paint()
        ..color = RfColors.coral
        ..strokeWidth = 1.4
        ..style = PaintingStyle.stroke;
      for (final m in arc.computeMetrics()) {
        var d = 0.0;
        while (d < m.length) {
          canvas.drawPath(m.extractPath(d, d + 4), coral);
          d += 8;
        }
      }
      if (!labelled) {
        _text(canvas, commonLabel, Offset((xs.first + xs.last) / 2, 16), RfColors.coral, size: 11, family: 'sans-serif');
        labelled = true;
      }
    }

    for (var i = 0; i < 8; i++) {
      _box(canvas, ggp[i], ggX[i], 40, 36, 18, 6, text: RfColors.textMuted);
    }
    for (var i = 0; i < 4; i++) {
      _box(canvas, gp[i], gX[i], 96, 44, 22, 7);
    }
    _box(canvas, sire, 82, 160, 60, 22, 7, fill: RfColors.sireBg, stroke: RfColors.cyan);
    _box(canvas, dam, 248, 160, 60, 22, 7, fill: RfColors.damBg, stroke: RfColors.lime);
    final litter = RRect.fromRectAndRadius(const Rect.fromLTWH(125, 228, 80, 20), const Radius.circular(10));
    canvas.drawRRect(litter, Paint()..color = RfColors.lime);
    _text(canvas, litterLabel, const Offset(165, 238), RfColors.bg);
    canvas.restore();
  }

  @override
  bool shouldRepaint(PedigreePainter old) =>
      old.sire != sire || old.dam != dam || old.common.length != common.length || old.nodes.length != nodes.length;
}
