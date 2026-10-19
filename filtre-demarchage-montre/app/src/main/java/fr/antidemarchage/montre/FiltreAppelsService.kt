package fr.antidemarchage.montre

import android.telecom.Call
import android.telecom.CallScreeningService
import android.telecom.TelecomManager

/** Filtre système : Android soumet chaque appel à ce service avant de faire sonner la montre. */
class FiltreAppelsService : CallScreeningService() {

    override fun onScreenCall(callDetails: Call.Details) {
        if (callDetails.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(callDetails, CallResponse.Builder().build())
            return
        }
        val numero = callDetails.handle?.schemeSpecificPart
            ?.takeIf { callDetails.handlePresentation == TelecomManager.PRESENTATION_ALLOWED }
        val reglages = Reglages(this)
        val motif = reglages.motifBlocage(numero)

        val reponse = CallResponse.Builder()
        if (motif != null) {
            reponse.setDisallowCall(true)
                .setRejectCall(true)
                .setSkipNotification(true)
        }
        respondToCall(callDetails, reponse.build())
        if (motif != null) reglages.journaliser(numero, motif)
    }
}
