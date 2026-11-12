package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// V6.5.2 : le code de liaison est gardé dans un fichier ; sans l'en-tête X-Sentinelle, rien n'est lu ni écrit.
func TestMemoireLien(t *testing.T) {
	dossier := t.TempDir()
	t.Setenv("LOCALAPPDATA", dossier)
	appel := func(methode, corps string, avecEntete bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(methode, "http://"+adresse+memoireLien, strings.NewReader(corps))
		r.Host = adresse
		if avecEntete {
			r.Header.Set("X-Sentinelle", "lien")
		}
		w := httptest.NewRecorder()
		servir(w, r)
		return w
	}
	if w := appel(http.MethodGet, "", true); w.Code != http.StatusNotFound {
		t.Fatalf("rien de gardé : 404 attendu, reçu %d", w.Code)
	}
	if w := appel(http.MethodPut, `{"code":"ABCD-EFGH-JKLM-NPQR"}`, false); w.Code != http.StatusForbidden {
		t.Fatalf("sans en-tête : interdit attendu, reçu %d", w.Code)
	}
	if w := appel(http.MethodPut, `pas du json`, true); w.Code != http.StatusBadRequest {
		t.Fatalf("contenu invalide : 400 attendu, reçu %d", w.Code)
	}
	if w := appel(http.MethodPut, `{"code":"ABCD-EFGH-JKLM-NPQR"}`, true); w.Code != http.StatusNoContent {
		t.Fatalf("écriture : 204 attendu, reçu %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(dossier, "Sentinelle", "lien-telephone.json")); err != nil {
		t.Fatalf("fichier absent : %v", err)
	}
	if w := appel(http.MethodGet, "", false); w.Code != http.StatusForbidden {
		t.Fatalf("lecture sans en-tête : interdit attendu, reçu %d", w.Code)
	}
	w := appel(http.MethodGet, "", true)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "ABCD-EFGH-JKLM-NPQR") {
		t.Fatalf("relecture : %d %s", w.Code, w.Body.String())
	}
	// Remplacement (nouveau code) : le dernier gagne.
	appel(http.MethodPut, `{"code":"WXYZ-WXYZ-WXYZ-WXYZ"}`, true)
	if w := appel(http.MethodGet, "", true); !strings.Contains(w.Body.String(), "WXYZ") {
		t.Fatalf("remplacement : %s", w.Body.String())
	}
	// Une autre adresse que cet ordinateur : refusé.
	r := httptest.NewRequest(http.MethodGet, "http://exemple.test"+memoireLien, nil)
	r.Host = "exemple.test"
	r.Header.Set("X-Sentinelle", "lien")
	w2 := httptest.NewRecorder()
	servir(w2, r)
	if w2.Code != http.StatusForbidden {
		t.Fatalf("autre adresse : interdit attendu, reçu %d", w2.Code)
	}
}
