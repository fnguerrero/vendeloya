# Carga los 4 secretos del Worker de VendeloYa, uno por uno.
# Cada uno te pide el valor (no se ve al escribir) y lo guarda en Cloudflare.
# Se corre desde cualquier consola:
#   powershell -ExecutionPolicy Bypass -File "W:\Working Folder Personal\Apps\VendeloYa\tools\cargar-secretos.ps1"
# Para cargar solo algunos:  ... -File "...\cargar-secretos.ps1" -Solo ML_CLIENT_ID,APP_SECRET

param([string[]]$Solo)

$ErrorActionPreference = 'Stop'
$config = Join-Path $PSScriptRoot '..\worker\wrangler.toml'

$secretos = [ordered]@{
  ML_CLIENT_ID      = 'El Client ID de la app de MercadoLibre (DevCenter > tu app > Configurar).'
  ML_CLIENT_SECRET  = 'La Secret Key de esa misma app.'
  ANTHROPIC_API_KEY = 'La clave de la API de Claude (puede ser la misma de Deficit).'
  APP_SECRET        = 'Una clave que inventes, larga. Despues la cargas en Ajustes de la app.'
}

foreach ($nombre in $secretos.Keys) {
  if ($Solo -and $nombre -notin $Solo) { continue }
  Write-Host ''
  Write-Host "== $nombre" -ForegroundColor Cyan
  Write-Host "   $($secretos[$nombre])"
  npx --yes wrangler@4 secret put $nombre --config $config
  if ($LASTEXITCODE -ne 0) {
    Write-Host "No se pudo cargar $nombre. Si dice 'Authentication error', corre antes: npx wrangler login" -ForegroundColor Red
    exit 1
  }
}

Write-Host ''
Write-Host 'Secretos cargados en el Worker:' -ForegroundColor Green
npx --yes wrangler@4 secret list --config $config

Write-Host ''
Write-Host 'Ultimo paso: en la app, Ajustes > la misma APP_SECRET, y despues "Conectar MercadoLibre".' -ForegroundColor Green
Start-Process 'https://vendeloya-app.fnguerrero.workers.dev'
