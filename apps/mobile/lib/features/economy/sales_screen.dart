import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/data/repository.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import '../health/health_event_form_screen.dart' show parseSubjectRef;
import '../home/home_data.dart' show currencyOf;
import '../livestock/batch_detail_screen.dart' show activeWithdrawal;
import 'economy_common.dart';

/// Product codes (dossier 03 `product`) with default units, by species.
const kProducts = {
  'oeufs_plateau': ('plateau', 'volaille'),
  'oeuf_unite': ('unite', 'volaille'),
  'poulet_vif': ('tete', 'volaille'),
  'poule_reforme': ('tete', 'volaille'),
  'fumier': ('sac', 'volaille'),
  'chiot': ('tete', 'chien'),
  'prestation': ('unite', null),
  'autre': ('unite', null),
};

/// Products whose sale is blocked during a withdrawal period (RG-VEN-02).
const kWithdrawalProducts = {'oeufs_plateau', 'oeuf_unite', 'poulet_vif', 'poule_reforme', 'lait'};

final _salesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  ref.watch(dbRevisionProvider);
  final farmId = ref.watch(sessionProvider.select((s) => s.farmId));
  if (farmId == null) return const [];
  return ref.read(repositoryProvider).sales(farmId);
});

int saleAmountMinor(Map<String, dynamic> s) {
  if (s['amount'] is Map) return FarmRepository.amountMinor(s['amount']);
  final q = (s['quantity'] as num?)?.toDouble() ?? 0;
  return (q * FarmRepository.amountMinor(s['unit_price'])).round();
}

/// E25 — sales list.
class SalesScreen extends ConsumerWidget {
  const SalesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sales = ref.watch(_salesProvider).valueOrNull ?? const [];
    final res = ref.watch(resolutionProvider).valueOrNull;
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final lang = context.lang;
    final cur = res == null ? (symbol: farm?.currency ?? 'XAF', minorUnit: 0) : currencyOf(res, farm?.currency ?? 'XAF');
    final month = Dates.monthStart(Dates.today());
    final total = sales
        .where((s) => (s['sale_date']?.toString() ?? '').compareTo(month) >= 0)
        .fold<int>(0, (a, s) => a + saleAmountMinor(s));
    return SimpleListPage(
      title: context.tr('sales'),
      ctaLabel: context.tr('new_sale'),
      onCta: () => context.push('/sales/new'),
      summary: KpiTile(
        label: context.tr('sales_this_month'),
        value: Fmt.money(total, '', lang, minorUnit: cur.minorUnit).trim(),
        unit: cur.symbol,
      ),
      children: [
        if (sales.isEmpty) EmptyState(message: context.tr('no_sales')),
        for (final s in sales)
          ChevronRow(
            leading: Fmt.dateShort(s['sale_date']?.toString(), lang).split('/').take(2).join('/'),
            title: '${context.tr('product_${s['product']}')} · ${Fmt.number(s['quantity'] as num?, lang)} ${context.tr('unit_${s['unit']}')}',
            subtitle: [
              Fmt.money(saleAmountMinor(s), cur.symbol, lang, minorUnit: cur.minorUnit),
              if (s['client_name'] != null) s['client_name'].toString(),
              context.tr('pay_${s['payment']}'),
            ].join(' · '),
            trailing: const SizedBox.shrink(),
          ),
      ],
    );
  }
}

/// E25 — sale form: amount = quantity × unit price (RG-VEN-01), withdrawal block (RG-VEN-02).
class SaleFormScreen extends ConsumerStatefulWidget {
  const SaleFormScreen({super.key, this.subjectRef});
  final String? subjectRef;

  @override
  ConsumerState<SaleFormScreen> createState() => _SaleFormScreenState();
}

class _SaleFormScreenState extends ConsumerState<SaleFormScreen> {
  final _form = GlobalKey<FormState>();
  final _qty = TextEditingController();
  final _price = TextEditingController();
  final _client = TextEditingController();
  String? _product;
  String? _unit;
  String _payment = 'orange_money';
  String _paymentStatus = 'paye';
  String _date = Dates.today();
  String? _subjectKey;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final p = parseSubjectRef(widget.subjectRef);
    if (p != null) _subjectKey = '${p.$1}:${p.$2}';
  }

  @override
  void dispose() {
    _qty.dispose();
    _price.dispose();
    _client.dispose();
    super.dispose();
  }

  Future<void> _save(String currency, List<Subject> subjects) async {
    if (!(_form.currentState?.validate() ?? false) || _product == null) {
      if (_product == null) showSnack(context, context.tr('err_product'));
      return;
    }
    final p = parseSubjectRef(_subjectKey);
    if (p != null && kWithdrawalProducts.contains(_product)) {
      final events = await ref.read(repositoryProvider).healthEvents(ref.read(sessionProvider).farmId!, subjectId: p.$2);
      final until = activeWithdrawal(events);
      if (until != null) {
        if (!mounted) return;
        showSnack(context, context.tr('err_withdrawal', {'date': Fmt.date(until, context.lang)}));
        return;
      }
    }
    if (!mounted) return;
    setState(() => _busy = true);
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final msg = context.tr('saved');
    final res = ref.read(resolutionProvider).valueOrNull;
    await ref.read(repositoryProvider).saveSale({
      'id': Ids.newId(),
      'farm_id': ref.read(sessionProvider).farmId,
      'product': _product,
      if (p != null) 'species': subjects.where((s) => s.id == p.$2).map((s) => s.species).firstOrNull,
      'quantity': parseAmount(_qty.text),
      'unit': _unit ?? kProducts[_product]?.$1 ?? 'unite',
      'unit_price': {'amount_minor': parseAmount(_price.text)?.round() ?? 0, 'currency': currency},
      if (_client.text.trim().isNotEmpty) 'client_name': _client.text.trim(),
      'payment': _payment,
      'payment_status': _paymentStatus,
      'sale_date': _date,
      if (p != null) 'subject_type': p.$1,
      if (p != null) 'subject_id': p.$2,
      'attributes': <String, dynamic>{},
      if (res != null) 'param_version': res.paramVersion,
    });
    messenger.showSnackBar(SnackBar(content: Text(msg)));
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/sales');
    }
  }

  @override
  Widget build(BuildContext context) {
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final res = ref.watch(resolutionProvider).valueOrNull;
    final subjects = ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    final specs = farm?.speculations ?? const <String>[];
    final lang = context.lang;
    final currency = farm?.currency ?? 'XAF';
    final cur = res == null ? (symbol: currency, minorUnit: 0) : currencyOf(res, currency);
    final products = kProducts.entries
        .where((e) => e.value.$2 == null || specs.contains(e.value.$2))
        .map((e) => e.key)
        .toList();
    final q = parseAmount(_qty.text);
    final pr = parseAmount(_price.text);
    final amount = q == null || pr == null ? null : (q * pr).round();
    return SimpleFormPage(
      formKey: _form,
      title: context.tr('new_sale'),
      busy: _busy,
      onSave: () => _save(currency, subjects),
      children: [
        LabeledDropdown(
          label: '${context.tr('product')} *',
          value: _product,
          options: products,
          optionLabel: (o) => context.tr('product_$o'),
          onChanged: (v) => setState(() {
            _product = v;
            _unit = v == null ? null : kProducts[v]?.$1;
          }),
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextFormField(
                controller: _qty,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: RfType.mono(size: 18, color: RfColors.text),
                decoration: InputDecoration(
                  labelText: '${context.tr('quantity')} *',
                  suffixText: _unit == null ? null : context.tr('unit_$_unit'),
                ),
                onChanged: (_) => setState(() {}),
                validator: (v) => (parseAmount(v ?? '') ?? 0) > 0 ? null : context.tr('err_positive'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: _price,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ,.]'))],
                style: RfType.mono(size: 18, color: RfColors.text),
                decoration: InputDecoration(labelText: '${context.tr('unit_price')} *', suffixText: cur.symbol),
                onChanged: (_) => setState(() {}),
                validator: (v) => (parseAmount(v ?? '') ?? -1) >= 0 ? null : context.tr('err_number'),
              ),
            ),
          ],
        ),
        Semantics(
          liveRegion: true,
          child: Text(
            context.tr('amount_is', {'amount': Fmt.money(amount, cur.symbol, lang, minorUnit: cur.minorUnit)}),
            style: RfType.body(size: 14, weight: FontWeight.w600, color: RfColors.lime),
          ),
        ),
        TextFormField(controller: _client, decoration: InputDecoration(labelText: context.tr('client'))),
        Text('${context.tr('payment')} *', style: RfType.body(size: 14, color: RfColors.textSoft)),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final m in kPaymentMethods)
              RfChip(label: context.tr('pay_$m'), selected: _payment == m, onTap: () => setState(() => _payment = m)),
          ],
        ),
        LabeledDropdown(
          label: context.tr('payment_status'),
          value: _paymentStatus,
          options: const ['paye', 'partiel', 'a_credit'],
          optionLabel: (o) => context.tr('paystatus_$o'),
          onChanged: (v) => setState(() => _paymentStatus = v ?? 'paye'),
        ),
        LabeledDropdown(
          label: context.tr('subject_optional'),
          value: _subjectKey,
          options: [for (final s in subjects) '${s.subjectType}:${s.id}'],
          optionLabel: (o) {
            final id = o.substring(o.indexOf(':') + 1);
            final s = subjects.firstWhere((x) => x.id == id);
            return s is Batch ? context.tr('batch_named', {'name': s.name}) : s.name;
          },
          onChanged: (v) => setState(() => _subjectKey = v),
        ),
        DateFieldTile(label: '${context.tr('date')} *', value: _date, onChanged: (v) => setState(() => _date = v)),
      ],
    );
  }
}
