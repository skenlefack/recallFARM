import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/ids.dart';
import '../../core/widgets/common.dart';
import 'onboarding_scaffold.dart';

/// E04 — farm creation (works offline; pushed by the sync engine).
class FarmSetupScreen extends ConsumerStatefulWidget {
  const FarmSetupScreen({super.key});

  @override
  ConsumerState<FarmSetupScreen> createState() => _FarmSetupScreenState();
}

class _FarmSetupScreenState extends ConsumerState<FarmSetupScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _region = TextEditingController();
  final _area = TextEditingController();
  final _manager = TextEditingController();
  String _country = 'CM';
  bool _calendar = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _manager.text = ref.read(sessionProvider).name ?? '';
  }

  @override
  void dispose() {
    _name.dispose();
    _region.dispose();
    _area.dispose();
    _manager.dispose();
    super.dispose();
  }

  Future<void> _save(List<ParamPack> packs) async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    final session = ref.read(sessionProvider);
    final repo = ref.read(repositoryProvider);
    final paramsRepo = ref.read(paramsRepositoryProvider);
    final pays = packs.where((p) => p.code == 'pays.$_country').toList();
    final currency = pays.isEmpty ? 'XAF' : (pays.first.currency ?? 'XAF');
    final farmId = Ids.newId();
    final area = double.tryParse(_area.text.replaceAll(',', '.'));
    await repo.saveFarm({
      'id': farmId,
      'name': _name.text.trim(),
      'speculations': session.speculations,
      'country': _country,
      if (_region.text.trim().isNotEmpty) 'region': _region.text.trim(),
      'currency': currency,
      if (area != null) 'area_ha': area,
      if (_manager.text.trim().isNotEmpty) 'manager_name': _manager.text.trim(),
    });
    if (_calendar) {
      // EF-ONB-04: activate the speculation's standard calendar (pack task templates).
      final res = await paramsRepo.resolve(country: _country, speculations: session.speculations);
      final hasChair = session.speculations.contains('volaille');
      for (final t in res.ofKind('task_template')) {
        if (t['production_type'] == 'chair' && !hasChair) continue;
        final trigger = t['trigger'];
        final every = trigger is Map ? (trigger['every_days'] as num?)?.toInt() : null;
        await repo.saveTask({
          'id': Ids.newId(),
          'farm_id': farmId,
          'template_id': t['code'],
          'title': res.label(t['code'].toString(), session.language),
          'category': t['category'],
          'due_date': Dates.today(),
          'recurrence': every == 1 ? 'FREQ=DAILY' : (every == 7 ? 'FREQ=WEEKLY' : null),
          'status': 'a_faire',
        });
      }
    }
    await session.setFarm(farmId);
  }

  @override
  Widget build(BuildContext context) {
    final packsAsync = ref.watch(_packsProvider);
    final packs = packsAsync.valueOrNull ?? const <ParamPack>[];
    final countries = {
      for (final p in packs)
        if (p.level == 'pays' && p.country != null) p.country!: p.currency ?? ''
    };
    if (countries.isEmpty) countries['CM'] = 'XAF';
    final currency = countries[_country] ?? 'XAF';
    return OnboardingScaffold(
      step: 4,
      title: context.tr('onb_farm_title'),
      subtitle: context.tr('onb_farm_subtitle'),
      body: Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(labelText: '${context.tr('farm_name')} *', hintText: 'Ferme de Mfou'),
              validator: (v) {
                final t = v?.trim() ?? '';
                if (t.length < 3 || t.length > 80) return context.tr('err_farm_name');
                return null;
              },
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: countries.containsKey(_country) ? _country : countries.keys.first,
              dropdownColor: RfColors.panel,
              decoration: InputDecoration(labelText: '${context.tr('country')} *'),
              items: [
                for (final c in countries.keys)
                  DropdownMenuItem(value: c, child: Text(context.tr('country_$c'))),
              ],
              onChanged: (v) => setState(() => _country = v ?? 'CM'),
            ),
            const SizedBox(height: 6),
            Text(context.tr('currency_is', {'currency': currency}),
                style: RfType.body(size: 12, color: RfColors.textMuted)),
            const SizedBox(height: 14),
            TextFormField(controller: _region, decoration: InputDecoration(labelText: context.tr('region'))),
            const SizedBox(height: 14),
            TextFormField(
              controller: _area,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: context.tr('area_ha')),
              validator: (v) {
                if (v == null || v.trim().isEmpty) return null;
                final n = double.tryParse(v.replaceAll(',', '.'));
                return n == null || n < 0 ? context.tr('err_number') : null;
              },
            ),
            const SizedBox(height: 14),
            TextFormField(controller: _manager, decoration: InputDecoration(labelText: context.tr('manager'))),
            const SizedBox(height: 10),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _calendar,
              onChanged: (v) => setState(() => _calendar = v),
              title: Text(context.tr('activate_calendar'), style: RfType.body(size: 14, color: RfColors.text)),
              subtitle: Text(context.tr('activate_calendar_desc'),
                  style: RfType.body(size: 12, color: RfColors.textMuted)),
            ),
            Text(context.tr('gps_later'), style: RfType.body(size: 12, color: RfColors.textMuted)),
          ],
        ),
      ),
      actions: PillButton(
        label: context.tr('save'),
        fontSize: 16,
        padding: const EdgeInsets.all(16),
        expand: true,
        busy: _busy,
        onPressed: () => _save(packs),
      ),
    );
  }
}

final _packsProvider = FutureProvider<List<ParamPack>>((ref) => ref.read(paramsRepositoryProvider).allPacks());
