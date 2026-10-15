# Mercury PDV — Endurecimento do firewall da VPS
# Restringe o acesso HTTP/HTTPS SOMENTE aos IPs de ORIGEM informados
# (a internet da lanchonete/casa do dono — QUEM acessa, nao o IP da VPS).
# As regras persistem entre reboots; o script de boot respeita o estado endurecido
# atraves do marcador em C:\ProgramData\MercuryPDV\firewall-restrito.txt.
#
# Uso (PowerShell como ADMINISTRADOR, dentro de deploy\):
#   .\endurecer-firewall.ps1                     # IP padrao: 164.163.11.141 (lanchonete)
#   .\endurecer-firewall.ps1 -IncluirHTTPS       # idem + restringe tambem a porta 443
#   .\endurecer-firewall.ps1 -IpsLanchonete "203.0.113.10"          # outro IP unico
#   .\endurecer-firewall.ps1 -IpsLanchonete "164.163.11.141","198.51.100.0/24"  # lista/faixa
#   .\endurecer-firewall.ps1 -Desfazer           # emergencia (IP mudou e travou o acesso)
#Requires -RunAsAdministrator

param(
  [string[]]$IpsLanchonete = @('164.163.11.141'),
  [switch]$IncluirHTTPS,
  [switch]$Desfazer
)

$ErrorActionPreference = 'Stop'
$marcador = Join-Path $env:ProgramData 'MercuryPDV\firewall-restrito.txt'

function Remover-RegrasMercury {
  foreach ($n in 'Mercury PDV HTTP (80)','Mercury PDV HTTPS (443)',
                 'Mercury PDV (80) restrito','Mercury PDV (443) restrito') {
    Remove-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue
  }
}

function Criar-RegrasAbertas {
  New-NetFirewallRule -DisplayName 'Mercury PDV HTTP (80)'   -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow | Out-Null
  New-NetFirewallRule -DisplayName 'Mercury PDV HTTPS (443)' -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow | Out-Null
}

function Criar-RegrasRestritas([string[]]$Ips, [bool]$Https) {
  $portas = @(80); if ($Https) { $portas += 443 }
  foreach ($p in $portas) {
    New-NetFirewallRule -DisplayName "Mercury PDV ($p) restrito" -Direction Inbound `
      -Protocol TCP -LocalPort $p -RemoteAddress $Ips -Action Allow | Out-Null
  }
}

# ---- Desfazer (emergencia: IP da lanchonete mudou e travou o acesso) ----
if ($Desfazer) {
  Remover-RegrasMercury
  Criar-RegrasAbertas
  Remove-Item $marcador -ErrorAction SilentlyContinue
  Write-Host '[OK] Firewall liberado para qualquer origem (estado inicial).' -ForegroundColor Yellow
  Write-Host '    Rode novamente com -IpsLanchonete para restringir (IP atualizado).'
  exit 0
}

# ---- Endurecer ----
if (-not $IpsLanchonete -or $IpsLanchonete.Count -eq 0) {
  throw "Informe -IpsLanchonete com os IPs PUBLICOS de QUEM acessa (lanchonete, casa do dono). Nao use o IP da VPS. Ex.: .\endurecer-firewall.ps1 -IpsLanchonete `"203.0.113.10`""
}

foreach ($ip in $IpsLanchonete) {   # valida IP ou CIDR
  $parte = ($ip -split '/')[0]
  $tmp = $null
  if (-not [System.Net.IPAddress]::TryParse($parte, [ref]$tmp)) { throw "IP invalido: $ip" }
}

Remover-RegrasMercury
Criar-RegrasRestritas -Ips $IpsLanchonete -Https:($IncluirHTTPS.IsPresent)

New-Item -ItemType Directory -Force -Path (Split-Path $marcador) | Out-Null
Set-Content -Path $marcador -Value ("Ips: " + ($IpsLanchonete -join ', ') + " | HTTPS: " + $IncluirHTTPS.IsPresent + " | " + (Get-Date -Format 'yyyy-MM-dd HH:mm')) -Encoding ascii

Write-Host "[OK] Acesso restrito as origens: $($IpsLanchonete -join ', ')" -ForegroundColor Green
Write-Host '    O boot da VPS NAO reabrir as portas (marcador criado em ProgramData).'
Write-Host ''
Write-Host 'PROVA OBRIGATORIA (agora):'
Write-Host '  1) Celular fora da lista (4G, fora da lanchonete): deve FALHAR.'
Write-Host '  2) Da lanchonete: deve abrir normalmente.'
Write-Host ''
Write-Host 'ATENCAO RDP: a porta de administracao (3389) segue aberta ao mundo.'
Write-Host 'Considere restringi-la ao seu IP de gestao — fora do escopo deste script.'
