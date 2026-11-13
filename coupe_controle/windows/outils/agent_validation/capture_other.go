//go:build !windows

package main

import "fmt"

// Sur un autre système que Windows : l'agent ne tourne pas (seuls les tests marchent).
func lancerAgent(code, poste, nom string) error {
	return fmt.Errorf("l'agent de validation ne tourne que sous Windows")
}

func reglerImprimante(garder bool) {}
func setupWindows(poste string)    {}

func pauseConsole() {}
