import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/i18n/strings.dart';
import '../../core/params/form_engine.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/glyphs.dart';

/// Option of a `subject_ref` field.
class SubjectOption {
  const SubjectOption(this.id, this.label);
  final String id;
  final String label;
}

/// Generic renderer of a resolved `form` object (dossier 12 §6). Values are owned
/// by the parent; every edit calls [onChanged] with the updated map.
class FormRenderer extends StatefulWidget {
  const FormRenderer({
    super.key,
    required this.engine,
    required this.values,
    required this.onChanged,
    required this.label,
    this.exprContext = const {},
    this.showErrors = false,
    this.subjectOptions = const {},
    this.iotValues = const {},
    this.hiddenFields = const {},
  });

  final FormEngine engine;
  final Map<String, Object?> values;
  final ValueChanged<Map<String, Object?>> onChanged;

  /// Pack i18n lookup (labels and option codes).
  final String Function(String key) label;
  final Map<String, Object?> exprContext;
  final bool showErrors;

  /// For `subject_ref` fields: ref kind (`batch`/`dog`/`subject`) → options.
  final Map<String, List<SubjectOption>> subjectOptions;

  /// Field code → value read from a connected device (e.g. water meter).
  final Map<String, num> iotValues;
  final Set<String> hiddenFields;

  @override
  State<FormRenderer> createState() => _FormRendererState();
}

class _FormRendererState extends State<FormRenderer> {
  final Map<String, TextEditingController> _controllers = {};
  final Set<String> _manual = {};

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _display(FieldSpec f, Object? v) {
    if (v == null) return '';
    if (f.type == 'integer' && v is num) return Fmt.integer(v, context.lang);
    if (f.type == 'decimal' && v is num) return Fmt.number(v, context.lang, maxDigits: 3);
    return v.toString();
  }

  TextEditingController _controller(FieldSpec f) {
    final existing = _controllers[f.code];
    if (existing != null) return existing;
    final c = TextEditingController(text: _display(f, widget.values[f.code]));
    _controllers[f.code] = c;
    return c;
  }

  /// Keeps controllers in sync with external value changes (stepper, prefill).
  @override
  void didUpdateWidget(covariant FormRenderer oldWidget) {
    super.didUpdateWidget(oldWidget);
    for (final f in widget.engine.spec.fields) {
      final c = _controllers[f.code];
      if (c == null) continue;
      final v = widget.values[f.code];
      final current = FormEngine.normalise(f, c.text);
      final incoming = FormEngine.normalise(f, v);
      if (current?.toString() != incoming?.toString()) {
        final text = _display(f, v);
        c.value = TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
      }
    }
  }

  void _set(String code, Object? value) {
    final next = Map<String, Object?>.from(widget.values);
    if (value == null || (value is String && value.isEmpty)) {
      next.remove(code);
    } else {
      next[code] = value;
    }
    widget.onChanged(next);
  }

  String _labelOf(FieldSpec f, bool required) {
    final base = widget.label(f.label);
    return required ? '$base *' : base;
  }

  @override
  Widget build(BuildContext context) {
    final ev = widget.engine.evaluate(widget.values, context: widget.exprContext, validate: widget.showErrors);
    final all = [
      for (final f in widget.engine.spec.fields)
        if (ev.isVisible(f.code) && !widget.hiddenFields.contains(f.code)) f
    ];
    // A computed field is shown right under the first input it references
    // (MobileJournal: « Taux de ponte calculé » under the egg stepper).
    final attached = <String, List<FieldSpec>>{};
    final visible = <FieldSpec>[];
    for (final f in all) {
      if (f.type == 'computed' && f.expr != null) {
        FieldSpec? target;
        for (final g in all) {
          if (g.type != 'computed' && RegExp('\\.${g.code}\\b').hasMatch(f.expr!)) {
            target = g;
            break;
          }
        }
        if (target != null) {
          attached.putIfAbsent(target.code, () => []).add(f);
          continue;
        }
      }
      visible.add(f);
    }
    final children = <Widget>[];
    var i = 0;
    while (i < visible.length) {
      final f = visible[i];
      final next = i + 1 < visible.length ? visible[i + 1] : null;
      // Two compact numeric fields side by side (MobileJournal: Morts | Aliment).
      if (_isCompact(f) &&
          next != null &&
          _isCompact(next) &&
          !attached.containsKey(f.code) &&
          !attached.containsKey(next.code) &&
          MediaQuery.of(context).size.width >= 340) {
        children.add(Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _field(context, f, ev)),
            const SizedBox(width: 12),
            Expanded(child: _field(context, next, ev)),
          ],
        ));
        i += 2;
      } else {
        final extra = attached[f.code];
        if (extra == null) {
          children.add(_field(context, f, ev));
        } else {
          children.add(Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _field(context, f, ev),
              for (final c in extra) ...[const SizedBox(height: 8), _field(context, c, ev)],
            ],
          ));
        }
        i += 1;
      }
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var k = 0; k < children.length; k++) ...[
          if (k > 0) const SizedBox(height: 18),
          children[k],
        ],
      ],
    );
  }

  bool _isCompact(FieldSpec f) =>
      (f.type == 'integer' || f.type == 'decimal') &&
      f.widget != 'stepper' &&
      !widget.iotValues.containsKey(f.code);

  Widget _field(BuildContext context, FieldSpec f, FormEvaluation ev) {
    final required = ev.isRequired(f.code);
    final error = widget.showErrors ? ev.errors[f.code] : null;
    Widget input;
    switch (f.type) {
      case 'computed':
        return _computed(context, f, ev.computed[f.code]);
      case 'integer':
      case 'decimal':
        if (widget.iotValues.containsKey(f.code) && !_manual.contains(f.code)) {
          input = _iot(context, f);
        } else if (f.widget == 'stepper') {
          input = _stepper(context, f, error != null);
        } else {
          input = _numberField(context, f, error != null);
        }
        break;
      case 'date':
        input = _date(context, f, error != null);
        break;
      case 'select':
        input = f.widget == 'chips' ? _chips(context, f) : _dropdown(context, f, error != null);
        break;
      case 'boolean':
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: widget.values[f.code] == true,
          onChanged: (v) => _set(f.code, v),
          title: Text(_labelOf(f, required), style: RfType.body(size: 14, color: RfColors.textSoft)),
        );
      case 'rfid':
        input = _textField(context, f, error != null, rfid: true);
        break;
      case 'subject_ref':
        input = _subjectRef(context, f, error != null);
        break;
      default:
        input = _textField(context, f, error != null);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(_labelOf(f, required), style: RfType.body(size: 14, color: RfColors.textSoft)),
        const SizedBox(height: 8),
        input,
        if (error != null) ...[
          const SizedBox(height: 6),
          Semantics(
            liveRegion: true,
            child: Text(_errorText(context, error), style: RfType.body(size: 12, color: RfColors.coral)),
          ),
        ],
      ],
    );
  }

  String _errorText(BuildContext context, FieldError e) {
    switch (e.code) {
      case 'min':
        return context.tr('err_min', {'min': Fmt.number(e.params['min'] as num?, context.lang)});
      case 'max':
        return context.tr('err_max', {'max': Fmt.number(e.params['max'] as num?, context.lang)});
      default:
        return context.tr('err_${e.code}');
    }
  }

  InputDecoration _decoration({String? suffix, bool error = false, bool lime = false, String? hint}) {
    final color = error ? RfColors.coral : (lime ? RfColors.lime : RfColors.border);
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(lime ? RfRadii.input : RfRadii.field),
      borderSide: BorderSide(color: color),
    );
    return InputDecoration(
      isDense: true,
      hintText: hint,
      suffixText: suffix,
      suffixStyle: RfType.mono(size: 13, color: RfColors.textMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      enabledBorder: border,
      border: border,
    );
  }

  Widget _numberField(BuildContext context, FieldSpec f, bool error) {
    return SizedBox(
      height: 52,
      child: TextField(
        controller: _controller(f),
        keyboardType: TextInputType.numberWithOptions(decimal: f.type == 'decimal'),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ,.  ]'))],
        style: RfType.mono(size: 20, color: RfColors.text),
        decoration: _decoration(suffix: f.unit, error: error),
        onChanged: (t) => _set(f.code, t),
      ),
    );
  }

  Widget _stepper(BuildContext context, FieldSpec f, bool error) {
    final current = FormEngine.normalise(f, widget.values[f.code]) as num?;
    final min = f.min ?? 0;
    final max = f.max;
    void bump(int delta) {
      final next = (current ?? 0) + delta;
      if (next < min) return;
      if (max != null && next > max) return;
      _set(f.code, next.toInt());
    }

    Widget sideButton(String symbol, String semantic, VoidCallback onTap) => Semantics(
          button: true,
          label: semantic,
          child: SizedBox(
            width: 52,
            height: 52,
            child: OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                padding: EdgeInsets.zero,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(RfRadii.input)),
                side: const BorderSide(color: RfColors.border),
                foregroundColor: RfColors.text,
              ),
              child: ExcludeSemantics(child: Text(symbol, style: RfType.body(size: 22, color: RfColors.text))),
            ),
          ),
        );

    return Row(
      children: [
        sideButton('−', context.tr('minus'), () => bump(-1)),
        const SizedBox(width: 10),
        Expanded(
          child: SizedBox(
            height: 52,
            child: TextField(
              controller: _controller(f),
              textAlign: TextAlign.center,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9   ]'))],
              style: RfType.mono(size: 24, color: RfColors.text),
              decoration: _decoration(error: error, lime: true),
              onChanged: (t) => _set(f.code, t),
            ),
          ),
        ),
        const SizedBox(width: 10),
        sideButton('+', context.tr('plus'), () => bump(1)),
      ],
    );
  }

  Widget _iot(BuildContext context, FieldSpec f) {
    final v = widget.iotValues[f.code]!;
    return Semantics(
      button: true,
      hint: context.tr('tap_to_edit'),
      child: Panel(
        dashed: true,
        color: Colors.transparent,
        borderColor: RfColors.dashed,
        radius: RfRadii.field,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        onTap: () => setState(() => _manual.add(f.code)),
        child: Row(
          children: [
            const RfGlyph(Glyph.drop, size: 18, color: RfColors.cyan, strokeWidth: 1.3),
            const SizedBox(width: 10),
            Text('${Fmt.number(v, context.lang)} ${(f.unit ?? '').toUpperCase()}',
                style: RfType.mono(size: 18, color: RfColors.text)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                context.tr('from_connected_meter'),
                textAlign: TextAlign.end,
                style: RfType.body(size: 12, color: RfColors.cyan),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _textField(BuildContext context, FieldSpec f, bool error, {bool rfid = false}) {
    return TextField(
      controller: _controller(f),
      keyboardType: rfid ? TextInputType.number : TextInputType.text,
      maxLength: rfid ? 19 : null,
      textCapitalization: rfid ? TextCapitalization.none : TextCapitalization.sentences,
      inputFormatters: rfid ? [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ]'))] : null,
      style: rfid ? RfType.mono(size: 16, color: RfColors.text) : RfType.body(size: 15, color: RfColors.text),
      decoration: _decoration(error: error, hint: rfid ? '120 093 000 418 271' : null).copyWith(counterText: ''),
      onChanged: (t) => _set(f.code, t),
    );
  }

  Widget _date(BuildContext context, FieldSpec f, bool error) {
    final v = widget.values[f.code]?.toString();
    return Semantics(
      button: true,
      label: _labelOf(f, false),
      value: v == null ? '' : Fmt.date(v, context.lang),
      child: InkWell(
        borderRadius: BorderRadius.circular(RfRadii.field),
        onTap: () async {
          final initial = Dates.toLocal(v) ?? DateTime.now();
          final picked = await showDatePicker(
            context: context,
            initialDate: initial,
            firstDate: DateTime(1990),
            lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
          );
          if (picked != null) _set(f.code, Dates.ymd(picked));
        },
        child: InputDecorator(
          decoration: _decoration(error: error),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  v == null ? context.tr('choose_date') : Fmt.date(v, context.lang),
                  style: RfType.mono(size: 16, color: v == null ? RfColors.textMuted : RfColors.text),
                ),
              ),
              const Icon(Icons.calendar_today_outlined, size: 18, color: RfColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _chips(BuildContext context, FieldSpec f) {
    final v = widget.values[f.code]?.toString();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final o in f.options)
          RfChip(label: widget.label(o), selected: v == o, onTap: () => _set(f.code, o)),
      ],
    );
  }

  Widget _dropdown(BuildContext context, FieldSpec f, bool error) {
    final v = widget.values[f.code]?.toString();
    return DropdownButtonFormField<String>(
      initialValue: f.options.contains(v) ? v : null,
      isExpanded: true,
      dropdownColor: RfColors.panel,
      decoration: _decoration(error: error),
      hint: Text(context.tr('choose'), style: RfType.body(size: 14, color: RfColors.textMuted)),
      items: [
        for (final o in f.options)
          DropdownMenuItem(value: o, child: Text(widget.label(o), style: RfType.body(size: 15, color: RfColors.text))),
      ],
      onChanged: (x) => _set(f.code, x),
    );
  }

  Widget _subjectRef(BuildContext context, FieldSpec f, bool error) {
    final options = widget.subjectOptions[f.ref ?? 'subject'] ?? const <SubjectOption>[];
    final v = widget.values[f.code]?.toString();
    return DropdownButtonFormField<String>(
      initialValue: options.any((o) => o.id == v) ? v : null,
      isExpanded: true,
      dropdownColor: RfColors.panel,
      decoration: _decoration(error: error),
      hint: Text(context.tr('choose'), style: RfType.body(size: 14, color: RfColors.textMuted)),
      items: [
        for (final o in options)
          DropdownMenuItem(value: o.id, child: Text(o.label, style: RfType.body(size: 15, color: RfColors.text))),
      ],
      onChanged: (x) => _set(f.code, x),
    );
  }

  Widget _computed(BuildContext context, FieldSpec f, Object? value) {
    final text = value == null
        ? '—'
        : (value is num ? Fmt.number(value, context.lang, maxDigits: 1) : value.toString());
    return Semantics(
      liveRegion: true,
      child: Text(
        context.tr('computed_value', {
          'label': widget.label(f.label),
          'value': f.unit == null ? text : '$text ${f.unit}',
        }),
        style: RfType.body(size: 12, color: RfColors.lime),
      ),
    );
  }
}
