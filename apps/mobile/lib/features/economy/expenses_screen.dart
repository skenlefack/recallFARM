import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/providers.dart';
import '../../core/data/repository.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import '../home/home_data.dart' show currencyOf;
import 'economy_common.dart';

/// `expense_category` (dossier 03) subset relevant to the MVP filières.
const kExpenseCategories = [
  'aliment',
  'veterinaire',
  'achat_animaux',
  'main_oeuvre',
  'energie_eau',
  'equipement',
  'transport',
  'litiere',
  'biosecurite',
  'divers',
];

/// Categories proposing « Ajouter au stock » (E26).
const kStockableCategories = {'aliment', 'fourrage', 'veterinaire'};

final _expensesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  ref.watch(dbRevisionProvider);
  final farmId = ref.watch(sessionProvider.select((s) => s.farmId));
  if (farmId == null) return const [];
  return ref.read(repositoryProvider).expenses(farmId);
});

/// E26 — expenses list.
class ExpensesScreen extends ConsumerWidget {
  const ExpensesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(_expensesProvider).valueOrNull ?? const [];
    final res = ref.watch(resolutionProvider).valueOrNull;
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final lang = context.lang;
    final currency = farm?.currency ?? 'XAF';
    final cur = res == null ? (symbol: currency, minorUnit: 0) : currencyOf(res, currency);
    final month = Dates.monthStart(Dates.today());
    final total = list
        .where((e) => (e['expense_date']?.toString() ?? '').compareTo(month) >= 0)
        .fold<int>(0, (a, e) => a + FarmRepository.amountMinor(e['amount']));
    return SimpleListPage(
      title: context.tr('expenses'),
      ctaLabel: context.tr('new_expense'),
      onCta: () => context.push('/expenses/new'),
      summary: KpiTile(
        label: context.tr('expenses_this_month'),
        value: Fmt.money(total, '', lang, minorUnit: cur.minorUnit).trim(),
        unit: cur.symbol,
      ),
      children: [
        if (list.isEmpty) EmptyState(message: context.tr('no_expenses')),
        for (final e in list)
          ChevronRow(
            leading: Fmt.dateShort(e['expense_date']?.toString(), lang).split('/').take(2).join('/'),
            title: context.tr('expcat_${e['category']}'),
            subtitle: [
              Fmt.money(FarmRepository.amountMinor(e['amount']), cur.symbol, lang, minorUnit: cur.minorUnit),
              if (e['description'] != null) e['description'].toString(),
            ].join(' · '),
            trailing: const SizedBox.shrink(),
          ),
      ],
    );
  }
}

/// E26 — expense form (+ « Ajouter au stock » for feed / veterinary products).
class ExpenseFormScreen extends ConsumerStatefulWidget {
  const ExpenseFormScreen({super.key});

  @override
  ConsumerState<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends ConsumerState<ExpenseFormScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _desc = TextEditingController();
  final _qty = TextEditingController();
  final _supplier = TextEditingController();
  String? _category;
  String _payment = 'especes';
  String _date = Dates.today();
  bool _toStock = false;
  String? _stockItem;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    _desc.dispose();
    _qty.dispose();
    _supplier.dispose();
    super.dispose();
  }

  Future<void> _save(String currency) async {
    if (!(_form.currentState?.validate() ?? false) || _category == null) {
      if (_category == null) showSnack(context, context.tr('err_category'));
      return;
    }
    setState(() => _busy = true);
    final repo = ref.read(repositoryProvider);
    final farmId = ref.read(sessionProvider).farmId;
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final msg = context.tr('saved');
    final amountMinor = parseAmount(_amount.text)?.round() ?? 0;
    final qty = parseAmount(_qty.text);
    final expenseId = Ids.newId();
    await repo.saveExpense({
      'id': expenseId,
      'farm_id': farmId,
      'category': _category,
      if (_desc.text.trim().isNotEmpty) 'description': _desc.text.trim(),
      if (qty != null) 'quantity': qty,
      'amount': {'amount_minor': amountMinor, 'currency': currency},
      'payment_method': _payment,
      if (_supplier.text.trim().isNotEmpty) 'supplier': _supplier.text.trim(),
      'expense_date': _date,
      'attributes': <String, dynamic>{},
    });
    if (_toStock && _stockItem != null && qty != null && qty > 0) {
      await repo.saveStockMovement({
        'id': Ids.newId(),
        'farm_id': farmId,
        'item_id': _stockItem,
        'movement_date': _date,
        'direction': 'entree',
        'quantity': qty,
        'unit_cost': {'amount_minor': (amountMinor / qty).round(), 'currency': currency},
        if (_supplier.text.trim().isNotEmpty) 'supplier': _supplier.text.trim(),
        'expense_id': expenseId,
      });
    }
    messenger.showSnackBar(SnackBar(content: Text(msg)));
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/expenses');
    }
  }

  @override
  Widget build(BuildContext context) {
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final res = ref.watch(resolutionProvider).valueOrNull;
    final lang = context.lang;
    final currency = farm?.currency ?? 'XAF';
    final cur = res == null ? (symbol: currency, minorUnit: 0) : currencyOf(res, currency);
    final items = res == null
        ? const <String>[]
        : res.ofKind('stock_item').map((i) => i['code'].toString()).toList();
    return SimpleFormPage(
      formKey: _form,
      title: context.tr('new_expense'),
      busy: _busy,
      onSave: () => _save(currency),
      children: [
        LabeledDropdown(
          label: '${context.tr('category')} *',
          value: _category,
          options: kExpenseCategories,
          optionLabel: (o) => context.tr('expcat_$o'),
          onChanged: (v) => setState(() => _category = v),
        ),
        TextFormField(controller: _desc, decoration: InputDecoration(labelText: context.tr('description'))),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextFormField(
                controller: _amount,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ,.]'))],
                style: RfType.mono(size: 18, color: RfColors.text),
                decoration: InputDecoration(labelText: '${context.tr('amount')} *', suffixText: cur.symbol),
                validator: (v) => (parseAmount(v ?? '') ?? -1) >= 0 ? null : context.tr('err_number'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: _qty,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: context.tr('quantity')),
              ),
            ),
          ],
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final m in kPaymentMethods)
              RfChip(label: context.tr('pay_$m'), selected: _payment == m, onTap: () => setState(() => _payment = m)),
          ],
        ),
        TextFormField(controller: _supplier, decoration: InputDecoration(labelText: context.tr('supplier'))),
        DateFieldTile(label: '${context.tr('date')} *', value: _date, onChanged: (v) => setState(() => _date = v)),
        if (kStockableCategories.contains(_category)) ...[
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _toStock,
            onChanged: (v) => setState(() => _toStock = v),
            title: Text(context.tr('add_to_stock'), style: RfType.body(size: 14, color: RfColors.text)),
          ),
          if (_toStock)
            LabeledDropdown(
              label: context.tr('stock_item'),
              value: _stockItem,
              options: items,
              optionLabel: (o) => res?.label(o, lang) ?? o,
              onChanged: (v) => setState(() => _stockItem = v),
            ),
        ],
      ],
    );
  }
}
