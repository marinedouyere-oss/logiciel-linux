package fr.antidemarchage.montre

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.telecom.TelecomManager
import android.telephony.TelephonyManager

/**
 * Mode secours : raccroche dès que la sonnerie démarre. La montre peut vibrer une
 * fraction de seconde, et les numéros masqués ne sont pas reconnus (Android
 * n'indique pas si un appel sans numéro est masqué).
 */
class AppelEntrantReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (intent.getStringExtra(TelephonyManager.EXTRA_STATE) != TelephonyManager.EXTRA_STATE_RINGING) return
        // Android envoie l'événement deux fois ; seule la copie destinée aux applis
        // qui ont READ_CALL_LOG porte le numéro.
        @Suppress("DEPRECATION")
        val numero = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
            ?.takeIf { it.isNotBlank() } ?: return
        if (Protection.filtreSystemeActif(context)) return
        if (context.checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) return

        val reglages = Reglages(context)
        val motif = reglages.motifBlocage(numero) ?: return
        @Suppress("DEPRECATION")
        if (context.getSystemService(TelecomManager::class.java).endCall()) {
            reglages.journaliser(numero, motif)
        }
    }
}
