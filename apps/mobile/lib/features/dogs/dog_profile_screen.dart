import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/data/reminder_service.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/glyphs.dart';
import '../health/certificate_screen.dart';

/// Rabies state of a dog (E30): valid until last rabies act + protocol recurrence.
class RabiesState {
  const RabiesState({required this.status, this.validUntil, this.lastEvent});

  /// a_jour | expire | inconnu
  final String status;
  final String? validUntil;
  final HealthEvent? lastEvent;

  static RabiesState of(Dog dog, List<HealthEvent> events, int everyDays) {
    HealthEvent? last;
    for (final e in events) {
      if (e.subjectId != dog.id || e.disease != 'rage') continue;
      if (last == null || e.eventDate.compareTo(last.eventDate) > 0) last = e;
    }
    if (last == null) return const RabiesState(status: 'inconnu');
    final until = Dates.addDays(last.eventDate, everyDays);
    return RabiesState(
      status: until.compareTo(Dates.today()) >= 0 ? 'a_jour' : 'expire',
      validUntil: until,
      lastEvent: last,
    );
  }
}

/// E30 — dog profile, reproduced from MobileChien.dc.html (cream theme).
class DogProfileScreen extends ConsumerWidget {
  const DogProfileScreen({super.key, required this.id});
  final String id;

  void _invoiceDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(c.tr('invoice')),
        content: Text(c.tr('invoice_v1')),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(c.tr('ok')))],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dogs = ref.watch(dogsProvider);
    final events = ref.watch(healthEventsProvider).valueOrNull ?? const <HealthEvent>[];
    final reminders = ref.watch(remindersProvider).valueOrNull ?? const <ReminderView>[];
    final res = ref.watch(resolutionProvider).valueOrNull;
    final ent = ref.watch(entitlementsProvider);
    final lang = context.lang;

    return Theme(
      data: AppTheme.cream(),
      child: Scaffold(
        backgroundColor: RfColors.cream,
        body: SafeArea(
          child: AsyncBuilder<List<Dog>>(
            value: dogs,
            builder: (list) {
              Dog? dog;
              for (final d in list) {
                if (d.id == id) dog = d;
              }
              if (dog == null) return EmptyState(message: context.tr('not_found'));
              final dg = dog;
              var every = 365;
              if (res != null) {
                final p = ReminderService.protocolFor(res, dg);
                final rec = p?['recurring'];
                if (rec is Map && rec['every_days'] is num) every = (rec['every_days'] as num).toInt();
              }
              final rabies = RabiesState.of(dg, events, every);
              final mine = events.where((e) => e.subjectId == dg.id).toList()
                ..sort((a, b) => a.eventDate.compareTo(b.eventDate));
              final upcoming = reminders.where((r) => r.subjectId == dg.id).toList();
              String label(String? c) => c == null ? '' : (res?.label(c, lang) ?? c);
              final role = dg.attributes['role']?.toString();
              return Column(
                children: [
                  _topBar(context, dg, role == null ? context.tr('kennel') : '${context.tr('kennel')} · ${label(role)}'),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 6, RfSpace.gutter, 16),
                      children: [
                        _header(context, dg, label, lang),
                        const SizedBox(height: RfSpace.gap),
                        _rabiesCard(context, ref, rabies, upcoming, ent.has('certificat_qr'), lang),
                        const SizedBox(height: RfSpace.gap),
                        SectionLabel(context.tr('health_book'), color: RfColors.creamMuted),
                        const SizedBox(height: 10),
                        _timeline(context, mine.reversed.take(3).toList().reversed.toList(), upcoming.take(2).toList(), label, lang),
                        const SizedBox(height: RfSpace.gap),
                        _chips(context, dg, lang),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 14, RfSpace.gutter, 24),
                    child: Row(
                      children: [
                        Expanded(
                          flex: 10,
                          child: _creamButton(context, context.tr('invoice'), outlined: true,
                              onTap: () => _invoiceDialog(context)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          flex: 14,
                          child: _creamButton(context, context.tr('record_act'),
                              onTap: () => context.push('/health/new?subject=dog:${dg.id}')),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _creamButton(BuildContext context, String text, {bool outlined = false, required VoidCallback onTap}) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        backgroundColor: outlined ? Colors.transparent : RfColors.brand,
        foregroundColor: outlined ? RfColors.creamText : RfColors.white,
        minimumSize: const Size(RfSpace.minTouch, 52),
        padding: const EdgeInsets.all(14),
        shape: StadiumBorder(side: outlined ? const BorderSide(color: RfColors.creamText) : BorderSide.none),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: RfType.body(
          size: 15,
          weight: outlined ? FontWeight.w400 : FontWeight.w600,
          color: outlined ? RfColors.creamText : RfColors.white,
        ),
      ),
    );
  }

  Widget _topBar(BuildContext context, Dog dog, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      child: Row(
        children: [
          IconButton(
            tooltip: context.tr('back'),
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const RfGlyph(Glyph.back, size: 24, color: RfColors.creamText, strokeWidth: 1.6),
          ),
          Expanded(
            child: Text(title, textAlign: TextAlign.center, style: RfType.body(size: 14, color: RfColors.creamMuted)),
          ),
          PopupMenuButton<String>(
            tooltip: context.tr('more_options'),
            icon: const RfGlyph(Glyph.dots, size: 24, color: RfColors.creamText),
            onSelected: (v) {
              switch (v) {
                case 'edit':
                  context.push('/livestock/add/dog?id=${dog.id}');
                  break;
                case 'genealogy':
                  context.push(dog.sex == 'F' ? '/genealogy?dam=${dog.id}' : '/genealogy?sire=${dog.id}');
                  break;
                case 'journal':
                  context.push('/journal?subject=dog:${dog.id}');
                  break;
              }
            },
            itemBuilder: (c) => [
              PopupMenuItem(value: 'edit', child: Text(c.tr('edit'))),
              PopupMenuItem(value: 'journal', child: Text(c.tr('daily_journal'))),
              PopupMenuItem(value: 'genealogy', child: Text(c.tr('check_mating'))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _header(BuildContext context, Dog dog, String Function(String?) label, String lang) {
    final sub = [
      if (dog.breed != null && dog.breed!.isNotEmpty) dog.breed!,
      if (dog.sex != null) label(dog.sex).toLowerCase(),
      if (dog.birthDate != null) context.tr('age_years', {'n': Dates.ageYears(dog.birthDate!)}),
    ].join(' · ');
    return Row(
      children: [
        Container(
          width: 84,
          height: 84,
          decoration: BoxDecoration(color: RfColors.creamAvatar, borderRadius: BorderRadius.circular(26)),
          child: const Center(child: RfGlyph(Glyph.dog, size: 52, color: RfColors.creamText, strokeWidth: 1.6)),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(dog.name, style: RfType.title(size: 30, weight: FontWeight.w800, color: RfColors.creamText)),
              ),
              const SizedBox(height: 4),
              if (sub.isNotEmpty) Text(sub, style: RfType.body(size: 14, color: RfColors.creamMuted)),
              if (dog.chipNumber != null) ...[
                const SizedBox(height: 4),
                Text('${context.tr('chip_short')} ${Fmt.chip(dog.chipNumber)}',
                    style: RfType.mono(size: 12, color: RfColors.creamMuted)),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _rabiesCard(BuildContext context, WidgetRef ref, RabiesState rabies, List<ReminderView> upcoming,
      bool pro, String lang) {
    final statusColor = rabies.status == 'a_jour'
        ? RfColors.lime
        : (rabies.status == 'expire' ? RfColors.coral : RfColors.amber);
    ReminderView? next;
    for (final r in upcoming) {
      if (r.disease == 'rage') {
        next = r;
        break;
      }
    }
    final daysLeft = rabies.validUntil == null ? null : Dates.daysBetween(Dates.today(), rabies.validUntil!);
    final dueSoon = daysLeft != null && daysLeft <= 30;
    final vet = rabies.lastEvent?.str('performed_by');
    final event = rabies.lastEvent;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: RfColors.brand, borderRadius: BorderRadius.circular(RfRadii.hero)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${context.tr('rabies').toUpperCase()} · ${context.tr('rabies_${rabies.status}').toUpperCase()}',
                  style: RfType.mono(size: 11, color: statusColor, letterSpacing: 0.66),
                ),
                const SizedBox(height: 8),
                Text(
                  rabies.validUntil == null
                      ? context.tr('rabies_no_record')
                      : context.tr('valid_until', {'date': Fmt.date(rabies.validUntil, lang)}),
                  style: RfType.title(size: 20, color: RfColors.text),
                ),
                if (daysLeft != null && (dueSoon || next != null)) ...[
                  const SizedBox(height: 8),
                  Text(
                    [
                      daysLeft >= 0
                          ? context.tr('reminder_in_days', {'n': daysLeft})
                          : context.tr('overdue_days', {'n': -daysLeft}),
                      if (vet != null) vet,
                    ].join(' · '),
                    style: RfType.body(size: 12, color: daysLeft < 0 ? RfColors.coral : RfColors.amber),
                  ),
                ],
                if (event != null && pro) ...[
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () => context.push('/health/certificate/${event.id}'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: RfColors.text,
                      side: const BorderSide(color: RfColors.brandOutline),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      shape: const StadiumBorder(),
                    ),
                    child: Text(context.tr('share_certificate'), style: RfType.body(size: 13, color: RfColors.text)),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 16),
          if (event != null && pro) _QrSlot(eventId: event.id) else _lockedQr(context, pro),
        ],
      ),
    );
  }

  Widget _lockedQr(BuildContext context, bool pro) {
    return Semantics(
      label: context.tr(pro ? 'qr_after_sync' : 'feature_certificat_qr'),
      child: Container(
        width: 92,
        height: 92,
        decoration: BoxDecoration(color: RfColors.cream, borderRadius: BorderRadius.circular(14)),
        child: Icon(pro ? Icons.qr_code_2 : Icons.lock_outline, color: RfColors.creamMuted, size: 36),
      ),
    );
  }

  Widget _timeline(BuildContext context, List<HealthEvent> done, List<ReminderView> next,
      String Function(String?) label, String lang) {
    final rows = <Widget>[];
    for (final e in done) {
      rows.add(_timelineRow(
        title: label(e.disease ?? e.eventType),
        subtitle: [Fmt.date(e.eventDate, lang), if (e.productBatchNo != null) context.tr('lot_n', {'n': e.productBatchNo})]
            .join(' · '),
        trailing: context.tr('done_short'),
        color: RfColors.creamOk,
        hollow: false,
      ));
    }
    for (final r in next) {
      rows.add(_timelineRow(
        title: context.tr('reminder_of', {'disease': label(r.disease)}),
        subtitle: Fmt.date(r.dueDate, lang),
        trailing: Fmt.dayOffset(r.daysFromToday()),
        color: r.status == 'en_retard' ? RfColors.coral : RfColors.creamDue,
        hollow: true,
      ));
    }
    if (rows.isEmpty) {
      return Text(context.tr('no_health_yet'), style: RfType.body(size: 13, color: RfColors.creamMuted));
    }
    return Container(
      margin: const EdgeInsets.only(left: 6),
      decoration: const BoxDecoration(border: Border(left: BorderSide(color: RfColors.creamLine))),
      child: Column(children: rows),
    );
  }

  Widget _timelineRow({
    required String title,
    required String subtitle,
    required String trailing,
    required Color color,
    required bool hollow,
  }) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 0, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: RfType.body(size: 15, color: RfColors.creamText)),
                    Text(subtitle, style: RfType.body(size: 12, color: RfColors.creamMuted)),
                  ],
                ),
              ),
              Text(trailing, style: RfType.body(size: 12, color: color)),
            ],
          ),
        ),
        Positioned(
          left: hollow ? -6 : -5,
          top: hollow ? 3 : 4,
          child: Container(
            width: hollow ? 11 : 9,
            height: hollow ? 11 : 9,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: hollow ? RfColors.cream : color,
              border: hollow ? Border.all(color: color, width: 2) : null,
            ),
          ),
        ),
      ],
    );
  }

  Widget _chips(BuildContext context, Dog dog, String lang) {
    final a = dog.attributes;
    String boarding = '—';
    final start = a['boarding_start']?.toString();
    final end = a['boarding_end']?.toString();
    if (start != null && end != null) {
      final day = Dates.daysBetween(start, Dates.today()) + 1;
      final total = Dates.daysBetween(start, end) + 1;
      boarding = 'J${day.clamp(0, total)} / $total';
    }
    final weight = a['weight_kg'] is num ? '${Fmt.number(a['weight_kg'] as num, lang, maxDigits: 1)} kg' : '—';
    final box = (a['box'] ?? '—').toString();
    Widget tile(String k, String v) => Expanded(
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: RfColors.white,
              border: Border.all(color: RfColors.creamCardBorder),
              borderRadius: BorderRadius.circular(RfRadii.input),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(k, style: RfType.body(size: 11, color: RfColors.creamMuted)),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(v, style: RfType.mono(size: 15, color: RfColors.creamText)),
                ),
              ],
            ),
          ),
        );
    return Row(
      children: [
        tile(context.tr('boarding'), boarding),
        const SizedBox(width: 8),
        tile(context.tr('weight'), weight),
        const SizedBox(width: 8),
        tile(context.tr('box'), box),
      ],
    );
  }
}

class _QrSlot extends ConsumerWidget {
  const _QrSlot({required this.eventId});
  final String eventId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cert = ref.watch(certificateProvider(eventId)).valueOrNull;
    if (cert == null) {
      return Semantics(
        label: context.tr('qr_after_sync'),
        child: Container(
          width: 92,
          height: 92,
          decoration: BoxDecoration(color: RfColors.cream, borderRadius: BorderRadius.circular(14)),
          child: const Icon(Icons.qr_code_2, color: RfColors.creamMuted, size: 36),
        ),
      );
    }
    return GestureDetector(
      onLongPress: () async {
        final messenger = ScaffoldMessenger.of(context);
        final msg = context.tr('payload_copied');
        await Clipboard.setData(ClipboardData(text: cert.payload));
        messenger.showSnackBar(SnackBar(content: Text(msg)));
      },
      child: CertificateQr(payload: cert.payload),
    );
  }
}
