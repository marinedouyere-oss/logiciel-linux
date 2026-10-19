package fr.antidemarchage.montre

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController

class MainActivity : ComponentActivity() {

    private lateinit var reglages: Reglages
    private var etat by mutableStateOf<EtatEcran?>(null)

    private val demandePermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            rafraichir()
            if (Protection.mode(this) == Protection.Mode.INACTIVE) {
                Toast.makeText(this, "Autorisez l'appli dans Paramètres > Applis", Toast.LENGTH_LONG).show()
            }
        }

    private val demandeRole =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            // Rôle refusé : on se rabat sur le mode secours.
            if (Protection.filtreSystemeActif(this)) rafraichir()
            else demandePermissions.launch(Protection.PERMISSIONS_SECOURS)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reglages = Reglages(this)
        rafraichir()
        setContent {
            val e = etat
            if (e != null) {
                MaterialTheme {
                    val navigation = rememberSwipeDismissableNavController()
                    SwipeDismissableNavHost(navController = navigation, startDestination = ROUTE_ACCUEIL) {
                        composable(ROUTE_ACCUEIL) {
                            EcranAccueil(
                                etat = e,
                                onActiver = ::activerProtection,
                                onArcep = { actif -> modifier { prefixesArcepActifs = actif } },
                                onMasques = { actif -> modifier { bloquerMasques = actif } },
                                onOuvrir = { route -> navigation.navigate(route) },
                            )
                        }
                        composable(ROUTE_ARCEP) { EcranArcep() }
                        composable(ROUTE_PERSO) {
                            EcranPrefixesPerso(
                                prefixes = e.prefixesPerso,
                                onAjouter = ::ajouterPrefixe,
                                onRetirer = { prefixe -> modifier { retirerPrefixe(prefixe) } },
                            )
                        }
                        composable(ROUTE_JOURNAL) {
                            EcranJournal(journal = e.journal, onEffacer = { modifier { effacerJournal() } })
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Des appels ont pu être bloqués pendant que l'appli était fermée.
        rafraichir()
    }

    private fun activerProtection() {
        if (Protection.filtreSystemeDisponible(this)) {
            val roles = getSystemService(RoleManager::class.java)
            try {
                demandeRole.launch(roles.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING))
                return
            } catch (_: ActivityNotFoundException) {
                // Rôle annoncé mais sans écran pour le choisir : mode secours.
            }
        }
        demandePermissions.launch(Protection.PERMISSIONS_SECOURS)
    }

    private fun ajouterPrefixe(saisie: String) {
        if (!reglages.ajouterPrefixe(saisie)) {
            Toast.makeText(this, "Préfixe non valide : « $saisie »", Toast.LENGTH_SHORT).show()
        }
        rafraichir()
    }

    private fun modifier(action: Reglages.() -> Unit) {
        reglages.action()
        rafraichir()
    }

    private fun rafraichir() {
        etat = EtatEcran(
            mode = Protection.mode(this),
            prefixesArcep = reglages.prefixesArcepActifs,
            bloquerMasques = reglages.bloquerMasques,
            prefixesPerso = reglages.prefixesPerso,
            journal = reglages.journal,
        )
    }
}
