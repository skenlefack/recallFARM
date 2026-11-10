import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/widgets/common.dart';
import 'onboarding_scaffold.dart';

/// E01 — choice of speculation(s). Several choices allowed.
class SpeculationScreen extends ConsumerStatefulWidget {
  const SpeculationScreen({super.key});

  @override
  ConsumerState<SpeculationScreen> createState() => _SpeculationScreenState();
}

class _SpeculationOption {
  const _SpeculationOption(this.code, this.speculation, this.available);
  final String code; // label key: spec_<code>
  final String speculation; // farm.speculations value (packs)
  final bool available;
}

const _options = [
  _SpeculationOption('aviculture', 'volaille', true),
  _SpeculationOption('elevage_canin', 'chien', true),
  _SpeculationOption('pension_canine', 'chien', true),
  _SpeculationOption('dressage', 'chien', true),
  _SpeculationOption('petits_ruminants', 'petits_ruminants', false),
  _SpeculationOption('porcins', 'porcin', false),
  _SpeculationOption('bovins', 'bovin', false),
  _SpeculationOption('cuniculture', 'lapin', false),
];

class _SpeculationScreenState extends ConsumerState<SpeculationScreen> {
  final Set<String> _selected = {};

  @override
  void initState() {
    super.initState();
    final current = ref.read(sessionProvider).speculations;
    for (final o in _options) {
      if (current.contains(o.speculation) && o.available) _selected.add(o.code);
    }
  }

  @override
  Widget build(BuildContext context) {
    return OnboardingScaffold(
      step: 1,
      title: context.tr('onb_spec_title'),
      subtitle: context.tr('onb_spec_subtitle'),
      body: LayoutBuilder(builder: (context, c) {
        final columns = c.maxWidth > 340 ? 2 : 1;
        final w = (c.maxWidth - (columns - 1) * 10) / columns;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final o in _options)
              SizedBox(
                width: w,
                child: _tile(context, o),
              ),
          ],
        );
      }),
      actions: PillButton(
        label: context.tr('continue'),
        fontSize: 16,
        padding: const EdgeInsets.all(16),
        expand: true,
        onPressed: _selected.isEmpty
            ? null
            : () {
                final specs = <String>[];
                for (final o in _options) {
                  if (_selected.contains(o.code) && !specs.contains(o.speculation)) specs.add(o.speculation);
                }
                ref.read(sessionProvider).setSpeculations(specs);
              },
      ),
    );
  }

  Widget _tile(BuildContext context, _SpeculationOption o) {
    final selected = _selected.contains(o.code);
    return Semantics(
      selected: selected,
      enabled: o.available,
      button: true,
      child: Panel(
        radius: RfRadii.tile,
        color: selected ? RfColors.lime : RfColors.panel,
        borderColor: selected ? RfColors.lime : RfColors.line,
        onTap: o.available
            ? () => setState(() => selected ? _selected.remove(o.code) : _selected.add(o.code))
            : null,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 64),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                context.tr('spec_${o.code}'),
                style: RfType.body(
                  size: 15,
                  weight: FontWeight.w600,
                  color: selected ? RfColors.bg : (o.available ? RfColors.text : RfColors.textMuted),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                o.available ? context.tr('spec_${o.code}_desc') : context.tr('coming_soon'),
                style: RfType.body(size: 12, color: selected ? RfColors.bg : RfColors.textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
