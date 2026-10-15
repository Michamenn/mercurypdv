#!/usr/bin/env bash
# Restaura um backup .sqlite dentro do volume do banco.
# O app e parado automaticamente (restore SEMPRE exige servidor parado — regra do projeto).
# Uso (dentro do WSL2):  bash ~/mercurypdv/deploy/restaurar-backup.sh /mnt/c/caminho/backup.sqlite
set -euo pipefail

ARQUIVO="${1:?Uso: bash restaurar-backup.sh <arquivo.sqlite>}"
[ -f "$ARQUIVO" ] || { echo "Arquivo nao encontrado: $ARQUIVO"; exit 1; }

cd "$(dirname "$0")"

echo ">> Parando o app..."
docker compose stop app

echo ">> Restaurando $ARQUIVO ..."
docker run --rm -i \
  -v mercury-pdv_vol_dados:/dados \
  alpine sh -c 'rm -f /dados/lanchonete.sqlite /dados/lanchonete.sqlite-wal /dados/lanchonete.sqlite-shm && cat > /dados/lanchonete.sqlite' \
  < "$ARQUIVO"

echo ">> Subindo o app..."
docker compose start app
echo "[OK] Restaurado. Acesse http://<IP-DA-VPS> e confira os dados."
