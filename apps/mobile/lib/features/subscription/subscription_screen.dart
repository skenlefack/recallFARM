import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../home/home_data.dart' show currencyOf;
import 'subscription_strings.dart';

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

/// A payment method of the country pack (`GET /plans` → `payment_methods`).
class PayMethod {
  const PayMethod(this.code, this.label);
  final String code;
  final String label;
}

/// Plans + payment methods of the country. Online: `GET /plans`; offline: packs.
class PlansCatalog {
  const PlansCatalog(this.plans, this.methods);
  final List<PlanInfo> plans;
  final List<PayMethod> methods;

  static List<PayMethod> methodsFromApi(Object? raw) => [
        for (final m in (raw as List? ?? const []))
          if (m is Map && m['code'] != null) PayMethod(m['code'].toString(), (m['label'] ?? m['code']).toString()),
      ];

  static List<PayMethod> methodsFromPacks(Resolution res) => [
        for (final o in res.ofKind('payment_method')) PayMethod(o['code'].toString(), (o['label'] ?? o['code']).toString()),
      ];
}

final plansProvider = FutureProvider.autoDispose<PlansCatalog>((ref) async {
  final res = await ref.watch(resolutionProvider.future);
  final farm = await ref.watch(currentFarmProvider.future);
  try {
    final body = await ref.read(apiClientProvider).get('/plans', query: {'country': farm?.country ?? 'CM'});
    final plans = PlanInfo.fromApi(ApiClient.asList(body));
    final methods = PlansCatalog.methodsFromApi(body['payment_methods']);
    if (plans.isNotEmpty) {
      return PlansCatalog(plans, methods.isNotEmpty ? methods : PlansCatalog.methodsFromPacks(res));
    }
  } on ApiException {
    // offline: packs
  }
  return PlansCatalog(PlanInfo.fromPacks(res), PlansCatalog.methodsFromPacks(res));
});

/// Local status shown in the status panel.
/// sending | initie | en_attente | confirme | echoue | refused | pending_check | still_pending | lost
String _statusText(BuildContext c, String s) => switch (s) {
      'sending' => c.trSub('pay_sending'),
      'refused' => c.trSub('pay_refused'),
      'pending_check' => c.trSub('pay_pending_check'),
      'still_pending' => c.trSub('pay_still_pending'),
      'lost' => c.trSub('pay_connection_lost'),
      _ => c.tr('payment_status_$s'),
    };

const _kPendingKey = 'subscription.pending_payment_id';

/// E50 — plans and subscription, mobile money checkout + payment polling
/// (EF-ABO-01, EF-ABO-02). A pending payment is never relaunched: we follow it.
class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key, this.pollInterval = const Duration(seconds: 5), this.maxPolls = 24});

  /// `GET /payments/:id` every 5 s for 2 min max (dossier 05 §16).
  final Duration pollInterval;
  final int maxPolls;

  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ConsumerState<SubscriptionScreen> {
  bool _yearly = false;
  String? _paymentStatus;
  String? _paymentId;
  bool _busy = false;
  bool _submitting = false;
  Timer? _poll;
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    unawaited(_resume());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  /// A payment of unknown outcome survives an app restart: follow it, do not relaunch.
  Future<void> _resume() async {
    final id = await ref.read(localDbProvider).getKv(_kPendingKey);
    if (id == null || id.isEmpty || !mounted || _paymentId != null) return;
    setState(() {
      _paymentId = id;
      _busy = true;
      _paymentStatus = 'pending_check';
    });
    _startPolling(id);
  }

  /// The status panel is at the top: bring it into view after the tap.
  void _showStatus() {
    if (_scroll.hasClients && _scroll.offset > 0) {
      unawaited(_scroll.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOut));
    }
  }

  Future<void> _remember(String? id) => ref.read(localDbProvider).setKv(_kPendingKey, id);

  Future<void> _checkout(PlanInfo plan, List<PayMethod> methods) async {
    if (_submitting || _busy || _paymentId != null) return; // double tap guard
    _submitting = true;
    try {
      await _doCheckout(plan, methods);
    } finally {
      _submitting = false;
    }
  }

  Future<void> _doCheckout(PlanInfo plan, List<PayMethod> methods) async {
    final session = ref.read(sessionProvider);
    final choice = await showDialog<({String method, String phone})>(
      context: context,
      builder: (c) => _PayDialog(methods: methods, phone: session.phone ?? ''),
    );
    if (choice == null || !mounted) return;
    setState(() {
      _busy = true;
      _paymentStatus = 'sending';
    });
    _showStatus();
    final api = ref.read(apiClientProvider);
    try {
      final r = await api.post('/subscriptions/checkout', {
        'account_type': 'user',
        'account_id': session.userId,
        'plan': plan.code,
        'period': _yearly ? 'yearly' : 'monthly',
        'method': choice.method,
        'phone': choice.phone,
      });
      final paymentId = r['payment_id']?.toString();
      if (paymentId == null) throw ApiException(code: 'SERVER_ERROR', message: 'payment_id');
      await _follow(paymentId, 'initie');
    } on ApiException catch (e) {
      if (!mounted) return;
      final rule = e.details['rule'] ?? e.fields['rule'];
      if (e.code == 'BUSINESS_RULE' && rule == 'PAY-PENDING') {
        // Unknown outcome: never relaunch, follow the payment.
        final id = e.details['payment_id']?.toString();
        if (id != null) {
          await _follow(id, 'pending_check');
          return;
        }
      }
      setState(() {
        _busy = false;
        _paymentStatus = e.code == 'BUSINESS_RULE' && rule == 'PAY-INIT'
            ? 'refused'
            : (e.isNetwork ? 'lost' : null);
      });
      if (_paymentStatus == null) showSnack(context, e.message);
    }
  }

  Future<void> _follow(String paymentId, String status) async {
    await _remember(paymentId);
    if (!mounted) return;
    setState(() {
      _paymentId = paymentId;
      _busy = true;
      _paymentStatus = status;
    });
    _startPolling(paymentId);
  }

  Future<void> _finish(String status) async {
    _poll?.cancel();
    _paymentId = null;
    await _remember(null);
    if (mounted) {
      setState(() {
        _busy = false;
        _paymentStatus = status;
      });
    }
  }

  void _startPolling(String paymentId) {
    final api = ref.read(apiClientProvider);
    final ent = ref.read(entitlementsProvider);
    var ticks = 0;
    var inFlight = false;
    _poll?.cancel();
    _poll = Timer.periodic(widget.pollInterval, (t) async {
      if (inFlight) return;
      inFlight = true;
      ticks++;
      try {
        final p = await api.get('/payments/$paymentId');
        final status = p['status']?.toString();
        if (!mounted) return;
        if (status == 'confirme') {
          await _finish('confirme');
          final sub = await api.get('/subscriptions/current');
          if (sub['entitlements'] is Map) {
            await ent.update(Map<String, dynamic>.from(sub['entitlements'] as Map));
          }
          return;
        } else if (status == 'echoue') {
          await _finish('echoue');
          return;
        }
        if (_paymentStatus == 'lost' || _paymentStatus == 'pending_check') {
          setState(() => _paymentStatus = status == 'initie' ? 'initie' : 'en_attente');
        }
      } on ApiException {
        // offline or transient: keep following, nothing is lost
      } finally {
        inFlight = false;
      }
      if (ticks >= widget.maxPolls && mounted && _paymentId == paymentId) {
        _poll?.cancel();
        setState(() {
          _busy = false;
          _paymentStatus = 'still_pending'; // _paymentId kept: no new checkout
        });
      }
    });
  }

  void _checkNow() {
    final id = _paymentId;
    if (id == null) return;
    setState(() {
      _busy = true;
      _paymentStatus = 'pending_check';
    });
    _startPolling(id);
  }

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(plansProvider);
    final ent = ref.watch(entitlementsProvider).state;
    final res = ref.watch(resolutionProvider).valueOrNull;
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final online = ref.watch(connectivityProvider.select((c) => c.online));
    final lang = context.lang;
    final cur = res == null ? (symbol: farm?.currency ?? 'XAF', minorUnit: 0) : currencyOf(res, farm?.currency ?? 'XAF');
    final locked = _busy || _paymentId != null;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('plans'), subtitle: context.tr('current_plan', {'plan': context.tr('plan_${ent.plan}')})),
            Expanded(
              child: ListView(
                controller: _scroll,
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
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      RfChip(label: context.tr('monthly'), selected: !_yearly, onTap: () => setState(() => _yearly = false)),
                      RfChip(label: context.tr('yearly'), selected: _yearly, onTap: () => setState(() => _yearly = true)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (_paymentStatus != null) _statusPanel(context, online),
                  const SizedBox(height: 12),
                  AsyncBuilder<PlansCatalog>(
                    value: catalog,
                    builder: (c) => Column(
                      children: [
                        for (final p in c.plans) ...[
                          _planCard(context, p, c.methods, ent.plan == p.code, online, locked, cur.symbol, cur.minorUnit, lang),
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

  Widget _statusPanel(BuildContext context, bool online) {
    final status = _paymentStatus!;
    final text = _statusText(context, status);
    final alert = status == 'refused' || status == 'echoue' || status == 'lost';
    return Semantics(
      liveRegion: true,
      container: true,
      label: text,
      child: Panel(
        dashed: true,
        color: Colors.transparent,
        borderColor: alert ? RfColors.coral : RfColors.cyan,
        child: ExcludeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_busy) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  if (_busy) const SizedBox(width: 10),
                  Expanded(child: Text(text, style: RfType.body(size: 13, color: alert ? RfColors.coral : RfColors.textSoft))),
                ],
              ),
              if (_paymentId != null && !online)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(context.trSub('pay_offline_follow'), style: RfType.body(size: 12, color: RfColors.textMuted)),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _planCard(BuildContext context, PlanInfo p, List<PayMethod> methods, bool current, bool online, bool locked,
      String symbol, int minorUnit, String lang) {
    final featured = p.code == 'pro';
    final price = _yearly ? p.yearlyMinor : p.monthlyMinor;
    final fg = featured ? RfColors.bg : RfColors.text;
    final canBuy = !current && p.code != 'decouverte';
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
          else if (canBuy)
            PillButton(
              label: context.tr('choose_plan', {'plan': context.tr('plan_${p.code}')}),
              kind: featured ? PillKind.dark : PillKind.lime,
              busy: _busy,
              expand: true,
              onPressed: online && !locked && methods.isNotEmpty && price != null ? () => _checkout(p, methods) : null,
            ),
          if (canBuy && _paymentStatus == 'still_pending' && _paymentId != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: PillButton(
                label: context.trSub('pay_check_now'),
                kind: featured ? PillKind.outlineDark : PillKind.outline,
                expand: true,
                onPressed: online ? _checkNow : null,
              ),
            ),
          if (canBuy && methods.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(context.trSub('pay_no_method'), style: RfType.body(size: 12, color: fg)),
            ),
          if (!online && canBuy)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(context.tr('payment_needs_network'), style: RfType.body(size: 12, color: fg)),
            ),
        ],
      ),
    );
  }
}

/// Method + phone dialog. The pay button is single-shot (double tap safe).
class _PayDialog extends StatefulWidget {
  const _PayDialog({required this.methods, required this.phone});
  final List<PayMethod> methods;
  final String phone;

  @override
  State<_PayDialog> createState() => _PayDialogState();
}

class _PayDialogState extends State<_PayDialog> {
  late final TextEditingController _phone = TextEditingController(text: widget.phone);
  late String _method = widget.methods.first.code;
  bool _done = false;
  bool _invalid = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  void _submit() {
    if (_done) return;
    final phone = _phone.text.replaceAll(' ', '');
    if (phone.replaceAll('+', '').length < 8) {
      setState(() => _invalid = true);
      return;
    }
    _done = true;
    Navigator.pop(context, (method: _method, phone: phone));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(context.tr('pay_mobile_money')),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              container: true,
              label: context.trSub('pay_method'),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final m in widget.methods)
                    RfChip(label: m.label, selected: _method == m.code, onTap: () => setState(() => _method = m.code)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
              decoration: InputDecoration(
                labelText: context.tr('phone'),
                errorText: _invalid ? context.trSub('pay_phone_invalid') : null,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          style: TextButton.styleFrom(minimumSize: const Size(RfSpace.minTouch, RfSpace.minTouch)),
          onPressed: () => Navigator.pop(context),
          child: Text(context.tr('cancel')),
        ),
        TextButton(
          style: TextButton.styleFrom(minimumSize: const Size(RfSpace.minTouch, RfSpace.minTouch)),
          onPressed: _submit,
          child: Text(context.tr('pay')),
        ),
      ],
    );
  }
}
