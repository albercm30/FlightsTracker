# Configura los escaneos gratis en GitHub Actions para Flight Tracker.
# Uso (en PowerShell, dentro de la carpeta del proyecto):
#   powershell -ExecutionPolicy Bypass -File scripts\configurar-github-actions.ps1
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Titulo($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Preguntar($texto, $defecto) {
  $r = Read-Host "$texto$(if ($defecto) { " [$defecto]" })"
  if ([string]::IsNullOrWhiteSpace($r)) { return $defecto } else { return $r.Trim() }
}
function Secreto($texto) {
  $s = Read-Host $texto -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

Titulo "1/5 Comprobando GitHub CLI"
function Buscar-Gh {
  # Recarga el PATH (winget lo actualiza, pero las ventanas ya abiertas no lo ven) y busca gh.exe
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (Get-Command gh -ErrorAction SilentlyContinue) { return $true }
  $candidatos = @(
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\gh.exe"
  )
  foreach ($c in $candidatos) {
    if ($c -and (Test-Path $c)) { $env:Path = (Split-Path $c) + ";" + $env:Path; return $true }
  }
  return $false
}
if (-not (Buscar-Gh)) {
  Write-Host "Instalando GitHub CLI con winget..." -ForegroundColor Yellow
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
  if (-not (Buscar-Gh)) {
    Write-Host "No encuentro gh.exe. Cierra TODAS las ventanas de PowerShell/VS Code, ábrelas de nuevo y repite." -ForegroundColor Red
    exit 1
  }
}
Write-Host ("GitHub CLI: " + (gh --version | Select-Object -First 1)) -ForegroundColor Green
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Inicia sesión en GitHub (se abrirá el navegador)..."; gh auth login --web --git-protocol https }

$repo = gh repo view --json nameWithOwner -q .nameWithOwner
Write-Host "Repositorio: $repo" -ForegroundColor Green
$wf = gh workflow list --all 2>$null | Select-String "Escaneo programado"
if (-not $wf) {
  Write-Host "No encuentro el workflow 'Escaneo programado' en GitHub." -ForegroundColor Red
  Write-Host "Sube primero el código:  git add -A ; git commit -m 'Escaneos en GitHub Actions' ; git push"
  exit 1
}

Titulo "2/5 Fuente de precios"
Write-Host "Token gratuito de Travelpayouts: https://www.travelpayouts.com -> perfil -> API token"
$token = Secreto "Pega tu token de Travelpayouts (Enter para dejarlo para luego)"
if ($token) { gh secret set TRAVELPAYOUTS_TOKEN --body $token --repo $repo; Write-Host "OK token guardado" -ForegroundColor Green }
else { Write-Host "Sin token: podrás probar en modo demo, pero los escaneos reales fallarán hasta que lo añadas." -ForegroundColor Yellow }

Titulo "3/5 Qué vigilar"
$origins = Preguntar "Aeropuertos de salida (códigos separados por comas)" "TCI,LPA,MAD"
$dests   = Preguntar "Destinos favoritos (códigos)" "LON,ROM,PAR,LIS,NYC,CUN,BKK,TYO"
$trip    = Preguntar "Tipo de viaje: rt = ida y vuelta, ow = solo ida, both = ambos" "rt"
$minN    = Preguntar "Noches mínimas" "3"
$maxN    = Preguntar "Noches máximas" "10"
$pax     = Preguntar "Viajeros" "1"
$bag     = Preguntar "Equipaje: personal, cabin, checked, cabin_checked" "cabin"
$res     = Preguntar "Descuento de residente: canarias, baleares o vacío" "canarias"
$tz      = Preguntar "Zona horaria" "Atlantic/Canary"
$quiet   = Preguntar "Horas sin avisos (p. ej. 23-8, vacío = siempre)" "23-8"
$vars = @{ ORIGINS = $origins.ToUpper(); DESTINATIONS = $dests.ToUpper(); TRIP_TYPE = $trip; MIN_NIGHTS = $minN;
           MAX_NIGHTS = $maxN; PASSENGERS = $pax; BAGGAGE = $bag; TZ = $tz; ENABLE_SCHEDULED_SCAN = "true" }
if ($res)   { $vars.RESIDENT_DISCOUNT = $res }
if ($quiet) { $vars.QUIET_HOURS = $quiet }
foreach ($k in $vars.Keys) { gh variable set $k --body $vars[$k] --repo $repo | Out-Null; Write-Host "  $k = $($vars[$k])" }

Titulo "4/5 Avisos en el móvil"
$rand = -join ((97..122) + (48..57) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$topic = Preguntar "Tema de ntfy (instala la app 'ntfy' y suscríbete a este tema)" "vuelos-$rand"
if ($topic) { gh secret set NTFY_TOPIC --body $topic --repo $repo; Write-Host "OK ntfy: suscríbete en la app al tema  $topic" -ForegroundColor Green }
$tg = Preguntar "¿Quieres también Telegram? (s/n)" "n"
if ($tg -eq "s") {
  $tgTok = Secreto "Token del bot de Telegram"
  $tgChat = Preguntar "Tu chat id de Telegram" ""
  gh secret set TELEGRAM_BOT_TOKEN --body $tgTok --repo $repo
  gh secret set TELEGRAM_CHAT_ID --body $tgChat --repo $repo
}

Titulo "5/5 Probar"
$demo = Preguntar "¿Lanzar ahora una prueba en modo DEMO para comprobar que te llega el aviso? (s/n)" "s"
if ($demo -eq "s") { gh workflow run scan.yml --repo $repo -f demo=true; Write-Host "Prueba lanzada." -ForegroundColor Green }
if ($token) {
  $real = Preguntar "¿Lanzar también el primer escaneo REAL? (s/n)" "s"
  if ($real -eq "s") { gh workflow run scan.yml --repo $repo; Write-Host "Escaneo real lanzado." -ForegroundColor Green }
}
Write-Host ""
Write-Host "Listo. A partir de ahora se escanea solo cada 6 horas." -ForegroundColor Green
Write-Host "Ver ejecuciones y resumen de precios: https://github.com/$repo/actions"
Write-Host "Cambiar destinos: gh variable set DESTINATIONS --body 'LON,ROM,...'  (o en Settings -> Secrets and variables -> Actions)"
