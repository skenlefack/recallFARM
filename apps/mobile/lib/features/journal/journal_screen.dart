import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/expr/expression.dart';
import '../../core/params/form_engine.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/glyphs.dart';
import '../farm_live/farm_live_screen.dart' show cachedLiveTiles;
import '../forms/form_renderer.dart';
import '../livestock/subject_form_screen.dart' show findForm;

/// E13 — daily journal, reproduced from MobileJournal.dc.html.
class JournalScreen extends ConsumerStatefulWidget {
  const JournalScreen({super.key, this.subjectRef});

  /// `batch:<id>` or `dog:<id>`
  final String? subjectRef;

  @override
  ConsumerState<JournalScreen> createState() => _JournalScreenState();
}

class _JournalScreenState extends ConsumerState<JournalScreen> {
  String? _subjectKey;
  String _date = Dates.today();
  Map<String, Object?> _values = {};
  String? _loadedFor;
  String? _existingId;
  int _previousMortalityToday = 0;
  bool _showErrors = false;
  bool _busy = false;
  Map<String, num> _iot = const {};

  @override
  void initState() {
    super.initState();
    _subjectKey = widget.subjectRef;
    _loadIot();
  }

  Future<void> _loadIot() async {
    final farmId = ref.read(sessionProvider).farmId;
    if (farmId == null) return;
    final tiles = await cachedLiveTiles(ref.read(localDbProvider), farmId);
    final out = <String, num>{};
    for (final t in tiles) {
      final metric = t['metric']?.toString() ?? '';
      final v = t['value'];
      if (v is num && (metric == 'water' || metric == 'water_flow' || metric == 'eau' || metric == 'water_l')) {
        out['water_l'] = v;
      }
    }
    if (mounted && out.isNotEmpty) setState(() => _iot = out);
  }

  Subject? _pick(List<Subject> subjects) {
    final active = subjects.where((s) => s is! Batch || s.isActive).toList();
    if (_subjectKey != null) {
      for (final s in active) {
        if ('${s.subjectType}:${s.id}' == _subjectKey) return s;
      }
    }
    if (active.isEmpty) return null;
    final ponte = active.whereType<Batch>().where((b) => b.productionType == 'ponte');
    return ponte.isNotEmpty ? ponte.first : active.first;
  }

  /// Present count = last known count, excluding today's own mortality when editing.
  int? _presentCount(Subject s) {
    if (s is! Batch) return null;
    return s.currentCount + _previousMortalityToday;
  }

  Future<void> _loadExisting(Subject s, FormEngine engine) async {
    final key = '${s.subjectType}:${s.id}|$_date';
    if (_loadedFor == key) return;
    _loadedFor = key;
    final farmId = ref.read(sessionProvider).farmId!;
    final existing = await ref.read(repositoryProvider).dailyLogFor(farmId, s.id, _date);
    if (!mounted) return;
    setState(() {
      _existingId = existing?['id']?.toString();
      _previousMortalityToday = existing == null
          ? 0
          : ((existing['mortality'] as num?)?.toInt() ?? 0) + ((existing['culled'] as num?)?.toInt() ?? 0);
      _values = existing == null ? engine.initialValues() : {...engine.initialValues(), ...engine.valuesFromRecord(existing)};
      if (existing == null && _iot.containsKey('water_l')) _values['water_l'] = _iot['water_l'];
      _showErrors = false;
    });
  }

  Map<String, Object?> _ctx(Subject s, Resolution res) => {
        'now': _date,
        'subject': s.toContext(),
        'log': {'present_count': _presentCount(s), 'log_date': _date},
        'params': _ruleParams(res),
      };

  Map<String, Object?> _ruleParams(Resolution res) {
    final out = <String, Object?>{};
    for (final r in res.ofKind('alert_rule')) {
      final p = r['params'];
      if (p is Map) p.forEach((k, v) => out[k.toString()] = v);
    }
    return out;
  }

  Future<void> _save(Subject s, FormEngine engine, Resolution res) async {
    final ctx = _ctx(s, res);
    final ev = engine.evaluate(_values, context: ctx);
    final present = _presentCount(s);
    final mortality = (FormEngine.normalise(
          engine.spec.fields.firstWhere((f) => f.code == 'mortality',
              orElse: () => const FieldSpec(code: 'mortality', type: 'integer', label: 'morts')),
          _values['mortality'],
        ) as num?) ??
        0;
    if (!ev.isValid) {
      setState(() => _showErrors = true);
      return;
    }
    // RG-JOU-03: mortality ≤ present count (blocking).
    if (present != null && mortality > present) {
      showSnack(context, context.tr('err_mortality_gt_present'));
      return;
    }
    setState(() => _busy = true);
    final farmId = ref.read(sessionProvider).farmId!;
    final repo = ref.read(repositoryProvider);
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final savedMsg = context.tr('journal_saved');
    final payload = engine.toPayload(_values, ev);
    await repo.saveDailyLog({
      ...payload,
      'id': _existingId ?? Ids.newId(),
      'farm_id': farmId,
      'subject_type': s.subjectType,
      'subject_id': s.id,
      'log_date': _date,
      if (present != null) 'present_count': present,
      'param_version': res.paramVersion,
    });

    // Local evaluation of the resolved alert rules (RG-JOU-06): shown at once, offline.
    final logCtx = <String, Object?>{
      ...ctx,
      'log': {...(ctx['log'] as Map<String, Object?>), ...payload, 'present_count': present},
    };
    final triggered = <Map<String, dynamic>>[];
    for (final rule in res.ofKind('alert_rule')) {
      if (rule['source'] != 'daily_logs') continue;
      final when = rule['when']?.toString();
      if (when == null) continue;
      final ruleCtx = {
        ...logCtx,
        'params': rule['params'] is Map ? Map<String, Object?>.from(rule['params'] as Map) : const <String, Object?>{},
      };
      if (Expressions.evaluate(when, ruleCtx).isTrue) triggered.add(rule);
    }
    if (!mounted) return;
    setState(() => _busy = false);
    if (triggered.isNotEmpty) {
      await _showRuleDialog(triggered, res);
    }
    messenger.showSnackBar(SnackBar(content: Text(savedMsg)));
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/home');
    }
  }

  Future<void> _showRuleDialog(List<Map<String, dynamic>> rules, Resolution res) {
    final lang = context.lang;
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: RfColors.alertBg,
        title: Text(dialogContext.tr('abnormal_signal'), style: RfType.title(size: 20, color: RfColors.alertText)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final r in rules)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('• ${res.label(r['code'].toString(), lang)}',
                    style: RfType.body(size: 14, color: RfColors.alertMuted)),
              ),
            const SizedBox(height: 6),
            Text(dialogContext.tr('abnormal_signal_body'), style: RfType.body(size: 13, color: RfColors.alertMuted)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(dialogContext.tr('later'), style: const TextStyle(color: RfColors.alertText)),
          ),
          PillButton(
            label: dialogContext.tr('report_suspicion'),
            kind: PillKind.coral,
            onPressed: () {
              Navigator.of(dialogContext).pop();
              showSnack(context, context.tr('v1_feature'));
            },
          ),
        ],
      ),
    );
  }

  String _subtitle(Subject s, Resolution res, String lang) {
    if (s is Batch) {
      final pt = s.productionType;
      final ptLabel = pt == null ? '' : context.tr('pt_plural_$pt');
      return [
        context.tr('batch_named', {'name': s.name}),
        if (ptLabel.isNotEmpty && ptLabel != 'pt_plural_$pt') ptLabel else if (pt != null) res.label(pt, lang),
        context.tr('week_n', {'n': s.ageDays(_date) ~/ 7 + 1}),
      ].join(' · ');
    }
    return context.tr('dog_quoted', {'name': s.name});
  }

  @override
  Widget build(BuildContext context) {
    final subjectsAsync = ref.watch(subjectsProvider);
    final resAsync = ref.watch(resolutionProvider);
    final online = ref.watch(connectivityProvider.select((c) => c.online));
    final lang = context.lang;
    final subjects = subjectsAsync.valueOrNull;
    final res = resAsync.valueOrNull;

    Widget body;
    Subject? subject;
    FormEngine? engine;
    if (subjects == null || res == null) {
      body = const SkeletonList();
    } else {
      subject = _pick(subjects);
      if (subject == null) {
        body = EmptyState(
          message: context.tr('journal_no_subject'),
          actionLabel: context.tr('add_animal'),
          onAction: () => context.go('/livestock'),
        );
      } else {
        final spec = findForm(res, 'daily_log', subject.species);
        if (spec == null) {
          body = EmptyState(message: context.tr('form_unavailable'));
        } else {
          final e = FormEngine(spec);
          engine = e;
          final s = subject;
          Future.microtask(() => _loadExisting(s, e));
          body = ListView(
            padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 18, RfSpace.gutter, 16),
            children: [
              _subjectAndDate(context, subjects, subject, lang),
              const SizedBox(height: 18),
              FormRenderer(
                engine: e,
                values: _values,
                onChanged: (v) => setState(() => _values = v),
                label: (k) => res.label(k, lang),
                exprContext: _ctx(subject, res),
                showErrors: _showErrors,
                iotValues: _iot,
                hiddenFields: const {'notes'},
              ),
              const SizedBox(height: 18),
              _notesAndVoice(context),
            ],
          );
        }
      }
    }

    final filled = engine == null ? 0 : _completion(engine);
    final saveSubject = subject;
    final saveEngine = engine;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(
              title: context.tr('daily_journal'),
              subtitle: subject == null || res == null ? null : _subtitle(subject, res, lang),
              close: true,
              trailing: online
                  ? null
                  : Text(context.tr('offline'), style: RfType.mono(size: 13, color: RfColors.amber)),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 10, RfSpace.gutter, 0),
              child: Semantics(
                label: context.tr('completion', {'n': filled, 'total': 3}),
                child: Row(
                  children: [
                    for (var i = 0; i < 3; i++) ...[
                      Expanded(
                        child: Container(
                          height: 3,
                          decoration: BoxDecoration(
                            color: i < filled ? RfColors.lime : RfColors.border,
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                      ),
                      if (i < 2) const SizedBox(width: 4),
                    ],
                  ],
                ),
              ),
            ),
            Expanded(child: body),
            Padding(
              padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 14, RfSpace.gutter, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  PillButton(
                    label: context.tr('save'),
                    fontSize: 16,
                    padding: const EdgeInsets.all(16),
                    busy: _busy,
                    onPressed: saveSubject == null || saveEngine == null || res == null
                        ? null
                        : () => _save(saveSubject, saveEngine, res),
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

  /// 0..3 segments: share of visible fields filled in.
  int _completion(FormEngine engine) {
    final ev = engine.evaluate(_values, validate: false);
    final fields = engine.spec.fields.where((f) => f.type != 'computed' && ev.isVisible(f.code)).toList();
    if (fields.isEmpty) return 0;
    final filled = fields.where((f) => _values[f.code] != null && _values[f.code].toString().isNotEmpty).length;
    return (filled / fields.length * 3).ceil().clamp(0, 3).toInt();
  }

  Widget _subjectAndDate(BuildContext context, List<Subject> subjects, Subject current, String lang) {
    final active = subjects.where((s) => s is! Batch || s.isActive).toList();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (active.length > 1)
          for (final s in active)
            RfChip(
              label: s.name,
              selected: s.id == current.id,
              onTap: () => setState(() {
                _subjectKey = '${s.subjectType}:${s.id}';
                _loadedFor = null;
              }),
            ),
        ActionChip(
          backgroundColor: RfColors.panel,
          side: const BorderSide(color: RfColors.border),
          shape: const StadiumBorder(),
          avatar: const Icon(Icons.calendar_today_outlined, size: 16, color: RfColors.textMuted),
          label: Text(Fmt.date(_date, lang), style: RfType.mono(size: 13, color: RfColors.text)),
          onPressed: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: Dates.toLocal(_date) ?? DateTime.now(),
              firstDate: DateTime.now().subtract(const Duration(days: 365)),
              lastDate: DateTime.now(), // E13: date ≤ today
            );
            if (picked != null && mounted) {
              setState(() {
                _date = Dates.ymd(picked);
                _loadedFor = null;
              });
            }
          },
        ),
      ],
    );
  }

  Widget _notesAndVoice(BuildContext context) {
    return Panel(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      radius: RfRadii.input,
      onTap: () => showSnack(context, context.tr('voice_note_soon')),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: RfColors.border)),
            child: const Center(child: RfGlyph(Glyph.mic, size: 16, color: RfColors.text, strokeWidth: 1.3)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(context.tr('add_voice_note'), style: RfType.body(size: 14, color: RfColors.textSoft)),
          ),
        ],
      ),
    );
  }
}
