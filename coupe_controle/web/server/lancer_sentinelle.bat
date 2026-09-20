@echo off
REM Double-cliquez ce fichier pour lancer Sentinelle avec le PWA actif
REM (installation, icone, mode hors-ligne natif). Le navigateur s'ouvre
REM automatiquement sur http://localhost:8080
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%serveur.ps1"
pause
