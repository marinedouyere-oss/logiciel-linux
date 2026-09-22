package com.marinedouyere.orion.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val OrionLightColors = lightColorScheme(
    primary = OrionSky,
    onPrimary = Color.White,
    secondary = OrionSkyDark,
    background = OrionBg,
    surface = OrionPanel,
    onBackground = OrionInk,
    onSurface = OrionInk,
    surfaceVariant = OrionSkyTint,
    outline = OrionBorderStrong,
    error = OrionDanger,
)

private val OrionDarkColors = darkColorScheme(
    primary = OrionSky,
    onPrimary = Color.Black,
    secondary = OrionSkyTint,
    background = Color(0xFF0B1620),
    surface = Color(0xFF122233),
    onBackground = Color(0xFFE7EEF6),
    onSurface = Color(0xFFE7EEF6),
    surfaceVariant = Color(0xFF1B324A),
    outline = OrionSkyDark,
    error = Color(0xFFFF6B6B),
)

@Composable
fun OrionTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) OrionDarkColors else OrionLightColors
    MaterialTheme(
        colorScheme = colors,
        typography = OrionTypography,
        content = content,
    )
}
