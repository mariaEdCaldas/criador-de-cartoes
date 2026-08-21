# Para o servidor do Criador de Cartoes, se estiver rodando.

$processos = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*index.js servidor*' }

if ($processos) {
  $processos | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Host "  Sistema parado ($($processos.Count) processo(s))."
} else {
  Write-Host '  O sistema nao estava rodando.'
}
