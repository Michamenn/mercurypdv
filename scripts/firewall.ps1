# Regra de firewall: libera a porta 3000 SOMENTE no perfil de rede Privada
# Executar UMA vez como Administrador no computador servidor (caixa).
# Nao desativa nenhuma protecao; apenas adiciona a regra de entrada restrita.
# Uso: abra o PowerShell como Administrador e execute: .\firewall.ps1

$porta = 3000
$nome = "LanchonetePro PDV (rede privada)"

# Rejeita perfis Publico/Dominio por padrao: a regra e criada apenas para Private.
$existe = Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue
if ($existe) { Write-Host "Regra ja existe. Nada a fazer." -ForegroundColor Yellow; exit 0 }

New-NetFirewallRule -DisplayName $nome `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $porta `
  -Profile Private | Out-Null

Write-Host "Regra criada: porta TCP $porta liberada apenas no perfil PRIVADO." -ForegroundColor Green
Write-Host ""
Write-Host "Checklist de rede (manual, no Windows):"
Write-Host " 1. Confirme que o Wi-Fi/ethernet esta marcado como rede PRIVADA:"
Write-Host "    Configuracoes > Rede e Internet > [sua rede] > Perfil de rede = Privada"
Write-Host " 2. Defina IP fixo no servidor (ex.: 192.168.1.100) no roteador ou no Windows."
Write-Host " 3. Garanta que o roteador NAO expoe a porta 3000 para a internet (sem port forwarding)."
Write-Host " 4. Dispositivos acessam via http://<IP-DO-SERVIDOR>:3000 (PWA instalavel)."
Write-Host " 5. Se aparecerem dispositivos nao autorizados no Wi-Fi, troque a senha da rede."
