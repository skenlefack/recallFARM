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
import '../economy/economy_common.dart';

const kTaskCategories = [
  'alimentation',
  'eau',
  'hygiene',
  'pesee',
  'reproduction',
  'biosecurite',
  'stock',
  'economie',
  'autre',
];
const kRecurrences = {'none': null, 'daily': 'FREQ=DAILY', 'weekly': 'FREQ=WEEKLY', 'monthly': 'FREQ=MONTHLY'};

/// E44 — tasks: Today / This week / Overdue, check « fait ».
class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(tasksProvider);
    final lang = context.lang;
    final today = Dates.today();
    final weekEnd = Dates.addDays(today, 7);
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('tasks'), subtitle: context.tr('tasks_subtitle')),
            Expanded(
              child: AsyncBuilder<List<TaskItem>>(
                value: tasks,
                builder: (all) {
                  final open = all.where((t) => !t.isDone && t.status != 'annule').toList();
                  final overdue = open.where((t) => t.dueDate.compareTo(today) < 0).toList();
                  final now = open.where((t) => t.dueDate == today).toList();
                  final week =
                      open.where((t) => t.dueDate.compareTo(today) > 0 && t.dueDate.compareTo(weekEnd) <= 0).toList();
                  Widget section(String key, List<TaskItem> list, Color color) {
                    if (list.isEmpty) return const SizedBox.shrink();
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: RfSpace.gap),
                        SectionLabel(context.tr(key), color: color),
                        for (final t in list)
                          CheckboxListTile(
                            value: false,
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: Text(t.title, style: RfType.body(size: 15, color: RfColors.text)),
                            subtitle: Text(
                              [
                                Fmt.date(t.dueDate, lang),
                                if (t.category != null) context.tr('task_cat_${t.category}'),
                                if (t.recurrence != null) context.tr('recurring'),
                              ].join(' · '),
                              style: RfType.body(size: 12, color: RfColors.textMuted),
                            ),
                            onChanged: (_) => ref.read(repositoryProvider).completeTask(t),
                          ),
                      ],
                    );
                  }

                  return ListView(
                    padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                    children: [
                      PillButton(
                        label: context.tr('new_task'),
                        expand: true,
                        onPressed: () => context.push('/tasks/new'),
                      ),
                      if (open.isEmpty) EmptyState(message: context.tr('no_tasks')),
                      section('overdue', overdue, RfColors.coral),
                      section('today', now, RfColors.amber),
                      section('this_week', week, RfColors.textMuted),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class TaskFormScreen extends ConsumerStatefulWidget {
  const TaskFormScreen({super.key});

  @override
  ConsumerState<TaskFormScreen> createState() => _TaskFormScreenState();
}

class _TaskFormScreenState extends ConsumerState<TaskFormScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  String? _category;
  String _recurrence = 'none';
  String _due = Dates.today();
  String? _subjectKey;
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    final router = GoRouter.of(context);
    final i = _subjectKey?.indexOf(':') ?? -1;
    await ref.read(repositoryProvider).saveTask({
      'id': Ids.newId(),
      'farm_id': ref.read(sessionProvider).farmId,
      'title': _title.text.trim(),
      if (_category != null) 'category': _category,
      'due_date': _due,
      'recurrence': kRecurrences[_recurrence],
      'status': 'a_faire',
      if (i > 0) 'subject_type': _subjectKey!.substring(0, i),
      if (i > 0) 'subject_id': _subjectKey!.substring(i + 1),
    });
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/tasks');
    }
  }

  @override
  Widget build(BuildContext context) {
    final subjects = ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    return SimpleFormPage(
      formKey: _form,
      title: context.tr('new_task'),
      busy: _busy,
      onSave: _save,
      children: [
        TextFormField(
          controller: _title,
          decoration: InputDecoration(labelText: '${context.tr('title')} *'),
          validator: (v) => (v ?? '').trim().isEmpty ? context.tr('err_required') : null,
        ),
        LabeledDropdown(
          label: context.tr('category'),
          value: _category,
          options: kTaskCategories,
          optionLabel: (o) => context.tr('task_cat_$o'),
          onChanged: (v) => setState(() => _category = v),
        ),
        LabeledDropdown(
          label: context.tr('subject_optional'),
          value: _subjectKey,
          options: [for (final s in subjects) '${s.subjectType}:${s.id}'],
          optionLabel: (o) => subjects.firstWhere((s) => '${s.subjectType}:${s.id}' == o).name,
          onChanged: (v) => setState(() => _subjectKey = v),
        ),
        DateFieldTile(
          label: '${context.tr('due_date')} *',
          value: _due,
          future: true,
          onChanged: (v) => setState(() => _due = v),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final r in kRecurrences.keys)
              RfChip(
                label: context.tr('recur_$r'),
                selected: _recurrence == r,
                onTap: () => setState(() => _recurrence = r),
              ),
          ],
        ),
      ],
    );
  }
}
