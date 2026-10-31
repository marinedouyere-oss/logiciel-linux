package com.marinedouyere.sentinelle;

import android.app.Application;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Données et travaux partagés par toute l'appli : un contrôle lancé
 * continue et met à jour la même case même si l'écran est recréé.
 */
public final class SentinelleApp extends Application {

    private Depot depot;
    private Controles controles;
    /** Un seul contrôle à la fois, dans l'ordre où ils sont demandés (comme l'appli web). */
    final ExecutorService fond = Executors.newSingleThreadExecutor();
    /** Calculs légers indépendants (compteur de pièces, détection de semaine). */
    final ExecutorService annexe = Executors.newSingleThreadExecutor();
    /** Dernier fichier partagé lu (semaines gardées par Sentinelle sur le PC) : la casse s'en sert. */
    volatile FichierPartage partage;

    synchronized Depot depot() {
        if (depot == null) depot = new Depot(this);
        return depot;
    }

    synchronized Controles controles() {
        if (controles == null) controles = new Controles(this);
        return controles;
    }
}
