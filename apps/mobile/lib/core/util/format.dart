import 'package:intl/intl.dart';

import '../params/expr/evaluator.dart' show parseDateLoose;

/// Number/date formatting following the mock-ups (`1 512`, `76,4 %`, `30 oct. 2026`).
class Fmt {
  Fmt._();

  static String _locale(String lang) => lang == 'en' ? 'en' : 'fr';

  /// Integer with thousands separator (French: narrow no-break space).
  static String integer(num? v, String lang) {
    if (v == null) return '—';
    final s = NumberFormat.decimalPattern(_locale(lang)).format(v.round());
    return s.replaceAll(' ', ' ').replaceAll(' ', ' ');
  }

  static String dec(num? v, String lang, {int digits = 1}) {
    if (v == null) return '—';
    final f = NumberFormat.decimalPatternDigits(locale: _locale(lang), decimalDigits: digits);
    return f.format(v).replaceAll(' ', ' ').replaceAll(' ', ' ');
  }

  /// Compact decimal: no trailing `,0` (34,2 kg; 28,2°; 236).
  static String number(num? v, String lang, {int maxDigits = 2}) {
    if (v == null) return '—';
    final f = NumberFormat.decimalPattern(_locale(lang))..maximumFractionDigits = maxDigits;
    return f.format(v).replaceAll(' ', ' ').replaceAll(' ', ' ');
  }

  static String pct(num? v, String lang, {int digits = 1}) =>
      v == null ? '—' : '${dec(v, lang, digits: digits)} %';

  /// Money in minor units with the farm currency symbol (never hard-coded FCFA).
  static String money(num? amountMinor, String currencySymbol, String lang, {int minorUnit = 0}) {
    if (amountMinor == null) return '—';
    final major = minorUnit == 0 ? amountMinor : amountMinor / _pow10(minorUnit);
    final s = minorUnit == 0 ? integer(major, lang) : dec(major, lang, digits: minorUnit);
    return '$s $currencySymbol';
  }

  static num _pow10(int n) {
    var r = 1;
    for (var i = 0; i < n; i++) {
      r *= 10;
    }
    return r;
  }

  /// `30 oct. 2026`
  static String date(String? ymd, String lang) {
    if (ymd == null) return '—';
    final d = parseDateLoose(ymd);
    if (d == null) return ymd;
    return DateFormat.yMMMd(_locale(lang)).format(DateTime(d.year, d.month, d.day));
  }

  /// `30/10/2026`
  static String dateShort(String? ymd, String lang) {
    if (ymd == null) return '—';
    final d = parseDateLoose(ymd);
    if (d == null) return ymd;
    return DateFormat.yMd(_locale(lang)).format(DateTime(d.year, d.month, d.day));
  }

  static String time(DateTime t, String lang) => DateFormat.Hm(_locale(lang)).format(t.toLocal());

  /// `J-3`, `J`, `J+2`
  static String dayOffset(int daysFromToday) {
    if (daysFromToday == 0) return 'J';
    return daysFromToday > 0 ? 'J-$daysFromToday' : 'J+${-daysFromToday}';
  }

  /// Chip / microchip number grouped by 3: `120 093 000 418 271`.
  static String chip(String? v) {
    if (v == null || v.isEmpty) return '—';
    final digits = v.replaceAll(' ', '');
    final sb = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && i % 3 == 0) sb.write(' ');
      sb.write(digits[i]);
    }
    return sb.toString();
  }
}
