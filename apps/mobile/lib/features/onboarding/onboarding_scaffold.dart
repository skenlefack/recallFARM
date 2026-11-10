import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';

/// Shared layout of the onboarding steps: step dots, title, scrollable body,
/// bottom action area.
class OnboardingScaffold extends StatelessWidget {
  const OnboardingScaffold({
    super.key,
    required this.step,
    required this.title,
    this.subtitle,
    required this.body,
    required this.actions,
    this.onBack,
  });

  final int step; // 1..4
  final String title;
  final String? subtitle;
  final Widget body;
  final Widget actions;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RfColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                children: [
                  for (var i = 1; i <= 4; i++) ...[
                    Expanded(
                      child: Container(
                        height: 3,
                        decoration: BoxDecoration(
                          color: i <= step ? RfColors.lime : RfColors.border,
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                    ),
                    if (i < 4) const SizedBox(width: 4),
                  ],
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (onBack != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: TextButton(
                          onPressed: onBack,
                          style: TextButton.styleFrom(padding: EdgeInsets.zero, foregroundColor: RfColors.textMuted),
                          child: const Text('←'),
                        ),
                      ),
                    Text('RecallFarm', style: RfType.mono(size: 11, color: RfColors.lime, letterSpacing: 0.66)),
                    const SizedBox(height: 6),
                    Semantics(
                      header: true,
                      child: Text(title, style: RfType.title(size: 27, color: RfColors.text)),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 6),
                      Text(subtitle!, style: RfType.body(size: 14, color: RfColors.textSoft, height: 1.5)),
                    ],
                    const SizedBox(height: 20),
                    body,
                  ],
                ),
              ),
            ),
            Padding(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), child: actions),
          ],
        ),
      ),
    );
  }
}
