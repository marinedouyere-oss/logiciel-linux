package com.marinedouyere.orion.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.marinedouyere.orion.data.FAM_PROFILE
import com.marinedouyere.orion.data.LancementImportResult
import com.marinedouyere.orion.data.Piece
import com.marinedouyere.orion.data.SETTINGS_DEFAULTS
import com.marinedouyere.orion.data.SETTINGS_SCHEMA
import com.marinedouyere.orion.data.WoodstoreRepository
import com.marinedouyere.orion.data.WoodstoreRow
import com.marinedouyere.orion.data.decorFamily
import com.marinedouyere.orion.data.decorFormats
import com.marinedouyere.orion.data.decorRows
import com.marinedouyere.orion.data.grainOf
import com.marinedouyere.orion.data.groupByDecor
import com.marinedouyere.orion.data.jsParseFloat
import com.marinedouyere.orion.data.parseLancement
import com.marinedouyere.orion.engine.BestFormatResult
import com.marinedouyere.orion.engine.OptimizeConfig
import com.marinedouyere.orion.engine.OptimizeResult
import com.marinedouyere.orion.engine.StockFormat
import com.marinedouyere.orion.engine.meilleurDesDeuxMoteurs
import com.marinedouyere.orion.engine.optimizeBestFormat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Single shared state holder for all three tabs, mirroring orion.html's
 * module-level `let pieces/WOODSTORE/SETTINGS/currentMaterial` globals.
 */
class OrionViewModel(application: Application) : AndroidViewModel(application) {

    var currentMaterial by mutableStateOf("strat")
        private set

    val pieces = mutableStateListOf<Piece>()
    val woodstore = mutableStateListOf<WoodstoreRow>()

    /** profile ("strat"/"agglo") -> field id -> value (Double, String or null). Session-only, like the source. */
    val settings: Map<String, MutableMap<String, Any?>> = SETTINGS_DEFAULTS.mapValues { (_, fields) -> fields.toMutableMap() }

    var isWoodstoreLoading by mutableStateOf(true)
        private set
    var woodstoreError by mutableStateOf<String?>(null)
        private set
    var isComputing by mutableStateOf(false)
        private set
    var computeError by mutableStateOf<String?>(null)
        private set
    var computeRuns by mutableStateOf<List<CalepinageRun>?>(null)
        private set

    private var nextId = 1

    init {
        reloadWoodstore()
    }

    /** (Re)loads the Woodstore library from local storage, or the bundled seed on first run. */
    fun reloadWoodstore() {
        isWoodstoreLoading = true
        woodstoreError = null
        viewModelScope.launch(Dispatchers.IO) {
            val result = runCatching { WoodstoreRepository.load(getApplication()) }
            withContext(Dispatchers.Main) {
                result.onSuccess { loaded ->
                    woodstore.clear()
                    woodstore.addAll(loaded)
                    if (loaded.isEmpty()) {
                        woodstoreError = "La bibliothèque Woodstore est vide (aucune référence chargée)."
                    }
                }.onFailure { e ->
                    woodstoreError = "Impossible de charger Woodstore : ${e.message ?: e::class.simpleName}"
                }
                isWoodstoreLoading = false
            }
        }
    }

    fun setMaterial(key: String) {
        currentMaterial = key
    }

    // ---- Pieces (Calepinage tab) -------------------------------------------------

    fun addPiece(name: String?, l: Double, w: Double, qty: Int, rotate: Boolean, decor: String, ep: Double?, fmtL: Double?, fmtW: Double?) {
        val id = nextId++
        pieces.add(
            Piece(
                id = id,
                name = name?.takeUnless { it.isBlank() } ?: "Pièce $id",
                L = l, W = w, qty = qty, rotate = rotate, decor = decor.trim(),
                material = currentMaterial, fmtL = fmtL, fmtW = fmtW, ep = ep,
            ),
        )
    }

    fun removePiece(id: Int) {
        pieces.removeAll { it.id == id }
    }

    fun clearPieces() {
        pieces.clear()
    }

    fun importLancement(rows: List<List<String>>): LancementImportResult? {
        val res = parseLancement(rows) { nextId++ } ?: return null
        pieces.addAll(res.pieces)
        return res
    }

    // ---- Settings (Réglages machine tab) ------------------------------------------

    fun updateSetting(profile: String, fieldId: String, rawValue: String) {
        val field = SETTINGS_SCHEMA.asSequence().flatMap { it.fields }.firstOrNull { it.id == fieldId }
        val coerced: Any = if (field?.isText == true) rawValue else (jsParseFloat(rawValue) ?: 0.0)
        settings[profile]?.set(fieldId, coerced)
    }

    // ---- Woodstore tab -------------------------------------------------------------

    fun addWoodstoreRow(row: WoodstoreRow): Boolean {
        if (woodstore.any { it.id == row.id }) return false
        woodstore.add(0, row)
        persistWoodstore()
        return true
    }

    fun deleteWoodstoreRow(id: String) {
        woodstore.removeAll { it.id == id }
        persistWoodstore()
    }

    fun resetWoodstoreToBase() {
        // Compute the replacement BEFORE touching the current list: if loading the
        // seed fails for any reason, the existing library must not be wiped out.
        val seed = try {
            WoodstoreRepository.loadSeed(getApplication())
        } catch (e: Exception) {
            woodstoreError = "Impossible de recharger la bibliothèque d'origine : ${e.message ?: e::class.simpleName}"
            return
        }
        woodstore.clear()
        woodstore.addAll(seed)
        if (seed.isEmpty()) woodstoreError = "La bibliothèque d'origine est vide."
        persistWoodstore()
    }

    /** Returns the count actually imported (matches the confirm() dialog's "replace vs merge" choice in orion.html). */
    fun applyWoodstoreImport(imported: List<WoodstoreRow>, replace: Boolean): Int {
        if (replace) {
            woodstore.clear()
            woodstore.addAll(imported)
        } else {
            val ids = woodstore.map { it.id }.toHashSet()
            woodstore.addAll(imported.filter { it.id !in ids })
        }
        persistWoodstore()
        return imported.size
    }

    private fun persistWoodstore() {
        val snapshot = woodstore.toList()
        viewModelScope.launch(Dispatchers.IO) { WoodstoreRepository.save(getApplication(), snapshot) }
    }

    // ---- Compute (Calepinage tab "Calculer le calepinage") -------------------------

    fun compute(manualL: Double, manualW: Double, compareAllFormats: Boolean) {
        if (pieces.isEmpty()) {
            computeError = "Ajoute au moins une pièce avant de calculer."
            return
        }
        isComputing = true
        computeError = null
        val piecesSnapshot = pieces.toList()
        val woodstoreSnapshot = woodstore.toList()
        val settingsSnapshot = settings.mapValues { (_, m) -> m.toMap() }
        val material = currentMaterial

        viewModelScope.launch(Dispatchers.Default) {
            try {
                val groups = groupByDecor(piecesSnapshot, material)
                val budget = maxOf(800L, 6000L / groups.size)
                val runs = groups.values.map { groupPieces ->
                    buildRun(groupPieces, budget, manualL, manualW, compareAllFormats, woodstoreSnapshot, settingsSnapshot, material)
                }
                withContext(Dispatchers.Main) {
                    computeRuns = runs
                    isComputing = false
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    computeError = "Erreur pendant le calcul : ${e.message}"
                    isComputing = false
                }
            }
        }
    }

    private fun numOf(profile: Map<String, Any?>, key: String): Double = (profile[key] as? Number)?.toDouble() ?: 0.0
    private fun nullableNumOf(profile: Map<String, Any?>, key: String): Double? = (profile[key] as? Number)?.toDouble()

    private fun buildRun(
        groupPieces: List<Piece>,
        budget: Long,
        manualL: Double,
        manualW: Double,
        compareAll: Boolean,
        woodstoreSnapshot: List<WoodstoreRow>,
        settingsSnapshot: Map<String, Map<String, Any?>>,
        currentMaterial: String,
    ): CalepinageRun {
        val first = groupPieces[0]
        val decor = first.decor
        val material = if (decor.isNotBlank()) null else first.material
        val ep = first.ep
        val plan = first.plan

        // idPlan is the priority signal when present: "C" (Modulo/crédence) -> recoupe
        // possible if thin enough; "B"/"U" -> recoupe forbidden; absent -> fall back to
        // thickness alone.
        val epOk = ep == null || ep <= 19.0
        val recoupePossible = when (plan) {
            "C" -> epOk
            "B", "U" -> false
            else -> epOk
        }
        val forceNoRecoupe = !recoupePossible
        val maxBandWaste = if (forceNoRecoupe) 50.0 else Double.POSITIVE_INFINITY

        val fam = if (decor.isNotBlank()) decorFamily(woodstoreSnapshot, decor) else null
        val profileKey = if (fam != null) (FAM_PROFILE[fam] ?: currentMaterial) else (material ?: currentMaterial)
        val v = settingsSnapshot[profileKey].orEmpty()
        val trimLong = numOf(v, "affranchLongAvant") + numOf(v, "affranchLongArriere")
        val trimTrans = numOf(v, "affranchTransAvant") + numOf(v, "affranchTransArriere")

        val grain = if (decor.isNotBlank()) grainOf(woodstoreSnapshot, decor) else null
        val forced = grain == "O"
        val gp = groupPieces.map { if (forced) it.copy(rotate = false) else it }

        val mat = MachineBounds(
            maxSawLength = numOf(v, "longueurDeCoupe"),
            panelLenMin = nullableNumOf(v, "panneauLongMin"), panelLenMax = nullableNumOf(v, "panneauLongMax"),
            panelWMin = nullableNumOf(v, "panneauLargMin"), panelWMax = nullableNumOf(v, "panneauLargMax"),
            pieceLenMin = nullableNumOf(v, "pieceLongMin"), pieceLenMax = nullableNumOf(v, "pieceLongMax"),
            pieceWMin = nullableNumOf(v, "pieceLargMin"), pieceWMax = nullableNumOf(v, "pieceLargMax"),
            minPieceLenBand = numOf(v, "longMinPieceBande"),
            minChuteL = numOf(v, "minChuteL"), minChuteW = numOf(v, "minChuteW"), minChuteArea = numOf(v, "minChuteArea"),
        )
        val cfgBase = OptimizeConfig(
            sheetL = 0.0, sheetW = 0.0,
            kerfSL = numOf(v, "kerfSL"), kerfST = numOf(v, "kerfST"),
            minChuteL = mat.minChuteL, minChuteW = mat.minChuteW, minChuteArea = mat.minChuteArea,
            reuseChutes = true, step = 5.0, timeBudgetMs = budget,
            trimLong = trimLong, trimTrans = trimTrans,
            forceNoRecoupe = forceNoRecoupe, maxBandWaste = maxBandWaste,
        )

        // formats candidats : ceux du décor dans Woodstore, sinon les formats choisis
        // pour ces pièces à l'ajout, sinon la saisie manuelle
        var formats = if (decor.isNotBlank()) {
            decorFormats(woodstoreSnapshot, decor).map { (l, w) -> StockFormat(l, w) }
        } else {
            emptyList()
        }
        if (formats.isEmpty()) {
            val uniq = LinkedHashMap<String, StockFormat>()
            groupPieces.forEach { p ->
                if (p.fmtL != null && p.fmtL != 0.0 && p.fmtW != null && p.fmtW != 0.0) {
                    uniq["${p.fmtL}x${p.fmtW}"] = StockFormat(p.fmtL, p.fmtW)
                }
            }
            formats = uniq.values.toList()
        }
        if (formats.isEmpty()) formats = listOf(StockFormat(manualL, manualW))

        var compare: BestFormatResult? = null
        val result: OptimizeResult
        val usedL: Double
        val usedW: Double
        if (formats.size > 1 && compareAll) {
            compare = optimizeBestFormat(gp, formats, cfgBase)
            result = compare.best.result
            usedL = compare.best.format.L
            usedW = compare.best.format.W
        } else {
            val f = formats[0]
            usedL = f.L
            usedW = f.W
            result = meilleurDesDeuxMoteurs(gp, cfgBase.copy(sheetL = usedL - trimLong, sheetW = usedW - trimTrans))
        }

        return CalepinageRun(
            decor = decor, material = material, grain = grain, fam = fam, profileKey = profileKey,
            result = result, compare = compare, usedL = usedL, usedW = usedW,
            trimLong = trimLong, trimTrans = trimTrans, mat = mat, pieces = gp,
            forcedNoRotation = forced, unknownDecor = decor.isNotBlank() && decorRows(woodstoreSnapshot, decor).isEmpty(),
            ep = ep, plan = plan, recoupePossible = recoupePossible, maxBandWaste = maxBandWaste,
        )
    }
}
