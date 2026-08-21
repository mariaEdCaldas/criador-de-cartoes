# Deixa o Criador de Cartoes subindo sozinho toda vez que o Windows liga.
# Nao precisa de administrador: usa a pasta Inicializar do proprio usuario.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

Write-Host ''
Write-Host '  Instalando o Criador de Cartoes...' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  [ERRO] O Node.js nao esta instalado nesta maquina.' -ForegroundColor Red
  Write-Host '         Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.'
  Write-Host ''
  Read-Host '  Aperte Enter para fechar'
  exit 1
}

if (-not (Test-Path (Join-Path $raiz 'node_modules'))) {
  Write-Host '  Instalando as dependencias (leva alguns minutos)...'
  Push-Location $raiz
  npm install --no-audit --no-fund
  Pop-Location
}

$template = Get-ChildItem -Path (Join-Path $raiz 'assets') -Filter 'template.*' -ErrorAction SilentlyContinue
if (-not $template) {
  Write-Host ''
  Write-Host '  [ATENCAO] Nao achei a arte do cartao em assets\template.jpg' -ForegroundColor Yellow
  Write-Host '            Sem ela o sistema nao gera cartao nenhum. Copie o arquivo para la.'
  Write-Host ''
}

$shell = New-Object -ComObject WScript.Shell

Write-Host '  Criando o atalho de inicio automatico...'
$inicializar = [Environment]::GetFolderPath('Startup')
$atalho = $shell.CreateShortcut((Join-Path $inicializar 'Criador de Cartoes.lnk'))
$atalho.TargetPath = 'wscript.exe'
$atalho.Arguments = '"' + (Join-Path $PSScriptRoot 'iniciar-oculto.vbs') + '"'
$atalho.WorkingDirectory = $raiz
$atalho.Description = 'Criador de Cartoes de Aniversario'
$atalho.Save()

Write-Host '  Criando o atalho do painel na area de trabalho...'
$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$url = $shell.CreateShortcut((Join-Path $areaDeTrabalho 'Cartoes de Aniversario.url'))
$url.TargetPath = 'http://localhost:3000'
$url.Save()

Write-Host '  Ligando o sistema agora...'
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $PSScriptRoot 'iniciar-oculto.vbs') + '"')
Start-Sleep -Seconds 6

$respondeu = $false
try {
  Invoke-WebRequest -Uri 'http://localhost:3000/login.html' -UseBasicParsing -TimeoutSec 5 | Out-Null
  $respondeu = $true
} catch {}

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Green
if ($respondeu) {
  Write-Host '   Pronto! O sistema esta no ar e sobe sozinho toda vez que' -ForegroundColor Green
  Write-Host '   o computador for ligado.' -ForegroundColor Green
} else {
  Write-Host '   O atalho foi criado, mas o servidor nao respondeu ainda.' -ForegroundColor Yellow
  Write-Host '   Veja o que aconteceu em dados\servidor.log' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '   Use o atalho "Cartoes de Aniversario" na area de trabalho,'
Write-Host '   ou abra http://localhost:3000 no navegador.'
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host ''
Read-Host '  Aperte Enter para fechar'
