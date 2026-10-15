# Mercury PDV — Fase 1: habilitar WSL2 no Windows Server 2022/2025
# Executar como ADMINISTRADOR (PowerShell), dentro da pasta deploy\:
#   powershell -ExecutionPolicy Bypass -File .\preparar-vps-fase1.ps1
# AO FINAL E OBRIGATORIO REINICIAR A VPS. Depois siga a Fase 2 (docs/12 §3).
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
Write-Host '=== Mercury PDV — Fase 1: habilitar WSL2 ==='

# 1) Recursos do Windows exigidos pelo WSL2
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
Write-Host '[OK] Recursos habilitados: Subsystem-Linux + VirtualMachinePlatform'

# 2) WSL 2.x via instalador oficial do GitHub (caminho documentado p/ Windows Server)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  $rel = Invoke-RestMethod 'https://api.github.com/repos/microsoft/WSL/releases/latest'
  $asset = $rel.assets | Where-Object { $_.name -like '*.x64.msi' } | Select-Object -First 1
  if ($asset) {
    $msi = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $msi
    Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn' -Wait
    Write-Host "[OK] WSL instalado: $($asset.name)"
  } else { Write-Warning 'MSI do WSL nao localizado no GitHub — baixe manualmente em github.com/microsoft/WSL/releases' }
} catch {
  Write-Warning "Download do WSL falhou ($($_.Exception.Message)). Baixe manualmente em github.com/microsoft/WSL/releases e instale o .msi x64."
}

wsl --set-default-version 2 2>$null
Write-Host '[OK] Versao padrao do WSL = 2'

Write-Host ''
Write-Host 'FASE 1 CONCLUIDA. REINICIE A VPS AGORA (Restart-Computer).' -ForegroundColor Yellow
Write-Host 'Apos o boot, siga a Fase 2: docs/12-deploy-vps-windows.md, secao 3.'
