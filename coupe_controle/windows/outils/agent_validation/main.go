// Agent de validation Sentinelle (Laisné) : sur chaque PC de validation, il surveille l'imprimante Zebra, et
// à chaque étiquette qui sort (= pièce faite) il l'envoie, chiffrée, au mini-site. Sentinelle la reçoit, lit le
// CVC et marque la pièce faite. Il ne lit aucune base, n'envoie rien d'autre, ne garde aucun mot de passe.
//
//   agent setup                     : entrer le code de liaison et le numéro de poste (une fois)
//   agent run                       : tourne en fond, surveille l'imprimante (démarré tout seul avec Windows)
//   agent test-envoyer CODE POSTE f : (essai) envoie les étiquettes f… au mini-site
//   agent test-relire  CODE POSTE   : (essai) relit ce qui a été déposé
package main

import (
	"fmt"
	"os"
	"time"
)

func main() {
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "test-envoyer":
		if len(args) < 4 {
			fmt.Println("usage : agent test-envoyer CODE POSTE etiquette.spl…")
			os.Exit(2)
		}
		code, poste := args[1], args[2]
		var demandes []demandeValidation
		for i, f := range args[3:] {
			octets, err := os.ReadFile(f)
			if err != nil {
				fmt.Println("lecture", f, ":", err)
				os.Exit(1)
			}
			demandes = append(demandes, demandeValidation{ID: fmt.Sprintf("%s-%d", poste, i+1), Jour: time.Now().Format("2006-01-02"), Etiquette: etiquetteBase64(octets)})
		}
		if err := envoyerValidations(code, poste, demandes); err != nil {
			fmt.Println("envoi :", err)
			os.Exit(1)
		}
		fmt.Printf("OK : %d étiquette(s) déposée(s) sur le canal du poste %s\n", len(demandes), poste)
	case "test-relire":
		if len(args) < 3 {
			fmt.Println("usage : agent test-relire CODE POSTE")
			os.Exit(2)
		}
		lot, err := relireValidations(args[1], args[2])
		if err != nil {
			fmt.Println("relecture :", err)
			os.Exit(1)
		}
		if lot == nil {
			fmt.Println("rien déposé sur ce canal")
			return
		}
		fmt.Println("relu :", afficherLot(lot))
	case "test-paquet":
		if len(args) < 4 {
			fmt.Println("usage : agent test-paquet CODE POSTE sortie.bin")
			os.Exit(2)
		}
		canal, _ := canalDe(args[1], args[2])
		fmt.Println("canal:", canal)
		p, err := paquetBrut(args[1], args[2])
		if err != nil || p == nil {
			fmt.Println("rien / erreur :", err)
			os.Exit(1)
		}
		if err := os.WriteFile(args[3], p, 0o644); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		fmt.Println("paquet écrit :", len(p), "octets")
	case "run":
		code, poste := reglagesAgent()
		if code == "" {
			fmt.Println("Pas encore réglé. Lancez d'abord : agent setup")
			os.Exit(1)
		}
		if err := lancerAgent(code, poste); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
	case "setup":
		faireSetup()
		fmt.Println()
		fmt.Println("Je lance la surveillance maintenant (laissez cette fenêtre ouverte).")
		code, poste := reglagesAgent()
		if code != "" {
			lancerAgent(code, poste)
		}
		attendreEntree()
	default:
		// Double-clic : si déjà réglé, on surveille ; sinon on fait le réglage puis on surveille.
		code, poste := reglagesAgent()
		if code == "" {
			faireSetup()
			code, poste = reglagesAgent()
		}
		if code == "" {
			attendreEntree()
			return
		}
		fmt.Println("Agent de validation Sentinelle — poste", poste, ": surveillance en cours. Laissez cette fenêtre ouverte.")
		if err := lancerAgent(code, poste); err != nil {
			fmt.Println(err)
		}
		attendreEntree()
	}
}

func attendreEntree() {
	fmt.Print("\nAppuyez sur Entrée pour fermer… ")
	fmt.Scanln()
}
