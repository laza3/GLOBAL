@echo off
title Hotel Manager Pro - Sauvegarde
cd /d "%~dp0"
set "DEST="
if exist "copie-supplementaire.txt" set /p DEST=<"copie-supplementaire.txt"
if /i "%~1"=="auto" goto run
if defined DEST goto run
echo Copie de securite des donnees de l'hotel.
echo.
echo Pour une COPIE SUPPLEMENTAIRE sur une cle USB ou un disque externe,
echo tapez son dossier (exemple : E:\Sauvegardes-Hotel)
set /p DEST=ou appuyez sur Entree pour ignorer : 
:run
if defined DEST if "%DEST:~-1%"=="\" set "DEST=%DEST:~0,-1%"
if defined DEST goto avec
call pnpm local:backup
goto fin
:avec
call pnpm local:backup --vers "%DEST%"
:fin
if /i "%~1"=="auto" exit /b 0
echo.
echo Appuyez sur une touche pour fermer cette fenetre.
pause >nul
