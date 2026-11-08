// Réglages de l'agent (gardés à côté du programme) : le code de liaison (le même que le téléphone), le
// numéro de poste (1, 2…) et son nom (ex. « Crédences », « Plan de travail »). Entrés une fois.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type reglages struct {
	Code  string `json:"code"`
	Poste string `json:"poste"`
	Nom   string `json:"nom"`
}

func cheminReglages() string {
	ici, _ := os.Getwd()
	if exe, err := os.Executable(); err == nil {
		ici = filepath.Dir(exe)
	}
	return filepath.Join(ici, "agent_validation.json")
}

func reglagesAgent() (string, string, string) {
	b, err := os.ReadFile(cheminReglages())
	if err != nil {
		return "", "", ""
	}
	var r reglages
	if json.Unmarshal(b, &r) != nil {
		return "", "", ""
	}
	return r.Code, r.Poste, r.Nom
}

func faireSetup() {
	fmt.Println("=== Réglage de l'agent de validation Sentinelle ===")
	fmt.Println("Entrez le MÊME code de liaison que pour le téléphone (celui que Sentinelle affiche).")
	in := bufio.NewReader(os.Stdin)
	fmt.Print("Code de liaison : ")
	code, _ := in.ReadString('\n')
	code = strings.TrimSpace(code)
	if normaliserCode(code) == "" {
		fmt.Println("Code vide, rien d'enregistré.")
		return
	}
	fmt.Print("Numéro de ce poste (1 ou 2 — juste pour distinguer les 2 PC) : ")
	poste, _ := in.ReadString('\n')
	poste = strings.TrimSpace(poste)
	if poste == "" {
		poste = "1"
	}
	fmt.Print("Nom de ce poste (ex. Crédences, Plan de travail) : ")
	nom, _ := in.ReadString('\n')
	nom = strings.TrimSpace(nom)
	if nom == "" {
		nom = "Poste " + poste
	}
	r := reglages{Code: code, Poste: poste, Nom: nom}
	b, _ := json.MarshalIndent(r, "", "  ")
	if err := os.WriteFile(cheminReglages(), b, 0o600); err != nil {
		fmt.Println("Impossible d'enregistrer :", err)
		return
	}
	setupWindows(poste)
	fmt.Println("Enregistré. Ce poste s'appelle «", nom, "» (numéro", poste+").")
}
