import 'package:flutter/material.dart';

import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';

const kPaymentMethods = ['orange_money', 'mtn_momo', 'especes', 'credit'];

/// List page layout: header, CTA, rows.
class SimpleListPage extends StatelessWidget {
  const SimpleListPage({
    super.key,
    required this.title,
    this.subtitle,
    required this.ctaLabel,
    required this.onCta,
    required this.children,
    this.summary,
  });

  final String title;
  final String? subtitle;
  final String ctaLabel;
  final VoidCallback onCta;
  final List<Widget> children;
  final Widget? summary;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: title, subtitle: subtitle),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                children: [
                  PillButton(label: ctaLabel, expand: true, onPressed: onCta),
                  if (summary != null) ...[const SizedBox(height: RfSpace.gap), summary!],
                  const SizedBox(height: RfSpace.gap),
                  ...children,
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Form page layout: header, scrollable fields, save button + offline hint.
class SimpleFormPage extends StatelessWidget {
  const SimpleFormPage({
    super.key,
    required this.title,
    required this.children,
    required this.onSave,
    this.busy = false,
    this.formKey,
  });

  final String title;
  final List<Widget> children;
  final VoidCallback? onSave;
  final bool busy;
  final GlobalKey<FormState>? formKey;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Form(
          key: formKey,
          child: Column(
            children: [
              ScreenHeader(title: title, close: true),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 12, RfSpace.gutter, 24),
                  children: [
                    for (var i = 0; i < children.length; i++) ...[
                      if (i > 0) const SizedBox(height: 14),
                      children[i],
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
                      busy: busy,
                      onPressed: onSave,
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
      ),
    );
  }
}

/// Date picker field returning `YYYY-MM-DD`.
class DateFieldTile extends StatelessWidget {
  const DateFieldTile({super.key, required this.label, required this.value, required this.onChanged, this.future = false});
  final String label;
  final String? value;
  final ValueChanged<String> onChanged;
  final bool future;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(RfRadii.field),
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: Dates.toLocal(value) ?? DateTime.now(),
          firstDate: DateTime(2000),
          lastDate: future ? DateTime.now().add(const Duration(days: 365 * 5)) : DateTime.now(),
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

/// Simple dropdown with i18n labels.
class LabeledDropdown extends StatelessWidget {
  const LabeledDropdown({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.optionLabel,
    required this.onChanged,
  });

  final String label;
  final String? value;
  final List<String> options;
  final String Function(String) optionLabel;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: options.contains(value) ? value : null,
      isExpanded: true,
      dropdownColor: RfColors.panel,
      decoration: InputDecoration(labelText: label),
      items: [for (final o in options) DropdownMenuItem(value: o, child: Text(optionLabel(o)))],
      onChanged: onChanged,
    );
  }
}

double? parseAmount(String s) {
  final t = s.replaceAll(RegExp(r'[\s  ]'), '').replaceAll(',', '.');
  return t.isEmpty ? null : double.tryParse(t);
}
