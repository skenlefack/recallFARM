// Pure Dart — no Flutter imports.
// Form engine (dossier 12 §6): visibility, requirement, computed fields, validation,
// and mapping to entity payloads via `maps_to`.
import 'expr/expression.dart';

class FieldSpec {
  const FieldSpec({
    required this.code,
    required this.type,
    required this.label,
    this.required = false,
    this.requiredIf,
    this.visibleIf,
    this.min,
    this.max,
    this.pattern,
    this.options = const [],
    this.defaultValue,
    this.unit,
    this.widget,
    this.expr,
    this.mapsTo,
    this.ref,
  });

  factory FieldSpec.fromJson(Map<String, dynamic> j) => FieldSpec(
        code: j['code'].toString(),
        type: (j['type'] ?? 'text').toString(),
        label: (j['label'] ?? j['code']).toString(),
        required: j['required'] == true,
        requiredIf: j['required_if']?.toString(),
        visibleIf: j['visible_if']?.toString(),
        min: (j['min'] as num?)?.toDouble(),
        max: (j['max'] as num?)?.toDouble(),
        pattern: j['pattern']?.toString(),
        options: [for (final o in (j['options'] as List? ?? const [])) o.toString()],
        defaultValue: j['default'],
        unit: j['unit']?.toString(),
        widget: j['widget']?.toString(),
        expr: j['expr']?.toString(),
        mapsTo: j['maps_to']?.toString(),
        ref: j['ref']?.toString(),
      );

  final String code;

  /// text | integer | decimal | date | select | boolean | computed | rfid | subject_ref
  final String type;

  /// i18n key of the label.
  final String label;
  final bool required;
  final String? requiredIf;
  final String? visibleIf;
  final double? min;
  final double? max;
  final String? pattern;
  final List<String> options;
  final Object? defaultValue;
  final String? unit;

  /// `stepper` | `chips` | null
  final String? widget;
  final String? expr;
  final String? mapsTo;

  /// For `subject_ref`: `batch` | `dog` | `subject`.
  final String? ref;

  bool get isNumeric => type == 'integer' || type == 'decimal';
}

class FormSpec {
  const FormSpec({
    required this.code,
    required this.appliesTo,
    required this.fields,
    this.species,
  });

  factory FormSpec.fromJson(Map<String, dynamic> j) => FormSpec(
        code: j['code'].toString(),
        appliesTo: (j['applies_to'] ?? '').toString(),
        species: j['species']?.toString(),
        fields: [
          for (final f in (j['fields'] as List? ?? const []))
            if (f is Map) FieldSpec.fromJson(Map<String, dynamic>.from(f))
        ],
      );

  final String code;
  final String appliesTo;
  final String? species;
  final List<FieldSpec> fields;

  /// Namespace under which the values are exposed to expressions.
  String get namespace => appliesTo == 'daily_log' ? 'log' : 'subject';
}

class FieldError {
  const FieldError(this.code, [this.params = const {}]);

  /// required | min | max | pattern | number | rfid | date
  final String code;
  final Map<String, Object?> params;

  @override
  String toString() => 'FieldError($code, $params)';
}

class FormEvaluation {
  FormEvaluation({
    required this.visible,
    required this.required,
    required this.computed,
    required this.errors,
    required this.expressionErrors,
  });

  final Map<String, bool> visible;
  final Map<String, bool> required;
  final Map<String, Object?> computed;
  final Map<String, FieldError> errors;

  /// Field code → expression error code (for diagnostics; never blocks the user).
  final Map<String, String> expressionErrors;

  bool get isValid => errors.isEmpty;
  bool isVisible(String code) => visible[code] ?? true;
  bool isRequired(String code) => required[code] ?? false;
}

final RegExp _rfid15 = RegExp(r'^[0-9]{15}$');
final RegExp _ymd = RegExp(r'^\d{4}-\d{2}-\d{2}$');

class FormEngine {
  FormEngine(this.spec) : _byCode = {for (final f in spec.fields) f.code: f};

  final FormSpec spec;
  final Map<String, FieldSpec> _byCode;

  /// Default values (`default` of the pack). Computed fields are excluded.
  Map<String, Object?> initialValues() {
    final out = <String, Object?>{};
    for (final f in spec.fields) {
      if (f.type == 'computed') continue;
      final d = f.defaultValue;
      if (d == null) continue;
      out[f.code] = f.type == 'integer' && d is num
          ? d.toInt()
          : f.type == 'decimal' && d is num
              ? d.toDouble()
              : d;
    }
    return out;
  }

  /// Builds the expression context: [base] + the current values exposed under
  /// the form namespace (`log` for daily logs, `subject` otherwise) and `form`.
  Map<String, Object?> buildContext(
      Map<String, Object?> values, Map<String, Object?> base, Map<String, Object?> computed) {
    final ns = spec.namespace;
    final nsMap = <String, Object?>{};
    final baseNs = base[ns];
    if (baseNs is Map) {
      baseNs.forEach((k, v) => nsMap[k.toString()] = v);
    }
    final typed = <String, Object?>{};
    values.forEach((k, v) {
      final f = _byCode[k];
      final t = f == null ? v : normalise(f, v);
      if (t != null && !(t is String && t.isEmpty)) {
        nsMap[k] = t;
        typed[k] = t;
      }
    });
    nsMap.addAll(computed);
    return <String, Object?>{
      ...base,
      ns: nsMap,
      'form': <String, Object?>{...typed, ...computed},
    };
  }

  FormEvaluation evaluate(
    Map<String, Object?> values, {
    Map<String, Object?> context = const {},
    bool validate = true,
  }) {
    final computed = <String, Object?>{};
    final visible = <String, bool>{};
    final required = <String, bool>{};
    final errors = <String, FieldError>{};
    final exprErrors = <String, String>{};

    // 1. computed fields, in declaration order (later ones may use earlier ones).
    for (final f in spec.fields) {
      if (f.type != 'computed' || f.expr == null) continue;
      final ctx = buildContext(values, context, computed);
      final r = Expressions.evaluate(f.expr!, ctx);
      if (r.ok) {
        computed[f.code] = r.value;
      } else {
        computed[f.code] = null;
        exprErrors[f.code] = r.error ?? 'error';
      }
    }

    final ctx = buildContext(values, context, computed);

    // 2. visibility & requirement
    for (final f in spec.fields) {
      var isVisible = true;
      if (f.visibleIf != null) {
        final r = Expressions.evaluate(f.visibleIf!, ctx);
        if (r.ok && r.value is bool) {
          isVisible = r.value as bool;
        } else if (!r.ok) {
          exprErrors[f.code] = r.error ?? 'error';
        }
      }
      visible[f.code] = isVisible;
      var isRequired = f.required;
      if (f.requiredIf != null) {
        final r = Expressions.evaluate(f.requiredIf!, ctx);
        if (r.ok && r.value == true) isRequired = true;
        if (!r.ok) exprErrors[f.code] = r.error ?? 'error';
      }
      required[f.code] = isVisible && isRequired;
    }

    // 3. validation
    if (validate) {
      for (final f in spec.fields) {
        if (!(visible[f.code] ?? true) || f.type == 'computed') continue;
        final err = validateField(f, values[f.code], required: required[f.code] ?? false);
        if (err != null) errors[f.code] = err;
      }
    }

    return FormEvaluation(
      visible: visible,
      required: required,
      computed: computed,
      errors: errors,
      expressionErrors: exprErrors,
    );
  }

  static bool _isEmpty(Object? v) => v == null || (v is String && v.trim().isEmpty);

  static FieldError? validateField(FieldSpec f, Object? value, {required bool required}) {
    if (_isEmpty(value)) {
      return required ? const FieldError('required') : null;
    }
    switch (f.type) {
      case 'integer':
      case 'decimal':
        {
          final n = value is num ? value.toDouble() : parseNumber(value.toString());
          if (n == null) return const FieldError('number');
          if (f.type == 'integer' && n != n.truncateToDouble()) {
            return const FieldError('number');
          }
          if (f.min != null && n < f.min!) return FieldError('min', {'min': f.min});
          if (f.max != null && n > f.max!) return FieldError('max', {'max': f.max});
          return null;
        }
      case 'rfid':
        {
          final s = value.toString().replaceAll(' ', '');
          final re = f.pattern != null ? RegExp(f.pattern!) : _rfid15;
          if (!_rfid15.hasMatch(s) || !re.hasMatch(s)) return const FieldError('rfid');
          return null;
        }
      case 'date':
        {
          final s = value.toString();
          if (!_ymd.hasMatch(s) || parseDateLoose(s) == null) return const FieldError('date');
          return null;
        }
      case 'select':
        {
          if (f.options.isNotEmpty && !f.options.contains(value.toString())) {
            return const FieldError('pattern');
          }
          return null;
        }
      default:
        {
          if (f.pattern != null && value is String) {
            if (!RegExp(f.pattern!).hasMatch(value)) {
              return FieldError('pattern', {'pattern': f.pattern});
            }
          }
          return null;
        }
    }
  }

  /// Maps visible values to an entity payload using `maps_to`
  /// (`name` → top-level, `attributes.color` → nested). Unmapped fields go to
  /// `attributes.<code>` so nothing typed is lost (RG-MDD-07).
  Map<String, dynamic> toPayload(Map<String, Object?> values, FormEvaluation evaluation) {
    final out = <String, dynamic>{};
    final attributes = <String, dynamic>{};
    for (final f in spec.fields) {
      if (!evaluation.isVisible(f.code)) continue;
      Object? v;
      if (f.type == 'computed') {
        if (f.mapsTo == null) continue;
        v = evaluation.computed[f.code];
      } else {
        v = normalise(f, values[f.code]);
      }
      if (v == null) continue;
      final target = f.mapsTo ?? 'attributes.${f.code}';
      if (target.startsWith('attributes.')) {
        attributes[target.substring('attributes.'.length)] = v;
      } else {
        out[target] = v;
      }
    }
    out['attributes'] = attributes;
    return out;
  }

  /// Reverse of [toPayload]: reads values for the form from a stored record.
  Map<String, Object?> valuesFromRecord(Map<String, dynamic> record) {
    final out = <String, Object?>{};
    final attrs = record['attributes'];
    for (final f in spec.fields) {
      if (f.type == 'computed') continue;
      final target = f.mapsTo ?? 'attributes.${f.code}';
      Object? v;
      if (target.startsWith('attributes.')) {
        v = attrs is Map ? attrs[target.substring('attributes.'.length)] : null;
      } else {
        v = record[target];
      }
      if (v != null) out[f.code] = v;
    }
    return out;
  }

  /// Converts raw UI values (strings) to typed values.
  static Object? normalise(FieldSpec f, Object? v) {
    if (_isEmpty(v)) return null;
    switch (f.type) {
      case 'integer':
        {
          final n = v is num ? v.toDouble() : parseNumber(v.toString());
          return n?.round();
        }
      case 'decimal':
        return v is num ? v.toDouble() : parseNumber(v.toString());
      case 'boolean':
        return v is bool ? v : v.toString() == 'true';
      case 'rfid':
        return v.toString().replaceAll(' ', '');
      default:
        return v is String ? v.trim() : v;
    }
  }

  /// Parses user-typed numbers: `1 512`, `1 512,5`, `236.4`.
  static double? parseNumber(String s) {
    final cleaned = s
        .replaceAll(' ', '')
        .replaceAll(' ', '')
        .replaceAll(' ', '')
        .replaceAll(',', '.');
    if (cleaned.isEmpty) return null;
    return double.tryParse(cleaned);
  }
}
