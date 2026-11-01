//go:build windows

package main

import (
	"os/exec"
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
