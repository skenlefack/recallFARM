import '../params/expr/evaluator.dart' show formatDate, parseDateLoose;

export '../params/expr/evaluator.dart' show formatDate, parseDateLoose;

/// Calendar-date helpers. Business dates are `YYYY-MM-DD` strings (dossier 05).
class Dates {
  Dates._();

  /// Overridable clock (tests).
  static DateTime Function() clock = DateTime.now;

  static String today() => ymd(clock());

  static String ymd(DateTime d) => formatDate(DateTime.utc(d.year, d.month, d.day));

  static String addDays(String ymdStr, int days) {
    final d = parseDateLoose(ymdStr)!;
    return formatDate(DateTime.utc(d.year, d.month, d.day + days));
  }

  static int daysBetween(String from, String to) =>
      parseDateLoose(to)!.difference(parseDateLoose(from)!).inDays;

  static DateTime? toLocal(String? ymdStr) {
    if (ymdStr == null) return null;
    final d = parseDateLoose(ymdStr);
    return d == null ? null : DateTime(d.year, d.month, d.day);
  }

  static String nowIso() => clock().toUtc().toIso8601String();

  /// Age in whole years from a birth date.
  static int ageYears(String birth, [String? at]) {
    final b = parseDateLoose(birth)!;
    final now = parseDateLoose(at ?? today())!;
    var years = now.year - b.year;
    if (now.month < b.month || (now.month == b.month && now.day < b.day)) years--;
    return years < 0 ? 0 : years;
  }

  /// First day of the month of [ymdStr].
  static String monthStart(String ymdStr) {
    final d = parseDateLoose(ymdStr)!;
    return formatDate(DateTime.utc(d.year, d.month, 1));
  }

  static String previousMonthStart(String ymdStr) {
    final d = parseDateLoose(ymdStr)!;
    return formatDate(DateTime.utc(d.year, d.month - 1, 1));
  }
}
