import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/providers.dart';
import '../i18n/strings.dart';
import '../sync/sync_engine.dart';
import '../theme/tokens.dart';
import '../theme/typography.dart';
import 'glyphs.dart';

/// Pill button variants of the mock-ups.
enum PillKind { lime, dark, outlineDark, outline, brand, amber, coral, outlineCoral }

class PillButton extends StatelessWidget {
  const PillButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = PillKind.lime,
    this.fontSize = 14,
    this.bold = true,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    this.expand = false,
    this.busy = false,
    this.semanticsHint,
  });

  final String label;
  final VoidCallback? onPressed;
  final PillKind kind;
  final double fontSize;
  final bool bold;
  final EdgeInsets padding;
  final bool expand;
  final bool busy;
  final String? semanticsHint;

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    BorderSide side = BorderSide.none;
    switch (kind) {
      case PillKind.lime:
        bg = RfColors.lime;
        fg = RfColors.bg;
        break;
      case PillKind.dark:
        bg = RfColors.bg;
        fg = RfColors.onLimeButtonText;
        break;
      case PillKind.outlineDark:
        bg = Colors.transparent;
        fg = RfColors.bg;
        side = const BorderSide(color: RfColors.bg);
        break;
      case PillKind.outline:
        bg = Colors.transparent;
        fg = RfColors.text;
        side = const BorderSide(color: RfColors.border);
        break;
      case PillKind.brand:
        bg = RfColors.brand;
        fg = RfColors.white;
        break;
      case PillKind.amber:
        bg = RfColors.amber;
        fg = RfColors.bg;
        break;
      case PillKind.coral:
        bg = RfColors.coral;
        fg = RfColors.alertBg;
        break;
      case PillKind.outlineCoral:
        bg = Colors.transparent;
        fg = RfColors.alertText;
        side = const BorderSide(color: RfColors.alertLine);
        break;
    }
    final child = busy
        ? SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          )
        : Text(
            label,
            textAlign: TextAlign.center,
            style: RfType.body(size: fontSize, weight: bold ? FontWeight.w600 : FontWeight.w400, color: fg),
          );
    final button = TextButton(
      onPressed: busy ? null : onPressed,
      style: TextButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        disabledBackgroundColor: bg == Colors.transparent ? Colors.transparent : bg.withValues(alpha: 0.5),
        disabledForegroundColor: fg.withValues(alpha: 0.6),
        padding: padding,
        minimumSize: const Size(RfSpace.minTouch, RfSpace.minTouch),
        shape: StadiumBorder(side: side),
      ),
      child: child,
    );
    final semantic = Semantics(button: true, hint: semanticsHint, child: button);
    return expand ? SizedBox(width: double.infinity, child: semantic) : semantic;
  }
}

/// Panel (blue card) used across the screens.
class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.radius = RfRadii.tile,
    this.color = RfColors.panel,
    this.borderColor = RfColors.line,
    this.onTap,
    this.dashed = false,
  });

  final Widget child;
  final EdgeInsets padding;
  final double radius;
  final Color color;
  final Color borderColor;
  final VoidCallback? onTap;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    Widget content = Padding(padding: padding, child: child);
    if (onTap != null) {
      content = InkWell(onTap: onTap, borderRadius: BorderRadius.circular(radius), child: content);
    }
    if (dashed) {
      return CustomPaint(
        painter: DashedBorderPainter(color: borderColor, radius: radius),
        child: Material(color: color, borderRadius: BorderRadius.circular(radius), child: content),
      );
    }
    return Material(
      color: color,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: BorderSide(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: content,
    );
  }
}

class DashedBorderPainter extends CustomPainter {
  DashedBorderPainter({required this.color, required this.radius, this.dash = 4, this.gap = 3});
  final Color color;
  final double radius;
  final double dash;
  final double gap;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final rrect = RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius));
    final path = Path()..addRRect(rrect.deflate(0.5));
    for (final metric in path.computeMetrics()) {
      var d = 0.0;
      while (d < metric.length) {
        canvas.drawPath(metric.extractPath(d, d + dash), paint);
        d += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(DashedBorderPainter old) => old.color != color || old.radius != radius;
}

/// Small muted section title ("Cette semaine", "Carnet de santé").
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.color = RfColors.textMuted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Semantics(header: true, child: Text(text, style: RfType.body(size: 13, color: color)));
}

/// Screen header with close/back glyph, title and subtitle (MobileJournal, MobileGenealogie).
class ScreenHeader extends StatelessWidget {
  const ScreenHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.close = false,
    this.onBack,
    this.trailing,
    this.color = RfColors.text,
    this.mutedColor = RfColors.textMuted,
  });

  final String title;
  final String? subtitle;
  final bool close;
  final VoidCallback? onBack;
  final Widget? trailing;
  final Color color;
  final Color mutedColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 20, 4),
      child: Row(
        children: [
          IconButton(
            tooltip: context.tr(close ? 'close' : 'back'),
            onPressed: onBack ?? () => Navigator.of(context).maybePop(),
            icon: RfGlyph(close ? Glyph.close : Glyph.back, size: 24, color: color, strokeWidth: 1.6),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(title, style: RfType.title(size: 22, color: color)),
                ),
                if (subtitle != null)
                  Text(subtitle!, style: RfType.body(size: 12, color: mutedColor)),
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// "Hors ligne" amber pill of MobileAccueil; shows sync state when online.
class ConnectionBadge extends ConsumerWidget {
  const ConnectionBadge({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online = ref.watch(connectivityProvider.select((c) => c.online));
    final phase = ref.watch(syncEngineProvider.select((s) => s.phase));
    if (!online || phase == SyncPhase.offline) {
      return _pill(context, context.tr('offline'), RfColors.amber, RfColors.amberBorder);
    }
    if (phase == SyncPhase.syncing) {
      return _pill(context, context.tr('syncing'), RfColors.cyan, RfColors.border);
    }
    if (phase == SyncPhase.error) {
      return _pill(context, context.tr('sync_error_short'), RfColors.coral, RfColors.alertLine);
    }
    return const SizedBox.shrink();
  }

  Widget _pill(BuildContext context, String label, Color color, Color border) {
    return Semantics(
      liveRegion: true,
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(RfRadii.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 6),
            Text(label, style: RfType.body(size: 12, color: color)),
          ],
        ),
      ),
    );
  }
}

/// Dashed "N saisies seront envoyées au retour du réseau." banner.
class PendingSyncBanner extends ConsumerWidget {
  const PendingSyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref.watch(pendingSyncProvider);
    if (pending == 0) return const SizedBox.shrink();
    return Panel(
      dashed: true,
      color: Colors.transparent,
      borderColor: RfColors.border,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      onTap: () => ref.read(syncEngineProvider).sync(manual: true),
      child: Row(
        children: [
          const RfGlyph(Glyph.clock, color: RfColors.cyan, strokeWidth: 1.3),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              context.tr(pending == 1 ? 'pending_sync_one' : 'pending_sync_many', {'n': pending}),
              style: RfType.body(size: 13, color: RfColors.textSoft),
            ),
          ),
        ],
      ),
    );
  }
}

/// Polyline sparkline (KPI tiles, sensor tiles).
class Sparkline extends StatelessWidget {
  const Sparkline({
    super.key,
    required this.values,
    this.color = RfColors.lime,
    this.height = 28,
    this.fill = false,
    this.threshold,
    this.strokeWidth = 1.5,
  });

  final List<double> values;
  final Color color;
  final double height;
  final bool fill;
  final double? threshold;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: SizedBox(
          height: height,
          width: double.infinity,
          child: CustomPaint(painter: _SparkPainter(values, color, fill, threshold, strokeWidth)),
        ),
      );
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values, this.color, this.fill, this.threshold, this.strokeWidth);
  final List<double> values;
  final Color color;
  final bool fill;
  final double? threshold;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    var lo = values.reduce((a, b) => a < b ? a : b);
    var hi = values.reduce((a, b) => a > b ? a : b);
    final t = threshold;
    if (t != null) {
      if (t > hi) hi = t;
      if (t < lo) lo = t;
    }
    if (hi == lo) {
      hi += 1;
      lo -= 1;
    }
    final pad = (hi - lo) * 0.15;
    hi += pad;
    lo -= pad;
    double y(double v) => size.height - (v - lo) / (hi - lo) * size.height;
    final dx = size.width / (values.length - 1);
    final line = Path()..moveTo(0, y(values.first));
    for (var i = 1; i < values.length; i++) {
      line.lineTo(dx * i, y(values[i]));
    }
    if (t != null) {
      final dash = Paint()
        ..color = color
        ..strokeWidth = 1;
      var x = 0.0;
      while (x < size.width) {
        canvas.drawLine(Offset(x, y(t)), Offset(x + 3, y(t)), dash);
        x += 7;
      }
    }
    if (fill) {
      final area = Path.from(line)
        ..lineTo(size.width, size.height)
        ..lineTo(0, size.height)
        ..close();
      canvas.drawPath(area, Paint()..color = color.withValues(alpha: 0.12));
    }
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_SparkPainter old) => old.values != values || old.color != color;
}

/// Shows data as soon as it exists (keeps previous data during reloads, no
/// full-screen spinner — dossier 02 « États système communs »).
class AsyncBuilder<T> extends StatelessWidget {
  const AsyncBuilder({super.key, required this.value, required this.builder, this.loading});

  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    final v = value;
    if (v.hasValue) return builder(v.requireValue);
    if (v.hasError) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: Text('${context.tr('error_generic')}\n${v.error}',
            style: RfType.body(size: 13, color: RfColors.coral)),
      );
    }
    return loading ?? const SkeletonList();
  }
}

/// Skeleton placeholder rows.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.rows = 4});
  final int rows;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: context.tr('loading'),
      child: Padding(
        padding: const EdgeInsets.all(RfSpace.gutter),
        child: Column(
          children: [
            for (var i = 0; i < rows; i++)
              Container(
                height: 56,
                margin: const EdgeInsets.only(bottom: 10),
                decoration: BoxDecoration(color: RfColors.panel, borderRadius: BorderRadius.circular(RfRadii.tile)),
              ),
          ],
        ),
      ),
    );
  }
}

/// List row with leading label, title/subtitle and chevron (MobileAccueil upcoming list).
class ChevronRow extends StatelessWidget {
  const ChevronRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.leadingColor = RfColors.textMuted,
    this.onTap,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final String? leading;
  final Color leadingColor;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: RfSpace.minTouch),
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: RfColors.lineSoft))),
        child: Row(
          children: [
            if (leading != null)
              SizedBox(
                width: 42,
                child: Text(leading!, style: RfType.mono(size: 11, color: leadingColor)),
              ),
            if (leading != null) const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: RfType.body(size: 15, color: RfColors.text)),
                  if (subtitle != null)
                    Text(subtitle!, style: RfType.body(size: 12, color: RfColors.textMuted)),
                ],
              ),
            ),
            trailing ?? const RfGlyph(Glyph.chevron, size: 16, color: RfColors.chevron),
          ],
        ),
      ),
    );
  }
}

/// KPI tile (18 px radius panel).
class KpiTile extends StatelessWidget {
  const KpiTile({super.key, required this.label, required this.value, this.unit, this.footer, this.child});
  final String label;
  final String value;
  final String? unit;
  final String? footer;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Panel(
      child: Semantics(
        container: true,
        label: '$label $value${unit == null ? '' : ' $unit'}',
        child: ExcludeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: RfType.body(size: 12, color: RfColors.textMuted)),
              const SizedBox(height: 6),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: value, style: RfType.mono(size: 24, color: RfColors.text)),
                  if (unit != null)
                    TextSpan(text: ' $unit', style: RfType.mono(size: 13, color: RfColors.textMuted)),
                ])),
              ),
              if (child != null) ...[const SizedBox(height: 6), child!],
              if (footer != null) ...[
                const SizedBox(height: 6),
                Text(footer!, style: RfType.body(size: 11, color: RfColors.textMuted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Selectable chip (lime when selected), MobileJournal behaviour chips.
class RfChip extends StatelessWidget {
  const RfChip({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? RfColors.lime : Colors.transparent,
        shape: StadiumBorder(side: BorderSide(color: selected ? RfColors.lime : RfColors.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: RfSpace.minTouch, minWidth: RfSpace.minTouch),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              child: Center(
                widthFactor: 1,
                heightFactor: 1,
                child: Text(
                label,
                textAlign: TextAlign.center,
                style: RfType.body(
                  size: 14,
                  weight: selected ? FontWeight.w600 : FontWeight.w400,
                  color: selected ? RfColors.bg : RfColors.text,
                ),
              ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Feature-gated module lock screen (works offline, dossier 02 conventions).
class LockedFeature extends StatelessWidget {
  const LockedFeature({super.key, required this.feature, this.onUpgrade});
  final String feature;
  final VoidCallback? onUpgrade;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(RfSpace.gutter),
      child: Panel(
        padding: const EdgeInsets.all(18),
        radius: RfRadii.hero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('locked_title'), style: RfType.title(size: 20, color: RfColors.text)),
            const SizedBox(height: 8),
            Text(context.tr('locked_body', {'feature': context.tr('feature_$feature')}),
                style: RfType.body(size: 14, color: RfColors.textSoft, height: 1.5)),
            const SizedBox(height: 14),
            PillButton(label: context.tr('upgrade_pro'), onPressed: onUpgrade, expand: true),
          ],
        ),
      ),
    );
  }
}

/// Empty state with an action.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.message, this.actionLabel, this.onAction});
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Text(message,
              textAlign: TextAlign.center, style: RfType.body(size: 14, color: RfColors.textMuted, height: 1.5)),
          if (actionLabel != null) ...[
            const SizedBox(height: 14),
            PillButton(label: actionLabel!, onPressed: onAction),
          ],
        ],
      ),
    );
  }
}

void showSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
