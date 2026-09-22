package com.marinedouyere.orion.ui.reglages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.marinedouyere.orion.data.SETTINGS_SCHEMA
import com.marinedouyere.orion.data.SettingsField
import com.marinedouyere.orion.ui.OrionViewModel
import com.marinedouyere.orion.ui.formatMm
import com.marinedouyere.orion.ui.theme.OrionGreen
import com.marinedouyere.orion.ui.theme.OrionInkSoft

private fun displayValue(v: Any?): String = when (v) {
    null -> ""
    is Double -> formatMm(v)
    else -> v.toString()
}

/**
 * Machine settings editor: Stratifié/Agglo toggle + every SETTINGS_SCHEMA
 * section, filtered to the fields defined for the selected profile (a field
 * missing from a profile's defaults simply isn't shown for it, mirroring
 * `vals[f.id] !== undefined` in renderReglagesTab()).
 */
@Composable
fun ReglagesScreen(viewModel: OrionViewModel) {
    val profile = viewModel.currentMaterial
    val values = viewModel.settings[profile].orEmpty()

    LazyColumn(Modifier.fillMaxWidth().padding(16.dp)) {
        item {
            Text("Réglages machine — Cut Rite Modulaire", style = MaterialTheme.typography.titleMedium)
            Text(
                "Reprise des paramètres d'optimisation et de scie pour HPP300_STRAT et Agglo. Chaque réglage s'applique au profil sélectionné.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = profile == "strat", onClick = { viewModel.setMaterial("strat") }, label = { Text("Stratifié (HPP300_STRAT)") })
                FilterChip(selected = profile == "agglo", onClick = { viewModel.setMaterial("agglo") }, label = { Text("Agglo") })
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                LegendDot(OrionGreen, "utilisé dans le calcul du calepinage")
                LegendDot(OrionInkSoft, "info machine, sans effet sur le calcul")
            }
            Spacer(Modifier.height(12.dp))
        }

        SETTINGS_SCHEMA.forEach { section ->
            val fields = section.fields.filter { values.containsKey(it.id) }
            if (fields.isEmpty()) return@forEach
            item {
                Text(section.section, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
            }
            items(fields, key = { "$profile:${it.id}" }) { field ->
                SettingRow(field, displayValue(values[field.id])) { newText ->
                    viewModel.updateSetting(profile, field.id, newText)
                }
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }
}

@Composable
private fun LegendDot(color: Color, label: String) {
    Row {
        Surface(color = color, shape = androidx.compose.foundation.shape.RoundedCornerShape(3.dp), modifier = Modifier.width(10.dp).height(10.dp)) {}
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SettingRow(field: SettingsField, value: String, onChange: (String) -> Unit) {
    var text by remember(field.id, value) { mutableStateOf(value) }
    Card(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(field.label, style = MaterialTheme.typography.bodyMedium)
                Text(
                    if (field.active) "utilisé" else "info",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (field.active) OrionGreen else OrionInkSoft,
                )
            }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; onChange(it) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                suffix = if (field.unit.isNotEmpty()) ({ Text(field.unit) }) else null,
                modifier = Modifier.width(150.dp),
            )
        }
    }
}
