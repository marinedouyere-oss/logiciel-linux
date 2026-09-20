@echo off
REM Double-cliquez ce fichier pour lancer Sentinelle avec le PWA actif
REM (installation, icone, mode hors-ligne natif, accessible aussi depuis
REM un telephone sur le meme Wi-Fi). Le navigateur s'ouvre automatiquement
REM sur http://localhost:8080
REM
REM Pour l'acces reseau local (telephone), les droits administrateur sont
REM necessaires : si une fenetre "Acces refuse" apparait, refermez et
REM refaites un clic droit sur ce fichier -> "Executer en tant
REM qu'administrateur".
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%serveur.ps1"
pause
