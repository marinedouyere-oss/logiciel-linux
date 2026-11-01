// Sentinelle pour Windows : un seul .exe, rien à installer.
//
// Le programme garde la page Sentinelle à l'intérieur de lui-même, la sert
// sur cet ordinateur seulement (http://127.0.0.1, port fixe : la mémoire de
// Sentinelle reste attachée à cette adresse) et l'ouvre dans sa propre
// fenêtre Edge (mode application, profil à part dans
// %LOCALAPPDATA%\Sentinelle). Aucun autre ordinateur ni téléphone ne peut s'y
// connecter. Il s'arrête tout seul quelques minutes après la fermeture de la
// fenêtre.
package main

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed page
var page embed.FS

// Numéro de version, donné à la fabrication (-ldflags "-X main.version=6.0.1").
var version = "dev"

const (
	port         = 47815
	adresse      = "127.0.0.1:47815"
	silenceMax   = 3 * time.Minute // plus de signe de la fenêtre depuis ce temps : arrêt
	premierSigne = 2 * time.Minute // délai pour que la fenêtre s'ouvre et donne signe de vie
	signeVie     = "/sentinelle/vivant"
	quiEstLa     = "/sentinelle/version"
	quitter      = "/sentinelle/quitter"
)

// Petit script ajouté à la page servie : la fenêtre ouverte donne signe de vie.
const scriptVie = `<script>/* Sentinelle.exe : la fenêtre est ouverte */(function(){function v(){fetch("` + signeVie + `",{cache:"no-store"}).catch(function(){})}v();setInterval(v,30000);})();</script>`

var (
	verrou       sync.Mutex
	dernierSigne time.Time
	arret        = make(chan struct{})
	arretUneFois sync.Once
)

func main() {
	url := fmt.Sprintf("http://%s/", adresse)
	ecoute, err := net.Listen("tcp", adresse)
	if err != nil {
		// Le port est pris : Sentinelle est peut-être déjà ouverte.
		autre := versionEnPlace()
		switch {
		case autre == version:
			ouvrirFenetre(url)
			return
		case autre != "":
			// Une autre version tourne encore : on lui demande de s'arrêter, puis on prend sa place.
			demanderArret()
			for i := 0; i < 50 && err != nil; i++ {
				time.Sleep(100 * time.Millisecond)
				ecoute, err = net.Listen("tcp", adresse)
			}
			if err != nil {
				message("Sentinelle", fmt.Sprintf("Sentinelle %s est déjà ouverte.\n\nFermez-la, attendez quelques minutes, puis relancez Sentinelle %s.", autre, version))
				return
			}
		default:
			message("Sentinelle", fmt.Sprintf("Sentinelle ne peut pas démarrer : le port %d de cet ordinateur est déjà utilisé par un autre programme.", port))
			return
		}
	}
	signe()
	serveur := &http.Server{Handler: http.HandlerFunc(servir), ReadHeaderTimeout: 10 * time.Second}
	go serveur.Serve(ecoute)
	if os.Getenv("SENTINELLE_SANS_FENETRE") == "" {
		ouvrirFenetre(url)
	}
	surveiller()
	serveur.Close()
}

// Arrêt quand la fenêtre ne donne plus signe de vie.
func surveiller() {
	debut := time.Now()
	for {
		select {
		case <-arret:
			return
		case <-time.After(5 * time.Second):
		}
		verrou.Lock()
		dernier := dernierSigne
		verrou.Unlock()
		if time.Since(debut) > premierSigne && time.Since(dernier) > silenceMax {
			return
		}
	}
}

func signe() {
	verrou.Lock()
	dernierSigne = time.Now()
	verrou.Unlock()
}

func servir(w http.ResponseWriter, r *http.Request) {
	// Seulement les adresses de cet ordinateur (protège des pages web qui viseraient le port).
	hote := r.Host
	if hote != adresse && hote != fmt.Sprintf("localhost:%d", port) {
		http.Error(w, "interdit", http.StatusForbidden)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	switch r.URL.Path {
	case signeVie:
		signe()
		w.WriteHeader(http.StatusNoContent)
		return
	case quiEstLa:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, version)
		return
	case quitter:
		// Demande d'une autre version de Sentinelle (en-tête impossible à envoyer depuis une page web étrangère).
		if r.Method != http.MethodPost || r.Header.Get("X-Sentinelle") != "quitter" {
			http.Error(w, "interdit", http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		arretUneFois.Do(func() { close(arret) })
		return
	case "/", "/index.html":
		html, err := page.ReadFile("page/index.html")
		if err != nil {
			http.Error(w, "page absente", http.StatusInternalServerError)
			return
		}
		if i := bytes.LastIndex(html, []byte("</body>")); i >= 0 {
			html = append(append(append([]byte{}, html[:i]...), scriptVie...), html[i:]...)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(html)
		return
	}
	// Pas de service worker ici : la page est toujours servie par le .exe, à jour.
	nom := strings.TrimPrefix(r.URL.Path, "/")
	if nom == "sw.js" || strings.Contains(nom, "..") {
		http.NotFound(w, r)
		return
	}
	contenu, err := page.ReadFile("page/" + nom)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch filepath.Ext(nom) {
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".webmanifest":
		w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	}
	w.Write(contenu)
}

func versionEnPlace() string {
	client := http.Client{Timeout: 2 * time.Second}
	rep, err := client.Get(fmt.Sprintf("http://%s%s", adresse, quiEstLa))
	if err != nil {
		return ""
	}
	defer rep.Body.Close()
	corps, _ := io.ReadAll(io.LimitReader(rep.Body, 100))
	if rep.StatusCode != http.StatusOK {
		return ""
	}
	return strings.TrimSpace(string(corps))
}

func demanderArret() {
	req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("http://%s%s", adresse, quitter), nil)
	req.Header.Set("X-Sentinelle", "quitter")
	client := http.Client{Timeout: 2 * time.Second}
	if rep, err := client.Do(req); err == nil {
		rep.Body.Close()
	}
}

// Ouvre Sentinelle dans sa propre fenêtre : Edge (sinon Chrome) en mode application,
// avec un profil à part ; à défaut, le navigateur par défaut.
func ouvrirFenetre(url string) {
	profil := filepath.Join(os.Getenv("LOCALAPPDATA"), "Sentinelle", "Navigateur")
	for _, nav := range navigateurs() {
		if _, err := os.Stat(nav); err != nil {
			continue
		}
		cmd := exec.Command(nav, "--app="+url, "--user-data-dir="+profil, "--no-first-run", "--no-default-browser-check", "--start-maximized")
		if cmd.Start() == nil {
			go cmd.Wait()
			return
		}
	}
	if err := ouvrirParDefaut(url); err != nil {
		message("Sentinelle", "Impossible d'ouvrir la fenêtre de Sentinelle.\n\nOuvrez Edge ou Chrome à cette adresse :\n"+url)
	}
}

func navigateurs() []string {
	var liste []string
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if base != "" {
			liste = append(liste, filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
		}
	}
	for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
		if base != "" {
			liste = append(liste, filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
		}
	}
	return liste
}
