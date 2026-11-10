import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';

/// Quick-entry sheet opened by the central lime "+" of the bottom nav.
Future<void> showQuickEntrySheet(BuildContext context) {
  final router = GoRouter.of(context);
  return showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    builder: (sheetContext) {
      final items = <(String, String, IconData)>[
        ('qe_journal', '/journal', Icons.edit_note),
        ('qe_health', '/health/new', Icons.vaccines_outlined),
        ('qe_sale', '/sales/new', Icons.sell_outlined),
        ('qe_expense', '/expenses/new', Icons.receipt_long_outlined),
        ('qe_stock', '/stocks/new', Icons.inventory_2_outlined),
        ('qe_task', '/tasks/new', Icons.check_circle_outline),
        ('qe_batch', '/livestock/add/batch', Icons.egg_outlined),
        ('qe_dog', '/livestock/add/dog', Icons.pets_outlined),
      ];
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: RfColors.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 14),
            Text(sheetContext.tr('qe_title'), style: RfType.title(size: 20, color: RfColors.text)),
            const SizedBox(height: 12),
            LayoutBuilder(builder: (context, c) {
              final cols = c.maxWidth > 330 ? 2 : 1;
              final w = (c.maxWidth - (cols - 1) * 10) / cols;
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final it in items)
                    SizedBox(
                      width: w,
                      child: Material(
                        color: RfColors.panel,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(RfRadii.input),
                          side: const BorderSide(color: RfColors.line),
                        ),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(RfRadii.input),
                          onTap: () {
                            Navigator.of(sheetContext).pop();
                            router.push(it.$2);
                          },
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 56),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              child: Row(
                                children: [
                                  Icon(it.$3, color: RfColors.lime, size: 22),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(context.tr(it.$1),
                                        style: RfType.body(size: 14, color: RfColors.text)),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              );
            }),
          ],
        ),
      );
    },
  );
}
