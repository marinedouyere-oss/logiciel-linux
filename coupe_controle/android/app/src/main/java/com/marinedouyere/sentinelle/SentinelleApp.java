package com.marinedouyere.sentinelle;

import android.app.Application;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Données partagées par toute l'appli (gardées si l'écran est recréé). */
public final class SentinelleApp extends Application {

    /** Lecture du fichier partagé, fabrication du compte rendu. */
    final ExecutorService annexe = Executors.newSingleThreadExecutor();
    /** Dernier fichier partagé lu (semaines gardées par Sentinelle sur le PC). */
    volatile FichierPartage partage;
    /** PDF en attente de son emplacement (sélecteur d'Android ouvert). */
    volatile byte[] pdfEnAttente;
}
