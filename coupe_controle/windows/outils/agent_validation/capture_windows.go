//go:build windows

// La partie Windows de l'agent : surveiller l'imprimante Zebra en continu et envoyer chaque étiquette.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const dossierSpool = `C:\Windows\System32\spool\PRINTERS`

func powershell(commande string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", commande)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	b, err := cmd.CombinedOutput()
	return string(b), err
}

func psChaine(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// Trouve l'imprimante Zebra (nom contenant zebra / zdesigner / zpl).
func trouverZebra() (string, error) {
	out, err := powershell(`Get-Printer | Select-Object -ExpandProperty Name`)
	if err != nil {
		return "", err
	}
	for _, l := range strings.Split(out, "\n") {
		n := strings.TrimSpace(l)
		b := strings.ToLower(n)
		if n != "" && (strings.Contains(b, "zebra") || strings.Contains(b, "zdesigner") || strings.Contains(b, "zpl") || strings.Contains(b, "gk420")) {
			return n, nil
		}
	}
	return "", fmt.Errorf("imprimante Zebra introuvable")
}

// Demande à l'imprimante de garder un instant ce qu'elle imprime (pour pouvoir le lire). Besoin d'administrateur.
func reglerImprimante(garder bool) {
	imp, err := trouverZebra()
	if err != nil {
		return
	}
	val := "$false"
	if garder {
		val = "$true"
	}
	powershell(fmt.Sprintf("Set-Printer -Name %s -KeepPrintedJobs %s", psChaine(imp), val))
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

// --- File d'attente locale (gardée à côté du programme, pour survivre à un redémarrage) ---

type fileLocale struct {
	Compteur int                 `json:"compteur"`
	Pending  []demandeValidation `json:"pending"`
}

func cheminFile() string {
	ici, _ := os.Getwd()
	if exe, err := os.Executable(); err == nil {
		ici = filepath.Dir(exe)
	}
	return filepath.Join(ici, "agent_pending.json")
}

func lireFile() *fileLocale {
	f := &fileLocale{}
	if b, err := os.ReadFile(cheminFile()); err == nil {
		json.Unmarshal(b, f)
	}
	return f
}

func ecrireFile(f *fileLocale) {
	if b, err := json.MarshalIndent(f, "", "  "); err == nil {
		os.WriteFile(cheminFile(), b, 0o600)
	}
}

// La boucle : surveille l'imprimante, envoie chaque étiquette, retire celles que Sentinelle a prises.
func lancerAgent(code, poste string) error {
	if imp, err := trouverZebra(); err == nil {
		fmt.Println("Imprimante surveillée :", imp)
	} else {
		fmt.Println("⚠ Imprimante Zebra introuvable pour l'instant :", err)
	}
	fmt.Println("Validez une pièce : l'étiquette qui sort sera envoyée à Sentinelle. (Ctrl+C pour arrêter.)")
	reglerImprimante(true)
	defer reglerImprimante(false)

	file := lireFile()
	vus := map[string]bool{}
	for _, f := range listerSpl() {
		vus[f] = true // on ignore ce qui est déjà là au démarrage
	}
	dernierEnvoi := time.Time{}
	dernierAccuses := time.Time{}

	for {
		changed := false
		for _, chemin := range listerSpl() {
			if vus[chemin] {
				continue
			}
			vus[chemin] = true
			octets, err := lireStable(chemin)
			if err != nil || len(octets) == 0 {
				continue
			}
			file.Compteur++
			file.Pending = append(file.Pending, demandeValidation{
				ID:        fmt.Sprintf("%s-%d-%d", poste, time.Now().Unix(), file.Compteur),
				Jour:      time.Now().Format("2006-01-02"),
				Etiquette: etiquetteBase64(octets),
			})
			os.Remove(chemin) // on nettoie le fichier gardé (il a déjà été imprimé)
			changed = true
			fmt.Println("  étiquette captée →", file.Compteur)
		}
		if changed {
			ecrireFile(file)
		}

		// Envoi (dès qu'il y a du nouveau, ou toutes les ~10 s s'il reste du monde en attente).
		if len(file.Pending) > 0 && (changed || time.Since(dernierEnvoi) > 10*time.Second) {
			if err := envoyerValidations(code, poste, file.Pending); err != nil {
				fmt.Println("  ⚠ envoi raté (nouvel essai plus tard) :", err)
			} else {
				dernierEnvoi = time.Now()
				fmt.Printf("  → envoyé à Sentinelle (%d en attente d'accusé)\n", len(file.Pending))
			}
		}
		// Accusés de Sentinelle : on retire ce qui est déjà pris en compte.
		if time.Since(dernierAccuses) > 25*time.Second {
			dernierAccuses = time.Now()
			if pris, err := lireAccuses(code); err == nil && len(pris) > 0 {
				reste := file.Pending[:0]
				for _, d := range file.Pending {
					if !pris[d.ID] {
						reste = append(reste, d)
					}
				}
				if len(reste) != len(file.Pending) {
					file.Pending = reste
					ecrireFile(file)
				}
			}
		}
		time.Sleep(2 * time.Second)
	}
}

// Lit un fichier une fois sa taille stabilisée (il peut être encore en cours d'écriture).
func lireStable(chemin string) ([]byte, error) {
	var derniere int64 = -1
	for i := 0; i < 30; i++ {
		fi, err := os.Stat(chemin)
		if err == nil {
			if fi.Size() == derniere && fi.Size() > 0 {
				return os.ReadFile(chemin)
			}
			derniere = fi.Size()
		}
		time.Sleep(100 * time.Millisecond)
	}
	return os.ReadFile(chemin)
}

// Réglages Windows en plus au moment du setup : démarrage automatique (tâche planifiée, au logon, en
// administrateur) et garde des impressions activée.
func setupWindows(poste string) {
	reglerImprimante(true)
	exe, err := os.Executable()
	if err != nil {
		return
	}
	// Une tâche planifiée qui lance l'agent à chaque ouverture de session, avec les droits les plus élevés
	// (plus de fenêtre « Oui » à chaque démarrage).
	cmd := fmt.Sprintf(`$a = New-ScheduledTaskAction -Execute %s -Argument 'run'; `+
		`$t = New-ScheduledTaskTrigger -AtLogOn; `+
		`$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest; `+
		`$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; `+
		`Register-ScheduledTask -TaskName 'SentinelleValidation' -Action $a -Trigger $t -Principal $p -Settings $s -Force`,
		psChaine(exe))
	if _, err := powershell(cmd); err != nil {
		fmt.Println("(démarrage automatique non réglé :", err, ")")
	} else {
		fmt.Println("Démarrage automatique réglé (tâche « SentinelleValidation », à l'ouverture de session).")
	}
}

// Garde la fenêtre ouverte jusqu'à une touche (fiable même quand l'entrée clavier n'est pas branchée).
func pauseConsole() {
	fmt.Println()
	c := exec.Command("cmd", "/c", "pause")
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if c.Run() != nil {
		time.Sleep(60 * time.Second) // à défaut, on laisse 1 minute pour lire
	}
}
