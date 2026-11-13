package com.marinedouyere.sentinelle.moteur;

/** Fichier lu mais inexploitable : le message est affiché tel quel à l'utilisateur. */
public final class ErreurLecture extends Exception {
    public ErreurLecture(String message) {
        super(message);
    }
}
