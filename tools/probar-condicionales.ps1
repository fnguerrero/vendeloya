# Pide la clave de la app (sin mostrarla), corre la sonda de condicionales y no deja la clave guardada.
# Se puede lanzar desde cmd o PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "W:\Working Folder Personal\Apps\VendeloYa\tools\probar-condicionales.ps1"
$clave = Read-Host "Clave de la app" -AsSecureString
$env:VENDELOYA_CLAVE = [Net.NetworkCredential]::new('', $clave).Password
try {
  node "$PSScriptRoot\probar-condicionales.mjs"
} finally {
  Remove-Item Env:VENDELOYA_CLAVE -ErrorAction SilentlyContinue
}
