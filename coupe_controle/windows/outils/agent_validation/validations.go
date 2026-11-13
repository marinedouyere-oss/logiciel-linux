// Le lot d'étiquettes validées envoyé à Sentinelle, et son dépôt sur le mini-site.
// Format (déchiffré) : { format:"sentinelle-validations-1", pc, demandes:[ { id, jour, etiquette(base64 du ZPL) } ] }
// compressé (gzip) puis chiffré « SNT1 ». Chaque PC a son canal (code + numéro de poste), comme le téléphone.
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

const butValidations = "sentinelle-validations"

type demandeValidation struct {
	ID        string `json:"id"`
	Jour      string `json:"jour"`
	Etiquette string `json:"etiquette"` // base64 du ZPL de l'étiquette
}

type lotValidations struct {
	Format   string              `json:"format"`
	PC       string              `json:"pc"`
	Nom      string              `json:"nom"`
	Demandes []demandeValidation `json:"demandes"`
}

// Dépose un lot d'étiquettes validées sur le canal du poste (code + numéro de poste).
func envoyerValidations(code, poste, nom string, demandes []demandeValidation) error {
	s, err := secrets(code, butValidations+":"+poste)
	if err != nil {
		return err
	}
	lot := lotValidations{Format: "sentinelle-validations-1", PC: poste, Nom: nom, Demandes: demandes}
	clair, err := json.Marshal(lot)
	if err != nil {
		return err
	}
	paquet, err := s.chiffrer(gziper(clair))
	if err != nil {
		return err
	}
	return deposer(s, paquet)
}

// Lit les accusés de réception de Sentinelle (fichier partagé) : les id déjà pris en compte.
// Renvoie l'ensemble des id traités pour ce poste (pour ne plus les renvoyer).
func lireAccuses(code string) (map[string]bool, error) {
	s, err := secrets(code, "sentinelle-canal") // le fichier partagé (écrit par le PC Sentinelle)
	if err != nil {
		return nil, err
	}
	paquet, err := telecharger(s)
	if err != nil || paquet == nil {
		return map[string]bool{}, err
	}
	clair, err := s.dechiffrer(paquet)
	if err != nil {
		return map[string]bool{}, nil // pas le même code ou format : on ignore
	}
	clair = degziperSiBesoin(clair)
	var fichier struct {
		Validations struct {
			Traitees map[string]interface{} `json:"traitees"`
		} `json:"retourValidations"`
	}
	if err := json.Unmarshal(clair, &fichier); err != nil {
		return map[string]bool{}, nil
	}
	res := map[string]bool{}
	for id := range fichier.Validations.Traitees {
		res[id] = true
	}
	return res, nil
}

// Pour vérifier un aller-retour : relit ce qu'on a déposé et le déchiffre.
func relireValidations(code, poste string) (*lotValidations, error) {
	s, err := secrets(code, butValidations+":"+poste)
	if err != nil {
		return nil, err
	}
	paquet, err := telecharger(s)
	if err != nil || paquet == nil {
		return nil, err
	}
	clair, err := s.dechiffrer(paquet)
	if err != nil {
		return nil, err
	}
	var lot lotValidations
	if err := json.Unmarshal(degziperSiBesoin(clair), &lot); err != nil {
		return nil, err
	}
	return &lot, nil
}

func etiquetteBase64(octets []byte) string {
	return base64.StdEncoding.EncodeToString(octets)
}

func afficherLot(lot *lotValidations) string {
	return fmt.Sprintf("poste %s : %d étiquette(s)", lot.PC, len(lot.Demandes))
}

// Pour les tests : le canal d'un poste, et le paquet brut déposé (à déchiffrer côté page).
func canalDe(code, poste string) (string, error) {
	s, err := secrets(code, butValidations+":"+poste)
	if err != nil {
		return "", err
	}
	return s.canal, nil
}

func paquetBrut(code, poste string) ([]byte, error) {
	s, err := secrets(code, butValidations+":"+poste)
	if err != nil {
		return nil, err
	}
	return telecharger(s)
}
