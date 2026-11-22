@echo off
title Hotel Manager Pro
cd /d "%~dp0"
echo ============================================================
echo   Hotel Manager Pro
echo   Ne fermez pas cette fenetre tant que l'hotel travaille.
echo   Pour arreter le logiciel : Ctrl + C
echo ============================================================
echo.
call pnpm local:start --lan
echo.
echo Le logiciel est arrete. Appuyez sur une touche pour fermer cette fenetre.
pause >nul
