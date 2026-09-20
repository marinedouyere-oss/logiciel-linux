# Petit serveur HTTP local pour Sentinelle, sans rien à installer :
# PowerShell est déjà présent sur Windows. Sert le dossier parent
# (coupe_controle/web/) sur http://localhost, ce qui est nécessaire pour
# que le PWA (installation, service worker, mode hors-ligne) fonctionne —
# les navigateurs bloquent ça sur un fichier ouvert en file://.
#
# N'écoute QUE sur cette machine (localhost) : aucune autre machine ni
# appareil (téléphone y compris) ne peut s'y connecter, par choix — pas
# de connexion ni de synchronisation entre appareils. Pour utiliser
# Sentinelle sur un téléphone, copiez le fichier index.html dessus
# séparément (USB, e-mail...) et ouvrez-le directement dans Chrome.

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
$prefix = "http://localhost:$Port/"

try {
    $listener.Prefixes.Add($prefix)
    $listener.Start()
} catch {
    Write-Host "Impossible de démarrer le serveur sur $prefix"
    Write-Host "Le port $Port est peut-être déjà utilisé par un autre programme."
    Write-Host $_.Exception.Message
    Read-Host "Appuyez sur Entrée pour fermer"
    exit 1
}

Write-Host "Sentinelle est servi sur $prefix (accessible uniquement depuis ce PC)."
Write-Host "Laissez cette fenêtre ouverte pendant l'utilisation."
Write-Host "Pour arrêter : fermez cette fenêtre ou appuyez sur Ctrl+C."
Write-Host ""

Start-Process $prefix

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
