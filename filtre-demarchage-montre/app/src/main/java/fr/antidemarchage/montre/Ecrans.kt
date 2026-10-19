package fr.antidemarchage.montre

import android.app.RemoteInput
import android.view.inputmethod.EditorInfo
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipColors
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.SplitToggleChip
import androidx.wear.compose.material.Switch
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.ToggleChip
import androidx.wear.input.RemoteInputIntentHelper
import androidx.wear.input.wearableExtender
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

const val ROUTE_ACCUEIL = "accueil"
const val ROUTE_ARCEP = "arcep"
const val ROUTE_PERSO = "perso"
const val ROUTE_JOURNAL = "journal"

private const val CLE_SAISIE = "saisie"

data class EtatEcran(
    val mode: Protection.Mode,
    val prefixesArcep: Boolean,
    val bloquerMasques: Boolean,
    val prefixesPerso: List<String>,
    val journal: List<AppelBloque>,
)

@Composable
fun EcranAccueil(
    etat: EtatEcran,
    onActiver: () -> Unit,
    onArcep: (Boolean) -> Unit,
    onMasques: (Boolean) -> Unit,
    onOuvrir: (String) -> Unit,
) {
    EcranListe {
        item { ListHeader { Text("Anti-démarchage") } }
        item {
            when (etat.mode) {
                Protection.Mode.INACTIVE -> ChipAction(
                    "Activer la protection", "Inactive", Icons.Filled.Warning,
                    ChipDefaults.primaryChipColors(), onActiver,
                )
                Protection.Mode.FILTRE_SYSTEME -> ChipAction(
                    "Protection active", "Avant la sonnerie", Icons.Filled.Check,
                    ChipDefaults.secondaryChipColors(), onClick = {},
                )
                Protection.Mode.SECOURS -> ChipAction(
                    "Protection active", "Mode secours", Icons.Filled.Check,
                    ChipDefaults.secondaryChipColors(), onClick = {},
                )
            }
        }
        item {
            SplitToggleChip(
                checked = etat.prefixesArcep,
                onCheckedChange = onArcep,
                label = { Text("Liste ARCEP") },
                secondaryLabel = { Text("${PrefixesArcep.TOUS.size} préfixes") },
                onClick = { onOuvrir(ROUTE_ARCEP) },
                toggleControl = { Switch(checked = etat.prefixesArcep) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            ToggleChip(
                checked = etat.bloquerMasques,
                onCheckedChange = onMasques,
                label = { Text("Numéros masqués") },
                secondaryLabel = {
                    Text(if (etat.mode == Protection.Mode.SECOURS) "Pas en mode secours" else "Les bloquer aussi")
                },
                toggleControl = { Switch(checked = etat.bloquerMasques) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            ChipAction(
                "Mes préfixes", pluriel(etat.prefixesPerso.size, "préfixe"), Icons.Filled.Edit,
                ChipDefaults.secondaryChipColors(), onClick = { onOuvrir(ROUTE_PERSO) },
            )
        }
        item {
            ChipAction(
                "Appels bloqués", pluriel(etat.journal.size, "appel"), Icons.AutoMirrored.Filled.List,
                ChipDefaults.secondaryChipColors(), onClick = { onOuvrir(ROUTE_JOURNAL) },
            )
        }
    }
}

@Composable
fun EcranArcep() {
    EcranListe {
        item { ListHeader { Text("Préfixes ARCEP") } }
        item { TexteInfo("Métropole") }
        items(PrefixesArcep.METROPOLE.chunked(2)) { paire ->
            Text(
                paire.joinToString("     ") { formaterPrefixe(it) },
                style = MaterialTheme.typography.title3,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item { TexteInfo("Outre-mer") }
        items(PrefixesArcep.OUTRE_MER.toList()) { (prefixe, territoire) ->
            LigneDeuxTextes(formaterPrefixe(prefixe), territoire)
        }
    }
}

@Composable
fun EcranPrefixesPerso(
    prefixes: List<String>,
    onAjouter: (String) -> Unit,
    onRetirer: (String) -> Unit,
) {
    val saisir = rememberSaisieTexte("Préfixe à bloquer", onAjouter)
    EcranListe {
        item { ListHeader { Text("Mes préfixes") } }
        item {
            ChipAction("Ajouter", null, Icons.Filled.Add, ChipDefaults.primaryChipColors(), saisir)
        }
        if (prefixes.isEmpty()) {
            item { TexteInfo("Ex. 0899 ou +44 : tout numéro qui commence ainsi sera bloqué.") }
        }
        items(prefixes) { prefixe ->
            ChipAction(
                prefixe, "Toucher pour retirer", Icons.Filled.Delete,
                ChipDefaults.secondaryChipColors(), onClick = { onRetirer(prefixe) },
            )
        }
    }
}

@Composable
fun EcranJournal(journal: List<AppelBloque>, onEffacer: () -> Unit) {
    val format = remember { SimpleDateFormat("d MMM HH:mm", Locale.FRANCE) }
    EcranListe {
        item { ListHeader { Text("Appels bloqués") } }
        if (journal.isEmpty()) {
            item { TexteInfo("Aucun appel bloqué pour l'instant.") }
        }
        items(journal) { appel ->
            val date = format.format(Date(appel.horodatage))
            LigneDeuxTextes(
                appel.numero?.let(FiltreNumeros::formater) ?: "Numéro masqué",
                if (appel.motif == FiltreNumeros.MOTIF_MASQUE) date else "$date · ${appel.motif}",
            )
        }
        if (journal.isNotEmpty()) {
            item {
                ChipAction("Effacer", null, Icons.Filled.Delete, ChipDefaults.secondaryChipColors(), onEffacer)
            }
        }
    }
}

@Composable
private fun EcranListe(contenu: ScalingLazyListScope.() -> Unit) {
    val etatListe = rememberScalingLazyListState()
    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = etatListe) },
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = etatListe,
            content = contenu,
        )
    }
}

@Composable
private fun ChipAction(
    libelle: String,
    detail: String?,
    icone: ImageVector,
    couleurs: ChipColors,
    onClick: () -> Unit,
) {
    Chip(
        onClick = onClick,
        label = { Text(libelle) },
        secondaryLabel = detail?.let { { Text(it) } },
        icon = { Icon(icone, contentDescription = null) },
        colors = couleurs,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LigneDeuxTextes(titre: String, detail: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Text(titre, style = MaterialTheme.typography.title3)
        Text(detail, style = MaterialTheme.typography.caption2, color = MaterialTheme.colors.onSurfaceVariant)
    }
}

@Composable
private fun TexteInfo(texte: String) {
    Text(
        texte,
        style = MaterialTheme.typography.caption2,
        color = MaterialTheme.colors.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
    )
}

/** Ouvre le clavier ou la dictée de la montre et passe le texte saisi à [onSaisie]. */
@Composable
private fun rememberSaisieTexte(libelle: String, onSaisie: (String) -> Unit): () -> Unit {
    val lanceur = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { resultat ->
        val texte = resultat.data
            ?.let { RemoteInput.getResultsFromIntent(it) }
            ?.getCharSequence(CLE_SAISIE)
        if (!texte.isNullOrBlank()) onSaisie(texte.toString())
    }
    return {
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        val saisie = RemoteInput.Builder(CLE_SAISIE)
            .setLabel(libelle)
            .wearableExtender {
                setEmojisAllowed(false)
                setInputActionType(EditorInfo.IME_ACTION_DONE)
            }
            .build()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(saisie))
        lanceur.launch(intent)
    }
}

/** « 0162 » → « 01 62 », « 09475 » → « 09 475 ». */
private fun formaterPrefixe(prefixe: String) = prefixe.take(2) + " " + prefixe.drop(2)

private fun pluriel(nombre: Int, mot: String) = if (nombre > 1) "$nombre ${mot}s" else "$nombre $mot"
