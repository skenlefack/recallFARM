import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_client.dart';
import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/db/local_db.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';

/// Certificate QR data: `GET /health-events/:id/certificate.json` → `{qr_payload, valid_until}`,
/// cached locally so the QR is available offline once fetched.
class CertificateData {
  const CertificateData({required this.payload, required this.validUntil});
  final String payload;
  final String? validUntil;
}

Future<CertificateData?> loadCertificate(LocalDb db, ApiClient api, String eventId, {bool online = true}) async {
  final cached = await db.getKvJson('cert.$eventId');
  if (cached != null && cached['qr_payload'] is String) {
    return CertificateData(payload: cached['qr_payload'] as String, validUntil: cached['valid_until']?.toString());
  }
  if (!online) return null;
  try {
    final j = await api.get('/health-events/$eventId/certificate.json');
    if (j['qr_payload'] is! String) return null;
    await db.setKvJson('cert.$eventId', j);
    return CertificateData(payload: j['qr_payload'] as String, validUntil: j['valid_until']?.toString());
  } on ApiException {
    return null;
  }
}

final certificateProvider = FutureProvider.autoDispose.family<CertificateData?, String>((ref, eventId) async {
  final online = ref.watch(connectivityProvider.select((c) => c.online));
  return loadCertificate(ref.read(localDbProvider), ref.read(apiClientProvider), eventId, online: online);
});

/// The QR block (also embedded in the dog profile rabies card).
class CertificateQr extends StatelessWidget {
  const CertificateQr({super.key, required this.payload, this.size = 76});
  final String payload;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: context.tr('qr_rabies_certificate'),
      child: Container(
        width: size + 16,
        height: size + 16,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(color: RfColors.cream, borderRadius: BorderRadius.circular(14)),
        child: QrImageView(
          data: payload,
          version: QrVersions.auto,
          size: size,
          padding: EdgeInsets.zero,
          backgroundColor: RfColors.cream,
          eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: RfColors.creamText),
          dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: RfColors.creamText),
        ),
      ),
    );
  }
}

/// E23 — vaccination certificate (⭐ Pro: `certificat_qr`).
class CertificateScreen extends ConsumerWidget {
  const CertificateScreen({super.key, required this.eventId});
  final String eventId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ent = ref.watch(entitlementsProvider);
    final lang = context.lang;
    if (!ent.has('certificat_qr')) {
      return Scaffold(
        body: SafeArea(
          child: Column(children: [
            ScreenHeader(title: context.tr('certificate')),
            LockedFeature(feature: 'certificat_qr', onUpgrade: () => context.push('/subscription')),
          ]),
        ),
      );
    }
    final cert = ref.watch(certificateProvider(eventId));
    final events = ref.watch(healthEventsProvider).valueOrNull ?? const <HealthEvent>[];
    final subjects = ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    final res = ref.watch(resolutionProvider).valueOrNull;
    HealthEvent? event;
    for (final e in events) {
      if (e.id == eventId) event = e;
    }
    Subject? subject;
    for (final s in subjects) {
      if (s.id == event?.subjectId) subject = s;
    }
    final dog = subject is Dog ? subject : null;
    String masked(String? chip) {
      if (chip == null || chip.length < 6) return chip ?? '—';
      return '${chip.substring(0, 3)} ••• ••• ${chip.substring(chip.length - 3)}';
    }

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(
              title: context.tr('certificate'),
              subtitle: event?.disease == null ? null : (res?.label(event!.disease!, lang) ?? event!.disease),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                children: [
                  Center(
                    child: AsyncBuilder<CertificateData?>(
                      value: cert,
                      loading: const SizedBox(height: 220, child: Center(child: CircularProgressIndicator())),
                      builder: (c) => c == null
                          ? Panel(
                              child: Text(context.tr('qr_after_sync'),
                                  textAlign: TextAlign.center,
                                  style: RfType.body(size: 13, color: RfColors.textSoft)),
                            )
                          : Column(
                              children: [
                                CertificateQr(payload: c.payload, size: 200),
                                const SizedBox(height: 10),
                                Text(
                                  context.tr('valid_until', {'date': Fmt.date(c.validUntil, lang)}),
                                  style: RfType.title(size: 20, color: RfColors.text),
                                ),
                                const SizedBox(height: 12),
                                PillButton(
                                  label: context.tr('share_certificate'),
                                  kind: PillKind.outline,
                                  onPressed: () async {
                                    final messenger = ScaffoldMessenger.of(context);
                                    final msg = context.tr('payload_copied');
                                    await Clipboard.setData(ClipboardData(text: c.payload));
                                    messenger.showSnackBar(SnackBar(content: Text(msg)));
                                  },
                                ),
                              ],
                            ),
                    ),
                  ),
                  const SizedBox(height: RfSpace.gap),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _row(context.tr('animal'), subject?.name ?? '—'),
                        if (dog != null) _row(context.tr('race'), dog.breed ?? '—'),
                        if (dog != null) _row(context.tr('chip'), masked(dog.chipNumber)),
                        _row(context.tr('vaccine'), event?.product ?? '—'),
                        _row(context.tr('product_lot'), event?.productBatchNo ?? '—'),
                        _row(context.tr('date'), Fmt.date(event?.eventDate, lang)),
                        _row(context.tr('performed_by'), event?.str('performed_by') ?? '—'),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(k, style: RfType.body(size: 13, color: RfColors.textMuted))),
            Expanded(child: Text(v, textAlign: TextAlign.end, style: RfType.mono(size: 13, color: RfColors.text))),
          ],
        ),
      );
}
