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
import '../../core/widgets/common.dart';
import '../../core/widgets/glyphs.dart';

/// E11 — Cheptel (lots and dogs).
class LivestockScreen extends ConsumerWidget {
  const LivestockScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subjects = ref.watch(subjectsProvider);
    final res = ref.watch(resolutionProvider).valueOrNull;
    final specs = ref.watch(sessionProvider.select((s) => s.speculations));
    final lang = context.lang;
    String label(String? code) => code == null ? '' : (res?.label(code, lang) ?? code);

    return ListView(
      padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 10, RfSpace.gutter, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(context.tr('my_farm'), style: RfType.body(size: 13, color: RfColors.textMuted)),
                  Semantics(
                    header: true,
                    child: Text(context.tr('livestock'), style: RfType.title(size: 27, color: RfColors.text)),
                  ),
                ],
              ),
            ),
            const ConnectionBadge(),
          ],
        ),
        const SizedBox(height: RfSpace.gap),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (specs.contains('volaille'))
              PillButton(label: context.tr('add_batch'), onPressed: () => context.push('/livestock/add/batch')),
            if (specs.contains('chien'))
              PillButton(
                label: context.tr('add_dog'),
                kind: specs.contains('volaille') ? PillKind.outline : PillKind.lime,
                onPressed: () => context.push('/livestock/add/dog'),
              ),
            PillButton(
              label: context.tr('daily_journal'),
              kind: PillKind.outline,
              bold: false,
              onPressed: () => context.push('/journal'),
            ),
          ],
        ),
        const SizedBox(height: RfSpace.gap),
        AsyncBuilder<List<Subject>>(
          value: subjects,
          builder: (list) {
            if (list.isEmpty) {
              return EmptyState(message: context.tr('livestock_empty'));
            }
            final batches = list.whereType<Batch>().toList();
            final dogs = list.whereType<Dog>().toList();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (batches.isNotEmpty) ...[
                  SectionLabel(context.tr('batches')),
                  const SizedBox(height: 8),
                  for (final b in batches) ...[
                    _SubjectTile(
                      icon: Icons.egg_outlined,
                      title: context.tr('batch_named', {'name': b.name}),
                      subtitle: [
                        label(b.productionType),
                        context.tr('n_birds', {'n': Fmt.integer(b.currentCount, lang)}),
                        context.tr('week_n', {'n': b.ageDays() ~/ 7 + 1}),
                      ].where((e) => e.isNotEmpty).join(' · '),
                      status: b.isActive ? null : context.tr('batch_status_${b.status}'),
                      dirty: b.isDirty,
                      onTap: () => context.push('/livestock/batch/${b.id}'),
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
                if (dogs.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  SectionLabel(context.tr('dogs')),
                  const SizedBox(height: 8),
                  for (final d in dogs) ...[
                    _SubjectTile(
                      icon: Icons.pets_outlined,
                      title: d.name,
                      subtitle: [
                        if (d.breed != null) d.breed!,
                        if (d.sex != null) label(d.sex),
                        if (d.birthDate != null) context.tr('age_years', {'n': Dates.ageYears(d.birthDate!)}),
                      ].join(' · '),
                      dirty: d.isDirty,
                      onTap: () => context.push('/livestock/dog/${d.id}'),
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
              ],
            );
          },
        ),
      ],
    );
  }
}

class _SubjectTile extends StatelessWidget {
  const _SubjectTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.status,
    this.dirty = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? status;
  final bool dirty;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Panel(
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: RfColors.panel2, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, color: RfColors.lime, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: RfType.body(size: 16, weight: FontWeight.w600, color: RfColors.text)),
                Text(subtitle, style: RfType.body(size: 12, color: RfColors.textMuted)),
                if (status != null) Text(status!, style: RfType.body(size: 12, color: RfColors.amber)),
                if (dirty)
                  Text(context.tr('pending_sync_item'), style: RfType.body(size: 11, color: RfColors.cyan)),
              ],
            ),
          ),
          const RfGlyph(Glyph.chevron, size: 16, color: RfColors.chevron),
        ],
      ),
    );
  }
}
