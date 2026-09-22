package com.marinedouyere.orion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.marinedouyere.orion.ui.calepinage.CalepinageScreen
import com.marinedouyere.orion.ui.reglages.ReglagesScreen
import com.marinedouyere.orion.ui.woodstore.WoodstoreScreen

private enum class OrionTab(val label: String) {
    Calepinage("Calepinage"),
    Reglages("Réglages machine"),
    Woodstore("Woodstore"),
}

/**
 * Root shell: mirrors the original PWA's header (ORION mark + tagline) and its
 * three-tab layout (switchTab() in orion.html), but as native Compose navigation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrionRoot() {
    var selected by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Row {
                            Text("Orion", style = MaterialTheme.typography.titleLarge)
                        }
                    },
                )
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Text(
                        text = "Calepinage de panneaux",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 0.dp),
                    )
                }
                PrimaryTabRow(selectedTabIndex = selected) {
                    OrionTab.entries.forEachIndexed { index, tab ->
                        Tab(
                            selected = selected == index,
                            onClick = { selected = index },
                            text = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Surface(
            modifier = Modifier
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
        ) {
            when (OrionTab.entries[selected]) {
                OrionTab.Calepinage -> CalepinageScreen()
                OrionTab.Reglages -> ReglagesScreen()
                OrionTab.Woodstore -> WoodstoreScreen()
            }
        }
    }
}
