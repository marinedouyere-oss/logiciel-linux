package com.marinedouyere.orion.ui.woodstore

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.marinedouyere.orion.data.FAM_LABELS
import com.marinedouyere.orion.data.WoodstoreRow
import com.marinedouyere.orion.data.exportWoodstoreXlsx
import com.marinedouyere.orion.data.famLabel
import com.marinedouyere.orion.data.famList
import com.marinedouyere.orion.data.importWoodstoreXlsx
import com.marinedouyere.orion.data.jsParseFloat
import com.marinedouyere.orion.ui.OrionViewModel
import com.marinedouyere.orion.ui.formatMm
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WoodstoreScreen(viewModel: OrionViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var famFilter by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var pendingDelete by remember { mutableStateOf<WoodstoreRow?>(null) }
    var showResetConfirm by remember { mutableStateOf(false) }
    var pendingImport by remember { mutableStateOf<List<WoodstoreRow>?>(null) }
    var snackbar by remember { mutableStateOf<String?>(null) }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val imported = withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(uri)?.use { importWoodstoreXlsx(it) }.orEmpty()
            }
            if (imported.isEmpty()) {
                snackbar = "Aucune ligne valide trouvée. Colonnes attendues : code article, code matière, longueur, largeur, épaisseur, catégorie, fil, groupe, description, type, flag, famille."
            } else {
                pendingImport = imported
            }
        }
    }
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch(Dispatchers.IO) {
            context.contentResolver.openOutputStream(uri)?.use { exportWoodstoreXlsx(it, viewModel.woodstore.toList()) }
        }
    }

    val families = remember(viewModel.woodstore.size) { famList(viewModel.woodstore) }
    val filtered = remember(viewModel.woodstore.size, famFilter, search) {
        var list: List<WoodstoreRow> = viewModel.woodstore
        if (famFilter.isNotEmpty()) list = list.filter { it.fam == famFilter }
        val q = search.trim().lowercase()
        if (q.isNotEmpty()) {
            list = list.filter { it.id.lowercase().contains(q) || it.mat.lowercase().contains(q) || it.desc.lowercase().contains(q) }
        }
        list
    }

    LazyColumn(Modifier.fillMaxWidth().padding(16.dp)) {
        item {
            Column {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        "Diagnostic — version ${com.marinedouyere.orion.BuildConfig.VERSION_NAME} (${com.marinedouyere.orion.BuildConfig.VERSION_CODE}) · " +
                            "chargement=${viewModel.isWoodstoreLoading} · erreur=${viewModel.woodstoreError ?: "aucune"} · lignes=${viewModel.woodstore.size}",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(6.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text("Woodstore — bibliothèque de panneaux", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Formats, matières et décors utilisés dans l'onglet Calepinage. Les ajouts et suppressions restent enregistrés sur cet appareil.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))

                AddRowCard(existingFamilies = families.ifEmpty { FAM_LABELS.keys.toList() }) { row ->
                    if (!viewModel.addWoodstoreRow(row)) snackbar = "Ce code article existe déjà dans la bibliothèque."
                }

                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { importLauncher.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) { Text("Importer un export (.xlsx)") }
                    OutlinedButton(onClick = { exportLauncher.launch("woodstore_orion.xlsx") }, modifier = Modifier.fillMaxWidth()) { Text("Exporter en Excel") }
                    OutlinedButton(onClick = { showResetConfirm = true }, modifier = Modifier.fillMaxWidth()) { Text("Réinitialiser") }
                }

                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FamilyDropdown(
                        selected = famFilter,
                        families = families,
                        allLabel = "Toutes les familles (${viewModel.woodstore.size})",
                        modifier = Modifier.width(220.dp),
                        onSelect = { famFilter = it },
                    )
                    OutlinedTextField(
                        value = search,
                        onValueChange = { search = it },
                        label = { Text("Rechercher (code, décor, description)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Text(
                    "${filtered.size} référence(s) sur ${viewModel.woodstore.size}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                viewModel.woodstoreError?.let { err ->
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        TextButton(onClick = { viewModel.reloadWoodstore() }) { Text("Réessayer") }
                    }
                }

                Spacer(Modifier.height(8.dp))
                if (viewModel.isWoodstoreLoading) {
                    Text("Chargement…", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        if (!viewModel.isWoodstoreLoading) {
            items(filtered, key = { it.id }) { row ->
                WoodstoreRowItem(row, onDelete = { pendingDelete = row })
                HorizontalDivider()
            }
        }
    }

    pendingDelete?.let { row ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Supprimer cette référence ?") },
            text = { Text("${row.id} — ${row.desc.ifBlank { row.mat }}") },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteWoodstoreRow(row.id); pendingDelete = null }) { Text("Supprimer") }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Annuler") } },
        )
    }

    if (showResetConfirm) {
        AlertDialog(
            onDismissRequest = { showResetConfirm = false },
            title = { Text("Revenir à la bibliothèque d'origine ?") },
            text = { Text("Tes ajouts et suppressions seront perdus.") },
            confirmButton = {
                TextButton(onClick = { viewModel.resetWoodstoreToBase(); showResetConfirm = false }) { Text("Réinitialiser") }
            },
            dismissButton = { TextButton(onClick = { showResetConfirm = false }) { Text("Annuler") } },
        )
    }

    pendingImport?.let { imported ->
        AlertDialog(
            onDismissRequest = { pendingImport = null },
            title = { Text("${imported.size} référence(s) lues") },
            text = { Text("Remplacer toute la bibliothèque, ou fusionner avec la bibliothèque actuelle ?") },
            confirmButton = {
                TextButton(onClick = { viewModel.applyWoodstoreImport(imported, replace = true); pendingImport = null }) { Text("Remplacer") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.applyWoodstoreImport(imported, replace = false); pendingImport = null }) { Text("Fusionner") }
            },
        )
    }

    snackbar?.let { msg ->
        AlertDialog(
            onDismissRequest = { snackbar = null },
            title = { Text("Import") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { snackbar = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun WoodstoreRowItem(row: WoodstoreRow, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("${row.id}  ·  ${row.mat}", style = MaterialTheme.typography.bodyMedium)
            Text(
                "${formatMm(row.L)} × ${formatMm(row.W)} mm" + (row.ep?.let { " · ${formatMm(it)} mm" } ?: "") + " · fil ${row.fil.ifBlank { "N" }} · ${famLabel(row.fam)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (row.desc.isNotBlank()) {
                Text(row.desc, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, contentDescription = "Supprimer") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddRowCard(existingFamilies: List<String>, onAdd: (WoodstoreRow) -> Unit) {
    var id by remember { mutableStateOf("") }
    var mat by remember { mutableStateOf("") }
    var l by remember { mutableStateOf("") }
    var w by remember { mutableStateOf("") }
    var ep by remember { mutableStateOf("") }
    var fam by remember { mutableStateOf(existingFamilies.firstOrNull() ?: "autre") }
    var fil by remember { mutableStateOf("N") }
    var desc by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("Ajouter une référence", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(id, { id = it }, label = { Text("Code article") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(mat, { mat = it }, label = { Text("Code matière") }, modifier = Modifier.weight(1f), singleLine = true)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(l, { l = it }, label = { Text("Longueur (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(w, { w = it }, label = { Text("Largeur (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(ep, { ep = it }, label = { Text("Ep. (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FamilyDropdown(
                    selected = fam,
                    families = existingFamilies,
                    allLabel = null,
                    modifier = Modifier.weight(1f),
                    onSelect = { fam = it },
                )
                FilDropdown(fil, modifier = Modifier.width(100.dp)) { fil = it }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(desc, { desc = it }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall) }
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                val lv = jsParseFloat(l)
                val wv = jsParseFloat(w)
                when {
                    id.isBlank() -> error = "Renseigne un code article."
                    lv == null || lv == 0.0 || wv == null || wv == 0.0 -> error = "Renseigne une longueur et une largeur valides."
                    else -> {
                        error = null
                        onAdd(
                            WoodstoreRow(
                                id = id.trim(), mat = mat.trim(), L = lv, W = wv,
                                ep = jsParseFloat(ep)?.takeUnless { it == 0.0 }, cat = "", fil = fil, grp = "",
                                desc = desc.trim(), type = "", flag = "", fam = fam,
                            ),
                        )
                        id = ""; mat = ""; l = ""; w = ""; ep = ""; desc = ""
                    }
                }
            }) { Text("Ajouter") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FamilyDropdown(selected: String, families: List<String>, allLabel: String?, modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = if (selected.isEmpty()) (allLabel ?: "Famille") else famLabel(selected)
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = label,
            onValueChange = {},
            readOnly = true,
            label = { Text("Famille") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (allLabel != null) {
                DropdownMenuItem(text = { Text(allLabel) }, onClick = { onSelect(""); expanded = false })
            }
            families.forEach { f ->
                DropdownMenuItem(text = { Text(famLabel(f)) }, onClick = { onSelect(f); expanded = false })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilDropdown(selected: String, modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            label = { Text("Fil") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf("N", "O").forEach { f ->
                DropdownMenuItem(text = { Text(f) }, onClick = { onSelect(f); expanded = false })
            }
        }
    }
}
