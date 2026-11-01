//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

// Hors Windows (essais seulement) : le message va dans le terminal.
func message(titre, texte string) {
	fmt.Fprintf(os.Stderr, "%s : %s\n", titre, texte)
}

func ouvrirParDefaut(url string) error {
	return exec.Command("xdg-open", url).Start()
}
