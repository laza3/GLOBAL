; Installateur Windows de Hotel Manager Pro (version locale) — construit par scripts/build-windows-installer.mjs
; Définitions passées par le script : VERSION, PAYLOAD (dossier du paquet), OUTFILE (.exe produit), ASSETS (dossier installer/)
Unicode true

!define APPNAME "Hotel Manager Pro"
!define COMPANY "SaaS Lab Madagascar"
!define PORT "5173"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelManagerPro"
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef PAYLOAD
  !error "PAYLOAD (dossier du paquet) est requis : /DPAYLOAD=..."
!endif
!ifndef OUTFILE
  !define OUTFILE "HotelManagerPro-Setup.exe"
!endif
!ifndef ASSETS
  !define ASSETS "."
!endif

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "C:\HotelManagerPro"
InstallDirRegKey HKLM "Software\HotelManagerPro" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${COMPANY}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1036 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de ${APPNAME}"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "${COMPANY}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${ASSETS}\icone.ico"
!define MUI_UNICON "${ASSETS}\icone.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ASSETS}\accueil.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ASSETS}\accueil.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Cet assistant installe ${APPNAME} sur cet ordinateur : le logiciel, sa base de données et tout ce qu'il faut pour travailler dans l'hôtel, sans Internet.$\r$\n$\r$\nLes données de l'hôtel resteront sur cet ordinateur, dans le dossier « donnees » : une mise à jour ou une désinstallation ne les supprime jamais.$\r$\n$\r$\nCliquez sur Suivant pour continuer."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Lancer ${APPNAME} maintenant"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

; Le programme se lance avec les droits de l'utilisateur (et non ceux de l'installateur) : PostgreSQL et les données lui appartiennent.
Function LaunchApp
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\Lancer.cmd"'
FunctionEnd

Section "Installation" SecMain
  SetOverwrite on
  SetShellVarContext all

  ; Mise à jour : on arrête l'ancienne version, puis on remplace le programme (JAMAIS « donnees » ni « sauvegardes »)
  ${If} ${FileExists} "$INSTDIR\runtime\node.exe"
    DetailPrint "Arrêt de la version en cours…"
    nsExec::Exec '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\launcher.mjs" stop'
    Pop $0
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\runtime"
  ${EndIf}

  SetOutPath "$INSTDIR"
  DetailPrint "Copie des fichiers (quelques minutes)…"
  File /r "${PAYLOAD}\*.*"
  File "/oname=$INSTDIR\app\icone.ico" "${ASSETS}\icone.ico"

  ; Bibliothèque Microsoft Visual C++ (nécessaire à PostgreSQL) : installée seulement si elle manque
  SetRegView 64
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $1 != 1
    DetailPrint "Installation de la bibliothèque Microsoft Visual C++…"
    ExecWait '"$INSTDIR\runtime\vc_redist.x64.exe" /install /quiet /norestart' $2
    DetailPrint "  (code de retour : $2)"
  ${EndIf}
  Delete "$INSTDIR\runtime\vc_redist.x64.exe"

  ; Pare-feu : les autres ordinateurs et téléphones du réseau de l'hôtel peuvent se connecter (réseaux privés et d'entreprise seulement)
  DetailPrint "Autorisation du réseau local (pare-feu Windows)…"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${APPNAME}"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="${APPNAME}" dir=in action=allow protocol=TCP localport=${PORT} profile=private,domain'
  Pop $0

  ; Raccourcis
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\Lancer.cmd" "" "$INSTDIR\app\icone.ico" 0 SW_SHOWNORMAL "" "Démarrer ${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Sauvegarder ${APPNAME}.lnk" "$INSTDIR\Sauvegarder.cmd" "" "$INSTDIR\app\icone.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Restaurer ${APPNAME}.lnk" "$INSTDIR\Restaurer.cmd" "" "$INSTDIR\app\icone.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Créer un compte éditeur.lnk" "$INSTDIR\Creer-compte-editeur.cmd" "" "$INSTDIR\app\icone.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Désinstaller ${APPNAME}.lnk" "$INSTDIR\Desinstaller.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\Lancer.cmd" "" "$INSTDIR\app\icone.ico" 0 SW_SHOWNORMAL "" "Démarrer ${APPNAME}"

  ; Démarrage automatique avec Windows (conseillé sur l'ordinateur principal). Installation silencieuse : non.
  MessageBox MB_YESNO|MB_ICONQUESTION "Démarrer ${APPNAME} automatiquement à l'ouverture de Windows ?$\r$\n$\r$\n(Conseillé sur l'ordinateur principal de l'hôtel, pour que le logiciel soit toujours disponible.)" /SD IDNO IDNO noautostart
    CreateShortCut "$SMSTARTUP\${APPNAME}.lnk" "$INSTDIR\Lancer.cmd" "" "$INSTDIR\app\icone.ico" 0 SW_SHOWMINIMIZED
  noautostart:

  ; Désinstallation et liste des programmes de Windows
  WriteUninstaller "$INSTDIR\Desinstaller.exe"
  WriteRegStr HKLM "Software\HotelManagerPro" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\app\icone.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstaller.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  DetailPrint "Installation terminée."
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  ${If} ${FileExists} "$INSTDIR\runtime\node.exe"
    DetailPrint "Arrêt du logiciel…"
    nsExec::Exec '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\launcher.mjs" stop'
    Pop $0
  ${EndIf}
  nsExec::Exec 'schtasks /delete /tn "${APPNAME} - Sauvegarde" /f'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${APPNAME}"'
  Pop $0

  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMSTARTUP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"

  ; Le programme est supprimé ; « donnees » (la base de l'hôtel) et « sauvegardes » sont CONSERVÉS
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\Lancer.cmd"
  Delete "$INSTDIR\Sauvegarder.cmd"
  Delete "$INSTDIR\Restaurer.cmd"
  Delete "$INSTDIR\Creer-compte-editeur.cmd"
  Delete "$INSTDIR\Arreter.cmd"
  Delete "$INSTDIR\LISEZMOI.txt"
  Delete "$INSTDIR\Desinstaller.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\HotelManagerPro"
  ${If} ${FileExists} "$INSTDIR\donnees"
    MessageBox MB_OK|MB_ICONINFORMATION "${APPNAME} est désinstallé.$\r$\n$\r$\nLes données de l'hôtel et les sauvegardes sont CONSERVÉES dans :$\r$\n$INSTDIR$\r$\n(dossiers « donnees » et « sauvegardes »). Ne les supprimez que si vous êtes certain de ne plus en avoir besoin." /SD IDOK
  ${EndIf}
SectionEnd
