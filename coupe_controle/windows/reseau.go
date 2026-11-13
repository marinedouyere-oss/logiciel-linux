package main

// Expérimental : la page demande si un serveur de l'atelier répond (ex. woodStore, « 10.101.50.1 »).
// Seulement une ouverture de connexion TCP sur quelques ports, aussitôt refermée : rien n'est lu, rien n'est
// écrit, aucun mot de passe. Réservé à la page Sentinelle (en-tête X-Sentinelle, impossible à envoyer depuis une
// page web étrangère sans son accord), et aux adresses du réseau de l'entreprise.

import (
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const testerReseau = "/sentinelle/reseau/tester"

var nomHote = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$`)

type resultatPort struct {
	Port     int    `json:"port"`
	Repond   bool   `json:"repond"`
	Duree    int64  `json:"ms"`
	Probleme string `json:"probleme,omitempty"`
}

// Adresse du réseau de l'entreprise : IP privée (10.x, 172.16-31.x, 192.168.x), ou nom sans point
// (« SRV-WOODSTORE ») ou nom qui donne une IP privée.
func adresseInterne(hote string) bool {
	if ip := net.ParseIP(hote); ip != nil {
		return ip.IsPrivate()
	}
	if !nomHote.MatchString(hote) {
		return false
	}
	ips, err := net.LookupIP(hote)
	if err != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		if !ip.IsPrivate() {
			return false
		}
	}
	return true
}

func servirTestReseau(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.Header.Get("X-Sentinelle") != "reseau" {
		http.Error(w, "interdit", http.StatusForbidden)
		return
	}
	var demande struct {
		Hote  string `json:"hote"`
		Ports []int  `json:"ports"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2000)).Decode(&demande); err != nil || len(demande.Ports) == 0 || len(demande.Ports) > 6 {
		http.Error(w, "demande illisible", http.StatusBadRequest)
		return
	}
	if !adresseInterne(demande.Hote) {
		http.Error(w, "adresse hors du réseau de l'entreprise", http.StatusBadRequest)
		return
	}
	resultats := make([]resultatPort, 0, len(demande.Ports))
	for _, p := range demande.Ports {
		if p < 1 || p > 65535 {
			continue
		}
		debut := time.Now()
		c, err := net.DialTimeout("tcp", net.JoinHostPort(demande.Hote, strconv.Itoa(p)), 3*time.Second)
		res := resultatPort{Port: p, Duree: time.Since(debut).Milliseconds()}
		if err == nil {
			res.Repond = true
			c.Close()
		} else {
			res.Probleme = err.Error()
		}
		resultats = append(resultats, res)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(resultats)
}
