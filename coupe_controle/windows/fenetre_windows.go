//go:build windows

package main

import (
	"os"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// Sentinelle dans la barre des tâches : la fenêtre Chrome (ou Edge) ouverte par le .exe prend l'icône Laisné et sa
// propre identité (« LaisneIndustrie.Sentinelle »), pas celles d'Edge. Épinglée, elle relance ce .exe
// avec l'icône Laisné. Edge peut remettre son icône : elle est reposée toutes les 2 secondes si besoin.

// « LaisneIndustrie.Sentinelle », « LaisneIndustrie.Claustra ».
func idApplication() string { return "LaisneIndustrie." + nomLogiciel }

var (
	kernel32                    = syscall.NewLazyDLL("kernel32.dll")
	shell32                     = syscall.NewLazyDLL("shell32.dll")
	ole32                       = syscall.NewLazyDLL("ole32.dll")
	enumWindows                 = user32.NewProc("EnumWindows")
	getClassNameW               = user32.NewProc("GetClassNameW")
	getWindowTextW              = user32.NewProc("GetWindowTextW")
	isWindowVisible             = user32.NewProc("IsWindowVisible")
	sendMessageTimeoutW         = user32.NewProc("SendMessageTimeoutW")
	loadImageW                  = user32.NewProc("LoadImageW")
	getSystemMetrics            = user32.NewProc("GetSystemMetrics")
	getModuleHandleW            = kernel32.NewProc("GetModuleHandleW")
	shGetPropertyStoreForWindow = shell32.NewProc("SHGetPropertyStoreForWindow")
	coInitializeEx              = ole32.NewProc("CoInitializeEx")
)

type guid struct {
	a    uint32
	b, c uint16
	d    [8]byte
}

type cleProp struct {
	fmtid guid
	pid   uint32
}

// PROPVARIANT (24 octets en 64 bits) ; ici seulement une chaîne (VT_LPWSTR).
type propVariant struct {
	vt         uint16
	r1, r2, r3 uint16
	val        uintptr
	r4         uintptr
}

// Objet COM : pointeur vers sa table de méthodes (IPropertyStore : 8 méthodes).
type objetCom struct{ methodes *[8]uintptr }

var (
	iidIPropertyStore = guid{0x886d8eeb, 0x8cf2, 0x4446, [8]byte{0x8d, 0x02, 0xcd, 0xba, 0x1d, 0xbd, 0xcf, 0x99}}
	fmtidAppUserModel = guid{0x9f4c2855, 0x9f79, 0x4b39, [8]byte{0xa8, 0xd0, 0xe1, 0xd4, 0x2d, 0xe1, 0xd5, 0xf3}}
)

const (
	wmGetIcon       = 0x007f
	wmSetIcon       = 0x0080
	iconPetite      = 0
	iconGrande      = 1
	smtoAbortIfHung = 0x0002
	vtLpwstr        = 31
)

// Fenêtres de Sentinelle : fenêtres Edge / Chrome visibles dont le titre est celui de la page
// (« Sentinelle V6.0.7 — Contrôle de coupe »), pas une fenêtre Edge ordinaire (« … - Microsoft Edge »).
var fenetresTrouvees []uintptr

var rappelFenetre = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
	if visible, _, _ := isWindowVisible.Call(hwnd); visible == 0 {
		return 1
	}
	var classe [64]uint16
	getClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&classe[0])), uintptr(len(classe)))
	if syscall.UTF16ToString(classe[:]) != "Chrome_WidgetWin_1" {
		return 1
	}
	var titre [256]uint16
	getWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&titre[0])), uintptr(len(titre)))
	t := syscall.UTF16ToString(titre[:])
	if strings.HasPrefix(t, nomLogiciel+" V") && !strings.Contains(t, "Edge") && !strings.Contains(t, "Chrome") {
		fenetresTrouvees = append(fenetresTrouvees, hwnd)
	}
	return 1
})

func envoyer(hwnd, msg, w, l uintptr) uintptr {
	var resultat uintptr
	sendMessageTimeoutW.Call(hwnd, msg, w, l, smtoAbortIfHung, 500, uintptr(unsafe.Pointer(&resultat)))
	return resultat
}

// Icônes du .exe (groupe d'icônes n° 1) aux tailles de Windows.
func iconesExe() (grande, petite uintptr) {
	module, _, _ := getModuleHandleW.Call(0)
	cx, _, _ := getSystemMetrics.Call(11) // SM_CXICON
	cy, _, _ := getSystemMetrics.Call(12)
	sx, _, _ := getSystemMetrics.Call(49) // SM_CXSMICON
	sy, _, _ := getSystemMetrics.Call(50)
	grande, _, _ = loadImageW.Call(module, 1, 1, cx, cy, 0)
	petite, _, _ = loadImageW.Call(module, 1, 1, sx, sy, 0)
	return grande, petite
}

// Identité de la fenêtre dans la barre des tâches : relance (ce .exe), nom, icône, puis l'identifiant.
func identiteFenetre(hwnd uintptr, exe string) bool {
	var store *objetCom
	if hr, _, _ := shGetPropertyStoreForWindow.Call(hwnd, uintptr(unsafe.Pointer(&iidIPropertyStore)), uintptr(unsafe.Pointer(&store))); hr != 0 || store == nil {
		return false
	}
	m := store.methodes
	defer syscall.SyscallN(m[2], uintptr(unsafe.Pointer(store))) // Release
	ok := true
	for _, p := range []struct {
		pid    uint32
		valeur string
	}{
		{2, `"` + exe + `"`}, // RelaunchCommand
		{4, nomLogiciel},     // RelaunchDisplayNameResource
		{3, exe + ",0"},      // RelaunchIconResource
		{5, idApplication()}, // ID
	} {
		s, err := syscall.UTF16PtrFromString(p.valeur)
		if err != nil {
			return false
		}
		v := propVariant{vt: vtLpwstr, val: uintptr(unsafe.Pointer(s))}
		k := cleProp{fmtidAppUserModel, p.pid}
		hr, _, _ := syscall.SyscallN(m[6], uintptr(unsafe.Pointer(store)), uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&v))) // SetValue
		runtime.KeepAlive(s)
		if hr != 0 {
			ok = false
		}
	}
	hr, _, _ := syscall.SyscallN(m[7], uintptr(unsafe.Pointer(store))) // Commit
	return ok && hr == 0
}

// Tant que Sentinelle tourne : chaque fenêtre de Sentinelle reçoit son identité (une fois) et l'icône Laisné.
func habillerFenetres() {
	runtime.LockOSThread()
	coInitializeEx.Call(0, 2) // COINIT_APARTMENTTHREADED
	exe, err := os.Executable()
	if err != nil {
		return
	}
	grande, petite := iconesExe()
	faites := map[uintptr]bool{}
	for {
		fenetresTrouvees = fenetresTrouvees[:0]
		enumWindows.Call(rappelFenetre, 0)
		for _, h := range fenetresTrouvees {
			if !faites[h] && identiteFenetre(h, exe) {
				faites[h] = true
			}
			if grande != 0 && envoyer(h, wmGetIcon, iconGrande, 0) != grande {
				envoyer(h, wmSetIcon, iconGrande, grande)
			}
			if petite != 0 && envoyer(h, wmGetIcon, iconPetite, 0) != petite {
				envoyer(h, wmSetIcon, iconPetite, petite)
			}
		}
		select {
		case <-arret:
			return
		case <-time.After(2 * time.Second):
		}
	}
}
