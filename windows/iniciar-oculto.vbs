' Sobe o Criador de Cartoes sem abrir janela preta no Windows.
' A saida do servidor vai para dados\servidor.log, para dar para investigar
' qualquer problema depois.

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' O script mora em <projeto>\windows, entao a raiz e duas pastas acima.
raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = raiz

comando = "cmd /c node src\index.js servidor >> dados\servidor.log 2>&1"
shell.Run comando, 0, False   ' o 0 esconde a janela
