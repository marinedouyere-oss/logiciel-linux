//go:build windows

package main

import (
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

// Fenêtre de message Windows (le .exe n'a pas de console).
func message(titre, texte string) {
	t, _ := syscall.UTF16PtrFromString(titre)
	m, _ := syscall.UTF16PtrFromString(texte)
	const mbIconInformation = 0x40
	messageBoxW.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconInformation)
}

func ouvrirParDefaut(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// Chemin de chrome.exe déclaré à Windows (installation hors des dossiers habituels) ; "" s'il n'y en a pas.
func cheminChromeRegistre() string {
	for _, cle := range []string{
		`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`,
		`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`,
		`HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`,
	} {
		cmd := exec.Command("reg", "query", cle, "/ve")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		sortie, err := cmd.Output()
		if err != nil {
			continue
		}
		m := regexp.MustCompile(`REG_(?:EXPAND_)?SZ\s+(.+)`).FindStringSubmatch(string(sortie))
		if m == nil {
			continue
		}
		chemin := strings.Trim(strings.TrimSpace(os.ExpandEnv(strings.ReplaceAll(m[1], "%", "$"))), `"`)
		if _, err := os.Stat(chemin); err == nil {
			return chemin
		}
	}
	return ""
}
