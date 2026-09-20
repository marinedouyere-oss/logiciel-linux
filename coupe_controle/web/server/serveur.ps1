# Petit serveur HTTP local pour Sentinelle, sans rien à installer :
# PowerShell est déjà présent sur Windows. Sert le dossier parent
# (coupe_controle/web/) sur http://localhost ET sur le réseau local (pour
# un téléphone sur le même Wi-Fi), ce qui est nécessaire pour que le PWA
# (installation, service worker, mode hors-ligne) fonctionne — les
# navigateurs bloquent ça sur un fichier ouvert en file://.
#
# Écouter sur le réseau local (pas juste "localhost") demande les droits
# administrateur sous Windows : si ce script échoue avec une erreur
# "Accès refusé", relancez lancer_sentinelle.bat en clic droit →
# "Exécuter en tant qu'administrateur" (une fois suffit généralement pour
# la session en cours).

$Port = 8080
$Racine = Split-Path -Parent $PSScriptRoot

$mimeTypes = @{
    ".html"        = "text/html; charset=utf-8"
    ".js"          = "application/javascript; charset=utf-8"
    ".json"        = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".png"         = "image/png"
    ".svg"         = "image/svg+xml"
    ".ico"         = "image/x-icon"
    ".xlsx"        = "application/octet-stream"
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://+:$Port/"

try {
    $listener.Prefixes.Add($prefix)
    $listener.Start()
} catch {
    Write-Host "Impossible d'ouvrir Sentinelle au réseau local (http://+:$Port/)."
    Write-Host "Cause probable : droits administrateur manquants."
    Write-Host ""
    Write-Host "-> Fermez cette fenêtre, puis clic droit sur lancer_sentinelle.bat"
    Write-Host "   et choisissez « Exécuter en tant qu'administrateur »."
    Write-Host ""
    Write-Host "Détail technique : $($_.Exception.Message)"
    Read-Host "Appuyez sur Entrée pour fermer"
    exit 1
}

$urlLocale = "http://localhost:$Port/"

$adressesLAN = @()
try {
    $adressesLAN = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        Select-Object -ExpandProperty IPAddress
} catch {
    # Get-NetIPAddress indisponible (ancien Windows) : on continue sans la liste réseau.
}

Write-Host "Sentinelle est servi :"
Write-Host "  - Sur ce PC          : $urlLocale"
foreach ($ip in $adressesLAN) {
    Write-Host "  - Réseau local (Wi-Fi) : http://${ip}:$Port/  <- à taper sur le téléphone (même Wi-Fi)"
}
Write-Host ""
Write-Host "Sur le téléphone : ouvrez cette adresse réseau local dans Chrome, puis"
Write-Host "menu (⋮) -> « Installer l'application » ou « Ajouter à l'écran d'accueil »."
Write-Host "Une fois installée, l'appli fonctionne ensuite sans Wi-Fi ni PC."
Write-Host ""
Write-Host "Laissez cette fenêtre ouverte pendant l'utilisation depuis ce PC."
Write-Host "Pour arrêter : fermez cette fenêtre ou appuyez sur Ctrl+C."
Write-Host ""

Start-Process $urlLocale

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $chemin = $request.Url.LocalPath
        if ($chemin -eq "/") { $chemin = "/index.html" }
        $cheminFichier = Join-Path $Racine ($chemin.TrimStart("/") -replace "/", [IO.Path]::DirectorySeparatorChar)

        # Sécurité : interdit de sortir du dossier racine via "..".
        $cheminComplet = [IO.Path]::GetFullPath($cheminFichier)
        if (-not $cheminComplet.StartsWith([IO.Path]::GetFullPath($Racine))) {
            $response.StatusCode = 403
            $response.OutputStream.Close()
            continue
        }

        if (Test-Path $cheminComplet -PathType Leaf) {
            $extension = [IO.Path]::GetExtension($cheminComplet).ToLower()
            $typeContenu = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
            $octets = [IO.File]::ReadAllBytes($cheminComplet)
            $response.ContentType = $typeContenu
            $response.ContentLength64 = $octets.Length
            $response.OutputStream.Write($octets, 0, $octets.Length)
        } else {
            $response.StatusCode = 404
            $texte = [Text.Encoding]::UTF8.GetBytes("404 - Fichier introuvable : $chemin")
            $response.OutputStream.Write($texte, 0, $texte.Length)
        }
        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
