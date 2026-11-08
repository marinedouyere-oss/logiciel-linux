//go:build windows

// Détecteur d'étiquette Zebra (Laisné Industrie) — essai, avant de fabriquer le vrai outil.
//
// But : vérifier qu'au moment où Diakonos imprime une étiquette, le CVC de la pièce est écrit
// en TEXTE dans l'impression (langage ZPL de la Zebra). Si oui, on pourra savoir qu'une pièce
// est faite sans jamais toucher à la base de Diakonos.
//
// Ce que fait ce petit programme, et RIEN d'autre :
//   1. il se relance en administrateur (une fenêtre Windows demande « Oui ») ;
//   2. il trouve l'imprimante Zebra et lui demande de GARDER un instant ce qu'elle imprime ;
//   3. il attend que vous validiez UNE pièce (l'étiquette sort normalement) ;
//   4. il copie l'impression dans un fichier « etiquette_capturee.spl » à côté de lui ;
//   5. il regarde s'il y voit un « CVC… » en clair, et il le dit ;
//   6. il remet l'imprimante comme avant.
//
// Il ne lit aucune base, n'envoie rien sur internet, ne tape rien dans Diakonos, ne garde aucun
// mot de passe. Il lit seulement l'impression de l'étiquette, sur ce PC.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

const dossierSpool = `C:\Windows\System32\spool\PRINTERS`

var reCVC = regexp.MustCompile(`CVC\d{6,}`)

func main() {
	// Sans fenêtre noire en plus : on cache les commandes Windows qu'on lance.
	fmt.Println("===========================================================")
	fmt.Println("  Détecteur d'étiquette Zebra — Sentinelle (Laisné)")
	fmt.Println("===========================================================")

	if !estAdministrateur() {
		fmt.Println("Ouverture en administrateur (répondez « Oui » à la fenêtre Windows)…")
		if err := relancerEnAdmin(); err != nil {
			attendreTouche("Impossible de passer en administrateur : " + err.Error())
		}
		return
	}

	imprimante, err := trouverZebra()
	if err != nil {
		attendreTouche("Imprimante Zebra introuvable : " + err.Error())
		return
	}
	fmt.Println("Imprimante trouvée :", imprimante)

	// On demande à l'imprimante de garder un instant ce qu'elle imprime.
	if err := garderImpressions(imprimante, true); err != nil {
		attendreTouche("Impossible de régler l'imprimante : " + err.Error())
		return
	}
	defer garderImpressions(imprimante, false) // remis comme avant en partant

	dejaLa := fichiersSpl()
	fmt.Println()
	fmt.Println(">>> Allez dans Diakonos et VALIDEZ UNE PIÈCE (scannez le code-barre).")
	fmt.Println(">>> L'étiquette sort normalement. J'attends…")
	fmt.Println()

	chemin := attendreNouvelleEtiquette(dejaLa, 3*time.Minute)
	if chemin == "" {
		attendreTouche("Aucune étiquette détectée (3 min). Réessayez en validant une pièce.")
		return
	}

	// On copie l'impression à côté du programme.
	ici, _ := os.Getwd()
	if exe, e := os.Executable(); e == nil {
		ici = filepath.Dir(exe)
	}
	cible := filepath.Join(ici, "etiquette_capturee.spl")
	donnees, err := lireAvecReessai(chemin)
	if err != nil {
		attendreTouche("Étiquette captée mais illisible : " + err.Error())
		return
	}
	if err := os.WriteFile(cible, donnees, 0o644); err != nil {
		attendreTouche("Impossible d'écrire le fichier : " + err.Error())
		return
	}

	fmt.Println("Étiquette captée :", len(donnees), "octets")
	fmt.Println("Copie enregistrée :", cible)
	fmt.Println()

	texte := texteLisible(donnees)
	cvc := reCVC.FindAllString(texte, -1)
	if len(cvc) > 0 {
		fmt.Println("✔ TRÈS BONNE NOUVELLE : le CVC est écrit en clair dans l'étiquette.")
		fmt.Println("   CVC trouvé(s) :", strings.Join(unique(cvc), ", "))
		fmt.Println("   => On pourra savoir qu'une pièce est faite sans toucher à la base.")
	} else {
		fmt.Println("✖ Pas de « CVC… » en texte dans cette impression.")
		fmt.Println("   L'étiquette est peut-être envoyée en image. On regardera l'autre")
		fmt.Println("   solution (lire le CVC sur l'écran de Diakonos).")
		fmt.Println()
		fmt.Println("   Début de ce qui est lisible dans l'impression :")
		apercu := texte
		if len(apercu) > 300 {
			apercu = apercu[:300]
		}
		fmt.Println("   " + strings.ReplaceAll(apercu, "\n", " "))
	}

	// Un petit résumé texte, pratique à m'envoyer avec le .spl.
	resume := fmt.Sprintf("Imprimante : %s\nÉtiquette : %d octets\nCVC en texte : %v\n%s\n",
		imprimante, len(donnees), len(cvc) > 0, strings.Join(unique(cvc), ", "))
	os.WriteFile(filepath.Join(ici, "etiquette_resume.txt"), []byte(resume), 0o644)

	fmt.Println()
	fmt.Println("Merci de m'envoyer le fichier : etiquette_capturee.spl")
	attendreTouche("")
}

// ---- Trouver l'imprimante Zebra ----

func trouverZebra() (string, error) {
	noms, err := listerImprimantes()
	if err != nil {
		return "", err
	}
	for _, n := range noms {
		b := strings.ToLower(n)
		if strings.Contains(b, "zebra") || strings.Contains(b, "zdesigner") || strings.Contains(b, "zpl") {
			return n, nil
		}
	}
	// Pas reconnue toute seule : on demande.
	if len(noms) == 0 {
		return "", fmt.Errorf("aucune imprimante installée")
	}
	fmt.Println("Je n'ai pas reconnu la Zebra toute seule. Imprimantes de ce PC :")
	for i, n := range noms {
		fmt.Printf("   %d) %s\n", i+1, n)
	}
	fmt.Print("Tapez le numéro de l'imprimante d'étiquettes, puis Entrée : ")
	var num int
	fmt.Scanln(&num)
	if num < 1 || num > len(noms) {
		return "", fmt.Errorf("numéro hors liste")
	}
	return noms[num-1], nil
}

func listerImprimantes() ([]string, error) {
	// PowerShell : la liste des noms d'imprimantes, une par ligne.
	sortie, err := powershell(`Get-Printer | Select-Object -ExpandProperty Name`)
	if err != nil {
		return nil, err
	}
	var noms []string
	for _, l := range strings.Split(sortie, "\n") {
		l = strings.TrimSpace(l)
		if l != "" {
			noms = append(noms, l)
		}
	}
	return noms, nil
}

func garderImpressions(imprimante string, garder bool) error {
	val := "$false"
	if garder {
		val = "$true"
	}
	_, err := powershell(fmt.Sprintf(`Set-Printer -Name %s -KeepPrintedJobs %s`, psChaine(imprimante), val))
	return err
}

// ---- Attendre l'étiquette dans la file d'impression ----

func fichiersSpl() map[string]bool {
	m := map[string]bool{}
	for _, f := range listerSpl() {
		m[f] = true
	}
	return m
}

func listerSpl() []string {
	e, err := os.ReadDir(dossierSpool)
	if err != nil {
		return nil
	}
	var res []string
	for _, f := range e {
		if strings.EqualFold(filepath.Ext(f.Name()), ".spl") {
			res = append(res, filepath.Join(dossierSpool, f.Name()))
		}
	}
	return res
}

func attendreNouvelleEtiquette(dejaLa map[string]bool, delai time.Duration) string {
	fin := time.Now().Add(delai)
	for time.Now().Before(fin) {
		for _, f := range listerSpl() {
			if !dejaLa[f] {
				return f
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	return ""
}

func lireAvecReessai(chemin string) ([]byte, error) {
	// Le fichier peut être encore en train d'être écrit : on laisse sa taille se stabiliser.
	var derniere int64 = -1
	for i := 0; i < 40; i++ {
		fi, err := os.Stat(chemin)
		if err == nil {
			if fi.Size() == derniere && fi.Size() > 0 {
				if b, e := os.ReadFile(chemin); e == nil {
					return b, nil
				}
			}
			derniere = fi.Size()
		}
		time.Sleep(100 * time.Millisecond)
	}
	return os.ReadFile(chemin)
}

// ---- Petits utilitaires ----

// Garde seulement les caractères lisibles (texte ZPL), le reste devient une espace.
func texteLisible(b []byte) string {
	var sb strings.Builder
	for _, c := range b {
		if c == '\n' || c == '\r' || (c >= 0x20 && c <= 0x7e) {
			sb.WriteByte(c)
		} else {
			sb.WriteByte(' ')
		}
	}
	return sb.String()
}

func unique(in []string) []string {
	vus := map[string]bool{}
	var out []string
	for _, s := range in {
		if !vus[s] {
			vus[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func powershell(commande string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", commande)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	sortie, err := cmd.CombinedOutput()
	return string(sortie), err
}

// Une chaîne entre apostrophes pour PowerShell (les apostrophes internes doublées).
func psChaine(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func estAdministrateur() bool {
	// « net session » ne marche qu'en administrateur.
	cmd := exec.Command("net", "session")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run() == nil
}

func relancerEnAdmin() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// Start-Process -Verb RunAs : la fenêtre Windows qui demande « Oui » (administrateur).
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		fmt.Sprintf("Start-Process -Verb RunAs -FilePath %s", psChaine(exe)))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func attendreTouche(message string) {
	if message != "" {
		fmt.Println()
		fmt.Println(message)
	}
	fmt.Println()
	fmt.Print("Appuyez sur Entrée pour fermer cette fenêtre… ")
	fmt.Scanln()
}
