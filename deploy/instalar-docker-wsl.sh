#!/usr/bin/env bash
# Mercury PDV — Fase 2: Docker CE + Compose dentro do WSL2 (Ubuntu).
# Execute DENTRO do Ubuntu (WSL2):  bash instalar-docker-wsl.sh
set -euo pipefail

# Garante que esta rodando dentro do WSL
if ! grep -qi microsoft /proc/version; then
  echo "ERRO: este script roda DENTRO do Ubuntu (WSL2), nao no Windows." >&2
  exit 1
fi

# systemd e obrigatorio para o Docker iniciar automaticamente
if [ "$(ps -p 1 -o comm=)" != "systemd" ]; then
  if ! grep -qs 'systemd=true' /etc/wsl.conf 2>/dev/null; then
    printf '[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf >/dev/null
  fi
  echo "systemd ainda nao ativo. No PowerShell rode:  wsl --shutdown"
  echo "Reabra o Ubuntu e execute este script novamente."
  exit 1
fi

echo "=== Instalando Docker CE (fonte oficial) ==="
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

sudo docker version
sudo docker compose version

echo ""
echo "[OK] Fase 2 concluida."
echo "IMPORTANTE: feche e REABRA o terminal do Ubuntu (grupo docker),"
echo "e siga para a Fase 2.3 (tarefa de boot) no docs/12-deploy-vps-windows.md."
