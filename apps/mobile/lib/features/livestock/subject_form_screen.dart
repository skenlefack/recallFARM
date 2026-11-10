import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/form_engine.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import '../forms/form_renderer.dart';

/// Finds the resolved form for an entity kind and species.
FormSpec? findForm(Resolution res, String appliesTo, String? species) {
  for (final f in res.ofKind('form')) {
    if (f['applies_to'] != appliesTo) continue;
    if (species != null && f['species'] != null && f['species'] != species) continue;
    return FormSpec.fromJson(f);
  }
  return null;
}

/// E12 — adaptive add/edit form (lot or dog), rendered from the resolved pack form.
class SubjectFormScreen extends ConsumerStatefulWidget {
  const SubjectFormScreen({super.key, required this.type, this.editId});
  final String type; // batch | dog
  final String? editId;

  @override
  ConsumerState<SubjectFormScreen> createState() => _SubjectFormScreenState();
}

class _SubjectFormScreenState extends ConsumerState<SubjectFormScreen> {
  Map<String, Object?> _values = {};
  bool _initialised = false;
  bool _showErrors = false;
  bool _busy = false;
  Map<String, dynamic>? _existing;

  // Dog-only extras (E12 « bloc santé » and ⭐ pedigree)
  String? _lastRabies;
  String? _sireId;
  String? _damId;

  bool get _isDog => widget.type == 'dog';

  Future<void> _init(FormEngine engine) async {
    var values = engine.initialValues();
    if (!_isDog) {
      final count = (await ref.read(batchesProvider.future)).length;
      if (!mounted) return;
      values = {
        ...values,
        'name': 'B${(count + 1).toString().padLeft(2, '0')}',
        'start_date': Dates.today(),
      };
    }
    if (widget.editId != null) {
      final row = await ref.read(localDbProvider).get(_isDog ? 'dogs' : 'batches', widget.editId!);
      if (row != null) {
        _existing = row;
        values = {...values, ...engine.valuesFromRecord(row)};
        _sireId = row['sire_id']?.toString();
        _damId = row['dam_id']?.toString();
      }
    }
    if (mounted) setState(() => _values = values);
  }

  Future<void> _save(FormEngine engine, Resolution res) async {
    final ev = engine.evaluate(_values, context: _context());
    if (!ev.isValid) {
      setState(() => _showErrors = true);
      return;
    }
    // E12 date rules: start/birth date ≤ today.
    final dateField = _isDog ? 'birth_date' : 'start_date';
    final d = _values[dateField]?.toString();
    if (d != null && d.compareTo(Dates.today()) > 0) {
      showSnack(context, context.tr('err_future_date'));
      return;
    }
    setState(() => _busy = true);
    final farmId = ref.read(sessionProvider).farmId!;
    final repo = ref.read(repositoryProvider);
    final router = GoRouter.of(context);
    final msg = context.tr('saved');
    final messenger = ScaffoldMessenger.of(context);
    final payload = engine.toPayload(_values, ev);
    final existingAttrs = _existing?['attributes'];
    final data = <String, dynamic>{
      ...?_existing,
      ...payload,
      'attributes': {
        if (existingAttrs is Map) ...Map<String, dynamic>.from(existingAttrs),
        ...(payload['attributes'] as Map<String, dynamic>),
      },
      'id': _existing?['id'] ?? Ids.newId(),
      'farm_id': farmId,
      'param_version': res.paramVersion,
    };
    if (_isDog) {
      data['sire_id'] = _sireId;
      data['dam_id'] = _damId;
    } else {
      data['species'] = engine.spec.species ?? 'volaille';
      data.putIfAbsent('status', () => 'en_cours');
    }
    final saved = await repo.saveSubject(widget.type, data);
    if (_isDog && _lastRabies != null) {
      final events = await repo.healthEvents(farmId, subjectId: saved['id'].toString());
      final hadRabies = events.any((e) => e.disease == 'rage');
      await repo.saveHealthEvent(farmId, {
        'subject_type': 'dog',
        'subject_id': saved['id'],
        'event_type': 'vaccination',
        'disease': 'rage',
        'event_date': _lastRabies,
        // The first recorded rabies vaccination fulfils the primo step of the protocol.
        if (!hadRabies) 'protocol_step': 'rage_m3',
        'next_due': Dates.addDays(_lastRabies!, 365),
      });
    }
    messenger.showSnackBar(SnackBar(content: Text(msg)));
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/livestock');
    }
  }

  Map<String, Object?> _context() => {
        'now': Dates.today(),
        if (!_isDog) 'subject': {'species': 'volaille'},
      };

  @override
  Widget build(BuildContext context) {
    final resAsync = ref.watch(resolutionProvider);
    final lang = context.lang;
    return Scaffold(
      body: SafeArea(
        child: AsyncBuilder<Resolution>(
          value: resAsync,
          builder: (res) {
            final spec = findForm(res, widget.type, _isDog ? 'chien' : null);
            if (spec == null) {
              return Column(children: [
                ScreenHeader(title: context.tr(_isDog ? 'add_dog' : 'add_batch'), close: true),
                EmptyState(message: context.tr('form_unavailable')),
              ]);
            }
            final engine = FormEngine(spec);
            if (!_initialised) {
              _initialised = true;
              Future.microtask(() => _init(engine));
            }
            return Column(
              children: [
                ScreenHeader(
                  title: context.tr(widget.editId != null ? 'edit' : (_isDog ? 'add_dog' : 'add_batch')),
                  subtitle: context.tr(_isDog ? 'dog_form_subtitle' : 'batch_form_subtitle'),
                  close: true,
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 12, RfSpace.gutter, 24),
                    children: [
                      FormRenderer(
                        engine: engine,
                        values: _values,
                        onChanged: (v) => setState(() => _values = v),
                        label: (k) => res.label(k, lang),
                        exprContext: _context(),
                        showErrors: _showErrors,
                      ),
                      if (_isDog) ...[
                        const SizedBox(height: 24),
                        SectionLabel(context.tr('health_block')),
                        const SizedBox(height: 8),
                        _DateTile(
                          label: context.tr('last_rabies'),
                          value: _lastRabies,
                          onPicked: (v) => setState(() => _lastRabies = v),
                        ),
                        if (_lastRabies != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              context.tr('next_rabies_computed',
                                  {'date': Fmt.date(Dates.addDays(_lastRabies!, 365), lang)}),
                              style: RfType.body(size: 12, color: RfColors.lime),
                            ),
                          ),
                        const SizedBox(height: 20),
                        _PedigreePickers(
                          currentId: widget.editId,
                          sireId: _sireId,
                          damId: _damId,
                          onSire: (v) => setState(() => _sireId = v),
                          onDam: (v) => setState(() => _damId = v),
                        ),
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
                        label: context.tr('save'),
                        fontSize: 16,
                        padding: const EdgeInsets.all(16),
                        busy: _busy,
                        onPressed: () => _save(engine, res),
                      ),
                      const SizedBox(height: 8),
                      Text(context.tr('saved_offline_hint'),
                          textAlign: TextAlign.center, style: RfType.body(size: 12, color: RfColors.textMuted)),
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
}

class _DateTile extends StatelessWidget {
  const _DateTile({required this.label, required this.value, required this.onPicked});
  final String label;
  final String? value;
  final ValueChanged<String?> onPicked;

  @override
  Widget build(BuildContext context) {
    return Panel(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: Dates.toLocal(value) ?? DateTime.now(),
          firstDate: DateTime(2000),
          lastDate: DateTime.now(),
        );
        if (picked != null) onPicked(Dates.ymd(picked));
      },
      child: Row(
        children: [
          Expanded(child: Text(label, style: RfType.body(size: 14, color: RfColors.textSoft))),
          Text(value == null ? context.tr('choose_date') : Fmt.date(value, context.lang),
              style: RfType.mono(size: 14, color: value == null ? RfColors.textMuted : RfColors.text)),
        ],
      ),
    );
  }
}

class _PedigreePickers extends ConsumerWidget {
  const _PedigreePickers({
    required this.currentId,
    required this.sireId,
    required this.damId,
    required this.onSire,
    required this.onDam,
  });

  final String? currentId;
  final String? sireId;
  final String? damId;
  final ValueChanged<String?> onSire;
  final ValueChanged<String?> onDam;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dogs = ref.watch(dogsProvider).valueOrNull ?? const <Dog>[];
    final males = dogs.where((d) => d.sex == 'M' && d.id != currentId).toList();
    final females = dogs.where((d) => d.sex == 'F' && d.id != currentId).toList();
    Widget picker(String label, List<Dog> options, String? value, ValueChanged<String?> onChanged) {
      return DropdownButtonFormField<String?>(
        initialValue: options.any((d) => d.id == value) ? value : null,
        isExpanded: true,
        dropdownColor: RfColors.panel,
        decoration: InputDecoration(labelText: label),
        items: [
          DropdownMenuItem<String?>(value: null, child: Text(context.tr('unknown'))),
          for (final d in options) DropdownMenuItem<String?>(value: d.id, child: Text(d.name)),
        ],
        onChanged: onChanged,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionLabel(context.tr('pedigree')),
        const SizedBox(height: 8),
        picker(context.tr('sire'), males, sireId, onSire),
        const SizedBox(height: 12),
        picker(context.tr('dam'), females, damId, onDam),
      ],
    );
  }
}
