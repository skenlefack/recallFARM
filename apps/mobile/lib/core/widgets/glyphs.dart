import 'package:flutter/material.dart';

/// Icons redrawn from the inline SVGs of the mock-ups (stroke icons).
enum Glyph { home, herd, plus, chart, more, chevron, clock, drop, mic, close, back, dots, flame, dog, dog2 }

class RfGlyph extends StatelessWidget {
  const RfGlyph(this.glyph, {super.key, this.size = 22, this.color = Colors.white, this.strokeWidth = 1.5, this.semanticLabel});

  final Glyph glyph;
  final double size;
  final Color color;
  final double strokeWidth;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final paint = CustomPaint(
      size: Size.square(size),
      painter: _GlyphPainter(glyph, color, strokeWidth),
    );
    if (semanticLabel == null) return ExcludeSemantics(child: paint);
    return Semantics(label: semanticLabel, image: true, child: paint);
  }
}

class _GlyphPainter extends CustomPainter {
  _GlyphPainter(this.glyph, this.color, this.strokeWidth);

  final Glyph glyph;
  final Color color;
  final double strokeWidth;

  /// Native viewBox of each glyph in the SVGs.
  double get _box {
    switch (glyph) {
      case Glyph.chevron:
      case Glyph.mic:
        return 16;
      case Glyph.drop:
        return 18;
      case Glyph.close:
      case Glyph.back:
      case Glyph.dots:
        return 24;
      case Glyph.flame:
      case Glyph.dog:
        return 52;
      default:
        return 22;
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / _box;
    canvas.save();
    canvas.scale(s, s);
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth // viewBox units (canvas is scaled)
      ..strokeCap = StrokeCap.butt
      ..strokeJoin = StrokeJoin.round;
    final fill = Paint()..color = color;
    switch (glyph) {
      case Glyph.home:
        canvas.drawPath(
            Path()
              ..moveTo(3, 10)
              ..lineTo(11, 4)
              ..lineTo(19, 10)
              ..lineTo(19, 18)
              ..lineTo(3, 18)
              ..close(),
            stroke);
        break;
      case Glyph.herd:
        canvas.drawCircle(const Offset(8, 9), 3, stroke);
        canvas.drawCircle(const Offset(15, 9), 3, stroke);
        canvas.drawPath(
            Path()
              ..moveTo(3, 18)
              ..cubicTo(4, 15, 6, 14, 8, 14)
              ..cubicTo(10, 14, 12, 15, 13, 18)
              ..moveTo(12, 15)
              ..cubicTo(13, 14, 14, 14, 15, 14)
              ..cubicTo(17, 14, 19, 15, 20, 18),
            stroke);
        break;
      case Glyph.plus:
        final p = Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2;
        canvas.drawLine(const Offset(11, 4), const Offset(11, 18), p);
        canvas.drawLine(const Offset(4, 11), const Offset(18, 11), p);
        break;
      case Glyph.chart:
        canvas.drawPath(
            Path()
              ..moveTo(3, 17)
              ..lineTo(8, 11)
              ..lineTo(12, 14)
              ..lineTo(19, 5),
            stroke);
        break;
      case Glyph.more:
        canvas.drawRRect(
            RRect.fromRectAndRadius(const Rect.fromLTWH(4, 4, 14, 14), const Radius.circular(3)), stroke);
        canvas.drawLine(const Offset(8, 9), const Offset(14, 9), stroke);
        canvas.drawLine(const Offset(8, 13), const Offset(12, 13), stroke);
        break;
      case Glyph.chevron:
        canvas.drawPath(
            Path()
              ..moveTo(6, 3)
              ..lineTo(11, 8)
              ..lineTo(6, 13),
            stroke);
        break;
      case Glyph.clock:
        canvas.drawCircle(const Offset(11, 11), 9.5, stroke);
        canvas.drawPath(
            Path()
              ..moveTo(11, 6)
              ..lineTo(11, 11)
              ..lineTo(14, 13),
            stroke);
        break;
      case Glyph.drop:
        canvas.drawPath(
            Path()
              ..moveTo(9, 2)
              ..cubicTo(6, 6, 4, 8.5, 4, 11)
              ..arcToPoint(const Offset(14, 11), radius: const Radius.circular(5), clockwise: false)
              ..cubicTo(14, 8.5, 12, 6, 9, 2)
              ..close(),
            stroke);
        break;
      case Glyph.mic:
        canvas.drawRRect(
            RRect.fromRectAndRadius(const Rect.fromLTWH(5.5, 1.5, 5, 9), const Radius.circular(2.5)), stroke);
        canvas.drawPath(
            Path()
              ..moveTo(3, 8)
              ..arcToPoint(const Offset(13, 8), radius: const Radius.circular(5), clockwise: false)
              ..moveTo(8, 13)
              ..lineTo(8, 15),
            stroke);
        break;
      case Glyph.close:
        canvas.drawLine(const Offset(6, 6), const Offset(18, 18), stroke);
        canvas.drawLine(const Offset(18, 6), const Offset(6, 18), stroke);
        break;
      case Glyph.back:
        canvas.drawPath(
            Path()
              ..moveTo(15, 5)
              ..lineTo(8, 12)
              ..lineTo(15, 19),
            stroke);
        break;
      case Glyph.dots:
        canvas.drawCircle(const Offset(5, 12), 1.6, fill);
        canvas.drawCircle(const Offset(12, 12), 1.6, fill);
        canvas.drawCircle(const Offset(19, 12), 1.6, fill);
        break;
      case Glyph.flame:
        canvas.drawPath(
            Path()
              ..moveTo(26, 10)
              ..cubicTo(22, 16, 16, 22, 16, 30)
              ..arcToPoint(const Offset(36, 30), radius: const Radius.circular(10), clockwise: false)
              ..cubicTo(36, 26, 34, 23, 32, 20)
              ..cubicTo(31, 23, 29, 25, 27, 25)
              ..cubicTo(29, 20, 28, 15, 26, 10)
              ..close(),
            stroke);
        break;
      case Glyph.dog:
      case Glyph.dog2:
        canvas.drawPath(
            Path()
              ..moveTo(14, 18)
              ..lineTo(11, 8)
              ..lineTo(20, 14)
              ..moveTo(38, 18)
              ..lineTo(41, 8)
              ..lineTo(32, 14),
            stroke);
        canvas.drawPath(
            Path()
              ..moveTo(14, 18)
              ..cubicTo(14, 14, 19, 12, 26, 12)
              ..cubicTo(33, 12, 38, 14, 38, 18)
              ..lineTo(38, 28)
              ..cubicTo(38, 36, 32, 42, 26, 42)
              ..cubicTo(20, 42, 14, 36, 14, 28)
              ..close(),
            stroke);
        canvas.drawPath(
            Path()
              ..moveTo(22, 34)
              ..lineTo(26, 37)
              ..lineTo(30, 34),
            stroke);
        canvas.drawCircle(const Offset(21, 25), 1.6, fill);
        canvas.drawCircle(const Offset(31, 25), 1.6, fill);
        break;
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_GlyphPainter old) =>
      old.glyph != glyph || old.color != color || old.strokeWidth != strokeWidth;
}
