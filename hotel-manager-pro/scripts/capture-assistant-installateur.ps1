# Lance l'assistant GRAPHIQUE de l'installateur (sans /S) sur le Windows de la CI et prend des captures d'écran :
# prouve que la fenêtre s'ouvre, que le texte est lisible (accents) et que les pages s'enchaînent. Rien n'est installé (processus arrêté avant « Installer »).
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$out = Join-Path $env:RUNNER_TEMP 'captures'
New-Item -ItemType Directory -Force $out | Out-Null
function Snap($name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $out "$name.png")); $g.Dispose(); $bmp.Dispose()
  Write-Host "  capture : $name ($($b.Width)x$($b.Height))"
}
function Windows-List { Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { Write-Host "  fenêtre : [$($_.ProcessName)] '$($_.MainWindowTitle)'" } }
$setup = Get-ChildItem (Join-Path $root 'build\installateur') -Filter 'HotelManagerPro-Setup-*.exe' | Select-Object -First 1
Write-Host "Lancement de l'assistant graphique : $($setup.Name)"
$p = Start-Process -FilePath $setup.FullName -PassThru
Start-Sleep -Seconds 12
Write-Host "processus encore vivant : $(-not $p.HasExited)"
Windows-List
Snap '1-accueil'
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Seconds 3
Snap '2-dossier'
Windows-List
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Get-Process | Where-Object { $_.ProcessName -like 'HotelManagerPro-Setup*' } | Stop-Process -Force -ErrorAction SilentlyContinue
exit 0
