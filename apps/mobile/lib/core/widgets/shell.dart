import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/home/quick_entry_sheet.dart';
import '../i18n/strings.dart';
import '../theme/tokens.dart';
import '../theme/typography.dart';
import 'glyphs.dart';

/// Bottom navigation of the mock-ups: Accueil · Cheptel · (+) · Ferme · Plus.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RfColors.bg,
      body: SafeArea(bottom: false, child: child),
      bottomNavigationBar: RfBottomNav(location: location),
    );
  }
}

class RfBottomNav extends StatelessWidget {
  const RfBottomNav({super.key, required this.location});
  final String location;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).padding.bottom;
    return Semantics(
      container: true,
      label: context.tr('navigation'),
      child: Container(
        decoration: const BoxDecoration(
          color: RfColors.navBg,
          border: Border(top: BorderSide(color: RfColors.lineSoft)),
        ),
        padding: EdgeInsets.fromLTRB(12, 10, 12, bottomInset > 0 ? bottomInset : 16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            _item(context, Glyph.home, 'nav_home', '/home'),
            _item(context, Glyph.herd, 'nav_livestock', '/livestock'),
            Expanded(
              // heightFactor 1: without it Center takes all the height the
              // Scaffold offers to bottomNavigationBar and the bar covers the screen.
              child: Center(
                heightFactor: 1,
                child: Transform.translate(
                  offset: const Offset(0, -14),
                  child: Semantics(
                    button: true,
                    label: context.tr('nav_add'),
                    child: Material(
                      color: RfColors.lime,
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: () => showQuickEntrySheet(context),
                        child: const SizedBox(
                          width: 52,
                          height: 52,
                          child: Center(child: RfGlyph(Glyph.plus, color: RfColors.bg)),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            _item(context, Glyph.chart, 'nav_farm', '/farm-live'),
            _item(context, Glyph.more, 'nav_more', '/more'),
          ],
        ),
      ),
    );
  }

  Widget _item(BuildContext context, Glyph glyph, String labelKey, String path) {
    final selected = location.startsWith(path);
    final color = selected ? RfColors.lime : RfColors.textMuted;
    return Expanded(
      child: Semantics(
        selected: selected,
        button: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => context.go(path),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: RfSpace.minTouch),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                RfGlyph(glyph, color: color),
                const SizedBox(height: 4),
                Text(
                  context.tr(labelKey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: RfType.body(size: 11, color: color),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
