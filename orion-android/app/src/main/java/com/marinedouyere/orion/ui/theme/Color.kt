package com.marinedouyere.orion.ui.theme

import androidx.compose.ui.graphics.Color

// Palette lifted straight from the original orion.html :root custom properties,
// so the Android app reads as the same product as the web/PWA version.
val OrionBg = Color(0xFFEEF4FA)
val OrionPanel = Color(0xFFFFFFFF)
val OrionBorder = Color(0xFFD3E0EE)
val OrionBorderStrong = Color(0xFFAECBE8)
val OrionInk = Color(0xFF10263D)
val OrionInkSoft = Color(0xFF5C7189)
val OrionSky = Color(0xFF0EA5E9)
val OrionSkyDark = Color(0xFF0B7FB3)
val OrionSkyTint = Color(0xFFE3F4FD)
val OrionAmber = Color(0xFFD97706)
val OrionAmberTint = Color(0xFFFDF0DC)
val OrionGreen = Color(0xFF178A4C)
val OrionDanger = Color(0xFFB3261E)

// Piece color palette, same 12 hues/order as the web app's `palette` array,
// used to color-code pieces consistently between the table and the cut diagrams.
val OrionPiecePalette = listOf(
    Color(0xFF0EA5E9), Color(0xFFF59E0B), Color(0xFF22C55E), Color(0xFFA855F7),
    Color(0xFFEF4444), Color(0xFF14B8A6), Color(0xFFEAB308), Color(0xFF6366F1),
    Color(0xFFF97316), Color(0xFF84CC16), Color(0xFFEC4899), Color(0xFF0891B2),
)
