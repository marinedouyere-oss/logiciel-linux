package fr.antidemarchage.montre

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.pm.PackageManager

/**
 * Deux façons de bloquer selon ce que la montre permet :
 * - filtre système : l'appli est choisie comme « filtre d'appels » et Android lui
 *   soumet chaque appel avant de faire sonner (comme Prefixtel) ;
 * - mode secours : si la montre ne propose pas ce rôle, l'appli raccroche dès
 *   que la sonnerie démarre.
 */
object Protection {

    enum class Mode { FILTRE_SYSTEME, SECOURS, INACTIVE }

    val PERMISSIONS_SECOURS = arrayOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.ANSWER_PHONE_CALLS,
    )

    fun mode(context: Context): Mode = when {
        filtreSystemeActif(context) -> Mode.FILTRE_SYSTEME
        secoursAutorise(context) -> Mode.SECOURS
        else -> Mode.INACTIVE
    }

    fun filtreSystemeDisponible(context: Context): Boolean =
        context.getSystemService(RoleManager::class.java)
            ?.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) == true

    fun filtreSystemeActif(context: Context): Boolean =
        context.getSystemService(RoleManager::class.java)
            ?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true

    private fun secoursAutorise(context: Context): Boolean = PERMISSIONS_SECOURS.all {
        context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }
}
