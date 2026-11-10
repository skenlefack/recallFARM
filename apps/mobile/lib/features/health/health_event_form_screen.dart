import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/data/reminder_service.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/reminder_engine.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import '../home/home_data.dart' show currencyOf;
import 'reminder_actions.dart';

const kEventTypes = ['vaccination', 'traitement', 'deparasitage', 'vitamines'];

/// Parses `batch:<id>` / `dog:<id>`.
(String, String)? parseSubjectRef(String? ref) {
  if (ref == null) return null;
  final i = ref.indexOf(':');
  if (i <= 0) return null;
  return (ref.substring(0, i), ref.substring(i + 1));
}

/// E22 — vaccination / care form. Prefilled from a reminder (E21 « Confirmer »).
class HealthEventFormScreen extends ConsumerStatefulWidget {
  const HealthEventFormScreen({super.key, this.subjectRef, this.reminderKey});
  final String? subjectRef;
  final String? reminderKey;

  @override
  ConsumerState<HealthEventFormScreen> createState() => _HealthEventFormScreenState();
}

class _HealthEventFormScreenState extends ConsumerState<HealthEventFormScreen> {
  final _product = TextEditingController();
  final _lot = TextEditingController();
  final _route = TextEditingController();
  final _cost = TextEditingController();
  final _by = TextEditingController();
  final _qty = TextEditingController(text: '1');

  String? _subjectKey;
  String _eventType = 'vaccination';
  String? _disease;
  String _date = Dates.today();
  String? _nextDue;
  bool _nextDueTouched = false;
  String? _meatUntil;
  String? _eggsUntil;
  bool _consume = false;
  String? _stockItem;
  bool _busy = false;
  bool _prefilled = false;
  String? _error;
  ReminderView? _reminder;

  @override
  void initState() {
    super.initState();
    final p = parseSubjectRef(widget.subjectRef);
    if (p != null) _subjectKey = '${p.$1}:${p.$2}';
  }

  @override
  void dispose() {
    for (final c in [_product, _lot, _route, _cost, _by, _qty]) {
      c.dispose();
    }
    super.dispose();
  }

  void _prefill(List<ReminderView> reminders, Resolution res) {
    if (_prefilled) return;
    _prefilled = true;
    if (widget.reminderKey == null) return;
    for (final r in reminders) {
      if (r.key != widget.reminderKey) continue;
      _reminder = r;
      _subjectKey = '${r.subjectType}:${r.subjectId}';
      _disease = r.disease;
      _eventType = ReminderActions.eventTypeFor(r.disease);
      if (r.route != null) _route.text = res.label(r.route!, ref.read(sessionProvider).language);
    }
  }

  /// RG-VAC-01: next due from the protocol (recurrence of the same disease, or
  /// the next protocol step of the same disease).
  String? _computedNextDue(Resolution res, Subject? s) {
    if (s == null || _disease == null) return null;
    final protocol = ReminderService.protocolFor(res, s);
    if (protocol == null) return null;
    final rec = protocol['recurring'];
    if (rec is Map && rec['disease'] == _disease && rec['every_days'] is num) {
      return Dates.addDays(_date, (rec['every_days'] as num).toInt());
    }
    final ref0 = s.referenceDate;
    final steps = protocol['steps'];
    if (ref0 != null && steps is List) {
      for (final st in steps) {
        if (st is! Map || st['disease'] != _disease) continue;
        final due = Dates.addDays(ref0, (st['offset_days'] as num?)?.toInt() ?? 0);
        if (due.compareTo(_date) > 0) return due;
      }
    }
    return null;
  }

  Future<void> _save(Subject s, Resolution res, String currency) async {
    if (_eventType == 'vaccination' && _disease == null) {
      setState(() => _error = context.tr('err_disease_required'));
      return;
    }
    final next = _nextDueTouched ? _nextDue : (_nextDue ?? _computedNextDue(res, s));
    if (next != null && next.compareTo(_date) <= 0) {
      setState(() => _error = context.tr('err_next_due'));
      return;
    }
    if (_date.compareTo(Dates.today()) > 0) {
      setState(() => _error = context.tr('err_future_date'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final farmId = ref.read(sessionProvider).farmId!;
    final repo = ref.read(repositoryProvider);
    final actions = ReminderActions(ref);
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final msg = context.tr('act_saved');
    final costMinor = int.tryParse(_cost.text.replaceAll(RegExp(r'[^0-9]'), ''));

    String? stockMovementId;
    if (_consume && _stockItem != null) {
      final qty = double.tryParse(_qty.text.replaceAll(',', '.')) ?? 1;
      final item = res.get('stock_item', _stockItem!);
      final m = await repo.saveStockMovement({
        'id': Ids.newId(),
        'farm_id': farmId,
        'item_id': _stockItem,
        'movement_date': _date,
        'direction': 'sortie',
        'quantity': qty,
        'unit': item?['unit'],
        'subject_type': s.subjectType,
        'subject_id': s.id,
        'notes': 'health_event',
      });
      stockMovementId = m['id'].toString();
    }

    final fields = <String, dynamic>{
      'event_type': _eventType,
      if (_disease != null) 'disease': _disease,
      if (_product.text.trim().isNotEmpty) 'product': _product.text.trim(),
      if (_lot.text.trim().isNotEmpty) 'product_batch_no': _lot.text.trim(),
      if (_route.text.trim().isNotEmpty) 'dose_route': _route.text.trim(),
      'event_date': _date,
      if (next != null) 'next_due': next,
      if (_meatUntil != null) 'withdrawal_meat_until': _meatUntil,
      if (_eggsUntil != null) 'withdrawal_eggs_until': _eggsUntil,
      if (costMinor != null) 'cost': {'amount_minor': costMinor, 'currency': currency},
      if (_by.text.trim().isNotEmpty) 'performed_by': _by.text.trim(),
      if (stockMovementId != null) 'stock_movement_id': stockMovementId,
      'param_version': res.paramVersion,
    };
    final r = _reminder;
    if (r != null) {
      await actions.confirm(r, extra: fields);
    } else {
      await repo.saveHealthEvent(farmId, {
        'id': Ids.newId(),
        'subject_type': s.subjectType,
        'subject_id': s.id,
        ...fields,
      });
    }
    messenger.showSnackBar(SnackBar(content: Text(msg)));
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/health');
    }
  }

  @override
  Widget build(BuildContext context) {
    final subjects = ref.watch(subjectsProvider).valueOrNull;
    final res = ref.watch(resolutionProvider).valueOrNull;
    final reminders = ref.watch(remindersProvider).valueOrNull;
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final ent = ref.watch(entitlementsProvider);
    final lang = context.lang;
    if (subjects == null || res == null || reminders == null) {
      return const Scaffold(body: SafeArea(child: SkeletonList()));
    }
    _prefill(reminders, res);
    final active = subjects.where((s) => s is! Batch || s.isActive).toList();
    Subject? subject;
    for (final s in active) {
      if ('${s.subjectType}:${s.id}' == _subjectKey) subject = s;
    }
    subject ??= active.isEmpty ? null : active.first;
    final species = subject?.species;
    final diseases = res
        .ofKind('disease')
        .where((d) => species == null || (d['species'] is List && (d['species'] as List).contains(species)))
        .map((d) => d['code'].toString())
        .toList();
    final stockItems = res
        .ofKind('stock_item')
        .where((i) => species == null || (i['species'] is List && (i['species'] as List).contains(species)))
        .map((i) => i['code'].toString())
        .toList();
    final suggestedNext = _nextDueTouched ? _nextDue : _computedNextDue(res, subject);
    final plan = res.ofKind('reminder_plan').isEmpty ? null : res.ofKind('reminder_plan').first;
    final channels = <String>{};
    if (plan != null && suggestedNext != null) {
      for (final slot in ReminderEngine.notificationPlan(
          dueDate: suggestedNext, reminderPlan: plan, entitlements: ent.state.features)) {
        channels.addAll(slot.channels);
      }
    }
    final currency = farm?.currency ?? 'XAF';
    final cur = currencyOf(res, currency);
    final sub = subject;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(
              title: context.tr(_reminder != null ? 'confirm_reminder' : 'record_act'),
              subtitle: _reminder?.subjectName,
              close: true,
            ),
            Expanded(
              child: active.isEmpty
                  ? EmptyState(message: context.tr('journal_no_subject'))
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 12, RfSpace.gutter, 24),
                      children: [
                        DropdownButtonFormField<String>(
                          initialValue: sub == null ? null : '${sub.subjectType}:${sub.id}',
                          isExpanded: true,
                          dropdownColor: RfColors.panel,
                          decoration: InputDecoration(labelText: '${context.tr('subject')} *'),
                          items: [
                            for (final s in active)
                              DropdownMenuItem(
                                value: '${s.subjectType}:${s.id}',
                                child: Text(s is Batch ? context.tr('batch_named', {'name': s.name}) : s.name),
                              ),
                          ],
                          onChanged: _reminder != null ? null : (v) => setState(() => _subjectKey = v),
                        ),
                        const SizedBox(height: 16),
                        Text('${context.tr('event_type')} *', style: RfType.body(size: 14, color: RfColors.textSoft)),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final t in kEventTypes)
                              RfChip(
                                label: context.tr('event_$t'),
                                selected: _eventType == t,
                                onTap: () => setState(() => _eventType = t),
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        DropdownButtonFormField<String>(
                          initialValue: diseases.contains(_disease) ? _disease : null,
                          isExpanded: true,
                          dropdownColor: RfColors.panel,
                          decoration: InputDecoration(
                            labelText: context.tr('disease') + (_eventType == 'vaccination' ? ' *' : ''),
                          ),
                          items: [
                            for (final d in diseases) DropdownMenuItem(value: d, child: Text(res.label(d, lang))),
                          ],
                          onChanged: (v) => setState(() => _disease = v),
                        ),
                        const SizedBox(height: 14),
                        TextField(controller: _product, decoration: InputDecoration(labelText: context.tr('product'))),
                        const SizedBox(height: 14),
                        TextField(controller: _lot, decoration: InputDecoration(labelText: context.tr('product_lot'))),
                        const SizedBox(height: 14),
                        TextField(controller: _route, decoration: InputDecoration(labelText: context.tr('dose_route'))),
                        const SizedBox(height: 14),
                        _DateField(
                          label: '${context.tr('date')} *',
                          value: _date,
                          lastDate: DateTime.now(),
                          onChanged: (v) => setState(() => _date = v ?? Dates.today()),
                        ),
                        const SizedBox(height: 14),
                        _DateField(
                          label: context.tr('next_due'),
                          value: suggestedNext,
                          onChanged: (v) => setState(() {
                            _nextDue = v;
                            _nextDueTouched = true;
                          }),
                        ),
                        if (suggestedNext != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            context.tr('reminder_channels', {
                              'channels': channels.map((c) => context.tr('channel_$c')).join(', '),
                            }),
                            style: RfType.body(size: 12, color: RfColors.lime),
                          ),
                        ],
                        if (_eventType == 'traitement') ...[
                          const SizedBox(height: 14),
                          _DateField(
                            label: context.tr('withdrawal_meat'),
                            value: _meatUntil,
                            onChanged: (v) => setState(() => _meatUntil = v),
                          ),
                          const SizedBox(height: 14),
                          _DateField(
                            label: context.tr('withdrawal_eggs'),
                            value: _eggsUntil,
                            onChanged: (v) => setState(() => _eggsUntil = v),
                          ),
                        ],
                        const SizedBox(height: 14),
                        TextField(
                          controller: _cost,
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          decoration: InputDecoration(labelText: context.tr('cost'), suffixText: cur.symbol),
                        ),
                        const SizedBox(height: 14),
                        TextField(controller: _by, decoration: InputDecoration(labelText: context.tr('performed_by'))),
                        const SizedBox(height: 8),
                        CheckboxListTile(
                          value: _consume,
                          contentPadding: EdgeInsets.zero,
                          controlAffinity: ListTileControlAffinity.leading,
                          title: Text(context.tr('consume_stock'), style: RfType.body(size: 14, color: RfColors.text)),
                          onChanged: (v) => setState(() => _consume = v ?? false),
                        ),
                        if (_consume)
                          Row(
                            children: [
                              Expanded(
                                flex: 3,
                                child: DropdownButtonFormField<String>(
                                  initialValue: stockItems.contains(_stockItem) ? _stockItem : null,
                                  isExpanded: true,
                                  dropdownColor: RfColors.panel,
                                  decoration: InputDecoration(labelText: context.tr('stock_item')),
                                  items: [
                                    for (final i in stockItems)
                                      DropdownMenuItem(value: i, child: Text(res.label(i, lang))),
                                  ],
                                  onChanged: (v) => setState(() => _stockItem = v),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: TextField(
                                  controller: _qty,
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  decoration: InputDecoration(labelText: context.tr('quantity')),
                                ),
                              ),
                            ],
                          ),
                        if (_error != null) ...[
                          const SizedBox(height: 10),
                          Text(_error!, style: RfType.body(size: 13, color: RfColors.coral)),
                        ],
                      ],
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  PillButton(
                    label: context.tr('save_and_schedule'),
                    fontSize: 16,
                    padding: const EdgeInsets.all(16),
                    busy: _busy,
                    onPressed: sub == null ? null : () => _save(sub, res, currency),
                  ),
                  const SizedBox(height: 8),
                  Text(context.tr('saved_offline_hint'),
                      textAlign: TextAlign.center, style: RfType.body(size: 12, color: RfColors.textMuted)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.label, required this.value, required this.onChanged, this.lastDate});
  final String label;
  final String? value;
  final ValueChanged<String?> onChanged;
  final DateTime? lastDate;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(RfRadii.field),
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: Dates.toLocal(value) ?? DateTime.now(),
          firstDate: DateTime(2000),
          lastDate: lastDate ?? DateTime.now().add(const Duration(days: 365 * 3)),
        );
        if (picked != null) onChanged(Dates.ymd(picked));
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label),
        child: Text(value == null ? context.tr('choose_date') : Fmt.date(value, context.lang),
            style: RfType.mono(size: 15, color: value == null ? RfColors.textMuted : RfColors.text)),
      ),
    );
  }
}
