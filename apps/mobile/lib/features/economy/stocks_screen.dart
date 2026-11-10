import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import 'economy_common.dart';

final _stockSummaryProvider = FutureProvider.autoDispose<Map<String, double>>((ref) async {
  ref.watch(dbRevisionProvider);
  final farmId = ref.watch(sessionProvider.select((s) => s.farmId));
  if (farmId == null) return const {};
  return ref.read(repositoryProvider).stockSummary(farmId);
});

/// E27 — feed & stocks: current quantity per pack `stock_item`.
class StocksScreen extends ConsumerWidget {
  const StocksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = ref.watch(_stockSummaryProvider).valueOrNull ?? const <String, double>{};
    final res = ref.watch(resolutionProvider).valueOrNull;
    final specs = ref.watch(currentFarmProvider).valueOrNull?.speculations ?? const <String>[];
    final lang = context.lang;
    final items = res == null
        ? const <Map<String, dynamic>>[]
        : res.ofKind('stock_item').where((i) {
            final sp = i['species'];
            return sp is! List || sp.any((s) => specs.contains(s));
          }).toList();
    return SimpleListPage(
      title: context.tr('stocks'),
      subtitle: context.tr('stocks_subtitle'),
      ctaLabel: context.tr('new_stock_movement'),
      onCta: () => context.push('/stocks/new'),
      children: [
        for (final i in items)
          Builder(builder: (context) {
            final code = i['code'].toString();
            final q = summary[code] ?? 0;
            return ChevronRow(
              title: res!.label(code, lang),
              subtitle: '${Fmt.number(q, lang)} ${context.tr('unit_${i['unit']}')}'
                  '${q < 0 ? ' · ${context.tr('negative_stock')}' : ''}',
              leading: context.tr('stockcat_${i['category']}'),
              leadingColor: q < 0 ? RfColors.coral : RfColors.textMuted,
              onTap: () => context.push('/stocks/new?item=$code'),
            );
          }),
      ],
    );
  }
}

/// E27 — stock movement form (entrée / sortie / ajustement).
class StockMovementFormScreen extends ConsumerStatefulWidget {
  const StockMovementFormScreen({super.key, this.itemCode});
  final String? itemCode;

  @override
  ConsumerState<StockMovementFormScreen> createState() => _StockMovementFormScreenState();
}

class _StockMovementFormScreenState extends ConsumerState<StockMovementFormScreen> {
  final _form = GlobalKey<FormState>();
  final _qty = TextEditingController();
  final _cost = TextEditingController();
  final _supplier = TextEditingController();
  final _lot = TextEditingController();
  String? _item;
  String _direction = 'entree';
  String _date = Dates.today();
  String? _expiry;
  String? _subjectKey;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _item = widget.itemCode;
  }

  @override
  void dispose() {
    _qty.dispose();
    _cost.dispose();
    _supplier.dispose();
    _lot.dispose();
    super.dispose();
  }

  Future<void> _save(String currency, Map<String, double> summary) async {
    if (!(_form.currentState?.validate() ?? false) || _item == null) {
      if (_item == null) showSnack(context, context.tr('err_item'));
      return;
    }
    final qty = parseAmount(_qty.text) ?? 0;
    final available = summary[_item] ?? 0;
    if (_direction == 'sortie' && qty > available) {
      // Non-blocking warning (E27).
      showSnack(context, context.tr('negative_stock_warning'));
    }
    setState(() => _busy = true);
    final repo = ref.read(repositoryProvider);
    final farmId = ref.read(sessionProvider).farmId;
    final res = ref.read(resolutionProvider).valueOrNull;
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final msg = context.tr('saved');
    final cost = parseAmount(_cost.text)?.round();
    final i = _subjectKey?.indexOf(':') ?? -1;
    await repo.saveStockMovement({
      'id': Ids.newId(),
      'farm_id': farmId,
      'item_id': _item,
      'movement_date': _date,
      'direction': _direction,
      'quantity': qty,
      'unit': res?.get('stock_item', _item!)?['unit'],
      if (cost != null) 'unit_cost': {'amount_minor': cost, 'currency': currency},
      if (_supplier.text.trim().isNotEmpty) 'supplier': _supplier.text.trim(),
      if (_lot.text.trim().isNotEmpty) 'lot_no': _lot.text.trim(),
      if (_expiry != null) 'expiry_date': _expiry,
      if (i > 0) 'subject_type': _subjectKey!.substring(0, i),
      if (i > 0) 'subject_id': _subjectKey!.substring(i + 1),
    });
    messenger.showSnackBar(SnackBar(content: Text(msg)));
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/stocks');
    }
  }

  @override
  Widget build(BuildContext context) {
    final res = ref.watch(resolutionProvider).valueOrNull;
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final summary = ref.watch(_stockSummaryProvider).valueOrNull ?? const <String, double>{};
    final subjects = ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    final lang = context.lang;
    final items = res == null ? const <String>[] : res.ofKind('stock_item').map((i) => i['code'].toString()).toList();
    final unit = _item == null ? null : res?.get('stock_item', _item!)?['unit']?.toString();
    final perishable = _item != null && (res?.get('stock_item', _item!)?['category'] == 'vaccin' ||
        res?.get('stock_item', _item!)?['category'] == 'medicament');
    return SimpleFormPage(
      formKey: _form,
      title: context.tr('new_stock_movement'),
      busy: _busy,
      onSave: () => _save(farm?.currency ?? 'XAF', summary),
      children: [
        LabeledDropdown(
          label: '${context.tr('stock_item')} *',
          value: _item,
          options: items,
          optionLabel: (o) => res?.label(o, lang) ?? o,
          onChanged: (v) => setState(() => _item = v),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final d in const ['entree', 'sortie', 'ajustement'])
              RfChip(label: context.tr('dir_$d'), selected: _direction == d, onTap: () => setState(() => _direction = d)),
          ],
        ),
        TextFormField(
          controller: _qty,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: RfType.mono(size: 18, color: RfColors.text),
          decoration: InputDecoration(
            labelText: '${context.tr('quantity')} *',
            suffixText: unit == null ? null : context.tr('unit_$unit'),
            helperText: _item == null
                ? null
                : context.tr('current_stock', {'q': Fmt.number(summary[_item] ?? 0, lang)}),
          ),
          validator: (v) => (parseAmount(v ?? '') ?? 0) > 0 ? null : context.tr('err_positive'),
        ),
        if (_direction == 'entree') ...[
          TextFormField(
            controller: _cost,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: context.tr('unit_cost')),
          ),
          TextFormField(controller: _supplier, decoration: InputDecoration(labelText: context.tr('supplier'))),
          TextFormField(controller: _lot, decoration: InputDecoration(labelText: context.tr('product_lot'))),
          if (perishable)
            DateFieldTile(
              label: context.tr('expiry_date'),
              value: _expiry,
              future: true,
              onChanged: (v) => setState(() => _expiry = v),
            ),
        ],
        if (_direction == 'sortie')
          LabeledDropdown(
            label: context.tr('destination'),
            value: _subjectKey,
            options: [for (final s in subjects) '${s.subjectType}:${s.id}'],
            optionLabel: (o) => subjects.firstWhere((s) => '${s.subjectType}:${s.id}' == o).name,
            onChanged: (v) => setState(() => _subjectKey = v),
          ),
        DateFieldTile(label: '${context.tr('date')} *', value: _date, onChanged: (v) => setState(() => _date = v)),
      ],
    );
  }
}
