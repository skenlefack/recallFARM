import '../util/dates.dart';

/// Thin typed views over the JSON rows stored locally (the row map is the source).
abstract class Entity {
  Entity(this.data);
  final Map<String, dynamic> data;

  String get id => data['id'].toString();
  bool get isDirty => data['_dirty'] == true;
  Map<String, dynamic> get attributes =>
      data['attributes'] is Map ? Map<String, dynamic>.from(data['attributes'] as Map) : <String, dynamic>{};
  String? str(String k) => data[k]?.toString();
  num? numOf(String k) {
    final v = data[k];
    if (v is num) return v;
    if (v is String) return num.tryParse(v);
    return null;
  }
}

class Farm extends Entity {
  Farm(super.data);
  String get name => str('name') ?? '';
  List<String> get speculations =>
      [for (final s in (data['speculations'] as List? ?? const [])) s.toString()];
  String get country => str('country') ?? 'CM';
  String get currency => str('currency') ?? 'XAF';
  String? get region => str('region');
  String? get organisationId => str('organisation_id');
}

/// A livestock subject: a batch (lot/bande) or a dog.
abstract class Subject extends Entity {
  Subject(super.data);
  String get subjectType;
  String get name;
  String get species;
  String? get productionType;
  String? get referenceDate;
  String get createdDate => (str('created_at') ?? Dates.today()).substring(0, 10);

  /// Expression context of the subject (`subject.*`).
  Map<String, Object?> toContext() => {
        ...data,
        ...attributes,
        'species': species,
        'production_type': productionType,
      };
}

class Batch extends Subject {
  Batch(super.data, {this.cumulativeMortality = 0, this.cumulativeFeedKg = 0});

  /// Derived locally from daily logs (server recomputes `current_count`).
  final int cumulativeMortality;
  final double cumulativeFeedKg;

  @override
  String get subjectType => 'batch';
  @override
  String get name => str('name') ?? str('code') ?? '';
  @override
  String get species => str('species') ?? 'volaille';
  @override
  String? get productionType => str('production_type');
  @override
  String? get referenceDate => str('start_date');
  int get initialCount => numOf('initial_count')?.toInt() ?? 0;
  int get currentCount {
    final local = initialCount - cumulativeMortality;
    return local < 0 ? 0 : local;
  }

  String? get startDate => str('start_date');
  String get status => str('status') ?? 'en_cours';
  bool get isActive => status == 'en_cours';

  /// Age in days including the age at placement (`attributes.age_at_start_days`).
  int ageDays([String? at]) {
    final start = startDate;
    if (start == null) return 0;
    final atStart = (attributes['age_at_start_days'] as num?)?.toInt() ?? 0;
    return Dates.daysBetween(start, at ?? Dates.today()) + atStart;
  }

  @override
  Map<String, Object?> toContext() => {
        ...super.toContext(),
        'initial_count': initialCount,
        'current_count': currentCount,
        'cumulative_mortality': cumulativeMortality,
        'cumulative_feed_kg': cumulativeFeedKg,
      };
}

class Dog extends Subject {
  Dog(super.data);

  @override
  String get subjectType => 'dog';
  @override
  String get name => str('name') ?? '';
  @override
  String get species => 'chien';
  @override
  String? get productionType => attributes['role']?.toString();
  @override
  String? get referenceDate => str('birth_date');
  String? get breed => str('breed');
  String? get sex => str('sex');
  String? get birthDate => str('birth_date');
  String? get chipNumber => str('chip_number');
  String? get sireId => str('sire_id');
  String? get damId => str('dam_id');
}

class HealthEvent extends Entity {
  HealthEvent(super.data);
  String get subjectType => str('subject_type') ?? 'batch';
  String get subjectId => str('subject_id') ?? '';
  String get eventType => str('event_type') ?? 'vaccination';
  String? get disease => str('disease');
  String get eventDate => str('event_date') ?? Dates.today();
  String? get protocolStep => str('protocol_step');
  String? get product => str('product');
  String? get productBatchNo => str('product_batch_no');
  String? get nextDue => str('next_due');
}

/// Merged reminder shown in the UI: locally computed (engine) and/or server row.
class ReminderView {
  ReminderView({
    required this.key,
    required this.subjectType,
    required this.subjectId,
    required this.subjectName,
    required this.step,
    required this.disease,
    required this.dueDate,
    required this.status,
    required this.priority,
    required this.kind,
    this.serverId,
    this.route,
    this.subjectCount,
    this.speciesLabel,
    this.certificate = false,
  });

  /// `<subject_id>:<step>`
  final String key;
  final String subjectType;
  final String subjectId;
  final String subjectName;
  final String step;
  final String? disease;
  final String dueDate;
  final String status;
  final String priority;
  final String kind;
  final String? serverId;
  final String? route;
  final int? subjectCount;
  final String? speciesLabel;
  final bool certificate;

  bool get isOpen => status == 'en_retard' || status == 'aujourdhui' || status == 'a_venir';
  int daysFromToday([String? today]) => Dates.daysBetween(today ?? Dates.today(), dueDate);
}

class TaskItem extends Entity {
  TaskItem(super.data);
  String get title => str('title') ?? '';
  String get dueDate => str('due_date') ?? Dates.today();
  String get status => str('status') ?? 'a_faire';
  String? get category => str('category');
  String? get recurrence => str('recurrence');
  bool get isDone => status == 'fait';
}

/// Unified "to do" item for the home screen.
class TodoItem {
  TodoItem.reminder(ReminderView r)
      : reminder = r,
        task = null;
  TodoItem.task(TaskItem t)
      : task = t,
        reminder = null;

  final ReminderView? reminder;
  final TaskItem? task;

  String get dueDate => reminder?.dueDate ?? task!.dueDate;
  bool get isHigh => reminder?.priority == 'haute' || reminder?.priority == 'critique';
}
