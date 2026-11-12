package main

// V6.5.2 : le code de liaison avec le téléphone est aussi gardé dans un fichier de cet ordinateur
// (%LOCALAPPDATA%\Sentinelle\lien-telephone.json), pas seulement dans la mémoire du navigateur. Si Chrome perd sa
// mémoire (nettoyage, règle de l'entreprise, autre profil, nouvelle version), Sentinelle reprend le même code : le
// téléphone et les PC de validation n'ont rien à refaire.
//
// Lecture et écriture demandent l'en-tête X-Sentinelle (une page web étrangère ne peut pas l'envoyer sans
// autorisation CORS, que ce serveur ne donne jamais) ; l'adresse est déjà limitée à cet ordinateur (servir).

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

const memoireLien = "/sentinelle/lien"

func fichierLien() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, nomLogiciel, "lien-telephone.json")
}

func servirLien(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Sentinelle") != "lien" {
		http.Error(w, "interdit", http.StatusForbidden)
		return
	}
	chemin := fichierLien()
	switch r.Method {
	case http.MethodGet:
		contenu, err := os.ReadFile(chemin)
		if err != nil || !json.Valid(contenu) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(contenu)
	case http.MethodPut:
		contenu, err := io.ReadAll(io.LimitReader(r.Body, 8192))
		if err != nil || !json.Valid(contenu) {
			http.Error(w, "contenu invalide", http.StatusBadRequest)
			return
		}
		if err := os.MkdirAll(filepath.Dir(chemin), 0o755); err != nil {
			http.Error(w, "dossier impossible", http.StatusInternalServerError)
			return
		}
		// Écriture sûre : fichier temporaire, puis remplacement.
		tmp := chemin + ".tmp"
		if err := os.WriteFile(tmp, contenu, 0o600); err != nil {
			http.Error(w, "écriture impossible", http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp, chemin); err != nil {
			_ = os.Remove(chemin)
			if err := os.Rename(tmp, chemin); err != nil {
				http.Error(w, "écriture impossible", http.StatusInternalServerError)
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "méthode", http.StatusMethodNotAllowed)
	}
}
