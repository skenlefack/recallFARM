import 'package:flutter/material.dart';

/// Design tokens extracted from docs/design/Mobile*.dc.html (390×844 mock-ups).
class RfColors {
  RfColors._();

  // Deep-blue surfaces
  static const bg = Color(0xFF062B4F);
  static const navBg = Color(0xFF05264A);
  static const panel = Color(0xFF0A3A66);
  static const panel2 = Color(0xFF0E4578);
  static const panelDeep = Color(0xFF041F3A); // camera tile
  static const line = Color(0xFF1B5486); // panel border
  static const lineSoft = Color(0xFF15497A); // list separators, nav top border
  static const border = Color(0xFF2A679E); // inputs, chips, outlines
  static const dashed = Color(0xFF2F7FB8); // IoT-filled field
  static const gridLine = Color(0xFF0B3D6C);

  // Text on blue
  static const text = Color(0xFFF2F8FD);
  static const textMuted = Color(0xFFA9C8E4);
  static const textSoft = Color(0xFFC3D9EC);
  static const chevron = Color(0xFF86A9C9);
  static const onLimeButtonText = Color(0xFFF3F1EA);

  // Accents
  static const lime = Color(0xFFC8F169);
  static const brand = Color(0xFF0780D8);
  static const cyan = Color(0xFF8FE3FF);
  static const amber = Color(0xFFF4B04F);
  static const amberBorder = Color(0xFF5A4527);
  static const coral = Color(0xFFFF7D5C);
  static const error = Color(0xFFFF7D5C);

  // Amber warning panel (MobileFerme / MobileGenealogie)
  static const amberPanel = Color(0xFF2A1D14);
  static const amberText = Color(0xFFF4D3A0);
  static const amberStrong = Color(0xFFFBE3BE);
  static const amberMuted = Color(0xFFC9A879);

  // Critical alert (MobileAlerte)
  static const alertBg = Color(0xFF1A0E0A);
  static const alertText = Color(0xFFFFF1EC);
  static const alertMuted = Color(0xFFE0C2B8);
  static const alertStatus = Color(0xFFE0A898);
  static const alertLine = Color(0xFF5C2D20);
  static const alertTrack = Color(0xFF3A1F17);
  static const alertFaint = Color(0xFFA88C83);

  // Genealogy cards
  static const sireBg = Color(0xFF0B4579);
  static const damBg = Color(0xFF123F4A);
  static const ancestorBg = Color(0xFF3A1F17);
  static const ancestorText = Color(0xFFFFD2C4);

  // Light "cream" theme (MobileChien)
  static const cream = Color(0xFFF3F1EA);
  static const creamText = Color(0xFF062B4F);
  static const creamMuted = Color(0xFF4F5D57);
  static const creamAvatar = Color(0xFFDED9CC);
  static const creamLine = Color(0xFFB9B2A1);
  static const creamCardBorder = Color(0xFFDED9CC);
  static const creamOk = Color(0xFF2F6B3F);
  static const creamDue = Color(0xFFC77A12);
  static const brandOutline = Color(0xFF3474AD);
  static const white = Color(0xFFFFFFFF);
}

class RfRadii {
  RfRadii._();
  static const double hero = 24; // "À faire aujourd'hui", rabies card
  static const double tile = 18; // KPI tiles, sensor tiles
  static const double alertTile = 22;
  static const double input = 16; // stepper buttons, banners
  static const double field = 14; // plain inputs
  static const double pill = 999;
}

class RfSpace {
  RfSpace._();
  static const double gutter = 20; // screen horizontal padding
  static const double gap = 16; // vertical gap between blocks
  static const double minTouch = 48; // accessibility
}
