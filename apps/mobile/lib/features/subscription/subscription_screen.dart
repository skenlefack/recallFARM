import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/data/providers.dart';
import '../../core/entitlements/entitlements.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../home/home_data.dart' show currencyOf;

/// A plan card model built from `GET /plans?country=` or, offline, from the
/// resolved packs (`plan` + `plan_price`).
class PlanInfo {
  PlanInfo({required this.code, required this.monthlyMinor, required this.yearlyMinor, required this.features});
  final String code;
  final int? monthlyMinor;
  final int? yearlyMinor;
  final List<String> features;

  static List<PlanInfo> fromPacks(Resolution res) {
    final out = <PlanInfo>[];
    for (final code in const ['decouverte', 'pro', 'structure']) {
      final p = res.get('plan', code);
      if (p == null) continue;
      final price = res.get('plan_price', code);
      out.add(PlanInfo(
        code: code,
        monthlyMinor: code == 'decouverte' ? 0 : (price?['monthly_minor'] as num?)?.toInt(),
        yearlyMinor: code == 'decouverte' ? 0 : (price?['yearly_minor'] as num?)?.toInt(),
        features: [for (final f in (p['features'] as List? ?? const [])) f.toString()],
      ));
    }
    return out;
  }

  static List<PlanInfo> fromApi(List<Map<String, dynamic>> rows) => [
        for (final r in rows)
          PlanInfo(
            code: (r['code'] ?? r['plan']).toString(),
            monthlyMinor: _minor(r['monthly'] ?? r['price_monthly'] ?? r['monthly_minor']),
            yearlyMinor: _minor(r['yearly'] ?? r['price_yearly'] ?? r['yearly_minor']),
            features: [for (final f in (r['features'] as List? ?? const [])) f.toString()],
          )
      ];

  static int? _minor(Object? v) {
    if (v is num) return v.toInt();
    if (v is Map && v['amount_minor'] is num) return (v['amount_minor'] as num).toInt();
    return null;
  }
}

final _plansProvider = FutureProvider.autoDispose<List<PlanInfo>>((ref) async {
  final res = await ref.watch(resolutionProvider.future);
  final farm = await ref.watch(currentFarmProvider.future);
  try {
    final rows = await ref.read(apiClientProvider).getList('/plans', query: {'country': farm?.country ?? 'CM'});
    final plans = PlanInfo.fromApi(rows);
    if (plans.isNotEmpty) return plans;
  } on ApiException {
    // offline: packs
  }
  return PlanInfo.fromPacks(res);
});

/// E50 — plans and subscription, mobile money checkout + payment polling.
class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ConsumerState<SubscriptionScreen> {
  bool _yearly = false;
  String? _paymentStatus;
  bool _busy = false;
  Timer? _poll;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _checkout(PlanInfo plan) async {
    final session = ref.read(sessionProvider);
    final phoneCtl = TextEditingController(text: session.phone ?? '');
    var method = 'orange_money';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setLocal) => AlertDialog(
          title: Text(c.tr('pay_mobile_money')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                children: [
                  for (final m in const ['orange_money', 'mtn_momo'])
                    RfChip(label: c.tr('pay_$m'), selected: method == m, onTap: () => setLocal(() => method = m)),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneCtl,
                keyboardType: TextInputType.phone,
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
                decoration: InputDecoration(labelText: c.tr('phone')),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(c.tr('cancel'))),
            TextButton(onPressed: () => Navigator.pop(c, true), child: Text(c.tr('pay'))),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final phone = phoneCtl.text.replaceAll(' ', '');
    setState(() {
      _busy = true;
      _paymentStatus = 'initie';
    });
    final api = ref.read(apiClientProvider);
    final ent = ref.read(entitlementsProvider);
    try {
      final r = await api.post('/subscriptions/checkout', {
        'account_type': 'user',
        'account_id': session.userId,
        'plan': plan.code,
        'period': _yearly ? 'yearly' : 'monthly',
        'method': method,
        'phone': phone,
      });
      final paymentId = r['payment_id']?.toString();
      if (paymentId == null) throw ApiException(code: 'SERVER_ERROR', message: 'payment_id');
      _startPolling(api, ent, paymentId);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _paymentStatus = null;
      });
      showSnack(context, e.isNetwork ? context.tr('payment_needs_network') : e.message);
    }
  }

  /// `GET /payments/:id` every 5 s for 2 min max (dossier 05 §16).
  void _startPolling(ApiClient api, EntitlementsService ent, String paymentId) {
    var ticks = 0;
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 5), (t) async {
      ticks++;
      try {
        final p = await api.get('/payments/$paymentId');
        final status = p['status']?.toString();
        if (!mounted) return;
        setState(() => _paymentStatus = status);
        if (status == 'confirme') {
          t.cancel();
          final sub = await api.get('/subscriptions/current');
          if (sub['entitlements'] is Map) {
            await ent.update(Map<String, dynamic>.from(sub['entitlements'] as Map));
          }
          if (mounted) setState(() => _busy = false);
        } else if (status == 'echoue') {
          t.cancel();
          if (mounted) setState(() => _busy = false);
        }
      } catch (_) {
        // keep polling
      }
      if (ticks >= 24) {
        t.cancel();
        if (mounted) setState(() => _busy = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final plans = ref.watch(_plansProvider);
    final ent = ref.watch(entitlementsProvider).state;
    final res = ref.watch(resolutionProvider).valueOrNull;
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final online = ref.watch(connectivityProvider.select((c) => c.online));
    final lang = context.lang;
    final cur = res == null ? (symbol: farm?.currency ?? 'XAF', minorUnit: 0) : currencyOf(res, farm?.currency ?? 'XAF');
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('plans'), subtitle: context.tr('current_plan', {'plan': context.tr('plan_${ent.plan}')})),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                children: [
                  if (ent.status == 'grace')
                    Panel(
                      color: RfColors.amberPanel,
                      borderColor: RfColors.amber,
                      child: Text(
                        context.tr('grace_banner', {
                          'expired': ent.expiresAt == null ? '' : Fmt.date(ent.expiresAt!.toIso8601String(), lang),
                          'until': ent.graceUntil == null ? '' : Fmt.date(ent.graceUntil!.toIso8601String(), lang),
                        }),
                        style: RfType.body(size: 13, color: RfColors.amberText),
                      ),
                    ),
                  if (ent.status == 'active' && ent.expiresAt != null)
                    Text(context.tr('expires_on', {'date': Fmt.date(ent.expiresAt!.toIso8601String(), lang)}),
                        style: RfType.body(size: 13, color: RfColors.textMuted)),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      RfChip(label: context.tr('monthly'), selected: !_yearly, onTap: () => setState(() => _yearly = false)),
                      const SizedBox(width: 8),
                      RfChip(label: context.tr('yearly'), selected: _yearly, onTap: () => setState(() => _yearly = true)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (_paymentStatus != null)
                    Panel(
                      dashed: true,
                      color: Colors.transparent,
                      borderColor: RfColors.cyan,
                      child: Row(
                        children: [
                          if (_busy) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                          if (_busy) const SizedBox(width: 10),
                          Expanded(
                            child: Text(context.tr('payment_status_$_paymentStatus'),
                                style: RfType.body(size: 13, color: RfColors.textSoft)),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 12),
                  AsyncBuilder<List<PlanInfo>>(
                    value: plans,
                    builder: (list) => Column(
                      children: [
                        for (final p in list) ...[
                          _planCard(context, p, ent.plan == p.code, online, cur.symbol, cur.minorUnit, lang),
                          const SizedBox(height: 12),
                        ],
                        Text(context.tr('institution_note'), style: RfType.body(size: 12, color: RfColors.textMuted)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _planCard(BuildContext context, PlanInfo p, bool current, bool online, String symbol, int minorUnit, String lang) {
    final featured = p.code == 'pro';
    final price = _yearly ? p.yearlyMinor : p.monthlyMinor;
    final fg = featured ? RfColors.bg : RfColors.text;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: featured ? RfColors.lime : RfColors.panel,
        border: Border.all(color: featured ? RfColors.lime : RfColors.line),
        borderRadius: BorderRadius.circular(RfRadii.hero),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.tr('plan_${p.code}'), style: RfType.title(size: 22, color: fg)),
          const SizedBox(height: 4),
          Text(
            price == null
                ? context.tr('price_on_request')
                : (price == 0
                    ? context.tr('free')
                    : '${Fmt.money(price, symbol, lang, minorUnit: minorUnit)} / ${context.tr(_yearly ? 'year' : 'month')}'),
            style: RfType.mono(size: 16, color: fg),
          ),
          const SizedBox(height: 10),
          for (final f in p.features.where((f) => f != '*').take(8))
            Text('• ${context.tr('feature_$f')}', style: RfType.body(size: 13, color: fg)),
          const SizedBox(height: 12),
          if (current)
            Text(context.tr('your_plan'), style: RfType.body(size: 13, weight: FontWeight.w600, color: fg))
          else if (p.code != 'decouverte')
            PillButton(
              label: context.tr('choose_plan', {'plan': context.tr('plan_${p.code}')}),
              kind: featured ? PillKind.dark : PillKind.lime,
              busy: _busy,
              onPressed: online ? () => _checkout(p) : null,
            ),
          if (!online && !current && p.code != 'decouverte')
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(context.tr('payment_needs_network'), style: RfType.body(size: 12, color: fg)),
            ),
        ],
      ),
    );
  }
}
