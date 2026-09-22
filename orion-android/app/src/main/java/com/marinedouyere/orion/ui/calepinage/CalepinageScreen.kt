package com.marinedouyere.orion.ui.calepinage

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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.marinedouyere.orion.data.decorList
import com.marinedouyere.orion.data.decorRows
import com.marinedouyere.orion.data.famLabel
import com.marinedouyere.orion.data.jsParseFloat
import com.marinedouyere.orion.data.jsParseInt
import com.marinedouyere.orion.data.stockFormatOptions
import com.marinedouyere.orion.ui.CalepinageRun
import com.marinedouyere.orion.ui.OrionViewModel
import com.marinedouyere.orion.ui.formatMm
import com.marinedouyere.orion.ui.theme.OrionAmber
import com.marinedouyere.orion.ui.theme.OrionPiecePalette
import com.marinedouyere.orion.xlsx.XlsxReader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToLong

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalepinageScreen(viewModel: OrionViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var decor by remember { mutableStateOf("") }
    var selectedFormatKey by remember { mutableStateOf<String?>(null) }
    var useManualFormat by remember { mutableStateOf(false) }
    var manualL by remember { mutableStateOf("2800") }
    var manualW by remember { mutableStateOf("2070") }

    var pieceL by remember { mutableStateOf("") }
    var pieceW by remember { mutableStateOf("") }
    var pieceQty by remember { mutableStateOf("1") }
    var pieceEp by remember { mutableStateOf("") }
    var pieceRotate by remember { mutableStateOf(true) }
    var addError by remember { mutableStateOf<String?>(null) }

    var compareAllFormats by remember { mutableStateOf(false) }
    var infoMessage by remember { mutableStateOf<String?>(null) }

    val decorOptions = remember(viewModel.woodstore.size) { decorList(viewModel.woodstore) }
    val formatOptions = remember(viewModel.woodstore.size, viewModel.currentMaterial) {
        stockFormatOptions(viewModel.woodstore, viewModel.currentMaterial)
    }
    LaunchedEffect(formatOptions) {
        if (selectedFormatKey == null && formatOptions.isNotEmpty()) {
            selectedFormatKey = "${formatOptions.first().L}|${formatOptions.first().W}"
        }
    }
    val selectedFormat = formatOptions.firstOrNull { "${it.L}|${it.W}" == selectedFormatKey }
    val sheetL = if (useManualFormat || selectedFormat == null) (jsParseFloat(manualL) ?: 0.0) else selectedFormat.L
    val sheetW = if (useManualFormat || selectedFormat == null) (jsParseFloat(manualW) ?: 0.0) else selectedFormat.W

    val lancementLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var total = 0
            val echecs = mutableListOf<String>()
            val inconnus = mutableSetOf<String>()
            for (uri in uris) {
                val name = displayNameOf(context, uri)
                try {
                    val rows = withContext(Dispatchers.IO) {
                        context.contentResolver.openInputStream(uri)?.use { XlsxReader.readFirstSheet(it) }
                    } ?: throw IllegalStateException("lecture impossible")
                    val res = viewModel.importLancement(rows)
                    when {
                        res == null -> echecs.add("$name (colonnes longueur/largeur introuvables)")
                        res.pieces.isEmpty() -> echecs.add("$name (aucune ligne exploitable)")
                        else -> {
                            res.pieces.forEach { p -> if (decorRows(viewModel.woodstore, p.decor).isEmpty()) inconnus.add(p.decor) }
                            total += res.pieces.size
                        }
                    }
                } catch (e: Exception) {
                    echecs.add("$name (${e.message})")
                }
            }
            infoMessage = buildString {
                append("$total pièce(s) importée(s) depuis ${uris.size} lancement(s).")
                if (inconnus.isNotEmpty()) append("\n\nDécors absents de Woodstore (dimensions à saisir à la main) : " + inconnus.take(12).joinToString(", "))
                if (echecs.isNotEmpty()) append("\n\nFichiers ignorés :\n" + echecs.joinToString("\n"))
            }
        }
    }

    LazyColumn(Modifier.fillMaxWidth().padding(16.dp)) {
        item {
            SheetSettingsPanel(
                material = viewModel.currentMaterial,
                onMaterialChange = { viewModel.setMaterial(it) },
                decor = decor,
                decorOptions = decorOptions,
                onDecorChange = { decor = it },
                formatOptions = formatOptions,
                selectedFormatKey = selectedFormatKey,
                useManualFormat = useManualFormat,
                manualL = manualL,
                manualW = manualW,
                onFormatSelect = { key -> selectedFormatKey = key; useManualFormat = false },
                onUseManualFormat = { useManualFormat = true },
                onManualLChange = { manualL = it },
                onManualWChange = { manualW = it },
            )
            Spacer(Modifier.height(12.dp))
            PieceFormPanel(
                l = pieceL, w = pieceW, qty = pieceQty, ep = pieceEp, rotate = pieceRotate, error = addError,
                onLChange = { pieceL = it }, onWChange = { pieceW = it }, onQtyChange = { pieceQty = it },
                onEpChange = { pieceEp = it }, onRotateChange = { pieceRotate = it },
                onAdd = {
                    val l = jsParseFloat(pieceL)
                    val w = jsParseFloat(pieceW)
                    if (l == null || w == null || l <= 0 || w <= 0) {
                        addError = "Merci de renseigner une longueur et une largeur valides."
                    } else {
                        addError = null
                        viewModel.addPiece(
                            name = null, l = l, w = w,
                            qty = jsParseInt(pieceQty)?.takeIf { it > 0 } ?: 1,
                            rotate = pieceRotate, decor = decor,
                            ep = pieceEp.takeIf { it.isNotBlank() }?.let { jsParseFloat(it) },
                            fmtL = sheetL, fmtW = sheetW,
                        )
                        decor = ""; pieceL = ""; pieceW = ""; pieceQty = "1"; pieceEp = ""; pieceRotate = true
                    }
                },
                onImportLancement = { lancementLauncher.launch(arrayOf("*/*")) },
            )
            Spacer(Modifier.height(8.dp))
        }
        items(viewModel.pieces, key = { it.id }) { piece ->
            PieceRowItem(piece.id, piece.name, piece.decor, piece.L, piece.W, piece.ep, piece.qty, piece.rotate) {
                viewModel.removePiece(piece.id)
            }
            HorizontalDivider()
        }
        if (viewModel.pieces.isEmpty()) {
            item {
                Text(
                    "Aucune pièce ajoutée pour l'instant.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
            }
        }

        item {
            Spacer(Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = compareAllFormats, onCheckedChange = { compareAllFormats = it })
                    Text("Tester tous les formats Woodstore et retenir le meilleur", style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { viewModel.compute(sheetL, sheetW, compareAllFormats) },
                enabled = !viewModel.isComputing,
            ) {
                Text(if (viewModel.isComputing) "Optimisation en cours…" else "Calculer le calepinage")
            }
            if (viewModel.isComputing) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator(modifier = Modifier.height(20.dp).width(20.dp))
            }
            viewModel.computeError?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(12.dp))
        }

        viewModel.computeRuns?.let { runs ->
            item { ResultsSummary(runs) }
            items(runs) { run -> RunCard(run) }
        }
    }

    infoMessage?.let { msg ->
        AlertDialog(
            onDismissRequest = { infoMessage = null },
            title = { Text("Import") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { infoMessage = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun PieceRowItem(id: Int, name: String, decor: String, l: Double, w: Double, ep: Double?, qty: Int, rotate: Boolean, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(color = OrionPiecePalette[((id % OrionPiecePalette.size) + OrionPiecePalette.size) % OrionPiecePalette.size], modifier = Modifier.width(10.dp).height(10.dp)) {}
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyMedium)
            Text(
                "${l.roundToLong()} × ${w.roundToLong()} mm" + (ep?.let { " · ${formatMm(it)} mm" } ?: "") +
                    " · qté $qty" + (if (!rotate) " · fixe" else "") + (decor.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, contentDescription = "Supprimer") }
    }
}

@Composable
private fun ResultsSummary(runs: List<CalepinageRun>) {
    val totalSheets = runs.sumOf { it.result.newSheets }
    val totalArea = runs.sumOf { it.result.newSheets * it.usedL * it.usedW }
    val totalPieceArea = runs.sumOf { r -> r.pieces.sumOf { it.L * it.W * it.qty } }
    val totalQty = runs.sumOf { r -> r.pieces.sumOf { it.qty } }
    val util = if (totalArea > 0) totalPieceArea / totalArea * 100 else 0.0

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("Résultat", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Stat("$totalSheets", "feuille(s) au total")
                Stat("${runs.size}", "décor(s)")
                Stat("$totalQty", "pièces")
                Stat("${"%.1f".format(util)}%", "utilisation")
                Stat("%.2f".format(totalArea / 1e6), "m² de panneaux")
            }
            if (runs.size > 1) {
                Spacer(Modifier.height(12.dp))
                Text("Récapitulatif par décor / matière", style = MaterialTheme.typography.titleMedium)
                runs.forEach { r ->
                    val label = r.decor.ifBlank { "Sans décor — ${if (r.material == "agglo") "Agglo" else "Stratifié"}" }
                    Text(
                        "$label — ${r.usedL.roundToLong()}×${r.usedW.roundToLong()} — ${r.result.newSheets} feuille(s) — ${"%.1f".format(r.result.util * 100)}%",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun Stat(value: String, label: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun RunCard(run: CalepinageRun) {
    val label = run.decor.ifBlank { "Sans décor — ${if (run.material == "agglo") "Agglo" else "Stratifié"}" }
    val warnings = remember(run) { computeWarnings(run) }

    Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text("$label — ${run.result.newSheets} feuille(s) de ${run.usedL.roundToLong()}×${run.usedW.roundToLong()} mm", style = MaterialTheme.typography.titleMedium)

            val notes = buildList {
                if (run.forcedNoRotation) add("Fil orienté : rotation des pièces désactivée pour ce décor.")
                if (run.grain == "N") add("Pas de sens de fil : rotation autorisée selon le réglage de chaque pièce.")
                if (run.unknownDecor) add("Décor absent de Woodstore : dimensions et règles issues de la saisie manuelle.")
                if (run.fam != null) add("Famille « ${famLabel(run.fam)} » → profil machine « ${if (run.profileKey == "agglo") "Agglo" else "Stratifié"} ».")
                else if (run.material != null) add("Matière « ${if (run.material == "agglo") "Agglo" else "Stratifié"} » → réglages machine « ${if (run.profileKey == "agglo") "Agglo" else "Stratifié"} ».")
            }
            notes.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            if (warnings.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Surface(color = OrionAmber.copy(alpha = 0.12f)) {
                    Column(Modifier.padding(8.dp)) {
                        warnings.forEach { Text("⚠ $it", style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
            if (run.result.oversized.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "${run.result.oversized.size} pièce(s) ne rentrent pas dans la zone utile de la feuille : " +
                        run.result.oversized.joinToString(", ") { "${it.name} (${it.L.roundToLong()}×${it.W.roundToLong()})" },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Spacer(Modifier.height(10.dp))
            run.result.sheets.forEachIndexed { si, sheet ->
                Text(
                    "${if (sheet.fromChute) "Chute récupérée" else "Feuille"} ${si + 1}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SheetDiagram(sheet, run.trimLong, run.trimTrans, run.mat)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetSettingsPanel(
    material: String,
    onMaterialChange: (String) -> Unit,
    decor: String,
    decorOptions: List<com.marinedouyere.orion.data.DecorOption>,
    onDecorChange: (String) -> Unit,
    formatOptions: List<com.marinedouyere.orion.data.FormatOption>,
    selectedFormatKey: String?,
    useManualFormat: Boolean,
    manualL: String,
    manualW: String,
    onFormatSelect: (String) -> Unit,
    onUseManualFormat: () -> Unit,
    onManualLChange: (String) -> Unit,
    onManualWChange: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("Réglages feuille", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = material == "strat", onClick = { onMaterialChange("strat") }, label = { Text("Stratifié") })
                FilterChip(selected = material == "agglo", onClick = { onMaterialChange("agglo") }, label = { Text("Agglo") })
            }
            Spacer(Modifier.height(8.dp))

            var decorExpanded by remember { mutableStateOf(false) }
            val decorLabel = decorOptions.firstOrNull { it.code == decor }?.let { "${it.code} — ${it.L.roundToLong()} × ${it.W.roundToLong()}" } ?: "— aucun décor —"
            ExposedDropdownMenuBox(expanded = decorExpanded, onExpandedChange = { decorExpanded = it }) {
                OutlinedTextField(
                    value = decorLabel, onValueChange = {}, readOnly = true, label = { Text("Décor / matière") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = decorExpanded) },
                    modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
                )
                DropdownMenu(expanded = decorExpanded, onDismissRequest = { decorExpanded = false }) {
                    DropdownMenuItem(text = { Text("— aucun décor (format choisi ci-dessous) —") }, onClick = { onDecorChange(""); decorExpanded = false })
                    decorOptions.forEach { opt ->
                        DropdownMenuItem(
                            text = { Text("${opt.code} — ${opt.L.roundToLong()} × ${opt.W.roundToLong()}") },
                            onClick = { onDecorChange(opt.code); decorExpanded = false },
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text("Format de panneau (bibliothèque Woodstore)", style = MaterialTheme.typography.labelSmall)
            var formatExpanded by remember { mutableStateOf(false) }
            val formatLabel = if (useManualFormat || selectedFormatKey == null) {
                "Autre format (saisie manuelle)"
            } else {
                formatOptions.firstOrNull { "${it.L}|${it.W}" == selectedFormatKey }?.let { "${it.L.roundToLong()} × ${it.W.roundToLong()} mm" } ?: "Autre format (saisie manuelle)"
            }
            ExposedDropdownMenuBox(expanded = formatExpanded, onExpandedChange = { formatExpanded = it }) {
                OutlinedTextField(
                    value = formatLabel, onValueChange = {}, readOnly = true, label = { Text("Format") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = formatExpanded) },
                    modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
                )
                DropdownMenu(expanded = formatExpanded, onDismissRequest = { formatExpanded = false }) {
                    formatOptions.forEach { opt ->
                        DropdownMenuItem(
                            text = { Text("${opt.L.roundToLong()} × ${opt.W.roundToLong()} mm") },
                            onClick = { onFormatSelect("${opt.L}|${opt.W}"); formatExpanded = false },
                        )
                    }
                    DropdownMenuItem(text = { Text("Autre format (saisie manuelle)") }, onClick = { onUseManualFormat(); formatExpanded = false })
                }
            }
            if (useManualFormat) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(manualL, onManualLChange, label = { Text("Longueur (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
                    OutlinedTextField(manualW, onManualWChange, label = { Text("Largeur (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
                }
            }
        }
    }
}

@Composable
private fun PieceFormPanel(
    l: String, w: String, qty: String, ep: String, rotate: Boolean, error: String?,
    onLChange: (String) -> Unit, onWChange: (String) -> Unit, onQtyChange: (String) -> Unit,
    onEpChange: (String) -> Unit, onRotateChange: (Boolean) -> Unit,
    onAdd: () -> Unit, onImportLancement: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("Pièces à découper", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(l, onLChange, label = { Text("Longueur (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(w, onWChange, label = { Text("Largeur (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(qty, onQtyChange, label = { Text("Qté") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(ep, onEpChange, label = { Text("Ép. finie (mm)") }, modifier = Modifier.weight(1f), singleLine = true)
            }
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = rotate, onCheckedChange = onRotateChange)
                Text("Rotation 90° autorisée", style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                "L'épaisseur de la pièce finie détermine si la recoupe est possible (≤19mm) ou si on reste en bandes (>19mm).",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall) }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onAdd) { Text("Ajouter") }
                OutlinedButton(onClick = onImportLancement) { Text("Importer un lancement (.xlsx)") }
            }
        }
    }
}
