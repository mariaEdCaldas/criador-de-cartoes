# Tira o inicio automatico e para o sistema. Os dados continuam salvos.

$atalho = Join-Path ([Environment]::GetFolderPath('Startup')) 'Criador de Cartoes.lnk'
if (Test-Path $atalho) {
  Remove-Item $atalho -Force
  Write-Host '  Inicio automatico removido.'
} else {
  Write-Host '  O inicio automatico ja nao estava instalado.'
}

& (Join-Path $PSScriptRoot 'parar.ps1')

Write-Host ''
Write-Host '  O sistema nao sobe mais sozinho.'
Write-Host '  A lista de aniversariantes e os usuarios continuam salvos na pasta dados\.'
Write-Host ''
Read-Host '  Aperte Enter para fechar'
