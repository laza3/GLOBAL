# Test de bout en bout de l'installateur sur un vrai Windows (lancé par la CI) :
# installation silencieuse → démarrage → navigateur → sauvegarde → panne simulée → restauration → désinstallation.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setup = Get-ChildItem (Join-Path $root 'build\installateur') -Filter 'HotelManagerPro-Setup-*.exe' | Select-Object -First 1
if (-not $setup) { throw 'Installateur introuvable' }
$dir = 'C:\hmp-test'
$port = 5173
$base = "http://127.0.0.1:$port"
$node = Join-Path $dir 'runtime\node.exe'
$launcher = Join-Path $dir 'app\launcher.mjs'
$env:HMP_ADMIN_EMAIL = 'editeur@ci.test'; $env:HMP_ADMIN_NAME = 'Editeur CI'; $env:ADMIN_PASSWORD = 'Editeur-solide-42'

function Step($m) { Write-Host "`n▸ $m" }
function Ok($m) { Write-Host "  ✔ $m" -ForegroundColor Green }
function Fail($m) { Write-Host "  ✘ ÉCHEC : $m" -ForegroundColor Red; Show-Logs; exit 1 }
function Show-Logs {
  foreach ($f in 'ci-sortie.log', 'ci-erreur.log', 'donnees\serveur.log', 'donnees\postgresql.log') {
    $p = Join-Path $dir $f
    if (Test-Path $p) { Write-Host "`n----- $f -----"; Get-Content $p -Tail 40 }
  }
}
function Wait-Ready($seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try { if ((Invoke-WebRequest "$base/health/ready" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}
function Start-App {
  $script:app = Start-Process cmd.exe -ArgumentList '/c', "`"$dir\Lancer.cmd`" --auto --no-browser --no-task" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dir 'ci-sortie.log') -RedirectStandardError (Join-Path $dir 'ci-erreur.log')
  if (-not (Wait-Ready 300)) { Fail "le logiciel n'a pas démarré en 5 minutes" }
}
function Stop-App {
  # Arrêt « brutal » du lanceur, puis la commande « stop » (celle qu'utilise l'installateur pour les mises à jour) doit tout nettoyer
  if ($script:app -and -not $script:app.HasExited) { & taskkill /PID $script:app.Id /T /F | Out-Null }
  & $node $launcher stop | Out-Host
  Start-Sleep -Seconds 3
  try { Invoke-WebRequest "$base/health/ready" -UseBasicParsing -TimeoutSec 3 | Out-Null; Fail "le serveur répond encore après « stop »" } catch { }
  if (Get-Process postgres -ErrorAction SilentlyContinue) { Fail "PostgreSQL tourne encore après « stop »" }
}

Step "Installation silencieuse ($($setup.Name), $([math]::Round($setup.Length / 1MB)) Mo)"
$p = Start-Process -FilePath $setup.FullName -ArgumentList '/S', "/D=$dir" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "l'installateur a rendu le code $($p.ExitCode)" }
foreach ($f in 'Lancer.cmd', 'Sauvegarder.cmd', 'Restaurer.cmd', 'Desinstaller.exe', 'runtime\node.exe', 'runtime\pg\bin\postgres.exe', 'runtime\pg\bin\pg_dump.exe', 'runtime\pg\bin\initdb.exe', 'app\launcher.mjs', 'app\server.mjs', 'app\web\index.html', 'app\node_modules\fastify\package.json') {
  if (-not (Test-Path (Join-Path $dir $f))) { Fail "fichier absent après installation : $f" }
}
Ok 'fichiers installés'
if (-not (Test-Path 'C:\Users\Public\Desktop\Hotel Manager Pro.lnk')) { Fail 'raccourci du bureau absent' }
if (-not (Test-Path 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Hotel Manager Pro\Sauvegarder Hotel Manager Pro.lnk')) { Fail 'raccourcis du menu Démarrer absents' }
Ok 'raccourcis créés'
& netsh advfirewall firewall show rule name="Hotel Manager Pro" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'règle de pare-feu absente' }
Ok 'règle de pare-feu créée'
if (-not (Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelManagerPro')) { Fail 'entrée de désinstallation absente' }
Ok 'entrée « Programmes et fonctionnalités » créée'

Step 'Bibliothèques natives et PDF (dans le dossier installé)'
Push-Location (Join-Path $dir 'app')
& $node -e "const a=require('@node-rs/argon2'); a.hash('mot-de-passe-test-42').then(h=>a.verify(h,'mot-de-passe-test-42')).then(v=>{if(!v)process.exit(2);console.log('argon2 ok')}); const P=require('pdfkit'); const d=new P(); d.text('Facture'); d.end(); console.log('pdfkit ok')"
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'argon2 ou pdfkit inutilisable' }
Pop-Location
Ok 'argon2 et pdfkit fonctionnent'

Step 'Premier démarrage (création de la base, migrations, compte éditeur)'
$sw = [Diagnostics.Stopwatch]::StartNew()
Start-App
Ok "logiciel prêt en $([int]$sw.Elapsed.TotalSeconds) s"
$meta = Invoke-RestMethod "$base/api/v1/meta"
if ($meta.environment -ne 'development') { Fail "environnement inattendu : $($meta.environment)" }
$home = Invoke-WebRequest "$base/" -UseBasicParsing
if ($home.Content -notmatch 'id="root"') { Fail "la page d'accueil n'est pas l'interface" }
if (-not $home.Headers['Content-Security-Policy']) { Fail "pas d'en-tête de sécurité sur la page d'accueil" }
try { Invoke-WebRequest "$base/api/v1/route-inconnue" -UseBasicParsing | Out-Null; Fail 'une route inconnue devrait renvoyer 404' } catch { if ($_.Exception.Response.StatusCode.value__ -ne 404) { Fail "route inconnue : code $($_.Exception.Response.StatusCode.value__)" } }
Ok "API et interface servies (environnement : $($meta.environment))"
$lan = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
if ($lan) { $r = Invoke-RestMethod "http://${lan}:$port/api/v1/meta"; Ok "accessible aussi par l'adresse du réseau ($lan)" }
if (-not (Test-Path (Join-Path $dir 'donnees\config.json'))) { Fail 'config.json absent' }

Step 'Navigateur réel : inscription, vue d''ensemble, page profonde, console éditeur'
$env:BASE = $base; $env:EDITOR_EMAIL = 'editeur@ci.test'; $env:EDITOR_PASSWORD = 'Editeur-solide-42'; $env:HOTEL_EMAIL = "hotel$((Get-Date).Ticks)@hotel-local.test"
& node (Join-Path $root 'scripts\check-local-install.mjs')
if ($LASTEXITCODE -ne 0) { Fail 'la vérification dans le navigateur a échoué' }
$hotelEmail = $env:HOTEL_EMAIL

Step 'Sauvegarde pendant que le logiciel tourne'
& $node $launcher backup --auto | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'sauvegarde en échec' }
$dump = Get-ChildItem (Join-Path $dir 'sauvegardes') -Filter 'hmp-*.dump' | Select-Object -First 1
if (-not $dump -or $dump.Length -lt 100000) { Fail 'sauvegarde absente ou trop petite' }
if (-not (Test-Path ($dump.FullName -replace '\.dump$', '.cle.json'))) { Fail 'fichier des clés absent' }
Ok "sauvegarde vérifiée ($([math]::Round($dump.Length / 1KB)) Ko) avec son fichier de clés"

Step 'Arrêt, puis commande « stop »'
Stop-App
Ok 'serveur et PostgreSQL arrêtés'

Step 'Panne simulée : ordinateur neuf (données supprimées), nouvelle installation de la base, restauration'
$usb = 'C:\hmp-usb'; New-Item -ItemType Directory -Force $usb | Out-Null
Copy-Item "$($dump.FullName)*" $usb; Copy-Item ($dump.FullName -replace '\.dump$', '.cle.json') $usb
Remove-Item -Recurse -Force (Join-Path $dir 'donnees'), (Join-Path $dir 'sauvegardes')
Start-App; Stop-App
$restoreOut = & $node $launcher restore (Join-Path $usb $dump.Name) --oui 2>&1
$restoreOut | Out-Host
if ($LASTEXITCODE -ne 0 -or ($restoreOut -join "`n") -notmatch 'Données restaurées') { Fail 'restauration en échec' }
if (($restoreOut -join "`n") -notmatch 'Clé de chiffrement d.origine reprise') { Fail "la clé de chiffrement d'origine n'a pas été reprise" }
Ok 'données et clé restaurées'

Step 'Relance après restauration : l''hôtel et la console sont retrouvés'
Start-App
$env:MODE = 'login'; $env:HOTEL_EMAIL = $hotelEmail
& node (Join-Path $root 'scripts\check-local-install.mjs')
if ($LASTEXITCODE -ne 0) { Fail 'connexion après restauration en échec' }
Stop-App

Step 'Mise à jour par-dessus (réinstallation) : les données sont conservées'
$p = Start-Process -FilePath $setup.FullName -ArgumentList '/S', "/D=$dir" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "réinstallation : code $($p.ExitCode)" }
if (-not (Test-Path (Join-Path $dir 'donnees\config.json'))) { Fail 'la mise à jour a supprimé les données !' }
Start-App
$env:MODE = 'login'
& node (Join-Path $root 'scripts\check-local-install.mjs')
if ($LASTEXITCODE -ne 0) { Fail "connexion après mise à jour en échec" }
Ok 'mise à jour : données conservées, hôtel retrouvé'
Stop-App

Step 'Désinstallation silencieuse'
$p = Start-Process -FilePath (Join-Path $dir 'Desinstaller.exe') -ArgumentList '/S', "_?=$dir" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "désinstallation : code $($p.ExitCode)" }
if (Test-Path (Join-Path $dir 'runtime')) { Fail 'le programme est resté après désinstallation' }
if (-not (Test-Path (Join-Path $dir 'donnees\config.json'))) { Fail 'les données de l''hôtel ont été supprimées par la désinstallation !' }
if (Test-Path 'C:\Users\Public\Desktop\Hotel Manager Pro.lnk') { Fail 'raccourci du bureau resté' }
& netsh advfirewall firewall show rule name="Hotel Manager Pro" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Fail 'règle de pare-feu restée' }
Ok 'programme retiré, données conservées, raccourcis et pare-feu nettoyés'

Write-Host "`n✔ INSTALLATEUR VALIDÉ de bout en bout sur Windows" -ForegroundColor Green
